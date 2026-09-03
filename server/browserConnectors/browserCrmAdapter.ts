import { readFile } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { assertAuthorisedConnectionUrl } from "../connectedSystems";
import type {
  AdapterConnection,
  AdapterEvidence,
  CapabilityResult,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmAdapter,
  CrmCapability,
  CrmProvider,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
  OutboundMessageInput,
} from "../crm/types";
import {
  executeSavedBrowserScript,
  validateSavedBrowserScript,
  type SavedBrowserScript,
} from "./scriptEngine";
import {
  browserOperationReadinessForSystem,
  browserShadowMode,
  recordBrowserOperationResult,
  requireRuntimeBrowserOperation,
} from "./learnedOperations";
import {
  ADAPTER_OPERATION_KEYS,
  BROWSER_OPERATION_CATALOGUE,
  verifyBrowserCreateTarget,
  verifyBrowserPostconditions,
  verifyBrowserTarget,
  type BrowserTargetIdentity,
} from "./operationContracts";
import { recordLearnedRuntimeFailure } from "./runtimeFailure";
import {
  createContextWithBrowserSession,
  isBrowserSessionPackage,
} from "./browserSession";
import {
  acquireAiBrowserControl,
  releaseBrowserControl,
} from "./browserControlArbitration";
import { connectManagedCrmBrowser } from "./managedCrmBrowserSessionManager";

const DEFAULT_GENIE_OPERATION_MAP: Record<string, string> = {
  searchContacts: "search_candidate",
  getContact: "read_candidate_history",
  createNote: "add_note",
  createTask: "create_next_task",
  completeTask: "complete_active_task",
  updateContact: "update_contact_status",
  updateOpportunity: "update_current_opportunity",
  sendSms: "send_template_sms",
  sendEmail: "send_template_email",
  sendWhatsApp: "send_template_whatsapp",
  applySequence: "apply_sequence",
  healthCheck: "health_check",
};

const CAPABILITY_OPERATIONS: Record<CrmCapability, string[]> = {
  "contacts.read": ["searchContacts", "getContact", "syncContacts"],
  "contacts.write": ["createContact", "updateContact"],
  "companies.read": ["getCompany", "syncCompanies"],
  "companies.write": ["createCompany"],
  "opportunities.read": ["getOpportunity", "syncOpportunities"],
  "opportunities.write": ["createOpportunity", "updateOpportunity"],
  "tasks.read": ["syncTasks", "getContact"],
  "tasks.write": ["createTask", "completeTask"],
  "activities.read": ["syncActivities", "getContact"],
  "activities.write": ["createActivity"],
  "notes.read": ["getContact"],
  "notes.write": ["createNote"],
  "owners.read": ["syncContacts", "syncTasks"],
  "pipelines.read": ["listPipelines", "syncOpportunities"],
  "email.send": ["sendEmail"],
  "sms.send": ["sendSms"],
  "whatsapp.send": ["sendWhatsApp"],
  "sequences.apply": ["applySequence"],
};

type BrowserLoginProfile = {
  url: string;
};
export type BrowserProfile = {
  browserEndpoint?: string;
  login?: BrowserLoginProfile;
  scripts: Record<string, SavedBrowserScript>;
  operationMap?: Record<string, string>;
  resultKeys?: Record<string, string>;
  operationDefinitions?: Record<
    string,
    {
      definition: unknown;
      prerequisites?: Record<string, unknown>;
      targetAssertions?: Record<string, unknown>;
      postconditionAssertions?: Array<Record<string, unknown>>;
    }
  >;
  artifactDirectory?: string;
};

export function browserAuthenticationRequired(
  _provider: Extract<CrmProvider, "genie" | "custom_browser">,
  profile: Pick<BrowserProfile, "login">
) {
  return Boolean(profile.login);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asProfile(value: unknown): BrowserProfile | undefined {
  if (!isObject(value)) return undefined;
  const scripts: Record<string, SavedBrowserScript> = {};
  if (isObject(value.scripts))
    for (const [key, script] of Object.entries(value.scripts))
      if (isObject(script) && Array.isArray(script.steps))
        scripts[key] = validateSavedBrowserScript(
          script as unknown as SavedBrowserScript
        );
  const login =
    isObject(value.login) && typeof value.login.url === "string"
      ? (value.login as unknown as BrowserLoginProfile)
      : undefined;
  return {
    browserEndpoint:
      typeof value.browserEndpoint === "string"
        ? value.browserEndpoint
        : undefined,
    login,
    scripts,
    operationMap: isObject(value.operationMap)
      ? Object.fromEntries(
          Object.entries(value.operationMap).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
    resultKeys: isObject(value.resultKeys)
      ? Object.fromEntries(
          Object.entries(value.resultKeys).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
    operationDefinitions: isObject(value.operationDefinitions)
      ? (Object.fromEntries(
          Object.entries(value.operationDefinitions).filter(entry =>
            isObject(entry[1])
          )
        ) as BrowserProfile["operationDefinitions"])
      : undefined,
    artifactDirectory:
      typeof value.artifactDirectory === "string"
        ? value.artifactDirectory
        : undefined,
  };
}

async function genieProfile(): Promise<BrowserProfile | undefined> {
  const path =
    process.env.GENIE_SCRIPTS_CONFIG_PATH || "/app/config/genie-scripts.json";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      scripts?: Record<string, SavedBrowserScript>;
      operationDefinitions?: BrowserProfile["operationDefinitions"];
    };
    if (!parsed.scripts) return undefined;
    const loginUrl = process.env.GENIE_LOGIN_URL;
    return {
      browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT,
      login: loginUrl ? { url: loginUrl } : undefined,
      scripts: Object.fromEntries(
        Object.entries(parsed.scripts).map(([key, script]) => [
          key,
          validateSavedBrowserScript(script),
        ])
      ),
      operationMap: DEFAULT_GENIE_OPERATION_MAP,
      operationDefinitions: parsed.operationDefinitions,
      artifactDirectory:
        process.env.GENIE_ARTIFACT_DIR || "/app/data/genie-artifacts",
    };
  } catch {
    return undefined;
  }
}

export async function resolveBrowserProfile(
  connection: AdapterConnection,
  provider: Extract<CrmProvider, "genie" | "custom_browser">
) {
  const configured = asProfile(connection.configuration.browserProfile);
  if (provider === "genie") {
    const installed = await genieProfile();
    if (configured)
      return {
        ...installed,
        ...configured,
        browserEndpoint:
          configured.browserEndpoint ||
          installed?.browserEndpoint ||
          process.env.BROWSERLESS_WS_ENDPOINT,
        login:
          configured.login ||
          (connection.baseUrl ? { url: connection.baseUrl } : installed?.login),
        scripts: { ...(installed?.scripts || {}), ...configured.scripts },
        operationMap: {
          ...(installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP),
          ...(configured.operationMap || {}),
        },
        operationDefinitions: {
          ...(installed?.operationDefinitions || {}),
          ...(configured.operationDefinitions || {}),
        },
      } satisfies BrowserProfile;
    if (connection.baseUrl)
      return {
        browserEndpoint:
          installed?.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT,
        login: { url: connection.baseUrl },
        scripts: installed?.scripts || {},
        operationMap: installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP,
        resultKeys: installed?.resultKeys,
        operationDefinitions: installed?.operationDefinitions,
        artifactDirectory: installed?.artifactDirectory,
      } satisfies BrowserProfile;
    if (installed) return installed;
  }
  if (configured) return configured;
  return connection.baseUrl
    ? { browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT, scripts: {} }
    : undefined;
}
async function browserSecret(
  connection: AdapterConnection,
  supplied?: ConnectionSecretPayload
) {
  if (supplied && Object.keys(supplied).length) return supplied;
  throw new Error(
    "A user-owned or commissioning-owner CRM browser session is required."
  );
}
function operationScript(profile: BrowserProfile, operation: string) {
  const key = profile.operationMap?.[operation] || operation;
  return profile.scripts[key];
}
function artifactDirectory(
  profile: BrowserProfile,
  connection: AdapterConnection
) {
  return (
    profile.artifactDirectory ||
    `/app/data/browser-artifacts/${connection.organisationId}/${connection.id}`
  );
}
async function connect(profile: BrowserProfile) {
  const endpoint =
    profile.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT;
  if (!endpoint)
    throw new Error(
      "No Chromium/CDP endpoint is configured for this browser connector."
    );

  return connectManagedCrmBrowser(endpoint);
}
async function authorizeNavigation(
  connection: AdapterConnection,
  rawUrl: string
) {
  await assertAuthorisedConnectionUrl({
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
    rawUrl,
  });
}

type BlockedNavigation = { url: string; detail: string };

async function withPage<T>(
  connection: AdapterConnection,
  secret: ConnectionSecretPayload,
  provider: string,
  profile: BrowserProfile,
  run: (page: Page, context: BrowserContext) => Promise<T>
) {
  const browser: Browser = await connect(profile);
  if (!secret.browserSession || !isBrowserSessionPackage(secret.browserSession))
    throw new Error("Your CRM needs you to sign in again.");
  const context = await createContextWithBrowserSession({
    browser,
    browserSession: secret.browserSession,
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
  });
  const page = await context.newPage();
  let blocked: BlockedNavigation | undefined;
  await page.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame())
      return route.continue();
    try {
      await authorizeNavigation(connection, request.url());
      return route.continue();
    } catch (error) {
      blocked = {
        url: request.url(),
        detail: error instanceof Error ? error.message : String(error),
      };
      return route.abort("blockedbyclient");
    }
  });
  try {
    const replayUrl = secret.browserSession.authenticatedUrl;
    await authorizeNavigation(connection, replayUrl);
    await page.goto(replayUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (blocked)
      throw new Error(
        "Your CRM redirected to a new sign-in service. A manager needs to approve it."
      );
    return await run(page, context);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export type BrowserDiscoveryControl = {
  tag: string;
  role: string;
  label: string;
  selector: string;
  href?: string;
  pageUrl?: string;
};

/**
 * Reads a bounded, secret-free navigation/control snapshot after the normal
 * authorised authentication boundary. It never clicks a CRM control or reads
 * input values, table rows, messages, notes, or customer data.
 */
export async function inspectBrowserCrmNavigation(input: {
  connection: AdapterConnection;
  secret?: ConnectionSecretPayload;
  provider: Extract<CrmProvider, "genie" | "custom_browser">;
}) {
  const profile = await resolveBrowserProfile(input.connection, input.provider);
  if (!profile)
    throw new Error("No browser connector profile is available for discovery.");
  const secret = await browserSecret(input.connection, input.secret);
  return withPage(
    input.connection,
    secret,
    input.provider,
    profile,
    async page => {
      if (page.url() === "about:blank" && input.connection.baseUrl) {
        await authorizeNavigation(input.connection, input.connection.baseUrl);
        await page.goto(input.connection.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await authorizeNavigation(input.connection, page.url());
      }
      const readControls = () =>
        page
          .locator(
            "nav a, aside a, [role='navigation'] a, a[href], button, input, textarea, select, [data-testid], [data-field], [role='button'], [role='tab'], label, h1, h2, h3"
          )
          .evaluateAll(elements =>
            elements.slice(0, 300).map(element => {
              const html = element as HTMLElement;
              const tag = html.tagName.toLowerCase();
              const id = html.id?.trim();
              const testId = html.getAttribute("data-testid")?.trim();
              const dataField = html.getAttribute("data-field")?.trim();
              const aria = html.getAttribute("aria-label")?.trim();
              const name = html.getAttribute("name")?.trim();
              const role = html.getAttribute("role")?.trim() || tag;
              const href = (html as HTMLAnchorElement).href || undefined;
              const safeAttribute = (key: string, value?: string | null) =>
                value && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value)
                  ? `[${key}="${CSS.escape(value)}"]`
                  : "";
              const selector = testId
                ? safeAttribute("data-testid", testId)
                : dataField
                  ? safeAttribute("data-field", dataField)
                  : id && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(id)
                    ? `#${CSS.escape(id)}`
                    : aria
                      ? safeAttribute("aria-label", aria)
                      : name
                        ? safeAttribute("name", name)
                        : tag;
              return {
                tag,
                role,
                label: (
                  aria ||
                  testId ||
                  dataField ||
                  (/^(?:a|button|label|h1|h2|h3)$/.test(tag)
                    ? html.innerText || html.textContent || ""
                    : "")
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 160),
                selector,
                href,
              };
            })
          );
      const raw = await readControls();
      const controls: BrowserDiscoveryControl[] = [];
      const appendControls = async (
        discovered: typeof raw,
        sourcePageUrl: string
      ) => {
        for (const item of discovered) {
          let href: string | undefined;
          if (item.href) {
            try {
              const authorised = await assertAuthorisedConnectionUrl({
                organisationId: input.connection.organisationId,
                connectedSystemId: input.connection.id,
                rawUrl: item.href,
              });
              href = `${authorised.origin}${authorised.pathname}`;
            } catch {
              continue;
            }
          }
          if (!item.label && !href) continue;
          controls.push({ ...item, href, pageUrl: sourcePageUrl });
        }
      };
      const initialPageUrl =
        new URL(page.url()).origin + new URL(page.url()).pathname;
      await appendControls(raw, initialPageUrl);
      const destinations = Array.from(
        new Set(
          controls
            .map(control => control.href)
            .filter((href): href is string => Boolean(href))
        )
      )
        .filter(
          href =>
            href !== initialPageUrl &&
            !/(?:logout|log-out|signout|sign-out|delete|remove|unsubscribe|execute|run-workflow)/i.test(
              new URL(href).pathname
            )
        )
        .slice(0, 12);
      for (const destination of destinations) {
        if (controls.length >= 250) break;
        await authorizeNavigation(input.connection, destination);
        await page.goto(destination, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
        await authorizeNavigation(input.connection, page.url());
        const sourcePageUrl =
          new URL(page.url()).origin + new URL(page.url()).pathname;
        await appendControls(await readControls(), sourcePageUrl);
      }
      return {
        pageUrl: initialPageUrl,
        controls: controls.slice(0, 250),
        readOnly: true as const,
      };
    }
  );
}
async function runOperation(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  provider: string;
  operation: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  allowTestReady?: boolean;
  publishByUserId?: number;
}) {
  const profile = await resolveBrowserProfile(
    input.connection,
    input.provider as Extract<CrmProvider, "genie" | "custom_browser">
  );
  if (!profile)
    throw new Error(
      "This browser CRM has no calibrated connector profile. Add a reviewed browser profile before verification."
    );
  const operationKey =
    ADAPTER_OPERATION_KEYS[input.operation] || input.operation;
  const catalogue = BROWSER_OPERATION_CATALOGUE.find(
    item => item.key === operationKey
  );
  let learned:
    | Awaited<ReturnType<typeof requireRuntimeBrowserOperation>>
    | undefined;
  try {
    learned = await requireRuntimeBrowserOperation({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey,
      allowTestReady: input.allowTestReady,
    });
  } catch (error) {
    if (catalogue?.mode !== "read") throw error;
    const legacy = operationScript(profile, input.operation);
    if (!legacy) throw error;
  }
  const payload = { ...(input.payload || {}) };
  const script =
    learned?.definition.execute || operationScript(profile, input.operation);
  if (!script) {
    const detail = `OPERATION_NOT_LEARNED: '${operationKey}' has no deterministic definition.`;
    if (learned)
      await recordLearnedRuntimeFailure({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        correlationId: input.correlationId,
        detail,
      });
    throw new Error(detail);
  }
  const runScript = (
    page: Page,
    selected: SavedBrowserScript,
    suffix: string
  ) =>
    executeSavedBrowserScript({
      page,
      script: selected,
      inputs: payload,
      artifactDirectory: artifactDirectory(profile, input.connection),
      artifactPrefix: `${input.provider}-${operationKey}-${suffix}`,
      authorizeNavigation: url => authorizeNavigation(input.connection, url),
    });
  let acquiredControl = false;
  try {
    acquireAiBrowserControl({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      userId: 0,
    });
    acquiredControl = true;
    const result = await withPage(
      input.connection,
      input.secret,
      input.provider,
      profile,
      async page => {
        let guardian: ReturnType<typeof verifyBrowserTarget> | undefined;
        if (learned?.definition.mode === "write") {
          const targetRead = await runScript(
            page,
            learned.definition.targetRead!,
            "target"
          );
          if (!targetRead.success)
            throw new Error(`TARGET_VERIFICATION_FAILED: ${targetRead.detail}`);
          const rawTargets =
            targetRead.data.targets ||
            targetRead.data.target ||
            targetRead.data.records;
          const parsed = rawTargets
            ? (JSON.parse(rawTargets) as unknown)
            : [targetRead.data];
          const candidates = (Array.isArray(parsed) ? parsed : [parsed])
            .filter(isObject)
            .map(item => item as BrowserTargetIdentity);
          const destination =
            typeof payload.to === "string" ? payload.to.trim() : "";
          const expected = Object.fromEntries(
            Object.entries({
              externalId: payload.externalId || payload.contactExternalId,
              taskId: payload.taskExternalId,
              opportunityId: payload.opportunityExternalId,
              name: payload.contactName || payload.name || payload.leadLabel,
              email:
                payload.email || (destination.includes("@") ? destination : ""),
              phone:
                payload.phone || (destination.includes("@") ? "" : destination),
              company: payload.company,
            }).filter(([, value]) => typeof value === "string" && value.trim())
          ) as BrowserTargetIdentity;
          guardian =
            learned.targetAssertions.mode === "must_not_exist"
              ? verifyBrowserCreateTarget(expected, candidates)
              : verifyBrowserTarget(expected, candidates);
          if (!guardian.ok)
            throw new Error(`${guardian.code}: ${guardian.detail}`);
          if (browserShadowMode(input.connection.configuration))
            return {
              success: true,
              completedAt: new Date().toISOString(),
              detail:
                "SHADOW_MODE: target verified; external write was not executed.",
              data: { shadowMode: "true", guardian: JSON.stringify(guardian) },
              screenshotPath: targetRead.screenshotPath,
            };
        }
        const execution = await runScript(page, script, "execute");
        if (!execution.success) throw new Error(execution.detail);
        if (learned?.definition.mode === "write") {
          const readback = await runScript(
            page,
            learned.definition.postconditionRead!,
            "postcondition"
          );
          if (!readback.success)
            throw new Error(`EXECUTION_UNVERIFIED: ${readback.detail}`);
          const verification = verifyBrowserPostconditions(
            learned.postconditionAssertions,
            readback.data,
            payload
          );
          if (!verification.ok)
            throw new Error(
              `EXECUTION_UNVERIFIED: ${verification.failures.join(" ")}`
            );
          execution.data.guardian = JSON.stringify(guardian);
          execution.data.postcondition = JSON.stringify(verification);
          if (readback.screenshotPath)
            execution.screenshotPath = readback.screenshotPath;
        }
        return execution;
      }
    );
    if (!result.success) throw new Error(result.detail);
    if (learned)
      await recordBrowserOperationResult({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        success: true,
        publishByUserId: input.publishByUserId,
        evidence: {
          correlationId: input.correlationId,
          completedAt: result.completedAt,
          targetVerified: learned.definition.mode === "write",
          postconditionVerified:
            learned.definition.mode === "write" &&
            result.data.shadowMode !== "true",
          shadowMode: result.data.shadowMode === "true",
          screenshotPath: result.screenshotPath,
        },
      });
    return {
      result,
      profile: {
        ...profile,
        resultKeys: {
          ...(profile.resultKeys || {}),
          [input.operation]:
            learned?.definition.resultKey ||
            profile.resultKeys?.[input.operation] ||
            "records",
        },
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (learned)
      await recordLearnedRuntimeFailure({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        correlationId: input.correlationId,
        detail,
      });
    throw error;
  } finally {
    if (acquiredControl)
      releaseBrowserControl({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        userId: 0,
      });
  }
}

export async function testLearnedBrowserOperation(input: {
  connection: AdapterConnection;
  secret?: ConnectionSecretPayload;
  provider: Extract<CrmProvider, "genie" | "custom_browser">;
  operationKey: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  publishByUserId?: number;
}) {
  const secret = await browserSecret(input.connection, input.secret);
  const result = await runOperation({
    ...input,
    secret,
    operation: input.operationKey,
    allowTestReady: true,
  });
  if (result.result.data.shadowMode === "true" && input.publishByUserId)
    throw new Error(
      "A shadow-mode replay cannot publish an operation as LIVE_PROVEN because no external write occurred."
    );
  if (input.publishByUserId) {
    const learned = await requireRuntimeBrowserOperation({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey: input.operationKey,
      allowTestReady: true,
    });
    await recordBrowserOperationResult({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey: input.operationKey,
      version: learned.version,
      success: true,
      publishByUserId: input.publishByUserId,
      evidence: {
        correlationId: input.correlationId,
        completedAt: result.result.completedAt,
        controlledReplay: true,
        targetVerified: learned.definition.mode === "write",
        postconditionVerified: learned.definition.mode === "write",
        screenshotPath: result.result.screenshotPath,
      },
    });
  }
  return evidence(input.operationKey, input.correlationId, result.result);
}
function evidence(
  operation: string,
  correlationId: string,
  result: {
    completedAt: string;
    data: Record<string, string>;
    screenshotPath?: string;
  }
): AdapterEvidence {
  return {
    operation,
    correlationId,
    completedAt: result.completedAt,
    providerResult: { data: result.data },
    screenshotPath: result.screenshotPath,
  };
}
function rows(
  result: { data: Record<string, string> },
  profile: BrowserProfile,
  operation: string
) {
  const key = profile.resultKeys?.[operation] || "records";
  const raw = result.data[key];
  if (!raw) return [] as Array<Record<string, string>>;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed))
    throw new Error(
      `Browser connector '${operation}' did not return an array in result key '${key}'.`
    );
  return parsed
    .filter(isObject)
    .map(item =>
      Object.fromEntries(
        Object.entries(item).map(([field, value]) => [
          field,
          String(value ?? ""),
        ])
      )
    );
}
function asDate(value?: string) {
  if (!value) return undefined;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result;
}
function asMinor(value?: string) {
  const number = Number(value);
  return value && Number.isFinite(number)
    ? Math.round(number * 100)
    : undefined;
}
function externalId(row: Record<string, string>, resource: string) {
  const value = (row.externalId || row.id || "").trim();
  if (!value)
    throw new Error(
      `INVALID_EXTERNAL_ID: Genie ${resource} extraction returned a row without an external record ID.`
    );
  return value;
}
function contact(row: Record<string, string>): NormalizedContact {
  return {
    externalId: externalId(row, "contact"),
    companyExternalId: row.companyExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    email: row.email?.trim().toLowerCase() || undefined,
    phone: row.phone?.trim() || undefined,
    lifecycleStage: row.lifecycleStage || row.status || undefined,
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function company(row: Record<string, string>): NormalizedCompany {
  return {
    externalId: externalId(row, "company"),
    name: row.name || "Unnamed company",
    website: row.website || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function opportunity(row: Record<string, string>): NormalizedOpportunity {
  return {
    externalId: externalId(row, "opportunity"),
    companyExternalId: row.companyExternalId || undefined,
    contactExternalId: row.contactExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    name: row.name || "Unnamed opportunity",
    pipeline: row.pipeline || undefined,
    stage: row.stage || undefined,
    valueMinor: asMinor(row.value),
    currency: row.currency || undefined,
    closeAt: asDate(row.closeAt),
    lastActivityAt: asDate(row.lastActivityAt),
    nextStepAt: asDate(row.nextStepAt),
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function task(row: Record<string, string>): NormalizedTask {
  return {
    externalId: externalId(row, "task or Manual Action"),
    contactExternalId: row.contactExternalId || undefined,
    opportunityExternalId: row.opportunityExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    title: row.title || "Task",
    status: row.status || "open",
    dueAt: asDate(row.dueAt),
    completedAt: asDate(row.completedAt),
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: { ...row, sourceKind: row.sourceKind || row.type || "task" },
  };
}
function activity(row: Record<string, string>): NormalizedActivity {
  return {
    externalId: externalId(row, "activity"),
    contactExternalId: row.contactExternalId || undefined,
    opportunityExternalId: row.opportunityExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    activityType: row.activityType || row.type || "activity",
    occurredAt: asDate(row.occurredAt) || new Date(),
    body: row.body || undefined,
    sourceRevision: row.sourceRevision || undefined,
    raw: row,
  };
}
export const normalizeBrowserContactRow = contact;
export const normalizeBrowserCompanyRow = company;
export const normalizeBrowserOpportunityRow = opportunity;
export const normalizeBrowserTaskRow = task;
export const normalizeBrowserActivityRow = activity;
async function messageOperation(
  operation: "sendEmail" | "sendSms" | "sendWhatsApp",
  input: OutboundMessageInput,
  provider: string
) {
  const execution = await runOperation({
    connection: input.connection,
    secret: input.secret,
    provider,
    operation,
    correlationId: input.correlationId,
    payload: {
      to: input.to,
      subject: input.subject || "",
      body: input.body,
      message: input.body,
      templateName: input.templateName || "",
      contactExternalId: input.contactExternalId || "",
      opportunityExternalId: input.opportunityExternalId || "",
    },
  });
  return evidence(operation, input.correlationId, execution.result);
}

export function browserCrmAdapter(
  provider: Extract<CrmProvider, "genie" | "custom_browser">
): CrmAdapter {
  const testConnection = async (input: {
    connection: AdapterConnection;
    secret?: ConnectionSecretPayload;
    correlationId: string;
  }): Promise<ConnectionTest> => {
    try {
      const profile = await resolveBrowserProfile(input.connection, provider);
      if (!profile)
        throw new Error(
          "No calibrated browser connector profile is configured."
        );
      const secret = await browserSecret(input.connection, input.secret);
      const authenticationRequired = true;
      if (
        !secret.browserSession ||
        !isBrowserSessionPackage(secret.browserSession)
      )
        throw new Error("Your CRM needs you to sign in again.");
      let authenticatedUrl = "";
      await withPage(
        input.connection,
        secret,
        provider,
        profile,
        async page => {
          if (authenticationRequired) {
            authenticatedUrl = page.url();
            await authorizeNavigation(input.connection, authenticatedUrl);
          }
        }
      );
      const requested = Array.from(
        new Set([
          ...input.connection.allowedReadCapabilities,
          ...input.connection.allowedWriteCapabilities,
        ])
      );
      const matrix = await browserOperationReadinessForSystem({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
      });
      const readiness = new Map(
        matrix.capabilities.map(item => [item.capability, item])
      );
      const capabilities = requested
        .filter(
          (value): value is CrmCapability => value in CAPABILITY_OPERATIONS
        )
        .map(capability => {
          const result = readiness.get(capability);
          const available = result?.state === "FULL";
          return {
            capability,
            available,
            detail: available
              ? "Every required deterministic operation is LIVE_PROVEN."
              : result?.state === "LIMITED"
                ? `Limited: missing LIVE_PROVEN operations ${result.missingOperations.join(", ")}.`
                : "No complete LIVE_PROVEN operation set exists for this capability.",
          } satisfies CapabilityResult;
        });
      const available = capabilities.filter(item => item.available);
      return {
        status:
          available.length === capabilities.length && capabilities.length
            ? "ready"
            : "limited",
        summary: `${authenticationRequired ? "Browser authentication was confirmed" : "The credentialless browser runtime was confirmed"}. ${available.length} of ${capabilities.length} requested browser CRM capabilities have complete LIVE_PROVEN operation sets.`,
        capabilities,
        evidence: [
          {
            operation: "browser_connector_health",
            correlationId: input.correlationId,
            completedAt: new Date().toISOString(),
            providerResult: {
              cdpReachable: true,
              authorisedDestinationReachable: authenticationRequired
                ? true
                : undefined,
              approvedSessionAvailable: Boolean(secret.browserSession),
              authenticationConfirmed: authenticationRequired,
              authenticatedHostname: authenticatedUrl
                ? new URL(authenticatedUrl).hostname
                : undefined,
              learnedOperationReadinessInspected: true,
              configuredOperations: Object.keys(
                profile.operationMap || profile.scripts
              ),
            },
          },
        ],
      };
    } catch (error) {
      return {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        capabilities: [],
        evidence: [
          {
            operation: "browser_connector_health",
            correlationId: input.correlationId,
            completedAt: new Date().toISOString(),
            errorClassification: "authentication",
            retryable: false,
          },
        ],
      };
    }
  };
  const list = async <T>(
    operation: string,
    mapper: (row: Record<string, string>) => T,
    input: {
      connection: AdapterConnection;
      secret: ConnectionSecretPayload;
      cursor?: string;
    }
  ) => {
    const execution = await runOperation({
      connection: input.connection,
      secret: input.secret,
      provider,
      operation,
      correlationId: `sync-${operation}`,
      payload: { cursor: input.cursor || "" },
    });
    return {
      records: rows(execution.result, execution.profile, operation).map(mapper),
      cursor: execution.result.data.nextCursor || undefined,
    };
  };
  return {
    provider,
    disconnect: async input => ({
      operation: "disconnect",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: { localBrowserCredentialsCanBeRemoved: true },
    }),
    refreshAuthentication: async input => input.secret,
    testConnection,
    discoverCapabilities: async input =>
      (await testConnection(input)).capabilities,
    syncContacts: input => list("syncContacts", contact, input),
    syncCompanies: input => list("syncCompanies", company, input),
    syncOpportunities: input => list("syncOpportunities", opportunity, input),
    syncTasks: input => list("syncTasks", task, input),
    syncActivities: input => list("syncActivities", activity, input),
    searchContacts: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "searchContacts",
        correlationId: "search-contacts",
        payload: { query: input.query, leadLabel: input.query },
      });
      const extracted = rows(
        execution.result,
        execution.profile,
        "searchContacts"
      );
      if (extracted.length) return extracted.map(contact);
      return [
        {
          externalId: input.query,
          firstName: input.query,
          raw: {
            browserText: Object.values(execution.result.data)
              .join("\n")
              .slice(0, 20_000),
          },
        },
      ];
    },
    getContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getContact",
        correlationId: "get-contact",
        payload: { externalId: input.externalId, leadLabel: input.externalId },
      });
      const extracted = rows(execution.result, execution.profile, "getContact");
      return extracted[0]
        ? contact(extracted[0])
        : {
            externalId: input.externalId,
            raw: {
              browserText: Object.values(execution.result.data)
                .join("\n")
                .slice(0, 20_000),
            },
          };
    },
    getCompany: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getCompany",
        correlationId: "get-company",
        payload: { externalId: input.externalId },
      });
      const extracted = rows(execution.result, execution.profile, "getCompany");
      return extracted[0] ? company(extracted[0]) : null;
    },
    getOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getOpportunity",
        correlationId: "get-opportunity",
        payload: { externalId: input.externalId },
      });
      const extracted = rows(
        execution.result,
        execution.profile,
        "getOpportunity"
      );
      return extracted[0] ? opportunity(extracted[0]) : null;
    },
    createContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createContact",
        payload: input.fields,
      });
      return evidence("create_contact", input.correlationId, execution.result);
    },
    createCompany: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createCompany",
        payload: input.fields,
      });
      return evidence("create_company", input.correlationId, execution.result);
    },
    createOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createOpportunity",
        payload: input.fields,
      });
      return evidence(
        "create_opportunity",
        input.correlationId,
        execution.result
      );
    },
    createNote: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createNote",
        payload: {
          externalId: input.externalId,
          content: input.body,
          body: input.body,
          note: input.body,
        },
      });
      return evidence("create_note", input.correlationId, execution.result);
    },
    createTask: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createTask",
        payload: {
          title: input.title,
          taskTitle: input.title,
          dueAt: input.dueAt || "",
          contactExternalId: input.contactExternalId || "",
          opportunityExternalId: input.opportunityExternalId || "",
        },
      });
      return evidence("create_task", input.correlationId, execution.result);
    },
    completeTask: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "completeTask",
        payload: {
          externalId: input.externalId,
          taskExternalId: input.externalId,
        },
      });
      return evidence("complete_task", input.correlationId, execution.result);
    },
    updateContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "updateContact",
        payload: { externalId: input.externalId, ...input.patch },
      });
      return evidence("update_contact", input.correlationId, execution.result);
    },
    updateOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "updateOpportunity",
        payload: { externalId: input.externalId, ...input.patch },
      });
      return evidence(
        "update_opportunity",
        input.correlationId,
        execution.result
      );
    },
    createActivity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createActivity",
        payload: input.activity,
      });
      return evidence("create_activity", input.correlationId, execution.result);
    },
    sendEmail: input => messageOperation("sendEmail", input, provider),
    sendSms: input => messageOperation("sendSms", input, provider),
    sendWhatsApp: input => messageOperation("sendWhatsApp", input, provider),
    applySequence: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "applySequence",
        payload: { externalId: input.externalId, sequence: input.sequence },
      });
      return evidence("apply_sequence", input.correlationId, execution.result);
    },
    executeCustomAction: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: input.actionName,
        payload: input.payload,
      });
      return evidence(input.actionName, input.correlationId, execution.result);
    },
    listPipelines: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "listPipelines",
        correlationId: "list-pipelines",
        payload: {},
      });
      return rows(execution.result, execution.profile, "listPipelines").map(
        row => ({
          externalId: row.externalId || row.id,
          label: row.label || row.name || "Pipeline",
          stages: [],
        })
      );
    },
    healthCheck: testConnection,
  };
}
