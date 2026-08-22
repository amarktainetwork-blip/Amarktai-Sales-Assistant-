import nodemailer from "nodemailer";

export function getSmtpReadiness() {
  const hostConfigured = Boolean(process.env.SMTP_HOST);
  const portConfigured = Boolean(process.env.SMTP_PORT);
  const userConfigured = Boolean(process.env.SMTP_USER);
  const passwordConfigured = Boolean(process.env.SMTP_PASSWORD);
  const fromConfigured = Boolean(process.env.SMTP_FROM);
  return { ready: hostConfigured && portConfigured && userConfigured && passwordConfigured && fromConfigured, hostConfigured, portConfigured, userConfigured, passwordConfigured, fromConfigured };
}

function getTransporter() {
  const readiness = getSmtpReadiness();
  if (!readiness.ready) throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM as deployment secrets.");
  return nodemailer.createTransport({ host: process.env.SMTP_HOST!, port: Number(process.env.SMTP_PORT!), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! } });
}

export async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  const transporter = getTransporter();
  await transporter.sendMail({ from: process.env.SMTP_FROM!, ...input });
}

export async function sendSecondFactorCode(input: { to: string; code: string }) {
  await sendEmail({ to: input.to, subject: "Your Amarktai workspace verification code", text: `Your Amarktai workspace verification code is ${input.code}. It expires in 10 minutes. If you did not request it, do not share this code.`, html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:560px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#718400">Amarktai Sales Assistant</p><h1>Your workspace verification code</h1><p style="font-size:32px;letter-spacing:.22em;font-weight:800">${input.code}</p><p>This code expires in 10 minutes. If you did not request it, do not share this code.</p></main>` });
}

export async function sendDailyWorkspaceReport(input: { to: string; actionsAwaitingReview: number; openCallbackTasks: number; knowledgeSources: number }) {
  const lines = ["Amarktai Sales Assistant — daily workspace report", "", `Actions awaiting review: ${input.actionsAwaitingReview}`, `Open callback tasks: ${input.openCallbackTasks}`, `Approved knowledge sources: ${input.knowledgeSources}`, "", "Open the protected workspace to review the queue and prepare the next move."];
  await sendEmail({ to: input.to, subject: "Amarktai Sales Assistant — daily workspace report", text: lines.join("\n"), html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:640px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#718400">Daily workspace report</p><h1>Keep the next move clear.</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Actions awaiting review</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.actionsAwaitingReview}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Open callback tasks</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.openCallbackTasks}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Approved knowledge sources</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.knowledgeSources}</td></tr></table><p>Open the protected workspace to review the queue and prepare the next move.</p></main>` });
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const moneyMinor = (value: number) => (value / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

export async function sendManagementTeamReport(input: {
  to: string;
  organisationName: string;
  mappedSalespeople: number;
  overdueTasks: number;
  staleOpportunities: number;
  pipelineAtRiskMinor: number;
  people: Array<{ name: string; overdueTasks: number; staleOpportunities: number; noNextStep: number; pipelineAtRiskMinor: number }>;
}) {
  const count = input.people.length;
  const subject = count ? `Amarktai — ${count} salesperson${count === 1 ? "" : "s"} need attention` : "Amarktai — team healthy, no intervention required";
  const textPeople = input.people.map(person => `${person.name}\n- Overdue tasks: ${person.overdueTasks}\n- Stale opportunities: ${person.staleOpportunities}\n- Missing next steps: ${person.noNextStep}\n- Pipeline at risk: ${moneyMinor(person.pipelineAtRiskMinor)}`).join("\n\n");
  const text = [`Amarktai Management Intelligence — ${input.organisationName}`, "", `Mapped salespeople: ${input.mappedSalespeople}`, `People needing attention: ${count}`, `Overdue tasks: ${input.overdueTasks}`, `Stale opportunities: ${input.staleOpportunities}`, `Pipeline at risk (minor-unit source currency basis): ${moneyMinor(input.pipelineAtRiskMinor)}`, "", textPeople || "No configured exceptions require management attention.", "", "Open Amarktai Team Intelligence for the underlying CRM facts."].join("\n");
  const rows = input.people.map(person => `<tr><td style="padding:12px;border-bottom:1px solid #dbe1e8"><strong>${escapeHtml(person.name)}</strong></td><td style="padding:12px;border-bottom:1px solid #dbe1e8;text-align:right">${person.overdueTasks}</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;text-align:right">${person.staleOpportunities}</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;text-align:right">${person.noNextStep}</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;text-align:right">${moneyMinor(person.pipelineAtRiskMinor)}</td></tr>`).join("");
  const appUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, "") || "";
  await sendEmail({
    to: input.to,
    subject,
    text,
    html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:760px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1b64f2">Amarktai Management Intelligence</p><h1>${count ? `${count} team member${count === 1 ? "" : "s"} need attention` : "Team healthy"}</h1><p>${escapeHtml(input.organisationName)} · factual CRM exception report</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:10px;background:#f3f6fa">Mapped salespeople<br><strong>${input.mappedSalespeople}</strong></td><td style="padding:10px;background:#f3f6fa">Overdue tasks<br><strong>${input.overdueTasks}</strong></td><td style="padding:10px;background:#f3f6fa">Stale opportunities<br><strong>${input.staleOpportunities}</strong></td></tr></table>${rows ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:10px">Salesperson</th><th style="text-align:right;padding:10px">Overdue</th><th style="text-align:right;padding:10px">Stale</th><th style="text-align:right;padding:10px">No next step</th><th style="text-align:right;padding:10px">Risk value</th></tr></thead><tbody>${rows}</tbody></table>` : `<p style="padding:16px;background:#eef8f1;border-radius:10px">No configured exceptions require management intervention.</p>`}${appUrl ? `<p style="margin-top:24px"><a href="${appUrl}/team" style="display:inline-block;background:#1b64f2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open Team Intelligence</a></p>` : ""}<p style="margin-top:24px;font-size:12px;color:#66788d">This report is generated from authorised company CRM/work data. It does not use private browsing, keyboard, webcam or unrelated employee activity.</p></main>`,
  });
}
