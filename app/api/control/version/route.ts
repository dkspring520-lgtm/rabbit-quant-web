export const dynamic = "force-dynamic";

export async function GET() {
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT_SHA || "development";
  const buildTime = process.env.NEXT_PUBLIC_APP_BUILD_TIME || null;

  return Response.json(
    {
      service: "rabbit-quant-web",
      commit,
      shortCommit: commit === "development" ? commit : commit.slice(0, 12),
      buildTime,
      environment: process.env.NODE_ENV || "development",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
