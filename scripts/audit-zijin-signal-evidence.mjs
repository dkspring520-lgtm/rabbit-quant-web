import fs from "node:fs";
import { calculateFormalConfirmationScore, runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { isRiskExitAction } from "../lib/alert-delivery-policy.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/audit-zijin-signal-evidence.mjs <jsonl> [lateReverseCutoff]");
const cutoff = process.argv[3] ?? "1330";
const sessions = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
  .filter(session => session.symbol === "601899");
const findings = [];
const seen = new Set();
const summary = { sessions: 0, actions: 0, valid: 0, invalid: 0, duplicates: 0, futureDataViolations: 0, missingEvidence: 0 };

for (const session of sessions) {
  const rows = session.minutes ?? [];
  if (rows.length < 100) continue;
  summary.sessions++;
  const reference = Number(session.previousClose) || Number(rows[0].price);
  const shares = Math.max(300, Math.floor((90_000 / reference) / 100) * 100);
  const replay = runSmartTReplay(rows, {
    capital: 200_000, baseShares: shares, sellable: shares, feeRate: .025,
    slippage: .02, minCommission: true, slippageMode: "percent",
    forceCloseTime: "1450", previousClose: session.previousClose,
    profile: "平衡档", randomValue: 0, lateReverseCutoff: cutoff,
  });
  for (const action of replay.actions ?? []) {
    if (isRiskExitAction(action)) continue;
    summary.actions++;
    const index = rows.findIndex(row => String(row.time) === String(action.time));
    const meta = action.meta ?? {};
    const scores = [meta.directionScore, meta.locationScore, meta.triggerScore].map(Number);
    const score = Number(action.confirmationScore);
    const profitExit = meta.phase === "exit";
    const reconstructed = scores.every(Number.isFinite)
      ? calculateFormalConfirmationScore({ direction: scores[0], location: scores[1], trigger: scores[2] })
      : null;
    const key = `${session.date}:${action.time}:${action.side}:${action.direction}`;
    const duplicate = seen.has(key);
    seen.add(key);
    const problems = [];
    if (index < 0 || rows.slice(index + 1).some(row => row.time === action.time)) problems.push("action-time-not-causal");
    if (!Number.isFinite(score) || score < 60 || score > 100) problems.push("formal-score-out-of-range");
    if (profitExit) {
      if (!meta.takeProfit && !meta.trailingProfit) problems.push("missing-profit-exit-kind");
      if (meta.profitExitQualified !== true || !meta.profitExitEvidence || Object.values(meta.profitExitEvidence).some(value => value !== true)) problems.push("incomplete-profit-exit-evidence");
    } else {
      if (reconstructed !== score) problems.push("score-breakdown-mismatch");
      if (meta.phase !== "entry") problems.push("missing-action-phase");
      if (!Number.isFinite(Number(meta.deviation)) || !Number.isFinite(Number(meta.ratio))) problems.push("missing-vwap-volume-evidence");
    }
    if (duplicate) problems.push("duplicate-formal-event");
    if (problems.length) {
      summary.invalid++;
      if (problems.includes("duplicate-formal-event")) summary.duplicates++;
      if (problems.includes("action-time-not-causal")) summary.futureDataViolations++;
      if (problems.includes("missing-vwap-volume-evidence")) summary.missingEvidence++;
      findings.push({ date: session.date, time: action.time, side: action.side, score, problems });
    } else summary.valid++;
  }
}
console.log(JSON.stringify({ kind: "zijin-formal-signal-evidence-audit", cutoff, summary, findings }, null, 2));
if (summary.invalid) process.exitCode = 1;
