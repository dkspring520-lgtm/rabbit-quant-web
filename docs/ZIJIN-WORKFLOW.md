# 紫金矿业做T工作流

## 验收

```powershell
node scripts/verify-zijin-workflow.mjs E:/zijin-l2/601899-factor-minute-ohlc-v1.jsonl
node --test tests/smart-t-engine.test.mjs tests/smart-t-direction-veto.test.mjs
```

验收命令检查跨日现金和仓位结转、T+1可卖数量、下一分钟成交、方向性滑点、持有基准、L2分钟顺序和拒单数量。

## 回测

```powershell
node scripts/backtest-zijin-crossday-t1.mjs E:/zijin-l2/601899-factor-minute-ohlc-v1.jsonl all
node scripts/backtest-zijin-crossday-t1.mjs E:/zijin-l2/601899-factor-minute-ohlc-v1.jsonl all 20260102 20260430
```

第三个参数可以传入研究用的反T截止时间，例如 `1330`。它只用于对照，不代表正式策略已经启用。

## L2校准

```powershell
node scripts/audit-zijin-l2-calibration.mjs E:/zijin-l2/601899-factor-minute-ohlc-v1.jsonl
```

L2支持、冲突和缺失必须分别统计，并且要在独立时间段用下一分钟成交结果验证。当前历史结果不支持把L2支持直接加入正式买卖评分。

## 当前发布门槛

- 核心策略测试全部通过。
- T+1违规和拒单原因必须可审计。
- 回测必须同时输出买入持有基准。
- 正式评分改动必须在滚动验证中改善超额结果。
- 观察信号不触发语音；只有正式买卖和风险提醒可触发语音。

当前回测仍是研究工具：成交后不会重新生成当日策略路径，不能当作真实券商撮合或实盘收益承诺。任何评分或时间门控改动都必须先经过影子回测和独立验证。
