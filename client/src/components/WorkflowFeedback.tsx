import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WorkflowFeedbackState = {
  kind: "loading" | "success" | "error";
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function WorkflowFeedback({ state }: { state?: WorkflowFeedbackState | null }) {
  if (!state) return null;
  const Icon = state.kind === "error" ? AlertCircle : state.kind === "success" ? CheckCircle2 : LoaderCircle;
  return (
    <div
      role={state.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-2xl border p-4 ${state.kind === "error" ? "border-rose-400/35 bg-rose-400/10 text-rose-50" : state.kind === "success" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-50" : "border-blue-400/30 bg-blue-400/10 text-blue-50"}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${state.kind === "loading" ? "animate-spin" : ""}`} />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{state.title}</p>
          <p className="mt-1 text-sm leading-5 opacity-85">{state.detail}</p>
          {state.actionLabel && state.onAction && (
            <Button onClick={state.onAction} size="sm" variant="outline" className="mt-3 border-current bg-transparent">
              {state.kind === "error" ? <RefreshCw className="mr-2 size-3.5" /> : <Wrench className="mr-2 size-3.5" />}
              {state.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
