import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvent, evaluateEventGate, stripEventMarkup } from "../lib/event-radar.mjs";

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

test("a positive headline is displayed but never relaxes the execution gate", () => {
  const classified = { ...event(), ...classifyEvent({ title:"上半年业绩预增公告", publishedAt:"2026-07-14T07:00:00Z", now }) };
  const gate = evaluateEventGate([classified]);
  assert.equal(classified.sentiment, "positive");
  assert.equal(gate.hardLock, false);
  assert.match(gate.action, /不因利好自动放宽风控/);
});

test("two independent negative sources pause instead of pretending certainty", () => {
  const one = { ...event({ source:"来源甲" }), sentiment:"negative", severity:"warning", reason:"风险提示", ageHours:1 };
  const two = { ...event({ source:"来源乙" }), sentiment:"negative", severity:"warning", reason:"业绩下修", ageHours:2 };
  const gate = evaluateEventGate([one, two]);
  assert.equal(gate.level, "restricted");
  assert.equal(gate.hardLock, false);
});
