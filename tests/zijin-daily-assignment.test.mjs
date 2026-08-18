import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createZijinDailyAssignment,
  hashZijinDailyAssignment,
  normalizeZijinDailyAssignment,
} from "../lib/zijin-daily-assignment.mjs";
import { createZijinFactorRegistry } from "../lib/zijin-factor-lifecycle.mjs";

const script = await readFile(new URL("../scripts/zijin-factor-daily.mjs", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/research/zijin-daily-assignment/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("daily assignment is a deterministic shadow-only report", () => {
  const input = {
    marketDate: "2026-08-18",
    generatedAt: "2026-08-18T15:55:00.000Z",
    registry: createZijinFactorRegistry({ generatedAt: "2026-08-18T00:00:00.000Z" }),
    dailyRun: { status: "completed" },
    shadowState: { integrity: { eventCount: 3 } },
  };
  const first = createZijinDailyAssignment(input);
  const second = createZijinDailyAssignment(input);
  assert.deepEqual(first, second);
  assert.equal(first.stock.code, "601899");
  assert.equal(first.status, "shadow-only");
  assert.equal(first.direction.state, "pending");
  assert.equal(first.direction.probabilities, null);
  assert.equal(first.horizons.length, 5);
  assert.equal(first.factorResonance.length, 7);
  assert.equal(first.evidence.sampleCount, 3);
  assert.equal(first.promotion.affectsFormalStrategy, false);
  assert.equal(first.promotion.canTrade, false);
  assert.equal(first.safety.realTradingEnabled, false);
  const { integrity, ...reportBody } = first;
  assert.equal(first.integrity.reportHash, hashZijinDailyAssignment(reportBody));
});

test("explicit observations remain bounded and labelled as shadow evidence", () => {
  const assignment = createZijinDailyAssignment({
    marketDate: "2026-08-18",
    generatedAt: "2026-08-18T15:55:00.000Z",
    observations: {
      direction: { state: "up", label: "偏强", confidence: 0.72, probabilities: { up: 0.72, down: 0.12, range: 0.16 }, reason: "样本外来源已核验" },
      horizons: { "15m": { state: "up", label: "偏强", probabilities: { up: 0.64 }, evidence: "滚动样本外" } },
      factors: { copper: { state: "confirmed", score: 81, note: "铜价与板块同步" } },
      findings: ["候选规则A", 42, "候选规则B"],
    },
  });
  assert.equal(assignment.direction.state, "up");
  assert.equal(assignment.direction.confidence, 0.72);
  assert.equal(assignment.horizons.find(item => item.id === "15m").probability, 0.64);
  assert.equal(assignment.factorResonance.find(item => item.id === "copper").state, "confirmed");
  assert.deepEqual(assignment.findings, ["候选规则A", "候选规则B"]);
  assert.equal(assignment.status, "shadow-only");
});

test("daily assignment scheduler, API and research院 display are wired", () => {
  assert.match(script, /runZijinDailyAssignment/);
  assert.match(script, /--assignment/);
  assert.match(script, /23 \* 60 \+ 45/);
  assert.match(route, /ZIJIN_DAILY_ASSIGNMENT_PATH/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(page, /\/api\/research\/zijin-daily-assignment/);
  assert.match(page, /研策兔每日作业/);
  assert.match(styles, /\.ai-daily-assignment/);
});

test("normalization cannot grant trading or formal-write permissions", () => {
  const normalized = normalizeZijinDailyAssignment({ status: "formal", promotion: { canTrade: true, affectsFormalStrategy: true }, safety: { realTradingEnabled: true, agentMayPromote: true } });
  assert.equal(normalized.status, "shadow-only");
  assert.equal(normalized.promotion.canTrade, false);
  assert.equal(normalized.promotion.affectsFormalStrategy, false);
  assert.equal(normalized.safety.realTradingEnabled, false);
  assert.equal(normalized.safety.agentMayPromote, false);
});
