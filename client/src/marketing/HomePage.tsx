import { ArrowRight, Check, CircleCheck, Headphones, Sparkles, Workflow } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const benefits = [
  {
    icon: CircleCheck,
    title: "Know what to do next",
    copy: "Start the day with the customers, callbacks and opportunities that actually need attention.",
  },
  {
    icon: Headphones,
    title: "Walk into every call prepared",
    copy: "Bring customer history, company knowledge and the next best talking points together before you speak.",
  },
  {
    icon: Workflow,
    title: "Spend less time doing CRM admin",
    copy: "Ask Amarktai to prepare follow-ups, notes, tasks and approved CRM work, then verify what changed.",
  },
] as const;

const steps = [
  ["1", "Learn your business", "Amarktai reads your public website, understands the context and asks you to approve what it may trust."],
  ["2", "Connect your CRM", "Keep the sales system your business already uses. Amarktai works with it rather than replacing it."],
  ["3", "Start selling", "Open your day, work through customers and ask the Assistant for help in plain language."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="bg-[#111113] px-5 pb-20 pt-16 text-[#F7F6F2] sm:px-8 sm:pb-28 sm:pt-24">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[.92fr_1.08fr] lg:gap-16">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-[#6EA8FF]">
              Amarktai Sales Assistant
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-5xl font-bold leading-[.98] tracking-[-.065em] text-white sm:text-6xl lg:text-7xl">
              Your AI sales assistant that works with the CRM you already use.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#B9BABE]">
              Know who to contact. Prepare every conversation. Keep follow-ups moving. Let Amarktai handle the repetitive CRM work without taking control away from your salespeople.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={accountLinks.getStarted}
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#3B82F6] px-6 text-sm font-black text-white transition hover:bg-[#5B98F8]"
              >
                Get started <ArrowRight size={17} />
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex min-h-12 items-center rounded-full border border-white/15 bg-white/[.04] px-6 text-sm font-bold text-white transition hover:bg-white/[.08]"
              >
                See how it works
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#B7B8BC]">
              {[
                "For individual salespeople",
                "For teams and companies",
                "Review before external actions",
              ].map(item => (
                <span key={item} className="inline-flex items-center gap-2">
                  <Check size={15} className="text-[#6EA8FF]" />
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-8 rounded-[3rem] bg-[#3B82F6]/8 blur-3xl" />
            <img
              src="/sales-assistant-hero.svg"
              alt="A salesperson working with Amarktai Sales Assistant and customer context"
              className="relative w-full rounded-[2rem] border border-white/10 shadow-[0_35px_90px_rgba(0,0,0,.35)]"
            />
          </div>
        </div>
      </section>

      <section className="bg-[#F5F3EE] px-5 py-20 text-[#171719] sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <p className="text-xs font-black uppercase tracking-[.16em] text-[#3B6FAF]">The point is simple</p>
          <h2 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-[-.055em] sm:text-5xl">
            Less chasing. Less admin. More useful conversations.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {benefits.map(({ icon: Icon, title, copy }) => (
              <article key={title} className="rounded-[1.5rem] border border-black/8 bg-white p-7 shadow-[0_14px_40px_rgba(24,24,27,.06)]">
                <span className="grid size-10 place-items-center rounded-full bg-[#EEF3FA] text-[#356CB4]">
                  <Icon size={19} />
                </span>
                <h3 className="mt-6 text-xl font-bold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#66676B]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#1A1A1D] px-5 py-20 text-white sm:px-8 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[.16em] text-[#77A9F5]">How it works</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-[-.055em] sm:text-5xl">
                Set up once. Then get on with selling.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#B6B7BC]">
                The technical work stays underneath. Salespeople get a clear workspace and managers get the oversight they need.
              </p>
            </div>
            <div className="grid gap-3">
              {steps.map(([number, title, copy]) => (
                <article key={number} className="grid gap-4 rounded-[1.35rem] border border-white/10 bg-white/[.035] p-6 sm:grid-cols-[56px_1fr] sm:items-start">
                  <span className="grid size-11 place-items-center rounded-full bg-[#3B82F6] text-sm font-black text-white">{number}</span>
                  <div>
                    <h3 className="text-xl font-bold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#B8B9BD]">{copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-20 text-[#171719] sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-[1180px] gap-5 md:grid-cols-2">
          <article className="rounded-[1.75rem] border border-black/8 bg-[#F6F4EF] p-8 sm:p-10">
            <p className="text-xs font-black uppercase tracking-[.16em] text-[#5F6570]">Individual</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-[-.055em]">Your own focused sales workspace.</h2>
            <p className="mt-4 text-base leading-7 text-[#66676B]">
              See your customers, your calls, your reminders and your next actions without team-management clutter.
            </p>
            <Link href="/individuals" className="mt-7 inline-flex items-center gap-2 text-sm font-black text-[#2F66B0]">
              For individuals <ArrowRight size={16} />
            </Link>
          </article>
          <article className="rounded-[1.75rem] bg-[#202024] p-8 text-white sm:p-10">
            <p className="text-xs font-black uppercase tracking-[.16em] text-[#75A7F3]">Company</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-[-.055em]">One company brain. Private salesperson workspaces.</h2>
            <p className="mt-4 text-base leading-7 text-[#B8B9BD]">
              Share approved knowledge and CRM capability while each salesperson keeps their own conversations and working context private. Managers get the team view.
            </p>
            <Link href="/teams" className="mt-7 inline-flex items-center gap-2 text-sm font-black text-[#79AAF4]">
              For companies <ArrowRight size={16} />
            </Link>
          </article>
        </div>
      </section>

      <section className="bg-[#EFEDE7] px-5 py-20 text-[#171719] sm:px-8">
        <div className="mx-auto max-w-[1080px] text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-white text-[#356CB4] shadow-sm">
            <Sparkles size={21} />
          </span>
          <h2 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-bold tracking-[-.055em] sm:text-5xl">
            Keep your CRM. Add a better way to work through the sales day.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-[#68696D]">
            Genie, HubSpot, Salesforce, Pipedrive, Zoho and compatible browser-based CRMs can be connected through the governed setup available for each system.
          </p>
          <Link
            href={accountLinks.getStarted}
            className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#1E1E21] px-7 text-sm font-black text-white transition hover:bg-black"
          >
            Start with Amarktai <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
