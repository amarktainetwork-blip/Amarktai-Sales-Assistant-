import { sendEmail } from "./smtp";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const moneyMinor = (value: number, currency = "") => `${currency ? `${currency} ` : ""}${(value / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const percent = (value: number | null | undefined) => value === null || value === undefined ? "Not set" : `${Math.round(value * 100)}%`;

export type ManagementEmailPerson = {
  name: string;
  overdueTasks: number;
  staleOpportunities: number;
  noNextStep: number;
  pipelineAtRiskMinor: number;
  activitiesToday?: number;
  wonValueThisMonthMinor?: number;
  targetStatus?: string;
  targetProgress?: { dailyActivity?: number | null; monthlyWonValue?: number | null; expectedMonthlyPace?: number };
};

export async function sendTargetAwareManagementReport(input: {
  to: string;
  organisationName: string;
  currency?: string;
  mappedSalespeople: number;
  overdueTasks: number;
  staleOpportunities: number;
  pipelineAtRiskMinor: number;
  wonValueThisMonthMinor?: number;
  people: ManagementEmailPerson[];
}) {
  const count = input.people.length;
  const subject = count ? `Amarktai — ${count} salesperson${count === 1 ? "" : "s"} need attention` : "Amarktai — team healthy, no intervention required";
  const peopleText = input.people.map(person => [
    `${person.name} — ${(person.targetStatus || "attention").replaceAll("_", " ")}`,
    `- Daily activity: ${person.activitiesToday ?? 0} (${percent(person.targetProgress?.dailyActivity)} of target)`,
    `- Monthly won progress: ${percent(person.targetProgress?.monthlyWonValue)}; expected pace ${percent(person.targetProgress?.expectedMonthlyPace)}`,
    `- Won value this month: ${moneyMinor(person.wonValueThisMonthMinor ?? 0, input.currency)}`,
    `- Overdue tasks: ${person.overdueTasks}`,
    `- Stale opportunities: ${person.staleOpportunities}`,
    `- Missing next steps: ${person.noNextStep}`,
    `- Pipeline at risk: ${moneyMinor(person.pipelineAtRiskMinor, input.currency)}`,
  ].join("\n")).join("\n\n");
  const text = [
    `Amarktai Management Intelligence — ${input.organisationName}`, "",
    `Mapped salespeople: ${input.mappedSalespeople}`, `People needing attention: ${count}`,
    `Overdue tasks: ${input.overdueTasks}`, `Stale opportunities: ${input.staleOpportunities}`,
    `Pipeline at risk: ${moneyMinor(input.pipelineAtRiskMinor, input.currency)}`,
    `Won this month: ${moneyMinor(input.wonValueThisMonthMinor ?? 0, input.currency)}`, "",
    peopleText || "No configured target or CRM-work exceptions require management attention.", "",
    "Open Amarktai Team Intelligence for the underlying CRM facts.",
  ].join("\n");
  const rows = input.people.map(person => `<tr>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8"><strong>${escapeHtml(person.name)}</strong><br><span style="font-size:12px;color:#66788d">${escapeHtml((person.targetStatus || "attention").replaceAll("_", " "))}</span></td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${person.activitiesToday ?? 0}<br><span style="font-size:11px;color:#66788d">${percent(person.targetProgress?.dailyActivity)}</span></td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${percent(person.targetProgress?.monthlyWonValue)}<br><span style="font-size:11px;color:#66788d">pace ${percent(person.targetProgress?.expectedMonthlyPace)}</span></td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${person.overdueTasks}</td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${person.staleOpportunities}</td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${person.noNextStep}</td>
    <td style="padding:10px;border-bottom:1px solid #dbe1e8;text-align:right">${moneyMinor(person.pipelineAtRiskMinor, input.currency)}</td>
  </tr>`).join("");
  const appUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, "") || "";
  await sendEmail({
    to: input.to, subject, text,
    html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:900px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1b64f2">Amarktai Management Intelligence</p><h1>${count ? `${count} team member${count === 1 ? "" : "s"} need attention` : "Team healthy"}</h1><p>${escapeHtml(input.organisationName)} · target and CRM-work exception brief</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:10px;background:#f3f6fa">Mapped<br><strong>${input.mappedSalespeople}</strong></td><td style="padding:10px;background:#f3f6fa">Overdue<br><strong>${input.overdueTasks}</strong></td><td style="padding:10px;background:#f3f6fa">Stale<br><strong>${input.staleOpportunities}</strong></td><td style="padding:10px;background:#f3f6fa">Risk<br><strong>${moneyMinor(input.pipelineAtRiskMinor, input.currency)}</strong></td></tr></table>${rows ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:10px">Salesperson</th><th style="text-align:right;padding:10px">Activity</th><th style="text-align:right;padding:10px">Won target</th><th style="text-align:right;padding:10px">Overdue</th><th style="text-align:right;padding:10px">Stale</th><th style="text-align:right;padding:10px">No next step</th><th style="text-align:right;padding:10px">Risk value</th></tr></thead><tbody>${rows}</tbody></table>` : `<p style="padding:16px;background:#eef8f1;border-radius:10px">No configured target or CRM-work exceptions require management intervention.</p>`}${appUrl ? `<p style="margin-top:24px"><a href="${appUrl}/team" style="display:inline-block;background:#1b64f2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open Team Intelligence</a></p>` : ""}<p style="margin-top:24px;font-size:12px;color:#66788d">Generated only from authorised company CRM/work data and explicit targets. Amarktai does not monitor private browsing, keystrokes, webcams or unrelated activity.</p></main>`,
  });
}
