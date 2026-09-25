import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const liveCalls = readFileSync(
  new URL("../client/src/pages/LiveCalls.tsx", import.meta.url),
  "utf8"
);

describe("client-handover live calls presentation", () => {
  it("uses the final light dashboard system at source instead of legacy dark classes", () => {
    for (const rejected of [
      "bg-[#071326]",
      "bg-[#08172F]",
      "bg-[#0B1B37]",
      "bg-[#0E2142]",
      "bg-[#153B7A]",
      "border-white/10",
      "border-white/15",
      "bg-white/5",
      "text-white",
      "text-[#2F6FED]",
      "bg-[#EAF1FF]",
    ])
      expect(liveCalls).not.toContain(rejected);

    for (const required of [
      "border-[#DCE4EE]",
      "bg-white",
      "bg-[#F8FAFC]",
      "text-[#26354A]",
      "text-[#55788B]",
      "bg-[#EAF0F2]",
    ])
      expect(liveCalls).toContain(required);
  });

  it("records self-contained chunks for the live transcription boundary", () => {
    expect(liveCalls).toContain("function startRecordingCycle");
    expect(liveCalls).toContain("recorder.start();");
    expect(liveCalls).toContain("recorder.stop();");
    expect(liveCalls).toContain("const LIVE_AUDIO_CHUNK_MS = 2_500");
    expect(liveCalls).toContain("}, LIVE_AUDIO_CHUNK_MS);");
    expect(liveCalls).not.toContain("recorder.start(LIVE_AUDIO_CHUNK_MS)");
  });

  it("queues incremental coaching so a busy request cannot drop a newer signal", () => {
    expect(liveCalls).toContain("const LIVE_COACH_INTERVAL_MS = 5_000");
    expect(liveCalls).toContain('fetch("/api/live-calls/coach-stream"');
    expect(liveCalls).toContain("setTip(partial)");
    expect(liveCalls).toContain(
      "pendingCoachRef.current = { activeSessionId, text }"
    );
    expect(liveCalls).toContain("function scheduleCoaching");
    expect(liveCalls).toContain("transcriptRef.current.slice(-8_000)");
  });

  it("keeps the complete prepare-call-assist-closeout workflow", () => {
    for (const required of [
      "PRE-CALL BRIEF",
      "Start Live Companion",
      "LIVE TRANSCRIPT",
      "LIVE STRUCTURED NOTES",
      "Goals / intentions heard",
      "Facts / context heard",
      "Customer questions",
      "Objections",
      "Buying signals",
      "Commitments heard",
      "Callback requests",
      "Dates / times mentioned",
      "Likely next steps",
      "Still unresolved",
      "CALL OUTCOME",
      "Confirm outcome and prepare follow-up",
      "Live signals",
      "Current coaching",
    ])
      expect(liveCalls).toContain(required);
  });
});
