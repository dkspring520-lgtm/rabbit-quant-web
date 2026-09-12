export const SLICE_LEVELS = [70,80,90,100];
export function advanceSlice(previous, snapshot) {
  if (!snapshot.available) return {...previous, available:false};
  const episode=String(snapshot.episodeId??previous?.episodeId??'initial');
  const reset=episode!==previous?.episodeId;
  const next={...previous, ...snapshot, episodeId:episode, levels:reset?{}:{...(previous?.levels??{})}, events:[...(previous?.events??[])]};
  for(const side of ['buy','sell']) {
    const score=snapshot[side];
    if(!Number.isFinite(score)||score<0||score>100)continue;
    const old=next.levels[side]??0;
    const level=SLICE_LEVELS.filter(n=>score>=n).at(-1)??0;
    if(level>old){
      next.levels[side]=level;
      next.events.push({id:`${episode}:${side}:${level}`,episodeId:episode,time:snapshot.time,price:snapshot.price,side,score:level,rawScore:score,level});
    }
  }
  return {...next,events:next.events.slice(-200)};
}
