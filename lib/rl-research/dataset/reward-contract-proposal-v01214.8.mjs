import { createHash } from "node:crypto";

export const REPLAY_HASH = "9fc48c1aef6f0cfd6349dab477deccfa32814cff15b86218f2bc059267cbca05";
export const ACCOUNTING_HASH = "7c79dffd0f1bc6c2ad48e135b366d6cc8c9025ac386b1584e35ed464687d2db5";

export function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const candidate = (id, objective, formula, notes) => ({
  id, objective, formula, ...notes, candidateOnly: true, status: "PROPOSAL_ONLY"
});

export function buildRewardContractProposal() {
  const proposal = {
    title: "Offline RL V0.12.14.8 Reward Contract Proposal",
    version: "V0.12.14.8",
    proposalOnly: true,
    humanReviewRequired: true,
    hardStop: true,
    observedPriceResearchContract: {
      contractId: "OBSERVED_PRICE_RESEARCH_CONTRACT_V1",
      status: "PROPOSAL_ONLY",
      field: "marketState.price",
      semanticLabel: "Observed Reference Price",
      notEqual: ["close", "last_trade", "execution_price", "verified_market_close", "verified_1m_bar_close"],
      sourceLineage: ["Parquet close", "JSONL minutes.price", "marketState.price"],
      fieldLineageStatus: "VERIFIED",
      priceSemanticsStatus: "UNVERIFIED",
      allowedUsage: ["replay_observation", "portfolio_state_valuation_experiment", "factor_research", "offline_policy_experiment"],
      prohibitedUsage: ["real_order_book_execution_simulation", "claim_real_tick_price", "claim_verified_1m_close", "construct_ohlc", "construct_bid_ask_mid", "backfill_time"],
      valuation: { formulaCandidate: "cash + position * observedReferencePrice", status: "RESEARCH_ONLY", markPriceApproved: false },
      leakage: { futureOutcomeAllowedAs: "reward_target_only", futureFeatureInput: false, codeCausality: "PASS", temporalSemantics: "UNVERIFIED" },
      rewardRelationship: { approvesF1: false, approvesF2: false, approvesF3: false, approvesH1: false, approvesH2: false, approvesTerminal: false, approvesNoAction: false, approvesBlockedAction: false, rewardFormula: "BLOCKED" },
      humanReviewPoints: ["accept observed reference price as research valuation input", "accept portfolio valuation research", "accept observed-price changes as future reward outcome input", "enter Reward Contract review"].map(question => ({ question, approved: false, required: true }))
    },
    rewardObjectives: [
      candidate("F1_INCREMENTAL_PORTFOLIO_VALUE", "incremental portfolio value", "V_end - V_start", {
        pros: ["direct economic units", "portfolio-aware"], cons: ["requires approved horizon", "baseline semantics remain unresolved"],
        tTradingFit: "candidate", offlineRlFit: "candidate", valueQFit: "candidate"
      }),
      candidate("F2_PORTFOLIO_RETURN", "portfolio return", "(V_end - V_start) / max(|V_start|, epsilon)", {
        pros: ["scale-comparable"], cons: ["denominator and epsilon require approval", "can amplify small accounts"],
        tTradingFit: "candidate", offlineRlFit: "candidate", valueQFit: "candidate"
      }),
      candidate("F3_RISK_ADJUSTED_INCREMENTAL_VALUE", "risk-adjusted incremental value", "(V_end - V_start) - riskAdjustment", {
        pros: ["can represent drawdown or volatility risk"], cons: ["risk definition is not observable/approved", "may reinforce WAIT bias"],
        tTradingFit: "candidate", offlineRlFit: "candidate", valueQFit: "candidate"
      })
    ],
    startStates: [
      { id: "PRE_ACTION", definition: "state immediately before requested action", candidateOnly: true },
      { id: "POST_ACTION", definition: "state immediately after actual execution accounting", candidateOnly: true },
      { id: "EXECUTION_CONFIRMED", definition: "execution result plus confirmed post-action account state", candidateOnly: true }
    ],
    endStates: [
      { id: "H1_NEXT_BAR", definition: "next bar in the same episode", candidateOnly: true },
      { id: "H2_TERMINAL", definition: "approved terminal/session endpoint", candidateOnly: true }
    ],
    markPriceCandidates: [
      { id: "LAST", definition: "timestamp-local observed marketState.price", dataAvailability: "AVAILABLE_AS_PRICE_ONLY", candidateOnly: true },
      { id: "BID", definition: "best bid", dataAvailability: "NOT_CONFIRMED_IN_REPLAY", candidateOnly: true },
      { id: "ASK", definition: "best ask", dataAvailability: "NOT_CONFIRMED_IN_REPLAY", candidateOnly: true },
      { id: "MID", definition: "(bid + ask) / 2", dataAvailability: "BLOCKED_UNLESS_BID_ASK_PRESENT", candidateOnly: true },
      { id: "EXECUTION_REFERENCE", definition: "persisted fillPrice or marketState.price", dataAvailability: "ACTION_DEPENDENT", candidateOnly: true }
    ],
    horizons: [
      { id: "H1_A_FIXED_BAR", definition: "fixed number of same-episode bars", dataNeeds: ["same-episode next market state"], candidateOnly: true },
      { id: "H1_B_FIXED_TIME", definition: "fixed elapsed trading time", dataNeeds: ["timestamps", "session calendar"], candidateOnly: true },
      { id: "H1_C_NEXT_TRADING_DAY", definition: "next trading-session endpoint", dataNeeds: ["session boundary", "T+1 release semantics"], candidateOnly: true },
      { id: "H2_A_LONGER_BAR", definition: "longer fixed bar horizon", dataNeeds: ["same-episode bars"], candidateOnly: true },
      { id: "H2_B_SESSION", definition: "session endpoint", dataNeeds: ["session boundary"], candidateOnly: true },
      { id: "H2_C_TERMINAL", definition: "episode terminal endpoint", dataNeeds: ["terminal contract"], candidateOnly: true }
    ],
    feeSemantics: {
      accountingClosed: "Use post-action portfolio state whose cash already includes actual fees; do not subtract fees again.",
      explicitPenalty: "Candidate only; subtracting fees after accounting closure has HIGH double-counting risk.",
      candidateOnly: true
    },
    slippageSemantics: {
      accountingClosed: "Use persisted fillPrice, which includes directional slippage, and the resulting cash/account state.",
      explicitPenalty: "Candidate only; separately subtracting slippage has HIGH double-counting risk.",
      candidateOnly: true
    },
    tPlusOneAttribution: ["ACTION_LOCAL", "EXIT_LOCAL", "POSITION_INTERVAL", "TERMINAL_EPISODE"].map(id => ({ id, candidateOnly: true })),
    noActionCandidates: [
      "ZERO_REWARD", "OBSERVED_PORTFOLIO_MOVEMENT", "BENCHMARK_RELATIVE", "OPPORTUNITY_COST", "ACTION_RELATIVE_COUNTERFACTUAL"
    ].map(id => ({ id, candidateOnly: true, counterfactualAllowed: id === "ACTION_RELATIVE_COUNTERFACTUAL" ? false : undefined })),
    blockedActionCandidates: ["ZERO", "FIXED_PENALTY", "OPPORTUNITY_COST", "FEASIBILITY_AWARE", "NULL_REJECTED_TRANSITION"].map(id => ({ id, candidateOnly: true })),
    terminalCandidates: ["SESSION_END", "FIXED_HORIZON", "FORCED_FLAT", "OPEN_POSITION", "HYBRID"].map(id => ({ id, candidateOnly: true })),
    nullabilityCandidates: ["ALWAYS_NUMERIC", "COMPLETE_HORIZON_ONLY", "NULL_INCOMPLETE", "SHORTER_HORIZON", "TERMINAL_CENSORED"].map(id => ({ id, candidateOnly: true })),
    multiActionCandidates: [
      { id: "ACTION_LOCAL", definition: "attribute outcome to each action transition", doubleAttributionRisk: "HIGH", candidateOnly: true },
      { id: "INCREMENTAL", definition: "attribute observed transition increment", doubleAttributionRisk: "MEDIUM; baseline unavailable", candidateOnly: true },
      { id: "POSITION_INTERVAL", definition: "one exclusive holding interval", doubleAttributionRisk: "LOWER if ownership is exclusive", candidateOnly: true },
      { id: "TERMINAL", definition: "attribute at horizon or terminal", doubleAttributionRisk: "LOWER but sparse", candidateOnly: true },
      { id: "RETURN_TO_GO", definition: "defer outcome to return-to-go target", doubleAttributionRisk: "requires non-overlapping windows", candidateOnly: true }
    ],
    transition: { tuple: "(s_t, a_t, r_t, s_t+1)", rewardFormula: "NOT_APPROVED", candidateOnly: true },
    combinations: [
      { id: "COMBO_A_ACCOUNTING_CLOSED_NEXT_BAR", objective: "F1", start: "PRE_ACTION", end: "H1_NEXT_BAR", fee: "ACCOUNTING_CLOSED", slippage: "ACCOUNTING_CLOSED", tPlusOne: "ACTION_LOCAL", noAction: "OBSERVED_PORTFOLIO_MOVEMENT", blocked: "NULL_REJECTED_TRANSITION", terminal: "SESSION_END", nullability: "NULL_INCOMPLETE", candidateOnly: true },
      { id: "COMBO_B_RETURN_SESSION", objective: "F2", start: "EXECUTION_CONFIRMED", end: "H2_B_SESSION", fee: "ACCOUNTING_CLOSED", slippage: "ACCOUNTING_CLOSED", tPlusOne: "POSITION_INTERVAL", noAction: "ZERO_REWARD", blocked: "FEASIBILITY_AWARE", terminal: "OPEN_POSITION", nullability: "COMPLETE_HORIZON_ONLY", candidateOnly: true },
      { id: "COMBO_C_RISK_TERMINAL", objective: "F3", start: "POST_ACTION", end: "H2_C_TERMINAL", fee: "ACCOUNTING_CLOSED", slippage: "ACCOUNTING_CLOSED", tPlusOne: "TERMINAL_EPISODE", noAction: "BENCHMARK_RELATIVE", blocked: "ZERO", terminal: "HYBRID", nullability: "TERMINAL_CENSORED", candidateOnly: true }
    ],
    consistencyMatrix: {
      dimensions: ["objective", "start", "end", "H1", "H2", "markPrice", "fee", "slippage", "noAction", "blocked", "T+1", "terminal", "nullability", "multiAction", "leakage", "accountingConsistency", "doubleCountingRisk", "datasetReadiness"],
      rows: [
        { combination: "COMBO_A_ACCOUNTING_CLOSED_NEXT_BAR", status: "INCOMPLETE_PENDING_MARK_PRICE_MULTI_ACTION_TERMINAL_NULLABILITY", candidateOnly: true },
        { combination: "COMBO_B_RETURN_SESSION", status: "INCOMPLETE_PENDING_MARK_PRICE_SESSION_AND_NORMALIZATION", candidateOnly: true },
        { combination: "COMBO_C_RISK_TERMINAL", status: "INCOMPLETE_PENDING_RISK_MARK_PRICE_TERMINAL_AND_BLOCKED_POLICY", candidateOnly: true }
      ],
      approved: false, winner: null
    },
    decisionMatrix: {
      dimensions: ["semanticClarity", "tTradingFit", "offlineRlFit", "valueQFit", "accountingConsistency", "feeSlippageSafety", "tPlusOneConsistency", "terminalNullability", "leakage", "auditability", "complexity"],
      rowsAreComparativeOnly: true, winner: null, approved: false
    },
    recommendation: {
      recommendationOnly: true,
      reviewPriority: "COMBO_A_ACCOUNTING_CLOSED_NEXT_BAR",
      whyPreferred: ["smallest auditable boundary", "uses accounting-closed state", "avoids explicit fee/slippage duplication"],
      whyNotFinal: ["mark-price availability is incomplete", "multi-action attribution is unresolved", "horizon and terminal policy are not approved", "blocked/no-action semantics remain open"]
    },
    humanReviewChecklist: ["objective", "start/end state", "H1/H2", "fee/slippage", "no-action", "blocked", "T+1", "terminal", "nullability", "mark price", "multi-action", "normalization", "leakage"].map(item => ({ item, approved: false, required: true })),
    sourceReplayHash: REPLAY_HASH,
    sourceAccountingAuditHash: ACCOUNTING_HASH,
    rewardContractStatus: "PROPOSAL_ONLY",
    rewardFormula: "BLOCKED",
    rewardHorizon: "BLOCKED",
    rewardArtifactStatus: "BLOCKED",
    dataset: "BLOCKED", valueQ: "BLOCKED", v01215: "BLOCKED", v013: "BLOCKED",
    rlTraining: "NOT_STARTED", paperTrading: "NOT_ENTERED", realTrading: "NOT_ENTERED",
    completenessAudit: { status: "BLOCKED", markPrice: "UNRESOLVED", multiAction: "UNRESOLVED", noAction: "UNRESOLVED", blockedAction: "UNRESOLVED", tPlusOne: "UNRESOLVED", terminal: "UNRESOLVED", nullability: "UNRESOLVED", horizon: "BLOCKED", formula: "BLOCKED", accountingClosed: "PROPOSAL_ONLY" },
    observedPriceContractStatus: "PROPOSAL_ONLY",
    priceFieldLineage: "VERIFIED",
    priceSemantics: "UNVERIFIED",
    valuationPriceStatus: "RESEARCH_ONLY",
    codeCausality: "PASS",
    temporalSemantics: "UNVERIFIED"
  };
  return { ...proposal, proposalHash: hash(proposal) };
}

export function validateRewardContractProposal(proposal) {
  return proposal?.proposalOnly === true && proposal?.humanReviewRequired === true && proposal?.hardStop === true && proposal?.rewardContractStatus === "PROPOSAL_ONLY" && proposal?.rewardArtifactStatus === "BLOCKED" && proposal?.decisionMatrix?.approved === false && proposal?.recommendation?.recommendationOnly === true && proposal?.combinations?.every(c => c.candidateOnly === true) && proposal?.rewardFormula === "BLOCKED" && proposal?.rewardHorizon === "BLOCKED";
}
