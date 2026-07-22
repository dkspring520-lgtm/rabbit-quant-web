import historicalEvidence from "@/public/research/zijin-factor-evidence.json";
import patternDiscovery from "@/public/research/zijin-pattern-discovery.json";
import peerPatternDiscovery from "@/public/research/zijin-peer-pattern-discovery.json";
import externalFactorReadiness from "@/public/research/zijin-external-factor-readiness.json";
import round2RegimeAudit from "@/public/research/zijin-round2-regime-audit.json";
import round2WalkForward from "@/public/research/zijin-round2-walk-forward.json";
import round3Nested from "@/public/research/zijin-round3-summary.json";
import round4Report from "@/public/research/zijin-round4-report.json";
import round4Protocol from "@/scripts/zijin-round4-protocol.json";
import round5Report from "@/public/research/zijin-round5-report.json";
import round5Protocol from "@/scripts/zijin-round5-protocol.json";
import round6Report from "@/public/research/zijin-round6-report.json";
import round6Protocol from "@/scripts/zijin-round6-protocol.json";
import round9Report from "@/public/research/zijin-round9-report.json";
import round9Protocol from "@/scripts/zijin-round9-protocol.json";

// Keep historical research evidence out of the trading-console entry bundle.
// The browser downloads this module only after the user opens single-stock research.
export const zijinResearchBundle = Object.freeze({
  historicalEvidence,
  patternDiscovery,
  peerPatternDiscovery,
  externalFactorReadiness,
  round2RegimeAudit,
  round2WalkForward,
  round3Nested,
  round4Report,
  round4Protocol,
  round5Report,
  round5Protocol,
  round6Report,
  round6Protocol,
  round9Report,
  round9Protocol,
});
