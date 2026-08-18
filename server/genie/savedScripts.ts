import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";
import { loginToGenie, withGeniePage } from "./bridge";

export const GENIE_SCRIPT_NAMES = [
  "search_candidate",
  "read_candidate_history",
  "send_template_sms",
  "send_template_email",
  "send_template_whatsapp",
  "add_note",
  "complete_active_task",
  "create_next_task",
  "update_current_opportunity",
  "update_contact_status",
  "apply_sequence",
  "health_check",
] as const;
export type GenieScriptName = (typeof GENIE_SCRIPT_NAMES)[number];

type Step = {
  action: "goto" | "fill" | "click" | "expect_visible" | "read_text" | "screenshot";
  selector?: string;
  value?: string;
  key?: string;
};
type Script = { steps: Step[] };
type ScriptFile = { scripts: Partial<Record<GenieScriptName, Script>> };
export type GenieScriptResult = { script: GenieScriptName; success: boolean; completedAt: string; detail: string; data: Record<string, string>; screenshotPath?: string };

const configPath = () => process.env.GENIE_SCRIPTS_CONFIG_PATH || "/app/config/genie-scripts.json";
const artifactDirectory = () => process.env.GENIE_ARTIFACT_DIR || "/app/data/genie-artifacts";

function render(value: string | undefined, inputs: Record<string, unknown>) {
  return (value ?? "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => String(inputs[key] ?? ""));
}

async function readScripts(): Promise<ScriptFile> {
  const raw = await readFile(configPath(), "utf8");
  const parsed = JSON.parse(raw) as ScriptFile;
  if (!parsed?.scripts || typeof parsed.scripts !== "object") throw new Error("Genie script configuration has no scripts object.");
  return parsed;
}

async function executeSteps(page: Page, steps: Step[], inputs: Record<string, unknown>) {
  const data: Record<string, string> = {};
  let screenshotPath: string | undefined;
  for (const step of steps) {
    if (step.action === "goto") {
      await page.goto(render(step.value, inputs), { waitUntil: "domcontentloaded", timeout: 45_000 });
      continue;
    }
    if (!step.selector) throw new Error(`Genie script step ${step.action} is missing a selector.`);
    const locator = page.locator(render(step.selector, inputs));
    if (step.action === "fill") await locator.fill(render(step.value, inputs));
    if (step.action === "click") await locator.click();
    if (step.action === "expect_visible") await locator.waitFor({ state: "visible", timeout: 30_000 });
    if (step.action === "read_text") data[step.key || step.selector] = (await locator.allTextContents()).join("\n").slice(0, 20_000);
    if (step.action === "screenshot") {
      await mkdir(artifactDirectory(), { recursive: true });
      screenshotPath = path.join(artifactDirectory(), `${new Date().toISOString().replace(/[:.]/g, "-")}-${step.key || "genie"}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
  }
  return { data, screenshotPath };
}

export async function runSavedGenieScript(script: GenieScriptName, inputs: Record<string, unknown>): Promise<GenieScriptResult> {
  const scripts = await readScripts();
  const definition = scripts.scripts[script];
  if (!definition?.steps?.length) throw new Error(`The Genie saved script '${script}' is not configured. Calibrate it in ${configPath()} before running a live action.`);
  try {
    const execution = await withGeniePage(async page => {
      await loginToGenie(page);
      return executeSteps(page, definition.steps, inputs);
    });
    return { script, success: true, completedAt: new Date().toISOString(), detail: "Saved browser script completed.", ...execution };
  } catch (error) {
    return { script, success: false, completedAt: new Date().toISOString(), detail: error instanceof Error ? error.message : String(error), data: {} };
  }
}
