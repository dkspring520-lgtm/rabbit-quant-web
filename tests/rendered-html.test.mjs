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
  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.doesNotMatch(html, /做人神器/);
});

test("brand keeps a distinct ASCII T and never regresses to the wrong name", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/typography.css", import.meta.url), "utf8");
  assert.match(source, /aria-label="做T神器 Rabbit Smart-T"/);
  assert.match(source, /className="brand-ascii-t">T<\/span>/);
  assert.match(source, /aria-label="做T神器"/);
  assert.doesNotMatch(source, /<em>做T<\/em>/);
  assert.doesNotMatch(source, /做人神器/);
  assert.match(styles, /\.brand-lockup \.brand-type strong\{[^}]*letter-spacing:0!important/);
  assert.match(styles, /\.brand-ascii-t\{[^}]*letter-spacing:0!important/);
});

test("formal alerts use branded rabbits and candidates stay non-executable", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /左兔 · 买入\/买回提醒/);
  assert.match(source, /右兔 · 卖出提醒/);
  assert.match(source, /候选仅弹出安静观察卡/);
  assert.match(source, /function observationConfirmationLabel/);
  assert.match(source, /function observationDirectionNote/);
  assert.match(source, /潜在\$\{observation\.direction\}方向 · 观察层不可执行/);
  assert.match(source, /const label=observationConfirmationLabel\(observation\)/);
  assert.match(source, /formatTime\(observation\.time\)\} · \{observationConfirmationLabel\(observation\)\}/);
  assert.doesNotMatch(source, /observation\.direction==="正T"\?"候买":"候卖"/);
  assert.doesNotMatch(source, /\$\{observation\.stage==="candidate"\?"候选":"观察"\}\$\{observation\.direction\}/);
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

test("seeded random 10-stock replay is reproducible and separates candidates from formal trades", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const poolMatch = source.match(/const batchValidationUniverse = \[([\s\S]*?)\];/);
  assert.ok(poolMatch);
  const poolCodes = [...poolMatch[1].matchAll(/"(\d{6})"/g)].map((match) => match[1]);
  assert.ok(poolCodes.length >= 30);
  assert.equal(new Set(poolCodes).size, poolCodes.length);
  assert.match(source, /sampleWithSeed\(batchValidationUniverse,10,seed\)/);
  assert.match(source, /const replacementCodes=sampleWithSeed\(/);
  assert.match(source, /while\(available\.length<10 && cursor<queue\.length\)/);
  assert.match(source, /setBatchFetchProgress\(\{ready:available\.length,attempted\}\)/);
  assert.match(source, /batchFetchProgress\.ready\}\/10/);
  assert.match(source, /replacementStocks=Math\.max\(0,attempted-sampledCodes\.length\)/);
  assert.match(source, /type BatchBacktestResult = BatchMetrics & \{ seed:string;/);
  assert.match(source, /批次种子：\{batch\.seed\}/);
  assert.match(source, /随机10股真实分时批次/);
  assert.match(source, /候选覆盖只表示逐分钟出现过观察条件；正式触发才产生可执行闭环/);
  assert.match(source, /1\/10 不等于失败/);
  assert.match(source, /系统绝不为凑次数强行开仓/);
  assert.doesNotMatch(source, /固定代表组/);
  assert.match(source, /"600519": "贵州茅台"/);
  assert.match(source, /"300750": "宁德时代"/);
  assert.match(source, /"688981": "中芯国际"/);
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
