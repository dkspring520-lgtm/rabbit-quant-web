const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export class TradingDecisionEngine {
  decide({ marketRegime = {}, sentimentState = {}, factorSnapshot = {}, positionState = {}, historicalPerformance = {} } = {}) {
    const trend = String(marketRegime.trend ?? marketRegime.marketRegime ?? "SIDEWAYS").toUpperCase();
    const panicRelease = sentimentState.panicRelease === true || ["panic_release", "recovery"].includes(String(sentimentState.state ?? sentimentState.sentiment ?? "").toLowerCase());
    const buyPressure = Number(factorSnapshot.buyPressure ?? sentimentState.buyPressure ?? 0);
    const sellPressure = Number(factorSnapshot.sellPressure ?? sentimentState.sellPressure ?? 0);
    const rapidRise = sentimentState.rapidRise === true || factorSnapshot.rapidRise === true;
    const stalling = sentimentState.stalling === true || factorSnapshot.stalling === true;
    const reboundLowVolume = sentimentState.reboundLowVolume === true || factorSnapshot.reboundLowVolume === true;
    let decision = "WAIT"; let score = 50; let confidence = 0.35; const reasons = [];
    if (trend === "UP" && panicRelease && buyPressure > sellPressure) { decision = "BUY"; score = 78; confidence = 0.78; reasons.push("上涨趋势", "恐慌释放", "买盘恢复"); }
    else if (trend === "UP" && rapidRise && stalling && sellPressure > buyPressure) { decision = "SELL_PART"; score = 72; confidence = 0.74; reasons.push("上涨后快速拉升", "滞涨", "卖压增加"); }
    else if (trend === "DOWN" && reboundLowVolume) { decision = "SELL"; score = 74; confidence = 0.72; reasons.push("下降趋势", "反弹无量"); }
    else if (trend === "SIDEWAYS") { decision = "HOLD"; score = 58; confidence = 0.55; reasons.push("震荡状态", "区间执行T"); }
    else reasons.push("条件不足，等待确认");
    const historicalWinRate = Number(historicalPerformance.winRate);
    if (Number.isFinite(historicalWinRate)) confidence = clamp(confidence + (historicalWinRate - 0.5) * 0.2);
    if (decision === "BUY" && positionState.canBuy === false) { decision = "WAIT"; reasons.push("持仓或资金限制"); }
    if (["SELL", "SELL_PART"].includes(decision) && positionState.canSell === false) { decision = "HOLD"; reasons.push("可卖持仓不足"); }
    return Object.freeze({ decision, score, confidence: Number(confidence.toFixed(4)), reason: reasons.join("；"), affectsPaperExecution: false, affectsSmartT: false, affectsShadowV2: false, canAutoTrade: false });
  }
}
