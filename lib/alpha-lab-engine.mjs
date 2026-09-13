const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const std=values=>{if(values.length<2)return 0;const avg=mean(values);return Math.sqrt(mean(values.map(value=>(value-avg)**2)));};
const correlation=(left,right)=>{const size=Math.min(left.length,right.length);if(size<3)return 0;const x=left.slice(-size);const y=right.slice(-size);const xMean=mean(x);const yMean=mean(y);const numerator=x.reduce((sum,value,index)=>sum+(value-xMean)*(y[index]-yMean),0);const denominator=Math.sqrt(x.reduce((sum,value)=>sum+(value-xMean)**2,0)*y.reduce((sum,value)=>sum+(value-yMean)**2,0));return denominator?numerator/denominator:0;};
const percentile=(values,p)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);const index=(sorted.length-1)*clamp(p);const lower=Math.floor(index);const upper=Math.ceil(index);if(lower===upper)return sorted[lower];return sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower);};
const median=values=>percentile(values,.5);
const scoreDirection=value=>value>0?1:value<0?-1:0;

export const ALPHA_OPERATORS=Object.freeze([
  "identity","rank","zscore","delta","slope","mean_reversion","volume_confirm","interaction"
]);

export function generateAlphaCandidates(baseFactors,options={}){
  const maxCandidates=Math.max(10,Math.min(5000,Number(options.maxCandidates)||300));
  const factors=(baseFactors||[]).filter(item=>item&&typeof item.id==="string");
  const candidates=[];
  for(const factor of factors){
    candidates.push({id:`alpha:${factor.id}`,name:factor.label||factor.id,expression:factor.id,inputs:[factor.id],complexity:1});
    candidates.push({id:`alpha:z:${factor.id}`,name:`${factor.label||factor.id} 标准化`,expression:`zscore(${factor.id})`,inputs:[factor.id],complexity:2});
    candidates.push({id:`alpha:d:${factor.id}`,name:`${factor.label||factor.id} 变化`,expression:`delta(${factor.id},3)`,inputs:[factor.id],complexity:2});
  }
  for(let i=0;i<factors.length&&candidates.length<maxCandidates;i+=1){
    for(let j=i+1;j<factors.length&&candidates.length<maxCandidates;j+=1){
      const left=factors[i];const right=factors[j];
      if(left.group&&right.group&&left.group===right.group)continue;
      candidates.push({id:`alpha:x:${left.id}:${right.id}`,name:`${left.label||left.id} × ${right.label||right.id}`,expression:`zscore(${left.id}) * zscore(${right.id})`,inputs:[left.id,right.id],complexity:3});
      if(candidates.length<maxCandidates)candidates.push({id:`alpha:r:${left.id}:${right.id}`,name:`${left.label||left.id} / ${right.label||right.id}`,expression:`zscore(${left.id}) - zscore(${right.id})`,inputs:[left.id,right.id],complexity:3});
    }
  }
  return candidates.slice(0,maxCandidates);
}

function splitWalkForward(rows,folds=4){
  const ordered=[...rows].sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  const foldSize=Math.max(10,Math.floor(ordered.length/(folds+1)));
  const result=[];
  for(let fold=0;fold<folds;fold+=1){
    const trainEnd=foldSize*(fold+1);
    const testEnd=Math.min(ordered.length,trainEnd+foldSize);
    if(testEnd-trainEnd<5)break;
    result.push({train:ordered.slice(0,trainEnd),test:ordered.slice(trainEnd,testEnd)});
  }
  return result;
}

function evaluateSeries(rows,candidate,options={}){
  const horizon=Math.max(1,Number(options.horizon)||5);
  const costPct=Math.max(0,Number(options.roundTripCostPct)||0.08);
  const values=[];const outcomes=[];const trades=[];
  for(let index=0;index<rows.length-horizon;index+=1){
    const row=rows[index];const future=rows[index+horizon];
    const value=Number(row.factorValues?.[candidate.id]??row.factorValues?.[candidate.expression]??row.factorValues?.[candidate.inputs?.[0]]);
    const current=Number(row.price);const next=Number(future.price);
    if(!Number.isFinite(value)||!Number.isFinite(current)||!Number.isFinite(next)||!current)continue;
    const outcome=((next-current)/current)*100;
    values.push(value);outcomes.push(outcome);
  }
  if(values.length<20)return {observations:values.length,ic:0,winRate:0,netPct:0,turnover:0,trades:0,stability:0};
  const upper=percentile(values,.7);const lower=percentile(values,.3);
  for(let index=0;index<values.length;index+=1){
    const direction=values[index]>=upper?1:values[index]<=lower?-1:0;
    if(!direction)continue;
    const gross=outcomes[index]*direction;
    trades.push(gross-costPct);
  }
  const winRate=trades.length?trades.filter(value=>value>0).length/trades.length:0;
  const netPct=trades.reduce((sum,value)=>sum+value,0);
  const turnover=trades.length/values.length;
  const ic=correlation(values,outcomes);
  const chunks=[];const chunkSize=Math.max(5,Math.floor(trades.length/4));
  for(let index=0;index<trades.length;index+=chunkSize)chunks.push(mean(trades.slice(index,index+chunkSize)));
  const stability=chunks.length?clamp(1-std(chunks)/(Math.abs(mean(chunks))+.05),0,1):0;
  return {observations:values.length,ic,winRate,netPct,turnover,trades:trades.length,stability};
}

export function runAlphaLab({rows,candidates,options={}}){
  const folds=splitWalkForward(rows,options.folds||4);
  const results=[];
  for(const candidate of candidates||[]){
    const foldResults=folds.map(({test})=>evaluateSeries(test,candidate,options));
    const trades=foldResults.reduce((sum,item)=>sum+item.trades,0);
    const averageIc=mean(foldResults.map(item=>item.ic));
    const averageWinRate=mean(foldResults.map(item=>item.winRate));
    const averageStability=mean(foldResults.map(item=>item.stability));
    const netPct=foldResults.reduce((sum,item)=>sum+item.netPct,0);
    const positiveFoldRatio=foldResults.length?foldResults.filter(item=>item.netPct>0).length/foldResults.length:0;
    const complexityPenalty=Math.max(0,(candidate.complexity||1)-1)*4;
    const score=clamp((Math.abs(averageIc)*28+averageWinRate*32+averageStability*18+positiveFoldRatio*22)-complexityPenalty,0,100);
    const status=trades<30?"insufficient":score>=58&&positiveFoldRatio>=.6?"promote":score>=42?"observe":"reject";
    results.push({...candidate,score:Number(score.toFixed(2)),status,direction:scoreDirection(averageIc),metrics:{folds:foldResults.length,trades,ic:Number(averageIc.toFixed(4)),winRate:Number(averageWinRate.toFixed(4)),netPct:Number(netPct.toFixed(4)),stability:Number(averageStability.toFixed(4)),positiveFoldRatio:Number(positiveFoldRatio.toFixed(4))}});
  }
  results.sort((a,b)=>b.score-a.score);
  const promoted=results.filter(item=>item.status==="promote");
  return {generatedAt:new Date().toISOString(),summary:{tested:results.length,promoted:promoted.length,observing:results.filter(item=>item.status==="observe").length,rejected:results.filter(item=>item.status==="reject").length,insufficient:results.filter(item=>item.status==="insufficient").length},leaderboard:results.slice(0,50),promoted};
}

export function detectAlphaDecay(history,options={}){
  const window=Math.max(5,Number(options.window)||20);
  const threshold=Number(options.threshold)||.55;
  const grouped=new Map();
  for(const row of history||[]){if(!grouped.has(row.factorId))grouped.set(row.factorId,[]);grouped.get(row.factorId).push(row);}
  return [...grouped.entries()].map(([factorId,rows])=>{const ordered=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date)));const recent=ordered.slice(-window);const baseline=ordered.slice(0,Math.max(0,ordered.length-window));const recentScore=mean(recent.map(item=>Number(item.score)||0));const baselineScore=mean(baseline.map(item=>Number(item.score)||0));const ratio=baselineScore?recentScore/baselineScore:1;return {factorId,recentScore:Number(recentScore.toFixed(2)),baselineScore:Number(baselineScore.toFixed(2)),decayRatio:Number(ratio.toFixed(3)),decayed:recent.length>=Math.min(5,window)&&ratio<threshold,action:ratio<threshold?"demote":"keep"};});
}
