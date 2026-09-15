import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEpochRow,
  normalizeCensusRow,
  censusStats,
  delegationTrend,
  shareOfCirculation,
  drepHealth,
  fmtAda,
  fmtM,
  fmtPct,
  fmtInt,
  fmtSignedM,
} from "../src/trend.js";

// ---------------------------------------------------------------------------
// normalizeEpochRow
// ---------------------------------------------------------------------------
test("normalizeEpochRow: lovelace amount → ADA, dreps passthrough", () => {
  const r = normalizeEpochRow({ epoch_no: 655, amount: 15215477256377547, dreps: 870 });
  assert.equal(r.epoch, 655);
  // exact: same float64 division the module performs
  assert.equal(r.amountAda, 15215477256377547 / 1e6);
  assert.equal(r.dreps, 870);
});

test("normalizeEpochRow: amount as a string still works", () => {
  const r = normalizeEpochRow({ epoch_no: 508, amount: "172856173388131", dreps: 263 });
  assert.equal(r.amountAda, 172856173388131 / 1e6);
});

test("normalizeEpochRow: missing fields become null", () => {
  const r = normalizeEpochRow({ epoch_no: 600 });
  assert.equal(r.epoch, 600);
  assert.equal(r.amountAda, null);
  assert.equal(r.dreps, null);
});

// ---------------------------------------------------------------------------
// normalizeCensusRow / censusStats
// ---------------------------------------------------------------------------
test("normalizeCensusRow: decodes id to kind+hash, carries flags", () => {
  // Real live row (drep_list, fetched 2026-09-14): a key DRep, unregistered.
  const r = normalizeCensusRow({
    drep_id: "drep1ygqzg3ed7rdqeg3343jw0fptqzc3lqtk3rvnnmgq64rj85sxd4sr4",
    hex: "0024472df0da0ca231ac64e7a42b00b11f817688d939ed00d54723d2",
    has_script: false,
    registered: false,
  });
  assert.equal(r.valid, true);
  assert.equal(r.kind, "key");
  assert.equal(r.header, 0x22);
  assert.equal(r.registered, false);
  assert.equal(r.hasScript, false);
  assert.equal(r.hash, "0024472df0da0ca231ac64e7a42b00b11f817688d939ed00d54723d2");
});

test("censusStats: registered-only tally + key/script split + integrity", () => {
  // Real live rows (drep_list, fetched 2026-09-14). Only the script DRep is
  // registered; the key DRep and the CIP-129 vector are not, so the census
  // (registered DReps) is just the one script credential.
  const rows = [
    normalizeCensusRow({ drep_id: "drep1ygqzg3ed7rdqeg3343jw0fptqzc3lqtk3rvnnmgq64rj85sxd4sr4", hex: "0024472df0da0ca231ac64e7a42b00b11f817688d939ed00d54723d2", has_script: false, registered: false }),
    normalizeCensusRow({ drep_id: "drep1yvve4554njxyun2s5p9q70v88d5jl7r0h34pjhw5f5tmw3sjtrutp", hex: "199ad2959c8c4e4d50a04a0f3d873b692ff86fbc6a195dd44d17b746", has_script: true, registered: true }),
    normalizeCensusRow({ drep_id: "drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n", hex: "0000000000000000000000000000000000000000000000000000", has_script: false, registered: false }),
  ];
  const s = censusStats(rows);
  assert.equal(s.total, 1); // only the script DRep is registered
  assert.equal(s.valid, 1); // it decoded to a valid CIP-129 credential
  assert.equal(s.script, 1); // decoded kind === "script" (header 0x23)
  assert.equal(s.key, 0);
  assert.equal(s.integrity, 1);
});

test("censusStats: a malformed id lowers integrity but does not throw", () => {
  const rows = [
    { id: "addr1deadbeef", valid: false, kind: null, header: null, hash: null, hasScript: false, registered: true },
    { id: "drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n", valid: true, kind: "key", header: 0x22, hash: "0".repeat(56), hasScript: false, registered: true },
  ];
  const s = censusStats(rows);
  assert.equal(s.total, 2);
  assert.equal(s.valid, 1);
  assert.equal(s.invalid, 1);
  assert.ok(Math.abs(s.integrity - 0.5) < 1e-12);
});

// ---------------------------------------------------------------------------
// delegationTrend (synthetic)
// ---------------------------------------------------------------------------
function synth(epoch, amountLovelace, dreps) {
  return { epoch, amountAda: amountLovelace / 1e6, dreps };
}

test("delegationTrend: computes growth, deltas, and active-DRep trend", () => {
  const rows = [synth(1, 1_000e6, 10), synth(2, 2_000e6, 20), synth(3, 3_000e6, 30)];
  const t = delegationTrend(rows);
  assert.equal(t.startEpoch, 1);
  assert.equal(t.endEpoch, 3);
  assert.equal(t.epochs, 2);
  assert.ok(Math.abs(t.startAda - 1000) < 1e-9);
  assert.ok(Math.abs(t.endAda - 3000) < 1e-9);
  assert.ok(Math.abs(t.growthAda - 2000) < 1e-9);
  assert.ok(Math.abs(t.growthPct - 2.0) < 1e-9);
  assert.ok(Math.abs(t.avgGrowthPerEpoch - 1000) < 1e-9);
  assert.equal(t.startDreps, 10);
  assert.equal(t.latestDreps, 30);
  assert.equal(t.growthDreps, 20);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0].deltaAda, null);
  assert.ok(Math.abs(t.rows[1].deltaAda - 1000) < 1e-9);
  assert.equal(t.rows[1].deltaDreps, 10);
});

test("delegationTrend: rows are sorted by epoch (input order ignored)", () => {
  const rows = [synth(3, 3e9, 30), synth(1, 1e9, 10), synth(2, 2e9, 20)];
  const t = delegationTrend(rows);
  assert.equal(t.startEpoch, 1);
  assert.equal(t.endEpoch, 3);
});

test("delegationTrend: a shrinking window still reports (negative growth)", () => {
  const rows = [synth(1, 3e9, 30), synth(2, 1e9, 20)];
  const t = delegationTrend(rows);
  assert.ok(t.growthAda < 0);
  assert.ok(t.growthPct < 0);
  assert.equal(t.growthDreps, -10);
});

test("delegationTrend: skips epochs with a null amount", () => {
  const rows = [
    { epoch: 1, amountAda: 1000, dreps: 10 },
    { epoch: 2, amountAda: null, dreps: null },
    { epoch: 3, amountAda: 3000, dreps: 30 },
  ];
  const t = delegationTrend(rows);
  assert.equal(t.startEpoch, 1);
  assert.equal(t.endEpoch, 3);
  assert.equal(t.epochs, 1); // only 2 usable rows → 1 span (the null row is skipped)
  assert.equal(t.rows.length, 2); // rows align to the usable set
});

test("delegationTrend: <2 usable rows throws", () => {
  assert.throws(() => delegationTrend([synth(1, 1e6, 1)]));
  assert.throws(() => delegationTrend([{ epoch: 1, amountAda: null, dreps: null }, { epoch: 2, amountAda: null, dreps: null }]));
});

// ---------------------------------------------------------------------------
// shareOfCirculation
// ---------------------------------------------------------------------------
test("shareOfCirculation: basic ratio + null guards", () => {
  assert.ok(Math.abs(shareOfCirculation(1500, 36000) - 1500 / 36000) < 1e-12);
  assert.equal(shareOfCirculation(null, 100), null);
  assert.equal(shareOfCirculation(100, null), null);
  assert.equal(shareOfCirculation(100, 0), null); // divide-by-zero guard
  assert.equal(shareOfCirculation(100, -5), null); // negative circulation guard
});

// ---------------------------------------------------------------------------
// drepHealth
// ---------------------------------------------------------------------------
test("drepHealth: a healthy live-ish input scores high", () => {
  const trend = delegationTrend([synth(508, 172856e6, 263), synth(655, 15215477e6, 870)]);
  const census = censusStats([
    { id: "drep1ok", valid: true, kind: "key", header: 0x22, hash: "0".repeat(56), hasScript: false, registered: true },
  ]);
  const h = drepHealth({ share: shareOfCirculation(15215477, 36744787), trend, census });
  assert.ok(h.score >= 90, `expected healthy, got ${h.score}`);
  assert.equal(h.label, "healthy");
  assert.ok(h.checks.every((c) => c.pass), "all checks should pass");
});

test("drepHealth: a tiny share + no growth scores low", () => {
  const trend = delegationTrend([synth(1, 5e6, 5), synth(2, 4e6, 4)]);
  const census = censusStats([{ id: "bad", valid: false, kind: null, header: null, hash: null, hasScript: false, registered: true }]);
  const h = drepHealth({ share: 0.001, trend, census });
  assert.ok(h.score < 40);
  assert.equal(h.label, "broken");
});

// ---------------------------------------------------------------------------
// formatters
// ---------------------------------------------------------------------------
test("formatters: nulls → '–', sensible unit scaling", () => {
  assert.equal(fmtAda(null), "–");
  assert.equal(fmtM(null), "–");
  assert.equal(fmtPct(null), "–");
  assert.equal(fmtInt(1234567), "1,234,567");
  assert.equal(fmtM(15215477), "15.22M");
  assert.equal(fmtM(172856), "172.9K");
  assert.equal(fmtM(36744787), "36.74M");
  assert.equal(fmtSignedM(1000000), "+1.00M");
  assert.equal(fmtSignedM(-1000000), "−1.00M");
  assert.equal(fmtPct(0.4141, 2), "41.41%");
});
