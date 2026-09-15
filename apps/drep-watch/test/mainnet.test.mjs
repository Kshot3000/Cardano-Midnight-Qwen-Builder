import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEpochRow,
  delegationTrend,
  shareOfCirculation,
  drepHealth,
  censusStats,
} from "../src/trend.js";

// ---------------------------------------------------------------------------
// Verbatim real-mainnet fixture.
//
// Rows are copied straight from a live fetch of
//   data.cardano.org /k/api/v1/drep_epoch_summary   (fetched 2026-09-14)
// and the denominator from
//   data.cardano.org /k/api/v1/totals               (epoch 655, same day).
// The window spans the first three Conway epochs (508-510) and the last six
// completed epochs (649-655) — 9 rows — so the growth math is exercised over
// the full era without inlining all 148 rows.
// ---------------------------------------------------------------------------
const MAINNET_EPOCHS = [
  { epoch_no: 508, amount: 172856173388131, dreps: 263 },
  { epoch_no: 509, amount: 288567743368361, dreps: 344 },
  { epoch_no: 510, amount: 463185838115801, dreps: 373 },
  { epoch_no: 649, amount: 15052308033072819, dreps: 886 },
  { epoch_no: 650, amount: 15176484325560922, dreps: 888 },
  { epoch_no: 651, amount: 15142938425352856, dreps: 882 },
  { epoch_no: 652, amount: 15061052948106918, dreps: 878 },
  { epoch_no: 653, amount: 15156624331584110, dreps: 879 },
  { epoch_no: 654, amount: 15213065217906634, dreps: 872 },
  { epoch_no: 655, amount: 15215477256377547, dreps: 870 },
];

// Latest completed epoch's circulation (lovelace), from /k/api/v1/totals ep 655.
const CIRCULATION_LOVELACE = 36744787974275948;

test("mainnet fixture: normalizeEpochRow reproduces the live lovelace→ADA math", () => {
  const r = normalizeEpochRow(MAINNET_EPOCHS.at(-1));
  assert.equal(r.epoch, 655);
  // 15215477256377547 lovelace / 1e6 = 15,215,477,256.377548 ADA.
  // (float64 ulp at 1.5e10 is ~1.9e-6, so tolerance is 1e-3.)
  assert.ok(Math.abs(r.amountAda - 15215477256.377548) < 1e-3, `got ${r.amountAda}`);
  assert.equal(r.dreps, 870);
});

test("mainnet fixture: delegation grew ~88x across the Conway era", () => {
  const rows = MAINNET_EPOCHS.map(normalizeEpochRow);
  const t = delegationTrend(rows);

  assert.equal(t.startEpoch, 508);
  assert.equal(t.endEpoch, 655);
  assert.equal(t.epochs, 9); // 10 rows − 1

  // Endpoint stake, straight from the fixture (lovelace / 1e6).
  assert.ok(Math.abs(t.startAda - 172856173.388131) < 1e-3, `startAda ${t.startAda}`);
  assert.ok(Math.abs(t.endAda - 15215477256.377548) < 1e-3, `endAda ${t.endAda}`);

  // Growth is huge: from ~172.9M ADA to ~15.22B ADA (~88x).
  assert.ok(t.growthAda > 0);
  assert.ok(Math.abs(t.growthAda - (15215477256.377548 - 172856173.388131)) < 1e-2, `growthAda ${t.growthAda}`);
  assert.ok(t.growthPct > 80, `expected >80x growth, got ${t.growthPct}x`);
  assert.ok(t.growthPct < 95, `sanity: growth shouldn't exceed 95x, got ${t.growthPct}x`);

  // Active DRep count.
  assert.equal(t.startDreps, 263);
  assert.equal(t.latestDreps, 870);
  assert.equal(t.growthDreps, 607);

  // Monotonicity of the peak: the max in the window is the final epoch.
  assert.equal(t.maxAda, t.endAda);
});

test("mainnet fixture: ~41% of circulation was delegated to DReps at ep 655", () => {
  const rows = MAINNET_EPOCHS.map(normalizeEpochRow);
  const t = delegationTrend(rows);
  const circ = CIRCULATION_LOVELACE / 1e6; // 36.74B ADA
  const share = shareOfCirculation(t.endAda, circ);

  assert.ok(share != null);
  assert.ok(share > 0.40, `expected >40% share, got ${(share * 100).toFixed(2)}%`);
  assert.ok(share < 0.45, `expected <45% share, got ${(share * 100).toFixed(2)}%`);
});

test("mainnet fixture: a healthy live-ish health score", () => {
  const rows = MAINNET_EPOCHS.map(normalizeEpochRow);
  const t = delegationTrend(rows);
  const circ = CIRCULATION_LOVELACE / 1e6;
  const share = shareOfCirculation(t.endAda, circ);
  const census = censusStats([
    { id: "drep1ok", valid: true, kind: "key", header: 0x22, hash: "0".repeat(56), hasScript: false, registered: true },
  ]);
  const h = drepHealth({ share, trend: t, census });
  assert.equal(h.label, "healthy");
  assert.ok(h.score >= 90, `expected >=90, got ${h.score}`);
});
