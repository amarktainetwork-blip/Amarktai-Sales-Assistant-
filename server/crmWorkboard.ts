import { runSavedGenieScript } from "./genie/savedScripts";
import { getCrmContextSnapshot, upsertCrmContextSnapshot } from "./db";

function compactContext(data: Record<string, string>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.slice(0, 8_000)]));
}

export function isFreshCrmContext(snapshot: { expiresAt: Date } | null | undefined, now = new Date()) {
  return Boolean(snapshot && snapshot.expiresAt.getTime() > now.getTime());
}

export async function refreshGenieWorkboard(input: { userId: number; leadLabel: string }) {
  const cached = await getCrmContextSnapshot(input.userId, input.leadLabel);
  if (isFreshCrmContext(cached)) return { snapshot: cached!, reused: true };
  const search = await runSavedGenieScript("search_candidate", { leadLabel: input.leadLabel });
  if (!search.success) throw new Error(`CRM search could not complete: ${search.detail}`);
  const history = await runSavedGenieScript("read_candidate_history", { leadLabel: input.leadLabel, ...search.data });
  if (!history.success) throw new Error(`CRM history read could not complete: ${history.detail}`);
  const context = compactContext({ ...search.data, ...history.data });
  const summary = Object.entries(context).slice(0, 6).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value.slice(0, 420)}`).join("\n");
  const snapshot = await upsertCrmContextSnapshot({ userId: input.userId, leadLabel: input.leadLabel, source: "genie_browser", context, summary: summary || "The CRM returned no configured readable fields.", expiresAt: new Date(Date.now() + 20 * 60_000) });
  return { snapshot, reused: false };
}
