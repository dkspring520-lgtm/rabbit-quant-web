# Codex Task Specification: Smart-T Engine V6 Upgrade (做T核心逻辑全面升级规范)

> **Role & Objective for Codex**:
> You are upgrading the core quantitative day-trading engine (`lib/smart-t-engine.mjs`, `lib/qmt-orderflow-confirmation.mjs`, and `lib/factor-research/`) for the **双兔助手 · 做T神器 (zuot-shenqi)** A-share intraday T+0 system.
> All modifications **MUST STRICTLY OBEY THE CAUSAL PRINCIPLE (因果性原则，严禁未来函数)**. Decisions at minute $t$ can ONLY use data $\le t$.

---

## 1. 核心升级目标概览 (Core Upgrade Pillars)

1. **模块一：因果性日内市场状态自适应 (Causal Market Regime Detection)**
   - 动态识别当前处于：`BULL_TREND` (单边多头), `BEAR_TREND` (单边空头), `WIDE_RANGE` (宽幅震荡), `NARROW_RANGE` (窄幅缩量/死水)。
   - 自适应调整做T策略参数（网格幅度、止盈止损线、单边市逆势单阻断）。

2. **模块二：L2 盘口失衡度 (OBI) 与虚假挂单/假突破防御 (Order Book Imbalance & Spoofing Guard)**
   - 在 `lib/qmt-orderflow-confirmation.mjs` 中增强五档/十档盘口买卖失衡度计算与大单撤单异动监控。
   - 过滤冲高诱多与砸盘诱空（如盘口大单托单但逐笔主动卖出为主的诱多结构）。

3. **模块三：48 因子实验室与 Smart-T 决策引擎深度打通 (Factor Research Integration)**
   - 将 `lib/factor-research/factor-registry.mjs` 中经 OOS 验证的高胜率因子接入 `evaluateTripleScoreEvidence`。
   - 实现加权因子复合打分替代部分固定硬编码阈值。

---

## 2. 详细实现规范 (Detailed Technical Specifications)

### 任务 1：实现因果市场状态识别器 (`lib/market-regime-detector.mjs`)

**新建文件**：`lib/market-regime-detector.mjs`
**类型声明**：`lib/market-regime-detector.d.mts`

#### 逻辑定义：
在任意分钟 $t$（基于 `points[0..t]`），计算：
1. **VWAP 偏离与斜率**：$VWAP\_Slope_{15} = \frac{VWAP_t - VWAP_{t-15}}{VWAP_{t-15}}$。
2. **价格相对于 VWAP 的持续度**：过去 30 分钟内位于 VWAP 上方/下方的分钟占比。
3. **分时振幅与成交量加权波动**：$ATR\_Ratio = \frac{ATR_{14}(t)}{ATR_{avg\_5d}}$。
4. **状态判定逻辑**：
   - `BULL_TREND`: 价格在 VWAP 上方占比 $> 75\%$ 且 $VWAP\_Slope_{15} > +0.15\%$ 且日内涨幅 $> +1.2\%$。
   - `BEAR_TREND`: 价格在 VWAP 下方占比 $> 75\%$ 且 $VWAP\_Slope_{15} < -0.15\%$ 且日内跌幅 $< -1.2\%$。
   - `WIDE_RANGE`: 日内振幅 $> 1.8\%$，价格在 VWAP 上下频繁穿梭（穿越次数 $\ge 3$）。
   - `NARROW_RANGE`: 日内振幅 $< 1.0\%$ 且量比 $< 0.8$。

#### 导出函数签名：
```typescript
export type IntradayRegime = "BULL_TREND" | "BEAR_TREND" | "WIDE_RANGE" | "NARROW_RANGE" | "NEUTRAL";

export interface RegimeEvaluation {
  regime: IntradayRegime;
  vwapSlope15: number;
  vwapAboveRatio30: number;
  sessionRangePct: number;
  regimeMultiplier: {
    targetNetPctMultiplier: number;
    hardStopPctMultiplier: number;
    allowPositiveT: boolean;
    allowReverseT: boolean;
    counterTrendStrictness: number;
  };
}

export function detectCausalMarketRegime(
  points: Array<{ time: string; price: number; volume: number }>,
  currentIndex: number,
  vwaps: number[],
  previousClose: number
): RegimeEvaluation;
```

---

### 任务 2：L2 盘口失衡度 (OBI) 与订单流增强 (`lib/qmt-orderflow-confirmation.mjs`)

在现有 `lib/qmt-orderflow-confirmation.mjs` 中扩展以下算法：

1. **五档/十档盘口失衡度 (Order Book Imbalance, OBI)**：
   $$OBI_t = \frac{\sum_{i=1}^5 BidQty_i - \sum_{i=1}^5 AskQty_i}{\sum_{i=1}^5 (BidQty_i + AskQty_i) + \epsilon}$$
   - $OBI_t \in [-1.0, +1.0]$。
   - $OBI_t > +0.3$：买盘深度显著占优；$OBI_t < -0.3$：卖盘压力显著占优。

2. **诱多/诱空背离检测 (Spoofing & Divergence Filter)**：
   - **诱多陷阱 (Bull Trap)**：价格处于冲高反T候选点，盘口显示大买单托单（$OBI > 0.4$），但近 3 分钟逐笔成交中**主动卖单金额 (Active Sell Volume)** 占比 $> 65\%$。$\Rightarrow$ 判定为托单掩护出货，强化反T确认。
   - **诱空陷阱 (Bear Trap)**：价格快速下砸正T候选点，盘口大卖单压单（$OBI < -0.4$），但逐笔成交中**主动买单金额 (Active Buy Volume)** 占比 $> 65\%$。$\Rightarrow$ 判定为压单吸筹，加速正T确认。

#### 扩展函数：
```javascript
export function evaluateOrderBookImbalance(l2Snapshot) {
  if (!l2Snapshot || !l2Snapshot.bidVolumes || !l2Snapshot.askVolumes) {
    return { obi: 0, depthRatio: 1.0, available: false };
  }
  const totalBid = l2Snapshot.bidVolumes.slice(0, 5).reduce((a, b) => a + b, 0);
  const totalAsk = l2Snapshot.askVolumes.slice(0, 5).reduce((a, b) => a + b, 0);
  const sum = totalBid + totalAsk;
  if (sum === 0) return { obi: 0, depthRatio: 1.0, available: true };
  return {
    obi: (totalBid - totalAsk) / sum,
    depthRatio: totalBid / Math.max(totalAsk, 1),
    totalBidDepth: totalBid,
    totalAskDepth: totalAsk,
    available: true
  };
}
```

---

### 任务 3：在 `smart-t-engine.mjs` 中接入自适应机制与因子加权

在 `lib/smart-t-engine.mjs` 的主循环中：

1. **引入市场状态调整**：
   ```javascript
   import { detectCausalMarketRegime } from "./market-regime-detector.mjs";
   ```
2. **在每分钟遍历中计算当前 Regime**：
   - 动态更新当前分钟策略参数：
     - 若处于 `BEAR_TREND`：
       - 禁止或极度提高正T（低吸）门槛 (`positiveTMinPivotAge` 提高至 6，`counterTrendMinVolumeRatio` 提高至 1.3)。
       - 适度放宽反T（高抛）的止盈目标（从 0.64% 上调至 0.85%），允许捕捉单边下跌中的深幅回踩。
     - 若处于 `BULL_TREND`：
       - 禁止或极度提高反T（高抛）门槛，避免上升趋势中被洗飞。
       - 正T止盈目标适度上调，跟踪止盈激活线（`trailActivationPct`）上调。
     - 若处于 `NARROW_RANGE`：
       - 扣除佣金印花税后利润空间不足，提高入场阈值 `scoreThreshold`，减少垃圾交易。

3. **更新 `lib/smart-t-engine.d.mts` 中的类型定义**，确保与 TypeScript / JSDoc 强契约对齐。

---

## 3. 测试与验证要求 (Verification & Test Invariants)

在完成上述修改后，必须在终端执行并通过全部自动化测试：

```bash
# 1. 运行 Node.js 单元测试套件
npm test

# 2. 重点验证做T核心引擎及因子测试
node --test tests/smart-t-engine.test.mjs
node --test tests/qmt-orderflow-confirmation.test.mjs
node --test tests/factor-research.test.mjs
node --test tests/zijin-shadow-ab.test.mjs

# 3. 运行代码 Lint 检查
npm run lint
```

### 关键不变式约束 (Safety Invariants):
1. 严禁修改或破坏现有的生产数据库配置（Drizzle/D1）及会员认证体系。
2. 历史回测结果中，所有指标必须依然满足 `gross > net`（严格计提印花税 0.05%、佣金及滑点）。
3. 因子与状态计算中严禁出现 `points[points.length - 1]` 探测全天极值的后视镜代码。

---
*文档生成位置*: `C:\Users\dkspr\Documents\我的网站\CODEX_TASK_SPEC.md`
*目标执行者*: OpenAI Codex / Claude / 本地协作 Agent
