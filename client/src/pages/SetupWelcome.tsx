import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MailCheck, ShieldCheck, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

export default function SetupWelcome() {
  const [, navigate] = useLocation();

  return (
    <DashboardLayout>
      <main className="mx-auto flex min-h-[calc(100vh-92px)] w-full max-w-5xl items-center px-4 py-10 sm:px-6">
        <section className="w-full overflow-hidden rounded-[32px] border border-[#DCE4EE] bg-white shadow-[0_24px_80px_rgba(24,52,91,.10)]">
          <div className="bg-[linear-gradient(135deg,#F5F9FF_0%,#FFFFFF_58%,#EEF5FF_100%)] px-7 py-10 sm:px-12 sm:py-14">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#EAF2FF]">
              <Sparkles className="size-7 text-[#2F6FED]" />
            </div>
            <p className="mt-7 text-[11px] font-black uppercase tracking-[.18em] text-[#2F6FED]">
              Setup complete
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-.03em] text-[#203047] sm:text-4xl">
              Welcome to your Sales Assistant.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#607086]">
              Your company knowledge, personal mailbox and CRM are connected.
              AmarktAI has learned the safe CRM read paths and prepared your
              review-first workspace.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                [
                  MailCheck,
                  "Email ready",
                  "Your personal mailbox is connected for your own sales work.",
                ],
                [
                  CheckCircle2,
                  "CRM learned",
                  "Your authenticated CRM is available inside Sales Assistant.",
                ],
                [
                  ShieldCheck,
                  "Review-first safety",
                  "Messages and CRM changes stay drafted or approval-gated by default.",
                ],
              ].map(([Icon, title, detail]) => {
                const Component = Icon as typeof CheckCircle2;
                return (
                  <div
                    key={String(title)}
                    className="rounded-2xl border border-[#DDE6F0] bg-white/90 p-5"
                  >
                    <Component className="size-5 text-[#2F6FED]" />
                    <h2 className="mt-3 font-bold text-[#26374D]">
                      {String(title)}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-[#68788D]">
                      {String(detail)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="rounded-xl bg-[#2F6FED] px-7 font-bold text-white hover:bg-[#245FCB]"
                onClick={() => navigate("/today")}
              >
                Open my Sales Assistant
              </Button>
              <p className="text-xs font-semibold text-[#718096]">
                You can change automation preferences later in Management
                Controls.
              </p>
            </div>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
