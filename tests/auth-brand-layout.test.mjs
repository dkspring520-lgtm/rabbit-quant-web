import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mobile = fs.readFileSync(new URL("../app/mobile.css", import.meta.url), "utf8");

test("the sign-in brand stays compact instead of dominating the page", () => {
  const rule = mobile.match(/\.auth-brand \.brand-primary-logo\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(rule, /width:\s*196px/);
  assert.match(rule, /max-width:\s*min\(32vw,\s*196px\)/);
  assert.doesNotMatch(rule, /width:\s*300px/);
});
