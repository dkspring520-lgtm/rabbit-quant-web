#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { runSmartTReplay } from "../lib/smart-t-engine.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: node round4-v4-baseline.mjs INPUT.json OUTPUT.json");
}

const sessions = JSON.parse(await readFile(inputPath, "utf8"));
const rows = [];
for (const session of sessions) {
  const referencePrice = Number(session.previousClose) || Number(session.minutes?.[0]?.price) || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const result = runSmartTReplay(session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    previousClose: session.previousClose,
    randomValue: 0.5,
    profileOverrides: {
      targetNetPct: 0.64,
      maxTargetNetPct: 1.00,
      maxCycles: 2,
    },
  });
  const cycleNetPcts = result.cycleNets.map((net, index) => {
    const cycleId = index + 1;
    const entry = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "entry");
    const notional = Math.max(1, Number(entry?.price || referencePrice) * Number(entry?.quantity || shares / 3));
    return Number(net) / notional * 100;
  });
  rows.push({
    date: session.date,
    cycles: cycleNetPcts.length,
    wins: cycleNetPcts.filter((value) => value > 0).length,
    cycleNetPcts,
  });
}

await writeFile(outputPath, `${JSON.stringify(rows)}\n`, "utf8");
