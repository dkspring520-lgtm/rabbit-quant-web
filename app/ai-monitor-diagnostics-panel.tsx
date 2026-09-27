"use client";

import { useEffect } from "react";

export type AiMonitorCheck = {
  id: string;
  label: string;
  status: "healthy" | "warning" | "blocked" | "insufficient";
  detail: string;
  evidence?: string[];
  layer?: "fast" | "research";
  latencyMs?: number | null;
  httpStatus?: number | null;
  asOf?: string | null;
};

export type AiMonitorDiagnosis = {
  status: "healthy" | "warning" | "blocked" | "insufficient";
  headline: string;
  summary: string;
  score: number | null;
  checks: AiMonitorCheck[];
  actions: string[];
  asOf: string;
  dataQuality?: {
    minuteCount?: number;
    signalCount?: number;
    futureDataCount?: number;
    duplicateSignalCount?: number;
  };
  boundaries?: {
    formalSignalUnchanged?: boolean;
    shadowResearchOnly?: boolean;
    canExecute?: boolean;
  };
};

const statusLabel: Record<AiMonitorCheck["status"], string> = {
  healthy: "正常",
  warning: "需核查",
  blocked: "阻断",
  insufficient: "数据不足",
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
            <span>AI 盯盘 · 链路诊断</span>
            <h2 id="ai-monitor-diagnosis-title">{loading ? "正在检查整条链路…" : diagnosis?.headline ?? "等待诊断"}</h2>
            <p>{stockLabel} · 只做数据与图表核查，不生成自动买卖指令</p>
          </div>
          <div className="ai-monitor-diagnosis-head-actions">
            <button type="button" className="icon-button" onClick={onRun} disabled={loading} aria-label="重新诊断" title="重新诊断">↻</button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭诊断面板" title="关闭">×</button>
          </div>
        </header>

        {loading && <div className="ai-monitor-diagnosis-loading" role="status" aria-live="polite"><i />并行读取版本、控制面、行情、L2 和日内图…</div>}
        {error && <div className="ai-monitor-diagnosis-error" role="alert"><b>诊断请求未完成</b><span>{error}</span></div>}

        {diagnosis && <>
          <div className="ai-monitor-diagnosis-summary">
            <div className="ai-monitor-diagnosis-score"><span>可信度</span><b>{diagnosis.score == null ? "—" : diagnosis.score}</b><small>{diagnosis.score == null ? "不可评分" : "/100"}</small></div>
            <div><b>{diagnosis.summary}</b><span>截至 {displayAsOf(diagnosis.asOf)}</span></div>
            <em className={diagnosis.status}>{statusLabel[diagnosis.status]}</em>
          </div>

          <div className="ai-monitor-diagnosis-quality" aria-label="诊断数据质量">
            <span><small>有效分钟</small><b>{diagnosis.dataQuality?.minuteCount ?? "—"}</b></span>
            <span><small>已核信号</small><b>{diagnosis.dataQuality?.signalCount ?? "—"}</b></span>
            <span><small>未来数据</small><b>{diagnosis.dataQuality?.futureDataCount ?? 0}</b></span>
            <span><small>重复事件</small><b>{diagnosis.dataQuality?.duplicateSignalCount ?? 0}</b></span>
          </div>

          <div className="ai-monitor-diagnosis-checks" aria-label="诊断检查项">
            {diagnosis.checks.map(check => <article key={`${check.id}-${check.layer ?? "fast"}`} className={`ai-monitor-diagnosis-check ${check.status}`}>
              <div className="ai-monitor-diagnosis-check-title"><i aria-hidden="true">{statusIcon[check.status]}</i><b>{check.label}</b><em>{statusLabel[check.status]}</em></div>
              <p>{check.detail}</p>
              {Boolean(check.evidence?.length) && <small>{check.evidence!.join(" · ")}{check.asOf ? ` · ${displayAsOf(check.asOf)}` : ""}</small>}
            </article>)}
          </div>

          <div className="ai-monitor-diagnosis-actions"><span>建议下一步</span>{diagnosis.actions.map(action => <b key={action}>{action}</b>)}</div>
          <div className="ai-monitor-diagnosis-boundary"><span>边界</span><small>{diagnosis.boundaries?.formalSignalUnchanged !== false ? "正式信号未改写" : "正式信号边界待核查"} · {diagnosis.boundaries?.shadowResearchOnly !== false ? "影子层仅供研究" : "影子层边界待核查"} · 不自动下单</small></div>
        </>}
      </section>
    </div>
  );
}
