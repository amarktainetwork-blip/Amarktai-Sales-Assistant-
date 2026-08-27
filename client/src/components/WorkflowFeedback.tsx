import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type WorkflowFeedbackState = {
  kind: "loading" | "success" | "error";
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

const feedbackTone = {
  loading: {
    shell: "border-blue-200 bg-blue-50 text-blue-950",
    icon: "text-blue-700",
    button:
      "border-blue-300 bg-white text-blue-900 hover:bg-blue-100 hover:text-blue-950",
  },
  success: {
    shell: "border-emerald-200 bg-emerald-50 text-emerald-950",
    icon: "text-emerald-700",
    button:
      "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100 hover:text-emerald-950",
  },
  error: {
    shell: "border-rose-200 bg-rose-50 text-rose-950",
    icon: "text-rose-700",
    button:
      "border-rose-300 bg-white text-rose-900 hover:bg-rose-100 hover:text-rose-950",
  },
} as const;

export default function WorkflowFeedback({
  state,
}: {
  state?: WorkflowFeedbackState | null;
}) {
  if (!state) return null;
  const Icon =
    state.kind === "error"
      ? AlertCircle
      : state.kind === "success"
        ? CheckCircle2
        : LoaderCircle;
  const tone = feedbackTone[state.kind];

  return (
    <div
      role={state.kind === "error" ? "alert" : "status"}
      aria-live="polite"
      data-workflow-feedback={state.kind}
      className={`rounded-2xl border p-4 ${tone.shell}`}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 size-5 shrink-0 ${tone.icon} ${state.kind === "loading" ? "animate-spin" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-current">{state.title}</p>
          <p className="mt-1 text-sm leading-5 text-current opacity-80">
            {state.detail}
          </p>
          {state.actionLabel && state.onAction && (
            <Button
              onClick={state.onAction}
              size="sm"
              variant="outline"
              className={`mt-3 ${tone.button}`}
            >
              {state.kind === "error" ? (
                <RefreshCw className="mr-2 size-3.5" />
              ) : (
                <Wrench className="mr-2 size-3.5" />
              )}
              {state.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
