import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createQualityAccumulator, consumeQualityRecord, finalizeQualityAudit } from "../lib/rl-research/dataset/offline-quality-audit-v0101.mjs";
const artifact=process.argv[2]??".data-inspect/offline-rl-v0.10/OFFLINE_RL_DATASET_V0.10.jsonl.gz";
const manifest=JSON.parse(await readFile(`${artifact}.manifest.json`,"utf8"));
const acc=createQualityAccumulator(); const input=createInterface({input:createReadStream(artifact).pipe(createGunzip()),crlfDelay:Infinity});
for await(const line of input){if(line.trim())consumeQualityRecord(acc,JSON.parse(line),line);}
const result=finalizeQualityAudit(acc,manifest);
await writeFile("docs/rl-research/offline-rl-v0.10.1-quality-audit.json",JSON.stringify(result,null,2)+"\n");
await writeFile("docs/rl-research/offline-rl-v0.10.1-quality-audit.md",["# Offline RL V0.10.1 Dataset Research Quality Gate","",`**OFFLINE_RL_V0.10.1_QUALITY_GATE = ${result.status}**`,"",`- Records: ${result.count}`,`- Unique market bars: ${result.uniqueMarketBars}`,`- Scenario-expanded transitions: ${result.scenarioExpandedTransitions}`,`- Actions: ${JSON.stringify(result.actionCounts)}`,`- Splits: ${JSON.stringify(result.splitCounts)}`,`- Reward: ${JSON.stringify(result.reward)}`,`- Dataset hash: ${result.datasetHash}`,`- Scenario timeline equal: ${result.scenarioTimelineEqual}`,"- No model training or policy learning was performed.",""].join("\n")+"\n");
console.log(JSON.stringify(result,null,2)); if(result.status!=="PASS")process.exitCode=1;
