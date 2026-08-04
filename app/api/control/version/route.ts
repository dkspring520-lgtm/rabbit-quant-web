export const dynamic = "force-dynamic";

function runtimeEnv() {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
}

export async function GET() {
  const env = runtimeEnv();
  const commit = env?.APP_COMMIT_SHA || "development";
  const buildTime = env?.APP_BUILD_TIME || null;

  return Response.json(
    {
      service: "rabbit-quant-web",
      commit,
      shortCommit: commit === "development" ? commit : commit.slice(0, 12),
      buildTime,
      environment: env?.NODE_ENV || "development",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
