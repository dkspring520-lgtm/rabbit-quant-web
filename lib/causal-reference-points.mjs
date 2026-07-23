function validMinute(point) {
  return point
    && typeof point.time === "string"
    && Number.isFinite(point.price)
    && point.price > 0;
}

function percentMove(later, earlier) {
  return earlier > 0 ? ((later - earlier) / earlier) * 100 : 0;
}

function causalTurns(points, direction, limit = 2) {
  const turns = [];
  let lastConfirmationIndex = Number.NEGATIVE_INFINITY;
  for (let index = 6; index < points.length; index += 1) {
    // Keep independent observations apart so one rebound or pullback does not
    // flood the chart with several labels for the same move.
    if (index - lastConfirmationIndex < 16) continue;
    const current = points[index];
    const previous = points[index - 1];
    const windowStart = Math.max(0, index - 6);
    const history = points.slice(windowStart, index);
    const pivotPrice = direction === "正T"
      ? Math.min(...history.map((point) => point.price))
      : Math.max(...history.map((point) => point.price));
    const pivotIndex = history.findIndex((point) => point.price === pivotPrice);
    const pivot = history[Math.max(0, pivotIndex)];
    const reversal = direction === "正T"
      ? percentMove(current.price, pivotPrice)
      : percentMove(pivotPrice, current.price);
    const lastStep = direction === "正T"
      ? percentMove(current.price, previous.price)
      : percentMove(previous.price, current.price);

    // The marker is attached to the confirmation minute, never painted back
    // onto the earlier pivot. Both the pivot and the confirming move are
    // already known at this point, so the reference remains causal.
    if (pivot.time !== current.time && reversal >= 0.10 && lastStep >= 0.015) {
      turns.push({
        time: current.time,
        price: current.price,
        direction,
        score: 0,
        threshold: 0,
        edge: reversal,
        executable: false,
        stage: "watch",
        pairGap: null,
        pivotTime: pivot.time,
        pivotPrice,
        pivotLabel: direction === "正T" ? "此前低位参考" : "此前高位参考",
        pivotAssessment: "unconfirmed",
        confirmationLabel: direction === "正T" ? "反弹参考" : "回落参考",
        blockers: ["仅为当时可确认的转折参考", "自动补充参考，不是候补买卖点或下单指令"],
        reason: direction === "正T"
          ? `此前低点 ${pivotPrice.toFixed(2)} 后已确认反弹 ${reversal.toFixed(2)}%`
          : `此前高点 ${pivotPrice.toFixed(2)} 后已确认回落 ${reversal.toFixed(2)}%`,
      });
      lastConfirmationIndex = index;
    }
  }
  return sessionBalanced(turns, limit);
}

function sessionBalanced(items, limit = 2) {
  const unique = [];
  for (const item of items) {
    if (!item || unique.some((entry) => entry.time === item.time)) continue;
    unique.push(item);
  }
  if (unique.length <= limit) return unique;

  const morning = unique.find((item) => item.time < "1300");
  const afternoon = unique.find((item) => item.time >= "1300");
  if (limit >= 2 && morning && afternoon) {
    return [morning, afternoon];
  }
  return unique.slice(0, limit);
}

function rangeReference(points, direction) {
  // At 10:00 (or the last available minute for a shorter complete sample),
  // show a non-executable side reference from the prefix seen so far. This is
  // deliberately not called a signal and does not alter engine diagnostics.
  const confirmationIndex = Math.min(points.length - 1, 30);
  const prefix = points.slice(0, confirmationIndex + 1);
  const pivotPrice = direction === "正T"
    ? Math.min(...prefix.map((point) => point.price))
    : Math.max(...prefix.map((point) => point.price));
  const pivotIndex = prefix.findIndex((point) => point.price === pivotPrice);
  const pivot = prefix[Math.max(0, pivotIndex)];
  const current = prefix[confirmationIndex];

  return {
    time: current.time,
    price: current.price,
    direction,
    score: 0,
    threshold: 0,
    edge: 0,
    executable: false,
    stage: "watch",
    pairGap: null,
    pivotTime: pivot.time,
    pivotPrice,
    pivotLabel: direction === "正T" ? "截至当时低位" : "截至当时高位",
    pivotAssessment: "unconfirmed",
    confirmationLabel: direction === "正T" ? "低位参考" : "高位参考",
    blockers: ["尚未形成有效反转", "自动补充参考，不是候补买卖点或下单指令"],
    reason: direction === "正T"
      ? `截至 ${current.time} 的早盘低位参考为 ${pivotPrice.toFixed(2)}`
      : `截至 ${current.time} 的早盘高位参考为 ${pivotPrice.toFixed(2)}`,
  };
}

/**
 * Return up to two buy-side and two sell-side markers for a completed stock
 * day. Existing engine candidates take priority. Missing sides receive causal
 * observation references, never fabricated executable trades.
 */
export function buildCausalReferencePoints(minutes, observations = []) {
  const points = Array.isArray(minutes) ? minutes.filter(validMinute) : [];
  if (points.length < 12) return [];

  return ["正T", "反T"].flatMap((direction) => {
    const sameSide = Array.isArray(observations)
      ? observations.filter((item) => item?.direction === direction && !item.executable)
      : [];
    const rankedExisting = sameSide
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const stageDelta = Number(right.item.stage === "candidate") - Number(left.item.stage === "candidate");
        if (stageDelta) return stageDelta;
        const scoreDelta = Number(right.item.score ?? 0) - Number(left.item.score ?? 0);
        return scoreDelta || left.index - right.index;
      })
      .map(({ item }) => item);
    const generated = causalTurns(points, direction, 2);
    const selected = sessionBalanced([...rankedExisting, ...generated], 2);
    if (!selected.length) selected.push(rangeReference(points, direction));
    return selected;
  }).sort((left, right) => left.time.localeCompare(right.time));
}
