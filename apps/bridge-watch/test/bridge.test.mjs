// Bridge Watch — Node.js test suite.
// Run: node --test apps/bridge-watch/test/bridge.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ascending,
  summarizeTrend,
  trendGrowth,
  parseCardanoBlock,
  parseRecentOps,
  opsPerBlock,
  ageLabel,
  bridgeHealth,
  normalize,
} from "../src/bridge.js";

/** Build a trend of {hour, count}. `values` are CHRONOLOGICAL;
 *  `newestFirst` optionally reverses them (as the API returns them). */
function makeTrend(values, newestFirst = true) {
  const rows = values.map((count, i) => ({
    hour: `2026-09-${String(1 + Math.floor(i / 24)).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00:00`,
    count,
  }));
  return newestFirst ? [...rows].reverse() : rows;
}

test("ascending sorts newest-first input to oldest-first", () => {
  const s = ascending(makeTrend([1, 2, 3, 4]));
  assert.deepEqual(s.map((r) => r.count), [1, 2, 3, 4]);
});

test("ascending handles empty / null input", () => {
  assert.deepEqual(ascending([]), []);
  assert.deepEqual(ascending(null), []);
});

test("summarizeTrend totals + avg", () => {
  // 8 hours of 10, then 8 hours of 20
  const s = summarizeTrend(makeTrend([...Array(8).fill(10), ...Array(8).fill(20)]));
  assert.equal(s.hours, 16);
  assert.equal(s.total, 8 * 10 + 8 * 20); // 240
  assert.equal(s.max, 20);
  assert.equal(s.min, 10);
  assert.ok(Math.abs(s.avgPerHour - 15) < 1e-9);
});

test("summarizeTrend empty is zero-safe", () => {
  const s = summarizeTrend([]);
  assert.equal(s.total, 0);
  assert.equal(s.hours, 0);
  assert.equal(s.avgPerHour, 0);
  assert.equal(s.max, 0);
  assert.equal(s.min, 0);
});

test("trendGrowth returns null with less than twice the window", () => {
  assert.equal(trendGrowth(makeTrend([100, 100, 100]), 12), null);
  assert.equal(trendGrowth([], 12), null);
});

test("trendGrowth computes 12h-vs-12h pct", () => {
  // first 12h = 100 each (1200), last 12h = 150 each (1800) -> +50%
  const g = trendGrowth(makeTrend([...Array(12).fill(100), ...Array(12).fill(150)]), 12);
  assert.equal(g.prev, 1200);
  assert.equal(g.last, 1800);
  assert.ok(Math.abs(g.pct - 50) < 1e-9);
  assert.equal(g.windowHours, 12);
});

test("trendGrowth negative case", () => {
  // first 6h = 200, last 6h = 100 -> -50% (window 6)
  const g = trendGrowth(makeTrend([...Array(6).fill(200), ...Array(6).fill(100)]), 6);
  assert.ok(Math.abs(g.pct - -50) < 1e-9);
});

test("trendGrowth null when prior window is zero", () => {
  const g = trendGrowth(makeTrend([...Array(6).fill(0), ...Array(6).fill(50)]), 6);
  assert.equal(g, null);
});

test("trendGrowth null for non-positive window", () => {
  assert.equal(trendGrowth(makeTrend([1, 2, 3, 4]), 0), null);
  assert.equal(trendGrowth(makeTrend([1, 2, 3, 4]), -1), null);
});

test("parseCardanoBlock extracts the block number", () => {
  assert.equal(parseCardanoBlock("Cardano block #13937696 (0xa4d191fd95859e...)"), 13937696);
  assert.equal(parseCardanoBlock("Cardano block #42"), 42);
  assert.equal(parseCardanoBlock("nothing here"), null);
  assert.equal(parseCardanoBlock(null), null);
  assert.equal(parseCardanoBlock(""), null);
});

// The 10 most recent bridge ops from the live /api/analytics/bridge
// (mainnet.nightforge.jp), newest first, as captured 2026-09-14.
const REAL_RECENT = [
  { hash: "0xb19b", block_height: 2578776, timestamp: 1789391568, args_summary: "Cardano block #13937696 (0xa4d191fd95859e...)" },
  { hash: "0xa10f", block_height: 2578775, timestamp: 1789391562, args_summary: "Cardano block #13937696 (0xa4d191fd95859e...)" },
  { hash: "0x12c8", block_height: 2578770, timestamp: 1789391532, args_summary: "Cardano block #13937695 (0x80e65047e92f62...)" },
  { hash: "0x1143", block_height: 2578769, timestamp: 1789391526, args_summary: "Cardano block #13937695 (0x80e65047e92f62...)" },
  { hash: "0xbbe6", block_height: 2578765, timestamp: 1789391502, args_summary: "Cardano block #13937694 (0x6ecd25dbe752f6...)" },
  { hash: "0xe16e", block_height: 2578764, timestamp: 1789391496, args_summary: "Cardano block #13937693 (0x96e3488cc8b5c3...)" },
  { hash: "0x52c5", block_height: 2578759, timestamp: 1789391466, args_summary: "Cardano block #13937692 (0x54a5906e046d7a...)" },
  { hash: "0x3148", block_height: 2578756, timestamp: 1789391448, args_summary: "Cardano block #13937691 (0x7beca86f6a6dad...)" },
  { hash: "0x04c8", block_height: 2578755, timestamp: 1789391442, args_summary: "Cardano block #13937691 (0x7beca86f6a6dad...)" },
  { hash: "0x6375", block_height: 2578754, timestamp: 1789391436, args_summary: "Cardano block #13937690 (0xb07b674c5e5de8...)" },
];

test("parseRecentOps extracts Cardano block refs (real data)", () => {
  const p = parseRecentOps(REAL_RECENT);
  assert.equal(p.ops.length, 10);
  // unique Cardano blocks: ...690,691,692,693,694,695,696 = 7
  assert.equal(p.uniqueBlockCount, 7);
  assert.equal(p.newestCardanoBlock, 13937696);
  assert.equal(p.oldestCardanoBlock, 13937690);
});

test("parseRecentOps handles empty input", () => {
  const p = parseRecentOps([]);
  assert.equal(p.ops.length, 0);
  assert.equal(p.uniqueBlockCount, 0);
  assert.equal(p.newestCardanoBlock, null);
});

test("parseRecentOps handles a null op list", () => {
  const p = parseRecentOps(null);
  assert.equal(p.ops.length, 0);
});

test("opsPerBlock counts bridge ops per unique Cardano block", () => {
  const p = parseRecentOps(REAL_RECENT);
  // 10 ops over 7 unique blocks
  assert.ok(Math.abs(opsPerBlock(p) - 10 / 7) < 1e-9);
  assert.equal(opsPerBlock(parseRecentOps([])), null);
  assert.equal(opsPerBlock(null), null);
});

test("ageLabel buckets seconds / minutes / hours / days", () => {
  const t = 1789391000;
  assert.equal(ageLabel(t, t), "0s ago");
  assert.equal(ageLabel(t, t + 45), "45s ago");
  assert.equal(ageLabel(t, t + 600), "10m ago");
  assert.equal(ageLabel(t, t + 3600 * 5), "5h ago");
  assert.equal(ageLabel(t, t + 86400 * 3), "3d ago");
});

test("ageLabel clamps future timestamps to now (no negative age)", () => {
  const t = 1789391000;
  assert.equal(ageLabel(t, t - 5000), "0s ago");
});

test("ageLabel with no timestamp -> dash", () => {
  assert.equal(ageLabel(null, 0), "—");
  assert.equal(ageLabel(0, 0), "—");
});

test("bridgeHealth: all checks pass -> 100 healthy", () => {
  const h = bridgeHealth({ avgPerHour: 200, last24Total: 5000, growth: { pct: 5 }, hasRecent: true });
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
});

test("bridgeHealth: nothing passes -> 0 critical", () => {
  const h = bridgeHealth({ avgPerHour: 1, last24Total: 5, growth: { pct: 900 }, hasRecent: false });
  assert.equal(h.score, 0);
  assert.equal(h.status, "critical");
});

test("bridgeHealth: partial -> degraded band", () => {
  // steady flow (30) + volume (30) + fresh (15) = 75; growth out of band
  const h = bridgeHealth({ avgPerHour: 100, last24Total: 2000, growth: { pct: 40 }, hasRecent: true });
  assert.equal(h.score, 75);
  assert.equal(h.status, "degraded");
});

test("bridgeHealth tolerates null growth / empty stats", () => {
  // null growth -> only 3 checks can pass: 30+30+15 = 75
  const h = bridgeHealth({ avgPerHour: 100, last24Total: 2000, growth: null, hasRecent: true });
  assert.equal(h.score, 75);
  assert.equal(bridgeHealth({}).score, 0);
});

test("bridgeHealth status boundaries", () => {
  assert.equal(bridgeHealth({ avgPerHour: 100 }).status, "watch"); // 30
  assert.equal(bridgeHealth({ avgPerHour: 100, last24Total: 2000 }).score, 60);
  assert.equal(bridgeHealth({ avgPerHour: 100, last24Total: 2000 }).status, "degraded");
});

test("normalize min-max scales to 0..100", () => {
  assert.deepEqual(normalize([10, 20, 30, 40]), [0, 33, 67, 100]);
});

test("normalize flat series -> all 50 (no divide by zero)", () => {
  assert.deepEqual(normalize([7, 7, 7]), [50, 50, 50]);
});

test("normalize empty -> []", () => {
  assert.deepEqual(normalize([]), []);
});

test("normalize accepts {count} row objects", () => {
  assert.deepEqual(normalize([{ count: 10 }, { count: 20 }]), [0, 100]);
});
