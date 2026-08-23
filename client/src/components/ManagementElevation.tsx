import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ManagementElevation() {
  const status = trpc.managementElevation.status.useQuery(undefined, { retry: false });
  const [password, setPassword] = useState("");
  const start = trpc.managementElevation.start.useMutation({
    onSuccess: async result => { setPassword(""); await status.refetch(); toast.success(`Management mode active for ${result.ttlMinutes} minutes.`); },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.managementElevation.revoke.useMutation({ onSuccess: () => status.refetch() });
  if (!status.data?.eligible) return null;
  return <section className="rounded-2xl border border-[#4E8BFF]/30 bg-[#0E2142] p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div className="flex-1"><div className="flex items-center gap-2 text-[#9FC2FF]"><ShieldCheck size={17}/><p className="text-xs font-black uppercase tracking-[.12em]">Sensitive management mode</p></div><p className="mt-2 text-xs leading-5 text-[#A9BFDF]">Reverify once to manage credentials, training publication, team permissions, billing, automation and compliance. Ordinary sales work is unaffected.</p></div>{status.data.elevated ? <Button variant="outline" onClick={() => revoke.mutate()} className="border-white/15 text-white">End management mode</Button> : <div className="flex gap-2"><Input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Re-enter your password" autoComplete="current-password" className="border-white/15 bg-[#08172F] text-white"/><Button disabled={!password || start.isPending} onClick={() => start.mutate({ password })} className="bg-[#1B64F2]">Elevate</Button></div>}</div></section>;
}
