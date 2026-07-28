export type ZijinMainForceMinute = {
  time:string;
  bigBuyNotional?:number;
  bigSellNotional?:number;
  activeBuyNotional?:number;
  activeSellNotional?:number;
  activeBuyRatio?:number|null;
  bigBuyCount?:number;
  bigSellCount?:number;
};
export type ZijinMainForceBar = Required<Omit<ZijinMainForceMinute,"activeBuyRatio">> & {
  activeBuyRatio:number|null;
  netNotional:number;
  strength:number;
};
export function buildZijinMainForceTrack(minutes?:ZijinMainForceMinute[]):{
  bars:ZijinMainForceBar[];
  totals:{bigBuyNotional:number;bigSellNotional:number;netNotional:number;bigBuyCount:number;bigSellCount:number};
  stance:string;
};
