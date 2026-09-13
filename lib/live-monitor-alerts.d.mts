export function isRecentCausalEvent(latestTime?: string|null, eventTime?: string|null, maxLagMinutes?: number): boolean;
export function isVwapDisplacementObservation(observation?: Record<string, unknown>|null): boolean;
export function selectLatestAlertableObservation<T = Record<string, unknown>>(observations?: T[]): T|null;
export function compactChartObservations<T = Record<string, unknown>>(observations?: T[], episodeMinutes?: number, options?: { mergeRepairPhases?: boolean; retainAll?: boolean }): T[];
export function compactCandidateAlertHistory<T = Record<string, unknown>>(alerts?: T[], options?: { episodeMinutes?: number; ignoreBefore?: string|null }): T[];
export function compactShadowChartActions<T = Record<string, unknown>>(entries?: T[], episodeMinutes?: number): T[];
export function compactRepairChartMarkers<T = Record<string, unknown>>(observations?: T[], episodeMinutes?: number): T[];
export function fulfilledWatchlistSnapshots<T = Record<string, unknown>>(results?: T[]): T[];
