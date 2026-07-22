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
  assert.match(theme, /--bg:#e9eef0/);
  assert.match(theme, /--surface:#f7f9f9/);
  assert.match(theme, /--red:#d74b50/);
  assert.match(theme, /--green:#21845f/);
  assert.match(theme, /color-scheme:\s*light/);
  assert.match(theme, /\.top-actions \.theme-toggle \{ display:grid !important; \}/);
});

test("day mode replaces legacy night surfaces without losing A-share colors", () => {
  assert.match(theme, /\.watch-summary,/);
  assert.match(theme, /\.strategy-dialog,/);
  assert.match(theme, /\.alert-log-row\.head,/);
  assert.match(theme, /\.minimal-ui \.position-card,/);
  assert.match(theme, /\.positive,[^}]+color:var\(--red\) !important/s);
  assert.match(theme, /\.negative,[^}]+color:var\(--green\) !important/s);
});

test("day mode uses one coherent daylight shell with a focused dark logo cell", () => {
  assert.match(theme, /\.topbar \{\s*background:#f7f9f9/);
  assert.match(theme, /\.topbar \.brand \{\s*background:#070b10/);
  assert.match(theme, /\.topbar \.top-actions \{\s*background:transparent/);
  assert.match(theme, /\.topbar \.main-nav button\.active \{\s*color:var\(--text\)/);
  assert.match(theme, /\.chart-wrap \{\s*background:linear-gradient\(180deg,#f5f7f7,#edf1f2\)/);
  assert.match(theme, /\.decision-zone \{\s*background:#e8edef/);
});
