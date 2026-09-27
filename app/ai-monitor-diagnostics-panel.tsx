"use client";

import { useEffect } from "react";

export type AiMonitorCheck = {
  id: string;
  label: string;
  status: "healthy" | "warning" | "blocked" | "insufficient";
  detail: string;
  evidence?: string[];
  duplicateGroups?: Array<{
    time: string;
    type: string;
    direction: string | null;
    price: number | null;
    copies: number;
    sources: string[];
  }>;
  layer?: "fast" | "research";
  latencyMs?: number | null;
  httpStatus?: number | null;
  asOf?: string | null;
};

export type AiMonitorDiagnosis = {
  status: "healthy" | "warning" | "blocked" | "insufficient";
  headline: string;
  summary: string;
  checks: AiMonitorCheck[];
  actions: string[];
  asOf: string;
  dataQuality?: {
    minuteCount?: number;
    signalCount?: number;
    futureDataCount?: number;
    duplicateSignalCount?: number;
    duplicateEventCount?: number;
    unverifiableSignalCount?: number;
  };
  boundaries?: {
    formalSignalUnchanged?: boolean;
    shadowResearchOnly?: boolean;
    canExecute?: boolean;
  };
};

const statusLabel: Record<AiMonitorCheck["status"], string> = {
  healthy: "正常",
  warning: "需要看一下",
  blocked: "先暂停判断",
  insufficient: "数据不全",
};

const statusIcon: Record<AiMonitorCheck["status"], string> = {
  healthy: "✓",
  warning: "!",
  blocked: "×",
  insufficient: "—",
};

function displayAsOf(value: string | null | undefined) {
  if (!value) return "时间未提供";
  const digits = value.replace(/\D/g, "");
  if (/^\d{4}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function displayCheckLabel(id: string, label: string) {
  const labels: Record<string, string> = {
    version: "版本信息",
    "control-health": "后台服务",
    "market-data": "行情更新",
    "trading-desk": "操盘台数据",
    l2: "盘口数据",
    "intraday-data": "分时数据",
    "intraday-axis": "分时数据顺序",
    "price-vwap": "现价和当天均价",
    "signal-causality": "提醒记录是否重复",
    "research-layer": "试验信息是否与正式提醒分开",
  };
  return labels[id] ?? label;
}

function displaySignalType(type: string) {
  const labels: Record<string, string> = {
    "正式动作": "正式提醒",
    "候选信号": "候选提醒",
    "观察信号": "图上观察点",
    "影子研究": "试验信号",
  };
  return labels[type] ?? type;
}

export default function AiMonitorDiagnosticsPanel({
  open,
  loading,
  diagnosis,
  error,
  stockLabel,
  onClose,
  onRun,
}: {
  open: boolean;
  loading: boolean;
  diagnosis: AiMonitorDiagnosis | null;
  error: string;
  stockLabel: string;
  onClose: () => void;
  onRun: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  const tone = diagnosis?.status ?? (loading ? "warning" : "insufficient");
  const visibleChecks = diagnosis?.checks.filter(check => check.status !== "healthy") ?? [];
  const healthyChecks = diagnosis?.checks.filter(check => check.status === "healthy") ?? [];
  return (
    <div
      className="ai-monitor-diagnosis-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-monitor-diagnosis-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section id="ai-monitor-diagnosis-dialog" className={`ai-monitor-diagnosis-dialog ${tone}`}>
        <header className="ai-monitor-diagnosis-head">
          <div>
            <span>AI 盯盘 · 今日数据体检</span>
            <h2 id="ai-monitor-diagnosis-title">{loading ? "正在检查整条链路…" : diagnosis?.headline ?? "等待诊断"}</h2>
            <p>{stockLabel}</p>
          </div>
          <div className="ai-monitor-diagnosis-head-actions">
            <button type="button" className="icon-button" onClick={onRun} disabled={loading} aria-label="重新检查" title="重新检查">↻</button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭面板" title="关闭">×</button>
          </div>
        </header>

        <div className="ai-monitor-diagnosis-intro">
          <b>这是做什么的？</b>
          <span>检查网站、行情、分时图和提醒记录有没有缺失、延迟或重复。它不判断该买还是该卖，也不会自动下单。</span>
        </div>

        {loading && <div className="ai-monitor-diagnosis-loading" role="status" aria-live="polite"><i />正在检查网站连接、行情和分时图…</div>}
        {error && <div className="ai-monitor-diagnosis-error" role="alert"><b>这次检查没完成</b><span>{error}</span></div>}

        {diagnosis && <>
          <div className="ai-monitor-diagnosis-summary">
            <div className="ai-monitor-diagnosis-summary-main">
              <em className={diagnosis.status}>{statusLabel[diagnosis.status]}</em>
              <b>{diagnosis.summary}</b>
              <span>检查时间：{displayAsOf(diagnosis.asOf)}</span>
            </div>
          </div>

          <div className="ai-monitor-diagnosis-checks" aria-label="诊断检查项">
            {visibleChecks.length === 0 && <p className="ai-monitor-diagnosis-all-clear">目前没有发现需要处理的问题。仍请以正式信号和你的风控规则为准。</p>}
            {visibleChecks.map(check => <article key={`${check.id}-${check.layer ?? "fast"}`} className={`ai-monitor-diagnosis-check ${check.status}`}>
              <div className="ai-monitor-diagnosis-check-title"><i aria-hidden="true">{statusIcon[check.status]}</i><b>{displayCheckLabel(check.id, check.label)}</b><em>{statusLabel[check.status]}</em></div>
              <p>{check.detail}</p>
              {Boolean(check.duplicateGroups?.length) && <ul className="ai-monitor-diagnosis-duplicates">{check.duplicateGroups!.map((group,index) => <li key={`${group.time}-${group.type}-${index}`}>
                <b>{group.time}</b><span>{displaySignalType(group.type)}{group.direction ? ` · ${group.direction}` : ""}{group.price == null ? "" : ` · ¥${group.price.toFixed(2)}`}</span>
                <small>共出现 {group.copies} 次（多出 {group.copies - 1} 条）{group.sources.length ? ` · 来源：${group.sources.join("、")}` : ""}</small>
              </li>)}</ul>}
              {Boolean(check.evidence?.length || check.asOf) && <details className="ai-monitor-diagnosis-evidence"><summary>查看检查依据</summary><small>{check.evidence?.join(" · ")}{check.asOf ? ` · ${displayAsOf(check.asOf)}` : ""}</small></details>}
            </article>)}
            {healthyChecks.length > 0 && <details className="ai-monitor-diagnosis-healthy-list">
              <summary>另有 {healthyChecks.length} 项检查正常</summary>
              <div>{healthyChecks.map(check => <article key={`${check.id}-${check.layer ?? "fast"}`}><b>{displayCheckLabel(check.id, check.label)}</b><span>{check.detail}</span></article>)}</div>
            </details>}
          </div>

          <details className="ai-monitor-diagnosis-evidence ai-monitor-diagnosis-data-counts">
            <summary>查看检查范围</summary>
            <small>分时数据 {diagnosis.dataQuality?.minuteCount ?? "—"} 条 · 提醒记录 {diagnosis.dataQuality?.signalCount ?? "—"} 条 · 时间异常 {diagnosis.dataQuality?.futureDataCount ?? 0} 条 · 重复记录 {diagnosis.dataQuality?.duplicateSignalCount ?? 0} 条</small>
          </details>
          {diagnosis.actions.length > 0 && <div className="ai-monitor-diagnosis-actions"><span>接下来</span>{diagnosis.actions.map(action => <b key={action}>{action}</b>)}</div>}
        </>}
      </section>
    </div>
  );
}
