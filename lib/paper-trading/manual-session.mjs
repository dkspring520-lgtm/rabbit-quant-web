import {createDurablePaperSession} from './durable-session.mjs';

export function openManualPaperSession({storage,accountKey,symbol,initialOptions}) {
  if (!accountKey || !symbol) throw new Error('Explicit simulation account and symbol required');
  const key=`manual-paper-v1:${encodeURIComponent(accountKey)}:${encodeURIComponent(symbol)}`;
  const raw=storage.getItem(key);
  if(raw===null && !initialOptions)return null;
  const saved=raw===null?null:JSON.parse(raw);
  const options=initialOptions?{...initialOptions,symbol,accountId:accountKey}:saved.options;
  if(options.symbol!==symbol || options.accountId!==accountKey)throw new Error('Simulation account/symbol mismatch');
  return createDurablePaperSession({engineKind:'paper',accountKey,storage,key,initialOptions:options});
}

export async function executeManualPaperOrder(session, market, action) {
  if(!Number.isSafeInteger(action.quantity)||action.quantity<100||action.quantity%100)throw new Error('模拟数量必须是100股整手');
  if(!Number.isFinite(market.price)||market.price<=0)throw new Error('模拟价格无效');
  if(!['BUY','SELL'].includes(action.side))throw new Error('仅支持手动模拟买卖');
  return session.execute(market,action);
}
