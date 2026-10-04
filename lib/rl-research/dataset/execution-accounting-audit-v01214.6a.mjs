import {createHash} from "node:crypto";
export function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function portfolioValue(state,price){const cash=Number(state?.cash),position=Number(state?.position),p=Number(price);return Number.isFinite(cash)&&Number.isFinite(position)&&Number.isFinite(p)?cash+position*p:null;}
export const ACCOUNTING_SOURCE={sourceFile:"lib/paper-trading/paper-execution-engine.mjs",module:"PaperExecutionEngine",buyFunction:"fill",sellFunction:"fill",costFunction:"calculatePaperCosts",postStateFunction:"this.cash / this.position mutation inside fill",tPlusOneFunction:"advanceTo + fill sell checks"};
