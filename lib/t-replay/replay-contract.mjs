export const REPLAY_VERSION = "1.0.0";
export const REPLAY_MODE = "RESEARCH_REPLAY";
export const OUTCOME_HORIZONS = Object.freeze([1, 3, 5, 10]);

export function replayAuditMetadata() { return { replayVersion: REPLAY_VERSION, replayMode: REPLAY_MODE, lookahead: false, futureDataInObservation: false, outcomeSeparated: true, rlEligible: false }; }
