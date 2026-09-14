"use strict";
/**
 * Bridge Watch — pure metric functions for the Cardano <-> Midnight bridge.
 *
 * Data source: the public NightForge explorer API (CORS-enabled, no auth):
 *   GET /api/analytics/bridge
 *     {
 *       totalBridgeOps: number,          // lifetime
 *       last24h: number,                 // bridge ops in the trailing 24h
 *       trend: [{hour, count}],          // ~24 hourly buckets, NEWEST FIRST
 *       recentBridgeOps: [{
 *         hash: string,                  // Midnight extrinsic hash (0x…)
 *         block_height: number,          // Midnight block
 *         timestamp: number,             // unix seconds
 *         args_summary: string           // "Cardano block #13937696 (0xa4d191fd95859e...)"
 *       }]
 *     }
 *   GET /api/analytics/overview  (Cardano mainchain context)
 *     { epoch: { mainchain_epoch, mainchain_slot, next_epoch_timestamp } }
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/**
 * Normalize an hourly trend series to ascending chronological order.
 * Accepts newest-first or oldest-first input; sorts by the hour string
 * ("YYYY-MM-DD HH:MM:SS" is lexicographically sortable).
 * @param {Array<{hour:string, count:number}>} rows
 * @returns {Array<{hour:string, count:number}>}
 */
export function ascending(rows) {
  return [...(rows || [])].sort((a, b) =>
    String(a.hour).localeCompare(String(b.hour))
  );
}

/**
 * Summarize a bridge-op trend series: totals, average rate, max/min hour.
 * @param {Array<{hour:string, count:number}>} trend
 * @returns {{series:Array, total:number, hours:number, avgPerHour:number, max:number, min:number}}
 */
export function summarizeTrend(trend) {
  const series = ascending(trend);
  const counts = series.map((r) => Number(r.count) || 0);
  const total = counts.reduce((s, v) => s + v, 0);
  const hours = series.length;
  return {
    series,
    total,
    hours,
    avgPerHour: hours ? total / hours : 0,
    max: hours ? Math.max(...counts) : 0,
    min: hours ? Math.min(...counts) : 0,
  };
}

/**
 * Trend growth: percent change of the most recent `windowHours` bucket
 * vs the `windowHours` immediately before it. Returns null when there is
 * not twice the window of history, or the earlier window is empty —
 * a dashboard must never show a fake 0%.
 * @param {Array<{hour:string, count:number}>} trend
 * @param {number} [windowHours=12]
 * @returns {?{pct:number, last:number, prev:number, windowHours:number}}
 */
export function trendGrowth(trend, windowHours = 12) {
  const a = ascending(trend);
  if (windowHours <= 0) return null;
  if (a.length < windowHours * 2) return null;
  const last = a
    .slice(-windowHours)
    .reduce((s, r) => s + (Number(r.count) || 0), 0);
  const prev = a
    .slice(-windowHours * 2, -windowHours)
    .reduce((s, r) => s + (Number(r.count) || 0), 0);
  if (!prev) return null;
  return {
    pct: ((last - prev) / prev) * 100,
    last,
    prev,
    windowHours,
  };
}

/**
 * Extract the referenced Cardano block number from a bridge-op
 * args_summary like "Cardano block #13937696 (0xa4d191fd95859e...)".
 * @param {string} argsSummary
 * @returns {?number} null when no "Cardano block #N" is present
 */
export function parseCardanoBlock(argsSummary) {
  const m = /Cardano block #(\d+)/.exec(String(argsSummary || ""));
  return m ? Number(m[1]) : null;
}

/**
 * Parse the recentBridgeOps list into a compact view with Cardano block
 * references extracted, unique-block count, and newest/oldest references.
 * @param {Array<{hash:string, block_height:number, timestamp:number, args_summary:string}>} recent
 * @returns {{ops:Array, uniqueBlockCount:number, newestCardanoBlock:?number, oldestCardanoBlock:?number}}
 */
export function parseRecentOps(recent) {
  const ops = (recent || []).map((op) => ({
    hash: op.hash,
    midnightBlock: op.block_height,
    timestamp: op.timestamp,
    cardanoBlock: parseCardanoBlock(op.args_summary),
  }));
  const blocks = ops.map((o) => o.cardanoBlock).filter((n) => n != null);
  const unique = new Set(blocks);
  return {
    ops,
    uniqueBlockCount: unique.size,
    newestCardanoBlock: blocks.length ? Math.max(...blocks) : null,
    oldestCardanoBlock: blocks.length ? Math.min(...blocks) : null,
  };
}

/**
 * Bridge ops observed per unique Cardano block in the recent window
 * (the bridge confirms each Cardano block; several bridge ops can
 * reference the same block). Null when no Cardano block is referenced.
 * @param {{ops:Array, uniqueBlockCount:number}} parsed
 * @returns {?number}
 */
export function opsPerBlock(parsed) {
  const p = parsed || {};
  if (!p.uniqueBlockCount) return null;
  return (p.ops.length || 0) / p.uniqueBlockCount;
}

/**
 * Human "N ago" label for a unix-seconds timestamp, relative to `now`
 * (unix seconds). Future/clamped input renders as "now" — never a
 * negative age.
 * @param {number} timestamp unix seconds
 * @param {number} now unix seconds
 * @returns {string}
 */
export function ageLabel(timestamp, now) {
  if (!timestamp) return "—";
  // `now` and `timestamp` are both unix seconds, so the delta is seconds.
  const sec = Math.max(0, Math.floor(now - timestamp));
  if (sec < 90) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Bridge health score, 0-100. Transparent rubric — the same "boring,
 * standardized dashboard" promise Nightwatch makes, applied to the
 * Cardano <-> Midnight bridge:
 *   +30  steady flow: avg >= 50 bridge ops/hour
 *   +30  sustained volume: >= 1,000 ops in the trailing 24h
 *   +25  stable trend: 12h-vs-12h growth within +/-25%
 *   +15  fresh observations: recent bridge ops are being confirmed
 * @param {{avgPerHour?:number, last24Total?:number, growth?:{pct:number}|null, hasRecent?:boolean}} stats
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function bridgeHealth(stats) {
  const st = stats || {};
  const growth = st.growth && Number.isFinite(st.growth.pct) ? st.growth.pct : null;
  const checks = [
    {
      label: "Steady flow (≥ 50 bridge ops/hour)",
      pass: Number(st.avgPerHour) >= 50,
      pts: 30,
    },
    {
      label: "Sustained volume (≥ 1,000 ops / 24h)",
      pass: Number(st.last24Total) >= 1000,
      pts: 30,
    },
    {
      label: "Stable trend (12h vs 12h within ±25%)",
      pass: growth != null && Math.abs(growth) <= 25,
      pts: 25,
    },
    {
      label: "Fresh observations (recent ops confirmed)",
      pass: Boolean(st.hasRecent),
      pts: 15,
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
 * @param {Array<{count:number}>|number[]} series
 * @returns {number[]}
 */
export function normalize(series) {
  const vals = (series || []).map((r) =>
    typeof r === "number" ? r : Number(r.count) || 0
  );
  if (!vals.length) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  if (!range) return vals.map(() => 50);
  return vals.map((v) => Math.round(((v - min) / range) * 100));
}
