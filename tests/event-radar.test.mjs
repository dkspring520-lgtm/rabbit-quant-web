import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvent, dedupeRelatedEvents, evaluateEventGate, stripEventMarkup } from "../lib/event-radar.mjs";

const now = Date.parse("2026-07-14T08:00:00Z");
const event = (overrides = {}) => ({ official:false, source:"公开资讯", publishedAt:"2026-07-14T07:00:00Z", ...overrides });

test("event titles are stripped before they reach the trading UI", () => {
  assert.equal(stripEventMarkup("<em>紫金矿业</em>&nbsp;预增"), "紫金矿业 预增");
});

test("a fresh official critical negative event locks new T cycles", () => {
  const classified = { ...event({ official:true, source:"巨潮资讯" }), ...classifyEvent({ title:"关于被立案调查的公告", official:true, publishedAt:"2026-07-14T07:00:00Z", now }) };
  assert.equal(classified.severity, "critical");
  const gate = evaluateEventGate([classified]);
  assert.equal(gate.level, "locked");
  assert.equal(gate.hardLock, true);
});

test("an official critical event older than 24 hours stays visible without repeatedly hard-locking", () => {
  const gate = evaluateEventGate([{ ...event({ official:true, source:"巨潮资讯" }), sentiment:"negative", severity:"critical", reason:"命中立案风险词", ageHours:30 }]);
  assert.equal(gate.level, "restricted");
  assert.equal(gate.hardLock, false);
  assert.match(gate.reason, /超过 24 小时/);
});

test("a positive headline is displayed but never relaxes the execution gate", () => {
  const classified = { ...event(), ...classifyEvent({ title:"上半年业绩预增公告", publishedAt:"2026-07-14T07:00:00Z", now }) };
  const gate = evaluateEventGate([classified]);
  assert.equal(classified.sentiment, "positive");
  assert.equal(gate.hardLock, false);
  assert.match(gate.action, /不因利好自动放宽风控/);
});

test("a multi-company headline with a loss warning is not mislabelled as positive", () => {
  const classified = classifyEvent({
    title:"公告精选丨利通电子上半年预增最高近14倍 通威股份、隆基绿能继续巨亏",
    publishedAt:"2026-07-14T07:00:00Z",
    now,
  });
  assert.equal(classified.sentiment, "negative");
  assert.match(classified.reason, /巨亏/);
});

test("two independent negative sources pause instead of pretending certainty", () => {
  const one = { ...event({ source:"来源甲" }), sentiment:"negative", severity:"warning", reason:"风险提示", ageHours:1 };
  const two = { ...event({ source:"来源乙" }), sentiment:"negative", severity:"warning", reason:"业绩下修", ageHours:2 };
  const gate = evaluateEventGate([one, two]);
  assert.equal(gate.level, "restricted");
  assert.equal(gate.hardLock, false);
});

test("rewritten reports of the same strategic cooperation are merged", () => {
  const first = { ...event({ source:"新闽眼" }), id:"one", code:"601899", title:"携手优势互补，共拓全球市场｜建发集团与紫金矿业深化合作", summary:"", url:"https://example.com/one", sentiment:"positive" };
  const second = { ...event({ source:"观点地产网" }), id:"two", code:"601899", title:"建发集团与紫金矿业签署战略合作协议", summary:"", url:"https://example.com/two", sentiment:"positive" };
  const result = dedupeRelatedEvents([first, second]);
  assert.equal(result.length, 1);
  assert.equal(result[0].relatedCount, 2);
  assert.deepEqual(result[0].sources, ["新闽眼", "观点地产网"]);
});

test("different positive events for the same stock remain separate", () => {
  const cooperation = { ...event({ source:"来源甲" }), id:"one", code:"601899", title:"建发集团与紫金矿业签署战略合作协议", summary:"", url:"https://example.com/one", sentiment:"positive" };
  const earnings = { ...event({ source:"来源乙" }), id:"two", code:"601899", title:"紫金矿业上半年业绩预增", summary:"", url:"https://example.com/two", sentiment:"positive" };
  assert.equal(dedupeRelatedEvents([cooperation, earnings]).length, 2);
});

test("duplicate negative coverage counts once in the risk gate", () => {
  const first = { ...event({ source:"来源甲" }), id:"one", code:"601899", title:"紫金矿业收到监管警示函", summary:"", url:"https://example.com/one", sentiment:"negative", severity:"warning", reason:"命中警示函风险词", ageHours:1 };
  const second = { ...event({ source:"来源乙" }), id:"two", code:"601899", title:"监管部门向紫金矿业出具警示函", summary:"", url:"https://example.com/two", sentiment:"negative", severity:"warning", reason:"命中警示函风险词", ageHours:1 };
  const result = dedupeRelatedEvents([first, second]);
  assert.equal(result.length, 1);
  assert.equal(evaluateEventGate(result).level, "caution");
});
