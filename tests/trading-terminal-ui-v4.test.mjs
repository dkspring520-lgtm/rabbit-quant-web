import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("app/authenticated-app.tsx", "utf8");
const styles = fs.readFileSync("app/trading-terminal-v4.css", "utf8");

test("Trading Terminal V4 is scoped to the existing desk shell", () => {
  assert.match(shell, /trading-terminal-v4/);
  assert.match(shell, /trading-terminal-v4\.css/);
  assert.match(styles, /\.app-shell\.minimal-ui\.trading-terminal-v4/);
  assert.match(styles, /--tt-bg:/);
  assert.match(styles, /--tt-accent:/);
  assert.match(styles, /--tt-bullish:/);
  assert.match(styles, /--tt-bearish:/);
});

test("V4 presentation keeps existing watchlist and layout contracts", () => {
  assert.match(shell, /selectActiveStock/);
  assert.match(shell, /startStockDrag/);
  assert.match(shell, /moveStock/);
  assert.match(shell, /removeStock/);
  assert.match(shell, /setDashboardLayout/);
  assert.match(shell, /DashboardPanelManager/);
  assert.match(shell, /toggleUiTheme/);
});

test("V4 preserves A-share color semantics in its token bridge", () => {
  assert.match(styles, /--teal: var\(--tt-bearish\)/);
  assert.match(styles, /--coral: var\(--tt-bullish\)/);
  assert.match(styles, /quote\.down/);
  assert.match(styles, /quote\.up/);
});

test("V4 keeps the existing theme switch meaningful in light mode", () => {
  assert.match(styles, /:root\[data-theme="light"\] \.app-shell\.minimal-ui\.trading-terminal-v4/);
  assert.match(styles, /--tt-bg: #f1f3ef/);
  assert.match(styles, /--tt-text: #26342c/);
  assert.match(shell, /toggleUiTheme/);
});
