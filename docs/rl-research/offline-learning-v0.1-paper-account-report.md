# Offline Learning V0.1 Paper Account Integration V1

The shared DATA-07 TEST ReplayContext was evaluated through the existing `lib/paper-trading/paper-execution-engine.mjs`. Each policy received a fresh independent account; strategy, model, ReplayContext, reward, and production integrations were unchanged.

| Field | Value |
|---|---:|
| Dataset hash | `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825` |
| TEST range | `20251009T09:30:00` to `20260417T15:00:00` |
| Bars / states | 30,848 / 30,848 |
| Initial cash | 1,000,000 CNY |
| Initial position | 1,000 shares |
| Commission | 0.025%, minimum 5 CNY |
| Stamp duty | 0.05% on sells |
| Slippage | 0.02% |

| Account | Trades | Ending cash | Position | Realized PnL | Fees | Slippage | Net return | Max drawdown |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Expert | 510 | 2,858.49 | 0 | 126,930.67 | 2,709.81 | 326.70 | 12.7636% | 33.2163% |
| Learned | 2,591 | 1,184,613.32 | 0 | 179,059.96 | 15,038.11 | 1,626.57 | 17.9060% | 5.6941% |
| Random | 324 | 1,472.66 | 0 | 0 | 1,620.00 | 199.34 | 12.6292% | 33.2558% |
| AlwaysWait | 0 | 1,000,000.00 | 1,000 | 0 | 0 | 0 | 0.3404% | 1.4243% |
| Majority | 0 | 1,000,000.00 | 1,000 | 0 | 0 | 0 | 0.3404% | 1.4243% |

The complete machine-readable output is [offline-learning-v0.1-paper-account-report.json](./offline-learning-v0.1-paper-account-report.json).

`netReturn` is mark-to-market ending account equity relative to initial cash plus the initial position valued at the first TEST close. `maxDrawdown` is peak-to-trough mark-to-market account equity drawdown. Fees and slippage are those returned by the existing Paper Execution Engine. No real trading or automatic promotion is enabled.

Production isolation: `affectsSmartT=false`, `affectsShadowV2=false`, `canPromoteAutomatically=false`.
