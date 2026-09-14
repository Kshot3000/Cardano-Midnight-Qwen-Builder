import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProducers,
  concentration,
  producerIntegrity,
  parseDParamTimeline,
  dParamJourney,
  blockRateStats,
  validatorHealth,
} from "../src/producers.js";

/* ---------------------------------------------------------------- *\
 * Fixtures — real live data captured 2026-09-14 (UTC) from
 *   https://mainnet.nightforge.jp/api/block-producers?limit=200
 *     (totalBlocks 2,582,600; sampled 100 — the API caps the sample
 *      at 100 regardless of the requested limit; 13 permissioned
 *      validators; NOTE: some `name` values arrive with embedded
 *      newlines, e.g. "Validator\n#13")
 *   https://mainnet.nightforge.jp/api/analytics/block-rate?hours=24
 *     (25 hourly rows: 14,400 blocks / 43,549 extrinsics)
 *   https://mainnet.nightforge.jp/api/governance/d-parameter
 *     (10 -> 130 permissioned candidates, 0 registered, 38.43 days)
 * ---------------------------------------------------------------- */

const LIVE_PRODUCERS = {
  totalBlocks: 2582600,
  sampled: 100,
  producers: [
    { pubkey: "506135964b135adfdbea434003172d620732731efd4e33f3eca73c785ebd5d0a", blocks: 10, percentage: 10, name: "Validator #1", type: "permissioned" },
    { pubkey: "0ab04fd165acd8df55e6695a68bbaa2dcb2f768ee5625420bb012ef11ee5f737", blocks: 10, percentage: 10, name: "Validator\n#13", type: "permissioned" },
    { pubkey: "bc0bcf2d14d13073f5117b4ff63e71d4db2cfb939637b0fb394fa26e369f142c", blocks: 10, percentage: 10, name: "Validator #11", type: "permissioned" },
    { pubkey: "22004d700d62df213b2edc6d05bca2d1cb5de88c9f12058de94f164a13bb0b2b", blocks: 8, percentage: 8, name: "Validator\n#4", type: "permissioned" },
    { pubkey: "fcbfa8c3d767d8ccbf41c7ac666c802363545f2f620854744ba86ed89ba87925", blocks: 8, percentage: 8, name: "Validator #7", type: "permissioned" },
    { pubkey: "faed36e0e8910990c42b865abe3ad33ca91958f589717956654d93a124556d12", blocks: 8, percentage: 8, name: "Validator #12", type: "permissioned" },
    { pubkey: "9e3324b8b338f2fc2d362f41aae94ca37ca6f0895836478ef33a715ca9f14c31", blocks: 8, percentage: 8, name: "Validator #8", type: "permissioned" },
    { pubkey: "2a55fc6597761cc9a4869c6a92d50d21bc85f03c4a93bb07279225bad12aac63", blocks: 7, percentage: 7, name: "Validator #6", type: "permissioned" },
    { pubkey: "34b084864869ce00e9f31fb0fd0d2dbe17fd98b97d9a91c2508a895cdba5592f", blocks: 7, percentage: 7, name: "Validator #3", type: "permissioned" },
    { pubkey: "72926ebd21cf088cf57fe31a05b3b154d427978a41e529200336a343167e9b19", blocks: 7, percentage: 7, name: "Validator #10", type: "permissioned" },
    { pubkey: "8a7abbefa181f46dada06b8e6faea4d2b3bb693c0f3bb0a07e57ba7cb138415b", blocks: 6, percentage: 6, name: "Validator #9", type: "permissioned" },
    { pubkey: "78fe1f9d48ff2f3561f62e13b0c8aa41b7570ac046e4e35d9692d5ba87dbf452", blocks: 6, percentage: 6, name: "Validator #2", type: "permissioned" },
    { pubkey: "b423bb853dddd955fdcf237d86a2d8b297d92a3c188ae3edf7a2419f7881057b", blocks: 5, percentage: 5, name: "Validator #5", type: "permissioned" },
  ],
};

const LIVE_BLOCK_RATE = [
  { hour: 1789326000, blocks: 245, extrinsics: 738 },
  { hour: 1789329600, blocks: 600, extrinsics: 1826 },
  { hour: 1789333200, blocks: 600, extrinsics: 1809 },
  { hour: 1789336800, blocks: 600, extrinsics: 1815 },
  { hour: 1789340400, blocks: 600, extrinsics: 1811 },
  { hour: 1789344000, blocks: 600, extrinsics: 1810 },
  { hour: 1789347600, blocks: 600, extrinsics: 1827 },
  { hour: 1789351200, blocks: 600, extrinsics: 1810 },
  { hour: 1789354800, blocks: 600, extrinsics: 1810 },
  { hour: 1789358400, blocks: 600, extrinsics: 1810 },
  { hour: 1789362000, blocks: 600, extrinsics: 1812 },
  { hour: 1789365600, blocks: 600, extrinsics: 1812 },
  { hour: 1789369200, blocks: 600, extrinsics: 1809 },
  { hour: 1789372800, blocks: 600, extrinsics: 1812 },
  { hour: 1789376400, blocks: 600, extrinsics: 1810 },
  { hour: 1789380000, blocks: 600, extrinsics: 1813 },
  { hour: 1789383600, blocks: 600, extrinsics: 1831 },
  { hour: 1789387200, blocks: 600, extrinsics: 1817 },
  { hour: 1789390800, blocks: 600, extrinsics: 1815 },
  { hour: 1789394400, blocks: 600, extrinsics: 1810 },
  { hour: 1789398000, blocks: 600, extrinsics: 1821 },
  { hour: 1789401600, blocks: 600, extrinsics: 1811 },
  { hour: 1789405200, blocks: 600, extrinsics: 1827 },
  { hour: 1789408800, blocks: 600, extrinsics: 1810 },
  { hour: 1789412400, blocks: 355, extrinsics: 1073 },
];

const LIVE_D_PARAM_HISTORY = [
  // live payload ships newest-first, timestamps in MILLISECONDS
  { blockHeight: 522886, timestamp: 1777038042000, numPermissionedCandidates: 130, numRegisteredCandidates: 0 },
  { blockHeight: 0, timestamp: 1773717420000, numPermissionedCandidates: 10, numRegisteredCandidates: 0 },
];

/* ------------------------- normalizeProducers --------------------- */

test("normalizeProducers (live): keeps all 13 producers, sorted by blocks desc", () => {
  const p = normalizeProducers(LIVE_PRODUCERS.producers);
  assert.equal(p.length, 13);
  assert.equal(p[0].blocks, 10);
  assert.equal(p[p.length - 1].blocks, 5);
  // every adjacent pair is non-increasing in blocks
  for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].blocks >= p[i].blocks);
});

test("normalizeProducers (live): embedded newlines in names are collapsed", () => {
  const p = normalizeProducers(LIVE_PRODUCERS.producers);
  const names = p.map((x) => x.name);
  assert.ok(names.includes("Validator #13"));
  assert.ok(names.includes("Validator #4"));
  assert.ok(!names.some((n) => /\s/.test(n.replace("Validator #", "").includes("  "))));
  assert.ok(names.every((n) => !n.includes("\n")));
});

test("normalizeProducers: drops 0-block and null rows, coerces numerics", () => {
  const p = normalizeProducers([
    { pubkey: "a", blocks: 3, percentage: 50, name: "x" },
    { pubkey: "b", blocks: 0 },
    { pubkey: "c", blocks: "2", percentage: "50" },
    null,
    { blocks: 4 },
  ]);
  // the pubkey-less row is kept (sorted first: 4 blocks) with a "" identity
  assert.deepEqual(
    p.map((x) => x.pubkey),
    ["", "a", "c"]
  );
  assert.equal(p[0].blocks, 4);
  assert.equal(p[1].blocks, 3);
  assert.equal(p[2].blocks, 2);
  assert.equal(p[2].percentage, 50);
  assert.equal(p[2].name, "");
  assert.equal(p[2].type, null);
});

test("normalizeProducers: ties on blocks break by pubkey asc (stable)", () => {
  const p = normalizeProducers([
    { pubkey: "bbb", blocks: 5 },
    { pubkey: "aaa", blocks: 5 },
    { pubkey: "ccc", blocks: 5 },
  ]);
  assert.deepEqual(p.map((x) => x.pubkey), ["aaa", "bbb", "ccc"]);
});

test("normalizeProducers: empty/null input -> []", () => {
  assert.deepEqual(normalizeProducers(null), []);
  assert.deepEqual(normalizeProducers([]), []);
});

/* --------------------------- concentration ------------------------ */

test("concentration (live): exact shares — top1 10%, top3 30%, top10 83%, HHI 0.08", () => {
  const c = concentration(normalizeProducers(LIVE_PRODUCERS.producers));
  assert.equal(c.totalBlocks, 100);
  assert.ok(Math.abs(c.top1Share - 0.1) < 1e-12);
  assert.ok(Math.abs(c.top3Share - 0.3) < 1e-12);
  assert.ok(Math.abs(c.top10Share - 0.83) < 1e-12);
  // HHI = (10^2*3 + 8^2*4 + 7^2*3 + 6^2*2 + 5^2) / 100^2 = 800/10000
  assert.ok(Math.abs(c.hhi - 0.08) < 1e-12);
});

test("concentration: single producer -> hhi 1, all shares 1", () => {
  const c = concentration([{ blocks: 42 }]);
  assert.equal(c.hhi, 1);
  assert.equal(c.top1Share, 1);
  assert.equal(c.top3Share, 1);
  assert.equal(c.top10Share, 1);
});

test("concentration: empty list -> nulls, no crash, no fake 0%", () => {
  const c = concentration([]);
  assert.deepEqual(c, { totalBlocks: 0, top1Share: null, top3Share: null, top10Share: null, hhi: null });
  assert.deepEqual(concentration(null), c);
});

/* ------------------------- producerIntegrity ---------------------- */

test("producerIntegrity (live): sum 100 == sampled 100, all 13 percentages recompute", () => {
  const i = producerIntegrity(normalizeProducers(LIVE_PRODUCERS.producers), LIVE_PRODUCERS);
  assert.equal(i.recomputedTotal, 100);
  assert.equal(i.sampledMatch, true);
  assert.equal(i.mismatches, 0);
  assert.equal(i.maxDeltaPct, 0);
});

test("producerIntegrity: off-by-one percentage is a mismatch beyond 0.5pp tolerance", () => {
  const i = producerIntegrity(
    [
      { pubkey: "a", blocks: 60, percentage: 60 },
      { pubkey: "b", blocks: 40, percentage: 39 }, // true share is 40
    ],
    { sampled: 100 }
  );
  assert.equal(i.mismatches, 1);
  assert.ok(Math.abs(i.maxDeltaPct - 1) < 1e-12);
  assert.equal(i.sampledMatch, true);
});

test("producerIntegrity: sampling mismatch detected", () => {
  const i = producerIntegrity(
    [{ pubkey: "a", blocks: 90, percentage: 90 }, { pubkey: "b", blocks: 10, percentage: 10 }],
    { sampled: 200 }
  );
  assert.equal(i.sampledMatch, false);
});

test("producerIntegrity: missing percentages are skipped, maxDelta stays null", () => {
  const i = producerIntegrity(
    [{ pubkey: "a", blocks: 50 }, { pubkey: "b", blocks: 50 }],
    { sampled: 100 }
  );
  assert.equal(i.mismatches, 0);
  assert.equal(i.maxDeltaPct, null);
});

test("producerIntegrity: 0.5pp rounding delta is within tolerance (no mismatch)", () => {
  // 3 x 100 of 300 = 33.3333%; API reports 33.35 -> delta 0.0167 <= 0.5
  const i = producerIntegrity(
    [
      { pubkey: "a", blocks: 100, percentage: 33.35 },
      { pubkey: "b", blocks: 100, percentage: 33.35 },
      { pubkey: "c", blocks: 100, percentage: 33.3 },
    ],
    { sampled: 300 }
  );
  assert.equal(i.mismatches, 0);
  assert.equal(i.sampledMatch, true);
});

/* ------------------------ parseDParamTimeline --------------------- */

test("parseDParamTimeline (live): newest-first ms payload -> genesis-first seconds", () => {
  const t = parseDParamTimeline(LIVE_D_PARAM_HISTORY);
  assert.equal(t.length, 2);
  assert.equal(t[0].blockHeight, 0);
  assert.equal(t[0].timestampSec, 1773717420);
  assert.equal(t[0].permissioned, 10);
  assert.equal(t[1].blockHeight, 522886);
  assert.equal(t[1].timestampSec, 1777038042);
  assert.equal(t[1].permissioned, 130);
  assert.equal(t[1].registered, 0);
  assert.equal(t[1].total, 130);
  assert.ok(Math.abs(t[1].permissionedShare - 1) < 1e-12);
});

test("parseDParamTimeline: mixed registered candidates give a partial share", () => {
  const t = parseDParamTimeline([
    { blockHeight: 1, timestamp: 2000, numPermissionedCandidates: 3, numRegisteredCandidates: 1 },
  ]);
  assert.equal(t[0].total, 4);
  assert.ok(Math.abs(t[0].permissionedShare - 0.75) < 1e-12);
});

test("parseDParamTimeline: duplicates on (block, perm, reg) are deduped", () => {
  const t = parseDParamTimeline([
    { blockHeight: 9, timestamp: 1000, numPermissionedCandidates: 4, numRegisteredCandidates: 1 },
    { blockHeight: 9, timestamp: 999, numPermissionedCandidates: 4, numRegisteredCandidates: 1 },
    { blockHeight: 9, timestamp: 998, numPermissionedCandidates: 5, numRegisteredCandidates: 1 },
  ]);
  assert.equal(t.length, 2);
});

test("parseDParamTimeline: zero-total state -> null share, not NaN", () => {
  const t = parseDParamTimeline([
    { blockHeight: 0, timestamp: 1, numPermissionedCandidates: 0, numRegisteredCandidates: 0 },
  ]);
  assert.equal(t[0].permissionedShare, null);
});

test("parseDParamTimeline: empty input -> []", () => {
  assert.deepEqual(parseDParamTimeline(null), []);
  assert.deepEqual(parseDParamTimeline([]), []);
});

/* --------------------------- dParamJourney ------------------------ */

test("dParamJourney (live): 10 -> 130 permissioned (+120), 38.43 days", () => {
  const j = dParamJourney(parseDParamTimeline(LIVE_D_PARAM_HISTORY));
  assert.equal(j.deltaPermissioned, 120);
  assert.equal(j.deltaRegistered, 0);
  assert.ok(Math.abs(j.daysBetween - 38.433125) < 1e-9);
  assert.equal(j.first.permissioned, 10);
  assert.equal(j.latest.permissioned, 130);
});

test("dParamJourney: single state -> zero deltas, 0 days elapsed", () => {
  const j = dParamJourney(parseDParamTimeline([{ blockHeight: 0, timestamp: 1000, numPermissionedCandidates: 4, numRegisteredCandidates: 1 }]));
  assert.equal(j.deltaPermissioned, 0);
  assert.equal(j.deltaRegistered, 0);
  assert.equal(j.daysBetween, 0);
  assert.equal(j.first, j.latest);
});

test("dParamJourney: empty timeline -> null (no fake 0%)", () => {
  assert.equal(dParamJourney([]), null);
  assert.equal(dParamJourney(null), null);
});

test("dParamJourney: missing first timestamp falls back to nowSec anchor", () => {
  const t = parseDParamTimeline([
    { blockHeight: 0, timestamp: 0, numPermissionedCandidates: 2, numRegisteredCandidates: 0 },
    { blockHeight: 5, timestamp: 1000, numPermissionedCandidates: 6, numRegisteredCandidates: 0 },
  ]);
  const j = dParamJourney(t, 1000 + 86400 * 2);
  assert.ok(Math.abs(j.daysBetween - 2) < 1e-12);
});

/* --------------------------- blockRateStats ----------------------- */

test("blockRateStats (live 24h): 25 rows, 14,400 blocks, 43,549 extrinsics", () => {
  const s = blockRateStats(LIVE_BLOCK_RATE);
  assert.equal(s.hours, 25);
  assert.equal(s.totalBlocks, 14400);
  assert.equal(s.totalExtrinsics, 43549);
  assert.equal(s.expectedBlocksPerHour, 600);
});

test("blockRateStats (live 24h): partial hours excluded from cadence mean", () => {
  const s = blockRateStats(LIVE_BLOCK_RATE);
  // first row (245) and last row (355) are partial hours (< 98% of 600)
  assert.equal(s.completeHours, 23);
  assert.equal(s.meanBlocksPerHour, 600);
  assert.ok(Math.abs(s.deviationPct) < 1e-12);
  assert.equal(s.onTargetHours, 23);
  assert.ok(Math.abs(s.onTargetShare - 23 / 25) < 1e-12);
});

test("blockRateStats: all-complete window -> zero deviation, 100% on target", () => {
  const s = blockRateStats([
    { hour: 1, blocks: 600, extrinsics: 10 },
    { hour: 2, blocks: 600, extrinsics: 10 },
  ]);
  assert.equal(s.completeHours, 2);
  assert.equal(s.deviationPct, 0);
  assert.equal(s.onTargetShare, 1);
});

test("blockRateStats: degraded hour pulls the complete-hour mean up", () => {
  // one 610-block hour (above 98% threshold = complete) + one partial
  const s = blockRateStats([
    { hour: 1, blocks: 610 },
    { hour: 2, blocks: 500 }, // partial: 500 < 588
  ]);
  assert.equal(s.completeHours, 1);
  assert.ok(Math.abs(s.meanBlocksPerHour - 610) < 1e-12);
  assert.ok(Math.abs(s.deviationPct - (10 / 600) * 100) < 1e-12);
  assert.equal(s.onTargetHours, 0);
});

test("blockRateStats: empty input -> nulls, no crash", () => {
  const s = blockRateStats([]);
  assert.equal(s.hours, 0);
  assert.equal(s.meanBlocksPerHour, null);
  assert.equal(s.deviationPct, null);
  assert.equal(s.onTargetShare, null);
});

test("blockRateStats: custom expected cadence is honored", () => {
  const s = blockRateStats([{ hour: 1, blocks: 40 }, { hour: 2, blocks: 40 }], { expectedBlocksPerHour: 40 });
  assert.equal(s.meanBlocksPerHour, 40);
  assert.equal(s.deviationPct, 0);
  assert.equal(s.onTargetShare, 1);
});

/* -------------------------- validatorHealth ----------------------- */

function liveInput() {
  const producers = normalizeProducers(LIVE_PRODUCERS.producers);
  const conc = concentration(producers);
  const integ = producerIntegrity(producers, LIVE_PRODUCERS);
  return { sampled: LIVE_PRODUCERS.sampled, top1Share: conc.top1Share, top3Share: conc.top3Share, integrity: integ };
}

test("validatorHealth (live): 13 permissioned validators -> 100 Healthy", () => {
  const h = validatorHealth(liveInput());
  assert.equal(h.score, 100);
  assert.equal(h.status, "Healthy");
  assert.equal(h.checks.every((c) => c.pass), true);
});

test("validatorHealth: under-sampled fails check 1 (30 pts lost)", () => {
  const h = validatorHealth({ ...liveInput(), sampled: 50 });
  assert.equal(h.checks[0].pass, false);
  assert.equal(h.score, 70);
  assert.equal(h.status, "Watch");
});

test("validatorHealth: solo producer at 25% fails no-solo, 30% top-3 passes", () => {
  const h = validatorHealth({
    sampled: 1000,
    top1Share: 0.25,
    top3Share: 0.3,
    integrity: { sampledMatch: true, mismatches: 0 },
  });
  assert.equal(h.checks[1].pass, false);
  assert.equal(h.checks[2].pass, true);
  assert.equal(h.score, 75);
  assert.equal(h.status, "Watch");
});

test("validatorHealth: boundary — top1 exactly 0.20 passes (<=)", () => {
  const h = validatorHealth({
    sampled: 100,
    top1Share: 0.2,
    top3Share: 0.45,
    integrity: { sampledMatch: true, mismatches: 0 },
  });
  assert.equal(h.checks[1].pass, true);
  assert.equal(h.checks[2].pass, true); // 0.45 <= 0.45
  assert.equal(h.score, 100);
});

test("validatorHealth: boundary — top3 at 0.4501 fails", () => {
  const h = validatorHealth({
    sampled: 100,
    top1Share: 0.15,
    top3Share: 0.4501,
    integrity: { sampledMatch: true, mismatches: 0 },
  });
  assert.equal(h.checks[2].pass, false);
  assert.equal(h.score, 75);
});

test("validatorHealth: integrity mismatch or sampling drift fails check 4", () => {
  const base = { sampled: 100, top1Share: 0.1, top3Share: 0.3 };
  assert.equal(validatorHealth({ ...base, integrity: { sampledMatch: true, mismatches: 1 } }).checks[3].pass, false);
  assert.equal(validatorHealth({ ...base, integrity: { sampledMatch: false, mismatches: 0 } }).checks[3].pass, false);
  assert.equal(validatorHealth({ ...base, integrity: { sampledMatch: true, mismatches: 0 } }).checks[3].pass, true);
});

test("validatorHealth: missing shares -> pending labels, score 50 (sampled + integrity only)", () => {
  const h = validatorHealth({ sampled: 100, integrity: { sampledMatch: true, mismatches: 0 } });
  assert.equal(h.checks[1].pass, false);
  assert.equal(h.checks[2].pass, false);
  assert.ok(h.checks[1].label.includes("pending"));
  assert.ok(h.checks[2].label.includes("pending"));
  assert.equal(h.score, 50);
  assert.equal(h.status, "At risk");
});

test("validatorHealth: empty input -> 0 / At risk, no crash", () => {
  const h = validatorHealth(null);
  assert.equal(h.score, 0);
  assert.equal(h.status, "At risk");
});

