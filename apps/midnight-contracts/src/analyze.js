// Midnight contract-ecosystem analytics — pure functions, unit-testable.
//
// Input shapes come from the public NightForge explorer:
//   GET /api/analytics/contracts  -> { totalContracts, totalCalls, topContracts:[...], deploymentsPerDay:[...] }
//     topContracts rows: { address, txHash, interactions, firstSeen, lastSeen, block }
//     deploymentsPerDay rows: { day: "YYYY-MM-DD", count }  (newest first)
//   GET /api/contracts/deployed   -> { total, contracts:[...] }
//     rows: { address, txHash, block, blockHash, timestamp }   (newest first, has duplicates)
//
// Every function tolerates null/undefined/empty and never throws on bad
// shapes. Timestamps are Unix seconds.
import { isValidContractAddress } from "./address.js";

export const DAY = 86_400;
export const ACTIVE_WINDOW_DAYS = 7;   // lastSeen within 7 days  -> active
export const DORMANT_WINDOW_DAYS = 90; // within 90 days          -> dormant, else abandoned

export function safeInt(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "string" && x.trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Clamp + round a 0..1 fraction to a percentage number (0..100). */
export function toPct(fraction, digits = 1) {
  const f = Number(fraction);
  if (!Number.isFinite(f)) return null;
  const clamped = Math.min(1, Math.max(0, f));
  return Number((clamped * 100).toFixed(digits));
}

/**
 * Classify one contract's current activity state.
 * @param {{interactions?:number,lastSeen?:number}} row
 * @param {number} nowSec
 * @returns {'never-called'|'active'|'dormant'|'abandoned'}
 */
export function activityClass(row, nowSec) {
  if (!row || typeof row !== "object") return "abandoned";
  const inter = safeInt(row.interactions);
  const last = safeInt(row.lastSeen);
  if (inter === 0 || inter == null) return "never-called";
  if (last == null) return "abandoned";
  const ageDays = (nowSec - last) / DAY;
  if (ageDays <= 0) return "active";
  if (ageDays <= ACTIVE_WINDOW_DAYS) return "active";
  if (ageDays <= DORMANT_WINDOW_DAYS) return "dormant";
  return "abandoned";
}

/**
 * Tally activity classes across the leaderboard.
 * @param {Array} rows topContracts rows
 * @param {number} nowSec
 * @returns {{active:number,dormant:number,abandoned:number,neverCalled:number,total:number}}
 */
export function tallyActivity(rows, nowSec) {
  const t = { active: 0, dormant: 0, abandoned: 0, neverCalled: 0, total: 0 };
  if (!Array.isArray(rows)) return t;
  for (const r of rows) {
    t.total++;
    switch (activityClass(r, nowSec)) {
      case "active": t.active++; break;
      case "dormant": t.dormant++; break;
      case "abandoned": t.abandoned++; break;
      case "never-called": t.neverCalled++; break;
    }
  }
  return t;
}

/**
 * Interaction concentration (how much call volume the top N capture).
 * @param {Array} rows topContracts rows (any order)
 * @param {number} n
 * @returns {{topNShare:number|null, top1Share:number|null, top3Share:number|null,
 *            totalInteractions:number, n:number}}
 */
export function concentration(rows, n = 10) {
  const out = { topNShare: null, top1Share: null, top3Share: null, totalInteractions: 0, n };
  if (!Array.isArray(rows) || rows.length === 0) return out;
  const values = rows
    .map((r) => safeInt(r && r.interactions))
    .filter((v) => v != null && v >= 0)
    .sort((a, b) => b - a);
  const total = values.reduce((s, v) => s + v, 0);
  out.totalInteractions = total;
  if (total <= 0) return out; // no calls at all — no meaningful share
  const topN = Math.min(n, values.length);
  out.topNShare = values.slice(0, topN).reduce((s, v) => s + v, 0) / total;
  out.top1Share = (values[0] || 0) / total;
  out.top3Share = values.slice(0, 3).reduce((s, v) => s + v, 0) / total;
  return out;
}

/**
 * Interaction statistics: count/total/average + optional min/max.
 * @param {Array} rows
 * @returns {{count:number,total:number,average:number|null,min:number|null,max:number|null}}
 */
export function interactionStats(rows) {
  const out = { count: 0, total: 0, average: null, min: null, max: null };
  if (!Array.isArray(rows)) return out;
  let sum = 0;
  let mn = null;
  let mx = null;
  for (const r of rows) {
    const v = safeInt(r && r.interactions);
    if (v == null || v < 0) continue;
    out.count++;
    sum += v;
    mn = mn == null ? v : Math.min(mn, v);
    mx = mx == null ? v : Math.max(mx, v);
  }
  out.total = sum;
  if (out.count > 0) {
    out.average = sum / out.count;
    out.min = mn;
    out.max = mx;
  }
  return out;
}

/**
 * Deployment trend over the trailing window.
 * @param {Array} daily deploymentsPerDay rows {day, count}
 * @param {number} windowDays trailing window for the growth comparison
 * @returns {{total:number, days:number, average:number|null, windowDays:number,
 *            last:number|null, prev:number|null, growthPct:number|null,
 *            peakDay:string|null, peakCount:number|null}}
 */
export function deploymentTrend(daily, windowDays = 7) {
  const out = {
    total: 0, days: 0, average: null, windowDays,
    last: null, prev: null, growthPct: null, peakDay: null, peakCount: null,
  };
  if (!Array.isArray(daily) || daily.length === 0) return out;
  const vals = daily
    .map((d) => ({ day: d && d.day, count: safeInt(d && d.count) }))
    .filter((d) => d.count != null && d.count >= 0);
  if (vals.length === 0) return out;
  out.days = vals.length;
  for (const v of vals) {
    out.total += v.count;
    if (out.peakCount == null || v.count > out.peakCount) {
      out.peakCount = v.count;
      out.peakDay = v.day;
    }
  }
  out.average = out.total / vals.length;
  if (vals.length >= windowDays) {
    const last = vals.slice(0, windowDays).reduce((s, v) => s + v.count, 0);
    const prev = vals.slice(windowDays, windowDays * 2).reduce((s, v) => s + v.count, 0);
    out.last = last;
    out.prev = prev;
    if (prev > 0) out.growthPct = ((last - prev) / prev) * 100;
    // else growthPct stays null — no baseline, refuse to invent a number
  }
  return out;
}

/**
 * Deduplicate a deployed-contract event list. The explorer repeats each
 * deployment once per observed event, so we collapse by (txHash, block).
 * @param {Array} rows /api/contracts/deployed rows
 * @returns {{raw:number, unique:number, duplicates:number, uniqueAddresses:number,
 *            firstDeploy:{ts:number|null,block:number|null},
 *            lastDeploy:{ts:number|null,block:number|null},
 *            spanDays:number|null}}
 */
export function dedupeDeployed(rows) {
  const out = {
    raw: 0, unique: 0, duplicates: 0, uniqueAddresses: 0,
    firstDeploy: { ts: null, block: null },
    lastDeploy: { ts: null, block: null },
    spanDays: null,
  };
  if (!Array.isArray(rows)) return out;
  const seen = new Set();
  const addrs = new Set();
  let minTs = null;
  let maxTs = null;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    out.raw++;
    const addr = r.address;
    if (typeof addr === "string" && addr.length) addrs.add(addr);
    const key = `${r.txHash ?? ""}|${r.block ?? ""}`;
    if (seen.has(key)) {
      out.duplicates++;
      continue;
    }
    seen.add(key);
    out.unique++;
    const ts = safeInt(r.timestamp);
    const block = safeInt(r.block);
    if (ts != null) {
      if (minTs == null || ts < minTs) {
        minTs = ts;
        out.firstDeploy.ts = ts;
        out.firstDeploy.block = block;
      }
      if (maxTs == null || ts > maxTs) {
        maxTs = ts;
        out.lastDeploy.ts = ts;
        out.lastDeploy.block = block;
      }
    }
  }
  out.uniqueAddresses = addrs.size;
  if (minTs != null && maxTs != null && maxTs > minTs) {
    out.spanDays = (maxTs - minTs) / DAY;
  }
  return out;
}

/**
 * Cross-check the leaderboard against the deployed-events endpoint.
 * @param {number} totalContracts /api/analytics/contracts total
 * @param {number} deployedUnique dedupeDeployed().unique
 * @returns {{leaderboard:number, deployed:number, delta:number|null,
 *            note:string}}
 */
export function coverageCheck(totalContracts, deployedUnique) {
  const a = safeInt(totalContracts);
  const b = safeInt(deployedUnique);
  const note =
    a != null && b != null && a === b
      ? "leaderboard and deployed-events agree — every indexed contract has a deploy event"
      : a != null && b != null
        ? b > a
          ? "deployed-events list more unique contracts than the leaderboard — the leaderboard is capped or lagging"
          : "leaderboard lists more contracts than deploy events found — some deploys predate event indexing"
        : "insufficient data to cross-check";
  return {
    leaderboard: a,
    deployed: b,
    delta: a != null && b != null ? a - b : null,
    note,
  };
}

/**
 * Address sanity across the leaderboard — how many rows carry a canonical
 * Midnight contract address vs malformed/other formats.
 * @param {Array} rows
 * @returns {{total:number, valid:number, invalid:number}}
 */
export function addressSanity(rows) {
  const out = { total: 0, valid: 0, invalid: 0 };
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    out.total++;
    const a = r && r.address;
    if (typeof a === "string" && isValidContractAddress(a)) out.valid++;
    else out.invalid++;
  }
  return out;
}
