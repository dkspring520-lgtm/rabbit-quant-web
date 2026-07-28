/**
 * Return the mainland A-share session phase in Asia/Shanghai time.
 * This is a clock gate only. Exchange holidays still need the freshness of the
 * quote source to confirm that a trading day is actually active.
 * @param {Date|null} now
 */
export function aShareSession(now) {
  if (!now) return { phase:"calibrating", label:"交易状态校准中", live:false, tone:"pending", detail:"正在按北京时间校准" };
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now);
  const read=(type)=>parts.find(part=>part.type===type)?.value??"";
  const weekday=read("weekday");
  const minute=Number(read("hour"))*60+Number(read("minute"));
  if(!["Mon","Tue","Wed","Thu","Fri"].includes(weekday)) return {phase:"closed",label:"周末休市",live:false,tone:"closed",detail:"保留最近行情，不生成实时执行信号"};
  if(minute<555) return {phase:"preauction",label:"盘前准备",live:false,tone:"pending",detail:"09:15 集合竞价开始"};
  if(minute<565) return {phase:"auction",label:"集合竞价",live:false,tone:"auction",detail:"观察虚拟成交价变化，09:25 形成竞价结果"};
  if(minute<570) return {phase:"auction-result",label:"竞价结果已出",live:false,tone:"auction",detail:"按 09:25 竞价结果初判方向；09:30 后等待连续竞价确认"};
  if(minute<=690) return {phase:"morning",label:"上午交易中",live:true,tone:"live",detail:"前台 1 秒监控 · 切回页面立即追平"};
  if(minute<780) return {phase:"lunch",label:"午间休市",live:false,tone:"paused",detail:"13:00 恢复监控，不生成新执行信号"};
  if(minute<=900) return {phase:"afternoon",label:"下午交易中",live:true,tone:"live",detail:"前台 1 秒监控 · 切回页面立即追平"};
  if(minute<905) return {phase:"closing",label:"收盘结算中",live:false,tone:"paused",detail:"连续竞价已结束，等待 15:05 盘后固定价格交易"};
  if(minute<=930) return {phase:"afterhours",label:"盘后固定价交易",live:false,tone:"postclose",detail:"15:05–15:30 按当日收盘价成交，不生成日内做 T 信号"};
  return {phase:"closed",label:"今日已收盘",live:false,tone:"closed",detail:"保留收盘行情，可进入模拟回测复盘"};
}
