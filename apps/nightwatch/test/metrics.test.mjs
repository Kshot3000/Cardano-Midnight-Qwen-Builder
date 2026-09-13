// Nightwatch metrics — Node.js test suite.
// Run: node --test apps/nightwatch/test/metrics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ascending,
  tail,
  summarizeActivity,
  transactionGrowth,
  dustBurn,
  healthScore,
  sparkline,
  standardizedMetrics,
} from "../src/metrics.js";

/** Build a series of {hour, txs}. `values` are in CHRONOLOGICAL order;
 *  `newestFirst` optionally reverses them (as the API returns them). */
function makeSeries(values, newestFirst = true) {
  const rows = values.map((txs, i) => ({
    hour: `2026-01-${String(1 + Math.floor(i / 24)).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00:00`,
    txs,
  }));
  return newestFirst ? [...rows].reverse() : rows;
}

// 48h two-window series: first 24h = 200 tx, last 24h = 150 tx (chronological).
const vals = [...Array(24).fill(200), ...Array(24).fill(150)];

test("ascending sorts newest-first input to oldest-first", () => {
  const s = makeSeries([1, 2, 3, 4]); // newest-first: [4,3,2,1]
  const a = ascending(s);
  assert.deepEqual(a.map((r) => r.txs), [1, 2, 3, 4]);
});

test("ascending handles empty input", () => {
  assert.deepEqual(ascending([]), []);
  assert.deepEqual(ascending(null), []);
});

test("tail returns the last n rows", () => {
  const a = ascending(makeSeries(vals));
  assert.equal(tail(a, 5).length, 5);
  assert.equal(tail(a, 5)[4].txs, 150);
  // n larger than the series just returns the series
  assert.equal(tail(a, 999).length, a.length);
});

test("summarizeActivity totals and windows", () => {
  const s = summarizeActivity(makeSeries(vals));
  assert.equal(s.hours, 48);
  // 24*200 + 24*150 = 8400
  assert.equal(s.total, 8400);
  // last 24h = 24 x 150
  assert.equal(s.last24.total, 24 * 150);
  assert.equal(s.last24.avg, 150);
  // last 48h = whole series
  assert.equal(s.last48.total, 8400);
  assert.ok(Math.abs(s.avgPerHour - 175) < 1e-9);
});

test("summarizeActivity on empty series is zero-safe", () => {
  const s = summarizeActivity([]);
  assert.equal(s.total, 0);
  assert.equal(s.avgPerHour, 0);
  assert.equal(s.last24.total, 0);
});

test("transactionGrowth returns null with < 48h of history", () => {
  assert.equal(transactionGrowth(makeSeries([100, 100, 100])), null);
  assert.equal(transactionGrowth([]), null);
});

test("transactionGrowth computes pct over equal 24h windows", () => {
  const g = transactionGrowth(makeSeries(vals));
  // last24 = 24*150 = 3600, prev24 = 24*200 = 4800 -> -25%
  assert.equal(g.last24, 3600);
  assert.equal(g.prev24, 4800);
  assert.ok(Math.abs(g.pct - -25) < 1e-9);
});

test("transactionGrowth positive case", () => {
  const v = [...Array(24).fill(100), ...Array(24).fill(200)];
  const g = transactionGrowth(makeSeries(v));
  assert.equal(g.last24, 4800);
  assert.equal(g.prev24, 2400);
  assert.ok(Math.abs(g.pct - 100) < 1e-9);
});

test("transactionGrowth is null when prior window is zero", () => {
  const v = [...Array(24).fill(0), ...Array(24).fill(10)];
  assert.equal(transactionGrowth(makeSeries(v)), null);
});

test("dustBurn aggregates lifetime + recent burn", () => {
  const d = dustBurn(makeSeries(vals), 1_015_488);
  assert.equal(d.lifetimeTxs, 1_015_488);
  assert.equal(d.last24Txs, 3600);
  assert.equal(d.avgPerHour, 150);
  assert.equal(d.series.length, 48);
});

test("healthScore: all checks pass -> 100 healthy", () => {
  const h = healthScore({ tps: 0.5, avgPerHour: 150, shieldedRatio: 0.78, growth: { pct: 10 } });
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
});

test("healthScore: nothing passes -> 0 critical", () => {
  const h = healthScore({ tps: 0.1, avgPerHour: 5, shieldedRatio: 0, growth: { pct: 900 } });
  assert.equal(h.score, 0);
  assert.equal(h.status, "critical");
});

test("healthScore: partial -> degraded band", () => {
  // tps ok (35) + volume ok (25) + shielded ok (15) = 75; growth out of band
  const h = healthScore({ tps: 0.3, avgPerHour: 60, shieldedRatio: 0.5, growth: { pct: 40 } });
  assert.equal(h.score, 75);
  assert.equal(h.status, "degraded");
});

test("healthScore tolerates null growth and missing fields", () => {
  const h = healthScore({ tps: 0.3, avgPerHour: 60, shieldedRatio: 0.5, growth: null });
  assert.equal(h.score, 75); // growth check fails (unknown), rest pass
  const h2 = healthScore({});
  assert.equal(h2.score, 0);
});

test("healthScore status boundaries", () => {
  assert.equal(healthScore({ tps: 0.3 }).score, 35); // watch band
  assert.equal(healthScore({ tps: 0.3 }).status, "watch");
  assert.equal(healthScore({ tps: 0.3, avgPerHour: 60 }).score, 60);
  assert.equal(healthScore({ tps: 0.3, avgPerHour: 60 }).status, "degraded");
});

test("sparkline min-max scales to 0..100", () => {
  const v = [10, 20, 30, 40];
  const s = sparkline(makeSeries(v));
  assert.deepEqual(s, [0, 33, 67, 100]);
});

test("sparkline flat series -> no divide by zero", () => {
  const s = sparkline(makeSeries([7, 7, 7]));
  assert.equal(s.length, 3);
  assert.ok(s.every((x) => Number.isFinite(x)));
});

test("sparkline empty -> []", () => {
  assert.deepEqual(sparkline([]), []);
});

test("standardizedMetrics labels live vs pending", () => {
  const m = standardizedMetrics({ hasActivity: true, hasDust: true });
  const by = Object.fromEntries(m.map((x) => [x.key, x.status]));
  assert.equal(by.activity, "live");
  assert.equal(by.dust, "live");
  assert.equal(by.addresses, "pending");
  assert.equal(by.retention, "pending");
});

test("standardizedMetrics default caps -> all pending", () => {
  const m = standardizedMetrics();
  assert.ok(m.every((x) => x.status === "pending"));
  assert.equal(m.length, 4);
});
