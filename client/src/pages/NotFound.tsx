import { MarketingLayout } from "@/marketing/MarketingLayout";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <MarketingLayout>
      <section className="marketing-not-found">
        <div>
          <span>404</span>
          <h1>This page isn't part of the sales day.</h1>
          <p>
            The link may have changed, or the page may no longer exist. Return
            home to explore Amarktai Sales Assistant.
          </p>
          <Link href="/" className="marketing-button marketing-button--primary">
            Return home <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
