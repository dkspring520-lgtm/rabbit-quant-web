const DEFAULT_CONTROL_ORIGIN = "http://control:3010";
const DEFAULT_OPENAI_ORIGIN = "https://api.openai.com/v1";
const MAX_SPEECH_LENGTH = 500;

type VoiceRequest = {
  text?: unknown;
  risk?: unknown;
};

async function hasActiveSession(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return false;
  const controlOrigin = (process.env.CONTROL_PLANE_ORIGIN || DEFAULT_CONTROL_ORIGIN).replace(/\/$/, "");
  try {
    const response = await fetch(`${controlOrigin}/auth/session`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, {
    status,
    headers: { "cache-control": "no-store, private" },
  });
}

export async function POST(request: Request) {
  if (!(await hasActiveSession(request))) return jsonError("请先登录", 401);

  let payload: VoiceRequest;
  try {
    payload = await request.json() as VoiceRequest;
  } catch {
    return jsonError("请求体必须是 JSON", 400);
  }

  const text = String(payload.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return jsonError("缺少播报内容", 400);
  if (text.length > MAX_SPEECH_LENGTH) return jsonError("播报内容过长", 413);

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return jsonError("GPT 语音尚未配置", 503);

  const apiOrigin = (process.env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_ORIGIN).replace(/\/$/, "");
  const model = process.env.OPENAI_VOICE_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_VOICE || "marin";
  const risk = payload.risk === true;

  try {
    const response = await fetch(`${apiOrigin}/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        instructions: risk
          ? "使用清晰、严肃、克制的普通话播报风险提醒。语速稍慢，数字要读清楚，不要添加原文之外的内容。"
          : "使用自然、专业、冷静的普通话播报实时行情监控。语速适中，数字要读清楚，不要添加原文之外的内容。",
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok || !response.body) return jsonError(`GPT 语音生成失败（${response.status}）`, 502);

    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "audio/mpeg",
        "cache-control": "no-store, private",
        "x-openai-voice-model": model,
        "x-openai-voice": voice,
      },
    });
  } catch {
    return jsonError("GPT 语音服务暂时不可用", 502);
  }
}

export const dynamic = "force-dynamic";
