export const SLICE_LEVELS = [50,60,70,80,90];
export function advanceSlice(previous, snapshot, hysteresis=5) {
  if (!snapshot.available) return {...previous, available:false};
  const next={...previous, ...snapshot, levels:{...(previous?.levels??{})}, events:[...(previous?.events??[])]};
  for(const side of ['buy','sell']) {
    const score=snapshot[side];
    if(!Number.isFinite(score))continue;
    const old=next.levels[side]??0;
    const level=SLICE_LEVELS.filter(n=>score>=n).at(-1)??0;
    if(level>old || score<old-hysteresis)next.levels[side]=level;
    if(level>old) next.events.push({id:`${snapshot.time}:${side}:${next.events.length}`,time:snapshot.time,price:snapshot.price,side,score,level});
  }
  return {...next,events:next.events.slice(-200)};
}
