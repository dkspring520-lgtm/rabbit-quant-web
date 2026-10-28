import React from 'react';
export function formatDataTime(value) {
  if (!value) return '未知';
  const raw=String(value);
  const compact=raw.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{0,6})$/);
  const timestamp=compact?`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}+08:00`:raw;
  const date=new Date(timestamp);
  return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'未知';
}
/** @param {{source?:string|null,sourceTime?:string|null,fetchedAt?:string|null,status?:string,detail?:string,demo?:boolean,researchBlocked?:boolean,storageError?:string}} props */
export function DataStateStrip({source,sourceTime,fetchedAt,status='未知',detail='',demo=false,researchBlocked=false,storageError=''}) {
  const h=React.createElement;
  return h('section',{className:'data-state-strip','aria-label':'数据与研究状态'},
    h('div',{className:'data-state-strip-times'},
      h('span',null,`${demo?'演示 · ':''}来源 ${source||'未知'}`),
      h('span',null,`行情 ${formatDataTime(sourceTime)}`),
      h('span',null,`获取 ${formatDataTime(fetchedAt)}`),
      h('span',{title:detail},`数据 ${status}`)),
    researchBlocked?h('p',{role:'status'},'研究未就绪：分钟最终性与落盘时刻未验证，严格标签已暂停。这不代表没有信号；普通行情继续显示。'):null,
    storageError?h('p',{role:'alert'},storageError):null);
}
