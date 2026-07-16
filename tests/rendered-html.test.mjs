import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("does not render development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.doesNotMatch(await response.text(), developmentPreviewMeta);
});

test("formal alerts use branded rabbits and candidates stay non-executable", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /左兔 · 买入\/买回提醒/);
  assert.match(source, /右兔 · 卖出提醒/);
  assert.match(source, /候选仅弹出安静观察卡/);
  assert.match(source, /候买/);
  assert.match(source, /候卖/);
  assert.match(source, /!isCandidate&&alertSettings\.sound/);
  assert.match(source, /autoDecision\.status==="ready"/);
  assert.match(source, /observation\.stage!=="watch"/);
  assert.match(source, /本股候选观察/);
  assert.match(source, /全部自选 \{signalFunnel\.candidates\}/);
  assert.match(source, /本股正式闭环/);
  assert.match(source, /signalFunnel\.currentLatest/);
  assert.doesNotMatch(source, /pivot-reference-marker/);
  assert.doesNotMatch(source, /pivot-confirmation-link/);
  assert.match(source, /visibleChartObservations/);
  assert.match(source, /return observations\.filter\(observation=>!observation\.executable\)/);
  assert.match(source, /observation\.confirmationLabel/);
  assert.match(source, /pointPosition\(observation\.time\)/);
  assert.doesNotMatch(source, /pointPosition\(observation\.pivotTime/);
  assert.match(source, /const reserveLabel=/);
  assert.match(source, /const occupied:LabelBox\[\]=\[\]/);
  assert.match(source, /intradayMarkerLayout\.actions/);
  assert.match(source, /marker-label-leader/);
  assert.match(source, /提醒按确认分钟实时落点 · 不回填峰谷/);
  assert.match(source, /const formalFresh=Boolean/);
  assert.match(source, /minuteNumber\(lastTime\)===minuteNumber\(latest\.time\)/);
  assert.match(source, /const isFormal=Boolean\(latest&&formalFresh\)/);
  assert.doesNotMatch(source, /const isFormal=Boolean\(autoDecision\.status==="ready"/);
  assert.match(source, /const isRisk=!isFormal&&autoDecision\.status==="locked"/);
  assert.match(source, /alertedEventKeys/);
  assert.match(source, /lastAlertKey\.current===persistedKey/);
  assert.match(source, /lastAlertKey\.current=persistedKey/);
  assert.match(source, /localStorage\.setItem\(persistedKey,"1"\)/);
  assert.match(styles, /candidate-signal-marker rect\{fill:rgba\(242,184,75,\.12\)/);
  assert.match(styles, /live-signal-marker\.sell rect\{fill:rgba\(255,100,100,\.18\)/);
  assert.match(styles, /live-signal-marker\.buy rect\{fill:rgba\(40,215,196,\.18\)/);
});

test("pre-open status keeps readable labels without global auction layout leakage", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const responsive = await readFile(new URL("../app/backtest.css", import.meta.url), "utf8");
  assert.match(source, /className="opening-assessment"/);
  assert.doesNotMatch(source, /className="auction"/);
  assert.match(source, /"开盘前模式"/);
  assert.match(source, /<strong>\{marketSession\.label\}<\/strong>/);
  assert.match(styles, /\.opening-assessment\{/);
  assert.doesNotMatch(styles, /(?:^|\n)\.auction\{/);
  assert.doesNotMatch(responsive, /\.market-open-label\{display:none\}/);
  assert.match(responsive, /\.market-open-label\{display:inline-block/);
  assert.match(styles, /\.live-performance div:last-child b\{font-size:clamp/);
});

test("desk history does not ship fixed fake cycles and minute volumes keep fixed width", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\['10:08:14','反T循环'/);
  assert.doesNotMatch(source, /\['09:02:11','正T循环'/);
  assert.match(source, /暂无已确认闭环/);
  assert.match(source, /width="2\.7"/);
  assert.doesNotMatch(source, /850\s*\/\s*chartModel\.volumes\.length/);
});

test("research surfaces use real evidence instead of fixed demo metrics", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /待验证规律/);
  assert.match(source, /真实完整分时/);
  assert.doesNotMatch(source, /持续影子训练 · 每5分钟/);
  assert.doesNotMatch(source, /\+¥2,416/);
});

test("fixed-stock replay exposes auditable failures and intraday trade points", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /为什么没有交易？/);
  assert.match(source, /亏损原因/);
  assert.match(source, /风控硬拦截/);
  assert.match(source, /强势交易日仍在 VWAP 上方/);
  assert.match(source, /避免低位卖出后追高买回/);
  assert.match(source, /BatchMiniChart/);
  assert.match(source, /pointAt\(observation\.time\)/);
  assert.doesNotMatch(source, /pointAt\(observation\.pivotTime/);
  assert.match(source, /正式闭环 \{batch\.completed\} 个/);
});
