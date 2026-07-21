function labelKey(item) {
  return `${item?.time ?? ""}:${item?.direction ?? ""}`;
}

function labelPriority(item) {
  const stage = item?.stage === "candidate" ? 2 : 0;
  const assessment = item?.pivotAssessment === "confirmed"
    ? 2
    : item?.pivotAssessment === "strong"
      ? 1
      : 0;
  return stage * 1_000 + assessment * 100 + Number(item?.score ?? 0);
}

/**
 * Keep phone charts readable: every causal point may keep its dot, but only a
 * few high-value candidates receive text boxes. One label per direction is
 * reserved first so a dense one-sided move cannot hide the opposite setup.
 */
export function compactChartLabelKeys(observations, maxLabels = 3) {
  const candidates = (Array.isArray(observations) ? observations : [])
    .filter((item) => item && item.stage !== "watch")
    .map((item, index) => ({ item, index, priority: labelPriority(item) }));
  if (!candidates.length || maxLabels <= 0) return new Set();

  const ranked = [...candidates].sort((left, right) =>
    right.priority - left.priority
    || String(right.item.time).localeCompare(String(left.item.time))
    || left.index - right.index,
  );
  const selected = [];
  for (const direction of ["正T", "反T"]) {
    const best = ranked.find((entry) => entry.item.direction === direction);
    if (best && selected.length < maxLabels) selected.push(best);
  }
  for (const entry of ranked) {
    if (selected.length >= maxLabels) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  return new Set(selected.map(({ item }) => labelKey(item)));
}

export function compactChartLabelKey(item) {
  return labelKey(item);
}
