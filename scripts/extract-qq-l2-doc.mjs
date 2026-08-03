import zlib from "node:zlib";

const pageUrl = "https://docs.qq.com/doc/DQ3FaQ3ZYSmRQdEVi";
const page = await fetch(pageUrl).then((response) => response.text());
const endpoint = page.match(/href="([^"]*dop-api\/opendoc[^"]+)"/)?.[1]
  ?.replaceAll("&amp;", "&")
  ?.replace(/^\/\//, "https://");
if (!endpoint) throw new Error("opendoc endpoint not found");
const body = await fetch(endpoint, { headers: { referer: pageUrl } }).then((response) => {
  if (!response.ok) throw new Error(`opendoc ${response.status}`);
  return response.text();
});

const seen = new Set();
const hits = new Set();
const keywords = /Stk|Snapshot|Transaction|Order|Index|NATS|subject|topic|dtype|market|channel|function|主题|订阅|快照|逐笔|委托|成交|字段|代码|股票/i;

function inspect(buffer, depth = 0) {
  if (depth > 3 || !buffer.length) return;
  const key = `${buffer.length}:${buffer.subarray(0, 16).toString("hex")}`;
  if (seen.has(key)) return;
  seen.add(key);
  const text = buffer.toString("utf8");
  for (const part of text.match(/[\p{L}\p{N}_.*>{}\[\](),:=+\-/\\.'"\s]{8,}/gu) ?? []) {
    const clean = part.replace(/\s+/g, " ").trim();
    if (keywords.test(clean)) hits.add(clean);
  }
  for (const encoded of text.match(/[A-Za-z0-9+/]{24,}={0,2}/g) ?? []) {
    try { inspect(Buffer.from(encoded, "base64"), depth + 1); } catch {}
  }
  for (const unzip of [zlib.gunzipSync, zlib.inflateSync, zlib.brotliDecompressSync]) {
    try { inspect(unzip(buffer), depth + 1); } catch {}
  }
}

inspect(Buffer.from(body));
console.log([...hits].sort((a, b) => a.localeCompare(b, "zh-CN")).join("\n"));
