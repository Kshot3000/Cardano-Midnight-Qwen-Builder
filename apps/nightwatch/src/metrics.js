"use strict";
/**
 * Nightwatch — metric functions for privacy-network health.
 *
 * Pure functions over the NightForge /api/analytics/* payloads, so the
 * dashboard logic is unit-testable without a network. Zero deps.
 *
 * "hourlyActivity" arrives as newest-first [{hour, txs}, ...]. All functions
 * here normalize to ascending (oldest -> newest) internally.
 */

/**
 * Normalize an hourly activity series to ascending chronological order.
 * Accepts newest-first or oldest-first input; sorts by the hour string
 * (format "YYYY-MM-DD HH:MM:SS" is lexicographically sortable).
 * @param {Array<{hour:string, txs:number}>} series
 * @returns {Array<{hour:string, txs:number}>}
 */
export function ascending(series) {
  return [...(series || [])].sort((a, b) =>
    String(a.hour).localeCompare(String(b.hour))
  );
}

/** Last `n` hours of an ascending series (tail). */
export function tail(series, n) {
  const a = ascending(series);
  return a.slice(Math.max(0, a.length - n));
}

/**
 * Summarize activity: totals, averages, and the 24h / 48h windows used for
 * the "transaction growth" dashboard tile.
 * @param {Array<{hour:string, txs:number}>} series
 * @returns {{total:number, avgPerHour:number, last24:{total:number, avg:number}, last48:{total:number, avg:number}, hours:number}}
 */
export function summarizeActivity(series) {
  const a = ascending(series);
  const hours = a.length;
  const total = a.reduce((s, r) => s + (Number(r.txs) || 0), 0);
  const avgPerHour = hours ? total / hours : 0;
  const last24 = tail(a, 24);
  const l24 = last24.reduce((s, r) => s + (Number(r.txs) || 0), 0);
  const last48 = tail(a, 48);
  const l48 = last48.reduce((s, r) => s + (Number(r.txs) || 0), 0);
  return {
    total,
    avgPerHour,
    last24: { total: l24, avg: last24.length ? l24 / last24.length : 0 },
    last48: { total: l48, avg: last48.length ? l48 / last48.length : 0 },
    hours,
  };
}

/**
 * Transaction growth: percent change of the last 24h volume vs. the 24h
 * immediately before it. Returns null when the earlier window has no data
 * (too little history) — a dashboard must never show a fake 0%.
 * @param {Array<{hour:string, txs:number}>} series
 * @returns {?{pct:number, last24:number, prev24:number}}
 */
export function transactionGrowth(series) {
  const a = ascending(series);
  if (a.length < 48) return null;
  const last24 = a.slice(-24).reduce((s, r) => s + (Number(r.txs) || 0), 0);
  const prev24 = a.slice(-48, -24).reduce((s, r) => s + (Number(r.txs) || 0), 0);
  if (!prev24) return null;
  return { pct: ((last24 - prev24) / prev24) * 100, last24, prev24 };
}

/**
 * DUST consumption view: every Midnight transaction burns DUST as a fee, so
 * the per-hour tx count IS the DUST burn rate. Returns the series plus
 * aggregate burn figures.
 * @param {Array<{hour:string, txs:number}>} series
 * @param {number} [totalTransactions] lifetime tx count from /api/analytics/dust
 * @returns {{series:Array, lifetimeTxs:number, last24Txs:number, avgPerHour:number}}
 */
export function dustBurn(series, totalTransactions) {
  const s = summarizeActivity(series);
  return {
    series: ascending(series),
    lifetimeTxs: totalTransactions || 0,
    last24Txs: s.last24.total,
    avgPerHour: s.last24.avg,
  };
}

/**
 * Network health score, 0-100. Transparent rubric (this is the "boring,
 * standardized dashboard" promise — no vibes):
 *   +35  TPS above the 0.2 floor (steady block production)
 *   +25  activity stable: 24h growth within +/-25% of prior 24h
 *   +25  24h volume present (avg >= 50 tx/hour)
 *   +15  API reported a shielded ratio (ZK layer active, 0 < r < 1)
 * @param {{tps?:number, shieldedRatio?:number, growth?:{pct:number}|null}} stats
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function healthScore(stats) {
  const st = stats || {};
  const growth = st.growth && Number.isFinite(st.growth.pct) ? st.growth.pct : null;
  const checks = [
    {
      label: "Block production steady (TPS > 0.2)",
      pass: Number(st.tps) > 0.2,
      pts: 35,
    },
    {
      label: "Activity stable (24h growth within ±25%)",
      pass: growth != null && Math.abs(growth) <= 25,
      pts: 25,
    },
    {
      label: "Sustained volume (avg ≥ 50 tx/hour)",
      pass: Number(st.avgPerHour) >= 50,
      pts: 25,
    },
    {
      label: "ZK shielded layer active",
      pass: Number(st.shieldedRatio) > 0 && Number(st.shieldedRatio) < 1,
      pts: 15,
    },
  ];
  const score = checks.reduce((s, c) => s + (c.pass ? c.pts : 0), 0);
  const status =
    score >= 80 ? "healthy" : score >= 50 ? "degraded" : score >= 25 ? "watch" : "critical";
  return { score, status, checks };
}

/**
 * Sparkline values for a bar chart: min-max scaled 0..100, ascending order.
 * @param {Array<{hour:string, txs:number}>} series
 * @returns {number[]}
 */
export function sparkline(series) {
  const a = ascending(series).map((r) => Number(r.txs) || 0);
  if (!a.length) return [];
  const min = Math.min(...a);
  const max = Math.max(...a);
  const range = max - min || 1;
  return a.map((v) => Math.round(((v - min) / range) * 100));
}

/**
 * Which of the four standardized privacy-chain metrics are currently
 * computable from public data. This is honest disclosure: the dashboard
 * ships with the data the indexer has, and labels the rest as pending.
 * @param {{hasActivity?:boolean, hasAddresses?:boolean, hasDust?:boolean, hasRetention?:boolean}} caps
 * @returns {Array<{key:string, name:string, status:string}>}
 */
export function standardizedMetrics(caps) {
  const c = caps || {};
  return [
    {
      key: "activity",
      name: "Transaction activity & 24h/48h growth",
      status: c.hasActivity ? "live" : "pending",
    },
    {
      key: "dust",
      name: "DUST consumption (tx burn rate)",
      status: c.hasDust ? "live" : "pending",
    },
    {
      key: "addresses",
      name: "Active address count",
      status: c.hasAddresses ? "live" : "pending",
    },
    {
      key: "retention",
      name: "30/90-day address retention",
      status: c.hasRetention ? "live" : "pending",
    },
  ];
}
