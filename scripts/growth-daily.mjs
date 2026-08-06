import { runGrowthAutomation } from "../lib/growth-server.mjs";

try {
  const result = await runGrowthAutomation({ force: false, limit: 10 });
  if (result.skipped) {
    console.log(`[growth-daily] skipped: ${result.reason}`);
  } else {
    console.log(`[growth-daily] generated ${result.keywords.length} keywords and one review draft at ${result.lastRunAt}`);
    if (result.warning || result.lastRunError) console.warn(`[growth-daily] warning: ${result.warning || result.lastRunError}`);
  }
} catch (error) {
  console.error(`[growth-daily] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
