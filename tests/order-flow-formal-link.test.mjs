import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDER_FLOW_FORMAL_LINK_CONTRACT,
  relateOrderFlowShadowToFormalSignal,
} from "../lib/order-flow-formal-link.mjs";

const formalBuy = Object.freeze({
  direction: "正T",
  status: "ready",
  action: "买入",
  confidence: 84,
});

const positiveRadar = Object.freeze({
  available: true,
  scores: { stance: "低吸观察", lowBuy: 82, takeProfit: 24 },
  delta: { threeMinute: 2_000_000 },
  divergence: { label: "底背离" },
  absorption: { label: "卖方被吸收" },
});

const reverseRadar = Object.freeze({
  available: true,
  scores: { stance: "止盈观察", lowBuy: 18, takeProfit: 86 },
  delta: { threeMinute: -2_000_000 },
  divergence: { label: "顶背离" },
  absorption: { label: "买方被吸收" },
});

test("same-direction order flow creates only an informational alignment", () => {
  const result = relateOrderFlowShadowToFormalSignal({ formalSignal: formalBuy, orderFlowRadar: positiveRadar });
  assert.equal(result.relation, "aligned");
  assert.equal(result.state, "aligned");
  assert.equal(result.tone, "support");
  assert.equal(result.label, "影子同向");
  assert.equal(result.formal.direction, "正T");
  assert.match(result.detail, /不提高正式信号等级/);
  assert.match(result.scoreLabel, /正T 82分.*反T 24分/);
});

test("opposing order flow leaves the exact same formal action untouched", () => {
  const aligned = relateOrderFlowShadowToFormalSignal({ formalSignal: formalBuy, orderFlowRadar: positiveRadar });
  const conflict = relateOrderFlowShadowToFormalSignal({ formalSignal: formalBuy, orderFlowRadar: reverseRadar });
  assert.equal(conflict.relation, "conflict");
  assert.equal(conflict.state, "divergent");
  assert.equal(conflict.tone, "caution");
  assert.match(conflict.detail, /不被锁定或改向/);
  assert.deepEqual(conflict.formal, aligned.formal);
  assert.deepEqual(formalBuy, { direction: "正T", status: "ready", action: "买入", confidence: 84 });
});

test("the linkage contract is display-only even under a disagreement", () => {
  const result = relateOrderFlowShadowToFormalSignal({ formalSignal: formalBuy, orderFlowRadar: reverseRadar });
  for (const key of [
    "displayOnly",
    "affectsFormal",
    "canCreateSignal",
    "canBlockFormal",
    "canModifyFormalDirection",
    "canModifyFormalScore",
    "canEnableExecution",
  ]) {
    assert.equal(result[key], ORDER_FLOW_FORMAL_LINK_CONTRACT[key]);
  }
  assert.equal(result.displayOnly, true);
  assert.equal(result.affectsFormal, false);
  assert.equal(result.canCreateSignal, false);
  assert.equal(result.canBlockFormal, false);
  assert.equal(result.canModifyFormalDirection, false);
  assert.equal(result.canModifyFormalScore, false);
  assert.equal(result.canEnableExecution, false);
});

test("a radar cannot manufacture a formal signal when the formal engine is quiet", () => {
  const result = relateOrderFlowShadowToFormalSignal({ orderFlowRadar: positiveRadar });
  assert.equal(result.relation, "no-formal-signal");
  assert.equal(result.state, "waiting");
  assert.equal(result.formalDirection, null);
  assert.equal(result.shadowDirection, "正T");
  assert.match(result.detail, /不能单独生成买卖/);
  assert.equal(result.canCreateSignal, false);
});

test("missing or neutral flow remains informational and never changes a formal side", () => {
  const unavailable = relateOrderFlowShadowToFormalSignal({
    formalSignal: formalBuy,
    orderFlowRadar: { available: false, reason: "L2数据过期" },
  });
  assert.equal(unavailable.relation, "order-flow-unavailable");
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.formal.direction, "正T");
  assert.equal(unavailable.formal.status, "ready");
  assert.equal(unavailable.formal.action, "买入");
  assert.equal(unavailable.formal.score, 84);
  assert.match(unavailable.detail, /保持原判断/);

  const neutral = relateOrderFlowShadowToFormalSignal({
    formalSignal: formalBuy,
    orderFlowRadar: { available: true, scores: { stance: "等待确认", lowBuy: 52, takeProfit: 49 } },
  });
  assert.equal(neutral.relation, "neutral");
  assert.equal(neutral.state, "neutral");
  assert.equal(neutral.formal.direction, "正T");
  assert.equal(neutral.shadowDirection, null);
});

test("linkage does not mutate its caller-owned inputs", () => {
  const formal = { direction: "反T", status: "ready", action: "卖出", score: 76 };
  const radar = { available: true, scores: { stance: "低吸观察", lowBuy: 80, takeProfit: 12 } };
  const formalBefore = structuredClone(formal);
  const radarBefore = structuredClone(radar);
  const result = relateOrderFlowShadowToFormalSignal({ formalSignal: formal, orderFlowRadar: radar });
  assert.equal(result.relation, "conflict");
  assert.deepEqual(formal, formalBefore);
  assert.deepEqual(radar, radarBefore);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.formal), true);
  assert.equal(Object.isFrozen(result.shadow), true);
});

test("a closing formal action compares with the immediate buy or sell side, not the cycle name", () => {
  const closingReverseTBuyback = {
    direction: "反T",
    side: "buy",
    action: "反T买回",
    status: "ready",
    time: "1013",
  };
  const currentLowBuy = { ...positiveRadar, asOfTime: "1014" };
  const result = relateOrderFlowShadowToFormalSignal({
    formalSignal: closingReverseTBuyback,
    orderFlowRadar: currentLowBuy,
  });
  assert.equal(result.formal.direction, "反T");
  assert.equal(result.formal.comparisonDirection, "正T");
  assert.equal(result.formal.side, "buy");
  assert.equal(result.relation, "aligned");
  assert.equal(result.timeGapMinutes, 1);
});

test("an older formal action never receives a current same-direction or conflict verdict", () => {
  const formal = { direction: "正T", side: "buy", action: "正T买入", time: "1000" };
  const radar = { ...positiveRadar, asOfTime: "1003" };
  const result = relateOrderFlowShadowToFormalSignal({ formalSignal: formal, orderFlowRadar: radar });
  assert.equal(result.relation, "time-misaligned");
  assert.equal(result.state, "waiting");
  assert.match(result.detail, /仅显示当前影子行为/);
});
