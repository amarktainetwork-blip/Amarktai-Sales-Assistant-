import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";

export const BROWSER_SCRIPT_ACTIONS = ["goto", "fill", "click", "press", "select_option", "check", "uncheck", "hover", "expect_visible", "wait_for_url", "read_text", "read_attribute", "read_rows", "screenshot"] as const;
export type BrowserScriptAction = (typeof BROWSER_SCRIPT_ACTIONS)[number];

export type BrowserRowField = { selector?: string; attribute?: string };
export type BrowserScriptStep = {
  action: BrowserScriptAction;
  selector?: string;
  value?: string;
  key?: string;
  attribute?: string;
  fields?: Record<string, BrowserRowField>;
};

export type SavedBrowserScript = { steps: BrowserScriptStep[] };

export type BrowserScriptResult = {
  success: boolean;
  completedAt: string;
  detail: string;
  data: Record<string, string>;
  screenshotPath?: string;
};

const tokenPattern = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const forbiddenSelectorText = /(?:javascript:|<script|\beval\s*\(|\bfunction\s*\()/i;

export function renderBrowserTemplate(value: string | undefined, inputs: Record<string, unknown>) {
  return (value ?? "").replace(tokenPattern, (_, key) => String(inputs[key] ?? ""));
}

function validateSelector(value?: string) {
  if (value && (value.length > 2000 || forbiddenSelectorText.test(value))) throw new Error("Browser connector selectors must be declarative and may not contain executable script content.");
}

/** Rejects unbounded or executable connector definitions before runtime. */
export function validateSavedBrowserScript(script: SavedBrowserScript) {
  if (!script || !Array.isArray(script.steps) || script.steps.length === 0 || script.steps.length > 80) {
    throw new Error("A saved browser script must contain between one and eighty reviewed steps.");
  }
  for (const step of script.steps) {
    if (!BROWSER_SCRIPT_ACTIONS.includes(step.action)) throw new Error(`Unsupported browser script action '${String(step.action)}'.`);
    if (!["goto", "wait_for_url"].includes(step.action) && !step.selector) throw new Error(`Browser script action '${step.action}' requires a selector.`);
    validateSelector(step.selector);
    if (step.value && (step.value.length > 4000 || forbiddenSelectorText.test(step.value))) throw new Error("Browser connector values must be declarative and may not contain executable script content.");
    if (step.attribute && !/^[a-zA-Z_:][-a-zA-Z0-9_:.]{0,120}$/.test(step.attribute)) throw new Error("Browser connector attribute names must be declarative HTML attribute names.");
    if (step.fields) {
      if (Object.keys(step.fields).length > 40) throw new Error("A browser row extractor may return at most forty fields.");
      for (const field of Object.values(step.fields)) { validateSelector(field.selector); if (field.attribute && !/^[a-zA-Z_:][-a-zA-Z0-9_:.]{0,120}$/.test(field.attribute)) throw new Error("Browser row attributes must be declarative HTML attribute names."); }
    }
  }
  return script;
}

async function rowValue(row: ReturnType<Page["locator"]>, field: BrowserRowField) {
  const target = field.selector ? row.locator(field.selector).first() : row;
  if (field.attribute) return (await target.getAttribute(field.attribute)) ?? "";
  return (await target.innerText()).trim();
}

export async function executeSavedBrowserScript(input: {
  page: Page;
  script: SavedBrowserScript;
  inputs: Record<string, unknown>;
  artifactDirectory: string;
  artifactPrefix: string;
  authorizeNavigation?: (url: string) => Promise<void>;
}): Promise<BrowserScriptResult> {
  const script = validateSavedBrowserScript(input.script);
  const data: Record<string, string> = {};
  let screenshotPath: string | undefined;
  try {
    for (const step of script.steps) {
      if (step.action === "goto") {
        const target = renderBrowserTemplate(step.value, input.inputs);
        if (!/^https?:\/\//i.test(target)) throw new Error("Browser connector navigation only permits HTTP(S) URLs.");
        await input.authorizeNavigation?.(target);
        await input.page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await input.authorizeNavigation?.(input.page.url());
        continue;
      }
      if (step.action === "wait_for_url") {
        const target = renderBrowserTemplate(step.value, input.inputs);
        await input.page.waitForURL(target, { timeout: 30_000 });
        await input.authorizeNavigation?.(input.page.url());
        continue;
      }
      const locator = input.page.locator(renderBrowserTemplate(step.selector, input.inputs));
      if (step.action === "fill") await locator.fill(renderBrowserTemplate(step.value, input.inputs));
      if (step.action === "click") await locator.click();
      if (step.action === "press") await locator.press(renderBrowserTemplate(step.value, input.inputs));
      if (step.action === "select_option") await locator.selectOption(renderBrowserTemplate(step.value, input.inputs));
      if (step.action === "check") await locator.check();
      if (step.action === "uncheck") await locator.uncheck();
      if (step.action === "hover") await locator.hover();
      if (step.action === "expect_visible") await locator.waitFor({ state: "visible", timeout: 30_000 });
      if (step.action === "read_text") data[step.key || step.selector || "text"] = (await locator.allTextContents()).join("\n").slice(0, 40_000);
      if (step.action === "read_attribute") data[step.key || step.attribute || "attribute"] = (await locator.first().getAttribute(step.attribute || "value")) ?? "";
      if (step.action === "read_rows") {
        const rows = locator;
        const count = Math.min(await rows.count(), 500);
        const extracted: Array<Record<string, string>> = [];
        for (let index = 0; index < count; index += 1) {
          const row = rows.nth(index);
          const record: Record<string, string> = {};
          for (const [key, field] of Object.entries(step.fields || {})) record[key] = (await rowValue(row, field)).slice(0, 10_000);
          extracted.push(record);
        }
        data[step.key || "rows"] = JSON.stringify(extracted);
      }
      if (step.action === "screenshot") {
        await mkdir(input.artifactDirectory, { recursive: true });
        screenshotPath = path.join(input.artifactDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${input.artifactPrefix}-${step.key || "evidence"}.png`);
        await input.page.screenshot({ path: screenshotPath, fullPage: true });
      }
    }
    return { success: true, completedAt: new Date().toISOString(), detail: "Saved browser script completed.", data, screenshotPath };
  } catch (error) {
    return { success: false, completedAt: new Date().toISOString(), detail: error instanceof Error ? error.message : String(error), data, screenshotPath };
  }
}
