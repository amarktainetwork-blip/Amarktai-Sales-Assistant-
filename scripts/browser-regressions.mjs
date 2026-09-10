// Local browser regression fixtures only. Never run this against a connected environment.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const origin = process.env.UI_TEST_URL || "http://127.0.0.1:3100";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Fixtures are restricted to localhost"
);
const out = process.env.UI_TEST_OUTPUT || "work/browser-regressions";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL || "chrome",
  headless: true,
});
const sizes = process.env.UI_TEST_SIZE
  ? [process.env.UI_TEST_SIZE.split("x").map(Number)]
  : [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [390, 844],
    ];
let stage = "public",
  malformed = false,
  saved = false;
let member = { step: 1, complete: false };
const organisation = {
  organisationId: 9001,
  organisationName: "Layout fixture",
  role: "owner",
  settings: { workspaceMode: "team", onboarding: { complete: false } },
  memberOnboarding: { preferredName: "Alex" },
};
const snapshot = () => ({
  member,
  role: "owner",
  organisationId: 9001,
  organisationName: "Layout fixture",
  canManage: true,
  company: { complete: false, step: 1, workspaceMode: "team" },
  personalCrm: [],
  identity: {
    mappingsExist: false,
    mapped: false,
    current: [],
    candidates: [],
  },
  mailbox: { configured: true, connected: false, mailbox: null },
});
function responseFor(key) {
  const values = {
    "auth.me":
      stage === "public" || stage === "auth"
        ? null
        : {
            id: 9001,
            name: "Alex",
            email: "layout@example.invalid",
            role: "user",
          },
    "auth.mode": { local: true },
    "security.status": { verified: true, hasEmail: true, smtpReady: true },
    "organisation.current": organisation,
    "organisation.available": [
      { id: 9001, name: "Layout fixture", role: "owner" },
    ],
    "companySetup.get": {
      profile:
        stage === "member"
          ? { companyName: "Layout fixture", discoveryStatus: "pending" }
          : null,
      currentDiscovery: null,
    },
    "companySetup.companyLearningStatus": null,
    "connectedSystems.list": [],
    "integrations.list": { genie: { ready: false } },
    "sales.customers": [],
    "managementElevation.status": { elevated: true },
  };
  assert(key in values, `Add an explicit response contract for ${key}`);
  return values[key];
}
async function pageFor() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/trpc/")) {
      const keys = decodeURIComponent(
        url.pathname.split("/api/trpc/")[1]
      ).split(",");
      if (malformed)
        return route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<html>Bad gateway</html>",
        });
      const result = keys.map(key => ({
        result: { data: { json: responseFor(key) } },
      }));
      return route.fulfill({
        json: url.searchParams.has("batch") ? result : result[0],
      });
    }
    if (url.pathname === "/api/user-onboarding") {
      if (route.request().method() === "PUT") {
        member = { ...member, ...route.request().postDataJSON() };
        saved = true;
      }
      return route.fulfill({ json: snapshot() });
    }
    if (url.pathname === "/api/mailbox")
      return route.fulfill({ json: snapshot().mailbox });
    throw new Error(`Unexpected fixture API: ${url.pathname}`);
  });
  return { context, page };
}
const errors = [];
let checks = 0;
async function fits(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false,
    "Horizontal overflow"
  );
  checks++;
}
try {
  for (const [width, height] of sizes) {
    stage = "auth";
    const { context, page } = await pageFor();
    await page.setViewportSize({ width, height });
    for (const route of ["/auth", "/auth?mode=register", "/auth?mode=forgot"]) {
      await page.goto(origin + route);
      await page.locator("form input").first().waitFor();
      await fits(page);
      const primary = page.locator("form button[type=submit]").last();
      await primary.scrollIntoViewIfNeeded();
      assert(await primary.isVisible());
      if (route === "/auth") {
        const password = page.locator("input[type=password]");
        await password.fill("layout-password");
        await page
          .getByRole("button", { name: "Show password", exact: true })
          .click();
        assert.equal(await password.count(), 0);
        await page
          .getByRole("button", { name: "Hide password", exact: true })
          .click();
      }
      await page.screenshot({
        path: `${out}/auth-${route.includes("register") ? "register" : route.includes("forgot") ? "recover" : "login"}-${width}.png`,
        fullPage: true,
      });
    }
    await context.close();
    stage = "member";
    member = { step: 1, complete: false };
    const setup = await pageFor();
    await setup.page.setViewportSize({ width, height });
    await setup.page.goto(origin + "/assistant");
    await setup.page
      .getByRole("heading", { name: "Tell us about you." })
      .waitFor();
    await fits(setup.page);
    await setup.page
      .getByRole("textbox", { name: "Preferred name" })
      .fill("Alex");
    await setup.page
      .getByRole("textbox", { name: "Main sales goal" })
      .fill("Follow up on time");
    await setup.page.screenshot({
      path: `${out}/member-before-${width}.png`,
      fullPage: true,
    });
    await setup.page
      .getByRole("button", { name: "Save and continue" })
      .scrollIntoViewIfNeeded();
    await setup.page.screenshot({
      path: `${out}/member-${width}.png`,
      fullPage: true,
    });
    saved = false;
    await setup.page.getByRole("button", { name: "Save and continue" }).click();
    await setup.page
      .getByRole("heading", { name: "Review your setup." })
      .waitFor();
    assert(saved);
    await setup.page.reload();
    await setup.page
      .getByRole("heading", { name: "Review your setup." })
      .waitFor();
    checks++;
    await setup.context.close();
  }
  stage = "auth";
  malformed = true;
  const failure = await pageFor();
  await failure.page.goto(origin + "/auth");
  await failure.page
    .getByRole("button", { name: "Retry", exact: true })
    .waitFor();
  assert(
    !(await failure.page.locator("body").innerText()).includes(
      "Unexpected end of JSON"
    )
  );
  malformed = false;
  await failure.page
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await failure.page.locator("form input").first().waitFor();
  await failure.context.close();
  checks++;
  stage = "public";
  const pub = await pageFor();
  for (const [width, height] of sizes) {
    await pub.page.setViewportSize({ width, height });
    for (const route of [
      "/",
      "/how-it-works",
      "/about",
      "/pricing",
      "/contact",
      "/product",
      "/individuals",
      "/teams",
      "/integrations",
    ]) {
      await pub.page.goto(origin + route);
      await pub.page.locator("main").waitFor();
      for (const img of await pub.page.locator("main img").all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(el => el.decode());
        assert(await img.evaluate(el => el.naturalWidth > 0));
      }
      await fits(pub.page);
      if (route === "/" || route === "/contact")
        await pub.page.screenshot({
          path: `${out}/${route === "/" ? "home" : "contact"}-${width}.png`,
          fullPage: true,
        });
    }
  }
  await pub.context.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      checks,
      viewports: sizes,
      errors,
      scope: "local UI fixtures, not connected acceptance",
    })
  );
} finally {
  await browser.close();
}
