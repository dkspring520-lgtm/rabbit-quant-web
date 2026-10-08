# V0.12.63 — Unified Right Rail Dashboard

Date: 2026-10-08 Asia/Shanghai
Scope: UI/UX consolidation only

## Implementation

- Applied to the production Trading Desk route, not only the zijin-lab-redesign comparison view.
- Added one unified right-rail identity and grouped Current Guidance, decision summary, market/L2 context, and Position/T+1 as a single instrument surface.
- Current Guidance is the first expanded section. Decision summary, market context/L2, and Position/T+1 are secondary collapsible sections. Existing guidance timeline and historical research remain collapsed within the guidance surface; no new signal or data source was added.
- Preserved the existing layout manager, panel registry, visibility, persistence, presets, and underlying data components.
- When the market session is closed, the reverse-T and signal-fusion display explicitly says it is historical/replay context, not a current live signal. Yellow chart marks remain available as intraday history.

## Boundaries

No Feature, State, Opportunity, Guidance calculation, Reward, T+1, Sample, Replay, RL, or execution logic was modified. No BUY/SELL rule was added.

## Final Gate

STATUS = COMPLETED_UI_ONLY
UNIFIED_RIGHT_RAIL = IMPLEMENTED_IN_PRODUCTION_TRADING_DESK
DUPLICATES_REMOVED = REDUNDANT_GUIDANCE_BADGE_AND_REPEATED_CONTEXT_SUMMARY
SECTIONS_CONSOLIDATED = CURRENT_GUIDANCE + DECISION_SUMMARY + MARKET_CONTEXT_L2 + POSITION_T1 + TIMELINE + HISTORICAL_RESEARCH
DEFAULT_LAYOUT = MAIN_WORKSPACE_DOMINANT + CURRENT_GUIDANCE_EXPANDED + SECONDARY_SECTIONS_COLLAPSED
RESPONSIVE = DESKTOP_AND_MOBILE_CSS_UPDATED
MODULAR_LAYOUT_PRESERVED = TRUE
BUSINESS_LOGIC_CHANGED = FALSE
STATE_LOGIC = UNCHANGED
GUIDANCE_LOGIC = UNCHANGED
REWARD = UNCHANGED
T1_SEMANTICS = PASS
HARD_STOP = TRUE
