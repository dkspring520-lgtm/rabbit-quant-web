"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type Stage = 0 | 1 | 2 | 3 | 4;
type FortuneContext = { code: string; name: string; cycle: string; compact: boolean };
type StartDetail = Partial<Omit<FortuneContext, "compact">> & { compact?: boolean };

const FULL_TIMELINE: ReadonlyArray<readonly [number, Stage]> = [
  [0, 0],
  [650, 1],
  [1550, 2],
  [2650, 3],
  [3850, 4],
];

const COMPACT_TIMELINE: ReadonlyArray<readonly [number, Stage]> = [
  [0, 2],
  [720, 3],
  [1550, 4],
];

const REDUCED_TIMELINE: ReadonlyArray<readonly [number, Stage]> = [
  [0, 3],
  [280, 4],
];

const COPY: Record<Stage, { eyebrow: string; title: string; detail: string }> = {
  0: { eyebrow: "EARTH MARKET · 地球市场", title: "定位市场时空坐标", detail: "读取股票、周期与现实行情" },
  1: { eyebrow: "SIGNAL UPLINK · 指令上行", title: "向星域发送推演指令", detail: "市场信号正在穿越地球轨道" },
  2: { eyebrow: "DEEP SPACE · 星海巡航", title: "进入星辰数据海", detail: "连接星象、周期与价格轨迹" },
  3: { eyebrow: "RESONANCE · 多维共振", title: "卦势、星象与量价汇聚", detail: "量化兔与天机兔正在交叉复核" },
  4: { eyebrow: "DOUBLE RABBIT CONSENSUS", title: "双兔合议完成", detail: "正在展开未来路径与转折窗口" },
};

const PARTICLES = [-210, -164, -116, -70, -28, 18, 62, 108, 158, 206] as const;

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function fortuneButton(button: HTMLButtonElement) {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/fortune") return false;
  if (button.disabled || button.dataset.fortuneTransition === "off") return false;
  if (button.closest("[data-fortune-transition-ignore='true']")) return false;
  if (button.dataset.fortuneTrigger === "true") return true;
  const label = clean(button.textContent).replace(/[→›»]+$/g, "");
  return label === "起卦" || label.includes("重新起卦") || /^开始.*推演$/.test(label) || /^为.+(?:起卦|推演)$/.test(label);
}

function readContext(button?: HTMLButtonElement | null, compact = false): FortuneContext {
  const scope = button?.closest("form") ?? document;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>("input"));
  const pageInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  const allInputs = [...inputs, ...pageInputs.filter((item) => !inputs.includes(item))];
  const codeInput = allInputs.find((input) => /^\d{6}$/.test(input.value.trim()));
  const nameInput = allInputs.find((input) => {
    const value = input.value.trim();
    return value !== codeInput?.value && /[\u4e00-\u9fff]/.test(value) && value.length <= 16;
  });
  const label = clean(button?.textContent);
  const nameFromButton = label.match(/为(.+?)(?:起卦|推演)/)?.[1];
  const select = (scope.querySelector("select") ?? document.querySelector("select")) as HTMLSelectElement | null;
  const activeCycle = document.querySelector<HTMLElement>("[data-cycle].active,[data-cycle][aria-pressed='true']");

  return {
    code: codeInput?.value.trim() || "A股",
    name: nameInput?.value.trim() || nameFromButton || "目标股票",
    cycle: select?.selectedOptions?.[0]?.textContent?.trim() || activeCycle?.textContent?.trim() || "未来周期",
    compact,
  };
}

function compactMode(button: HTMLButtonElement) {
  if (button.dataset.fortuneAnimation === "full") return false;
  if (button.dataset.fortuneAnimation === "compact") return true;
  if (clean(button.textContent).includes("重新")) return true;
  try {
    return sessionStorage.getItem("fortune-cosmic-animation-seen") === "1";
  } catch {
    return false;
  }
}

export default function FortuneCosmicTransition() {
  const [visible, setVisible] = useState(false);
  const [stage, setStage] = useState<Stage>(0);
  const [runId, setRunId] = useState(0);
  const [context, setContext] = useState<FortuneContext>({ code: "A股", name: "目标股票", cycle: "未来周期", compact: false });
  const timers = useRef<number[]>([]);
  const active = useRef(false);
  const currentContext = useRef(context);
  const skipButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentContext.current = context;
  }, [context]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const finish = useCallback((reason: "completed" | "skipped" | "restarted") => {
    clearTimers();
    active.current = false;
    setVisible(false);
    window.dispatchEvent(new CustomEvent("fortune:oracle-animation-end", { detail: { reason, ...currentContext.current } }));
  }, [clearTimers]);

  const start = useCallback((next: FortuneContext) => {
    if (active.current) finish("restarted");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeline = reduced ? REDUCED_TIMELINE : next.compact ? COMPACT_TIMELINE : FULL_TIMELINE;
    const duration = reduced ? 720 : next.compact ? 2420 : 4820;

    active.current = true;
    setContext(next);
    setStage(timeline[0]?.[1] ?? 0);
    setRunId((value) => value + 1);
    setVisible(true);

    timeline.slice(1).forEach(([time, nextStage]) => {
      timers.current.push(window.setTimeout(() => setStage(nextStage), time));
    });
    timers.current.push(window.setTimeout(() => finish("completed"), duration));
    try {
      sessionStorage.setItem("fortune-cosmic-animation-seen", "1");
    } catch {
      // The transition works even when storage is blocked.
    }
  }, [finish]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button || !fortuneButton(button)) return;
      window.setTimeout(() => start(readContext(button, compactMode(button))), 0);
    };

    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<StartDetail>).detail ?? {};
      const base = readContext(null, Boolean(detail.compact));
      start({
        ...base,
        ...detail,
        code: detail.code?.trim() || base.code,
        name: detail.name?.trim() || base.name,
        cycle: detail.cycle?.trim() || base.cycle,
        compact: Boolean(detail.compact),
      });
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("fortune:oracle-start", onStart as EventListener);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("fortune:oracle-start", onStart as EventListener);
      clearTimers();
    };
  }, [clearTimers, start]);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.documentElement.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish("skipped");
    };
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => skipButton.current?.focus({ preventScroll: true }));
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [finish, visible]);

  if (!visible) return null;

  const copy = COPY[stage];
  const style = { "--oracle-duration": context.compact ? "2420ms" : "4820ms" } as CSSProperties;

  return (
    <div
      key={runId}
      className={`fortune-oracle-overlay fortune-oracle-stage-${stage}${context.compact ? " is-compact" : ""}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="双兔时空推演动画"
    >
      <div className="fortune-oracle-space">
        <div className="fortune-oracle-nebula fortune-oracle-nebula-a" />
        <div className="fortune-oracle-nebula fortune-oracle-nebula-b" />
        <div className="fortune-oracle-stars fortune-oracle-stars-far" />
        <div className="fortune-oracle-stars fortune-oracle-stars-near" />
        <div className="fortune-oracle-streaks" />

        <svg className="fortune-oracle-beam-field" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="fortuneBeam" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#7ee7ff" stopOpacity="0" />
              <stop offset="32%" stopColor="#7ee7ff" stopOpacity=".9" />
              <stop offset="76%" stopColor="#f0c675" stopOpacity=".95" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fortuneChart" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7ee7ff" />
              <stop offset="52%" stopColor="#d7b2ff" />
              <stop offset="100%" stopColor="#f0c675" />
            </linearGradient>
            <filter id="fortuneGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <path className="fortune-oracle-beam main" d="M800 840 C800 680 735 565 800 430 C860 305 820 190 800 55" />
          <path className="fortune-oracle-beam left" d="M780 840 C690 680 565 570 520 420 C470 270 570 150 675 65" />
          <path className="fortune-oracle-beam right" d="M820 840 C910 690 1040 585 1080 430 C1120 270 1020 150 925 65" />
          <g className="fortune-oracle-constellation" filter="url(#fortuneGlow)"><path d="M540 245 L650 170 L785 225 L930 145 L1050 245 L920 340 L785 295 L650 360 Z" />{[540,650,785,930,1050].map((x,index)=><circle key={x} cx={x} cy={[245,170,225,145,245][index]} r="4" />)}</g>
          <g className="fortune-oracle-market-trace"><path d="M565 560 L635 520 L690 552 L755 475 L820 500 L885 425 L960 450 L1035 370" /><line x1="565" y1="595" x2="1035" y2="595" /></g>
        </svg>

        <div className="fortune-oracle-earth" aria-hidden="true"><div className="fortune-oracle-earth-grid" /><div className="fortune-oracle-earth-land" /><div className="fortune-oracle-earth-node" /><div className="fortune-oracle-earth-ring a" /><div className="fortune-oracle-earth-ring b" /></div>
        <div className="fortune-oracle-command" aria-hidden="true"><span>ORACLE REQUEST</span><b>{context.code}</b><em>{context.cycle}</em></div>
        <div className="fortune-oracle-particle-stream" aria-hidden="true">{PARTICLES.map((x,index)=><i key={x} style={{ "--particle-x": `${x}px`, "--particle-end-x": `${Math.round(x * .28)}px`, "--particle-delay": `${index * 135}ms` } as CSSProperties} />)}</div>

        <div className="fortune-oracle-resonance" aria-hidden="true">
          <div className="fortune-oracle-orbit outer">{[0,1,2,3].map((index)=><i key={index} style={{ "--star-angle": `${index * 90}deg` } as CSSProperties} />)}</div>
          <div className="fortune-oracle-orbit inner">{[0,1,2,3].map((index)=><i key={index} style={{ "--star-angle": `${index * 90 + 45}deg` } as CSSProperties} />)}</div>
          <div className="fortune-oracle-bagua"><span className="top"><i /><i /><i /></span><span className="right"><i /><i /><i /></span><span className="bottom"><i /><i /><i /></span><span className="left"><i /><i /><i /></span></div>
          <div className="fortune-oracle-core"><span>双兔</span><b>推演</b></div>
        </div>

        <div key={stage} className="fortune-oracle-copy" aria-live="polite"><span>{copy.eyebrow}</span><h2>{copy.title}</h2><p>{context.name} · {context.code} · {copy.detail}</p></div>
        <div className="fortune-oracle-status" aria-hidden="true">{[0,1,2,3,4].map((item)=><i key={item} className={item <= stage ? "active" : ""} />)}</div>
        <div className="fortune-oracle-progress" aria-hidden="true"><i /></div>
        <button ref={skipButton} className="fortune-oracle-skip" type="button" data-fortune-transition-ignore="true" onClick={(event) => { event.stopPropagation(); finish("skipped"); }}>跳过动画</button>
      </div>
    </div>
  );
}
