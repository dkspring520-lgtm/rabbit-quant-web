export const dynamic = "force-dynamic";

type ReleaseState = {
  commit?: unknown;
  buildTime?: unknown;
};

const RELEASE_STATE_PATH = process.env.APP_RELEASE_STATE_PATH || "/training-state/deployed-release.json";

function readReleaseState(): {commit: string; buildTime: string | null} | null {
  try {
    const fs = process.getBuiltinModule?.("fs") as
      | {readFileSync(path: string, encoding: "utf8"): string}
      | undefined;
    if (!fs) return null;
    const value = JSON.parse(fs.readFileSync(RELEASE_STATE_PATH, "utf8")) as ReleaseState;
    if (typeof value.commit !== "string" || !/^[0-9a-f]{40}$/i.test(value.commit)) return null;
    return {
      commit: value.commit,
      buildTime: typeof value.buildTime === "string" ? value.buildTime : null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT_SHA || "development";
  const buildTime = process.env.NEXT_PUBLIC_APP_BUILD_TIME || null;
  const release = readReleaseState();
  const releaseCommit = release?.commit || commit;

  return Response.json(
    {
      service: "rabbit-quant-web",
      commit,
      shortCommit: commit === "development" ? commit : commit.slice(0, 12),
      buildTime,
      releaseCommit,
      releaseShortCommit: releaseCommit === "development" ? releaseCommit : releaseCommit.slice(0, 12),
      releaseBuildTime: release?.buildTime || buildTime,
      environment: process.env.NODE_ENV || "development",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
