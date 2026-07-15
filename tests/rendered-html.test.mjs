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
  assert.match(source, /左兔 · 买入\/买回提醒/);
  assert.match(source, /右兔 · 卖出提醒/);
  assert.match(source, /候选仅弹出安静观察卡/);
  assert.match(source, /候买/);
  assert.match(source, /候卖/);
  assert.match(source, /!isCandidate&&alertSettings\.sound/);
  assert.match(source, /autoDecision\.status==="ready"/);
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
