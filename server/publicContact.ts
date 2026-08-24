import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sendEmail } from "./smtp";

export const contactRateLimit = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
export const contactReasons = [
  "General enquiry",
  "Sales Assistant demo",
  "Individual setup",
  "Team/company setup",
  "CRM integration",
  "Support",
  "Other",
] as const;

const containsMarkup = (value: string) => /<\/?[a-z][^>]*>/i.test(value);
const plainText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine(value => !containsMarkup(value), "HTML is not accepted.");
const optionalPlainText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(value => !containsMarkup(value), "HTML is not accepted.")
    .optional()
    .default("");

export const contactPayloadSchema = z
  .object({
    name: plainText(2, 100),
    email: z.email().max(254),
    company: plainText(2, 120),
    phone: optionalPlainText(40),
    teamSize: optionalPlainText(40),
    reason: z.enum(contactReasons),
    message: plainText(20, 2000),
    website: z.string().max(200).optional().default(""),
  })
  .strict();

type ContactPayload = z.infer<typeof contactPayloadSchema>;
type ContactMailer = typeof sendEmail;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] || character
  );
const validEmail = z.email();

export function contactRecipient() {
  const configured =
    process.env.CONTACT_RECIPIENT_EMAIL?.trim() ||
    process.env.LOCAL_ADMIN_EMAIL?.trim() ||
    "";
  return validEmail.safeParse(configured).success ? configured : null;
}

function notification(payload: ContactPayload, requestId: string) {
  const rows = [
    ["Name", payload.name],
    ["Email", payload.email],
    ["Company", payload.company],
    ["Phone", payload.phone || "Not supplied"],
    ["Team size", payload.teamSize || "Not supplied"],
    ["Reason", payload.reason],
  ] as const;
  const text = [
    "Amarktai Sales Assistant — public website enquiry",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Message:",
    payload.message,
    "",
    `Request ID: ${requestId}`,
  ].join("\n");
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><th style="padding:10px;text-align:left;border-bottom:1px solid #dce4ef">${escapeHtml(label)}</th><td style="padding:10px;border-bottom:1px solid #dce4ef">${escapeHtml(value)}</td></tr>`
    )
    .join("");
  const html = `<main style="font-family:Arial,sans-serif;color:#102238;max-width:680px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1b64f2">Amarktai Sales Assistant</p><h1>New public website enquiry</h1><table style="width:100%;border-collapse:collapse">${htmlRows}</table><h2 style="margin-top:28px;font-size:18px">Message</h2><p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(payload.message)}</p><p style="margin-top:28px;font-size:12px;color:#697c94">Request ID: ${escapeHtml(requestId)}</p></main>`;
  return { text, html };
}

export function createContactHandler(mailer: ContactMailer = sendEmail) {
  return async (req: Request, res: Response) => {
    const requestId = randomUUID();
    if (
      req.body &&
      typeof req.body === "object" &&
      typeof req.body.website === "string" &&
      req.body.website.trim()
    ) {
      console.warn(
        JSON.stringify({ event: "public_contact_abuse_rejected", requestId })
      );
      return res.status(200).json({ ok: true });
    }
    const parsed = contactPayloadSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Check the form fields and try again." });
    const recipient = contactRecipient();
    if (!recipient) {
      console.error(
        JSON.stringify({
          event: "public_contact_recipient_unavailable",
          requestId,
        })
      );
      return res
        .status(503)
        .json({ error: "We couldn't send your message. Please try again." });
    }
    try {
      const email = notification(parsed.data, requestId);
      await mailer({
        to: recipient,
        subject: `Amarktai website enquiry — ${parsed.data.reason}`,
        ...email,
      });
      console.info(
        JSON.stringify({
          event: "public_contact_submitted",
          requestId,
          reason: parsed.data.reason,
          companySupplied: Boolean(parsed.data.company),
        })
      );
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "public_contact_delivery_failed",
          requestId,
          detail:
            error instanceof Error
              ? error.message.slice(0, 160)
              : "Unknown delivery error",
        })
      );
      return res
        .status(503)
        .json({ error: "We couldn't send your message. Please try again." });
    }
  };
}

export function registerPublicContactRoutes(app: Express) {
  app.post("/api/public/contact", createContactHandler());
}
