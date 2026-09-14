// Block Watch — Node.js test suite.
// Run: node --test apps/block-watch/test/blocks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ascending,
  verifyChain,
  verifyContiguity,
  interblockGaps,
  paceStats,
  epochProgress,
  networkAge,
  blockHealth,
  normalize,
} from "../src/blocks.js";

/** Build a block list. `gaps` are the inter-block second gaps applied
 *  chronologically from `t0`; heights start at 100 and increase by 1
 *  unless `heightStep` says otherwise. `parentLinks` = "ok" | "broken". */
function makeBlocks({
  n = 10,
  t0 = 1789403400,
  gap = 6,
  gaps = null,
  height0 = 100,
  heightStep = 1,
  parentLinks = "ok",
  extrinsics = 3,
} = {}) {
  const gs = gaps || Array(n - 1).fill(gap);
  let t = t0;
  let h = height0;
  let prevHash = null;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const hash = `0x${(1000000 + i * 7).toString(16).padStart(64, "0")}`;
    rows.push({
      height: h,
      hash,
      parent_hash:
        parentLinks === "ok" && prevHash
          ? prevHash
          : `0x${(9000000 + i).toString(16).padStart(64, "0")}`,
      timestamp: t,
      extrinsics_count: extrinsics,
    });
    prevHash = hash;
    h += heightStep;
    if (i < n - 1) t += gs[i];
  }
  return [...rows].reverse(); // API returns newest first
}

test("ascending sorts newest-first input to oldest-first", () => {
  const s = ascending(makeBlocks({ n: 5 }));
  assert.deepEqual(
    s.map((b) => b.height),
    [100, 101, 102, 103, 104]
  );
});

test("ascending handles empty / null input", () => {
  assert.deepEqual(ascending([]), []);
  assert.deepEqual(ascending(null), []);
});

test("verifyChain: healthy chain, N-1 links, zero broken (real data)", () => {
  // 3 real consecutive Midnight mainnet blocks captured 2026-09-14,
  // exactly as /api/blocks?limit=3 returned them (newest first).
  const real = [
    { height: 2580757, hash: "0xe760af1b698395fe361143863f829b9096670851cf02e7da2c5ac3ae5f8cf4a4", parent_hash: "0x45bd43f3001e6361f53a1e1c5e889a581ca6b48c0f942d0a999f00c027e484fb", timestamp: 1789403454 },
    { height: 2580756, hash: "0x45bd43f3001e6361f53a1e1c5e889a581ca6b48c0f942d0a999f00c027e484fb", parent_hash: "0x87e440f287cad2f5a3529558119fcf1d71f9d7274ea0e0b66e34b39cc5636c90", timestamp: 1789403448 },
    { height: 2580755, hash: "0x87e440f287cad2f5a3529558119fcf1d71f9d7274ea0e0b66e34b39cc5636c90", parent_hash: "0x8d7e43154d2d11a7637dde0ac53e80ed6ef28f351610587eb03f9b15fded8da5", timestamp: 1789403442 },
  ];
  const v = verifyChain(real);
  assert.equal(v.links, 2);
  assert.equal(v.broken, 0);
  assert.deepEqual(v.brokenHeights, []);
});

test("verifyChain detects a broken parent link and names the height", () => {
  const v = verifyChain(makeBlocks({ n: 4, parentLinks: "broken" }));
  assert.equal(v.links, 3);
  assert.equal(v.broken, 3);
  assert.deepEqual(v.brokenHeights, [101, 102, 103]);
});

test("verifyChain is order-independent", () => {
  const healthy = makeBlocks({ n: 5 });
  const shuffled = [healthy[2], healthy[4], healthy[0], healthy[3], healthy[1]];
  const v = verifyChain(shuffled);
  assert.equal(v.broken, 0);
  assert.equal(v.links, 4);
});

test("verifyChain on empty / single block", () => {
  assert.deepEqual(verifyChain([]), { links: 0, broken: 0, brokenHeights: [] });
  assert.equal(verifyChain([makeBlocks({ n: 1 })[0]]).links, 0);
});

test("verifyContiguity: contiguous window -> zero gaps", () => {
  const c = verifyContiguity(makeBlocks({ n: 12 }));
  assert.equal(c.gaps, 0);
  assert.deepEqual(c.gapDetails, []);
});

test("verifyContiguity finds skipped heights with the missing count", () => {
  // heights: 100,101,103,104,109 -> gaps at 101->103 (missing 102) and
  // 104->109 (missing 105..108)
  const blocks = [100, 101, 103, 104, 109].map((h) => ({
    height: h,
    hash: `0x${h}`,
    parent_hash: "0x",
    timestamp: h,
  }));
  const c = verifyContiguity(blocks);
  assert.equal(c.gaps, 2);
  assert.deepEqual(c.gapDetails, [
    { afterHeight: 101, beforeHeight: 103, missing: 1 },
    { afterHeight: 104, beforeHeight: 109, missing: 4 },
  ]);
});

test("interblockGaps returns chronological seconds", () => {
  const g = interblockGaps(makeBlocks({ n: 4, gap: 6 }));
  assert.deepEqual(g, [6, 6, 6]);
});

test("interblockGaps keeps negative gaps (clock skew)", () => {
  const g = interblockGaps(makeBlocks({ n: 4, gaps: [6, -2, 6] }));
  assert.deepEqual(g, [6, -2, 6]);
});

test("paceStats on a 6s chain (10 blocks, 54s span)", () => {
  const p = paceStats(makeBlocks({ n: 10, gap: 6, extrinsics: 4 }));
  assert.equal(p.blocks, 10);
  assert.equal(p.spanSec, 54);
  assert.equal(p.avgGapSec, 6);
  assert.equal(p.minGapSec, 6);
  assert.equal(p.maxGapSec, 6);
  assert.ok(Math.abs(p.blocksPerMin - 10) < 1e-9);
  assert.equal(p.negativeGaps, 0);
  assert.ok(Math.abs(p.avgExtrinsicsPerBlock - 4) < 1e-9);
});

test("paceStats zero-span guards against division by zero", () => {
  const p = paceStats(makeBlocks({ n: 3, gap: 0 }));
  assert.equal(p.spanSec, 0);
  assert.equal(p.blocksPerMin, null);
});

test("paceStats counts negative gaps", () => {
  const p = paceStats(makeBlocks({ n: 4, gaps: [6, -2, 6] }));
  assert.equal(p.negativeGaps, 1);
});

test("paceStats on empty / single input is null-safe", () => {
  const p0 = paceStats([]);
  assert.equal(p0.blocks, 0);
  assert.equal(p0.avgGapSec, null);
  const p1 = paceStats([makeBlocks({ n: 1, extrinsics: 7 })[0]]);
  assert.equal(p1.blocks, 1);
  assert.equal(p1.blocksPerMin, null);
  assert.equal(p1.avgExtrinsicsPerBlock, 7);
});

test("epochProgress: 75% through, 1.5 days remaining (5-day epoch)", () => {
  const next = 1_800_000_000_000; // ms
  const fiveDays = 5 * 24 * 3600 * 1000;
  const now = next - (fiveDays * 0.25); // 25% of the span still to go
  const ep = { mainchain_epoch: 655, mainchain_slot: 197735763, next_epoch_timestamp: next };
  const r = epochProgress(ep, now);
  assert.equal(r.epoch, 655);
  assert.equal(r.slot, 197735763);
  assert.ok(Math.abs(r.pct - 75) < 1e-9);
  assert.ok(Math.abs(r.remainingMin - Math.round((fiveDays * 0.25) / 60000)) < 1);
});

test("epochProgress clamps past-boundary to 100% / 0 remaining", () => {
  const next = 1_800_000_000_000;
  const r = epochProgress({ next_epoch_timestamp: next }, next + 123456);
  assert.equal(r.pct, 100);
  assert.equal(r.remainingMin, 0);
});

test("epochProgress returns null when fields are missing", () => {
  assert.equal(epochProgress(null, 0), null);
  assert.equal(epochProgress({}, 0), null);
  assert.equal(epochProgress({ mainchain_epoch: 1 }, 0), null);
});

test("networkAge prefers the indexer's own figure", () => {
  assert.deepEqual(networkAge({ networkAgeDays: 178, genesisTime: 1 }, 2), { ageDays: 178 });
});

test("networkAge falls back to genesisTime math", () => {
  const r = networkAge({ genesisTime: 1_700_000_000 }, 1_700_086_400);
  assert.equal(r.ageDays, 1);
  assert.equal(networkAge(null, 0), null);
  assert.equal(networkAge({}, 0), null);
});

test("blockHealth: all checks pass -> 100 healthy", () => {
  const h = blockHealth({
    chainBroken: 0,
    gaps: 0,
    avgGapSec: 6.2,
    negativeGaps: 0,
    newestAgeSec: 30,
  });
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
});

test("blockHealth: nothing passes -> 0 critical", () => {
  const h = blockHealth({
    chainBroken: 3,
    gaps: 2,
    avgGapSec: 90,
    negativeGaps: 1,
    newestAgeSec: 3600,
  });
  assert.equal(h.score, 0);
  assert.equal(h.status, "critical");
});

test("blockHealth: cadence band is ±50% of expectation", () => {
  // 3s == 0.5 * 6 -> inside (inclusive)
  assert.ok(blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: 3, negativeGaps: 0 }).checks[2].pass);
  // 9s == 1.5 * 6 -> inside (inclusive)
  assert.ok(blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: 9, negativeGaps: 0 }).checks[2].pass);
  // 9.1s -> outside
  assert.ok(!blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: 9.1, negativeGaps: 0 }).checks[2].pass);
  // avg gap present but negative gaps present -> fails
  assert.ok(!blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: 6, negativeGaps: 2 }).checks[2].pass);
  // missing avg -> fails
  assert.ok(!blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: null }).checks[2].pass);
});

test("blockHealth: fresh tip window (default 5 min)", () => {
  assert.ok(blockHealth({ newestAgeSec: 299 }).checks[3].pass);
  assert.ok(!blockHealth({ newestAgeSec: 301 }).checks[3].pass);
  assert.ok(!blockHealth({ newestAgeSec: -5 }).checks[3].pass);
  assert.ok(!blockHealth({}).checks[3].pass);
});

test("blockHealth: custom expected gap and fresh window", () => {
  const h = blockHealth({
    chainBroken: 0,
    gaps: 0,
    avgGapSec: 12,
    negativeGaps: 0,
    newestAgeSec: 600,
    expectedGapSec: 12,
    freshMaxMin: 10,
  });
  assert.equal(h.score, 100);
});

test("blockHealth status bands", () => {
  // chain ok (30) only -> watch
  assert.equal(blockHealth({ chainBroken: 0 }).status, "watch");
  // chain + contiguous (55) -> degraded
  assert.equal(blockHealth({ chainBroken: 0, gaps: 0 }).status, "degraded");
  // 75 -> degraded band boundary
  const h = blockHealth({ chainBroken: 0, gaps: 0, avgGapSec: 6, negativeGaps: 0 });
  assert.equal(h.score, 80);
  assert.equal(h.status, "healthy");
});

test("normalize min-max scales to 0..100", () => {
  assert.deepEqual(normalize([10, 20, 30, 40]), [0, 33, 67, 100]);
});

test("normalize flat series -> all 50", () => {
  assert.deepEqual(normalize([6, 6, 6]), [50, 50, 50]);
});

test("normalize empty -> []", () => {
  assert.deepEqual(normalize([]), []);
});
