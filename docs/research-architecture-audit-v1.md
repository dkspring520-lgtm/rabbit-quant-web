# 做T神器 Research Architecture Audit V1.0

## 结论

项目已有一条可复用的研究主干，本轮不再创建第二套因子、数据集或回测引擎。正式 Smart‑T、Zijin Shadow V2 与实时监控保持隔离；研究结果只能进入候选/影子流程，不能自动晋级或下单。

## 1. 当前真实数据流

```text
行情 / L2 / 分钟数据
  → API 与采集器
  → 会话/分钟数据归一化
  → authenticated-app 与正式 Smart‑T
  → BUY / SELL / ENTRY / 风控展示
```

生产核心入口包括 `app/api/market-data/route.ts`、`app/api/trading-desk-snapshot/route.ts`、`lib/smart-t-engine.mjs` 和 `lib/t-cycle-state-machine.mjs`。本轮没有修改这些路径。

## 2. 当前唯一研究主干

```text
Market Data
  → Data Normalization
  → FactorEngine / CausalFactorContext
  → Research Dataset
  → FactorBacktestEngine
  → FactorCombinationBacktestEngine
  → FactorClosureBacktestEngine
  → OOS / Future-Invariance Audit
  → Factor Evaluation
  → Candidate / Shadow
  → Human Approval
  → Production（仅人工发布后）
```

可复用实现位于 `lib/factor-research/`：`factor-engine.mjs`、`factor-backtest-engine.mjs`、`factor-combination-backtest.mjs`、`factor-closure-backtest.mjs`、`factor-evaluation.mjs`、`reproducibility.mjs`。

## 3. 模块职责

- `FactorEngine`：按因子注册表和因果上下文计算当前及历史可用因子。
- `FactorBacktestEngine`：单因子时间切分、训练阈值、验证/锁定测试、滚动 OOS。
- `FactorCombinationBacktestEngine`：组合因子标准化、训练期阈值和成本覆盖门槛。
- `FactorClosureBacktestEngine`：在组合候选上模拟止盈/止损/超时闭环，并审计分钟 OHLC 语义。
- `factor-evaluation.mjs`：IC、稳定性、胜率、收益、回撤和分组表现。
- `zijin-factor-lifecycle.mjs`：紫金因子注册表、影子池和人工晋级门槛；强制 `affectsFormalStrategy=false`。
- `zuot-v2-shadow.mjs`、`shadow-research-layer.mjs`：候选/观察/影子事件，不替代 Smart‑T。

## 4. Alpha Lab 审计结果

当前代码中“RABBIT ALPHA LAB”主要是生命周期可视化和注册表说明；没有发现可执行的通用 candidate-expression parser/registry。现有可执行组合使用显式 `recipe.components[].factorId`，由 `FactorEngine` 计算后传入组合回测。

因此当前结论是：

- VWAP、量能、相对强弱、动量、订单流等注册因子会真实计算并进入组合评分。
- 组合标准化使用训练期 scaler，阈值使用训练期 quantile。
- 未发现“找不到 expression 后静默退回 base factor”的通用 Alpha Lab 执行路径；也不存在可以宣称已执行任意字符串 expression 的实现。
- 未来若加入 expression，必须以唯一 `candidateId` + 唯一 `expression` + 显式 transform 参数注册；解析失败必须返回 `candidate_evaluation_error`/`candidate_invalid`，禁止 fallback。

## 5. OOS 审计与修复

单因子和组合回测已经使用时间顺序切分，训练期拟合 threshold/scaler，验证和锁定测试只应用已锁定参数。闭环回测也声明 `testRefit=false`、锁定测试区间和 development-only rolling scope。

本轮发现并修复：`factor-closure-backtest.mjs` 的 rolling fold 重新拟合了 fold model/diagnostic thresholds，但原实现通过外层 simulator 闭包默认参数捕获首个 train model，存在把 rolling fold 误评为外层模型的风险。现在每个 fold 显式把该 fold 的 locked model 和 diagnostics 传入 simulator，避免参数串用。该修复只影响研究报告，不影响生产信号。

## 6. Future leakage

`CausalFactorContext` 拒绝 future/label 输入；`auditFutureInvariance` 用未来数据扰动检查历史因子不应变化；单因子、组合、闭环报告均输出 leakage audit。测试覆盖未来扰动、因果字段拒绝和时间切分不重叠。

## 7. Candidate 生命周期

现有因子注册表和影子模块已实现 shadow-only、人工评审、晋级门槛以及 `affectsFormalStrategy=false`。注册表具有版本、状态、pool、证据和 gate；每日运行输出 `continue-shadow`。建议后续统一补齐每个候选的 `candidateId`、`createdAt`、`validatedAt`、`promotedAt`、`reason`、`modelVersion`、`datasetVersion`，但本轮不创建新的生命周期系统。

## 8. 重复模块与复用建议

历史上存在单因子、组合、闭环、Zijin 专项和 Python 实验脚本并行，但它们应被视为同一研究主干的不同实验入口。`lib/rl-research/` 只能作为未来 Paper/RL adapter，不得成为第二个 Factor/Backtest/Dataset Engine；本轮不接入 FinRL、不改变生产链。

## 9. 生产隔离

`FactorCombinationBacktestEngine`、`FactorClosureBacktestEngine` 返回 `affectsSmartT=false`、`affectsProductionStrategy=false`、`canPromoteAutomatically=false`；生命周期注册表强制关闭正式策略写入。研究结果不能自动修改 Smart‑T、Zijin Shadow V2、Live Monitoring 或订单链。

## 10. RL 预留位置

未来 RL 只允许接在 `Candidate / Research → Experimental Model`，复用现有研究样本和 Paper 执行约束，观测至少包含价格、VWAP、量价、订单流、持仓、可卖仓位和时间；动作先限于 WAIT/BUY/SELL；奖励扣除成本、滑点、回撤和过度交易。RL 与规则基线并行，必须经过 OOS、影子和人工审批后才可能发布。

## 11. 推荐后续顺序

1. 给候选表达式补一个严格注册/解析接口和 correctness tests。
2. 统一 candidate snapshot：因子值、transform、参数、threshold、dataset/model version、as-of 时间。
3. 为每个生命周期状态补齐事件 ledger，仍保持 shadow-only。
4. 继续扩大 future-invariance 与 walk-forward 测试覆盖。
5. 只有完成上述研究正确性后，再评估 RL adapter；不把 RL 接入实时信号。

## 12. 本轮修改与验证

- 修改：`lib/factor-research/factor-closure-backtest.mjs`，修复 rolling fold 参数串用。
- 新增：`docs/research-architecture-audit-v1.md`。
- 测试增强：`tests/factor-research.test.mjs` 检查 fold 参数标记和 train-only diagnostics。
- 未修改：Smart‑T、Zijin Shadow V2、生产信号、UI、真实交易。
