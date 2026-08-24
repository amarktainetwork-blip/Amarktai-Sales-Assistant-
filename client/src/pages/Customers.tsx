import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Building2, Headphones, Mail, Phone, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

export default function Customers() {
  const [, navigate] = useLocation();
  const customers = trpc.sales.customers.useQuery();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return customers.data ?? [];
    return (customers.data ?? []).filter(customer => `${customer.name} ${customer.companyName || ""} ${customer.email || ""} ${customer.phone || ""}`.toLowerCase().includes(term));
  }, [customers.data, query]);
  return <DashboardLayout><div className="mx-auto max-w-7xl text-[#EEF5FF]">
    <header className="border-b border-white/10 pb-7"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">AMARKTAI / CUSTOMERS</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">Know who you are speaking to.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">Synchronized CRM contacts remain the source of truth. Select a customer to begin a call with its stored identity and context.</p></header>
    <label className="mt-6 flex items-center gap-3 rounded-xl border border-white/10 bg-[#0E2142] px-4"><Search className="size-4 text-[#83AEFF]"/><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, company, email or phone" className="border-0 bg-transparent text-white shadow-none focus-visible:ring-0"/></label>
    {customers.isError ? <section className="mt-6 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-5"><p className="font-bold text-rose-100">Customers could not be loaded.</p><p className="mt-2 text-sm text-rose-100/80">{customers.error.message}</p><Button onClick={() => customers.refetch()} className="mt-4 bg-[#1B64F2]">Retry customer list</Button></section> : null}
    {customers.isLoading ? <p className="mt-6 text-sm text-[#A9BFDF]">Loading synchronized customers…</p> : <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(customer => <article key={customer.id} className="rounded-2xl border border-white/10 bg-[#0E2142] p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-display text-xl font-bold text-white">{customer.name}</p><p className="mt-1 flex items-center gap-1 text-xs text-[#9EB6DB]"><Building2 className="size-3"/>{customer.companyName || "No linked company"}</p></div><span className="rounded-full bg-[#153B7A] px-2.5 py-1 text-[9px] font-black uppercase text-[#A9C7FF]">{customer.lifecycleStage || "CRM contact"}</span></div><div className="mt-4 space-y-2 text-sm text-[#B9CAE3]">{customer.email ? <p className="flex items-center gap-2"><Mail className="size-4 text-[#83AEFF]"/>{customer.email}</p> : null}{customer.phone ? <p className="flex items-center gap-2"><Phone className="size-4 text-[#83AEFF]"/>{customer.phone}</p> : null}</div><Button onClick={() => navigate(`/calls?contactId=${customer.id}`)} className="mt-5 w-full bg-[#1B64F2]"><Headphones className="mr-2 size-4"/>Prepare call</Button></article>)}</section>}
    {!customers.isLoading && !customers.isError && !visible.length ? <section className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/[.03] p-8 text-center"><Users className="mx-auto size-8 text-[#83AEFF]"/><p className="mt-3 font-bold text-white">{query ? "No customers match this search." : "No synchronized CRM customers yet."}</p><p className="mt-2 text-sm text-[#A9BFDF]">{query ? "Change the search and try again." : "Connect and synchronize a CRM; customer records will appear here without manual IDs."}</p>{!query ? <Button onClick={() => navigate("/connections")} className="mt-5 bg-[#1B64F2]">Open connections</Button> : null}</section> : null}
  </div></DashboardLayout>;
}
