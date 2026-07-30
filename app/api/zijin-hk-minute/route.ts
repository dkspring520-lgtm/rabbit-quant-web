type HkMinute = { time:string; price:number };

const headers = {
  "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control":"no-store",
  "Cloudflare-CDN-Cache-Control":"no-store",
};

function numeric(value:string|undefined) {
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

function sourceTimestamp(value:string|undefined) {
  const matched=value?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return matched?`${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:${matched[5]}:${matched[6]}+08:00`:null;
}

async function responseText(response:Response) {
  const bytes=await response.arrayBuffer();
  try{return new TextDecoder("utf-8",{fatal:true}).decode(bytes)}
  catch{return new TextDecoder("gb18030").decode(bytes)}
}

export async function GET() {
  try{
    const [quoteResponse,minuteResponse]=await Promise.all([
      fetch("https://qt.gtimg.cn/q=hk02899",{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0 (compatible; SmartTAH/1.0)"}}),
      fetch("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=hk02899",{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0 (compatible; SmartTAH/1.0)"}}),
    ]);
    if(!quoteResponse.ok||!minuteResponse.ok)throw new Error("港股紫金行情暂不可用");
    const fields=(await responseText(quoteResponse)).match(/="([^"]*)"/)?.[1]?.split("~");
    const payload=await minuteResponse.json() as {data?:Record<string,{data?:{data?:string[]}}>} ;
    const previousClose=numeric(fields?.[4]);
    const price=numeric(fields?.[3]);
    const minutes:HkMinute[]=(payload.data?.hk02899?.data?.data??[])
      .map(row=>{const [time,rawPrice]=row.split(" ");return {time,price:Number(rawPrice)}})
      .filter(point=>/^\d{4}$/.test(point.time)&&Number.isFinite(point.price)&&point.price>0&&point.time<="1500");
    if(!previousClose||!price||minutes.length<2)throw new Error("港股紫金分钟数据不足");
    return Response.json({
      symbol:"02899.HK",
      name:"紫金矿业",
      provider:"tencent-public",
      fetchedAt:new Date().toISOString(),
      sourceTimestamp:sourceTimestamp(fields?.[30]),
      quote:{price,previousClose,changePercent:numeric(fields?.[32])??(price-previousClose)/previousClose*100},
      minutes,
    },{headers});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"港股紫金行情失败"},{status:502,headers});
  }
}
