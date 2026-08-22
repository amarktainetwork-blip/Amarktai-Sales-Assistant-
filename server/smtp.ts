import nodemailer from "nodemailer";

export function getSmtpReadiness() {
  const hostConfigured = Boolean(process.env.SMTP_HOST);
  const portConfigured = Boolean(process.env.SMTP_PORT);
  const userConfigured = Boolean(process.env.SMTP_USER);
  const passwordConfigured = Boolean(process.env.SMTP_PASSWORD);
  const fromConfigured = Boolean(process.env.SMTP_FROM);
  return {
    ready: hostConfigured && portConfigured && userConfigured && passwordConfigured && fromConfigured,
    hostConfigured,
    portConfigured,
    userConfigured,
    passwordConfigured,
    fromConfigured,
  };
}

function getTransporter() {
  const readiness = getSmtpReadiness();
  if (!readiness.ready) throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM as deployment secrets.");
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT!),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });
}

export async function verifySmtpTransport() {
  const readiness = getSmtpReadiness();
  if (!readiness.ready) return { ready: false, reason: "not_configured" as const };
  try {
    await getTransporter().verify();
    return { ready: true as const, reason: "verified" as const };
  } catch (error) {
    console.warn("[SMTP] transport verification failed", error instanceof Error ? error.message : "unknown error");
    return { ready: false, reason: "verification_failed" as const };
  }
}

export async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  const transporter = getTransporter();
  await transporter.sendMail({ from: process.env.SMTP_FROM!, ...input });
}

export async function sendSecondFactorCode(input: { to: string; code: string }) {
  await sendEmail({
    to: input.to,
    subject: "Your Amarktai workspace verification code",
    text: `Your Amarktai workspace verification code is ${input.code}. It expires in 10 minutes. If you did not request it, do not share this code.`,
    html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:560px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#718400">Amarktai Sales Assistant</p><h1>Your workspace verification code</h1><p style="font-size:32px;letter-spacing:.22em;font-weight:800">${input.code}</p><p>This code expires in 10 minutes. If you did not request it, do not share this code.</p></main>`,
  });
}

export async function sendDailyWorkspaceReport(input: { to: string; actionsAwaitingReview: number; openCallbackTasks: number; knowledgeSources: number }) {
  const lines = [
    "Amarktai Sales Assistant — daily workspace report",
    "",
    `Actions awaiting review: ${input.actionsAwaitingReview}`,
    `Open callback tasks: ${input.openCallbackTasks}`,
    `Approved knowledge sources: ${input.knowledgeSources}`,
    "",
    "Open the protected workspace to review the queue and prepare the next move.",
  ];
  await sendEmail({
    to: input.to,
    subject: "Amarktai Sales Assistant — daily workspace report",
    text: lines.join("\n"),
    html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:640px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#718400">Daily workspace report</p><h1>Keep the next move clear.</h1><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Actions awaiting review</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.actionsAwaitingReview}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Open callback tasks</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.openCallbackTasks}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dbe1e8">Approved knowledge sources</td><td style="padding:12px;border-bottom:1px solid #dbe1e8;font-weight:700">${input.knowledgeSources}</td></tr></table><p>Open the protected workspace to review the queue and prepare the next move.</p></main>`,
  });
}
