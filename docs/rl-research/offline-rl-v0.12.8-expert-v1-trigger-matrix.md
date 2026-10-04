# Offline RL V0.12.8 Expert V1 Trigger Matrix

V1 decision tree is audited from the existing source. BUY and SELL_PART branches are defined; current zero observed counts mean branch conditions did not pass in current coverage, not execution infeasibility.

- WAIT: observed=209714, blocked=209714, trigger=default unless positiveT or reverseT passes
- BUY_SMALL: observed=39686, blocked=208707, trigger=trend=UP AND pullback(distanceToVWAP<=0.003, return3m<0, priceAcceleration>-0.003) AND sentiment RECOVERY/NEUTRAL AND score<70
- BUY: observed=0, blocked=248393, trigger=same positiveT gates AND score>=70
- SELL_PART: observed=0, blocked=517, trigger=sentiment=OVERHEATED AND distanceFromHigh>-0.01 AND score<75
- SELL_ALL: observed=517, blocked=0, trigger=sentiment=OVERHEATED AND distanceFromHigh>-0.01 AND score>=75

V1 was not modified.
