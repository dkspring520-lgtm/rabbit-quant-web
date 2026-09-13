export function groupCyclePerformance(cycles = []) {
  const groups = new Map();
  for (const cycle of cycles) {
    const session = String(cycle.entryTime ?? "").slice(0, 2) < "12" ? "morning" : "afternoon";
    const key = `${cycle.direction}:${session}`;
    const group = groups.get(key) ?? { direction: cycle.direction, session, cycles: 0, wins: 0, net: 0, winRatePct: 0 };
    group.cycles += 1; group.wins += cycle.net > 0 ? 1 : 0; group.net = Number((group.net + cycle.net).toFixed(2));
    group.winRatePct = Number((group.wins / group.cycles * 100).toFixed(2)); groups.set(key, group);
  }
  return [...groups.values()];
}
