// Glacier Drop checker — pure thaw-schedule engine.
//
// Replicates the exact arithmetic of the official Midnight Glacier Drop
// redemption contract (mgdoc `ThawingSchedule.hs`, midnightntwrk/
// night-token-distribution) in portable integer milliseconds:
//
//   * Each destination address is assigned a pseudo-random "jitter stratum"
//     (derived from claim-signature bytes) which sets its FIRST-UNLOCK date
//     somewhere in the first 90-day window (2025-12-10 … 2026-03-09).
//   * The allocation then thaws in `INCREMENT_COUNT` (4) installments, every
//     90 days: the first 3 release floor(total/count) STARs each; the last
//     release the remainder, so the amounts sum EXACTLY to the total
//     (contract comment: "the last thawing can be a little bit bigger
//     because it includes the remainder").
//
// Amounts are in STARs: 1 NIGHT = 1,000,000 STAR (the token's 6 decimals).
//
// The per-address first-unlock date is NOT derivable without the claim
// signature — so the UI takes the date shown in the official portal as
// input and the schedule is fully determined from it.
//
// All math is pure and deterministic (no Date.now() here) so it is fully
// unit-testable.

export const NIGHT_DECIMALS = 6;
export const STAR_PER_NIGHT = 10 ** NIGHT_DECIMALS;

// ── Official timeline (all UTC midnight) ─────────────────────────────────
const DAY_MS = 86_400_000;
export const dayMs = (iso) => Date.parse(iso + "T00:00:00Z");

export const TIMELINE = {
  snapshot:      dayMs("2025-06-11"), // eligibility snapshot
  claimStart:    dayMs("2025-08-05"), // 13:00 UTC, but day-granularity is fine
  claimEnd:      dayMs("2025-10-20"), // Glacier Drop claim closed
  scavengerStart: dayMs("2025-10-29"),
  scavengerEnd:   dayMs("2025-11-19"),
  tokenMint:     dayMs("2025-10-24"), // 24B NIGHT minted on Cardano mainnet
  mainnetLaunch: dayMs("2026-03-30"), // Midnight mainnet live
  thawStart:     dayMs("2025-12-10"),
  thawEnd:       dayMs("2026-12-04"), // last day the 4th installment is reachable
};

// Per-address parameters (from the contract's NightProtocolParams datum)
export const INCREMENT_COUNT = 4;        // four 25% installments
export const INCREMENT_PERIOD_MS = 90 * DAY_MS; // 90 days between thaws
export const JITTER_WINDOW_MS = 90 * DAY_MS;    // random first-unlock window

// NIGHT as a Cardano Native Asset (policy / hex asset name).
export const NIGHT_TOKEN = {
  policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  assetNameHex: "4e49474854", // "NIGHT"
  decimals: 6,
  totalSupplyStar: 24_000_000_000 * STAR_PER_NIGHT,
};

// ── Schedule math (mirrors incrementalSchedule) ───────────────────────────
/**
 * The four installment (dateMs, amountStar) pairs for an allocation whose
 * first unlock is `firstUnlockMs`.
 *
 * Mirrors:
 *   zip (initialTime + n*incrementPeriod, n in 0..count-2 × quotient)
 *     <> [(initialTime + (count-1)*period, total - (count-1)*quotient)]
 */
export function thawSchedule(totalStar, firstUnlockMs) {
  if (!Number.isInteger(totalStar) || totalStar < 0)
    throw new Error("totalStar must be a non-negative integer");
  if (!Number.isInteger(firstUnlockMs))
    throw new Error("firstUnlockMs must be an integer millisecond timestamp");

  const count = INCREMENT_COUNT;
  const quotient = Math.floor(totalStar / count);
  const rows = [];
  for (let n = 0; n < count - 1; n++) {
    rows.push({ index: n + 1, dateMs: firstUnlockMs + n * INCREMENT_PERIOD_MS, amountStar: quotient });
  }
  rows.push({
    index: count,
    dateMs: firstUnlockMs + (count - 1) * INCREMENT_PERIOD_MS,
    amountStar: totalStar - (count - 1) * quotient,
  });
  return rows;
}

/**
 * Thaw status at time `nowMs` (ms since epoch).
 *
 * Mirrors reduceThawingSchedule: thawed = number of unlock times <= now.
 * Returns:
 *   unlocked        — installments released so far (0..4)
 *   unlockedStar    — STAR available to redeem now
 *   lockedStar      — remainder still frozen
 *   next            — next installment row, or null when fully thawed
 *   fullyThawed     — all 4 released
 */
export function thawStatus(totalStar, firstUnlockMs, nowMs) {
  if (totalStar < 0) throw new Error("totalStar must be non-negative");
  const schedule = thawSchedule(totalStar, firstUnlockMs);
  let unlocked = 0;
  let unlockedStar = 0;
  for (const row of schedule) {
    if (nowMs >= row.dateMs) {
      unlocked++;
      unlockedStar += row.amountStar;
    } else break;
  }
  const fullyThawed = unlocked >= schedule.length;
  return {
    unlocked,
    unlockedStar,
    lockedStar: totalStar - unlockedStar,
    next: fullyThawed ? null : schedule[unlocked],
    fullyThawed,
    schedule,
  };
}

/**
 * Network-wide thaw progress for the redemption period as a fraction 0..1:
 * linear across the 360-day window (the aggregate unlocks linearly because
 * strata are uniformly distributed).
 */
export function thawProgress(nowMs) {
  const { thawStart, thawEnd } = TIMELINE;
  const span = thawEnd - thawStart;
  if (nowMs <= thawStart) return 0;
  if (nowMs >= thawEnd) return 1;
  return (nowMs - thawStart) / span;
}

/** Whole days (UTC) until `targetMs`, negative if in the past. */
export function daysUntil(targetMs, nowMs) {
  return Math.floor((targetMs - nowMs) / DAY_MS);
}

/** Whole days (UTC) between two timestamps (b - a). */
export function daysBetween(aMs, bMs) {
  return Math.round((bMs - aMs) / DAY_MS);
}

/**
 * "Day N of 360" for a thaw/unlock timestamp (day 1 = thawStart, inclusive).
 * Negative for dates before the thaw period, > 360 after it ends.
 */
export function thawDayOf360(ms) {
  return Math.floor((ms - TIMELINE.thawStart) / DAY_MS) + 1;
}

/** Date (ms, UTC midnight) of thaw day `n` (1-based). */
export function thawDateForDay(n) {
  return TIMELINE.thawStart + (n - 1) * DAY_MS;
}

/**
 * Full checker input for an allocation: given the total (STAR) and the first
 * thaw day (1..90, as shown in the official claim portal), returns the
 * schedule, current status at `nowMs`, and helper numbers.
 */
export function allocationStatus(totalStar, firstThawDay, nowMs) {
  if (!Number.isInteger(firstThawDay) || firstThawDay < 1 || firstThawDay > 90)
    throw new Error("firstThawDay must be an integer 1..90");
  const firstUnlockMs = thawDateForDay(firstThawDay);
  const schedule = thawSchedule(totalStar, firstUnlockMs);
  const status = thawStatus(totalStar, firstUnlockMs, nowMs);
  return {
    firstUnlockMs,
    ...status,
    dayOfTotal: 90 * INCREMENT_COUNT,
    lastThawDay: firstThawDay + 3 * 90,
    redemptionGraceEndMs:
      firstUnlockMs + 3 * INCREMENT_PERIOD_MS + 90 * DAY_MS,
  };
}

// ── Phase status ──────────────────────────────────────────────────────────
/**
 * Status of each distribution phase at time `nowMs`.
 *  phase: "done" | "open" | "upcoming"
 */
export function phaseStatus(nowMs) {
  const st = (start, end) =>
    nowMs < start ? "upcoming" : nowMs > end ? "done" : "open";
  return {
    glacierClaim: st(TIMELINE.claimStart, TIMELINE.claimEnd),
    scavengerMine: st(TIMELINE.scavengerStart, TIMELINE.scavengerEnd),
    thawing: st(TIMELINE.thawStart, TIMELINE.thawEnd),
  };
}

// ── STAR ⇄ NIGHT conversion ───────────────────────────────────────────────
export function starToNight(star) {
  return star / STAR_PER_NIGHT;
}

export function nightToStar(night) {
  // round to whole STARs — the contract only handles integer amounts
  return Math.round(night * STAR_PER_NIGHT);
}

/** Format a STAR amount as a NIGHT value with digit grouping (default 2 dp). */
export function formatStar(star, dp = 2) {
  if (!Number.isFinite(star)) return "—";
  return (starToNight(star)).toLocaleString(undefined, {
    maximumFractionDigits: dp,
  });
}

// ── Cardano destination-address checks (pure) ─────────────────────────────
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
// The five generator constants from the bech32 spec (BIP-173).
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function bech32Checksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;
  const out = [];
  for (let i = 0; i < 6; i++) out.push((mod >>> (5 * (5 - i))) & 31);
  return out;
}

/**
 * Encode bytes as a bech32 string with the given hrp (e.g. "addr", "stake").
 * Exported for tests (to construct known-valid vectors) — not used by the UI.
 */
export function bech32Encode(hrp, bytes) {
  // bytes → 5-bit groups
  const data = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const chars = data.concat(bech32Checksum(hrp, data)).map((v) => BECH32_CHARSET[v]);
  return hrp + "1" + chars.join("");
}

/** Decode a bech32 string → { hrp, data } or { error }. Generic (any hrp). */
export function bech32Decode(s) {
  s = String(s).trim().toLowerCase();
  // Cardano Shelley addresses are longer than the 90-char BIP-173 default;
  // mainnet payment addresses run ~100-111 chars, so allow up to 111.
  if (s.length > 111) return { error: "too-long" };
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep > 19) return { error: "no-separator" };
  const hrp = s.slice(0, sep);
  const part = s.slice(sep + 1);
  const data = [];
  for (const ch of part) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx < 0) return { error: "bad-char" };
    data.push(idx);
  }
  if (data.length < 6) return { error: "too-short" };
  // checksum over the full data part (payload + 6 checksum groups);
  // BIP-173: a valid bech32 string has polymod(hrp_expand + data) == 1
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1)
    return { error: "bad-checksum" };
  return { hrp, data: data.slice(0, -6) };
}

/** Convert bech32 5-bit groups to a byte array (drops the final <8-bit tail). */
function bech32ToBytes(groups) {
  let acc = 0, bits = 0;
  const out = [];
  for (const v of groups) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
      acc &= (1 << bits) - 1; // drop the consumed high bits
    }
  }
  return out;
}

/**
 * Validate a bech32-encoded Cardano Shelley address.
 * Returns { ok, reason } — ok=true means the hrp is addr/stake, the checksum
 * verifies, and the decoded payload has a sane length.
 */
export function validateCardanoAddress(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return { ok: false, reason: "empty" };
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep > 19) return { ok: false, reason: "no-separator" };
  const hrp = s.slice(0, sep);
  const part = s.slice(sep + 1);
  if (!/^(addr|stake)$/.test(hrp)) return { ok: false, reason: "unknown-hrp" };
  const data = [];
  for (const ch of part) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx < 0) return { ok: false, reason: "bad-char" };
    data.push(idx);
  }
  if (data.length < 7) return { ok: false, reason: "too-short" };
  if (s.length > 111) return { ok: false, reason: "too-long" };
  // checksum over the full data part (payload + 6 checksum groups);
  // BIP-173: a valid bech32 string has polymod(hrp_expand + data) == 1
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1)
    return { ok: false, reason: "bad-checksum" };
  const bytes = bech32ToBytes(data.slice(0, -6));
  // Shelley base addresses: 29 bytes; allow the documented 21–109 range
  // so script/stake variants also validate.
  if (bytes.length < 21 || bytes.length > 109) return { ok: false, reason: "bad-length" };
  const header = bytes[0];
  const netId = header & 0x07;
  const purpose = (header & 0x78) >>> 3; // 0 = key, 1 = script (payment)
  return {
    ok: true,
    hrp,
    network: netId === 1 ? "mainnet" : `net-${netId}`,
    purpose: purpose === 0 ? "key" : "script",
    byteLength: bytes.length,
  };
}
