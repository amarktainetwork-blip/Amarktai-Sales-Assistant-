import { describe, expect, it } from "vitest";
import { crmDesktopViewport, normalizeCrmWheelDelta } from "./crmViewerInput";

describe("CRM viewer input normalization", () => {
  it("converts line and page wheel events into bounded pixel deltas", () => {
    expect(normalizeCrmWheelDelta(3, 0, 700)).toBe(3);
    expect(normalizeCrmWheelDelta(3, 1, 700)).toBe(120);
    expect(normalizeCrmWheelDelta(1, 2, 700)).toBe(700);
    expect(normalizeCrmWheelDelta(100, 2, 700)).toBe(1500);
    expect(normalizeCrmWheelDelta(-100, 2, 700)).toBe(-1500);
  });

  it("matches the available viewer instead of forcing a squashed artificial desktop width", () => {
    expect(crmDesktopViewport({ width: 720, height: 500 })).toEqual({
      width: 720,
      height: 500,
    });
    expect(crmDesktopViewport({ width: 1440, height: 900 })).toEqual({
      width: 1440,
      height: 900,
    });
    expect(crmDesktopViewport({ width: 250, height: 240 })).toEqual({
      width: 320,
      height: 360,
    });
  });
});
