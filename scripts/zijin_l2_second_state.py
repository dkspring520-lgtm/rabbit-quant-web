#!/usr/bin/env python3
"""Causal second-level L2 state machine for Zijin Mining.

The machine consumes only packets that have already arrived.  It does not
read future minute bars and it never submits an order.  Its job is to turn
rolling transaction/book evidence into a small, auditable state:

NORMAL -> WATCH -> READY -> TRIGGER -> COOLDOWN
"""

from dataclasses import dataclass, field


def clamp(value, low, high):
    return max(low, min(high, value))


def flow_window(transactions, now, seconds):
    rows = [row for row in transactions if 0 <= now - row[0] <= seconds]
    buy = sum(row[3] for row in rows if row[1] == "B")
    sell = sum(row[3] for row in rows if row[1] == "S")
    gross = buy + sell
    prices = [row[4] for row in rows if len(row) > 4 and row[4] > 0]
    return {
        "seconds": seconds,
        "transactions": len(rows),
        "buyNotional": round(buy, 2),
        "sellNotional": round(sell, 2),
        "grossNotional": round(gross, 2),
        "netNotional": round(buy - sell, 2),
        "tfi": None if gross <= 0 else round((buy - sell) / gross, 6),
        "firstPrice": prices[0] if prices else None,
        "lastPrice": prices[-1] if prices else None,
        "lowPrice": min(prices) if prices else None,
        "highPrice": max(prices) if prices else None,
        "priceRange": None if not prices else round(max(prices) - min(prices), 4),
    }


def weighted_book(snapshot):
    if snapshot is None:
        return {
            "available": False,
            "bestBid": None,
            "bestAsk": None,
            "obi": None,
            "microprice": None,
            "micropriceEdgeBps": None,
            "spreadBps": None,
        }
    bid_prices = [float(value) / 10000 for value in snapshot["bid_price"]]
    ask_prices = [float(value) / 10000 for value in snapshot["ask_price"]]
    bid_volumes = [int(value) for value in snapshot["bid_vol"]]
    ask_volumes = [int(value) for value in snapshot["ask_vol"]]
    weights = (1.0, .75, .55, .35, .35, .15, .15, .15, .15, .15)
    weighted_bid = sum(weight * volume for weight, volume in zip(weights, bid_volumes))
    weighted_ask = sum(weight * volume for weight, volume in zip(weights, ask_volumes))
    total = weighted_bid + weighted_ask
    best_bid = bid_prices[0] if bid_prices else 0
    best_ask = ask_prices[0] if ask_prices else 0
    bid1 = bid_volumes[0] if bid_volumes else 0
    ask1 = ask_volumes[0] if ask_volumes else 0
    mid = (best_bid + best_ask) / 2 if best_bid > 0 and best_ask > 0 else 0
    microprice = (
        (best_ask * bid1 + best_bid * ask1) / (bid1 + ask1)
        if mid > 0 and bid1 + ask1 > 0 else None
    )
    return {
        "available": total > 0 and mid > 0,
        "bestBid": None if best_bid <= 0 else round(best_bid, 4),
        "bestAsk": None if best_ask <= 0 else round(best_ask, 4),
        "obi": None if total <= 0 else round((weighted_bid - weighted_ask) / total, 6),
        "microprice": None if microprice is None else round(microprice, 4),
        "micropriceEdgeBps": None if microprice is None else round((microprice - mid) / mid * 10000, 4),
        "spreadBps": None if mid <= 0 else round((best_ask - best_bid) / mid * 10000, 4),
    }


def book_persistence(samples, now, seconds=3):
    rows = [row for row in samples if 0 <= now - row["receivedAt"] <= seconds]
    obi_values = [row["obi"] for row in rows if row.get("obi") is not None]
    edge_values = [row["micropriceEdgeBps"] for row in rows if row.get("micropriceEdgeBps") is not None]
    return {
        "seconds": seconds,
        "samples": len(rows),
        "obiMean": None if not obi_values else round(sum(obi_values) / len(obi_values), 6),
        "obiPositiveRatio": None if not obi_values else round(sum(value > 0 for value in obi_values) / len(obi_values), 4),
        "micropriceEdgeMeanBps": None if not edge_values else round(sum(edge_values) / len(edge_values), 4),
    }


def freeze_microstructure_features(second_state, flow, book, messages=None):
    """Flatten the already-observed L2 state into an immutable training row.

    The forward ledger used to retain these values only inside the UI-oriented
    ``secondState`` object.  A dedicated feature block gives training code a
    stable schema and, importantly, makes unavailable cancellation/replenish
    data explicit instead of silently fabricating it.
    """
    second_state = second_state or {}
    flow = flow or {}
    book = book or {}
    messages = messages or {}
    windows = second_state.get("windows") or {}
    evidence = second_state.get("evidence") or {}
    persistent_book = ((second_state.get("book") or {}).get("persistence3s") or {})

    features = {
        "featureSchemaId": "zijin-l2-microstructure-v1",
        "state": second_state.get("state"),
        "direction": second_state.get("direction"),
        "stateScore": second_state.get("score"),
        "formalSignal": bool(second_state.get("formalSignal")),
        "positionBiasPct": (second_state.get("position") or {}).get("biasPct"),
        "positionThresholdPct": (second_state.get("position") or {}).get("thresholdPct"),
        "nearSessionLow": bool((second_state.get("position") or {}).get("nearSessionLow")),
        "nearSessionHigh": bool((second_state.get("position") or {}).get("nearSessionHigh")),
        "absorption": bool(evidence.get("absorption")),
        "flowReversal": bool(evidence.get("flowReversal")),
        "bookAligned": bool(evidence.get("bookAligned")),
        "activeBuyRatio60s": flow.get("activeBuyRatio60s"),
        "netActiveNotional60s": flow.get("netActiveNotional60s"),
        "bigOrderNetNotional60s": flow.get("bigOrderNetNotional60s"),
        "nearTouchImbalance": book.get("nearTouchImbalance"),
        "spreadBps": book.get("spreadBps"),
        "micropriceEdgeBps": book.get("micropriceEdgeBps"),
        "obiMean3s": persistent_book.get("obiMean"),
        "obiPositiveRatio3s": persistent_book.get("obiPositiveRatio"),
        "micropriceEdgeMean3sBps": persistent_book.get("micropriceEdgeMeanBps"),
        "bookSamples3s": persistent_book.get("samples"),
        "snapshotMessages": messages.get("snapshot", 0),
        "transactionMessages": messages.get("transaction", 0),
        "orderMessages": messages.get("order", 0),
        # The vendor stream currently exposes order events, but the precise
        # cancel/replenish semantics have not been verified from authoritative
        # metadata. Keep them unavailable until that audit is complete.
        "cancellationFeaturesAvailable": False,
        "replenishmentFeaturesAvailable": False,
    }
    for seconds in (1, 3, 10, 30, 60):
        row = windows.get(f"{seconds}s") or {}
        prefix = f"flow{seconds}s"
        features.update({
            f"{prefix}Transactions": row.get("transactions"),
            f"{prefix}BuyNotional": row.get("buyNotional"),
            f"{prefix}SellNotional": row.get("sellNotional"),
            f"{prefix}GrossNotional": row.get("grossNotional"),
            f"{prefix}NetNotional": row.get("netNotional"),
            f"{prefix}Tfi": row.get("tfi"),
            f"{prefix}PriceRange": row.get("priceRange"),
        })
        first_price = row.get("firstPrice")
        last_price = row.get("lastPrice")
        features[f"{prefix}PriceChangeBps"] = (
            None
            if not first_price or last_price is None
            else round((last_price - first_price) / first_price * 10000, 6)
        )
    return features


@dataclass
class ForwardMinuteBuffer:
    """Keep only the latest causal snapshot until its minute has ended."""

    pending: dict | None = field(default=None)

    def push(self, record):
        minute = (record or {}).get("exchangeMinute")
        if not minute:
            return None
        if self.pending is None:
            self.pending = record
            return None
        if self.pending.get("exchangeMinute") == minute:
            self.pending = record
            return None
        completed = self.pending
        self.pending = record
        return completed


@dataclass
class SecondLevelSignalMachine:
    state: str = "normal"
    direction: str = "none"
    state_started_at: float = 0.0
    watch_at: float = 0.0
    ready_at: float = 0.0
    trigger_at: float = 0.0
    expires_at: float = 0.0
    ready_exchange_minute: str = ""
    cooldown_until: float = 0.0
    last_transition_at: float = 0.0
    last_reason: str = ""
    sequence: int = 0

    def _transition(self, state, direction, now, reason=""):
        if reason:
            self.last_reason = reason
        if state != self.state or direction != self.direction:
            self.state = state
            self.direction = direction
            self.state_started_at = now
            self.last_transition_at = now
            self.sequence += 1
            if state == "watch":
                self.watch_at = now
                self.ready_at = 0.0
                self.trigger_at = 0.0
                self.expires_at = now + 300
                self.ready_exchange_minute = ""
            if state == "ready":
                self.ready_at = now
            if state == "trigger":
                self.trigger_at = now

    @staticmethod
    def _position(price, vwap, high, low, atr_pct):
        if not price or not vwap or price <= 0 or vwap <= 0:
            return {"direction": "none", "biasPct": None, "thresholdPct": None}
        threshold = clamp(max(.18, (atr_pct or .35) * .55), .18, .55)
        bias = (price - vwap) / vwap * 100
        session_range = max(0, high - low) if high and low else 0
        near_distance = max(.03, price * threshold / 100 * .55)
        near_low = session_range / price * 100 >= .45 and price <= low + near_distance
        near_high = session_range / price * 100 >= .45 and price >= high - near_distance
        buy_zone = bias <= -threshold or near_low
        sell_zone = bias >= threshold or near_high
        direction = "buy" if buy_zone and not sell_zone else "sell" if sell_zone and not buy_zone else "none"
        return {
            "direction": direction,
            "biasPct": round(bias, 4),
            "thresholdPct": round(threshold, 4),
            "nearSessionLow": near_low,
            "nearSessionHigh": near_high,
        }

    def evaluate(self, *, now, market_open, stale, price, vwap, high, low,
                 atr_pct, windows, book, book3, exchange_minute_key=""):
        position = self._position(price, vwap, high, low, atr_pct)
        direction = position["direction"]
        w1, w3, w10, w30, w60 = (
            windows[key] for key in ("1s", "3s", "10s", "30s", "60s")
        )
        tfi1, tfi3, tfi10 = (w1["tfi"] or 0), (w3["tfi"] or 0), (w10["tfi"] or 0)
        obi = book3.get("obiMean")
        edge = book3.get("micropriceEdgeMeanBps")
        tick = .01
        min_fast_notional = max(300_000, w60["grossNotional"] / 12)
        fast_volume_ok = w10["grossNotional"] >= min_fast_notional
        price_range = w10["priceRange"]
        buy_absorption = (
            w10["sellNotional"] >= min_fast_notional * .55
            and price_range is not None and price_range <= tick * 4
            and w10["lastPrice"] is not None and w10["lowPrice"] is not None
            and w10["lastPrice"] >= w10["lowPrice"] + tick
        )
        sell_absorption = (
            w10["buyNotional"] >= min_fast_notional * .55
            and price_range is not None and price_range <= tick * 4
            and w10["lastPrice"] is not None and w10["highPrice"] is not None
            and w10["lastPrice"] <= w10["highPrice"] - tick
        )
        buy_reversal = tfi1 >= .18 and tfi3 >= .08 and tfi10 <= .08
        sell_reversal = tfi1 <= -.18 and tfi3 <= -.08 and tfi10 >= -.08
        buy_book = obi is not None and obi >= .10 and (edge is None or edge >= 0)
        sell_book = obi is not None and obi <= -.10 and (edge is None or edge <= 0)
        buy_price_confirm = (
            price is not None and w10["lowPrice"] is not None
            and price >= w10["lowPrice"] + tick * 2
            and (book.get("micropriceEdgeBps") or 0) >= 0
        )
        sell_price_confirm = (
            price is not None and w10["highPrice"] is not None
            and price <= w10["highPrice"] - tick * 2
            and (book.get("micropriceEdgeBps") or 0) <= 0
        )

        active_direction = direction
        if self.state in {"ready", "trigger"} and direction == "none":
            # A valid reversal normally leaves the original extreme-price zone.
            # Preserve the armed direction until confirmation or explicit failure.
            active_direction = self.direction

        if stale:
            self._transition("invalid", self.direction, now, "L2数据延迟或断流")
        elif not market_open:
            if self.state in {"watch", "ready", "trigger"}:
                self._transition(
                    "expired",
                    self.direction,
                    now,
                    "连续竞价结束，未完成信号作废",
                )
            else:
                self._transition("normal", "none", now, "非连续竞价时段")
        elif not price:
            self._transition("invalid", self.direction, now, "最新可成交价格缺失")
        elif self.state == "trigger" and now - self.trigger_at < 3:
            pass
        elif self.state == "trigger":
            self.cooldown_until = now + 600
            self._transition("cooldown", self.direction, now, "同方向信号冷却10分钟")
        elif self.state == "cooldown" and now < self.cooldown_until:
            pass
        elif self.state == "cooldown":
            self._transition("normal", "none", now, "冷却完成")
        elif self.state in {"invalid", "expired"} and now - self.state_started_at < 15:
            pass
        elif self.state in {"invalid", "expired"}:
            self._transition("normal", "none", now, "归档完成")
        elif self.expires_at and now >= self.expires_at and self.state in {"watch", "ready"}:
            self._transition("expired", self.direction, now, "5分钟内未确认")
        elif active_direction == "none":
            if self.state in {"watch", "ready"}:
                self._transition("invalid", self.direction, now, "价格离开候选结构且未确认")
            else:
                self._transition("normal", "none", now)
        else:
            aligned = (
                [buy_absorption, buy_reversal, buy_book]
                if active_direction == "buy" else
                [sell_absorption, sell_reversal, sell_book]
            )
            evidence_count = sum(aligned)
            if self.direction not in {"none", active_direction}:
                self._transition("invalid", self.direction, now, "方向反转，原候选失效")
            elif self.state == "normal":
                self._transition("watch", active_direction, now, "进入VWAP偏离或日内极值候选区")
            elif self.state == "watch" and evidence_count >= 2 and fast_volume_ok:
                self._transition("ready", active_direction, now, "订单流与承接达到极速候选门槛")
                self.ready_exchange_minute = exchange_minute_key
            elif self.state == "ready":
                price_confirm = buy_price_confirm if active_direction == "buy" else sell_price_confirm
                flow_confirm = tfi3 >= .10 if active_direction == "buy" else tfi3 <= -.10
                book_confirm = buy_book if active_direction == "buy" else sell_book
                ready_age = now - self.state_started_at
                minute_closed = bool(
                    exchange_minute_key
                    and self.ready_exchange_minute
                    and exchange_minute_key != self.ready_exchange_minute
                )
                if minute_closed and price_confirm and flow_confirm and book_confirm:
                    self._transition("trigger", active_direction, now, "分钟收盘后价格、成交与盘口仍共振")
                elif ready_age > 15 or evidence_count < 1:
                    self._transition("invalid", active_direction, now, "候选确认条件衰减")

        aligned = (
            [buy_absorption, buy_reversal, buy_book]
            if self.direction == "buy" else
            [sell_absorption, sell_reversal, sell_book]
            if self.direction == "sell" else []
        )
        evidence_count = sum(aligned)
        position_score = 20 if self.direction != "none" else 0
        score = round(clamp(
            position_score
            + (20 if (buy_absorption if self.direction == "buy" else sell_absorption if self.direction == "sell" else False) else 0)
            + (15 if (buy_reversal if self.direction == "buy" else sell_reversal if self.direction == "sell" else False) else 0)
            + (15 if (buy_book if self.direction == "buy" else sell_book if self.direction == "sell" else False) else 0)
            + (10 if fast_volume_ok else 0)
            + (15 if self.state in {"ready", "trigger"} else 0)
            + (15 if self.state == "trigger" else 0),
            0, 100,
        ))
        reference_low = w10["lowPrice"] if w10["lowPrice"] is not None else price
        reference_high = w10["highPrice"] if w10["highPrice"] is not None else price
        if self.direction == "buy":
            executable_price = book.get("bestAsk") or price
            trigger_price = round(max(executable_price, reference_high + tick), 2)
            invalid_price = round(reference_low - tick * 2, 2)
            target_price = round(trigger_price + max(.10, trigger_price * .0046), 2)
        elif self.direction == "sell":
            executable_price = book.get("bestBid") or price
            trigger_price = round(min(executable_price, reference_low - tick), 2)
            invalid_price = round(reference_high + tick * 2, 2)
            target_price = round(trigger_price - max(.10, trigger_price * .0046), 2)
        else:
            executable_price = trigger_price = invalid_price = target_price = None
        labels = {
            ("normal", "none"): "秒级扫描",
            ("watch", "buy"): "正T观察区",
            ("watch", "sell"): "反T观察区",
            ("ready", "buy"): "承接形成·等上破",
            ("ready", "sell"): "滞涨形成·等下破",
            ("trigger", "buy"): "正T确认",
            ("trigger", "sell"): "反T确认",
            ("cooldown", "buy"): "正T冷却",
            ("cooldown", "sell"): "反T冷却",
            ("invalid", "buy"): "正T候选已失效",
            ("invalid", "sell"): "反T候选已失效",
            ("expired", "buy"): "正T候选已过期",
            ("expired", "sell"): "反T候选已过期",
        }
        confirmation_delay = (
            round(max(0, self.trigger_at - self.watch_at), 3)
            if self.trigger_at and self.watch_at else None
        )
        return {
            "schemaVersion": 2,
            "state": self.state,
            "direction": self.direction,
            "label": labels.get((self.state, self.direction), "秒级扫描"),
            "score": score,
            "formalSignal": self.state == "trigger",
            "autoOrderAuthorized": False,
            "tradePermission": (
                "blocked" if stale or not market_open or not price
                else "confirmed-needs-account-gate" if self.state == "trigger"
                else "candidate" if self.state in {"watch", "ready"}
                else "blocked" if self.state in {"invalid", "expired", "cooldown"}
                else "observe"
            ),
            "sequence": self.sequence,
            "stateAgeSeconds": round(max(0, now - self.state_started_at), 3),
            "cooldownRemainingSeconds": round(max(0, self.cooldown_until - now), 3),
            "targetResponse": "候选0.5-2秒；正式确认等待分钟收盘",
            "validForSeconds": 300 if self.state in {"watch", "ready", "trigger"} else 0,
            "timeline": {
                "warningAtEpoch": self.watch_at or None,
                "candidateAtEpoch": self.ready_at or None,
                "confirmedAtEpoch": self.trigger_at or None,
                "confirmationDelaySeconds": confirmation_delay,
                "validUntilEpoch": self.expires_at or None,
                "lastTransitionAtEpoch": self.last_transition_at or None,
                "lastReason": self.last_reason,
                "confirmationPolicy": "未收盘仅预警；跨分钟后仍满足才确认；失效与过期保留事件",
            },
            "plan": {
                "action": (
                    "正T买入提醒" if self.state == "trigger" and self.direction == "buy"
                    else "反T卖出提醒" if self.state == "trigger" and self.direction == "sell"
                    else "等待上破确认" if self.state == "ready" and self.direction == "buy"
                    else "等待下破确认" if self.state == "ready" and self.direction == "sell"
                    else "暂不操作"
                ),
                "triggerPrice": trigger_price,
                "executableReferencePrice": executable_price,
                "invalidPrice": invalid_price,
                "targetPrice": target_price,
                "suggestedSize": "账户可卖量与资金校验后最多T仓1/3" if self.state == "trigger" else "0",
                "executionModel": "买入按卖一或更差、卖出按买一或更差；十档冲击与部分成交仍由账户执行闸门复核",
            },
            "position": position,
            "evidence": {
                "count": evidence_count,
                "requiredForReady": 2,
                "fastVolumeOk": fast_volume_ok,
                "minimum10sNotional": round(min_fast_notional, 2),
                "absorption": buy_absorption if self.direction == "buy" else sell_absorption if self.direction == "sell" else False,
                "flowReversal": buy_reversal if self.direction == "buy" else sell_reversal if self.direction == "sell" else False,
                "bookAligned": buy_book if self.direction == "buy" else sell_book if self.direction == "sell" else False,
                "priceConclusion": (
                    f"偏离VWAP {position['biasPct']:+.2f}%"
                    if position["biasPct"] is not None else "VWAP位置待计算"
                ),
                "flowConclusion": (
                    f"3秒TFI {tfi3:+.2f}，10秒成交额 {w10['grossNotional'] / 10000:.1f}万"
                ),
                "bookConclusion": (
                    f"3秒OBI {obi:+.2f}，微观价差 {edge:+.2f}bp"
                    if obi is not None and edge is not None else "盘口持续性样本不足"
                ),
            },
            "windows": windows,
            "book": {**book, "persistence3s": book3},
        }
