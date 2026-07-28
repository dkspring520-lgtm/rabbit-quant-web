import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("L2 console status never renders a provider endpoint or raw connection error", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const l2ConsoleNode="上海节点"/);
  assert.doesNotMatch(source, /detail:`\$\{liveL2Status\.node/);
  assert.doesNotMatch(source, /detail:liveL2Status\.error/);
  assert.match(source, /detail:`\$\{l2ConsoleNode\} · \$\{marketSession\.label\}，开市后恢复实时校验`/);
});

test("L2 status does not claim tick data or a last price before either is available", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const liveL2HasTicks=Boolean\(\(liveL2Status\?\.messages\?\.transaction\?\?0\)>0\|\|\(liveL2Status\?\.messages\?\.order\?\?0\)>0\)/);
  assert.match(source, /"十档在线，逐笔待数据"/);
  assert.match(source, /const zijinL2PriceText=Number\.isFinite\(zijinL2LastPrice\)&&zijinL2LastPrice>0/);
  assert.match(source, /盘口中间价/);
});

test("L2 console shows the collector-reported data latency in milliseconds", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const liveL2LatencyMs=Number\.isFinite\(liveL2Status\?\.status\?\.ageSeconds\)/);
  assert.match(source, /数据延迟 \$\{liveL2LatencyMs\} ms/);
  assert.match(source, /ageSeconds\?:number/);
});

test("valid L2 trades are the real-time price source for the active Zijin quote", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const liveL2PriceUsable=stock\?\.code==="601899"/);
  assert.match(source, /&&liveL2HasTicks/);
  assert.match(source, /const activeQuote=useMemo\(\(\)=>\{/);
  assert.match(source, /price:liveL2LastPrice/);
  assert.match(source, /item\.code===stock\?\.code\?\(activeQuote\?\?marketQuotes\[item\.code\]\)/);
});

test("active Zijin monitoring refreshes L2 quickly during auction and market hours", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /marketDataActive\?300:60_000/);
  assert.match(source, /isFastMarketDataPhase\(marketSession\)/);
});
