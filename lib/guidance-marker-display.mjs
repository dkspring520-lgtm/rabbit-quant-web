// Screen-space compaction only. Never feeds signals, alerts or event history.
// Coordinates are the chart's SVG units, so zooming reveals more detail.
export function compactGuidanceMarkers(markers) {
  const kept = [];
  for (const marker of [...markers].reverse()) {
    const nearby = kept.find(item => item.kind === marker.kind
      && Math.abs(item.x - marker.x) < 18 && Math.abs(item.y - marker.y) < 12);
    if (nearby) nearby.displayCount += 1;
    else kept.push({ ...marker, displayCount: 1 });
  }
  return kept.reverse();
}
