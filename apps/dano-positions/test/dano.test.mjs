import { test } from "node:test";
import assert from "node:assert/strict";

import {
  tvlSeries,
  rangeSeries,
  tvlDeltaPct,
  latestTvl,
  avgTvl,
  formatUsd,
  formatDelta,
  downsample,
  sparkHeights,
  growthLabel,
} from "../src/dano.js";

const DAY = 86400000;
const NOW = 1_700_000_000_000;

// A 10-day series: day offsets 9..0 days before NOW, TVL rising 100..1000.
function makeSeries() {
  return Array.from({ length: 10 }, (_, i) => {
    const daysAgo = 9 - i; // 9,8,...,0
    return { date: NOW - daysAgo * DAY, tvl: (i + 1) * 100 };
  });
}

test("tvlSeries extracts clean points from DefiLlama payload", () => {
  const data = {
    tvl: [
      { date: NOW - DAY, totalLiquidityUSD: 100 },
      { date: NOW, totalLiquidityUSD: 200 },
      { broken: true },
      { date: "nope", totalLiquidityUSD: 5 },
    ],
  };
  const s = tvlSeries(data);
  assert.equal(s.length, 2);
  assert.deepEqual(s[1], { date: NOW, tvl: 200 });
});

test("tvlSeries tolerates missing/malformed input", () => {
  assert.deepEqual(tvlSeries(null), []);
  assert.deepEqual(tvlSeries({ tvl: "nope" }), []);
});

test("rangeSeries slices the last N days", () => {
  const s = makeSeries();
  const r7 = rangeSeries(s, 7, NOW);
  assert.equal(r7.length, 8); // 7 days inclusive => 8 daily points
  assert.equal(r7[r7.length - 1].tvl, 1000);
});

test("rangeSeries returns [] for bad input", () => {
  assert.deepEqual(rangeSeries([], 7, NOW), []);
  assert.deepEqual(rangeSeries(makeSeries(), 0, NOW), []);
});

test("tvlDeltaPct computes percent change over the window", () => {
  const s = makeSeries();
  // last 9 days: from 100 to 1000 => +900%
  const d = tvlDeltaPct(s, 9, NOW);
  assert.ok(Math.abs(d - 900) < 0.01, "got " + d);
});

test("tvlDeltaPct is null when window too small or zero base", () => {
  assert.equal(tvlDeltaPct([], 7, NOW), null);
  const zeroBase = [{ date: NOW - DAY, tvl: 0 }, { date: NOW, tvl: 50 }];
  assert.equal(tvlDeltaPct(zeroBase, 1, NOW), null);
});

test("latestTvl prefers currentChainTvls then series tail", () => {
  assert.equal(latestTvl({ currentChainTvls: { Cardano: 6438219 } }, []), 6438219);
  assert.equal(latestTvl({ currentChainTvls: {} }, makeSeries()), 1000);
  assert.equal(latestTvl({}, []), null);
});

test("avgTvl averages the window, null when empty", () => {
  const s = makeSeries(); // 100..1000, last 9 days = 100..1000 (9 pts)
  const avg = avgTvl(s, 9, NOW);
  assert.ok(avg > 0);
  // average of 100..1000 step 100 = 550
  assert.ok(Math.abs(avg - 550) < 0.001, "got " + avg);
  assert.equal(avgTvl([], 7, NOW), null);
});

test("formatUsd buckets correctly", () => {
  assert.equal(formatUsd(6438219), "$6.44M");
  assert.equal(formatUsd(980000), "$980K");
  assert.equal(formatUsd(12), "$12");
  assert.equal(formatUsd(2_000_000_000), "$2.00B");
  assert.equal(formatUsd(NaN), "–");
});

test("formatDelta signs and formats", () => {
  assert.equal(formatDelta(12.34), "+12.3%");
  assert.equal(formatDelta(-3.1), "-3.1%");
  assert.equal(formatDelta(null), "–");
});

test("downsample keeps endpoints and caps length", () => {
  const s = makeSeries(); // 10 pts
  const d5 = downsample(s, 5);
  assert.equal(d5.length, 5);
  assert.equal(d5[0].tvl, 100);
  assert.equal(d5[4].tvl, 1000);
  // already small => unchanged
  assert.equal(downsample(s.slice(0, 3), 5).length, 3);
});

test("sparkHeights scales within [min,max] and handles flat series", () => {
  const s = makeSeries();
  const h = sparkHeights(s);
  assert.equal(h.length, 10);
  assert.ok(h.every((v) => v >= 4 && v <= 88));
  assert.equal(h[0], 4); // min value maps to minPx
  assert.equal(h[h.length - 1], 88); // max maps to maxPx
  const flat = [{ tvl: 5 }, { tvl: 5 }];
  assert.deepEqual(sparkHeights(flat), [46, 46]); // midpoint
});

test("growthLabel thresholds", () => {
  assert.equal(growthLabel(5), "growing");
  assert.equal(growthLabel(-4), "shrinking");
  assert.equal(growthLabel(1), "flat");
  assert.equal(growthLabel(null), "unknown");
});
