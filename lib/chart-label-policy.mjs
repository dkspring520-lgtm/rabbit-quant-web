// Only low-priority observation text is collapsed. A strategy candidate is
// not an observation layer just because its execution gates are still blocked.
export function persistentChartLabel(strategy, label, mode = 'compact') {
  return mode === 'full' || !['反弹观察', '回落观察', '修复观察'].includes(label);
}

export function selectCompactChartLabels(markers, scoreOf) {
  const best = new Map();
  for (const marker of markers) {
    if (!marker.labelVisible || !marker.labelRendered) continue;
    const key = `${marker.strategy}:${marker.isSell}`;
    const previous = best.get(key);
    const score = scoreOf(marker) ?? -1;
    const previousScore = previous ? scoreOf(previous) ?? -1 : -1;
    if (!previous || score > previousScore
      || (score === previousScore && marker.observation.time > previous.observation.time)) best.set(key, marker);
  }
  return markers.map(marker => ({ ...marker,
    labelRendered: marker.labelVisible && best.get(`${marker.strategy}:${marker.isSell}`) === marker,
  }));
}
