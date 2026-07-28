export type IntradayChartPoint = {
  price:number;
  volume?:number;
  averagePrice?:number|null;
};
export function cumulativeIntradayAverage(points?:IntradayChartPoint[]):number[];
export function symmetricIntradayScale(
  prices?:number[],
  previousClose?:number|null,
  options?:{tickCount?:number;minimumPercent?:number;paddingFactor?:number},
):{
  reference:number|null;
  min:number;
  max:number;
  ticks:{value:number;percent:number|null}[];
}|null;
