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

export function fulfilledWatchlistSnapshots(results = []) {
  return results.flatMap((result) => (
    result?.status === "fulfilled" && result.value?.quote?.code ? [result.value] : []
  ));
}
