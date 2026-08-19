import { BrandMark } from "@/components/BrandMark";
import { startLogin } from "@/const";
import { AI_CREDIT_ECONOMICS, AI_CREDIT_FEATURES, PRICING_PLANS, ZERO_AI_CREDIT_FEATURES } from "@shared/pricing";
import { ArrowLeft, ArrowRight, Check, Coins, Gauge, ShieldCheck } from "lucide-react";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default function Pricing() {
  return <main className="min-h-screen bg-[#071326] text-white">
    <header className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
      <a href="/" aria-label="Amarktai home"><BrandMark large /></a>
      <div className="flex items-center gap-3">
        <a href="/" className="hidden items-center gap-2 text-sm font-bold text-[#A9BFDF] hover:text-white sm:flex"><ArrowLeft size={16}/> Home</a>
        <button onClick={() => startLogin()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1B64F2] px-5 text-sm font-bold hover:bg-[#2B76FF]">Open Amarktai <ArrowRight size={16}/></button>
      </div>
    </header>

    <section className="mx-auto max-w-[1440px] px-5 pb-12 pt-12 text-center sm:px-8 lg:px-12 lg:pt-20">
      <p className="text-xs font-black uppercase tracking-[.18em] text-[#82AEFF]">Simple AI-credit pricing</p>
      <h1 className="mx-auto mt-4 max-w-5xl font-display text-5xl font-bold tracking-[-.07em] sm:text-7xl">Spend intelligence where it adds value—not on ordinary CRM work.</h1>
      <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-[#A9BFDF]">CRM syncing, deterministic monitoring, Revenue Recovery rules, dashboards and approved CRM operations do not consume Amarktai AI Credits. Credits are reserved for language and reasoning work.</p>
    </section>

    <section className="mx-auto grid max-w-[1440px] gap-4 px-5 py-10 sm:px-8 md:grid-cols-2 xl:grid-cols-4 lg:px-12">
      {PRICING_PLANS.map(plan => <article key={plan.key} className={`relative rounded-[1.5rem] border p-6 ${plan.key === "team" ? "border-[#4E8BFF] bg-[#102C59]" : "border-white/10 bg-[#0E2142]"}`}>
        {plan.key === "team" && <span className="absolute right-4 top-4 rounded-full bg-[#1B64F2] px-3 py-1 text-[10px] font-black uppercase tracking-[.12em]">Management</span>}
        <p className="text-sm font-black uppercase tracking-[.14em] text-[#83AEFF]">{plan.name}</p>
        <p className="mt-4 font-display text-5xl font-bold tracking-[-.06em]">{money(plan.monthlyUsdCents)}</p>
        <p className="mt-1 text-sm text-[#91A9CC]">per month</p>
        <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
          <div className="flex items-center gap-2"><Coins size={17} className="text-[#83AEFF]"/><span className="font-bold">{plan.includedAiCredits.toLocaleString()} AI Credits</span></div>
          <p className="mt-2 text-xs leading-5 text-[#91A9CC]">{plan.includedUsers} included user{plan.includedUsers === 1 ? "" : "s"}</p>
        </div>
        <ul className="mt-6 space-y-3">{plan.features.map(feature => <li key={feature} className="flex gap-2 text-sm leading-6 text-[#D7E2F4]"><Check className="mt-1 size-4 shrink-0 text-[#6FA0FF]"/>{feature}</li>)}</ul>
        <button onClick={() => startLogin()} className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1B64F2] text-sm font-bold hover:bg-[#2B76FF]">{plan.key === "trial" ? "Start trial" : "Choose plan"}<ArrowRight size={15}/></button>
      </article>)}
    </section>

    <section className="mx-auto grid max-w-[1440px] gap-5 px-5 py-12 sm:px-8 lg:grid-cols-2 lg:px-12">
      <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-7">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A]"><Gauge size={19}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#83AEFF]">Zero-credit engine</p><h2 className="font-display text-3xl font-bold tracking-[-.05em]">Ordinary software stays ordinary.</h2></div></div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">{ZERO_AI_CREDIT_FEATURES.map(item => <li key={item} className="flex gap-2 text-sm leading-6 text-[#C9D7ED]"><Check className="mt-1 size-4 shrink-0 text-[#6FA0FF]"/>{item}</li>)}</ul>
      </article>
      <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-7">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A]"><ShieldCheck size={19}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#83AEFF]">Intelligence credits</p><h2 className="font-display text-3xl font-bold tracking-[-.05em]">Use AI where language matters.</h2></div></div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">{AI_CREDIT_FEATURES.map(item => <li key={item} className="flex gap-2 text-sm leading-6 text-[#C9D7ED]"><Check className="mt-1 size-4 shrink-0 text-[#6FA0FF]"/>{item}</li>)}</ul>
      </article>
    </section>

    <section className="mx-auto max-w-[1440px] px-5 pb-20 sm:px-8 lg:px-12">
      <div className="rounded-[1.75rem] border border-[#4E8BFF]/30 bg-[#102C59] p-8 lg:flex lg:items-center lg:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[.16em] text-[#9CC0FF]">Additional AI Credits</p><h2 className="mt-2 font-display text-4xl font-bold tracking-[-.055em]">1,000 credits · {money(AI_CREDIT_ECONOMICS.retailPackUsdCents)}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[#B9CBE6]">Credit packs and subscriptions are defined centrally so future billing entitlements can use the same plan data as this page. Checkout remains disabled until a verified billing provider is configured.</p></div>
        <button onClick={() => startLogin()} className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-black text-[#102C59] lg:mt-0">Open workspace <ArrowRight size={16}/></button>
      </div>
    </section>
  </main>;
}
