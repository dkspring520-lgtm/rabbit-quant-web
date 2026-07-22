import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const landing = fs.readFileSync(new URL("../app/public-landing.tsx", import.meta.url), "utf8");
const theme = fs.readFileSync(new URL("../app/theme.css", import.meta.url), "utf8");

test("theme preference is restored before the app paints", () => {
  assert.match(layout, /import "\.\/theme\.css"/);
  assert.match(layout, /rabbit-ui-theme/);
  assert.match(layout, /document\.documentElement\.dataset\.theme/);
  assert.match(layout, /suppressHydrationWarning/);
});

test("signed-in, landing, and account screens expose the same theme switch", () => {
  assert.match(page, /type UiTheme = "dark" \| "light"/);
  assert.match(page, /localStorage\.setItem\("rabbit-ui-theme",next\)/);
  assert.match(page, /切换到白天模式/);
  assert.match(page, /切换到黑夜模式/);
  assert.match(landing, /onToggleTheme/);
  assert.match(landing, /public-theme-toggle/);
});

test("day mode has a complete accessible palette and mobile switch", () => {
  assert.match(theme, /:root\[data-theme="light"\]/);
  assert.match(theme, /--bg:#f2f5f4/);
  assert.match(theme, /--surface:#ffffff/);
  assert.match(theme, /color-scheme:\s*light/);
  assert.match(theme, /\.top-actions \.theme-toggle \{ display:grid !important; \}/);
});
