# Offline Learning V0.1

## Scope

This is a research-only behavior-cloning experiment: it learns `State -> Expert Action` from the existing OHLCV research labels. It does not change Smart-T, OHLCV_T_RESEARCH_V1, Shadow V2, Paper Execution, RL action space, or any live path.

## Dataset

The DATA-07 source is `601899.SH` 1-minute data from `2022-01-04` through `2026-04-17` (`249,917` bars, `1,037` trading days, dataset hash `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`). It produced `40,334` resolved expert samples. The earlier DATA-07 action counts (`WAIT=209,583`, `BUY_SMALL=39,892`, `SELL_ALL=442`) are bar-level counts; this report must use the 40,334 resolved sample rows for model fitting and report their separate distribution. `BUY` and `SELL_PART` are `UNSEEN_BY_EXPERT`, and are not fabricated.

## State Schema V0.1

The adapter exposes causal, serializable fields for returns (1/3/5/10 bars), price acceleration, VWAP/MA location and slopes, volume/amount, wick/body ratios, rolling volatility, regime, sentiment, session position, and position/cash context. Existing OHLCV feature calculations are reused; no second production feature engine is introduced. Missing position/cash inputs remain `null` rather than being guessed.

## Labels and Splits

The supervised expert head is the three-class set `WAIT`, `BUY_SMALL`, `SELL_ALL`. The five-class RL action space remains unchanged. Splits are chronological: train through `2024-12-31`, validation `2025-01-01` to `2025-09-30`, and test `2025-10-01` to `2026-04-17`; no random split is used.

## Model and Metrics

V0.1 uses a deterministic nearest-centroid classifier implemented with the standard library. Seed `17`, Euclidean distance, and model version `offline-behavior-centroid-v0.1` are recorded in the snapshot. Metrics include accuracy, macro/weighted F1, confusion matrix, per-action precision/recall/F1, SELL_ALL recall, BUY_SMALL recall, and action agreement. Accuracy is classification accuracy and is not treated as return.

Policy replay remains research-only. A model prediction is never routed to Paper Execution; a paper-account result is not claimed unless the existing replay pipeline explicitly resolves it.

## Gates

The snapshot records dataset hash, state/model versions, feature list, label space, ranges, seed, hyperparameters, metrics, and isolation flags (`affectsSmartT=false`, `affectsShadowV2=false`, `canPromoteAutomatically=false`). Leakage and reproducibility must be supplied by the DATA-07 audit before promotion. With no persisted full-run model evaluation in this change, `OFFLINE_MODEL_READY = BLOCKED` pending a real split evaluation and policy replay audit.

Training algorithms such as PPO, DQN, SAC, Transformer RL, online learning, and real trading are out of scope.
