import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";

export const contactReasons = [
  "Request a demo",
  "Sales",
  "Individual setup",
  "Team setup",
  "CRM compatibility",
  "Support",
] as const;

type ContactForm = {
  name: string;
  email: string;
  company: string;
  phone: string;
  teamSize: string;
  reason: string;
  message: string;
  website: string;
};
type FieldErrors = Partial<Record<keyof ContactForm, string>>;
const emptyForm: ContactForm = { name:"", email:"", company:"", phone:"", teamSize:"", reason:"", message:"", website:"" };

function validate(form: ContactForm): FieldErrors {
  const errors: FieldErrors = {};
  if (form.name.trim().length < 2) errors.name = "Enter your name.";
  else if (form.name.length > 100) errors.name = "Name is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.length > 254) errors.email = "Enter a valid email address.";
  if (form.company.trim().length < 2) errors.company = "Enter your company or business name.";
  else if (form.company.length > 120) errors.company = "Company name is too long.";
  if (form.phone.length > 40) errors.phone = "Phone number is too long.";
  if (form.teamSize.length > 40) errors.teamSize = "Team size is too long.";
  if (!contactReasons.includes(form.reason as (typeof contactReasons)[number])) errors.reason = "Choose a reason for contacting us.";
  if (form.message.trim().length < 20) errors.message = "Add a little more detail so we can help properly.";
  else if (form.message.length > 2000) errors.message = "Please shorten your message.";
  return errors;
}

export default function ContactPage() {
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle"|"sending"|"success"|"error">("idle");

  const update = (field: keyof ContactForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
    if (status !== "idle") setStatus("idle");
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error("contact request failed");
      setForm(emptyForm);
      setErrors({});
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <MarketingLayout>
      <section className="amk-contact">
        <div className="amk-shell amk-contact__grid">
          <div className="amk-contact__intro">
            <p className="amk-eyebrow">TALK TO US</p>
            <h1>Show us how your team sells today.</h1>
            <p><BrandName /> is designed to fit around the CRM and sales process you already have. Tell us which CRM you use, how many people sell and where work keeps getting missed, repeated or copied by hand.</p>
            <p>That might be poor call preparation, scattered customer context, missed follow-ups, inconsistent CRM updates or too much sales admin. We will show you where the Assistant is meant to help.</p>
            <div className="amk-contact__details">
              <p><strong>Want a useful demo?</strong> Include your CRM name and the part of the sales day you most want to improve.</p>
              <p><strong>For your security:</strong> never send CRM passwords, one-time codes or connection secrets through this form.</p>
            </div>
          </div>

          <form className="amk-contact-form" action="/api/public/contact" method="post" onSubmit={submit} noValidate>
            <div className="amk-form-grid">
              <Field label="Name" name="name" value={form.name} error={errors.name} maxLength={100} autoComplete="name" onChange={update}/>
              <Field label="Email" name="email" value={form.email} error={errors.email} maxLength={254} type="email" autoComplete="email" onChange={update}/>
              <Field label="Company" name="company" value={form.company} error={errors.company} maxLength={120} autoComplete="organization" onChange={update}/>
              <Field label={<>Phone <span>(optional)</span></>} name="phone" value={form.phone} error={errors.phone} maxLength={40} type="tel" autoComplete="tel" onChange={update}/>
              <Field label={<>Sales team size <span>(optional)</span></>} name="teamSize" value={form.teamSize} error={errors.teamSize} maxLength={40} onChange={update}/>
              <div className="amk-field">
                <label htmlFor="contact-reason">How can we help?</label>
                <select id="contact-reason" name="reason" value={form.reason} onChange={event => update("reason", event.target.value)} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? "contact-reason-error" : undefined}>
                  <option value="">Choose one</option>
                  {contactReasons.map(reason => <option key={reason}>{reason}</option>)}
                </select>
                {errors.reason ? <p id="contact-reason-error" className="amk-field__error">{errors.reason}</p> : null}
              </div>
              <div className="amk-field amk-field--wide">
                <label htmlFor="contact-message">What would you like to improve?</label>
                <textarea id="contact-message" name="message" value={form.message} maxLength={2000} onChange={event => update("message", event.target.value)} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? "contact-message-error" : undefined}/>
                {errors.message ? <p id="contact-message-error" className="amk-field__error">{errors.message}</p> : null}
              </div>
              <div className="amk-honeypot" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={event => update("website", event.target.value)}/>
              </div>
            </div>
            <button className="amk-button amk-button--primary" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : <>Send enquiry <ArrowRight size={17}/></>}
            </button>
            <div aria-live="polite" aria-atomic="true">
              {status === "success" ? <p className="amk-form-status amk-form-status--success">Thank you. We received your message and the context you shared.</p> : null}
              {status === "error" ? <p className="amk-form-status amk-form-status--error">We couldn't send your message. Check the highlighted fields and try again.</p> : null}
            </div>
          </form>
        </div>
      </section>
    </MarketingLayout>
  );
}

function Field({ label, name, value, error, onChange, ...props }: {
  label: React.ReactNode;
  name: keyof ContactForm;
  value: string;
  error?: string;
  onChange: (field: keyof ContactForm, value: string) => void;
  type?: string;
  maxLength: number;
  autoComplete?: string;
}) {
  const id = `contact-${name}`;
  return (
    <div className="amk-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} value={value} onChange={event => onChange(name, event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props}/>
      {error ? <p id={`${id}-error`} className="amk-field__error">{error}</p> : null}
    </div>
  );
}
