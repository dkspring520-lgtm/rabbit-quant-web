function minuteOfDay(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length !== 4) return null;
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isRecentCausalEvent(latestTime, eventTime, maxLagMinutes = 3) {
  const latest = minuteOfDay(latestTime);
  const event = minuteOfDay(eventTime);
  if (latest == null || event == null) return false;
  const lag = latest - event;
  return lag >= 0 && lag <= maxLagMinutes;
}

export function isVwapDisplacementObservation(observation) {
  return observation?.stage === "watch"
    && /偏离\s*VWAP/i.test(String(observation.reason ?? ""));
}

export function selectLatestAlertableObservation(observations = []) {
  return [...observations].reverse().find((observation) => (
    observation?.stage === "candidate"
    || observation?.repairPhase === "bottom-watch"
    || isVwapDisplacementObservation(observation)
  ));
}

function observationPriority(observation) {
  if (observation?.repairPhase === "repair-confirmed") return 4;
  if (observation?.repairPhase === "bottom-watch") return 2;
  if (observation?.pivotAssessment === "confirmed") return 3;
  if (observation?.pivotAssessment === "strong") return 2;
  if (observation?.stage === "candidate") return 1;
  return 0;
}

export function compactChartObservations(observations = [], episodeMinutes = 30, { mergeRepairPhases = false, retainAll = false } = {}) {
  const visible = observations
    .filter((observation) => observation && !observation.executable)
    .sort((left, right) => (minuteOfDay(left.time) ?? 0) - (minuteOfDay(right.time) ?? 0));
  if (retainAll) {
    return [...visible];
  }
  const episodes = [];

  for (const observation of visible) {
    const eventMinute = minuteOfDay(observation.time);
    const episode = episodes.findLast((item) => (
      item.direction === observation.direction
      && (mergeRepairPhases
        || ((!item.repairPhase && !observation.repairPhase)
        || item.repairPhase === observation.repairPhase)
      )
      && eventMinute != null
      && item.startedAt != null
      && eventMinute >= item.startedAt
      && eventMinute - item.startedAt <= episodeMinutes
    ));

    if (!episode) {
      episodes.push({
        direction: observation.direction,
        repairPhase: observation.repairPhase ?? null,
        startedAt: eventMinute,
        observation,
      });
      continue;
    }

    if (observationPriority(observation) >= observationPriority(episode.observation)) {
      episode.observation = observation;
    }
  }

  return episodes
    .map((episode) => episode.observation)
    .sort((left, right) => (minuteOfDay(left.time) ?? 0) - (minuteOfDay(right.time) ?? 0));
}

function alertMinute(alert) {
  const marketTime = String(alert?.marketTime ?? "").replace(/\D/g, "").slice(-4);
  if (/^\d{4}$/.test(marketTime)) return minuteOfDay(marketTime);
  const createdAt = alert?.createdAt ? new Date(alert.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  return createdAt.getHours() * 60 + createdAt.getMinutes();
}

function candidateAlertPriority(alert) {
  const text = `${alert?.title ?? ""} ${alert?.message ?? ""}`;
  if (/确认|修复已成|回踩|买压|卖压/.test(text)) return 3;
  if (/候选|修复|偏离/.test(text)) return 2;
  return 1;
}

// The audit log intentionally retains every source-level event. The chart does
// not need to repeat them: a same-side burst is one human decision episode.
export function compactCandidateAlertHistory(alerts = [], { episodeMinutes = 20, ignoreBefore = null } = {}) {
  const openingMinute = ignoreBefore == null ? null : minuteOfDay(ignoreBefore);
  const candidates = alerts
    .filter((alert) => alert?.level === "candidate")
    .map((alert) => ({ alert, minute: alertMinute(alert) }))
    .filter(({ minute }) => minute != null && (openingMinute == null || minute >= openingMinute))
    .sort((left, right) => left.minute - right.minute);
  const episodes = [];

  for (const candidate of candidates) {
    const side = candidate.alert.rabbit === "sell" ? "sell" : "buy";
    const episode = episodes.findLast((item) => (
      item.side === side
      && candidate.minute >= item.startedAt
      && candidate.minute - item.startedAt <= episodeMinutes
    ));
    if (!episode) {
      episodes.push({ side, startedAt: candidate.minute, candidate });
      continue;
    }
    if (candidateAlertPriority(candidate.alert) >= candidateAlertPriority(episode.candidate.alert)) {
      episode.candidate = candidate;
    }
  }

  return episodes
    .map((episode) => episode.candidate.alert)
    .sort((left, right) => (alertMinute(left) ?? 0) - (alertMinute(right) ?? 0));
}

function shadowActionPhase(action) {
  const side = String(action?.side ?? "");
  if (action?.direction === "反T") return side.includes("卖") ? "entry" : "exit";
  return side.includes("买") ? "entry" : "exit";
}

// Keep entry and exit markers, but collapse repeated same-phase shadow actions
// into one visual reminder per strategy/direction episode. Replay actions remain
// untouched; this helper only shapes the chart presentation.
export function compactShadowChartActions(entries = [], episodeMinutes = 20) {
  const rows = entries
    .map((entry, index) => {
      const action = entry?.action ?? entry;
      return {
        entry,
        index,
        minute: minuteOfDay(action?.time),
        strategy: entry?.strategy ?? "shadow",
        direction: action?.direction ?? "正T",
        phase: shadowActionPhase(action),
      };
    })
    .filter((row) => row.minute != null)
    .sort((left, right) => left.minute - right.minute || left.index - right.index);
  const episodes = [];

  for (const row of rows) {
    const episode = episodes.findLast((item) => (
      item.strategy === row.strategy
      && item.direction === row.direction
      && item.phase === row.phase
      && row.minute >= item.startedAt
      && row.minute - item.startedAt <= episodeMinutes
    ));
    if (!episode) {
      episodes.push({
        strategy: row.strategy,
        direction: row.direction,
        phase: row.phase,
        startedAt: row.minute,
        row,
      });
      continue;
    }
    episode.row = row;
  }

  return episodes
    .map((episode) => episode.row)
    .sort((left, right) => left.minute - right.minute || left.index - right.index)
    .map((row) => row.entry);
}

function repairMarkerPriority(observation) {
  if (observation?.repairPhase === "repair-confirmed") return 3;
  if (observation?.repairPhase === "bottom-watch") return 2;
  if (observation?.repairPhase === "repair-extended") return 1;
  return 0;
}

// Replay keeps every strict L2 event in the audit trail, but the price chart
// only needs one representative marker per causal repair wave. Otherwise a
// sideways afternoon can render a wall of overlapping "L2 repair" bubbles.
export function compactRepairChartMarkers(observations = [], episodeMinutes = 40) {
  const repairRows = observations
    .filter((observation) => observation?.repairPhase)
    .sort((left, right) => (minuteOfDay(left.time) ?? 0) - (minuteOfDay(right.time) ?? 0));
  const episodes = [];

  for (const observation of repairRows) {
    const eventMinute = minuteOfDay(observation.time);
    const episode = episodes.findLast((item) => (
      item.direction === observation.direction
      && eventMinute != null
      && item.startedAt != null
      && eventMinute >= item.startedAt
      && eventMinute - item.startedAt <= episodeMinutes
    ));

    if (!episode) {
      episodes.push({
        direction: observation.direction,
        startedAt: eventMinute,
        observation,
      });
      continue;
    }

    if (repairMarkerPriority(observation) >= repairMarkerPriority(episode.observation)) {
      episode.observation = observation;
    }
  }

  return episodes
    .map((episode) => episode.observation)
    .sort((left, right) => (minuteOfDay(left.time) ?? 0) - (minuteOfDay(right.time) ?? 0));
}

export function fulfilledWatchlistSnapshots(results = []) {
  return results.flatMap((result) => (
    result?.status === "fulfilled" && result.value?.quote?.code ? [result.value] : []
  ));
}
