import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardContractProposal, validateRewardContractProposal } from "../lib/rl-research/dataset/reward-contract-proposal-v01214.8.mjs";

test("V0.12.14.8 proposal remains review-only", () => {
  const proposal = buildRewardContractProposal();
  assert.equal(validateRewardContractProposal(proposal), true);
  assert.equal(proposal.proposalOnly, true);
  assert.equal(proposal.rewardContractStatus, "PROPOSAL_ONLY");
  assert.equal(proposal.rewardArtifactStatus, "BLOCKED");
  assert.equal(proposal.decisionMatrix.approved, false);
  assert.equal(proposal.combinations.every(item => item.candidateOnly), true);
  assert.equal(proposal.markPriceCandidates.length, 5);
  assert.equal(proposal.multiActionCandidates.length, 5);
  assert.equal(proposal.consistencyMatrix.approved, false);
  assert.equal(proposal.completenessAudit.status, "BLOCKED");
  assert.equal(proposal.observedPriceResearchContract.contractId, "OBSERVED_PRICE_RESEARCH_CONTRACT_V1");
  assert.equal(proposal.observedPriceResearchContract.fieldLineageStatus, "VERIFIED");
  assert.equal(proposal.observedPriceResearchContract.priceSemanticsStatus, "UNVERIFIED");
  assert.equal(proposal.observedPriceResearchContract.valuation.markPriceApproved, false);
  assert.equal(proposal.observedPriceContractStatus, "PROPOSAL_ONLY");
  assert.equal(proposal.priceFieldLineage, "VERIFIED");
  assert.equal(proposal.priceSemantics, "UNVERIFIED");
});

test("proposal preserves accounting-closed fee and slippage semantics", () => {
  const proposal = buildRewardContractProposal();
  assert.match(proposal.feeSemantics.accountingClosed, /do not subtract fees again/);
  assert.match(proposal.slippageSemantics.accountingClosed, /directional slippage/);
  assert.equal(proposal.sourceReplayHash, "9fc48c1aef6f0cfd6349dab477deccfa32814cff15b86218f2bc059267cbca05");
});
