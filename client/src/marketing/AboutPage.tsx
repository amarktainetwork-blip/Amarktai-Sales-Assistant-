import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";

const TEAM_PHOTO = "https://images.pexels.com/photos/8068833/pexels-photo-8068833.jpeg?cs=srgb&dl=pexels-edmond-dantes-8068833.jpg&fm=jpg";

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-about">
        <div className="amk-shell amk-about__hero">
          <p className="amk-eyebrow">ABOUT AMARKTAI NETWORK</p>
          <h1>Practical AI built around the way people already work.</h1>
          <p className="amk-about__lead">Sales Assistant is an Amarktai Network product built for the work between the CRM and the customer: deciding what matters, preparing conversations, helping through calls, completing follow-through and keeping the customer record accurate.</p>
        </div>

        <figure className="amk-shell amk-page-photo">
          <img src={TEAM_PHOTO} alt="Professional team collaborating in a modern office" />
        </figure>

        <section className="amk-about__statement">
          <div className="amk-shell">
            <div>
              <p className="amk-eyebrow">WHY SALES ASSISTANT EXISTS</p>
              <h2>AI should remove sales friction, not create another system to maintain.</h2>
            </div>
            <div>
              <p>Most sales teams already have a CRM. The hard part is the work around it: reconstructing customer context, deciding who needs attention, preparing calls, remembering commitments and keeping records current after the conversation.</p>
              <p>Amarktai Network Sales Assistant connects those jobs into a more coherent sales day while leaving the CRM as the system of record.</p>
              <p>We build for grounded context, clear user boundaries, reviewable actions and evidence when the system can verify that important work actually happened.</p>
              <Link href="/contact" className="amk-text-link">Talk to Amarktai Network <ArrowRight size={16}/></Link>
            </div>
          </div>
        </section>
      </section>
    </MarketingLayout>
  );
}
