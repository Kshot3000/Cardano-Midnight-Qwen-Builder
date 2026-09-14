"use strict";
/**
 * Privacy Trend Watch — pure metric functions for Midnight's privacy posture.
 *
 * Data source: the public NightForge explorer API (CORS-enabled, no auth):
 *   GET /api/analytics/privacy?hours=N   (N <= 168, default 24)
 *     {
 *       totalMidnightTxs: number,        // Midnight txs in the window
 *       shielded: number,                // of those, shielded
 *       unshielded: number,              // of those, unshielded
 *       contractDeploys: number,
 *       contractCalls: number,
 *       shieldedRatio: number,           // API-reported, ~shielded/total
 *       unshieldedDetails: [{            // every unshielded tx in the window
 *         block: number,                 // Midnight block
 *         address: string,               // JSON payload string:
 *                                        //   {"spent":[{address,tokenType,intentHash,value,outputNo}],
 *                                        //    "created":[...same...]}
 *         tokenType: ?string,            // usually null in practice
 *         value: ?number,                // usually null in practice
 *         timestamp: number              // unix seconds
 *       }],
 *       trend: [{hour, total, unshielded, shielded}],  // hourly, oldest->newest
 *       _hours: number
 *     }
 *   GET /api/analytics/overview  (lifetime context)
 *     { shieldedRatio: number, blocks: number, networkAgeDays: number, ... }
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/**
 * Normalize an hourly trend series to ascending chronological order.
 * Accepts newest-first or oldest-first input; sorts by the hour string
 * ("YYYY-MM-DD HH:MM:SS" is lexicographically sortable).
 * @param {Array<{hour:string, total:number, shielded?:number, unshielded?:number}>} rows
 * @returns {Array}
 */
export function ascending(rows) {
  return [...(rows || [])].sort((a, b) =>
    String(a.hour).localeCompare(String(b.hour))
  );
}

/**
 * Summarize a /api/analytics/privacy payload: counts, the recomputed
 * shielded ratio (independent of the API-reported one), the delta between
 * the two (data-integrity check), hourly activity stats, and the
 * chronologically-sorted trend series.
 * @param {object} p  privacy payload
 * @returns {{total:number, shielded:number, unshielded:number,
 *            contractCalls:number, contractDeploys:number,
 *            ratio:?number, reportedRatio:?number, ratioDelta:?number,
 *            hours:number, avgPerHour:number, peakHour:number,
 *            peakHourLabel:?string, trend:Array}}
 */
export function summarizePrivacy(p) {
  const d = p || {};
  const total = Number(d.totalMidnightTxs) || 0;
  const shielded = Number(d.shielded) || 0;
  const unshielded = Number(d.unshielded) || 0;
  const ratio = total ? shielded / total : null;
  const reportedRatio =
    d.shieldedRatio != null && Number.isFinite(Number(d.shieldedRatio))
      ? Number(d.shieldedRatio)
      : null;
  const trend = ascending(d.trend);
  const totals = trend.map((r) => Number(r.total) || 0);
  let peakHour = 0;
  let peakHourLabel = null;
  trend.forEach((r, i) => {
    if (totals[i] > peakHour) {
      peakHour = totals[i];
      peakHourLabel = r.hour;
    }
  });
  return {
    total,
    shielded,
    unshielded,
    contractCalls: Number(d.contractCalls) || 0,
    contractDeploys: Number(d.contractDeploys) || 0,
    ratio,
    reportedRatio,
    ratioDelta: ratio != null && reportedRatio != null ? ratio - reportedRatio : null,
    hours: trend.length,
    avgPerHour: trend.length ? total / trend.length : 0,
    peakHour,
    peakHourLabel,
    trend,
  };
}

/**
 * Activity growth: percent change of the most recent `windowHours` hourly
 * buckets vs the `windowHours` immediately before them (based on total txs).
 * Returns null when there is not twice the window of history, or the earlier
 * window is empty — a dashboard must never show a fake 0%.
 * @param {Array<{hour:string, total:number}>} trend
 * @param {number} [windowHours]
 * @returns {?{pct:number, last:number, prev:number, windowHours:number}}
 */
export function trendGrowth(trend, windowHours) {
  const a = ascending(trend);
  if (windowHours == null || windowHours <= 0) return null;
  if (a.length < windowHours * 2) return null;
  const last = a
    .slice(-windowHours)
    .reduce((s, r) => s + (Number(r.total) || 0), 0);
  const prev = a
    .slice(-windowHours * 2, -windowHours)
    .reduce((s, r) => s + (Number(r.total) || 0), 0);
  if (!prev) return null;
  return {
    pct: ((last - prev) / prev) * 100,
    last,
    prev,
    windowHours,
  };
}

/**
 * Parse one unshielded-tx payload. NightForge ships the per-tx detail as a
 * JSON *string* in `address` with the shape
 *   {"spent":[{"address","tokenType","intentHash","value","outputNo"}],
 *    "created":[...]}
 * Accepts the string, an already-parsed object, or null/garbage.
 * @param {string|object|null} raw
 * @returns {?{spent:Array, created:Array, spentValue:number, createdValue:number,
 *             uniqueTokens:number, uniqueAddresses:number, tokenTypes:string[]}}
 *          null when the payload is absent or malformed
 */
export function parseIncidentPayload(raw) {
  let obj = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  } else if (raw && typeof raw === "object") {
    obj = raw;
  }
  if (!obj || !Array.isArray(obj.spent) || !Array.isArray(obj.created)) {
    return null;
  }
  const norm = (e) => {
    const x = e || {};
    return {
      address: x.address != null ? String(x.address) : null,
      tokenType: x.tokenType != null ? String(x.tokenType) : null,
      value: Number(x.value) || 0,
      outputNo: x.outputNo != null ? x.outputNo : null,
    };
  };
  const spent = obj.spent.map(norm);
  const created = obj.created.map(norm);
  const all = spent.concat(created);
  const tokens = new Set(all.map((e) => e.tokenType).filter(Boolean));
  const addrs = new Set(all.map((e) => e.address).filter(Boolean));
  return {
    spent,
    created,
    spentValue: spent.reduce((s, e) => s + e.value, 0),
    createdValue: created.reduce((s, e) => s + e.value, 0),
    uniqueTokens: tokens.size,
    uniqueAddresses: addrs.size,
    tokenTypes: [...tokens],
  };
}

/**
 * Parse the unshieldedDetails list into deduped incident rows, sorted
 * newest first (by timestamp, then block). NightForge is known to emit the
 * same tx twice in the list, so dedupe on (block, payload) is mandatory.
 * @param {Array<{block:number, address:string, timestamp:number, tokenType:?string, value:?number}>} details
 * @returns {{incidents:Array, count:number, uniqueBlocks:number, uniqueTokens:number,
 *            latestTimestamp:?number, totalValue:number}}
 */
export function parseIncidents(details) {
  const seen = new Set();
  const rows = [];
  for (const d of details || []) {
    const key = `${d.block}|${d.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      block: d.block != null ? Number(d.block) : null,
      timestamp: d.timestamp != null ? Number(d.timestamp) : null,
      payload: parseIncidentPayload(d.address),
    });
  }
  rows.sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0) || (b.block || 0) - (a.block || 0)
  );
  const blocks = new Set(rows.map((r) => r.block).filter((b) => b != null));
  const tokens = new Set();
  rows.forEach((r) => {
    if (r.payload) r.payload.tokenTypes.forEach((t) => tokens.add(t));
  });
  const totalValue = rows.reduce(
    (s, r) => s + ((r.payload && r.payload.spentValue + r.payload.createdValue) || 0),
    0
  );
  return {
    incidents: rows,
    count: rows.length,
    uniqueBlocks: blocks.size,
    uniqueTokens: tokens.size,
    latestTimestamp: rows.length ? rows[0].timestamp : null,
    totalValue,
  };
}

/**
 * Privacy health score, 0-100. Transparent rubric — five named checks on
 * one trailing window of Midnight transactions:
 *   +35  shielding dominant:  recomputed shielded/total >= 95%
 *   +20  sustained activity:  >= 100 Midnight txs in the window
 *   +20  stable flow:         last-half vs first-half tx growth within +/-25%
 *        (fails when there is not twice the half-window of history)
 *   +15  unshielded rare:     unshielded <= 1% of txs
 *   +10  self-consistent:     |recomputed ratio - API-reported ratio| <= 0.5pp
 * @param {{total?:number, ratio?:?number, unshielded?:number,
 *          ratioDelta?:?number, growth?:{pct:number}|null}} s
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function privacyHealth(s) {
  const st = s || {};
  const total = Number(st.total) || 0;
  const ratio = st.ratio != null && Number.isFinite(Number(st.ratio)) ? Number(st.ratio) : null;
  const unshieldedPct = total ? (Number(st.unshielded) || 0) / total : 0;
  const growth =
    st.growth && Number.isFinite(st.growth.pct) ? st.growth.pct : null;
  const integrity =
    st.ratioDelta != null && Number.isFinite(Number(st.ratioDelta))
      ? Math.abs(Number(st.ratioDelta)) <= 0.005
      : false;
  const checks = [
    {
      label: "Shielding dominant (≥ 95% of window tx)",
      pass: ratio != null && ratio >= 0.95,
      pts: 35,
    },
    {
      label: "Sustained activity (≥ 100 tx in window)",
      pass: total >= 100,
      pts: 20,
    },
    {
      label: "Stable flow (second half vs first half within ±25%)",
      pass: growth != null && Math.abs(growth) <= 25,
      pts: 20,
    },
    {
      label: "Unshielded rare (≤ 1% of tx)",
      pass: unshieldedPct <= 0.01,
      pts: 15,
    },
    {
      label: "Self-consistent (recomputed ratio ≈ API-reported, ±0.5pp)",
      pass: integrity,
      pts: 10,
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
 * @param {number} timestamp unix seconds
 * @param {number} now unix seconds
 * @returns {string}
 */
export function ageLabel(timestamp, now) {
  if (!timestamp) return "—";
  const sec = Math.max(0, Math.floor(now - timestamp));
  if (sec < 90) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Min-max scale a numeric series to 0..100 for bar-chart heights. A flat
 * series yields all 50 (no divide-by-zero); empty input yields [].
 * @param {number[]} vals
 * @returns {number[]}
 */
export function normalize(vals) {
  const v = (vals || []).map((x) => Number(x) || 0);
  if (!v.length) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min;
  if (!range) return v.map(() => 50);
  return v.map((x) => Math.round(((x - min) / range) * 100));
}
