import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmStockPosition,
  loadStockPosition,
  migrateLegacyPosition,
  normalizeStockPosition,
  saveStockPosition,
  stockPositionKey,
} from "../lib/stock-position.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

test("storage keys isolate account and stock code", () => {
  assert.equal(stockPositionKey(" Trader@Example.COM ", " 601899 "), "rabbit-position:trader@example.com:601899");
  assert.notEqual(stockPositionKey("alice", "601899"), stockPositionKey("alice", "603993"));
  assert.notEqual(stockPositionKey("alice", "601899"), stockPositionKey("bob", "601899"));
});

test("normalization clamps invalid inventory and never allows sellable above opening shares", () => {
  assert.deepEqual(normalizeStockPosition({
    v: 99,
    code: "000001",
    plannedBase: "6200.9",
    openingShares: 4100.8,
    sellable: 9999,
    updatedAt: "2026-07-16T08:00:00.000Z",
    migratedFrom: "old-model",
  }, "601899"), {
    v: 1,
    code: "601899",
    plannedBase: 6200,
    openingShares: 4100,
    sellable: 4100,
    needsConfirmation: false,
    updatedAt: "2026-07-16T08:00:00.000Z",
    migratedFrom: "old-model",
  });

  assert.deepEqual(normalizeStockPosition({
    plannedBase: -1,
    openingShares: Number.NaN,
    sellable: "not-a-number",
  }, "603993"), {
    v: 1,
    code: "603993",
    plannedBase: 0,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: false,
    updatedAt: null,
  });
});

test("legacy global shares require trusted provenance and migrate only as a plan", () => {
  const legacy = { stock: "601899 紫金矿业", baseShares: 6000 };

  // A runtime default can look exactly like old preferences. It must not be
  // migrated unless the caller proves that it came from persisted storage.
  assert.deepEqual(migrateLegacyPosition(legacy, "601899"), {
    v: 1,
    code: "601899",
    plannedBase: 0,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: false,
    updatedAt: null,
  });

  assert.deepEqual(migrateLegacyPosition(legacy, "601899", true), {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: true,
    updatedAt: null,
    migratedFrom: "rabbit-prefs.baseShares",
  });
  assert.deepEqual(migrateLegacyPosition(legacy, "603993", true), {
    v: 1,
    code: "603993",
    plannedBase: 0,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: false,
    updatedAt: null,
  });
});

test("legacy migration understands object stocks and sanitizes old shares", () => {
  const migrated = migrateLegacyPosition(
    { stock: { code: "000063" }, baseShares: "1200.7" },
    "000063",
    true,
  );
  assert.equal(migrated.plannedBase, 1200);
  assert.equal(migrated.openingShares, 0);
  assert.equal(migrated.sellable, 0);
  assert.equal(migrated.needsConfirmation, true);
});

test("previously persisted unsafe migrations are repaired on read", () => {
  assert.deepEqual(normalizeStockPosition({
    plannedBase: 6000,
    openingShares: 6000,
    sellable: 6000,
    migratedFrom: "rabbit-prefs.baseShares",
  }, "601899"), {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: true,
    updatedAt: null,
    migratedFrom: "rabbit-prefs.baseShares",
  });
});

test("saved positions load independently for different stocks", () => {
  const storage = memoryStorage();
  const now = "2026-07-16T09:31:00.000Z";
  saveStockPosition(storage, "Alice", {
    code: "601899",
    plannedBase: 6000,
    openingShares: 5800,
    sellable: 5600,
  }, now);
  saveStockPosition(storage, "Alice", {
    code: "603993",
    plannedBase: 3000,
    openingShares: 3000,
    sellable: 2500,
  }, now);

  assert.deepEqual(loadStockPosition(storage, "alice", "601899"), {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 5800,
    sellable: 5600,
    needsConfirmation: false,
    updatedAt: now,
  });
  assert.deepEqual(loadStockPosition(storage, "alice", "603993"), {
    v: 1,
    code: "603993",
    plannedBase: 3000,
    openingShares: 3000,
    sellable: 2500,
    needsConfirmation: false,
    updatedAt: now,
  });
});

test("bad JSON and unavailable storage never infer untrusted legacy shares", () => {
  const legacy = { stock: "601899 紫金矿业", baseShares: 6000 };
  const broken = memoryStorage({
    [stockPositionKey("alice", "603993")]: "{not-json",
  });
  assert.equal(loadStockPosition(broken, "alice", "603993", legacy).plannedBase, 0);

  const unavailable = {
    getItem() {
      throw new Error("storage blocked");
    },
  };
  assert.deepEqual(loadStockPosition(unavailable, "alice", "601899", legacy), {
    v: 1,
    code: "601899",
    plannedBase: 0,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: false,
    updatedAt: null,
  });
  assert.deepEqual(loadStockPosition(unavailable, "alice", "601899", legacy, true), {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 0,
    sellable: 0,
    needsConfirmation: true,
    updatedAt: null,
    migratedFrom: "rabbit-prefs.baseShares",
  });
});

test("save returns normalized state even if persistence is blocked", () => {
  const blocked = {
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  const saved = saveStockPosition(blocked, "alice", {
    code: "601899",
    plannedBase: "6000",
    openingShares: 5000,
    sellable: 8000,
  }, "2026-07-16T10:00:00.000Z");
  assert.deepEqual(saved, {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 5000,
    sellable: 5000,
    needsConfirmation: false,
    updatedAt: "2026-07-16T10:00:00.000Z",
  });
});

test("automatic persistence cannot silently confirm a migrated position", () => {
  const storage = memoryStorage();
  const migrated = migrateLegacyPosition({
    stock: "601899",
    baseShares: 6000,
  }, "601899", true);
  const saved = saveStockPosition(
    storage,
    "alice",
    migrated,
    "2026-07-16T10:01:00.000Z",
  );

  assert.equal(saved.needsConfirmation, true);
  assert.equal(loadStockPosition(storage, "alice", "601899").needsConfirmation, true);
  assert.equal(loadStockPosition(storage, "alice", "601899").openingShares, 0);
});

test("explicit confirmation accepts user-entered inventory and removes migration state", () => {
  const storage = memoryStorage();
  const migrated = migrateLegacyPosition({
    stock: "601899",
    baseShares: 6000,
  }, "601899", true);
  const confirmed = confirmStockPosition(storage, "alice", {
    ...migrated,
    openingShares: 5800,
    sellable: 5600,
  }, "2026-07-16T10:02:00.000Z");

  assert.deepEqual(confirmed, {
    v: 1,
    code: "601899",
    plannedBase: 6000,
    openingShares: 5800,
    sellable: 5600,
    needsConfirmation: false,
    updatedAt: "2026-07-16T10:02:00.000Z",
  });
  assert.deepEqual(loadStockPosition(storage, "alice", "601899"), confirmed);
});
