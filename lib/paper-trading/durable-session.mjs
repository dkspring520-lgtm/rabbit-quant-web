import {PaperExecutionEngine as Paper} from './paper-execution-engine.mjs';
import {PaperExecutionEngine as Research} from '../rl-research/paper-execution-engine.mjs';
export const PAPER_COSTS_V2 = Object.freeze({commission:.025,minimumCommission:5,stampDuty:.05,transferFee:.001,slippage:0});
export const RESEARCH_COSTS_V2 = Object.freeze({feeRate:.025,minimumCommission:5,stampDutyRate:.0005,transferFeeRate:.00001,slippagePct:0});
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])) : item);

// Single-writer, synchronous storage adapter. No broker API and no engine-result conversion.
export function createDurablePaperSession({engineKind, accountKey, storage, key, initialOptions = {}}) {
  const Engine = engineKind === 'paper' ? Paper : engineKind === 'research' ? Research : null;
  if (!Engine || !accountKey || !key) throw new Error('Explicit paper engine/account/storage identity required');
  const options={...initialOptions, config:{...(engineKind==='paper'?PAPER_COSTS_V2:RESEARCH_COSTS_V2),...initialOptions.config}};
  let raw=storage.getItem(key);
  let state=raw===null ? null : JSON.parse(raw);
  if(state && (state.schemaVersion!==1 || state.engineKind!==engineKind || state.accountKey!==accountKey || !Array.isArray(state.orders) || !Array.isArray(state.receipts))) throw new Error('Paper ledger identity/schema mismatch');
  if(state && stable(state.options)!==stable(options)) throw new Error("Paper ledger configuration mismatch; use a separate account key");
  const create = () => {
    const engine=new Engine(state?.options ?? options);
    if(state) {
      for(const name of ['cash','position','sellablePosition','averageCost','boughtToday','tradeDate','sequence']) {
        if(Object.hasOwn(state.engine,name)) engine[name]=structuredClone(state.engine[name]);
      }
      if(!Number.isFinite(engine.cash) || engine.cash<0) throw new Error('Invalid persisted paper balance');
      const total=engineKind==='paper'?engine.position?.totalPosition:engine.position;
      const sellable=engineKind==='paper'?engine.position?.availableSellablePosition:engine.sellablePosition;
      if(!Number.isSafeInteger(total)||!Number.isSafeInteger(sellable)||total<0||sellable<0||sellable>total) throw new Error('Invalid persisted paper inventory');
      engine.orders=new Map(state.orders.map(([id,order])=>[id,structuredClone(order)]));
    }
    return engine;
  };
  let current=create();
  return {
    snapshot:()=>current.snapshot(),
    execute(market, action) {
      if(!action?.orderId) throw new Error('Durable paper orders require an explicit orderId');
      if(storage.getItem(key)!==raw) throw new Error('Paper ledger changed; reload before writing');
      const fingerprint=stable(action);
      const prior=state?.receipts.find(receipt=>receipt.id===action.orderId);
      if(prior) {
        if(prior.fingerprint!==fingerprint) throw new Error('Paper orderId conflicts with previous intent');
        return structuredClone(prior.result);
      }
      const candidate=create();
      const result=candidate.execute(market,action);
      const next={schemaVersion:1,engineKind,accountKey,options:state?.options??options,
        engine:Object.fromEntries(['cash','position','sellablePosition','averageCost','boughtToday','tradeDate','sequence'].filter(name=>Object.hasOwn(candidate,name)).map(name=>[name,candidate[name]])),
        orders:[...candidate.orders],receipts:[...(state?.receipts??[]),{id:action.orderId,fingerprint,result}]};
      const serialized=JSON.stringify(next);
      // Failure leaves current state and idempotency receipts unchanged.
      storage.setItem(key,serialized);
      raw=serialized;state=next;current=candidate;
      return structuredClone(result);
    },
  };
}
