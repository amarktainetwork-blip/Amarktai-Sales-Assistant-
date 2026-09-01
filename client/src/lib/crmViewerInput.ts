export function normalizeCrmWheelDelta(
  delta: number,
  deltaMode: number,
  viewportSize: number
) {
  const multiplier = deltaMode === 1 ? 40 : deltaMode === 2 ? viewportSize : 1;
  const pixels = Number.isFinite(delta) ? delta * multiplier : 0;
  return Math.max(-1_500, Math.min(1_500, pixels));
}

export function crmDesktopViewport(input: { width: number; height: number }) {
  return {
    width: Math.max(320, Math.round(input.width)),
    height: Math.max(360, Math.round(input.height)),
  };
}
