# OFFLINE-LEARNING-01B OOS Report

## Dataset

The required source is the DATA-07 verified `601899.SH` 1-minute dataset (`2022-01-04` to `2026-04-17`, 249,917 bars, 40,334 resolved samples, hash `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`). This report does not claim a PASS until those resolved sample rows are loaded from the verified replay output. Synthetic samples and action balancing are prohibited.

## Split and Model

Chronological ranges are fixed: train through `2024-12-31`, validation `2025-01-01` to `2025-09-30`, test `2025-10-01` to `2026-04-17`. The nearest-centroid model fits train rows only. Validation is diagnostic; test remains untouched until final evaluation. `BUY` and `SELL_PART` remain `UNSEEN_BY_EXPERT`.

## Evaluation Contract

The module now provides deterministic confusion/per-action metrics, explicit WAIT/BUY_SMALL/SELL_ALL agreement, fixed-seed baselines (`AlwaysWait`, `MajorityClass`, `SeededRandom`, `ExpertActionReplay`), reproducibility hashing, and a complete snapshot shape containing train/validation/test metrics, agreement, replay metrics, and gate status. Any missing real audit evidence keeps the gate blocked.

## Leakage and Reproducibility

The required mutation points are T=50,000, 125,000, and 200,000. The audit must prove that earlier state, expert action, prediction input, and prediction are invariant after future-only mutation. The reproducibility hash must cover the frozen dataset hash, state/feature/model versions, seed, split, metrics, predictions, and replay output.

## Policy Replay and Gate

Learned policy replay must use the existing HistoricalReplay, SignalSample, and Performance Analytics contracts. Signal-return drawdown must be labeled `SIGNAL_RETURN_DRAWDOWN`; it is not a Paper Account drawdown. No execution path is changed.

`OFFLINE_MODEL_READY = BLOCKED` until real DATA-07 rows, OOS metrics, all baselines, policy replay, leakage, reproducibility, and snapshot integrity have been independently recorded. Production isolation remains `affectsSmartT=false`, `affectsShadowV2=false`, `canPromoteAutomatically=false`.
