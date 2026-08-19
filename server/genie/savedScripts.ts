import { readFile } from "node:fs/promises";
import { executeSavedBrowserScript, type SavedBrowserScript } from "../browserConnectors/scriptEngine";
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

type ScriptFile = { scripts: Partial<Record<GenieScriptName, SavedBrowserScript>> };
export type GenieScriptResult = { script: GenieScriptName; success: boolean; completedAt: string; detail: string; data: Record<string, string>; screenshotPath?: string };

const configPath = () => process.env.GENIE_SCRIPTS_CONFIG_PATH || "/app/config/genie-scripts.json";
const artifactDirectory = () => process.env.GENIE_ARTIFACT_DIR || "/app/data/genie-artifacts";

async function readScripts(): Promise<ScriptFile> {
  const raw = await readFile(configPath(), "utf8");
  const parsed = JSON.parse(raw) as ScriptFile;
  if (!parsed?.scripts || typeof parsed.scripts !== "object") throw new Error("Genie script configuration has no scripts object.");
  return parsed;
}

export async function runSavedGenieScript(script: GenieScriptName, inputs: Record<string, unknown>): Promise<GenieScriptResult> {
  const scripts = await readScripts();
  const definition = scripts.scripts[script];
  if (!definition?.steps?.length) throw new Error(`The Genie saved script '${script}' is not configured. Calibrate it in ${configPath()} before running a live action.`);
  try {
    const execution = await withGeniePage(async page => {
      await loginToGenie(page);
      return executeSavedBrowserScript({ page, script: definition, inputs, artifactDirectory: artifactDirectory(), artifactPrefix: "genie" });
    });
    return { script, ...execution };
  } catch (error) {
    return { script, success: false, completedAt: new Date().toISOString(), detail: error instanceof Error ? error.message : String(error), data: {} };
  }
}
