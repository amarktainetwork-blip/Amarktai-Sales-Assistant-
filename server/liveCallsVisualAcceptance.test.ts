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

  it("records independently decodable PCM WAV chunks for live transcription", () => {
    expect(liveCalls).toContain("function encodePcmWav");
    expect(liveCalls).toContain('write(0, "RIFF")');
    expect(liveCalls).toContain('write(8, "WAVE")');
    expect(liveCalls).toContain('type: "audio/wav"');
    expect(liveCalls).toContain("const LIVE_AUDIO_FIRST_CHUNK_MS = 1_000");
    expect(liveCalls).toContain("const LIVE_AUDIO_CHUNK_MS = 2_000");
    expect(liveCalls).toContain("context.createScriptProcessor");
    expect(liveCalls).not.toContain("recorder.start(LIVE_AUDIO_CHUNK_MS)");
  });

  it("queues incremental coaching so a busy request cannot drop a newer signal", () => {
    expect(liveCalls).toContain("const LIVE_COACH_INTERVAL_MS = 300");
    expect(liveCalls).toContain('fetch("/api/live-calls/coach-stream"');
    expect(liveCalls).toContain("setTip(partial)");
    expect(liveCalls).toContain(
      "pendingCoachRef.current = { activeSessionId, text, manualHelp: false }"
    );
    expect(liveCalls).toContain("function scheduleCoaching");
    expect(liveCalls).toContain("eventPacket.slice(-1_500)");
    expect(liveCalls).toContain("coachedSignalRef");
  });

  it("checkpoints call capture before review and on accidental page exit", () => {
    expect(liveCalls).toContain('"/api/live-calls/stop"');
    expect(liveCalls).toContain("checkpointSessionForReview");
    expect(liveCalls).toContain("navigator.sendBeacon");
    expect(liveCalls).toContain("await pendingRef.current");
  });

  it("keeps the salesperson-led prepare-call-review-finish workflow without live clutter", () => {
    for (const required of [
      "PRE-CALL BRIEF",
      "Start Live Companion",
      "LIVE TRANSCRIPT",
      "YOUR NOTES",
      "SALES ASSIST",
      "Help me",
      "SUMMARY DRAFT",
      "CALL OUTCOME",
      "Confirm outcome and prepare follow-up",
      "CALL SUMMARY",
      "Listening — no intervention needed.",
    ])
      expect(liveCalls).toContain(required);

    for (const removed of [
      "LIVE STRUCTURED NOTES",
      "Goals / intentions heard",
      "Facts / context heard",
      "Buying signals",
      "Commitments heard — confirm speaker",
      "Likely next steps",
      "Live signals",
    ])
      expect(liveCalls).not.toContain(removed);
  });

  it("treats manual notes as salesperson-authored evidence and makes Help me explicit", () => {
    expect(liveCalls).toContain("manualNotesRef");
    expect(liveCalls).toContain("amarktai-live-call-notes:");
    expect(liveCalls).toContain("manualNotes: manualNotesRef.current");
    expect(liveCalls).toContain("manualHelp");
    expect(liveCalls).toContain("requestManualHelp");
    expect(liveCalls).toContain("/api/live-calls/review-summary");
  });
});