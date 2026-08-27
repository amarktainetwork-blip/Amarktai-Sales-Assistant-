import { ArrowRight } from "lucide-react";
import { useState } from "react";
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
const emptyForm: ContactForm = { name:"",email:"",company:"",phone:"",teamSize:"",reason:"",message:"",website:"" };

function validate(form: ContactForm): FieldErrors {
  const errors: FieldErrors = {};
  if (form.name.trim().length < 2) errors.name = "Enter your name.";
  else if (form.name.length > 100) errors.name = "Name must be 100 characters or fewer.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.length > 254) errors.email = "Enter a valid email address.";
  if (form.company.trim().length < 2) errors.company = "Enter your company or business name.";
  else if (form.company.length > 120) errors.company = "Company must be 120 characters or fewer.";
  if (form.phone.length > 40) errors.phone = "Phone must be 40 characters or fewer.";
  if (form.teamSize.length > 40) errors.teamSize = "Team size must be 40 characters or fewer.";
  if (!contactReasons.includes(form.reason as (typeof contactReasons)[number])) errors.reason = "Choose a reason for contacting us.";
  if (form.message.trim().length < 20) errors.message = "Tell us a little more in at least 20 characters.";
  else if (form.message.length > 2000) errors.message = "Message must be 2,000 characters or fewer.";
  return errors;
}

export default function ContactPage() {
  const [form,setForm]=useState<ContactForm>(emptyForm);
  const [errors,setErrors]=useState<FieldErrors>({});
  const [status,setStatus]=useState<"idle"|"sending"|"success"|"error">("idle");
  const update=(field:keyof ContactForm,value:string)=>{setForm(current=>({...current,[field]:value}));setErrors(current=>({...current,[field]:undefined}));if(status!=="idle")setStatus("idle")};

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors=validate(form);
    if(Object.keys(nextErrors).length){setErrors(nextErrors);setStatus("error");return;}
    setStatus("sending");
    try{
      const response=await fetch("/api/public/contact",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(!response.ok)throw new Error("contact request failed");
      setForm(emptyForm);setErrors({});setStatus("success");
    }catch{setStatus("error");}
  }

  return (
    <MarketingLayout>
      <section className="site-contact">
        <div className="site-shell">
          <div className="site-contact__intro">
            <div><p className="site-eyebrow">CONTACT AMARKTAI</p><h1>Tell us what your sales team needs.</h1></div>
            <p>Ask about the product, a demonstration, individual or team setup, CRM compatibility, onboarding or support. Give us enough context to understand the problem and we will respond to the enquiry.</p>
          </div>
          <div className="site-contact__grid">
            <aside className="site-contact__aside">
              <p className="site-eyebrow">WE CAN HELP WITH</p>
              <h2>Product, CRM and onboarding questions.</h2>
              <p>Do not send passwords, OTPs or CRM connection secrets through this form.</p>
              <div className="site-contact__reasons">
                <span>Product demonstrations</span><span>Individual setup</span><span>Team onboarding</span><span>CRM compatibility</span><span>Support</span>
              </div>
            </aside>
            <form className="site-form" action="/api/public/contact" method="post" onSubmit={submit} noValidate>
              <div className="site-form-grid">
                <Field label="Name" name="name" value={form.name} error={errors.name} maxLength={100} autoComplete="name" onChange={update}/>
                <Field label="Email" name="email" value={form.email} error={errors.email} maxLength={254} type="email" autoComplete="email" onChange={update}/>
                <Field label="Company" name="company" value={form.company} error={errors.company} maxLength={120} autoComplete="organization" onChange={update}/>
                <Field label={<>Phone <span>(optional)</span></>} name="phone" value={form.phone} error={errors.phone} maxLength={40} type="tel" autoComplete="tel" onChange={update}/>
                <Field label={<>Team size <span>(optional)</span></>} name="teamSize" value={form.teamSize} error={errors.teamSize} maxLength={40} onChange={update}/>
                <div className="site-field">
                  <label htmlFor="contact-reason">Reason for contacting us</label>
                  <select id="contact-reason" value={form.reason} onChange={event=>update("reason",event.target.value)} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason?"contact-reason-error":undefined}>
                    <option value="">Choose a reason</option>{contactReasons.map(reason=><option key={reason}>{reason}</option>)}
                  </select>
                  {errors.reason?<p id="contact-reason-error" className="site-field__error">{errors.reason}</p>:null}
                </div>
                <div className="site-field site-field--wide">
                  <label htmlFor="contact-message">Message</label>
                  <textarea id="contact-message" value={form.message} maxLength={2000} onChange={event=>update("message",event.target.value)} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message?"contact-message-error":"contact-message-help"}/>
                  <p id="contact-message-help" className="site-form-help">20–2,000 characters. Please do not include passwords or connection secrets.</p>
                  {errors.message?<p id="contact-message-error" className="site-field__error">{errors.message}</p>:null}
                </div>
                <div className="site-honeypot" aria-hidden="true"><label htmlFor="contact-website">Website</label><input id="contact-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={event=>update("website",event.target.value)}/></div>
              </div>
              <button className="site-button site-button--primary" type="submit" disabled={status==="sending"}>{status==="sending"?"Sending…":<>Send enquiry <ArrowRight size={17}/></>}</button>
              <div aria-live="polite" aria-atomic="true">
                {status==="success"?<p className="site-form-status site-form-status--success">Thank you. We received your message.</p>:null}
                {status==="error"?<p className="site-form-status site-form-status--error">We couldn't send your message. Check the highlighted fields and try again.</p>:null}
              </div>
            </form>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

function Field({label,name,value,error,onChange,...props}:{label:React.ReactNode;name:keyof ContactForm;value:string;error?:string;onChange:(field:keyof ContactForm,value:string)=>void;type?:string;maxLength:number;autoComplete?:string}){
  const id=`contact-${name}`;
  return <div className="site-field"><label htmlFor={id}>{label}</label><input id={id} name={name} value={value} onChange={event=>onChange(name,event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error?`${id}-error`:undefined} {...props}/>{error?<p id={`${id}-error`} className="site-field__error">{error}</p>:null}</div>;
}
