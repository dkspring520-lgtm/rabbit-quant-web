# OFFLINE RL V0.12.29 — Human T Guidance Layer Implementation Audit

Audit date: 2026-10-06

## Scope

This phase adds an explanation-only layer over existing Feature, State and Opportunity outputs. It does not repair the State Engine root cause identified in V0.12.28.3.

## Implemented

- `lib/t-guidance/`: labels, formatting, deterministic guidance mapping and causal reminder compaction.
- `lib/t-observation.mjs`: attaches `humanGuidance`, `guidanceHistory` and `reminders` to the existing observation payload.
- Trading desk: uses real `tObservation` data and presents human-readable guidance.
- Intraday chart: renders a limited number of observation-only `🟢 T`, `🟠 T` and `◆` markers with hover details.

## Safety Boundary

Guidance outputs are limited to: `关注买入`, `关注卖出`, `等待确认`, `继续观察`, `暂不操作`, and `数据不足`. They are not BUY/SELL commands, probabilities, expected returns or execution permissions.

`candidateState` and final State remain separate. A candidate transition is explained as a pending structural change; it is not promoted to a reversal.

## Data Contract

The desk snapshot requests real market minutes when observation data is needed, then computes the existing causal Feature → State → Opportunity chain. No fake UI values are introduced.

## Reminder Contract

Reminders are causal, observation-only, capped, and emitted only when the guidance label/marker changes. They do not enter formal alert, voice, push, order, Paper Trading, or Decision Engine paths.

## Root-Cause Isolation

No Feature, State, Opportunity, Indicator, Reward, T+1, DATA-07 sample, or root-cause audit conclusion was modified. The known exhaustion priority/hysteresis behavior is surfaced through warnings such as “候选变化尚未完成状态切换”.

## Verification

- `tests/t-guidance.test.mjs` added for positive/counter/neutral/warmup/invalid guidance and reminder causality.
- `npm test`: PASS, 1162/1162.
- `npm run build`: PASS.
- `git diff --check`: PASS.

## Final Gate

```text
T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
PAPER_TRADING = NOT_STARTED
T_DECISION_ENGINE = NOT_STARTED
MODEL_CHANGE = PROPOSAL_ONLY
HARD_STOP = TRUE
```
