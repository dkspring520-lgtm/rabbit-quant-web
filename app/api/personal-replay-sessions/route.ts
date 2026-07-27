import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type Minute = { time: string; price: number; volume: number };
type ReplaySession = { date: string; previousClose: number | null; minutes: Minute[] };
type ArchiveCache = { source: string; mtimeMs: number; sessions: ReplaySession[] };

let archiveCache: ArchiveCache | null = null;

function archivePath() {
  return process.env.ZIJIN_PERSONAL_REPLAY_PATH
    || (process.env.NODE_ENV === "production"
      ? "/training-data/zijin-601899-sessions.jsonl"
      : path.join(process.cwd(), ".data-inspect", "zijin-601899-sessions.jsonl"));
}

function isCompleteSession(value: unknown): value is ReplaySession {
  if (!value || typeof value !== "object") return false;
  const session = value as ReplaySession;
  const last = session.minutes?.at(-1);
  return /^\d{8}$/.test(session.date)
    && Array.isArray(session.minutes)
    && session.minutes.length >= 180
    && !!last
    && /^\d{4}$/.test(last.time)
    && last.time >= "1450";
}

async function loadArchive() {
  const source = archivePath();
  const info = await stat(source);
  if (archiveCache?.source === source && archiveCache.mtimeMs === info.mtimeMs) return archiveCache.sessions;
  const contents = await readFile(source, "utf8");
  const sessions = contents.split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line);
      return isCompleteSession(value) ? [value] : [];
    } catch { return []; }
  }).sort((left, right) => left.date.localeCompare(right.date));
  archiveCache = { source, mtimeMs: info.mtimeMs, sessions };
  return sessions;
}

function fiveYearSessions(sessions: ReplaySession[]) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffDate = `${cutoff.getFullYear()}${String(cutoff.getMonth() + 1).padStart(2, "0")}${String(cutoff.getDate()).padStart(2, "0")}`;
  return sessions.filter(session => session.date >= cutoffDate);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("code") !== "601899") {
    return Response.json({ error: "个人五年随机训练目前仅开放给紫金矿业" }, { status: 404 });
  }
  try {
    const candidates = fiveYearSessions(await loadArchive());
    if (!candidates.length) throw new Error("近五年没有完整训练交易日");
    const excluded = url.searchParams.get("exclude");
    const pool = candidates.length > 1 && excluded ? candidates.filter(session => session.date !== excluded) : candidates;
    const session = pool[Math.floor(Math.random() * pool.length)];
    return Response.json({
      session,
      source: "zijin-five-year-minute-archive",
      coverage: { sessions: candidates.length, firstDate: candidates[0].date, lastDate: candidates.at(-1)?.date ?? null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "个人训练历史库不可用" }, { status: 503 });
  }
}
