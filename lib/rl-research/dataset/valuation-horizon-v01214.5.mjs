import {createHash} from "node:crypto";
export const HORIZONS=Object.freeze(["H1_NEXT_BAR","H2_EPISODE_TERMINAL"]);
export function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function portfolioValue(state,price){const cash=Number(state?.cash),position=Number(state?.position),valuationPrice=Number(price);if(!Number.isFinite(cash)||!Number.isFinite(position)||!Number.isFinite(valuationPrice))return null;return cash+position*valuationPrice;}
export function validateValuation(value){return Number.isFinite(value);}
