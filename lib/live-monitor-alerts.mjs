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
  if (observation?.pivotAssessment === "confirmed") return 3;
  if (observation?.pivotAssessment === "strong") return 2;
  if (observation?.stage === "candidate") return 1;
  return 0;
}

export function compactChartObservations(observations = [], episodeMinutes = 30) {
  const visible = observations.filter((observation) => observation && !observation.executable);
  const episodes = [];

  for (const observation of visible) {
    const eventMinute = minuteOfDay(observation.time);
    const episode = episodes.findLast((item) => (
      item.direction === observation.direction
      && ((!item.repairPhase && !observation.repairPhase)
        || item.repairPhase === observation.repairPhase)
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
