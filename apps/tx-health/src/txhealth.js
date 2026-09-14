"use strict";
/**
 * Tx Health Monitor — pure metric functions for Midnight's transaction
 * settlement health and the on-chain D-parameter (decentralization) timeline.
 *
 * Data source: the public NightForge explorer API (CORS-enabled, no auth):
 *   GET /api/analytics/tx-health
 *     {
 *       applied: number,            // lifetime fully-applied extrinsics (local index)
 *       partialSuccess: number,     // lifetime partial-success extrinsics
 *       total: number,              // = applied + partialSuccess
 *       partialRatePct: number,     // API-reported, ~100 * partial/total
 *       recentPartial: [{           // most recent partial-success extrinsics (indexer
 *         txHash: string,             // is known to emit the same tx up to 3x)
 *         blockHeight: number,
 *         timestamp: number          // unix SECONDS here
 *       }],
 *       generatedAt: string         // ISO timestamp
 *     }
 *   GET /api/governance/d-parameter
 *     {
 *       history: [{
 *         blockHeight: number,           // 0 = genesis
 *         timestamp: number,             // unix MILLISECONDS here (note: differs
 *                                        // from the seconds above — see toSeconds)
 *         numPermissionedCandidates: number,  // permissioned (fixed) set
 *         numRegisteredCandidates: number     // openly registered candidates
 *       }],                             // NOT guaranteed sorted; dedupe + sort mandatory
 *       timestamp: string               // ISO timestamp
 *     }
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/**
 * Normalize a timestamp to unix seconds. Midnight's indexer is inconsistent:
 * `/api/analytics/tx-health` recentPartial timestamps are in seconds while
 * `/api/governance/d-parameter` history timestamps are in milliseconds.
 * Heuristic: values >= 1e12 (i.e. any plausible post-2001 millisecond count)
 * are treated as milliseconds. Null/invalid input -> null.
 * @param {number|string|null} ts
 * @returns {?number}
 */
export function toSeconds(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Summarize a /api/analytics/tx-health payload: counts, the recomputed
 * partial rate (independent of the API-reported one), the delta between the
 * two (data-integrity check), and the applied/partial split of `total`.
 * @param {object} p  tx-health payload
 * @returns {{applied:number, partial:number, total:number,
 *            ratePct:?number, reportedRatePct:?number, rateDeltaPct:?number,
 *            appliedShare:?number, sumCheck:boolean, generatedAt:?string}}
 */
export function summarizeTxHealth(p) {
  const d = p || {};
  const applied = Number(d.applied) || 0;
  const partial = Number(d.partialSuccess) || 0;
  const total = Number(d.total) || 0;
  const ratePct = total ? (partial / total) * 100 : null;
  const reported =
    d.partialRatePct != null && Number.isFinite(Number(d.partialRatePct))
      ? Number(d.partialRatePct)
      : null;
  return {
    applied,
    partial,
    total,
    ratePct,
    reportedRatePct: reported,
    rateDeltaPct:
      ratePct != null && reported != null ? ratePct - reported : null,
    appliedShare: total ? applied / total : null,
    // does the ledger actually add up? applied + partial == total
    sumCheck: applied + partial === total,
    generatedAt: d.generatedAt != null ? String(d.generatedAt) : null,
  };
}

/**
 * Parse the recentPartial list into deduped rows sorted newest first
 * (by timestamp, then block height). NightForge is known to emit the same
 * partial-success tx up to three times, so dedupe on (txHash, blockHeight)
 * is mandatory and the number of dropped duplicates is reported honestly.
 * @param {Array<{txHash:string, blockHeight:number, timestamp:number}>} rows
 * @returns {{rows:Array<{txHash:string, block:?number, timestampSec:?number}>,
 *            count:number, duplicateEmissions:number,
 *            uniqueBlocks:number, latestTimestampSec:?number}}
 */
export function parseRecentPartial(rows) {
  const seen = new Set();
  const out = [];
  let duplicateEmissions = 0;
  for (const r of rows || []) {
    if (!r || r.txHash == null) continue;
    const key = `${r.txHash}|${r.blockHeight != null ? Number(r.blockHeight) : ""}`;
    if (seen.has(key)) {
      duplicateEmissions++;
      continue;
    }
    seen.add(key);
    out.push({
      txHash: String(r.txHash),
      block: r.blockHeight != null ? Number(r.blockHeight) : null,
      timestampSec: toSeconds(r.timestamp),
    });
  }
  out.sort(
    (a, b) =>
      (b.timestampSec || 0) - (a.timestampSec || 0) ||
      (b.block || 0) - (a.block || 0)
  );
  const blocks = new Set(out.map((r) => r.block).filter((b) => b != null));
  return {
    rows: out,
    count: out.length,
    duplicateEmissions,
    uniqueBlocks: blocks.size,
    latestTimestampSec: out.length ? out[0].timestampSec : null,
  };
}

/**
 * Parse the /api/governance/d-parameter history: normalize timestamps to
 * seconds, dedupe on (blockHeight, permissioned, registered), sort
 * ascending by timestamp then block height.
 * @param {Array<{blockHeight:number, timestamp:number,
 *                numPermissionedCandidates:number, numRegisteredCandidates:number}>} history
 * @returns {Array<{blockHeight:number, timestampSec:?number, permissioned:number,
 *                  registered:number, total:number, permissionedShare:?number}>}
 */
export function parseDParam(history) {
  const seen = new Set();
  const out = [];
  for (const h of history || []) {
    const permissioned = Number(h.numPermissionedCandidates) || 0;
    const registered = Number(h.numRegisteredCandidates) || 0;
    const blockHeight = h.blockHeight != null ? Number(h.blockHeight) : null;
    const key = `${blockHeight}|${permissioned}|${registered}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const total = permissioned + registered;
    out.push({
      blockHeight,
      timestampSec: toSeconds(h.timestamp),
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
 * Compare the first and latest D-parameter states (the decentralization
 * journey since genesis). Returns null when there is no history or the
 * candidate pool is empty — a dashboard must never show a fake 0%.
 * @param {Array} timeline  output of parseDParam
 * @returns {?{first:object, latest:object,
 *            deltaPermissioned:number, deltaRegistered:number,
 *            latestPermissionedShare:?number}}
 */
export function dParamDelta(timeline) {
  const t = timeline || [];
  if (!t.length) return null;
  const first = t[0];
  const latest = t[t.length - 1];
  return {
    first,
    latest,
    deltaPermissioned: latest.permissioned - first.permissioned,
    deltaRegistered: latest.registered - first.registered,
    latestPermissionedShare: latest.permissionedShare,
  };
}

/**
 * Transaction-health score, 0-100. Transparent rubric — four named checks:
 *   +35  clean settlement:  recomputed partial rate < 1%
 *   +20  low partial rate:  recomputed partial rate < 5%
 *   +25  ledger adds up:    applied + partialSuccess == total
 *   +20  self-consistent:   |recomputed rate − API-reported rate| <= 0.1pp
 * (Checks 1 and 2 are cumulative: a sub-1% rate earns both.)
 * @param {{applied?:number, partial?:number, total?:number,
 *          ratePct?:?number, rateDeltaPct?:?number, sumCheck?:boolean}} s
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function txHealthScore(s) {
  const st = s || {};
  const total = Number(st.total) || 0;
  const rate =
    st.ratePct != null && Number.isFinite(Number(st.ratePct))
      ? Number(st.ratePct)
      : null;
  const delta =
    st.rateDeltaPct != null && Number.isFinite(Number(st.rateDeltaPct))
      ? Math.abs(Number(st.rateDeltaPct))
      : null;
  const sumCheck = st.sumCheck === true;
  const checks = [
    {
      label: "Clean settlement (partial rate < 1%)",
      pass: total > 0 && rate != null && rate < 1,
      pts: 35,
    },
    {
      label: "Low partial rate (< 5%)",
      pass: total > 0 && rate != null && rate < 5,
      pts: 20,
    },
    {
      label: "Ledger adds up (applied + partial = total)",
      pass: sumCheck,
      pts: 25,
    },
    {
      label: "Self-consistent (recomputed rate ≈ API-reported, ±0.1pp)",
      pass: delta != null && delta <= 0.1,
      pts: 20,
    },
  ];
  const score = checks.reduce((x, c) => x + (c.pass ? c.pts : 0), 0);
  const status =
    score >= 80 ? "healthy" : score >= 50 ? "degraded" : score >= 25 ? "watch" : "critical";
  return { score, status, checks };
}

/**
 * Human "N ago" label for a unix-seconds timestamp, relative to `now`
 * (unix seconds). Future/clamped input renders as "now" — never a
 * negative age.
 * @param {number} timestampSec unix seconds
 * @param {number} now unix seconds
 * @returns {string}
 */
export function ageLabel(timestampSec, now) {
  if (!timestampSec) return "—";
  const sec = Math.max(0, Math.floor(now - timestampSec));
  if (sec < 90) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Shorten a 0x transaction hash for table display: first 10 + last 6 chars.
 * Inputs shorter than 20 chars are returned as-is.
 * @param {string} hash
 * @returns {string}
 */
export function shortHash(hash) {
  const h = String(hash || "");
  if (h.length < 20) return h || "—";
  return h.slice(0, 10) + "…" + h.slice(-6);
}
