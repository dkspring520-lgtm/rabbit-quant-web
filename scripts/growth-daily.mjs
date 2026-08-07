import { runGrowthAutomation } from "../lib/growth-server.mjs";

try {
  const result = await runGrowthAutomation({ force: false, limit: 10, autoPublish: true });
  if (result.skipped) {
    console.log(`[growth-daily] skipped: ${result.reason}`);
  } else {
    const submission = result.generatedDraft?.baiduSubmission;
    console.log(`[growth-daily] generated ${result.keywords.length} keywords, published one article, and ran Baidu push at ${result.lastRunAt}`);
    if (submission?.status === "submitted") {
      console.log(`[growth-daily] Baidu accepted ${submission.success ?? 0} URL(s); remaining quota: ${submission.remain ?? "unknown"}`);
    } else if (submission?.status === "skipped") {
      console.warn("[growth-daily] article published, but Baidu push was skipped: BAIDU_SUBMIT_TOKEN is missing");
    } else if (submission?.status === "failed") {
      console.warn(`[growth-daily] article published, but Baidu push failed: ${submission.error || "unknown error"}`);
    }
    if (result.warning || result.lastRunError) console.warn(`[growth-daily] warning: ${result.warning || result.lastRunError}`);
  }
} catch (error) {
  console.error(`[growth-daily] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
