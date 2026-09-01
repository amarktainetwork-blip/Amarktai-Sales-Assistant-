export function normalizeCrmWheelDelta(
  delta: number,
  deltaMode: number,
  viewportSize: number
) {
  const multiplier = deltaMode === 1 ? 40 : deltaMode === 2 ? viewportSize : 1;
  const pixels = Number.isFinite(delta) ? delta * multiplier : 0;
  return Math.max(-1_500, Math.min(1_500, pixels));
}

/**
 * Keep the remote desktop close to the size the customer actually sees.
 * The old 1024x640 floor forced a wide page into narrower CRM panels, which
 * made sign-in pages look zoomed/squashed and made pointer mapping feel wrong.
 */
export function crmDesktopViewport(input: {
  width: number;
  height: number;
}) {
  return {
    width: Math.max(640, Math.min(1_600, Math.round(input.width))),
    height: Math.max(520, Math.min(1_000, Math.round(input.height))),
  };
}
