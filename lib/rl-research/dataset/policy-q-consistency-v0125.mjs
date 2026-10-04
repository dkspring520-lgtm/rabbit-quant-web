import { createHash } from "node:crypto";
export const ACTIONS=Object.freeze(["WAIT","BUY_SMALL","SELL_ALL"]);
export const MATRIX_STATUS="SUPPORTED_ONLY_WHEN_ACTION_SEQUENCE_IS_PERSISTED";
export function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function emptyMatrix(){return Object.fromEntries(ACTIONS.map(a=>[a,Object.fromEntries(ACTIONS.map(b=>[b,0]))]));}
export function addMatrix(matrix,actual,predicted){if(matrix[actual]&&matrix[actual][predicted]!==undefined)matrix[actual][predicted]++;return matrix;}
export function metricDefinitions(){return {expertAgreement:"policyAction == observedExpertAction",qAgreement:"policyAction == maskedArgmaxQ",qVsExpertAgreement:"maskedArgmaxQ == observedExpertAction",oodRate:"Test rows with raw feature outside fixed Train mean +/- 3*Train std",diagnosticIncidence:"feature-wise OOD count divided by Test count; not causal contribution"};}
export function hashLineage(lineage){return hash(lineage);}
