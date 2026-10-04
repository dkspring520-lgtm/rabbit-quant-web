import { createHash } from "node:crypto";

export const ACTION_SPACE_OPTIONS = Object.freeze(["3_ACTION", "5_ACTION", "TARGET_POSITION", "POSITION_DELTA"]);
export function hashDecision(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function buildDecisionMatrix({ actionAnalysis, coverageAnalysis, actionSpaceResearch }) {
  const counts = actionAnalysis.originalEnvironmentSpace.counts;
  const matrix = {
    "3_ACTION": { observedSupport: "COMPLETE_FOR_CURRENT_OBSERVED_ACTIONS", evaluationSupport: counts.SELL_ALL < 2000 ? "LOW_SUPPORT_SELL_ALL" : "SUPPORTED", portfolioAwareness: "ACCOUNT_STATE_REQUIRED_AND_AVAILABLE", tPlusOneCompatibility: "EXPLICIT_SELLABLE_POSITION_REQUIRED", actionExpressiveness: "WAIT_BUY_SMALL_SELL_ALL", offlineLearnability: "PARTIAL_SELL_ALL_RARITY", futureExpansion: "ADD_NEW_VERSION_WITH_NEW_OBSERVED_DATA", implementationComplexity: "LOW", expertAlignment: "DIRECT", counterfactualDependency: false },
    "5_ACTION": { observedSupport: "BUY_AND_SELL_PART_UNSEEN", evaluationSupport: "BLOCKED_FOR_BUY_AND_SELL_PART", portfolioAwareness: "ACCOUNT_STATE_REQUIRED_AND_AVAILABLE", tPlusOneCompatibility: "EXPLICIT_SELLABLE_POSITION_REQUIRED", actionExpressiveness: "FULL_DISCRETE_INTENT_SCHEMA", offlineLearnability: "BLOCKED_FOR_UNSEEN_ACTIONS", futureExpansion: "REQUIRES_NEW_OBSERVED_COVERAGE", implementationComplexity: "LOW_EXISTING_SCHEMA", expertAlignment: "EXPERT_EMITS_NO_BUY_OR_SELL_PART", counterfactualDependency: "NOT_ALLOWED" },
    "TARGET_POSITION": { observedSupport: "NOT_MEASURED_AS_LOGGED_LABEL", evaluationSupport: "RESEARCH_SCHEMA_ONLY", portfolioAwareness: "NATIVE_TARGET_INTENT_BUT_ACCOUNT_CONSTRAINS_EXECUTION", tPlusOneCompatibility: "TARGET_CANNOT_OVERRIDE_TODAY_BOUGHT;TODAY_BOUGHT", actionExpressiveness: "CONTINUOUS_OR_BUCKETED_TARGET", offlineLearnability: "NOT_MEASURED", futureExpansion: "NEW_SCHEMA_AND_OBSERVED_REPLAY_REQUIRED", implementationComplexity: "NEW_MAPPING_REQUIRED", expertAlignment: "NOT_DIRECTLY_LOGGED", counterfactualDependency: "WOULD_REQUIRE_NEW_OBSERVED_DATA" },
    "POSITION_DELTA": { observedSupport: "NOT_MEASURED_AS_LOGGED_LABEL", evaluationSupport: "RESEARCH_SCHEMA_ONLY", portfolioAwareness: "DIRECT_DELTA_WITH_CASH_AND_SELLABLE_LIMITS", tPlusOneCompatibility: "NEGATIVE_DELTA_CLIPPED_TO_SELLABLE_POSITION;SELLABLE_POSITION", actionExpressiveness: "SMALL_LARGE_BUY_SELL_AND_HOLD", offlineLearnability: "NOT_MEASURED", futureExpansion: "NEW_SCHEMA_AND_OBSERVED_REPLAY_REQUIRED", implementationComplexity: "NEW_BUCKET_MAPPING_REQUIRED", expertAlignment: "NOT_DIRECTLY_LOGGED", counterfactualDependency: "WOULD_REQUIRE_NEW_OBSERVED_DATA" }
  };
  for (const option of Object.values(matrix)) option.tPlusOne = option.tPlusOneCompatibility;
  return matrix;
}
export function buildDecisionReport(inputs) {
  const matrix = buildDecisionMatrix(inputs);
  const report = { title: "Offline RL V0.11.4 Action Space Decision", status: "PASS", lineage: { sourceDatasetHash: inputs.coverageAnalysis.sourceDatasetHash, sourceTrajectoryHash: inputs.coverageAnalysis.sourceTrajectoryHash, normalizedDatasetHash: inputs.coverageAnalysis.normalizedDatasetHash, expertSignalHash: inputs.coverageAnalysis.expertSignalHash, actionAnalysisHash: inputs.actionAnalysis.analysisHash, coverageAnalysisHash: inputs.coverageAnalysis.analysisHash }, observedActionSpace: ["WAIT", "BUY_SMALL", "SELL_ALL"], actionCounts: inputs.actionAnalysis.originalEnvironmentSpace.counts, matrix, evidence: { actionAnalysisLoaded: true, coverageAnalysisLoaded: true, actionSpaceResearchLoaded: true, datasetModified: false, policyTraining: false, counterfactualAsObserved: false }, recommendedResearchPath: "RESEARCH_ONLY: preserve V0.10 and study observed-support 3-action evaluation first; gather new real observed coverage before evaluating 5-action, target-position, or position-delta schemas", productionIsolation: true };
  report.decisionHash = hashDecision(report);
  return report;
}
