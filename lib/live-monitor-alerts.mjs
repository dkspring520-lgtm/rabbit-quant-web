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
    observation?.stage === "candidate" || isVwapDisplacementObservation(observation)
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

    if (observationPriority(observation) >= observationPriority(episode.observation)) {
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
