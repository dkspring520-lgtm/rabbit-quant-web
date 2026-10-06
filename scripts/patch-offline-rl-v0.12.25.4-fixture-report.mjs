import { readFile, writeFile } from "node:fs/promises";
const path = "docs/rl-research/results/offline-rl-v0.12.25.4-t1-execution-feasibility-audit.md";
let text = await readFile(path, "utf8");
text = text.replace(/"sameDayBuyBack": \{\n\s+"status": "FILLED",\n\s+"totalPosition": 700,\n\s+"sellablePosition": 700\n\s+\}/, [
  '"sameDayBuyBack": {',
  '      "status": "FILLED",',
  '      "totalPosition": 1000,',
  '      "sellablePosition": 700,',
  '      "todayBought": 300',
  '    }',
].join("\n"));
await writeFile(path, text);
console.log(JSON.stringify({ path, status: "FIXTURE_SNAPSHOT_CORRECTED" }, null, 2));
