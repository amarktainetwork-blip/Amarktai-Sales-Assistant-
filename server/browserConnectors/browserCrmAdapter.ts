import { readGenieContactHistory } from "./genieContactHistory";
import { readOwnerScopedGenieOpportunities } from "./genieOpportunityScope";
import { genieTaskCompletion } from "./genieTaskCompletion";
import { readOwnerScopedGenieTasks } from "./genieTaskScope";
import { readFile } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
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
  latestBrowserOperation,
  recordBrowserOperationResult,
  requireRuntimeBrowserOperation,
} from "./learnedOperations";
import {
  ADAPTER_OPERATION_KEYS,
  BROWSER_OPERATION_CATALOGUE,
  verifyBrowserCreateTarget,
  verifyBrowserPostconditions,
  verifyBrowserReadProof,
  verifyBrowserTarget,
  type BrowserTargetIdentity,
} from "./operationContracts";
import { recordLearnedRuntimeFailure } from "./runtimeFailure";
import {
  createContextWithBrowserSession,
  findBrowserSessionPage,
  isBrowserSessionPackage,
} from "./browserSession";
import {
  acquireAiBrowserControl,
  assertBrowserOperationCanRun,
  releaseBrowserControl,
} from "./browserControlArbitration";
import { connectManagedCrmBrowser } from "./managedCrmBrowserSessionManager";
import {
  currentModelSpendBoundary,
  runModelFreeOperation,
} from "../aiExecutionBoundary";
import {
  GENIE_PROVIDER_PACK,
  GENIE_PROVIDER_PACK_VERSION,
} from "../crm/providerPacks";
import { executeOwnerScopedGenieContactRead } from "./genieContactScope";

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

export function mergeGenieOperationDefinitions(
  current: BrowserProfile["operationDefinitions"],
  installed: BrowserProfile["operationDefinitions"]
) {
  const merged: NonNullable<BrowserProfile["operationDefinitions"]> = {
    ...(installed || {}),
  };
  for (const [operationKey, canonical] of Object.entries(current || {})) {
    const legacy = installed?.[operationKey];
    const prerequisites =
      legacy?.prerequisites &&
      typeof legacy.prerequisites === "object" &&
      !Array.isArray(legacy.prerequisites)
        ? legacy.prerequisites
        : {};
    const isInstalledKnownPack = prerequisites.knownGeniePack === true;
    const isCurrentInstalledPack =
      prerequisites.providerPack === "genie" &&
      prerequisites.providerPackVersion === GENIE_PROVIDER_PACK_VERSION;
    if (!legacy || (isInstalledKnownPack && !isCurrentInstalledPack))
      merged[operationKey] = canonical;
  }
  return merged;
}

export async function resolveBrowserProfile(
  connection: AdapterConnection,
  provider: Extract<CrmProvider, "genie" | "custom_browser">
) {
  const configured = asProfile(connection.configuration.browserProfile);
  if (provider === "genie") {
    const installed = await genieProfile();
    const providerPack = GENIE_PROVIDER_PACK;
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
        scripts: {
          ...providerPack.scripts,
          ...(installed?.scripts || {}),
          ...configured.scripts,
        },
        operationMap: {
          ...(installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP),
          ...(configured.operationMap || {}),
        },
        operationDefinitions: {
          ...mergeGenieOperationDefinitions(
            providerPack.operationDefinitions,
            installed?.operationDefinitions
          ),
          ...(configured.operationDefinitions || {}),
        },
        resultKeys: {
          ...(providerPack.resultKeys || {}),
          ...(installed?.resultKeys || {}),
          ...(configured.resultKeys || {}),
        },
      } satisfies BrowserProfile;
    if (connection.baseUrl)
      return {
        browserEndpoint:
          installed?.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT,
        login: { url: connection.baseUrl },
        scripts: { ...providerPack.scripts, ...(installed?.scripts || {}) },
        operationMap: installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP,
        resultKeys: {
          ...(providerPack.resultKeys || {}),
          ...(installed?.resultKeys || {}),
        },
        operationDefinitions: mergeGenieOperationDefinitions(
          providerPack.operationDefinitions,
          installed?.operationDefinitions
        ),
        artifactDirectory: installed?.artifactDirectory,
      } satisfies BrowserProfile;
    if (installed)
      return {
        ...installed,
        scripts: { ...providerPack.scripts, ...installed.scripts },
        resultKeys: {
          ...(providerPack.resultKeys || {}),
          ...(installed.resultKeys || {}),
        },
        operationDefinitions: mergeGenieOperationDefinitions(
          providerPack.operationDefinitions,
          installed.operationDefinitions
        ),
      };
  }
  if (configured) return configured;
  return connection.baseUrl
    ? { browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT, scripts: {} }
    : undefined;
}
async function browserSecret(
  _connection: AdapterConnection,
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
  run: (
    page: Page,
    context: BrowserContext,
    owner: Parameters<typeof assertBrowserOperationCanRun>[0]
  ) => Promise<T>
) {
  const userId = Number(
    secret.browserUserId || secret.commissioningUserId || 0
  );
  if (!Number.isInteger(userId) || userId <= 0)
    throw new Error(
      "CRM_BROWSER_IDENTITY_OWNER_REQUIRED: reopen the Secure CRM Browser to restore its existing owner identity."
    );
  const scope = {
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
    userId,
  };
  const owner = { ...scope, ...acquireAiBrowserControl(scope) };
  try {
    assertBrowserOperationCanRun(owner);
    const browser: Browser = await connect(profile);
    if (
      !secret.browserSession ||
      !isBrowserSessionPackage(secret.browserSession)
    )
      throw new Error("Your CRM needs you to sign in again.");

    const recovered = await findBrowserSessionPage({
      browser,
      browserSession: secret.browserSession,
      organisationId: connection.organisationId,
      connectedSystemId: connection.id,
      authorise: url => authorizeNavigation(connection, url),
      allowSameScopedPageRecovery: provider === "genie",
    });

    if (recovered) {
      const { page, context } = recovered;
      let blocked: BlockedNavigation | undefined;
      const routeHandler = async (route: Route) => {
        const request = route.request();
        if (
          !request.isNavigationRequest() ||
          request.frame() !== page.mainFrame()
        )
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
      };
      await page.route("**/*", routeHandler);
      try {
        await authorizeNavigation(connection, page.url());
        if (blocked)
          throw new Error(
            "Your CRM redirected to a new sign-in service. A manager needs to approve it."
          );
        assertBrowserOperationCanRun(owner);
        return await run(page, context, owner);
      } finally {
        await page.unroute("**/*", routeHandler).catch(() => undefined);
      }
    }

    // Genie is proven to bind authentication to the live page/client state. A
    // new page, even in the same BrowserContext, returns user_not_logged_in. Do
    // not misclassify that as selector drift or burn AI trying to relearn it.
    if (provider === "genie")
      throw new Error(
        "CRM_BROWSER_REAUTHENTICATION_REQUIRED: reopen the Secure CRM Browser and sign in once so autonomous actions can attach to the commissioned Genie tab."
      );

    // Custom browser connectors may still support ordinary storage-state replay.
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
      if (
        !request.isNavigationRequest() ||
        request.frame() !== page.mainFrame()
      )
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
      assertBrowserOperationCanRun(owner);
      return await run(page, context, owner);
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    releaseBrowserControl(owner);
  }
}

export async function withAuthenticatedBrowserSessionPage<T>(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  provider: Extract<CrmProvider, "genie" | "custom_browser">;
  run: (
    page: Page,
    context: BrowserContext,
    assertControl: () => void
  ) => Promise<T>;
}) {
  const profile = await resolveBrowserProfile(input.connection, input.provider);
  if (!profile)
    throw new Error("No browser connector profile is available for this CRM.");
  const secret = await browserSecret(input.connection, input.secret);
  return withPage(
    input.connection,
    secret,
    input.provider,
    profile,
    async (page, context, owner) =>
      input.run(page, context, () => assertBrowserOperationCanRun(owner))
  );
}

export type BrowserDiscoveryControl = {
  tag: string;
  role: string;
  label: string;
  selector: string;
  href?: string;
  pageUrl?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  fieldId?: string;
  pageTitle?: string;
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
    async (page, _context, owner) => {
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
            "nav a, aside a, [role='navigation'] a, button, input, textarea, select, [data-testid], [data-field], [role='button'], [role='tab'], label"
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
                  (/^(?:a|button|label)$/.test(tag)
                    ? html.innerText || html.textContent || ""
                    : "")
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 160),
                selector,
                href,
                ariaLabel: aria || undefined,
                placeholder:
                  html.getAttribute("placeholder")?.trim().slice(0, 160) ||
                  undefined,
                name: name || undefined,
                fieldId: id || dataField || undefined,
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
      const initialNavigationUrl = page.url();
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
      try {
        for (const destination of destinations) {
          assertBrowserOperationCanRun(owner);
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
      } finally {
        if (page.url() !== initialNavigationUrl) {
          assertBrowserOperationCanRun(owner);
          await authorizeNavigation(input.connection, initialNavigationUrl);
          await page.goto(initialNavigationUrl, {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
        }
      }
      return {
        pageUrl: initialPageUrl,
        controls: controls.slice(0, 250),
        readOnly: true as const,
      };
    }
  );
}
export function isRetryableReadBrowserFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /(?:Timeout \d+ms exceeded|waiting for locator|Element is not attached|locator\.(?:waitFor|click|innerText|getAttribute|allTextContents))/i.test(
    detail
  );
}

const GENIE_TASK_GRID_PATH = "/objects/task/records/search";
const GENIE_TASK_GRID_HOST = "services.leadconnectorhq.com";

function scalarText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!isObject(value)) return "";
  for (const key of ["value", "label", "name", "text"]) {
    const nested = scalarText(value[key]);
    if (nested) return nested;
  }
  return "";
}

function identityText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = identityText(item);
      if (nested) return nested;
    }
    return "";
  }
  if (!isObject(value)) return "";
  for (const key of [
    "id",
    "recordId",
    "externalId",
    "userId",
    "ownerId",
    "contactId",
  ]) {
    const nested = identityText(value[key]);
    if (nested) return nested;
  }
  return "";
}

function contactIdentityFromRelations(value: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = contactIdentityFromRelations(item, depth + 1);
      if (nested) return nested;
    }
    return "";
  }
  if (!isObject(value)) return "";
  for (const [key, child] of Object.entries(value)) {
    if (/contact/i.test(key)) {
      const nested = identityText(child);
      if (nested) return nested;
    }
  }
  const objectKey = scalarText(
    value.objectKey || value.relationKey || value.associationKey || value.type
  );
  if (/contact/i.test(objectKey)) {
    const nested = identityText(value);
    if (nested) return nested;
  }
  for (const child of Object.values(value)) {
    const nested = contactIdentityFromRelations(child, depth + 1);
    if (nested) return nested;
  }
  return "";
}

export function normalizeGenieTaskGridPage(value: unknown) {
  if (!isObject(value) || !Array.isArray(value.customObjectRecords))
    throw new Error(
      "GENIE_TASK_GRID_INVALID: Tasks grid returned no structured record collection."
    );
  const topRelations = Array.isArray(value.topRelations)
    ? value.topRelations.filter(isObject)
    : [];
  const relationByTaskId = new Map(
    topRelations
      .map(item => [identityText(item.recordId), item] as const)
      .filter(([recordId]) => Boolean(recordId))
  );
  const records = value.customObjectRecords.map((raw, index) => {
    if (!isObject(raw))
      throw new Error(
        `GENIE_TASK_GRID_INVALID: task record ${index + 1} was not structured.`
      );
    const externalId = identityText(raw.id);
    if (!externalId)
      throw new Error(
        `INVALID_EXTERNAL_ID: Genie task grid record ${index + 1} had no immutable ID.`
      );
    const properties = isObject(raw.properties) ? raw.properties : {};
    const relation = relationByTaskId.get(externalId);
    const contactExternalId =
      contactIdentityFromRelations(raw.relations) ||
      contactIdentityFromRelations(relation?.associations);
    return {
      externalId,
      title:
        scalarText(properties.title) || scalarText(properties.name) || "Task",
      description: scalarText(properties.description),
      ...genieTaskCompletion(properties),
      dueAt:
        scalarText(properties.dueDate) ||
        scalarText(properties.dueAt) ||
        scalarText(properties.due_date),

      contactExternalId,
      ownerExternalId: identityText(raw.owners),
      sourceUpdatedAt: scalarText(raw.updatedAt),
      sourceRevision: scalarText(raw.updatedAt),
      sourceKind: "task",
    };
  });
  const numericTotal = Number(value.total);
  return {
    records,
    total:
      Number.isFinite(numericTotal) && numericTotal >= 0
        ? numericTotal
        : undefined,
  };
}

function isGenieTaskGridResponse(urlText: string) {
  try {
    const url = new URL(urlText);
    return (
      url.protocol === "https:" &&
      url.hostname === GENIE_TASK_GRID_HOST &&
      url.pathname === GENIE_TASK_GRID_PATH
    );
  } catch {
    return false;
  }
}

export function ownerScopedGenieTaskNavigation(
  script: SavedBrowserScript
): SavedBrowserScript {
  return {
    ...script,
    steps: script.steps.map(step =>
      step.action === "click" &&
      step.selector === "#sb_contacts" &&
      step.fallbackUrl
        ? { action: "goto" as const, value: step.fallbackUrl }
        : step
    ),
  };
}

export function genieTaskGridBodyContainsOwner(
  value: unknown,
  ownerExternalId: string
) {
  const owner = ownerExternalId.trim();
  if (!owner) return true;
  try {
    return JSON.stringify(value).includes(owner);
  } catch {
    return false;
  }
}

export function genieTaskUrlContainsOwnerFilter(
  urlText: string,
  ownerExternalId: string
) {
  const owner = ownerExternalId.trim();
  if (!owner) return false;
  try {
    const quickFilters = new URL(urlText).searchParams.get("quickFilters");
    if (!quickFilters) return false;
    const value = JSON.parse(quickFilters) as unknown;
    const visit = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(visit);
      if (!node || typeof node !== "object") return false;
      const row = node as Record<string, unknown>;
      const field = String(row.field || "")
        .trim()
        .toLowerCase();
      const operator = String(row.operator || "")
        .trim()
        .toLowerCase();
      const filterValue = row.value;
      if (field === "owners" && operator === "eq") {
        if (Array.isArray(filterValue))
          return filterValue.some(item => String(item).trim() === owner);
        return String(filterValue || "").trim() === owner;
      }
      return Object.values(row).some(visit);
    };
    return visit(value);
  } catch {
    return false;
  }
}

async function waitForGenieTaskGridPage(page: Page, ownerExternalId = "") {
  const response = await page.waitForResponse(
    candidate => {
      if (
        candidate.request().method() !== "POST" ||
        !isGenieTaskGridResponse(candidate.url())
      )
        return false;
      if (!ownerExternalId) return true;
      try {
        return genieTaskGridBodyContainsOwner(
          candidate.request().postDataJSON(),
          ownerExternalId
        );
      } catch {
        return false;
      }
    },
    { timeout: 30_000 }
  );
  if (response.status() < 200 || response.status() >= 300)
    throw new Error(
      `GENIE_TASK_GRID_HTTP_ERROR: Tasks grid returned HTTP ${response.status()}.`
    );
  return normalizeGenieTaskGridPage(await response.json());
}

export function isCanonicalGenieTaskGridScript(script: SavedBrowserScript) {
  const canonical = GENIE_PROVIDER_PACK.scripts.genie_task_sync;
  if (!canonical || script.steps.length !== canonical.steps.length)
    return false;
  return script.steps.every((step, index) => {
    const expected = canonical.steps[index];
    return (
      step.action === expected.action &&
      step.selector === expected.selector &&
      step.value === expected.value &&
      step.key === expected.key &&
      step.attribute === expected.attribute &&
      step.nextSelector === expected.nextSelector &&
      step.maxPages === expected.maxPages &&
      JSON.stringify(step.fields || {}) ===
        JSON.stringify(expected.fields || {})
    );
  });
}

export function genieTaskPickerLabelMatches(
  label: string,
  ownerDisplayName: string
) {
  const expected = ownerDisplayName.trim().toLowerCase();
  if (!expected) return false;
  return label
    .split(/\r?\n/)
    .map(part => part.trim().toLowerCase())
    .some(part => part === expected);
}

async function applyGenieTaskOwnerFilter(input: {
  page: Page;
  ownerExternalId: string;
  ownerDisplayName: string;
}) {
  const owner = input.ownerExternalId.trim();
  const displayName = input.ownerDisplayName.trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(owner) || !displayName)
    throw new Error(
      "CRM_OWNER_SCOPE_REQUIRED: Genie task filtering requires the exact mapped salesperson identity."
    );

  const assignee = input.page
    .locator("div.quick-filter.button")
    .filter({ hasText: /^\s*Assignee\s*:/i })
    .first();
  if (!(await assignee.count()) || !(await assignee.isVisible()))
    throw new Error(
      "CRM_OWNER_SCOPE_REQUIRED: Genie task Assignee filter was not available."
    );

  const currentPicker = input.page
    .locator(".hr-popover__content:visible")
    .first();
  if (!(await currentPicker.count())) await assignee.click();

  const candidates = input.page.locator(`[data-id="${owner}"]`);
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const inPicker = await candidate
      .evaluate(element =>
        Boolean(
          element.closest(
            '[role="listbox"],[role="menu"],[role="option"],[role="dialog"],.v-popper__popper,.dropdown-menu,.hr-popover__content,.ui-advanced-select__container'
          )
        )
      )
      .catch(() => false);
    if (!inPicker) continue;
    const label = [
      await candidate.innerText().catch(() => ""),
      (await candidate.getAttribute("title")) || "",
      (await candidate.getAttribute("tooltip")) || "",
      (await candidate.getAttribute("aria-label")) || "",
    ].join("\n");
    if (!genieTaskPickerLabelMatches(label, displayName)) continue;
    await candidate.click();
    return;
  }

  const pickerRows = input.page.locator(
    ".hr-popover__content .item.default:visible"
  );
  const matchingRows: number[] = [];
  for (let index = 0; index < (await pickerRows.count()); index += 1) {
    const row = pickerRows.nth(index);
    if (
      genieTaskPickerLabelMatches(
        await row.innerText().catch(() => ""),
        displayName
      )
    )
      matchingRows.push(index);
  }
  if (matchingRows.length !== 1)
    throw new Error(
      matchingRows.length > 1
        ? "CRM_OWNER_SCOPE_AMBIGUOUS: Genie task Assignee picker contained multiple exact salesperson-name matches."
        : "CRM_OWNER_SCOPE_REQUIRED: Genie task Assignee option did not match the mapped salesperson."
    );
  await pickerRows.nth(matchingRows[0]).click();
}

function assertGenieTaskOwnerPage(
  page: ReturnType<typeof normalizeGenieTaskGridPage>,
  ownerExternalId: string
) {
  if (!ownerExternalId) return page;
  for (const record of page.records) {
    if (!record.ownerExternalId)
      throw new Error(
        "CRM_OWNER_SCOPE_REQUIRED: Genie task search returned a task without immutable owner identity."
      );
    if (record.ownerExternalId !== ownerExternalId)
      throw new Error(
        "CRM_OWNER_SCOPE_VIOLATION: Genie task search returned another salesperson's task."
      );
  }
  return page;
}

async function executeGenieTaskGridRead(input: {
  page: Page;
  script: SavedBrowserScript;
  runScript: (
    page: Page,
    selected: SavedBrowserScript,
    suffix: string
  ) => ReturnType<typeof executeSavedBrowserScript>;
  assertControl: () => void;
  ownerExternalId?: string;
  ownerDisplayName?: string;
}) {
  if (input.ownerExternalId?.trim())
    return readOwnerScopedGenieTasks({
      page: input.page,
      ownerExternalId: input.ownerExternalId.trim(),
      assertControl: input.assertControl,
      normalize: normalizeGenieTaskGridPage,
    });
  const paginateIndex = input.script.steps.findIndex(
    step => step.action === "paginate_rows"
  );
  if (paginateIndex < 0)
    throw new Error(
      "GENIE_TASK_GRID_INVALID: canonical task sync has no bounded pagination step."
    );
  const paginate = input.script.steps[paginateIndex];
  const ownerExternalId = input.ownerExternalId?.trim() || "";
  const baseNavigationScript: SavedBrowserScript = {
    ...input.script,
    steps: input.script.steps.filter((_, index) => index !== paginateIndex),
  };
  const navigationScript = ownerExternalId
    ? ownerScopedGenieTaskNavigation(baseNavigationScript)
    : baseNavigationScript;
  let execution: Awaited<ReturnType<typeof executeSavedBrowserScript>>;
  let firstPage: ReturnType<typeof normalizeGenieTaskGridPage>;

  if (ownerExternalId) {
    execution = await input.runScript(
      input.page,
      navigationScript,
      "execute-owner-navigation"
    );
    if (!execution.success) return execution;
    const firstPagePromise = waitForGenieTaskGridPage(
      input.page,
      ownerExternalId
    );
    if (genieTaskUrlContainsOwnerFilter(input.page.url(), ownerExternalId)) {
      await input.page.reload({
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
    } else {
      await applyGenieTaskOwnerFilter({
        page: input.page,
        ownerExternalId,
        ownerDisplayName: input.ownerDisplayName || "",
      });
    }
    firstPage = assertGenieTaskOwnerPage(
      await firstPagePromise,
      ownerExternalId
    );
  } else {
    const firstPagePromise = waitForGenieTaskGridPage(input.page);
    [execution, firstPage] = await Promise.all([
      input.runScript(input.page, navigationScript, "execute"),
      firstPagePromise,
    ]);
    if (!execution.success) return execution;
  }

  const byId = new Map(
    firstPage.records.map(record => [record.externalId, record] as const)
  );
  const configuredMaxPages = Math.max(
    1,
    Math.min(Number(paginate.maxPages || 1), 100)
  );
  const maxPages = ownerExternalId ? configuredMaxPages : 1;
  const nextSelector = String(paginate.nextSelector || "").trim();
  if (!nextSelector && maxPages > 1)
    throw new Error(
      "GENIE_TASK_GRID_INVALID: canonical task sync has no reviewed next-page selector."
    );

  let ownerDrainComplete = maxPages === 1;
  for (let pageNumber = 1; pageNumber < maxPages; pageNumber += 1) {
    input.assertControl();
    const next = input.page.locator(nextSelector).first();
    if ((await next.count()) === 0) {
      ownerDrainComplete = true;
      break;
    }
    const disabled =
      (await next.isDisabled().catch(() => false)) ||
      (await next.getAttribute("aria-disabled")) === "true" ||
      (await next.getAttribute("disabled")) !== null;
    if (disabled) {
      ownerDrainComplete = true;
      break;
    }
    const nextPagePromise = waitForGenieTaskGridPage(
      input.page,
      ownerExternalId
    );
    const [, rawNextPage] = await Promise.all([next.click(), nextPagePromise]);
    const nextPage = assertGenieTaskOwnerPage(rawNextPage, ownerExternalId);
    if (!nextPage.records.length) {
      ownerDrainComplete = true;
      break;
    }
    for (const record of nextPage.records) byId.set(record.externalId, record);
  }

  if (ownerExternalId && !ownerDrainComplete) {
    const next = input.page.locator(nextSelector).first();
    const stillHasNext =
      (await next.count()) > 0 &&
      !(await next.isDisabled().catch(() => false)) &&
      (await next.getAttribute("aria-disabled")) !== "true" &&
      (await next.getAttribute("disabled")) === null;
    if (stillHasNext)
      throw new Error(
        `CRM_SYNC_PAGE_LIMIT_REACHED: owner-scoped Genie task search still has records after the bounded browser drain (${byId.size} collected).`
      );
  }

  execution.data.records = JSON.stringify(Array.from(byId.values()));
  if (byId.size === 0)
    execution.data.collectionEvidence =
      "Owner-scoped Genie Tasks grid verified zero records.";
  else if (byId.size)
    execution.data.collectionEvidence = ownerExternalId
      ? `Owner-scoped Genie Tasks grid returned ${byId.size} structured record(s).`
      : `Genie Tasks commissioning probe returned ${byId.size} structured record(s).`;
  return execution;
}

type RunOperationInput = {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  provider: string;
  operation: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  allowTestReady?: boolean;
  publishByUserId?: number;
};

async function runOperation(input: RunOperationInput) {
  const result = await runModelFreeOperation(
    {
      purpose: "crm_operation",
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      reference: input.correlationId,
    },
    () => runDeterministicOperation(input)
  );
  result.value.result.data.modelUsed = String(result.evidence.modelUsed);
  result.value.result.data.providerCallCount = String(
    result.evidence.providerCallCount
  );
  return result.value;
}

async function runDeterministicOperation(input: RunOperationInput) {
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
    if (
      await latestBrowserOperation({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
      })
    )
      throw error;
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
  try {
    const executeOnce = () =>
      withPage(
        input.connection,
        input.secret,
        input.provider,
        profile,
        async (page, _context, owner) => {
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
              authorizeNavigation: url =>
                authorizeNavigation(input.connection, url),
              assertControl: () => assertBrowserOperationCanRun(owner),
            });
          let guardian: ReturnType<typeof verifyBrowserTarget> | undefined;
          if (learned?.definition.mode === "write") {
            const targetRead = await runScript(
              page,
              learned.definition.targetRead!,
              "target"
            );
            if (!targetRead.success)
              throw new Error(
                `TARGET_VERIFICATION_FAILED: ${targetRead.detail}`
              );
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
                  payload.email ||
                  (destination.includes("@") ? destination : ""),
                phone:
                  payload.phone ||
                  (destination.includes("@") ? "" : destination),
                company: payload.company,
              }).filter(
                ([, value]) => typeof value === "string" && value.trim()
              )
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
                data: {
                  shadowMode: "true",
                  guardian: JSON.stringify(guardian),
                },
                screenshotPath: targetRead.screenshotPath,
              };
          }
          const ownerExternalId =
            typeof payload.ownerExternalId === "string"
              ? payload.ownerExternalId.trim()
              : "";
          const ownerDisplayName =
            typeof payload.ownerDisplayName === "string"
              ? payload.ownerDisplayName.trim()
              : "";
          const execution =
            input.provider === "genie" &&
            operationKey === "contact.sync" &&
            ownerExternalId
              ? await executeOwnerScopedGenieContactRead({
                  page,
                  script,
                  ownerExternalId,
                  runScript,
                  assertControl: () => assertBrowserOperationCanRun(owner),
                  latestPageOnly: payload.fastPath === true,
                })
              : input.provider === "genie" &&
                  operationKey === "task.sync" &&
                  isCanonicalGenieTaskGridScript(script)
                ? await executeGenieTaskGridRead({
                    page,
                    script,
                    runScript,
                    assertControl: () => assertBrowserOperationCanRun(owner),
                    ownerExternalId,
                    ownerDisplayName,
                  })
                : input.provider === "genie" &&
                    operationKey === "opportunity.sync" &&
                    ownerExternalId
                  ? await readOwnerScopedGenieOpportunities({
                      page,
                      ownerExternalId,
                      assertControl: () => assertBrowserOperationCanRun(owner),
                    })
                  : await runScript(page, script, "execute");
          if (!execution.success) throw new Error(execution.detail);
          execution.data.actualPageUrl = page.url();
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
    let result;
    try {
      result = await executeOnce();
    } catch (error) {
      const readOnly = (learned?.definition.mode || catalogue?.mode) === "read";
      if (!readOnly || !isRetryableReadBrowserFailure(error)) throw error;
      result = await executeOnce();
    }
    if (!result.success) throw new Error(result.detail);
    const readProof =
      learned?.definition.mode === "read" && input.publishByUserId
        ? verifyBrowserReadProof({
            operationKey,
            data: result.data,
            payload,
          })
        : undefined;
    if (readProof && !readProof.ok)
      throw new Error(`${readProof.code}: ${readProof.detail}`);
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
          modelUsed:
            currentModelSpendBoundary()?.mode === "forbid" ? false : undefined,
          providerCallCount: currentModelSpendBoundary()?.providerCallAttempts,
          completedAt: result.completedAt,
          targetVerified: learned.definition.mode === "write",
          postconditionVerified:
            learned.definition.mode === "write" &&
            result.data.shadowMode !== "true",
          structuredReadVerified: readProof?.ok,
          readProofCode: readProof?.code,
          shadowMode: result.data.shadowMode === "true",
          screenshotPath: result.screenshotPath,
          ownerExternalId: result.data.ownerExternalId,
          sourceTotal: result.data.sourceTotal,
          pagesRead: result.data.pagesRead,
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
  if (!raw)
    throw new Error(
      `STRUCTURED_RESULT_REQUIRED: ${operation} did not return its records result.`
    );
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
function sourceRecordId(value?: string) {
  const raw = (value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://crm.invalid");
    for (const key of ["id", "contactId", "contact_id", "recordId"]) {
      const candidate = url.searchParams.get(key);
      if (candidate) return candidate;
    }
    const pathname = url.pathname.replace(/\/+$/, "");
    const last = pathname.split("/").filter(Boolean).at(-1);
    if (last && last !== "crm.invalid") return decodeURIComponent(last);
  } catch {
    // Preserve non-URL immutable provider identifiers exactly.
  }
  return raw;
}

function externalId(row: Record<string, string>, resource: string) {
  const value = sourceRecordId(row.externalId || row.id);
  if (!value)
    throw new Error(
      "INVALID_EXTERNAL_ID: Genie " +
        resource +
        " extraction returned a row without an external record ID."
    );
  return value;
}
function contact(row: Record<string, string>): NormalizedContact {
  const nameParts = (row.name || "").trim().split(/\s+/).filter(Boolean);
  return {
    externalId: externalId(row, "contact"),
    companyExternalId: sourceRecordId(row.companyExternalId) || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    firstName: row.firstName || nameParts[0] || undefined,
    lastName: row.lastName || nameParts.slice(1).join(" ") || undefined,
    email: row.email?.trim().toLowerCase() || undefined,
    phone: row.phone?.trim() || undefined,
    lifecycleStage: row.lifecycleStage || row.status || undefined,
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: {
      ...row,
      normalizedCustomerContext: row.normalizedCustomerContext
        ? JSON.parse(row.normalizedCustomerContext)
        : undefined,
    },
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
    companyExternalId: sourceRecordId(row.companyExternalId) || undefined,
    contactExternalId: sourceRecordId(row.contactExternalId) || undefined,
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
    contactExternalId: sourceRecordId(row.contactExternalId) || undefined,
    opportunityExternalId:
      sourceRecordId(row.opportunityExternalId) || undefined,
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
    contactExternalId: sourceRecordId(row.contactExternalId) || undefined,
    opportunityExternalId:
      sourceRecordId(row.opportunityExternalId) || undefined,
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
    },
    extraPayload: Record<string, unknown> = {},
    verification: {
      allowTestReady?: boolean;
      publishByUserId?: number;
    } = {}
  ) => {
    const execution = await runOperation({
      connection: input.connection,
      secret: input.secret,
      provider,
      operation,
      correlationId: `sync-${operation}`,
      allowTestReady: verification.allowTestReady,
      publishByUserId: verification.publishByUserId,
      payload: {
        cursor: input.cursor || "",
        ownerExternalId: input.secret.crmUserExternalId || "",
        ownerDisplayName: input.secret.crmUserDisplayName || "",
        ...extraPayload,
      },
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
    ...(provider === "genie"
      ? {
          readContactHistory: async (input: {
            connection: AdapterConnection;
            secret: ConnectionSecretPayload;
            externalId: string;
          }) => {
            if (
              !["contacts.read", "activities.read"].every(c =>
                input.connection.allowedReadCapabilities.includes(
                  c as CrmCapability
                )
              )
            )
              throw Error("CONTACT_READ_NOT_AUTHORIZED");
            return withAuthenticatedBrowserSessionPage({
              connection: input.connection,
              secret: input.secret,
              provider: "genie",
              run: (page, _context, assertControl) =>
                readGenieContactHistory({
                  page,
                  assertControl,
                  contactExternalId: input.externalId,
                  ownerExternalId: input.secret.crmUserExternalId || "",
                }),
            });
          },
        }
      : {}),
    syncContacts: input => list("syncContacts", contact, input),
    ...(provider === "genie"
      ? {
          syncRecentContacts: async (input: {
            connection: AdapterConnection;
            secret: ConnectionSecretPayload;
          }) => {
            const result = await list("syncContacts", contact, input, {
              fastPath: true,
            });
            return { records: result.records };
          },
          reproveRecentContactsRead: async (input: {
            connection: AdapterConnection;
            secret: ConnectionSecretPayload;
            publishByUserId: number;
          }) => {
            if (!input.secret.crmUserExternalId)
              throw new Error("CRM_READ_REPROOF_OWNER_REQUIRED");
            if (input.secret.browserUserId !== input.publishByUserId)
              throw new Error("CRM_READ_REPROOF_USER_SCOPE_MISMATCH");
            const result = await list(
              "syncContacts",
              contact,
              input,
              { fastPath: true },
              {
                allowTestReady: true,
                publishByUserId: input.publishByUserId,
              }
            );
            return { records: result.records };
          },
        }
      : {}),
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
      return extracted.map(contact);
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
      if (!extracted[0]) return null;
      const row = extracted[0];
      // The observed contact page is an identity source; the requested ID alone is not.
      if (
        !row.externalId &&
        !row.id &&
        execution.result.data.actualPageUrl === input.externalId
      )
        row.externalId = execution.result.data.actualPageUrl;
      const record = contact(row);
      if (record.externalId !== input.externalId)
        throw new Error(
          "TARGET_MISMATCH: the CRM returned a different contact."
        );
      return record;
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
