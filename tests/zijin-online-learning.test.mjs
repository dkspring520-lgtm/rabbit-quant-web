import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createZijinDailyAssignment } from "../lib/zijin-daily-assignment.mjs";
import { createZijinOnlineLearningObservations } from "../lib/zijin-online-learning.mjs";

const marketDate = "2026-08-19";
const sourceTimestamp = "2026-08-19T15:00:00+08:00";
const script = await readFile(new URL("../scripts/zijin-factor-daily.mjs", import.meta.url), "utf8");

function fixtures() {
  const minutes = Array.from({ length: 70 }, (_, index) => ({
    time: String(1350 + index),
    price: 34 + index * 0.01,
    volume: 1000 + index * 10,
    averagePrice: 34.12,
  }));
  return {
    marketData: {
      sourceTimestamp,
      quote: { price: 34.69, open: 34, previousClose: 33.8, changePercent: 2.63 },
      minutes,
    },
    marketContext: {
      items: [
        { id: "hf_GC", changePercent: 0.8, sourceTimestamp },
        { id: "nf_AU0", changePercent: 0.6, sourceTimestamp },
        { id: "hf_CAD", changePercent: 1.2, sourceTimestamp },
        { id: "nf_CU0", changePercent: 1, sourceTimestamp },
        { id: "hk02899", changePercent: 1.5, sourceTimestamp },
        { id: "sh512400", changePercent: 0.9, sourceTimestamp },
        { id: "sh000001", changePercent: 0.2, sourceTimestamp },
        { id: "sh000300", changePercent: 0.1, sourceTimestamp },
      ],
    },
    eventRadar: {
      stocks: [{
        code: "601899",
        items: [
          { id: "official-1", title: "紫金矿业公告", official: true, source: "巨潮资讯", publishedAt: "2026-08-19T06:00:00.000Z" },
          { id: "lead-1", title: "铜价线索", official: false, source: "新浪财经", publishedAt: "2026-08-19T05:00:00.000Z" },
        ],
      }],
    },
    l2: {
      lastExchangeTime: "20260819-150000000",
      status: { connected: true, stale: false },
      flow: { activeBuyRatio60s: 0.62 },
      book: { nearTouchImbalance: 0.18 },
    },
  };
}

test("online learning converts current compliant sources into shadow-only evidence", () => {
  const observations = createZijinOnlineLearningObservations({ marketDate, collectedAt: "2026-08-19T08:00:00.000Z", ...fixtures() });
  assert.equal(observations.status, "shadow-only");
  assert.equal(observations.onlineLearning.status, "complete");
  assert.equal(observations.onlineLearning.readySources, 4);
  assert.equal(observations.onlineLearning.officialEvents, 1);
  assert.equal(observations.onlineLearning.leadEvents, 1);
  assert.equal(observations.onlineLearning.affectsFormalStrategy, false);
  assert.equal(observations.onlineLearning.canTrade, false);
  assert.equal(observations.direction.state, "up");
  assert.equal(observations.direction.probabilities, null);
  assert.equal(observations.factors.copper.state, "confirmed");
  assert.match(observations.candidateRules[0].source, /^一级/);
  assert.match(observations.candidateRules[1].source, /^三级线索/);
  assert.match(observations.integrity.evidenceHash, /^[a-f0-9]{64}$/);
});

test("stale or missing network data degrades without inventing direction", () => {
  const observations = createZijinOnlineLearningObservations({
    marketDate,
    marketData: { sourceTimestamp: "2026-08-18T15:00:00+08:00", quote: { changePercent: 3 } },
    l2: { lastExchangeTime: "20260818-150000000", status: { connected: true, stale: false } },
    errors: ["事件雷达：HTTP 503"],
  });
  assert.equal(observations.onlineLearning.status, "unavailable");
  assert.equal(observations.direction.state, "pending");
  assert.equal(observations.direction.confidence, null);
  assert.equal(observations.factors.ofi.state, "pending");
  assert.ok(observations.onlineLearning.errors.some(item => item.includes("HTTP 503")));
  assert.ok(observations.onlineLearning.errors.some(item => item.includes("日期")));
});

test("daily assignment exposes online evidence but cannot grant trading permission", () => {
  const observations = createZijinOnlineLearningObservations({ marketDate, ...fixtures() });
  const assignment = createZijinDailyAssignment({ marketDate, observations });
  assert.equal(assignment.onlineLearning.status, "complete");
  assert.equal(assignment.onlineLearning.affectsFormalStrategy, false);
  assert.equal(assignment.onlineLearning.canTrade, false);
  assert.equal(assignment.safety.realTradingEnabled, false);
  assert.equal(assignment.integrity.evidenceHash, observations.integrity.evidenceHash);
  assert.match(assignment.integrity.source, /event-radar/);
});

test("daily scheduler collects online evidence before factor run and assignment", () => {
  assert.match(script, /collectZijinOnlineLearning/);
  assert.match(script, /event-radar\?codes=601899/);
  assert.match(script, /market-context\?code=601899/);
  assert.match(script, /zijin-l2-orderflow/);
  assert.match(script, /writeJsonAtomic\(observationsPath, observations\)/);
});

test("online collector calls existing APIs and atomically persists a degraded snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zijin-online-learning-"));
  const output = join(directory, "observations.json");
  const previousPath = process.env.ZIJIN_DAILY_OBSERVATIONS_PATH;
  const previousOrigin = process.env.ZIJIN_RESEARCH_ORIGIN;
  process.env.ZIJIN_DAILY_OBSERVATIONS_PATH = output;
  process.env.ZIJIN_RESEARCH_ORIGIN = "http://research.test";
  try {
    const { collectZijinOnlineLearning } = await import(`../scripts/zijin-factor-daily.mjs?collector-test=${Date.now()}`);
    const data = fixtures();
    const requested = [];
    const fetchImpl = async url => {
      requested.push(url);
      if (url.includes("/api/market-data")) return Response.json(data.marketData);
      if (url.includes("/api/market-context")) return Response.json(data.marketContext);
      if (url.includes("/api/event-radar")) return Response.json({ ...data.eventRadar, errors: ["公开财经资讯暂不可用"] });
      if (url.includes("/api/research/zijin-l2-orderflow")) return Response.json(data.l2);
      return new Response(null, { status: 404 });
    };
    const result = await collectZijinOnlineLearning({ marketDate, collectedAt: "2026-08-19T08:00:00.000Z", fetchImpl });
    const persisted = JSON.parse(await readFile(output, "utf8"));
    assert.equal(result.onlineLearning.status, "partial");
    assert.equal(persisted.integrity.evidenceHash, result.integrity.evidenceHash);
    assert.ok(persisted.onlineLearning.errors.some(item => item.includes("公开财经资讯")));
    assert.equal(requested.length, 4);
    assert.ok(requested.every(url => url.startsWith("http://research.test/api/")));
  } finally {
    if (previousPath === undefined) delete process.env.ZIJIN_DAILY_OBSERVATIONS_PATH;
    else process.env.ZIJIN_DAILY_OBSERVATIONS_PATH = previousPath;
    if (previousOrigin === undefined) delete process.env.ZIJIN_RESEARCH_ORIGIN;
    else process.env.ZIJIN_RESEARCH_ORIGIN = previousOrigin;
    await rm(directory, { recursive: true, force: true });
  }
});
