import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/authenticated-app.tsx", import.meta.url), "utf8");

test("advanced price plans and reminder history require an active membership", () => {
  assert.match(page, /const premiumEnabled=accountRole==="admin"\|\|\(!demoMode&&accountMembership\?\.active===true\)/);
  assert.match(page, /精确买卖区间、9:25竞价预判与 L2 深度结论仅会员可查看/);
  assert.match(page, /premiumEnabled\?setAlertLogOpen\(true\):setAccountOpen\(true\)/);
  assert.match(page, /alertLogOpen&&premiumEnabled&&<AlertLogView/);
});

test("personal replay training stays visible but cannot be enabled without membership", () => {
  assert.match(page, /premiumEnabled\?<PersonalReplayTraining/);
  assert.match(page, /手动回放训练已锁定/);
  assert.match(page, /购买会员后开启/);
});

test("the 09:25 auction card switches to the live causal plan after pre-open", () => {
  assert.match(page, /isPreopenPlanPhase=\["preauction","auction","auction-result"\]/);
  assert.match(page, /displayedZijinPricePlan=isPreopenPlanPhase\?zijinPreopenPricePlan:zijinPricePlan/);
  assert.match(page, /09:30 自动失效并切换为真实分时因果区间/);
});
