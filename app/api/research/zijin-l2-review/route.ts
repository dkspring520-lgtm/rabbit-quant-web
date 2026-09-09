import { NextResponse } from "next/server";

const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_API_KEY = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TEXT = 2_000;

type ReviewPayload = {
  code?: string;
  asOf?: string;
  signal?: Record<string, unknown>;
  quote?: Record<string, unknown>;
  l2?: Record<string, unknown>;
  position?: Record<string, unknown>;
  risk?: Record<string, unknown>;
};

function clampText(value: unknown) {
  return String(value ?? "").slice(0, MAX_TEXT);
}

function fallback(payload: ReviewPayload, reason = "AI 未配置，先按硬规则等待人工确认") {
  const signal = payload.signal ?? {};
  const l2 = payload.l2 ?? {};
  const blockers: string[] = [];
  if (payload.code !== "601899") blockers.push("仅支持 601899 紫金矿业");
  if (l2.stale === true) blockers.push("L2 数据过期");
  if (l2.connected === false) blockers.push("L2 未连接");
  if (Number(signal.score) < 60) blockers.push("信号强度不足");
  return {
    ok: true,
    provider: "deterministic-fallback",
    decision: blockers.length ? "wait" : "wait",
    confidence: blockers.length ? 25 : 45,
    reason: blockers.join("；") || reason,
    blockers,
    asOf: payload.asOf ?? new Date().toISOString(),
    expiresInSeconds: 10,
  };
}

function parseModelJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回不是 JSON");
  const parsed = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  const decision = parsed.decision === "execute" || parsed.decision === "reject" ? parsed.decision : "wait";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
  const blockers = Array.isArray(parsed.blockers) ? parsed.blockers.map(String).slice(0, 8) : [];
  return {
    ok: true,
    provider: "openai",
    model: MODEL,
    decision,
    confidence,
    reason: clampText(parsed.reason || "等待更多 L2 确认"),
    blockers,
    checks: parsed.checks && typeof parsed.checks === "object" ? parsed.checks : {},
    asOf: clampText(parsed.asOf || new Date().toISOString()),
    expiresInSeconds: Math.max(5, Math.min(30, Math.round(Number(parsed.expiresInSeconds) || 10))),
  };
}

export async function POST(request: Request) {
  let payload: ReviewPayload;
  try {
    payload = await request.json() as ReviewPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (payload.code !== "601899") return NextResponse.json({ ok: false, error: "此接口只复核 601899 紫金矿业" }, { status: 400 });
  if (!AI_API_KEY) return NextResponse.json(fallback(payload));

  const system = [
    "你是 A 股做 T 的实时 L2 复核器，只负责判断已有候选信号是否值得人工确认。",
    "绝不创建或发送订单；不能把研究观察包装成买卖指令。",
    "优先 wait/reject，只有 L2 新鲜、盘口与主动成交方向一致、价格位置和风险门控均支持时才返回 execute。",
    "必须只返回 JSON：decision 为 execute、wait、reject 之一；confidence 为 0-100；reason 为一句中文；blockers 为字符串数组；checks 为对象；expiresInSeconds 为 5-30。",
    "A 股做 T 必须检查可卖底仓；L2 过期、采集器断连、事件锁定或价格偏离时禁止 execute。",
  ].join("\n");
  const user = JSON.stringify({
    code: payload.code,
    asOf: payload.asOf,
    signal: payload.signal,
    quote: payload.quote,
    l2: payload.l2,
    position: payload.position,
    risk: payload.risk,
  });
  try {
    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 350,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI 空响应");
    return NextResponse.json(parseModelJson(content));
  } catch (error) {
    return NextResponse.json(fallback(payload, error instanceof Error ? error.message : "AI 暂不可用"));
  }
}
