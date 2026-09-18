import BrowserCrmCommissioning from "@/components/BrowserCrmCommissioning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ManagementElevation({
  showBrowserCommissioning = true,
}: {
  showBrowserCommissioning?: boolean;
}) {
  const status = trpc.managementElevation.status.useQuery(undefined, {
    retry: false,
    refetchInterval: 15_000,
  });
  const [password, setPassword] = useState("");
  const [showAdvancedCrm, setShowAdvancedCrm] = useState(false);

  const start = trpc.managementElevation.start.useMutation({
    onSuccess: async result => {
      setPassword("");
      await status.refetch();
      toast.success(
        `Management access confirmed for ${result.ttlMinutes} minutes.`
      );
    },
    onError: cause =>
      toast.error(
        friendlyError(
          cause,
          "Management access could not be confirmed. Check your AmarktAI password and try again."
        )
      ),
  });

  const revoke = trpc.managementElevation.revoke.useMutation({
    onSuccess: async () => {
      await status.refetch();
      toast.success("Management access ended.");
    },
    onError: cause =>
      toast.error(
        friendlyError(cause, "Management access could not be ended. Try again.")
      ),
  });

  if (!status.data?.eligible) return null;

  return (
    <>
      <section className="rounded-2xl border border-[#DCE4EE] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[#3F70D8]">
              <ShieldCheck size={17} />
              <p className="text-xs font-black uppercase tracking-[.12em]">
                Confirm management access
              </p>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#66758A]">
              {status.data.elevated
                ? "Management access is active for a short time so you can manage CRM setup and Teach AmarktAI safely."
                : "Sensitive CRM and company changes need a short AmarktAI management confirmation. Your CRM credentials are never requested here."}
            </p>
          </div>

          {status.data.elevated ? (
            <Button
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              End management access
            </Button>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                aria-label="AmarktAI password for management access"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Re-enter your AmarktAI password"
                autoComplete="current-password"
                className="min-w-[230px]"
              />
              <Button
                disabled={!password || start.isPending}
                onClick={() => start.mutate({ password })}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>
      </section>
      {showBrowserCommissioning && status.data.elevated ? (
        <section className="rounded-2xl border border-[#DCE4EE] bg-white p-4 shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setShowAdvancedCrm(value => !value)}
            aria-expanded={showAdvancedCrm}
          >
            <div>
              <p className="text-sm font-bold text-[#26354A]">
                Advanced CRM setup
              </p>
              <p className="mt-1 text-xs leading-5 text-[#66758A]">
                Only open this while adding, teaching or proving a CRM function.
                It is not part of the salesperson's daily workflow.
              </p>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#718096] transition-transform ${showAdvancedCrm ? "rotate-180" : ""}`}
            />
          </button>
          {showAdvancedCrm ? (
            <div className="mt-4 border-t border-[#E5EAF0] pt-4">
              <BrowserCrmCommissioning />
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
