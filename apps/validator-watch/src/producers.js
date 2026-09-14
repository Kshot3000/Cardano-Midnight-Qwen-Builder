/* Validator Watch — pure logic for the Midnight validator decentralization
   dashboard. No DOM, no fetch — unit-testable.

   Data sources (public, keyless NightForge explorer API):
     GET /api/block-producers?limit=N  -> { totalBlocks, sampled,
        producers: [{ pubkey, blocks, percentage, name, type }] }
        (producer leaderboard: the official indexer samples the last `limit`
         blocks and aggregates by author)
     GET /api/governance/d-parameter   -> { history: [{ blockHeight, timestamp(ms),
        numPermissionedCandidates, numRegisteredCandidates }], timestamp }
        (the D-parameter candidate-pool timeline: permissioned vs registered)
     GET /api/analytics/block-rate?hours=N -> [{ hour(unix-sec), blocks,
        extrinsics }]  (hourly production cadence)
*/

/* ------------------------------------------------------------------ *
 * Producer leaderboard
 * ------------------------------------------------------------------ */

/**
 * Normalize the producer leaderboard rows: coerce numerics, fill missing
 * name/pubkey, drop rows that carry no blocks (a producer with 0 blocks is
 * not a producer), and sort by blocks desc then pubkey asc (stable).
 * @param {Array<{pubkey?:string, blocks?:number, percentage?:number,
 *                name?:string, type?:string}>} rows
 * @returns {Array<{pubkey:string, blocks:number, percentage:?number,
 *                  name:string, type:?string}>}
 */
export function normalizeProducers(rows) {
  const out = [];
  for (const r of rows || []) {
    const blocks = Number(r && r.blocks) || 0;
    if (blocks <= 0) continue;
    const pct = r && r.percentage != null && Number.isFinite(Number(r.percentage))
      ? Number(r.percentage)
      : null;
    out.push({
      pubkey: String((r && r.pubkey) || ""),
      blocks,
      percentage: pct,
      // The indexer ships some names with embedded newlines ("Validator\n#13");
      // collapse all whitespace runs so display + grouping are clean.
      name: r && r.name ? String(r.name).replace(/\s+/g, " ").trim() : "",
      type: r && r.type ? String(r.type) : null,
    });
  }
  out.sort((a, b) => b.blocks - a.blocks || (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
  return out;
}

/**
 * Concentration statistics over a (normalized) producer list:
 *   top1Share  — the largest single producer's block share (0..1)
 *   top3Share  — share held by the top 3 producers
 *   top10Share — share held by the top 10 producers
 *   hhi        — Herfindahl–Hirschman index on exact block fractions,
 *                0..1 (1 = one producer makes every block)
 * Returns all-null when there is no one to measure.
 * @param {Array<{blocks:number}>} producers
 * @returns {{totalBlocks:number, top1Share:?number, top3Share:?number,
 *            top10Share:?number, hhi:?number}}
 */
export function concentration(producers) {
  const list = producers || [];
  if (!list.length) {
    return { totalBlocks: 0, top1Share: null, top3Share: null, top10Share: null, hhi: null };
  }
  const total = list.reduce((s, p) => s + p.blocks, 0);
  if (total <= 0) {
    return { totalBlocks: 0, top1Share: null, top3Share: null, top10Share: null, hhi: null };
  }
  const sorted = list.slice().sort((a, b) => b.blocks - a.blocks);
  const share = (k) => sorted.slice(0, k).reduce((s, p) => s + p.blocks / total, 0);
  const hhi = list.reduce((s, p) => s + Math.pow(p.blocks / total, 2), 0);
  return {
    totalBlocks: total,
    top1Share: share(1),
    top3Share: share(3),
    top10Share: share(10),
    hhi,
  };
}

/**
 * Cross-check the leaderboard against its own arithmetic: the API's
 * `totalBlocks` is the FULL chain length while `sampled` is how many blocks
 * were actually aggregated. Recompute each producer's share from raw counts
 * and report the max absolute delta (pp) between the API-reported
 * `percentage` and the recomputed value. Producers without a reported
 * percentage are skipped (honest "pending"), not treated as 0.
 * @param {Array<{pubkey:string, blocks:number, percentage:?number}>} producers
 *        (normalized)
 * @param {?{sampled?:number, totalBlocks?:number}} api
 * @returns {{recomputedTotal:number, sampledMatch:boolean,
 *            maxDeltaPct:?number, mismatches:number}}
 */
// Percentage values arrive as 0..100; a reported share within 0.5pp of the
// recomputed one is treated as rounding, not a real mismatch.
const MISMATCH_TOLERANCE_PP = 0.5;
export function producerIntegrity(producers, api) {
  const list = producers || [];
  const recomputedTotal = list.reduce((s, p) => s + p.blocks, 0);
  const sampled = api && Number.isFinite(Number(api.sampled)) ? Number(api.sampled) : null;
  const sampledMatch = sampled == null || sampled === recomputedTotal;
  let maxDelta = null;
  let mismatches = 0;
  for (const p of list) {
    if (p.percentage == null || !recomputedTotal) continue;
    const recomputed = (p.blocks / recomputedTotal) * 100;
    // Round to 1e-6 pp: kills float noise (8.9e-16) on exactly-matching shares.
    const delta = Math.round(Math.abs(recomputed - p.percentage) * 1e6) / 1e6;
    if (delta > MISMATCH_TOLERANCE_PP) mismatches += 1;
    if (maxDelta == null || delta > maxDelta) maxDelta = delta;
  }
  return { recomputedTotal, sampledMatch, maxDeltaPct: maxDelta, mismatches };
}

/* ------------------------------------------------------------------ *
 * D-parameter candidate-pool timeline
 * ------------------------------------------------------------------ */

/** Coerce a timestamp that may arrive in ms or s (10 or 13+ digits). */
function toSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

/**
 * Parse the /api/governance/d-parameter history: normalize timestamps to
 * seconds, dedupe on (blockHeight, permissioned, registered), sort ascending
 * by timestamp then block height. Same semantics as Tx Health Monitor's
 * parser (independent copy — the two apps must not share mutable state).
 * @param {Array<{blockHeight:number, timestamp:number,
 *                numPermissionedCandidates:number, numRegisteredCandidates:number}>} history
 * @returns {Array<{blockHeight:?number, timestampSec:?number,
 *                  permissioned:number, registered:number, total:number,
 *                  permissionedShare:?number}>}
 */
export function parseDParamTimeline(history) {
  const seen = new Set();
  const out = [];
  for (const h of history || []) {
    const permissioned = Number(h && h.numPermissionedCandidates) || 0;
    const registered = Number(h && h.numRegisteredCandidates) || 0;
    const blockHeight = h && h.blockHeight != null ? Number(h.blockHeight) : null;
    const key = `${blockHeight}|${permissioned}|${registered}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const total = permissioned + registered;
    out.push({
      blockHeight,
      timestampSec: toSeconds(h && h.timestamp),
      permissioned,
      registered,
      total,
      permissionedShare: total ? permissioned / total : null,
    });
  }
  out.sort(
    (a, b) =>
      (a.timestampSec || 0) - (b.timestampSec || 0) ||
      (a.blockHeight || 0) - (b.blockHeight || 0)
  );
  return out;
}

/**
 * The decentralization journey so far: first vs latest D-parameter state.
 * Returns null when the timeline is empty (no fake 0%).
 * @param {Array} timeline  output of parseDParamTimeline
 * @returns {?{first:object, latest:object, daysBetween:?number,
 *            deltaPermissioned:number, deltaRegistered:number}}
 */
export function dParamJourney(timeline, nowSec) {
  const t = timeline || [];
  if (!t.length) return null;
  const first = t[0];
  const latest = t[t.length - 1];
  let daysBetween = null;
  if (first.timestampSec && latest.timestampSec) {
    daysBetween = (latest.timestampSec - first.timestampSec) / 86400;
  } else if (nowSec && latest.timestampSec) {
    daysBetween = (nowSec - latest.timestampSec) / 86400;
  }
  return {
    first,
    latest,
    daysBetween,
    deltaPermissioned: latest.permissioned - first.permissioned,
    deltaRegistered: latest.registered - first.registered,
  };
}

/* ------------------------------------------------------------------ *
 * Hourly production cadence
 * ------------------------------------------------------------------ */

/**
 * Summarize hourly block-rate rows ({hour, blocks, extrinsics}):
 * complete/partial hours, expected blocks per full hour, mean over complete
 * hours, deviation of the full-hour mean from expectation, and the share of
 * hours that hit the expectation exactly.
 * @param {Array<{hour:number, blocks:number, extrinsics?:number}>} rows
 * @param {{expectedBlocksPerHour?:number, completeHourSeconds?:number}} [opts]
 * @returns {{hours:number, completeHours:number, expectedBlocksPerHour:number,
 *            meanBlocksPerHour:?number, deviationPct:?number,
 *            onTargetHours:number, onTargetShare:?number,
 *            totalBlocks:number, totalExtrinsics:number}}
 */
export function blockRateStats(rows, opts = {}) {
  const expected = Number(opts.expectedBlocksPerHour) || 600;
  const list = rows || [];
  const totalBlocks = list.reduce((s, r) => s + (Number(r && r.blocks) || 0), 0);
  const totalExtrinsics = list.reduce((s, r) => s + (Number(r && r.extrinsics) || 0), 0);
  // A "complete" hour is one that produced at least 98% of the expected
  // blocks — the current partial hour (and any degraded hour) is excluded
  // from the cadence mean so it cannot skew it.
  const complete = list.filter((r) => (Number(r && r.blocks) || 0) >= 0.98 * expected);
  const mean = complete.length
    ? complete.reduce((s, r) => s + (Number(r.blocks) || 0), 0) / complete.length
    : null;
  const deviationPct = mean != null ? ((mean - expected) / expected) * 100 : null;
  const onTarget = list.filter((r) => (Number(r && r.blocks) || 0) === expected).length;
  return {
    hours: list.length,
    completeHours: complete.length,
    expectedBlocksPerHour: expected,
    meanBlocksPerHour: mean,
    deviationPct,
    onTargetHours: onTarget,
    onTargetShare: list.length ? onTarget / list.length : null,
    totalBlocks,
    totalExtrinsics,
  };
}

/* ------------------------------------------------------------------ *
 * Validator health score (0–100, transparent rubric)
 * ------------------------------------------------------------------ */

/**
 * Validator-decentralization health score. Four named checks:
 *   +30  sampled enough:      the API actually sampled >= 100 blocks
 *   +25  no solo:             top-1 producer share <= 20% of sampled blocks
 *   +25  no duopoly:          top-3 producers' combined share <= 45%
 *   +20  self-consistent:     API percentages recompute from raw counts
 *                             (0 mismatches beyond 0.5pp, sampled == sum)
 * @param {{sampled?:?number, top1Share?:?number, top3Share?:?number,
 *          integrity?:?{sampledMatch?:boolean, mismatches?:number}}} s
 * @returns {{score:number, status:string, checks:Array<{label:string,
 *            pass:boolean, pts:number}>}}
 */
export function validatorHealth(s) {
  const st = s || {};
  const sampled = Number(st.sampled) || 0;
  const top1 = st.top1Share != null && Number.isFinite(Number(st.top1Share)) ? Number(st.top1Share) : null;
  const top3 = st.top3Share != null && Number.isFinite(Number(st.top3Share)) ? Number(st.top3Share) : null;
  const integ = st.integrity; // null when the integrity check was never run
  const integrityKnown = integ != null && integ.sampledMatch !== false && (integ.mismatches || 0) === 0;

  const c1 = sampled >= 100;
  const c2 = top1 != null && top1 <= 0.2;
  const c3 = top3 != null && top3 <= 0.45;
  const c4 = integrityKnown;

  const checks = [
    { label: `Sampled ${sampled || 0} blocks (≥100 for a stable share)`, pass: c1, pts: 30 },
    { label: top1 != null ? `Top producer holds ${(top1 * 100).toFixed(1)}% (≤20%)` : "Top-1 share pending", pass: c2, pts: 25 },
    { label: top3 != null ? `Top-3 producers hold ${(top3 * 100).toFixed(1)}% (≤45%)` : "Top-3 share pending", pass: c3, pts: 25 },
    {
      label: integ != null
        ? `Percentages recompute from raw counts (${integ.mismatches || 0} mismatch${integ.mismatches === 1 ? "" : "s"})`
        : "Integrity check pending",
      pass: c4,
      pts: 20,
    },
  ];
  const score = checks.reduce((sum, c) => sum + (c.pass ? c.pts : 0), 0);
  const status = score >= 90 ? "Healthy" : score >= 60 ? "Watch" : "At risk";
  return { score, status, checks };
}
