import { BrandMark } from "@/components/BrandMark";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CheckCircle2, ChevronLeft, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

const securityImage = "/manus-storage/amarktai-security-orbit_503e7f2b.png";

export default function Auth() {
  const mode = trpc.auth.mode.useQuery();
  return <main className="grid min-h-screen lg:grid-cols-[1.03fr_.97fr]"><section className="relative flex min-h-[470px] flex-col overflow-hidden bg-[#102238] p-6 text-white sm:p-10 lg:min-h-screen lg:p-14"><div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(rgba(216,255,62,.45) 1px, transparent 1px)", backgroundSize: "18px 18px", maskImage: "linear-gradient(90deg, black, transparent 75%)" }} /><div className="relative flex items-center justify-between"><Link href="/" className="inline-flex items-center gap-1 text-sm font-bold text-white/80 transition hover:text-white"><ChevronLeft size={17} /> Back to home</Link><BrandMark inverse /></div><div className="relative mt-auto max-w-xl pt-24 lg:pt-0"><p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.15em] text-[#d8ff3e]"><ShieldCheck size={14} /> Protected by design</p><h1 className="mt-4 font-display text-5xl font-bold leading-[.88] tracking-[-.08em] sm:text-7xl">Access the system. Keep the control.</h1><p className="mt-6 max-w-lg text-base leading-7 text-white/65">Sign in to your Amarktai workspace. The self-hosted deployment uses a local administrator account, a signed server session, and an email second factor before operational data can load.</p><div className="mt-8 grid gap-3 text-sm font-semibold text-white/75"><span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#d8ff3e]" />Workspace data stays under authenticated access.</span><span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#d8ff3e]" />Every intended action has an audit trail.</span></div></div><div className="pointer-events-none absolute -bottom-7 right-[-2rem] w-[42%] min-w-[230px] rotate-[3deg]"><img src={securityImage} alt="" className="w-full drop-shadow-[12px_13px_0_rgba(0,0,0,.25)]" /></div></section><section className="grid place-items-center bg-[#f6f8fb] p-5 sm:p-10"><div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[14px_15px_0_#102238] sm:p-10"><div className="grid size-12 place-items-center rounded-2xl bg-[#d8ff3e] text-[#102238]"><LockKeyhole size={20} /></div><p className="mt-7 text-xs font-black uppercase tracking-[.15em] text-slate-400">Secure sign-in</p><h2 className="mt-3 font-display text-5xl font-bold leading-[.9] tracking-[-.075em] text-[#102238]">Open your workspace.</h2>{mode.isLoading ? <p className="mt-5 text-sm text-slate-500">Loading sign-in…</p> : mode.data?.local ? <LocalLoginForm /> : <ManagedSignIn />}</div></section></main>;
}

function ManagedSignIn() {
  return <><p className="mt-5 text-sm leading-6 text-slate-600">Continue to the protected identity flow. Once authenticated, you can access the command centre, agent desk, workflow studio, knowledge sources, and connections.</p><button onClick={() => startLogin()} className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#102238] text-sm font-bold text-white shadow-[4px_5px_0_#d8ff3e] transition hover:-translate-y-0.5 hover:bg-[#19334f] active:scale-[.98]">Continue securely <ArrowRight size={17} /></button><SecurityFineprint /></>;
}

function LocalLoginForm() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.localLogin.useMutation({ onSuccess: () => { toast.success("Signed in. Complete the email verification step to enter the workspace."); navigate("/workspace"); }, onError: error => toast.error(error.message) });
  return <form onSubmit={event => { event.preventDefault(); login.mutate({ email, password }); }} className="mt-6 grid gap-4"><div><label htmlFor="email" className="text-sm font-bold text-[#102238]">Administrator email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none transition focus:border-[#102238]" /></div><div><label htmlFor="password" className="text-sm font-bold text-[#102238]">Password</label><input id="password" type="password" autoComplete="current-password" required minLength={12} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 outline-none transition focus:border-[#102238]" /></div><button type="submit" disabled={login.isPending} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#102238] text-sm font-bold text-white shadow-[4px_5px_0_#d8ff3e] transition hover:-translate-y-0.5 hover:bg-[#19334f] active:scale-[.98]">{login.isPending ? "Signing in…" : "Sign in securely"} <ArrowRight size={17} /></button><SecurityFineprint /></form>;
}

function SecurityFineprint() { return <p className="mt-7 text-center text-xs leading-5 text-slate-400"><Sparkles className="mr-1 inline size-3" />Credentials and third-party integration secrets are never displayed inside this workspace.</p>; }
