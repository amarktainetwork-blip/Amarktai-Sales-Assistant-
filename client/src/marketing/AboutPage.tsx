import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";

const TEAM_PHOTO = "https://images.pexels.com/photos/8000530/pexels-photo-8000530.jpeg?cs=srgb&dl=pexels-pavel-danilyuk-8000530.jpg&fm=jpg";

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-about" style={{ paddingTop: "clamp(96px, 9vw, 132px)" }}>
        <div className="amk-shell amk-about__hero">
          <p className="amk-eyebrow">ABOUT AMARKTAI NETWORK</p>
          <h1>AI should make good salespeople easier to be.</h1>
          <p className="amk-about__lead">Amarktai Sales Assistant is built for the messy space between the CRM and the customer: deciding what matters, understanding the relationship, preparing the conversation, helping through the call and making sure the promised follow-through does not disappear afterwards.</p>
        </div>

        <figure className="amk-shell amk-page-photo">
          <img src={TEAM_PHOTO} alt="Two sales professionals collaborating at a desk" />
        </figure>

        <section className="amk-about__statement">
          <div className="amk-shell">
            <div>
              <p className="amk-eyebrow">WHY WE BUILT IT</p>
              <h2>Sales teams do not need another place to copy the same information.</h2>
            </div>
            <div>
              <p>Most businesses already have a CRM. What salespeople still lose time on is everything around it: finding the right customer history, remembering what the company can promise, deciding who needs attention, preparing calls, capturing commitments and updating the record afterwards.</p>
              <p>We built Sales Assistant as a working layer around the CRM rather than a replacement for it. The company can share approved business knowledge, each salesperson keeps a personal workspace, and the customer record stays in the system the business already trusts.</p>
              <p>Our standard is simple: the Assistant should know the business, respect the salesperson's boundaries, make important changes visible for review and check the result where the connected CRM allows it. It should help the person sell, not make them manage more software.</p>
              <Link href="/how-it-works" className="amk-text-link">See how Amarktai works <ArrowRight size={16}/></Link>
            </div>
          </div>
        </section>
      </section>
    </MarketingLayout>
  );
}
