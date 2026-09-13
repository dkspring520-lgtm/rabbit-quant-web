// Condition coverage, not a calibrated probability of a profitable trade.
// Callers must supply evidence available at the decision minute only.
export function scoreProfitExit({ holdingConfirmed = false, netProfit = 0, targetReached = false, protectionArmed = false, reversalConfirmed = false } = {}) {
  const evidence = {
    holdingConfirmed: holdingConfirmed === true,
    positiveAfterCosts: typeof netProfit === 'number' && Number.isFinite(netProfit) && netProfit > 0,
    profitObjective: targetReached === true || protectionArmed === true,
    exitTrigger: targetReached === true || reversalConfirmed === true,
  };
  const score = Object.values(evidence).filter(Boolean).length * 25;
  // Every exit prerequisite is mandatory. A partial coverage score must not
  // bypass holding time or an unarmed profit objective.
  return { score, evidence, kind: 'exit-condition-coverage', qualified: Object.values(evidence).every(Boolean) };
}
