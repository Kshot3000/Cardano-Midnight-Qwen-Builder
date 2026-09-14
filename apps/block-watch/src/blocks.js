"use strict";
/**
 * Block Watch — pure metric functions for Midnight block production.
 *
 * Data source: the public NightForge explorer API (CORS-enabled, no auth):
 *   GET /api/blocks?limit=N
 *     [
 *       {
 *         height: number,              // block number, newest first
 *         hash: string,                // 0x + 64 hex
 *         parent_hash: string,         // 0x + 64 hex
 *         state_root: string,
 *         extrinsics_root: string,
 *         timestamp: number,           // unix seconds
 *         extrinsics_count: number,
 *         created_at: number
 *       }, ...
 *     ]
 *   GET /api/analytics/overview  (network context)
 *     { blocks, extrinsics, avgBlockTime, tps, epoch: {
 *         mainchain_epoch, mainchain_slot, next_epoch_timestamp (unix ms),
 *         sidechain_slot }, genesisTime (unix seconds), networkAgeDays }
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/**
 * Normalize a blocks list to ascending order (oldest first, height
 * increasing). The API returns newest first; sorting by height is
 * order-independent and safe.
 * @param {Array<{height:number}>} blocks
 * @returns {Array}
 */
export function ascending(blocks) {
  return [...(blocks || [])].sort((a, b) => (a.height || 0) - (b.height || 0));
}

/**
 * Verify the hash chain over a block list: every block's parent_hash
 * must equal the hash of the previous (lower) block. The newest block's
 * parent is verifiable only against the fetched window, so a chain of N
 * blocks yields N-1 checkable links.
 * @param {Array<{height:number, hash:string, parent_hash:string}>} blocks any order
 * @returns {{links:number, broken:number, brokenHeights:Array<number>}}
 */
export function verifyChain(blocks) {
  const asc = ascending(blocks);
  let links = 0;
  const brokenHeights = [];
  for (let i = 1; i < asc.length; i++) {
    links++;
    const child = asc[i];
    const parent = asc[i - 1];
    if (!child.parent_hash || !parent.hash || child.parent_hash !== parent.hash) {
      brokenHeights.push(child.height);
    }
  }
  return {
    links,
    broken: brokenHeights.length,
    brokenHeights,
  };
}

/**
 * Verify block-height contiguity: consecutive blocks in the window must
 * have heights differing by exactly 1. A gap means a block height the
 * indexer skipped (or a reorg the indexer did not heal).
 * @param {Array<{height:number}>} blocks any order
 * @returns {{gaps:number, gapDetails:Array<{afterHeight:number, beforeHeight:number, missing:number}>}}
 */
export function verifyContiguity(blocks) {
  const asc = ascending(blocks);
  const gapDetails = [];
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1].height;
    const cur = asc[i].height;
    if (cur - prev > 1) {
      gapDetails.push({ afterHeight: prev, beforeHeight: cur, missing: cur - prev - 1 });
    }
  }
  return { gaps: gapDetails.length, gapDetails };
}

/**
 * Inter-block time gaps (seconds) between consecutive blocks, oldest
 * first. Negative gaps (clock skew / out-of-order timestamps) are kept
 * as-is so callers can flag them.
 * @param {Array<{height:number, timestamp:number}>} blocks any order
 * @returns {number[]}
 */
export function interblockGaps(blocks) {
  const asc = ascending(blocks);
  const gaps = [];
  for (let i = 1; i < asc.length; i++) {
    gaps.push(asc[i].timestamp - asc[i - 1].timestamp);
  }
  return gaps;
}

/**
 * Pace statistics over the block window:
 * @param {Array<{height:number, timestamp:number, extrinsics_count:number}>} blocks any order
 * @returns {{
 *   blocks:number,
 *   spanSec:number|null,       // wall time between first and last timestamp
 *   avgGapSec:number|null,     // mean inter-block gap
 *   minGapSec:number|null,
 *   maxGapSec:number|null,
 *   blocksPerMin:number|null,  // (n-1)/span minutes
 *   avgExtrinsicsPerBlock:number|null,
 *   negativeGaps:number        // out-of-order timestamps
 * }}
 */
export function paceStats(blocks) {
  const asc = ascending(blocks);
  const n = asc.length;
  if (n < 2) {
    return {
      blocks: n,
      spanSec: null,
      avgGapSec: null,
      minGapSec: null,
      maxGapSec: null,
      blocksPerMin: null,
      avgExtrinsicsPerBlock:
        n && asc[0].extrinsics_count != null ? asc[0].extrinsics_count : null,
      negativeGaps: 0,
    };
  }
  const gaps = interblockGaps(asc);
  const spanSec = asc[n - 1].timestamp - asc[0].timestamp;
  const negativeGaps = gaps.filter((g) => g < 0).length;
  const sum = gaps.reduce((s, g) => s + g, 0);
  const extr = asc
    .filter((b) => b.extrinsics_count != null)
    .map((b) => b.extrinsics_count);
  return {
    blocks: n,
    spanSec,
    avgGapSec: sum / gaps.length,
    minGapSec: Math.min(...gaps),
    maxGapSec: Math.max(...gaps),
    blocksPerMin: spanSec > 0 ? ((n - 1) / spanSec) * 60 : null,
    avgExtrinsicsPerBlock:
      extr.length ? extr.reduce((s, v) => s + v, 0) / extr.length : null,
    negativeGaps,
  };
}

/**
 * Epoch progress from the overview's `epoch` object: how far through
 * the current Cardano epoch Midnight currently sits. `next_epoch_timestamp`
 * is unix MILLISECONDS; `now` is unix MILLISECONDS (kept separate so the
 * module stays pure/testable).
 * @param {{mainchain_epoch?:number, mainchain_slot?:number, next_epoch_timestamp?:number}} ep
 * @param {number} now unix milliseconds
 * @returns {?{epoch:number, slot:number, pct:number, remainingMin:number}}
 *         null when the indexer did not expose the fields
 */
export function epochProgress(ep, now) {
  if (!ep || ep.next_epoch_timestamp == null) return null;
  const next = ep.next_epoch_timestamp;
  if (now >= next) {
    // past the boundary: the next epoch has flipped; report 100% of the
    // old epoch and zero remaining rather than a negative figure.
    return {
      epoch: ep.mainchain_epoch != null ? ep.mainchain_epoch : null,
      slot: ep.mainchain_slot != null ? ep.mainchain_slot : null,
      pct: 100,
      remainingMin: 0,
    };
  }
  // Without the epoch start we can't compute an exact percentage.
  // Cardano epochs are 5 days; use that as the span when the start is
  // unknown (documented assumption in the UI).
  const spanMs = 5 * 24 * 60 * 60 * 1000;
  const remainingMs = next - now;
  const pct = Math.max(0, Math.min(100, (1 - remainingMs / spanMs) * 100));
  return {
    epoch: ep.mainchain_epoch != null ? ep.mainchain_epoch : null,
    slot: ep.mainchain_slot != null ? ep.mainchain_slot : null,
    pct,
    remainingMin: Math.max(0, Math.round(remainingMs / 60000)),
  };
}

/**
 * Network uptime: days/since-genesis label from the overview.
 * @param {{genesisTime?:number, networkAgeDays?:number}} ov
 * @param {number} now unix seconds
 * @returns {?{ageDays:number}}
 */
export function networkAge(ov, now) {
  if (!ov) return null;
  if (ov.networkAgeDays != null) return { ageDays: ov.networkAgeDays };
  if (ov.genesisTime) return { ageDays: (now - ov.genesisTime) / 86400 };
  return null;
}

/**
 * Block production health score, 0-100. Transparent rubric:
 *   +30  intact chain: no broken hash links in the fetched window
 *   +25  contiguous heights: no gaps in the fetched window
 *   +25  steady cadence: observed avg gap within the expected block
 *         time ± 50% (default expectation: 6s, Midnight's slot time)
 *   +20  fresh tip: the newest block is younger than `freshMaxMin`
 *         minutes relative to `now`
 * @param {{
 *   chainBroken?:number,
 *   gaps?:number,
 *   avgGapSec?:number|null,
 *   negativeGaps?:number,
 *   expectedGapSec?:number,
 *   newestAgeSec?:number,
 *   freshMaxMin?:number
 * }} stats
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function blockHealth(stats) {
  const st = stats || {};
  const expected = st.expectedGapSec || 6;
  const freshMaxSec = (st.freshMaxMin != null ? st.freshMaxMin : 5) * 60;
  const avgOk =
    st.avgGapSec != null &&
    st.avgGapSec >= expected * 0.5 &&
    st.avgGapSec <= expected * 1.5;
  const freshOk = st.newestAgeSec != null && st.newestAgeSec >= 0 && st.newestAgeSec <= freshMaxSec;
  const checks = [
    {
      label: "Intact hash chain (every parent hash verified)",
      pass: Number(st.chainBroken) === 0,
      pts: 30,
    },
    {
      label: "Contiguous block heights (no skipped numbers)",
      pass: Number(st.gaps) === 0,
      pts: 25,
    },
    {
      label: `Steady cadence (avg gap within ${expected}s ± 50%)`,
      pass: avgOk && Number(st.negativeGaps) === 0,
      pts: 25,
    },
    {
      label: `Fresh tip (newest block < ${st.freshMaxMin != null ? st.freshMaxMin : 5} min old)`,
      pass: freshOk,
      pts: 20,
    },
  ];
  const score = checks.reduce((s, c) => s + (c.pass ? c.pts : 0), 0);
  const status =
    score >= 80 ? "healthy" : score >= 50 ? "degraded" : score >= 25 ? "watch" : "critical";
  return { score, status, checks };
}

/**
 * Min-max scale a numeric series to 0..100 for bar charts. A flat
 * series yields all 50 (no divide-by-zero); empty input yields [].
 * @param {number[]} series
 * @returns {number[]}
 */
export function normalize(series) {
  const vals = [...(series || [])];
  if (!vals.length) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  if (!range) return vals.map(() => 50);
  return vals.map((v) => Math.round(((v - min) / range) * 100));
}
