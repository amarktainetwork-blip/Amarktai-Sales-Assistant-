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

  it("matches ordinary CRM panels instead of forcing a wider minimum desktop", () => {
    expect(crmDesktopViewport({ width: 720, height: 500 })).toEqual({
      width: 720,
      height: 520,
    });
    expect(crmDesktopViewport({ width: 1440, height: 900 })).toEqual({
      width: 1440,
      height: 900,
    });
  });

  it("bounds extreme sizes to a stable remote browser envelope", () => {
    expect(crmDesktopViewport({ width: 320, height: 300 })).toEqual({
      width: 640,
      height: 520,
    });
    expect(crmDesktopViewport({ width: 2400, height: 1800 })).toEqual({
      width: 1600,
      height: 1000,
    });
  });
});
