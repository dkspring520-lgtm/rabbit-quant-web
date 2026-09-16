// Sample-out evidence (2025-2026), with a 0.20% round-trip cost hurdle.
export const TF_FEATURE_RISK_EVIDENCE = {
  0: { samples: 61030, meanReturnPct30: 0.00479, recoverRate30: 0.3302 },
  20: { samples: 4849, meanReturnPct30: 0.01369, recoverRate30: 0.3771 },
  25: { samples: 3013, meanReturnPct30: -0.01697, recoverRate30: 0.3379 },
  35: { samples: 2464, meanReturnPct30: -0.09202, recoverRate30: 0.2346 },
  45: { samples: 885, meanReturnPct30: -0.01744, recoverRate30: 0.3418 },
  55: { samples: 131, meanReturnPct30: -0.1861, recoverRate30: 0.1385 },
  60: { samples: 46, meanReturnPct30: -0.26483, recoverRate30: 0.1957 },
  80: { samples: 45, meanReturnPct30: -0.19314, recoverRate30: 0.2222 },
};
export function summarizeTFlyRiskEvidence(score) { return TF_FEATURE_RISK_EVIDENCE[score] ?? null; }
