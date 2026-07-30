import test from "node:test";
import assert from "node:assert/strict";

import {
  isAShareClosingAuctionMinute,
  isAShareContinuousTradingMinute,
} from "../lib/intraday-axis.mjs";

test("14:57 through 15:00 is closing auction, not continuous trading", () => {
  assert.equal(isAShareClosingAuctionMinute("1456"), false);
  assert.equal(isAShareClosingAuctionMinute("1457"), true);
  assert.equal(isAShareClosingAuctionMinute("15:00"), true);
  assert.equal(isAShareContinuousTradingMinute("1456"), true);
  assert.equal(isAShareContinuousTradingMinute("1457"), false);
  assert.equal(isAShareContinuousTradingMinute("1500"), false);
});
