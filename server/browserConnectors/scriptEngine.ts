import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";

export const BROWSER_SCRIPT_ACTIONS = ["goto", "fill", "click", "expect_visible", "read_text", "screenshot"] as const;
export type BrowserScriptAction = (typeof BROWSER_SCRIPT_ACTIONS)[number];

export type BrowserScriptStep = {
  action: BrowserScriptAction;
  selector?: string;
  value?: string;
  key?: string;
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

/** Rejects unbounded or executable connector definitions before runtime. */
export function validateSavedBrowserScript(script: SavedBrowserScript) {
  if (!script || !Array.isArray(script.steps) || script.steps.length === 0 || script.steps.length > 50) {
    throw new Error("A saved browser script must contain between one and fifty reviewed steps.");
  }
  for (const step of script.steps) {
    if (!BROWSER_SCRIPT_ACTIONS.includes(step.action)) throw new Error(`Unsupported browser script action '${String(step.action)}'.`);
    if (step.action !== "goto" && !step.selector) throw new Error(`Browser script action '${step.action}' requires a selector.`);
    if (step.selector && (step.selector.length > 2000 || forbiddenSelectorText.test(step.selector))) throw new Error("Browser connector selectors must be declarative and may not contain executable script content.");
    if (step.value && (step.value.length > 4000 || forbiddenSelectorText.test(step.value))) throw new Error("Browser connector values must be declarative and may not contain executable script content.");
  }
  return script;
}

export async function executeSavedBrowserScript(input: {
  page: Page;
  script: SavedBrowserScript;
  inputs: Record<string, unknown>;
  artifactDirectory: string;
  artifactPrefix: string;
}): Promise<BrowserScriptResult> {
  const script = validateSavedBrowserScript(input.script);
  const data: Record<string, string> = {};
  let screenshotPath: string | undefined;
  try {
    for (const step of script.steps) {
      if (step.action === "goto") {
        const target = renderBrowserTemplate(step.value, input.inputs);
        if (!/^https?:\/\//i.test(target)) throw new Error("Browser connector navigation only permits HTTP(S) URLs.");
        await input.page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
        continue;
      }
      const locator = input.page.locator(renderBrowserTemplate(step.selector, input.inputs));
      if (step.action === "fill") await locator.fill(renderBrowserTemplate(step.value, input.inputs));
      if (step.action === "click") await locator.click();
      if (step.action === "expect_visible") await locator.waitFor({ state: "visible", timeout: 30_000 });
      if (step.action === "read_text") data[step.key || step.selector || "text"] = (await locator.allTextContents()).join("\n").slice(0, 20_000);
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
