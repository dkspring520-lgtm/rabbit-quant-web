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

test("Zijin research imports every opening-playbook symbol it executes", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ evaluateZijinOpeningPlaybook \} from "@\/lib\/zijin-opening-playbook\.mjs";/,
  );
  assert.match(source, /evaluateZijinOpeningPlaybook\(opening\.slice\(0,index\+1\)/);
});

test("brand uses the 双兔助手 and 做T神器 lockup without regressing to the wrong name", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/typography.css", import.meta.url), "utf8");
  assert.match(source, /aria-label="双兔助手 做T神器 Rabbit Smart-T"/);
  assert.match(source, /<span>双兔助手<\/span>/);
  assert.match(source, /做<span className="brand-ascii-t">T<\/span>神器 · SMART-T/);
  assert.match(source, /className="brand-ascii-t">T<\/span>/);
  assert.match(source, /aria-label="双兔助手 做T神器"/);
  assert.doesNotMatch(source, /<em>做T<\/em>/);
  assert.doesNotMatch(source, /做人神器/);
  assert.match(styles, /\.brand-lockup \.brand-type strong\{[^}]*letter-spacing:0!important/);
  assert.match(styles, /\.brand-ascii-t\{[^}]*letter-spacing:0!important/);
});

test("all-watchlist alerts use branded rabbits while candidates stay non-executable", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /左兔 · 买入\/买回提醒/);
  assert.match(source, /右兔 · 卖出提醒/);
  assert.match(source, /均价线大偏离、正式候选、正式买卖点与新风险全股提醒/);
  assert.match(source, /className="alert-channel-actions"/);
  assert.match(source, /function observationConfirmationLabel/);
  assert.match(source, /function observationDirectionNote/);
  assert.match(source, /候补\$\{observation\.direction\}方向 · 不可执行/);
  assert.match(source, /const label=observationConfirmationLabel\(observation\)/);
  assert.match(source, /formatTime\(observation\.time\)\} · \{observationConfirmationLabel\(observation\)\}/);
  assert.doesNotMatch(source, /observation\.direction==="正T"\?"候买":"候卖"/);
  assert.doesNotMatch(source, /\$\{observation\.stage==="candidate"\?"候选":"观察"\}\$\{observation\.direction\}/);
  assert.match(source, /selectLatestAlertableObservation\(observations\)/);
  assert.match(source, /不是买卖指令/);
  assert.match(source, /if\(alertSettings\.sound\)speakAlert/);
  assert.match(source, /decisionModel\.status==="ready"/);
  assert.match(source, /observation\.stage!=="watch"/);
  assert.match(source, /本股实时观察/);
  assert.match(source, /signalFunnel\.currentCandidates/);
  assert.match(source, /本股正式闭环/);
  assert.match(source, /signalFunnel\.currentLatest/);
  assert.doesNotMatch(source, /pivot-reference-marker/);
  assert.doesNotMatch(source, /pivot-confirmation-link/);
  assert.match(source, /visibleChartObservations/);
  assert.match(source, /return observations\.filter\(observation=>!observation\.executable\)/);
  assert.match(source, /\{visibleBacktestObservations\.map\(\(observation,index\)=>\{/);
  assert.doesNotMatch(source, /result\?\.trades===0&&visibleBacktestObservations\.map/);
  assert.doesNotMatch(source, /result\?\.trades===0&&visibleBacktestObservations\.length/);
  assert.match(source, /observation\.confirmationLabel/);
  assert.match(source, /pointPosition\(observation\.time\)/);
  assert.doesNotMatch(source, /pointPosition\(observation\.pivotTime/);
  assert.match(source, /const reserveLabel=/);
  assert.match(source, /const occupied:LabelBox\[\]=\[\]/);
  assert.match(source, /intradayMarkerLayout\.actions/);
  assert.match(source, /marker-label-leader/);
  assert.match(source, /提醒按确认分钟实时落点 · 不回填峰谷/);
  assert.match(source, /const formalFresh=Boolean/);
  assert.match(source, /isRecentCausalEvent\(lastTime,latest\.time,3\)/);
  assert.match(source, /for\(const \[index,item\] of stockList\.entries\(\)\)/);
  assert.match(source, /const formalFresh=Boolean\(latest&&isRecentCausalEvent\(lastTime,latest\.time,3\)\)/);
  assert.match(source, /const \[zijinResearchEnabled,setZijinResearchEnabled\]=useState\(false\)/);
  assert.match(source, /正式信号引擎/);
  assert.match(source, /V4 正式/);
  assert.match(source, /紫金研究叠加/);
  assert.match(source, /正式买卖点、风控和提醒仍由 V4 运行/);
  assert.doesNotMatch(source, /601899 自动切换专属智能体/);
  assert.match(source, /const isRisk=!formalFresh&&Boolean\(riskMessage\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /fulfilledWatchlistSnapshots/);
  assert.doesNotMatch(source, /const isFormal=Boolean\(autoDecision\.status==="ready"/);
  assert.match(source, /alertedEventKeys/);
  assert.match(source, /riskAlertEpisodes/);
  assert.match(source, /alertedEventKeys\.current\.has\(persistedKey\)/);
  assert.match(source, /alertedEventKeys\.current\.add\(persistedKey\)/);
  assert.match(source, /localStorage\.setItem\(persistedKey,"1"\)/);
  assert.match(styles, /candidate-signal-marker rect\{fill:rgba\(242,184,75,\.12\)/);
  assert.match(styles, /live-signal-marker\.sell rect\{fill:rgba\(255,100,100,\.18\)/);
  assert.match(styles, /live-signal-marker\.buy rect\{fill:rgba\(40,215,196,\.18\)/);
});

test("Zijin factor research is visibly isolated from the execution strategy", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /紫金矿业专属因子研究/);
  assert.match(source, /与 Smart‑T V4 隔离/);
  assert.match(source, /这里展示最近一次离线训练结果/);
  assert.match(source, /数据更新后需要重新训练/);
  assert.match(source, /盘中判断不会读取未来分钟/);
  assert.match(source, /analyzeZijinFactorResearch/);
  assert.match(source, /zijinPatternDiscovery/);
  assert.match(source, /zijinPeerPatternDiscovery/);
  assert.match(source, /zijinExternalFactorReadiness/);
  assert.match(source, /zijinRound2RegimeAudit/);
  assert.match(source, /不同市场状态都测过了吗/);
  assert.match(source, /2026 不参与调参/);
  assert.match(source, /扣掉费用后，长期平均仍会亏/);
  assert.match(source, /紫金规律扫描 · 外部参考/);
  assert.match(source, /今天能不能直接用/);
  assert.match(source, /这些专业词是什么意思/);
  assert.match(source, /盘中参考已经可用，长期训练还缺历史数据/);
  assert.match(source, /一句话理解/);
  assert.match(source, /实时数据用来帮助解释/);
  assert.match(source, /历史训练：/);
  assert.match(source, /不代表系统仍在持续训练/);
  assert.match(source, /紫金规律扫描/);
  assert.match(source, /阶段二已完成/);
  assert.match(source, /胜率不能靠回看最高低点制造/);
  assert.match(styles, /\.zijin-pattern-result\{/);
  assert.match(styles, /\.zijin-external-sources\{/);
  assert.match(styles, /\.zijin-external-summary\{/);
  assert.match(styles, /\.zijin-external-conclusion\{/);
  assert.match(styles, /\.zijin-regime-audit\{/);
});

test("mobile layout keeps core product flows usable on phones", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../app/mobile.css", import.meta.url), "utf8");

  assert.match(layout, /import type \{ Metadata, Viewport \} from "next"/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /import "\.\/mobile\.css"/);
  assert.match(mobile, /@media \(max-width: 760px\)/);
  assert.match(mobile, /env\(safe-area-inset-bottom\)/);
  assert.match(mobile, /\.main-nav\s*\{/);
  assert.match(mobile, /\.workspace\s*\{/);
  assert.match(mobile, /\.signal-funnel\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.signal-funnel > i\s*\{\s*display: none/);
  assert.doesNotMatch(mobile, /\.signal-funnel\s*\{\s*grid-template-columns:\s*1fr 1fr/);
  assert.match(mobile, /\.backtest-grid/);
  assert.match(mobile, /\.research-grid/);
  assert.match(mobile, /\.zijin-external-sources/);
});

test("Zijin experiment progress has a stable deep link and explicit delivery stages", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /params\.get\('view'\)!=='zijin-lab'/);
  assert.match(source, /id="zijin-experiment-progress"/);
  assert.match(source, /className="zijin-implementation-steps"/);
  assert.match(source, /aria-label="紫金矿业实验实施进度"/);
  assert.match(source, /选参完成 · 未通过/);
  assert.match(source, /封存未运行/);
  assert.match(source, /后续不重复使用 2026 盲测调参/);
  assert.match(styles, /\.zijin-implementation-steps\{/);
  assert.match(styles, /\.zijin-training-verdict\{/);
  assert.match(source, /className="zijin-round4-standard"/);
  assert.match(source, /第四轮 · 标准量化实验/);
  assert.match(source, /2026 数据/);
  assert.match(source, /试验次数账本/);
  assert.match(source, /Deflated Sharpe/);
  assert.match(source, /滚动样本外真实结论/);
  assert.match(source, /过拟合风险 PBO/);
  assert.match(source, /多次试验后可信度 DSR/);
  assert.match(source, /最终盲测未打开/);
  assert.match(styles, /\.zijin-round4-standard\{/);
  assert.match(styles, /\.zijin-round4-result\{/);
});

test("Zijin experiment deep link survives authentication and a missing saved watchlist stock", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const homeStyles = await readFile(new URL("../app/home.css", import.meta.url), "utf8");
  const landing = await readFile(new URL("../app/public-landing.tsx", import.meta.url), "utf8");
  assert.match(source, /isZijinExperimentDeepLink/);
  assert.match(source, /ensureZijinExperimentStock/);
  assert.match(source, /prepareWatchlistForCurrentEntry/);
  assert.match(source, /const \[authReady, setAuthReady\] = useState\(true\)/);
  assert.match(source, /openZijinExperiment/);
  assert.match(source, /紫金矿业实验室/);
  assert.match(source, /查看训练进度/);
  assert.match(homeStyles, /\.home-zijin-entry\{/);
  assert.match(source, /!authReady\|\|!localAuth\|\|!isZijinExperimentDeepLink\(\)/);
  assert.match(landing, /查看紫金实验进度/);
  assert.match(landing, /view=zijin-lab/);
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
  assert.match(source, /因子监控中（非训练）/);
  assert.doesNotMatch(source, /在线观察中/);
  assert.doesNotMatch(source, /持续影子训练 · 每5分钟/);
  assert.doesNotMatch(source, /\+¥2,416/);
  assert.match(source, /本轮因果审计完成｜没有可晋级参数/);
});

test("single-stock research keeps advanced evidence collapsed by default", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[researchExpanded,setResearchExpanded\]=useState\(false\)/);
  assert.match(source, /aria-expanded=\{researchExpanded\}/);
  assert.match(source, /researchExpanded&&<div className="research-purpose"/);
  assert.match(source, /zijinFactorResearch&&researchExpanded&&<section/);
  assert.match(source, /research-compact-training/);
});

test("random 10-stock replay randomizes stock-days and separates references from formal trades", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const poolMatch = source.match(/const representativeBacktestUniverse = \[([\s\S]*?)\];/);
  assert.ok(poolMatch);
  const poolCodes = [...poolMatch[1].matchAll(/"(\d{6})"/g)].map((match) => match[1]);
  assert.ok(poolCodes.length >= 30);
  assert.equal(new Set(poolCodes).size, poolCodes.length);
  assert.match(source, /fetch\("\/api\/stock-universe\?pool=full-a-v1"/);
  assert.match(source, /diversifyStockUniverse\(universeResponse\.stocks,`\$\{seed\}:market`,recentCodes\)/);
  assert.match(source, /const sampledItems=queue\.slice\(0,10\)/);
  assert.match(source, /representative-fallback/);
  assert.match(source, /while\(available\.length<10 && cursor<queue\.length\)/);
  assert.match(source, /setBatchFetchProgress\(\{ready:available\.length,attempted\}\)/);
  assert.match(source, /batchFetchProgress\.ready\}\/10/);
  assert.match(source, /replacementStocks=Math\.max\(0,attempted-sampledCodes\.length\)/);
  assert.match(source, /smart-t-recent-random-batch-codes/);
  assert.match(source, /与上一批重复 \{batch\.overlapWithPrevious\} 只/);
  assert.match(source, /type BatchBacktestResult = BatchMetrics & \{ seed:string;/);
  assert.doesNotMatch(source, /批次种子：\{batch\.seed\}/);
  assert.doesNotMatch(source, /随机10股批次测试完成 · 种子/);
  assert.match(source, /standardBacktestShares/);
  assert.match(source, /buildCausalReferencePoints/);
  assert.match(source, /slice\(0,5\)/);
  assert.match(source, /从近 5 个可用完整交易日中随机选一天|sampleWithSeed\(sessionPool,1/);
  assert.match(source, /全A股随机10股真实分时批次/);
  assert.match(source, /全市场列表不可用时会明确显示/);
  assert.match(source, /每股最多展示 2 个候补买点和 2 个候补卖点/);
  assert.match(source, /候补点不可执行/);
  assert.match(source, /才升级为正式候选或正式交易/);
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

test("the 09:25 auction result creates a plan instead of an executable order", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /09:25 集合竞价初判/);
  assert.match(source, /这不是买卖点/);
  assert.match(source, /09:30 开始扫描，最早 09:33 显示候选，09:36 后才允许经确认的小仓正式信号/);
});

test("public beta has an honest no-registration entry and legal disclosure", async () => {
  const landing = await readFile(new URL("../app/public-landing.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(landing, /免注册进入演示/);
  assert.match(landing, /创建服务器测试账户/);
  assert.match(landing, /服务器账户、跨设备监控清单、持仓参数同步/);
  assert.match(landing, /公开测试版/);
  assert.match(landing, /href="\/terms"/);
  assert.match(landing, /href="\/privacy"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
});

test("strategy research library does not advertise fabricated rankings or paid subscriptions", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /策略研究与观察库/);
  assert.match(source, /当前不展示未经审计的用户排行榜、虚拟业绩和收费订阅/);
  assert.match(source, /收费订阅和真实资金交易保持关闭/);
  assert.match(source, /研究草稿已保存；当前不会公开、收费或自动执行/);
  assert.doesNotMatch(source, /author:'A客户'/);
  assert.doesNotMatch(source, /订阅并模拟跟随/);
  assert.doesNotMatch(source, /付费订阅（审核后开放）/);
  assert.doesNotMatch(source, /今日模拟跟随/);
});

test("every monitored stock shows an explicit event-radar state", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /暂无新增/);
  assert.match(source, /雷达待更新/);
  assert.match(source, /扫描中/);
  assert.match(source, /ticker-event quiet/);
  assert.match(source, /ticker-event pending/);
});

test("a market risk lock explains its score and concrete triggers", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /currentContext\.gate\.reasons\.join\("、"\)/);
  assert.match(source, /外部环境雷达 \$\{currentContext\.gate\.score\}\/100/);
  assert.match(source, /禁止新开 T，只允许恢复底仓/);
});
