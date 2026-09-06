export function intradayTooltipLayout({ cursorX, plotLeft, plotRight, width, gutter = 16 } = {}) {
  const left = Number(plotLeft) || 0;
  const right = Number(plotRight) || left;
  const tooltipWidth = Math.max(1, Number(width) || 1);
  const safeGutter = Math.max(0, Number(gutter) || 0);
  const mid = (left + right) / 2;
  const preferred = Number(cursorX) > mid ? left + safeGutter : right - tooltipWidth - safeGutter;
  return Math.max(left + safeGutter, Math.min(right - tooltipWidth - safeGutter, preferred));
}

export function intradayViewportBounds({ width, height, plotLeft, plotRight, priceTop, volumeBottom } = {}) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const left = Math.max(0, Math.min(w, Number(plotLeft) || 0));
  const right = Math.max(left, Math.min(w, Number(plotRight) || w));
  const top = Math.max(0, Math.min(h, Number(priceTop) || 0));
  const bottom = Math.max(top, Math.min(h, Number(volumeBottom) || h));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}
