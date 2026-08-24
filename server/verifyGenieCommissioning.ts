import "dotenv/config";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { authenticateCommissioningPage } from "./browserConnectors/browserCrmAdapter";
import { executeSavedBrowserScript } from "./browserConnectors/scriptEngine";
import {
  verifyBrowserPostconditions,
  verifyBrowserTarget,
} from "./browserConnectors/operationContracts";
import { browserOperationStatusAfterResult } from "./browserConnectors/learnedOperations";
import { inferBrowserOperationCandidates } from "./crm/automaticCommissioning";

const ORIGIN = "https://genie-rehearsal.example";
const AUTH_ORIGIN = "https://auth-rehearsal.example";
const credentials = { username: "dummy.user@example.test", password: "dummy-password" };

function layout(body: string, script = "") {
  return `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;
}

function loginPage(mode: string) {
  const duplicate = mode === "ambiguous" ? '<input type="email" name="backup-email" />' : "";
  return layout(
    `<main><form id="login"><input type="email" name="email" autocomplete="username" />${duplicate}<input type="password" name="password" /><button type="submit">Sign in</button><p id="error"></p><div id="mfa"></div></form></main>`,
    `document.querySelector('#login').addEventListener('submit', event => {
      event.preventDefault();
      const user = document.querySelector('input[name=email]').value;
      const password = document.querySelector('input[name=password]').value;
      const mode = ${JSON.stringify(mode)};
      if (mode === 'redirect') return location.assign('${AUTH_ORIGIN}/sso');
      if (mode === 'private') return location.assign('http://127.0.0.1/admin');
      if (mode === 'mfa') { document.querySelector('#mfa').innerHTML = '<label>Verification code<input name="otp" autocomplete="one-time-code"></label>'; return; }
      if (mode === 'unchanged') return;
      if (user !== ${JSON.stringify(credentials.username)} || password !== ${JSON.stringify(credentials.password)}) { document.querySelector('#error').textContent = 'Invalid username or password'; return; }
      sessionStorage.setItem('genie-authenticated', 'yes');
      location.assign('${ORIGIN}/home');
    });`
  );
}

function fixture(pathname: string) {
  if (pathname.startsWith("/login")) return loginPage(new URL(`${ORIGIN}${pathname}`).searchParams.get("mode") || "success");
  if (pathname === "/session")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><h1>Authenticated session</h1></main>');
  if (pathname === "/home")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><h1>Sales home</h1><a href="/contacts">Contacts</a><a href="/tasks">Tasks</a><a href="/note">Notes</a><a href="/opportunity">Deals and pipeline</a><p data-testid="placeholder-executed">no</p></main>');
  if (pathname === "/contacts")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><div data-testid="contact-row"><span data-field="id">contact-001</span><span data-field="name">Dummy Customer</span><span data-field="email">dummy.customer@example.test</span></div></main>');
  if (pathname === "/tasks")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><div data-testid="task-row"><span data-field="id">task-001</span><span data-field="title">Dummy follow-up</span></div></main>');
  if (pathname === "/note")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><div data-testid="contact-row"><span data-field="id">contact-001</span><span data-field="name">Dummy Customer</span></div><textarea name="note"></textarea><button data-testid="save-note">Save note</button><p data-testid="latest-note"></p></main>', `document.querySelector('[data-testid="save-note"]').onclick = () => document.querySelector('[data-testid="latest-note"]').textContent = document.querySelector('textarea').value;`);
  if (pathname === "/opportunity")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><div data-testid="opportunity-row"><span data-field="id">opportunity-001</span><span data-field="name">Dummy Opportunity</span></div><button data-testid="update-opportunity">Move to test stage</button><p data-testid="opportunity-state">Open</p></main>', `document.querySelector('[data-testid="update-opportunity"]').onclick = () => document.querySelector('[data-testid="opportunity-state"]').textContent = 'Test stage';`);
  if (pathname === "/dialler")
    return layout('<main data-testid="dashboard"><nav>Genie CRM</nav><div data-testid="contact-row"><span data-field="id">contact-001</span><span data-field="name">Dummy Customer</span></div><button data-testid="launch-dialler">Launch dummy dialler</button><p data-testid="dialler-state">idle</p></main>', `document.querySelector('[data-testid="launch-dialler"]').onclick = () => document.querySelector('[data-testid="dialler-state"]').textContent = 'launched:contact-001';`);
  return layout("<h1>Not found</h1>");
}

async function installFixture(context: BrowserContext, allowedHosts: Set<string>) {
  let blocked: { url: string; detail: string } | undefined;
  await context.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: fixture(url.pathname + url.search) });
  });
  await context.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest()) return route.fallback();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      blocked = { url: request.url(), detail: "private or unsafe network address" };
      return route.abort("blockedbyclient");
    }
    if (!allowedHosts.has(url.hostname)) {
      blocked = { url: request.url(), detail: "outside authorised connected-system domain" };
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
  return { blocked: () => blocked };
}

async function authenticatedPage(context: BrowserContext) {
  const guard = await installFixture(context, new Set(["genie-rehearsal.example"]));
  const page = await context.newPage();
  const proof = await authenticateCommissioningPage({
    page,
    loginUrl: `${ORIGIN}/login`,
    credentials,
    authorize: async raw => {
      const url = new URL(raw);
      if (url.hostname !== "genie-rehearsal.example") throw new Error("outside authorised domain");
    },
    blockedNavigation: guard.blocked,
    timeoutMs: 2_000,
  });
  return { page, proof };
}

async function expectCode(
  context: BrowserContext,
  mode: string,
  code: string,
  calibration?: { usernameSelector?: string; passwordSelector?: string; submitSelector?: string; readySelector?: string }
) {
  const guard = await installFixture(context, new Set(["genie-rehearsal.example"]));
  const page = await context.newPage();
  let detail = "";
  try {
    await authenticateCommissioningPage({
      page,
      loginUrl: `${ORIGIN}/login?mode=${mode}`,
      credentials: mode === "wrong-password" ? { ...credentials, password: "wrong" } : credentials,
      loginCalibration: calibration,
      authorize: async raw => {
        const url = new URL(raw);
        if (url.hostname !== "genie-rehearsal.example") throw new Error("outside authorised domain");
      },
      blockedNavigation: guard.blocked,
      timeoutMs: 1_000,
    });
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  } finally {
    await page.close();
    await context.close();
  }
  if (!detail.startsWith(`${code}:`)) throw new Error(`Expected ${code}, received '${detail || "success"}'.`);
  return code;
}

async function runScript(page: Page, name: string, steps: Parameters<typeof executeSavedBrowserScript>[0]["script"]["steps"], inputs: Record<string, unknown> = {}) {
  const result = await executeSavedBrowserScript({
    page,
    script: { steps },
    inputs,
    artifactDirectory: "/tmp/amarktai-genie-rehearsal",
    artifactPrefix: name,
    authorizeNavigation: async raw => {
      if (new URL(raw).hostname !== "genie-rehearsal.example") throw new Error("fixture navigation escaped its authorised domain");
    },
  });
  if (!result.success) throw new Error(`${name} failed: ${result.detail}`);
  return result;
}

async function main() {
  delete process.env.GENIE_USERNAME;
  delete process.env.GENIE_PASSWORD;
  delete process.env.GENIE_LOGIN_URL;
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT || "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext();
  try {
    const { page, proof } = await authenticatedPage(context);
    let placeholderRejected = false;
    try {
      await runScript(page, "clean-install-placeholder", [
        { action: "click", selector: "REPLACE_NOTES_PANEL_SELECTOR" },
      ]);
    } catch (error) {
      placeholderRejected = /INCOMPLETE_BROWSER_OPERATION/.test(
        error instanceof Error ? error.message : String(error)
      );
    }
    if (!placeholderRejected)
      throw new Error("clean-install placeholder script was not rejected before execution");
    if (await page.locator('[data-testid="placeholder-executed"]').textContent() !== "no")
      throw new Error("placeholder script changed the fixture");
    const discoveredControls = await page.locator("a").evaluateAll(links =>
      links.map((link, index) => ({
        tag: "a",
        role: "link",
        label: (link.textContent || "").trim(),
        selector: `a:nth-of-type(${index + 1})`,
        href: (link as HTMLAnchorElement).href,
      }))
    );
    const automaticallyProposed = inferBrowserOperationCandidates({
      pageUrl: page.url(),
      controls: discoveredControls,
      readOnly: true,
    }).map(candidate => candidate.operationKey);
    if (!automaticallyProposed.includes("note.create"))
      throw new Error("bounded Genie discovery did not propose note.create");
    const contactRead = await runScript(page, "contact-read", [
      { action: "goto", value: `${ORIGIN}/contacts` },
      { action: "read_rows", selector: '[data-testid="contact-row"]', key: "contacts", fields: { externalId: { selector: '[data-field="id"]' }, name: { selector: '[data-field="name"]' }, email: { selector: '[data-field="email"]' } } },
    ]);
    const contacts = JSON.parse(contactRead.data.contacts) as Array<Record<string, string>>;
    if (contacts[0]?.externalId !== "contact-001") throw new Error("contact readback failed");
    const taskRead = await runScript(page, "task-read", [
      { action: "goto", value: `${ORIGIN}/tasks` },
      { action: "read_rows", selector: '[data-testid="task-row"]', key: "tasks", fields: { externalId: { selector: '[data-field="id"]' }, title: { selector: '[data-field="title"]' } } },
    ]);
    const tasks = JSON.parse(taskRead.data.tasks) as Array<Record<string, string>>;
    if (tasks[0]?.externalId !== "task-001") throw new Error("task readback failed");

    const target = await runScript(page, "note-target", [
      { action: "goto", value: `${ORIGIN}/note` },
      { action: "read_rows", selector: '[data-testid="contact-row"]', key: "targets", fields: { externalId: { selector: '[data-field="id"]' }, name: { selector: '[data-field="name"]' } } },
    ]);
    const guardian = verifyBrowserTarget(
      { externalId: "contact-001", name: "Dummy Customer" },
      JSON.parse(target.data.targets)
    );
    if (!guardian.ok) throw new Error(`target guardian failed: ${guardian.detail}`);
    await runScript(page, "note-create", [
      { action: "fill", selector: 'textarea[name="note"]', value: "{{noteBody}}" },
      { action: "click", selector: '[data-testid="save-note"]' },
    ], { noteBody: "Dummy commissioning note" });
    const noteReadback = await runScript(page, "note-readback", [
      { action: "read_text", selector: '[data-testid="latest-note"]', key: "latestNote" },
    ]);
    const postcondition = verifyBrowserPostconditions(
      [{ actualKey: "latestNote", expectedInput: "noteBody", comparator: "contains" }],
      noteReadback.data,
      { noteBody: "Dummy commissioning note" }
    );
    if (!postcondition.ok) throw new Error("note postcondition failed");
    const noteStatus = browserOperationStatusAfterResult({ currentStatus: "TEST_READY", success: true, publish: true, watchdog: false });

    await runScript(page, "opportunity-update", [
      { action: "goto", value: `${ORIGIN}/opportunity` },
      { action: "click", selector: '[data-testid="update-opportunity"]' },
      { action: "read_text", selector: '[data-testid="opportunity-state"]', key: "stage" },
    ]);
    const dialler = await runScript(page, "dialler-launch", [
      { action: "goto", value: `${ORIGIN}/dialler` },
      { action: "click", selector: '[data-testid="launch-dialler"]' },
      { action: "read_text", selector: '[data-testid="dialler-state"]', key: "diallerState" },
    ]);
    if (dialler.data.diallerState !== "launched:contact-001") throw new Error("dialler readback failed");
    const diallerStatus = browserOperationStatusAfterResult({ currentStatus: "TEST_READY", success: true, publish: true, watchdog: false });

    const sessionContext = await browser.newContext();
    const sessionGuard = await installFixture(sessionContext, new Set(["genie-rehearsal.example"]));
    const sessionPage = await sessionContext.newPage();
    const sessionProof = await authenticateCommissioningPage({ page: sessionPage, loginUrl: `${ORIGIN}/session`, browserSession: { cookies: [] }, authorize: async () => undefined, blockedNavigation: sessionGuard.blocked, timeoutMs: 1_000 });
    await sessionContext.close();

    const failures = {
      wrongPassword: await expectCode(await browser.newContext(), "wrong-password", "GENIE_AUTHENTICATION_FAILED"),
      wrongSelector: await expectCode(await browser.newContext(), "success", "GENIE_LOGIN_CALIBRATION_REQUIRED", { usernameSelector: '#missing', passwordSelector: 'input[type="password"]', submitSelector: 'button[type="submit"]', readySelector: '[data-testid="dashboard"]' }),
      unchangedLogin: await expectCode(await browser.newContext(), "unchanged", "GENIE_LOGIN_NOT_CONFIRMED"),
      unapprovedRedirect: await expectCode(await browser.newContext(), "redirect", "GENIE_AUTH_HOST_APPROVAL_REQUIRED"),
      privateRedirect: await expectCode(await browser.newContext(), "private", "GENIE_AUTH_REDIRECT_PRIVATE_BLOCKED"),
      ambiguousControls: await expectCode(await browser.newContext(), "ambiguous", "GENIE_LOGIN_CALIBRATION_REQUIRED"),
      interactiveMfa: await expectCode(await browser.newContext(), "mfa", "GENIE_INTERACTIVE_AUTH_REQUIRED"),
    };
    console.log(JSON.stringify({ event: "genie_commissioning_rehearsal", status: "LIVE_PROVEN", globalGenieCredentialsRequired: false, cleanInstall: { placeholderRejectedBeforeExecution: placeholderRejected, automaticCandidates: automaticallyProposed, manualSelectorsRequired: false }, authentication: proof, approvedSessionReuse: sessionProof, contactRead: contacts[0], taskRead: tasks[0], note: { lifecycle: ["NOT_LEARNED", "TEST_READY", noteStatus], automaticDiscovery: automaticallyProposed.includes("note.create"), guardian: guardian.code, postcondition: postcondition.ok, status: noteStatus }, opportunityUpdate: "proven", dialler: { readback: dialler.data.diallerState, status: diallerStatus }, failures }, null, 2));
    await page.close();
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: "genie_commissioning_rehearsal", status: "FAILED", detail: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
