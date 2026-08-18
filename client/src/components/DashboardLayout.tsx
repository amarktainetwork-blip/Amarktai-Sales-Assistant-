import { useAuth } from "@/_core/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { Bot, Cable, CheckCircle2, Headphones, LayoutDashboard, LibraryBig, LockKeyhole, LogOut, MailCheck, Workflow } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "Command centre", path: "/workspace" },
  { icon: Workflow, label: "Workflow studio", path: "/workflows" },
  { icon: Headphones, label: "Live call desk", path: "/calls" },
  { icon: LibraryBig, label: "Knowledge", path: "/knowledge" },
  { icon: Cable, label: "Connections", path: "/connections" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, logout } = useAuth();
  const security = trpc.security.status.useQuery(undefined, { enabled: Boolean(user) });

  if (loading || security.isLoading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return <div className="grid min-h-screen place-items-center bg-[#f5f8fb] p-5"><div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_22px_70px_rgba(15,31,51,.12)]"><div className="mb-10"><BrandMark /></div><div className="mb-5 grid size-12 place-items-center rounded-2xl bg-[#d8ff3e] text-[#102238]"><Bot size={23} /></div><p className="mb-2 text-xs font-black uppercase tracking-[.16em] text-slate-500">Protected workspace</p><h1 className="font-display text-4xl font-bold tracking-[-.065em] text-[#102238]">Sign in to run a safer sales day.</h1><p className="mt-4 leading-6 text-slate-600">Open the assistant workspace to prepare a reviewable workflow, manage programme knowledge, and connect your approved tools.</p><Button onClick={() => startLogin()} className="mt-8 h-12 w-full rounded-xl bg-[#102238] font-bold text-white hover:bg-[#19334f]">Sign in securely</Button></div></div>;
  }

  if (!security.data?.verified) return <SecondFactorGate hasEmail={Boolean(security.data?.hasEmail)} smtpReady={Boolean(security.data?.smtpReady)} />;

  return <SidebarProvider><Sidebar className="border-r-0 bg-[#102238] text-white"><SidebarHeader className="h-[84px] justify-center border-b border-white/10 px-4"><BrandMark inverse /><p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-white/45">Course2Career workspace</p></SidebarHeader><SidebarContent className="px-3 py-5"><p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[.15em] text-white/35">Workspace</p><SidebarMenu>{menuItems.map(item => <AppNavItem key={item.path} {...item} />)}</SidebarMenu><div className="mt-7 rounded-2xl border border-white/10 bg-white/[.06] p-4"><div className="flex items-center gap-2 text-[#d8ff3e]"><Bot size={15} /><span className="text-[11px] font-black uppercase tracking-[.12em]">Review-first control</span></div><p className="mt-2 text-xs leading-5 text-white/62">External CRM and communication actions stay proposals until a human reviews them.</p></div></SidebarContent><SidebarFooter className="border-t border-white/10 p-3"><DropdownMenu><DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/10"><Avatar className="size-9 border border-white/20 bg-[#d8ff3e]"><AvatarFallback className="bg-[#d8ff3e] text-xs font-bold text-[#102238]">{user.name?.slice(0, 1).toUpperCase() ?? "A"}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{user.name || "Amarktai user"}</p><p className="truncate text-xs text-white/45">{user.email || "Authenticated workspace"}</p></div></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter></Sidebar><SidebarInset className="bg-[#f5f8fb]"><AppTopbar /><main className="min-h-[calc(100vh-66px)] p-4 sm:p-6 lg:p-8">{children}</main></SidebarInset></SidebarProvider>;
}

function SecondFactorGate({ hasEmail, smtpReady }: { hasEmail: boolean; smtpReady: boolean }) {
  const [requested, setRequested] = useState(false);
  const [code, setCode] = useState("");
  const status = trpc.security.status.useQuery();
  const requestCode = trpc.security.requestEmailCode.useMutation({ onSuccess: () => { setRequested(true); toast.success("A verification code was sent to your authenticated email address."); }, onError: error => toast.error(error.message) });
  const verifyCode = trpc.security.verifyEmailCode.useMutation({ onSuccess: () => { toast.success("Second factor verified."); status.refetch(); window.location.reload(); }, onError: error => toast.error(error.message) });

  return <div className="grid min-h-screen place-items-center bg-[#f5f8fb] p-5"><div className="grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[18px_19px_0_#102238] lg:grid-cols-[.9fr_1.1fr]"><section className="bg-[#102238] p-8 text-white sm:p-10"><BrandMark inverse /><div className="mt-16 grid size-12 place-items-center rounded-2xl bg-[#d8ff3e] text-[#102238]"><LockKeyhole size={21} /></div><p className="mt-7 text-xs font-black uppercase tracking-[.15em] text-[#d8ff3e]">Second factor required</p><h1 className="mt-3 font-display text-5xl font-bold leading-[.88] tracking-[-.075em]">One extra check. A lot more certainty.</h1><p className="mt-5 text-sm leading-6 text-white/64">Your organization sign-in is complete. Verify your email code to unlock contact context, workflow preparation, and the review queue.</p><div className="mt-8 space-y-3 text-sm text-white/72"><p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#d8ff3e]" />Codes expire after 10 minutes.</p><p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#d8ff3e]" />The workspace remembers verification for 12 hours.</p></div></section><section className="p-8 sm:p-10"><div className="grid size-11 place-items-center rounded-2xl bg-[#e8f6ff] text-[#2684ba]"><MailCheck size={20} /></div><h2 className="mt-6 font-display text-4xl font-bold leading-[.9] tracking-[-.07em] text-[#102238]">Confirm your access.</h2>{!hasEmail ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">Your authenticated profile has no email address. Add an email address in the identity provider, then sign in again to enable the app-level second factor.</p> : !smtpReady ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">Email verification is ready in the app but SMTP deployment secrets have not been added yet. An administrator must configure SMTP before codes can be sent.</p> : !requested ? <><p className="mt-4 text-sm leading-6 text-slate-600">We will send a six-digit verification code to the email address attached to your signed-in account.</p><Button onClick={() => requestCode.mutate()} disabled={requestCode.isPending} className="mt-8 h-12 w-full rounded-xl bg-[#102238] font-bold">{requestCode.isPending ? "Sending code…" : "Send verification code"}</Button></> : <><p className="mt-4 text-sm leading-6 text-slate-600">Enter the six-digit code from your verified email address.</p><input inputMode="numeric" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" className="mt-6 h-14 w-full rounded-xl border-2 border-slate-300 bg-[#f8fafc] text-center font-display text-3xl font-bold tracking-[.32em] text-[#102238] outline-none transition focus:border-[#102238]" /><Button onClick={() => verifyCode.mutate({ code })} disabled={code.length !== 6 || verifyCode.isPending} className="mt-4 h-12 w-full rounded-xl bg-[#102238] font-bold">{verifyCode.isPending ? "Verifying…" : "Verify and enter workspace"}</Button><button onClick={() => requestCode.mutate()} className="mt-4 w-full text-sm font-bold text-[#102238] underline decoration-[#d8ff3e] decoration-2 underline-offset-4">Send a new code</button></>}</section></div></div>;
}

function AppNavItem({ icon: Icon, label, path }: (typeof menuItems)[number]) {
  const [location, setLocation] = useLocation();
  const active = location === path;
  return <SidebarMenuItem><SidebarMenuButton isActive={active} onClick={() => setLocation(path)} tooltip={label} className={`h-11 rounded-xl px-3 text-white transition-all hover:bg-white/10 hover:text-white ${active ? "bg-white/12 text-[#d8ff3e] hover:bg-white/12" : "text-white/67"}`}><Icon className="size-[18px]" /><span className="font-semibold">{label}</span></SidebarMenuButton></SidebarMenuItem>;
}

function AppTopbar() {
  const isMobile = useIsMobile();
  if (!isMobile) return <header className="flex h-[66px] items-center justify-between border-b border-slate-200/80 bg-white/80 px-8 backdrop-blur"><p className="text-xs font-black uppercase tracking-[.14em] text-slate-400">Amarktai Sales Assistant</p><div className="flex items-center gap-2 rounded-full bg-[#eef6d1] px-3 py-1.5 text-xs font-bold text-[#4e6700]"><span className="size-1.5 rounded-full bg-[#86b900]" />Guardrails online</div></header>;
  return <header className="flex h-14 items-center border-b border-slate-200 bg-white px-2"><SidebarTrigger className="rounded-lg" /><span className="ml-2 text-sm font-bold text-[#102238]">Amarktai workspace</span></header>;
}
