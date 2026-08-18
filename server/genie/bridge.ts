import { chromium, type Browser, type Page } from "playwright-core";
import { requireGenieConfig } from "./config";

export type GenieScriptResult = {
  script: "login" | "health_check";
  completedAt: string;
  success: boolean;
  detail: string;
};

/**
 * This bridge deliberately uses saved selectors and replayable steps rather
 * than asking an LLM to interpret every Genie screen. The selectors are set in
 * the Webdock .env during the first install and changed only after review.
 */
async function connectBrowser(): Promise<Browser> {
  const config = requireGenieConfig();
  return chromium.connectOverCDP(config.browserEndpoint);
}

export async function withGeniePage<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const browser = await connectBrowser();
  try {
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();
    try {
      return await run(page);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

export async function loginToGenie(page: Page) {
  const config = requireGenieConfig();
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator(config.usernameSelector).fill(config.username);
  await page.locator(config.passwordSelector).fill(config.password);
  await page.locator(config.submitSelector).click();
  await page.locator(config.dashboardSelector).waitFor({ state: "visible", timeout: 45_000 });
}

export async function runGenieHealthCheck(): Promise<GenieScriptResult> {
  try {
    await withGeniePage(async page => loginToGenie(page));
    return { script: "health_check", completedAt: new Date().toISOString(), success: true, detail: "Login and dashboard selector completed successfully." };
  } catch (error) {
    return { script: "health_check", completedAt: new Date().toISOString(), success: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runSavedLoginScript(): Promise<GenieScriptResult> {
  try {
    await withGeniePage(async page => loginToGenie(page));
    return { script: "login", completedAt: new Date().toISOString(), success: true, detail: "Login script completed." };
  } catch (error) {
    return { script: "login", completedAt: new Date().toISOString(), success: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
