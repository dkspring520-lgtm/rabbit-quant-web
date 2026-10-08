// Presentation-only shortening for the Trading Desk. Raw business values are
// retained in titles/details; these labels never feed signal calculations.
export function compactObservationStatus(label) {
  switch (String(label ?? "").toUpperCase()) {
    case "POSITIVE_T_WATCH": return "候买";
    case "COUNTER_T_WATCH": return "候卖";
    case "WAIT_CONFIRMATION": return "等确认";
    case "HOLD_OBSERVATION":
    case "NO_CLEAR_T_OPPORTUNITY": return "观望";
    case "INVALID": return "待数据";
    default: return "观察";
  }
}

export function compactObservationTag(value) {
  const text = String(value ?? "").trim();
  if (!text) return "观察";
  if (["偏强", "偏弱", "震荡", "高位", "低位", "午前", "待确认", "已确认"].includes(text)) return text;
  if (/早盘高活跃/.test(text)) return "早盘活跃";
  if (/上午稳定/.test(text)) return "上午稳定";
  if (/午后重开/.test(text)) return "午后重开";
  if (/午后稳定/.test(text)) return "午后稳定";
  if (/尾盘活跃/.test(text)) return "尾盘";
  if (/高位动能衰减|高位T环境|偏高位置/.test(text)) return "高位";
  if (/低位企稳|低位T环境|偏低位置/.test(text)) return "低位";
  if (/回落观察/.test(text)) return "回落";
  if (/反弹观察/.test(text)) return "反弹";
  if (/上行观察|低开转强/.test(text)) return "偏强";
  if (/下行观察|高开转弱/.test(text)) return "偏弱";
  if (/状态转换中|结构正在变化/.test(text)) return "变动";
  if (/暂无上下文/.test(text)) return "待数据";
  if (/高位|偏高|压力/.test(text)) return "高位";
  if (/低位|偏低|企稳/.test(text)) return "低位";
  if (/量能放大|量增|放量/.test(text)) return "量增";
  if (/量能收缩|量缩|缩量/.test(text)) return "量缩";
  if (/动能.*减弱|偏弱/.test(text)) return "偏弱";
  if (/转弱|回落|滞涨/.test(text)) return "转弱";
  if (/反弹|回升/.test(text)) return "反弹";
  if (/候选变化|结构.*变化|结构转换/.test(text)) return "结构变";
  if (/确认|等待/.test(text)) return "确认";
  return "观察";
}

export function compactObservationNextStep(value) {
  const text = String(value ?? "");
  if (/回撤|回踩/.test(text)) return "等回踩";
  if (/放量|量能/.test(text)) return "等放量";
  if (/突破/.test(text)) return "等突破";
  if (/转弱|回落|失守|结构确认|连续有效结构/.test(text)) return "等确认";
  if (/继续观察|暂无动作/.test(text)) return "观望";
  return "等确认";
}

export function compactForecastMeta(value) {
  const text = String(value ?? "").replace(/^\s*[·•]\s*/, "").trim();
  const researchScore = text.match(/研究\s*(\d+)/);
  if (researchScore) return researchScore[1];
  if (/高风险/.test(text)) return "风险";
  if (/待定|待更新|数据准备中/.test(text)) return "待定";
  return text.replace(/^研究\s*/, "");
}

export function compactForecastDetail(value) {
  const text = String(value ?? "").trim();
  if (!text) return "待数据";
  if (/^¥/.test(text)) return text;
  if (/等待盘前数据|数据准备中|收盘后生成/.test(text)) return /收盘后生成/.test(text) ? "收盘后" : "待数据";
  if (/纽约金|外盘|高风险/.test(text)) return "风险";
  return compactOpeningStructure(text);
}

export function compactMainForceAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  const absolute = Math.abs(amount);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  if (absolute >= 10_000) return `${sign}${Math.round(absolute / 10_000)}万`;
  return `${sign}${Math.round(absolute)}`;
}

export function compactForceNote(value) {
  const text = String(value ?? "");
  if (/等待 L2|等待.*成交/.test(text)) return "待L2";
  if (/等待回踩确认/.test(text)) return "等回踩";
  if (/未推动价格|被吸收/.test(text)) return "吸收";
  if (/卖压正在放缓/.test(text)) return "卖压缓";
  if (/主动净卖与价格同向/.test(text)) return "净卖";
  if (/价格响应仍待确认|尚未形成同向/.test(text)) return "待确认";
  return compactObservationTag(text);
}

export function compactOpeningStructure(value) {
  const text = String(value ?? "").trim();
  const known = ["低开承压", "低开转强", "低开反弹", "高开转弱", "高开偏强", "高开滞涨", "平开震荡"];
  return known.find(label => text.includes(label)) ?? (/高开/.test(text) ? "高开" : /低开/.test(text) ? "低开" : /平开/.test(text) ? "平开" : "待确认");
}

export function compactChartDisplayLabel(value) {
  const text = String(value ?? "").trim();
  const candidateScore = text.match(/(候买|候卖|买入确认|卖出确认|买入|卖出|触发|高位候选|低位候选)[^0-9]{0,12}(\d{2,3})\s*分?/);
  if (candidateScore) {
    const token = candidateScore[1];
    const action = /卖|高位/.test(token) ? "卖" : /买|低位/.test(token) ? "买" : "触发";
    return `${action} ${candidateScore[2]}`;
  }
  const triggerScore = text.match(/触发\s*(\d+)\s*分/);
  if (triggerScore) return `触发 ${triggerScore[1]}`;
  return text.replace(/\s*[·•]\s*.*$/, "").replace(/\s*分$/, "");
}
