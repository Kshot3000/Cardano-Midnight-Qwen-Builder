import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toSeconds,
  summarizeTxHealth,
  parseRecentPartial,
  parseDParam,
  dParamDelta,
  txHealthScore,
  ageLabel,
  shortHash,
} from "../src/txhealth.js";

/* ---------------------------------------------------------------- *
 * Fixtures — real live data captured from
 *   https://mainnet.nightforge.jp/api/analytics/tx-health
 *   https://mainnet.nightforge.jp/api/governance/d-parameter
 * (both 2026-09-14, 17:36 UTC).
 * ---------------------------------------------------------------- */

const LIVE_TX_HEALTH = {
  applied: 247438,
  partialSuccess: 8740,
  total: 256178,
  partialRatePct: 3.41,
  recentPartial: [
    { txHash: "0x780205da50a683f059c6115675595f34775dbc4ad32211ceed470ea65d911ec7", blockHeight: 2496445, timestamp: 1788897546 },
    { txHash: "0x72383e1ec108b9e0696ab0851b613562c3d4978ac051357312243fe404bea663", blockHeight: 2496442, timestamp: 1788897528 },
    // NightForge emits this tx three times — dedupe required
    { txHash: "0x64dcf9caa45f401e96c3aa2bd3577d7f92dfae2d5da76e76ea8e36438c126123", blockHeight: 2416483, timestamp: 1788417750 },
    { txHash: "0x64dcf9caa45f401e96c3aa2bd3577d7f92dfae2d5da76e76ea8e36438c126123", blockHeight: 2416483, timestamp: 1788417750 },
    { txHash: "0x64dcf9caa45f401e96c3aa2bd3577d7f92dfae2d5da76e76ea8e36438c126123", blockHeight: 2416483, timestamp: 1788417750 },
    { txHash: "0xa3340c8fbda809c704697f57e1e52b0ecc018b07cec0dfaa7f56b13b02332c7a", blockHeight: 2414975, timestamp: 1788408702 },
    { txHash: "0xa3340c8fbda809c704697f57e1e52b0ecc018b07cec0dfaa7f56b13b02332c7a", blockHeight: 2414975, timestamp: 1788408702 },
    { txHash: "0x92bdc7a66569e8a8fa135c81ceb7d37d3a35abef538868dfd46473d7ab940144", blockHeight: 2401329, timestamp: 1788326814 },
    { txHash: "0x4f51d053526dd6745a01d7cb1cf0019552f6410ab239b4b8c11074b6408e5f38", blockHeight: 2382433, timestamp: 1788213408 },
    { txHash: "0x78bf79a85c2ae6a1bcd221a41fffb059481995b2bd499c1c8dc6422c19d8192b", blockHeight: 2366286, timestamp: 1788116526 },
  ],
  generatedAt: "2026-09-14T17:36:41.275Z",
};

const LIVE_D_PARAM = {
  history: [
    // NOTE: the live payload ships newest-first and timestamps are in MILLISECONDS
    { blockHeight: 522886, timestamp: 1777038042000, numPermissionedCandidates: 130, numRegisteredCandidates: 0 },
    { blockHeight: 0, timestamp: 1773717420000, numPermissionedCandidates: 10, numRegisteredCandidates: 0 },
  ],
  timestamp: "2026-09-14T17:35:38.349Z",
};

/* ----------------------------- toSeconds -------------------------- */

test("toSeconds: millisecond timestamps (>= 1e12) are converted", () => {
  assert.equal(toSeconds(1777038042000), 1777038042);
  assert.equal(toSeconds(1788897546500), 1788897546);
});

test("toSeconds: plain second timestamps pass through untouched", () => {
  assert.equal(toSeconds(1788897546), 1788897546);
  assert.equal(toSeconds(999999999), 999999999);
});

test("toSeconds: boundary — exactly 1e12 is treated as milliseconds", () => {
  assert.equal(toSeconds(1e12), 1e9);
});

test("toSeconds: null / empty / garbage -> null", () => {
  assert.equal(toSeconds(null), null);
  assert.equal(toSeconds(undefined), null);
  assert.equal(toSeconds(""), null);
  assert.equal(toSeconds("not-a-number"), null);
  assert.equal(toSeconds(-5), null);
});

/* ------------------------- summarizeTxHealth ---------------------- */

test("summarizeTxHealth (live): exact counts and applied share", () => {
  const s = summarizeTxHealth(LIVE_TX_HEALTH);
  assert.equal(s.applied, 247438);
  assert.equal(s.partial, 8740);
  assert.equal(s.total, 256178);
  assert.ok(Math.abs(s.appliedShare - 247438 / 256178) < 1e-12);
  assert.equal(s.generatedAt, "2026-09-14T17:36:41.275Z");
});

test("summarizeTxHealth (live): recomputed rate = 8740/256178, delta vs 3.41", () => {
  const s = summarizeTxHealth(LIVE_TX_HEALTH);
  assert.ok(Math.abs(s.ratePct - (8740 / 256178) * 100) < 1e-9);
  // 3.41167...pp - 3.41pp
  assert.ok(Math.abs(s.rateDeltaPct - ((8740 / 256178) * 100 - 3.41)) < 1e-9);
  assert.ok(s.rateDeltaPct > 0 && s.rateDeltaPct < 0.01); // within 0.1pp, barely
});

test("summarizeTxHealth (live): ledger adds up — sumCheck true", () => {
  const s = summarizeTxHealth(LIVE_TX_HEALTH);
  assert.equal(s.sumCheck, true);
  assert.equal(247438 + 8740, 256178);
});

test("summarizeTxHealth: mismatched counts -> sumCheck false", () => {
  const s = summarizeTxHealth({ applied: 100, partialSuccess: 5, total: 110 });
  assert.equal(s.sumCheck, false);
  assert.equal(s.ratePct, 5 / 110 * 100);
});

test("summarizeTxHealth: empty payload -> zeros and nulls, no throw", () => {
  const s = summarizeTxHealth(null);
  assert.equal(s.applied, 0);
  assert.equal(s.partial, 0);
  assert.equal(s.total, 0);
  assert.equal(s.ratePct, null);
  assert.equal(s.reportedRatePct, null);
  assert.equal(s.rateDeltaPct, null);
  assert.equal(s.appliedShare, null);
  assert.equal(s.sumCheck, true); // 0 + 0 === 0
});

test("summarizeTxHealth: missing reported rate -> null delta, no fake match", () => {
  const s = summarizeTxHealth({ applied: 95, partialSuccess: 5, total: 100 });
  assert.equal(s.reportedRatePct, null);
  assert.equal(s.rateDeltaPct, null);
  assert.equal(s.ratePct, 5);
});

/* ------------------------- parseRecentPartial --------------------- */

test("parseRecentPartial (live): 10 emissions -> 7 unique, 3 duplicates dropped", () => {
  const r = parseRecentPartial(LIVE_TX_HEALTH.recentPartial);
  assert.equal(r.count, 7);
  assert.equal(r.duplicateEmissions, 3);
  assert.equal(r.uniqueBlocks, 7);
});

test("parseRecentPartial (live): newest-first ordering by timestamp", () => {
  const r = parseRecentPartial(LIVE_TX_HEALTH.recentPartial);
  assert.equal(r.rows[0].txHash, "0x780205da50a683f059c6115675595f34775dbc4ad32211ceed470ea65d911ec7");
  assert.equal(r.rows[0].block, 2496445);
  assert.equal(r.rows[0].timestampSec, 1788897546);
  assert.equal(r.rows[6].txHash, "0x78bf79a85c2ae6a1bcd221a41fffb059481995b2bd499c1c8dc6422c19d8192b");
  assert.equal(r.latestTimestampSec, 1788897546);
});

test("parseRecentPartial: ties on timestamp break by block height (desc)", () => {
  const r = parseRecentPartial([
    { txHash: "0xa", blockHeight: 100, timestamp: 1000 },
    { txHash: "0xb", blockHeight: 200, timestamp: 1000 },
    { txHash: "0xc", blockHeight: 300, timestamp: 1000 },
  ]);
  assert.deepEqual(r.rows.map((x) => x.txHash), ["0xc", "0xb", "0xa"]);
});

test("parseRecentPartial: missing/invalid entries are skipped, not crashed on", () => {
  const r = parseRecentPartial([
    null,
    { blockHeight: 1 },
    { txHash: "0xdeadbeef", blockHeight: null, timestamp: null },
  ]);
  assert.equal(r.count, 1);
  assert.equal(r.rows[0].block, null);
  assert.equal(r.rows[0].timestampSec, null);
});

test("parseRecentPartial: empty input -> zero counts", () => {
  const r = parseRecentPartial([]);
  assert.deepEqual(r, { rows: [], count: 0, duplicateEmissions: 0, uniqueBlocks: 0, latestTimestampSec: null });
});

/* ----------------------------- parseDParam ------------------------ */

test("parseDParam (live): newest-first payload is sorted genesis-first, ms -> s", () => {
  const t = parseDParam(LIVE_D_PARAM.history);
  assert.equal(t.length, 2);
  assert.equal(t[0].blockHeight, 0);
  assert.equal(t[0].permissioned, 10);
  assert.equal(t[0].registered, 0);
  assert.equal(t[0].timestampSec, 1773717420);
  assert.equal(t[1].blockHeight, 522886);
  assert.equal(t[1].permissioned, 130);
  assert.equal(t[1].timestampSec, 1777038042);
  assert.equal(t[1].permissionedShare, 1);
});

test("parseDParam: duplicate entries are deduped on (block, permissioned, registered)", () => {
  const t = parseDParam([
    { blockHeight: 5, timestamp: 1000, numPermissionedCandidates: 12, numRegisteredCandidates: 3 },
    { blockHeight: 5, timestamp: 1000, numPermissionedCandidates: 12, numRegisteredCandidates: 3 },
    { blockHeight: 5, timestamp: 1000, numPermissionedCandidates: 13, numRegisteredCandidates: 3 },
  ]);
  assert.equal(t.length, 2);
  assert.equal(t[1].total, 16);
  assert.ok(Math.abs(t[1].permissionedShare - 13 / 16) < 1e-12);
});

test("parseDParam: empty input -> []", () => {
  assert.deepEqual(parseDParam(null), []);
  assert.deepEqual(parseDParam([]), []);
});

/* ---------------------------- dParamDelta ------------------------- */

test("dParamDelta (live): permissioned 10 -> 130 (+120), registered 0 -> 0", () => {
  const d = dParamDelta(parseDParam(LIVE_D_PARAM.history));
  assert.equal(d.deltaPermissioned, 120);
  assert.equal(d.deltaRegistered, 0);
  assert.equal(d.first.blockHeight, 0);
  assert.equal(d.latest.permissioned, 130);
  assert.equal(d.latestPermissionedShare, 1);
});

test("dParamDelta: empty timeline -> null (no fake 0%)", () => {
  assert.equal(dParamDelta([]), null);
  assert.equal(dParamDelta(null), null);
});

test("dParamDelta: single state -> zero deltas, not null", () => {
  const d = dParamDelta(parseDParam([{ blockHeight: 0, timestamp: 1, numPermissionedCandidates: 4, numRegisteredCandidates: 1 }]));
  assert.equal(d.deltaPermissioned, 0);
  assert.equal(d.deltaRegistered, 0);
  assert.equal(d.latest.total, 5);
});

/* --------------------------- txHealthScore ------------------------ */

test("txHealthScore (live): 3.41% partial -> 65 / degraded, exact flags", () => {
  const s = summarizeTxHealth(LIVE_TX_HEALTH);
  const h = txHealthScore(s);
  assert.equal(h.score, 65); // 0 + 20 + 25 + 20
  assert.equal(h.status, "degraded");
  assert.equal(h.checks[0].pass, false); // 3.41% is NOT < 1%
  assert.equal(h.checks[1].pass, true);
  assert.equal(h.checks[2].pass, true);
  assert.equal(h.checks[3].pass, true); // delta 0.0017pp <= 0.1pp
});

test("txHealthScore: perfect ledger -> 100 / healthy", () => {
  const h = txHealthScore({
    applied: 999,
    partial: 1,
    total: 1000,
    ratePct: 0.1,
    rateDeltaPct: 0.01,
    sumCheck: true,
  });
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
});

test("txHealthScore: zero total -> rate checks fail, ledger vacuously adds up (25 / watch)", () => {
  const h = txHealthScore({ applied: 0, partial: 0, total: 0, sumCheck: true });
  assert.equal(h.score, 25);
  assert.equal(h.status, "watch");
});

test("txHealthScore boundary: rate exactly 1.0 fails the < 1% check, passes < 5%", () => {
  const h = txHealthScore({ applied: 99, partial: 1, total: 100, ratePct: 1.0, rateDeltaPct: 0, sumCheck: true });
  assert.equal(h.checks[0].pass, false);
  assert.equal(h.checks[1].pass, true);
  assert.equal(h.score, 65);
});

test("txHealthScore boundary: self-consistency delta exactly 0.1pp passes, 0.11 fails", () => {
  const base = { applied: 90, partial: 10, total: 100, ratePct: 10, sumCheck: true };
  assert.equal(txHealthScore({ ...base, rateDeltaPct: 0.1 }).checks[3].pass, true);
  assert.equal(txHealthScore({ ...base, rateDeltaPct: 0.11 }).checks[3].pass, false);
});

/* ----------------------------- ageLabel --------------------------- */

test("ageLabel: seconds / minutes / hours / days", () => {
  const now = 1788897546;
  assert.equal(ageLabel(now - 30, now), "30s ago");
  assert.equal(ageLabel(now - 60 * 5, now), "5m ago");
  assert.equal(ageLabel(now - 3600 * 7, now), "7h ago");
  assert.equal(ageLabel(now - 86400 * 3, now), "3d ago");
});

test("ageLabel: future or zero input never renders a negative age", () => {
  assert.equal(ageLabel(0, 100), "—");
  assert.equal(ageLabel(200, 100), "0s ago");
});

/* ----------------------------- shortHash -------------------------- */

test("shortHash: 0x-64-hex -> first10 + … + last6", () => {
  assert.equal(
    shortHash("0x780205da50a683f059c6115675595f34775dbc4ad32211ceed470ea65d911ec7"),
    "0x780205da…911ec7"
  );
});

test("shortHash: short and empty inputs pass through safely", () => {
  assert.equal(shortHash("0xabc"), "0xabc");
  assert.equal(shortHash(""), "—");
  assert.equal(shortHash(null), "—");
});
