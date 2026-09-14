// Midnight Contract Watch — ecosystem analytics tests.
// Run: node --test apps/midnight-contracts/test/analyze.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY,
  safeInt,
  toPct,
  activityClass,
  tallyActivity,
  concentration,
  interactionStats,
  deploymentTrend,
  dedupeDeployed,
  coverageCheck,
  addressSanity,
} from "../src/analyze.js";
import {
  NOW,
  TOP10,
  PAIRS_150,
  DAILY,
  TOTALS,
  DEPLOYED_40,
} from "./fixture.mjs";

const rowsFromPairs = (pairs) =>
  pairs.map(([interactions, lastSeen], i) => ({
    address: TOP10[i % 10].address,
    interactions,
    lastSeen,
  }));

// ---------- safeInt / toPct ----------

test("safeInt handles numbers, numeric strings, and junk", () => {
  assert.equal(safeInt(42), 42);
  assert.equal(safeInt(4.9), 4);
  assert.equal(safeInt("37"), 37);
  assert.equal(safeInt(null), null);
  assert.equal(safeInt(undefined), null);
  assert.equal(safeInt("n/a"), null);
  assert.equal(safeInt(NaN), null);
  assert.equal(safeInt(Infinity), null);
});

test("toPct clamps to 0..100 and rounds", () => {
  assert.equal(toPct(0.85), 85);
  assert.equal(toPct(1.5), 100);
  assert.equal(toPct(-0.2), 0);
  assert.equal(toPct(0.99999, 2), 100.0);
  assert.equal(toPct(NaN), null);
});

// ---------- activityClass ----------

test("activityClass buckets by lastSeen age", () => {
  const now = 1_000_000;
  assert.equal(activityClass({ interactions: 5, lastSeen: now }, now), "active");
  assert.equal(activityClass({ interactions: 5, lastSeen: now - 3 * DAY }, now), "active");
  assert.equal(activityClass({ interactions: 5, lastSeen: now - 7 * DAY }, now), "active");
  assert.equal(activityClass({ interactions: 5, lastSeen: now - 8 * DAY }, now), "dormant");
  assert.equal(activityClass({ interactions: 5, lastSeen: now - 90 * DAY }, now), "dormant");
  assert.equal(activityClass({ interactions: 5, lastSeen: now - 91 * DAY }, now), "abandoned");
});

test("activityClass: zero / missing interactions -> never-called; future ts clamps to active", () => {
  const now = 1_000_000;
  assert.equal(activityClass({ interactions: 0, lastSeen: now - 400 * DAY }, now), "never-called");
  assert.equal(activityClass({ lastSeen: now }, now), "never-called");
  assert.equal(activityClass({ interactions: 5, lastSeen: now + 500 }, now), "active");
  assert.equal(activityClass(null, now), "abandoned");
  assert.equal(activityClass({}, now), "never-called");
});

test("tallyActivity over the 150 real leaderboard rows", () => {
  const t = tallyActivity(rowsFromPairs(PAIRS_150), NOW);
  assert.equal(t.total, 150);
  // Expected counts computed from the 2026-09-14 capture:
  assert.equal(t.neverCalled, 46);
  assert.equal(t.active, 14);
  assert.equal(t.dormant, 39);
  assert.equal(t.abandoned, 51);
  assert.equal(t.active + t.dormant + t.abandoned + t.neverCalled, 150);
});

test("tallyActivity tolerates null/empty", () => {
  const t = tallyActivity(null, NOW);
  assert.deepEqual(t, { active: 0, dormant: 0, abandoned: 0, neverCalled: 0, total: 0 });
  assert.equal(tallyActivity([], NOW).total, 0);
});

// ---------- concentration ----------

test("concentration over the 150 real rows (interactions only)", () => {
  const c = concentration(rowsFromPairs(PAIRS_150), 10);
  assert.equal(c.totalInteractions, 82187); // matches /totalCalls
  assert.ok(Math.abs(c.top1Share - 29140 / 82187) < 1e-12);
  assert.ok(Math.abs(c.top3Share - (29140 + 18675 + 13846) / 82187) < 1e-12);
  assert.ok(Math.abs(c.topNShare - 77400 / 82187) < 1e-12); // top-10 sum
  assert.equal(c.n, 10);
});

test("concentration: unsorted input still ranks by value", () => {
  const c = concentration(
    [
      { interactions: 10 },
      { interactions: 30 },
      { interactions: 20 },
      { interactions: 40 },
    ],
    2
  );
  assert.ok(Math.abs(c.topNShare - 0.7) < 1e-12); // (40+30)/100
  assert.ok(Math.abs(c.top1Share - 0.4) < 1e-12);
});

test("concentration: zero total -> null shares, no divide-by-zero", () => {
  const c = concentration([{ interactions: 0 }, { interactions: 0 }], 10);
  assert.equal(c.topNShare, null);
  assert.equal(c.top1Share, null);
  assert.equal(c.top3Share, null);
  assert.equal(c.totalInteractions, 0);
});

test("concentration: empty / null / n > length", () => {
  assert.equal(concentration([], 10).topNShare, null);
  assert.equal(concentration(null, 10).topNShare, null);
  const c = concentration([{ interactions: 5 }], 10);
  assert.equal(c.topNShare, 1); // n clamps to 1
});

// ---------- interactionStats ----------

test("interactionStats over the 150 real rows", () => {
  const s = interactionStats(rowsFromPairs(PAIRS_150));
  assert.equal(s.count, 150);
  assert.equal(s.total, 82187);
  assert.ok(Math.abs(s.average - 82187 / 150) < 1e-9);
  assert.equal(s.min, 0);
  assert.equal(s.max, 29140);
});

test("interactionStats: empty and null are zero-safe", () => {
  const s = interactionStats([]);
  assert.deepEqual(s, { count: 0, total: 0, average: null, min: null, max: null });
  assert.equal(interactionStats(null).count, 0);
});

test("interactionStats: junk rows are skipped, not counted", () => {
  const s = interactionStats([
    { interactions: 10 },
    { interactions: "bogus" },
    null,
    { interactions: -5 },
    { interactions: 20 },
  ]);
  assert.equal(s.count, 2);
  assert.equal(s.total, 30);
  assert.equal(s.min, 10);
  assert.equal(s.max, 20);
});

// ---------- deploymentTrend ----------

test("deploymentTrend over the real 30-day series (7d window)", () => {
  const t = deploymentTrend(DAILY, 7);
  assert.equal(t.days, 30);
  assert.equal(t.total, 15728);
  assert.ok(Math.abs(t.average - 15728 / 30) < 1e-9);
  assert.equal(t.last, 2681); // sum of first 7 (newest first)
  assert.equal(t.prev, 2924); // sum of next 7
  assert.ok(Math.abs(t.growthPct - ((2681 - 2924) / 2924) * 100) < 1e-9);
  assert.equal(t.peakDay, "2026-08-21");
  assert.equal(t.peakCount, 1478);
});

test("deploymentTrend: window >= length -> growth null when baseline is zero", () => {
  const t = deploymentTrend(DAILY, 30);
  assert.equal(t.last, 15728);
  assert.equal(t.prev, 0);
  assert.equal(t.growthPct, null); // prev 0 — refuse to invent a number
});

test("deploymentTrend: window > length -> no growth fields", () => {
  const t = deploymentTrend(DAILY, 31);
  assert.equal(t.last, null);
  assert.equal(t.prev, null);
  assert.equal(t.growthPct, null);
});

test("deploymentTrend: synthetic up/flat (newest first, like the API)", () => {
  const up = deploymentTrend(
    [
      { day: "d1", count: 20 },
      { day: "d2", count: 20 },
      { day: "d3", count: 20 },
      { day: "d4", count: 10 },
      { day: "d5", count: 10 },
      { day: "d6", count: 10 },
    ],
    3
  );
  assert.equal(up.last, 60); // newest window
  assert.equal(up.prev, 30);
  assert.equal(up.growthPct, 100);
  const flat = deploymentTrend(
    [
      { day: "d1", count: 5 },
      { day: "d2", count: 5 },
      { day: "d3", count: 5 },
      { day: "d4", count: 5 },
      { day: "d5", count: 5 },
      { day: "d6", count: 5 },
    ],
    3
  );
  assert.equal(flat.growthPct, 0);
});

test("deploymentTrend: empty / null / junk", () => {
  const t = deploymentTrend([], 7);
  assert.equal(t.total, 0);
  assert.equal(t.days, 0);
  assert.equal(t.average, null);
  assert.equal(t.peakDay, null);
  assert.equal(deploymentTrend(null, 7).days, 0);
  const j = deploymentTrend([{ day: "x", count: "bad" }], 7);
  assert.equal(j.days, 0);
});

// ---------- dedupeDeployed ----------

const D20 = DEPLOYED_40.map(([txHash, block, timestamp, address]) => ({
  txHash, block, timestamp, address,
}));

test("dedupeDeployed over the real 40-row newest sample", () => {
  const d = dedupeDeployed(D20);
  assert.equal(d.raw, 40);
  assert.equal(d.unique, 19);
  assert.equal(d.duplicates, 21);
  assert.equal(d.uniqueAddresses, 19);
  assert.equal(d.firstDeploy.ts, 1786035000);
  assert.equal(d.firstDeploy.block, 2020824);
  assert.equal(d.lastDeploy.ts, 1789391574);
  assert.equal(d.lastDeploy.block, 2578777);
  assert.ok(Math.abs(d.spanDays - (1789391574 - 1786035000) / 86400) < 1e-9);
});

test("dedupeDeployed: synthetic duplicates and span edges", () => {
  const rows = [
    { txHash: "0xa", block: 10, timestamp: 2000, address: "0xA" },
    { txHash: "0xa", block: 10, timestamp: 2000, address: "0xA" }, // dup
    { txHash: "0xb", block: 20, timestamp: 4000, address: "0xB" },
    { txHash: "0xa", block: 99, timestamp: 3000, address: "0xA" }, // same tx, diff block -> distinct
  ];
  const d = dedupeDeployed(rows);
  assert.equal(d.raw, 4);
  assert.equal(d.unique, 3);
  assert.equal(d.duplicates, 1);
  assert.equal(d.uniqueAddresses, 2);
  assert.equal(d.firstDeploy.ts, 2000);
  assert.equal(d.lastDeploy.ts, 4000);
  assert.ok(Math.abs(d.spanDays - 2000 / 86400) < 1e-12);
});

test("dedupeDeployed: empty / null / single row", () => {
  const d = dedupeDeployed([]);
  assert.equal(d.raw, 0);
  assert.equal(d.unique, 0);
  assert.equal(d.spanDays, null);
  assert.equal(dedupeDeployed(null).raw, 0);
  const one = dedupeDeployed([{ txHash: "0x1", block: 5, timestamp: 100, address: "0xZ" }]);
  assert.equal(one.unique, 1);
  assert.equal(one.spanDays, null); // single point, no span
});

// ---------- coverageCheck ----------

test("coverageCheck: equal counts agree", () => {
  const c = coverageCheck(150, 150);
  assert.equal(c.delta, 0);
  assert.match(c.note, /agree/);
});

test("coverageCheck: leaderboard lags deployed events", () => {
  const c = coverageCheck(150, 226);
  assert.equal(c.delta, -76);
  assert.match(c.note, /capped or lagging/);
});

test("coverageCheck: leaderboard leads (pre-event deploys)", () => {
  const c = coverageCheck(200, 150);
  assert.equal(c.delta, 50);
  assert.match(c.note, /predate event indexing/);
});

test("coverageCheck: insufficient data", () => {
  assert.match(coverageCheck(null, 150).note, /insufficient/);
  assert.equal(coverageCheck(null, 150).delta, null);
});

// ---------- addressSanity ----------

test("addressSanity: all 150 real addresses are canonical", () => {
  const s = addressSanity(rowsFromPairs(PAIRS_150));
  assert.equal(s.total, 150);
  assert.equal(s.valid, 150);
  assert.equal(s.invalid, 0);
});

test("addressSanity: mixed valid/invalid", () => {
  const s = addressSanity([
    { address: TOP10[0].address },
    { address: "0x123" },
    { address: null },
    {},
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.valid, 1);
  assert.equal(s.invalid, 3);
  assert.equal(addressSanity(null).total, 0);
});

// ---------- fixture integrity ----------

test("fixture integrity: totals match the captured API", () => {
  assert.equal(TOTALS.totalContracts, 150);
  assert.equal(TOTALS.totalCalls, 82187);
  assert.equal(TOTALS.topContractsLen, 150);
  assert.equal(PAIRS_150.length, 150);
  assert.equal(TOP10.length, 10);
  assert.equal(DAILY.length, 30);
  // interactions column of PAIRS_150 sums to the API's totalCalls
  const sum = PAIRS_150.reduce((s, p) => s + p[0], 0);
  assert.equal(sum, TOTALS.totalCalls);
});
