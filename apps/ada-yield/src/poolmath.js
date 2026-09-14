/**
 * poolmath.js — data-adapter + network-stat helpers for the Ada Yield Tracker.
 *
 * This module does NOT re-derive the reward formula (that lives in
 * rewards.js). It only:
 *   - maps raw Koios `pool_list` rows (lovelace) into ADA units, dropping
 *     non-live pools, so the reward math in rewards.js receives clean input;
 *   - ranks pools by active stake;
 *   - computes a network-wide APY from the reward pot + total active stake.
 */

export const L = 1_000_000; // lovelace per ADA

/**
 * Convert Koios `pool_list` rows into clean pool objects for rewards.js.
 * Fields in (lovelace): active_stake, pledge, fixed_cost. margin is a fraction.
 * Rows with null/<=0 active_stake (retired/inactive) are dropped.
 */
export function toPoolInput(rows) {
  return (rows || [])
    .map((r) => {
      const stakeL = r?.active_stake != null ? Number(r.active_stake) : 0;
      return {
        poolId: r?.pool_id_bech32 ?? r?.pool_id_hex ?? null,
        ticker: r?.ticker ?? null,
        activeStakeAda: stakeL / L,
        pledgeAda: (Number(r?.pledge) || 0) / L,
        margin: Number(r?.margin) || 0,
        costAda: (Number(r?.fixed_cost) || 0) / L,
        activeEpochNo: r?.active_epoch_no ?? null,
      };
    })
    .filter((p) => p.activeStakeAda > 0);
}

/**
 * Return the top-N pools by active stake (ADA) descending. New array, sorted.
 * Throws on a null/NaN activeStakeAda (callers must toPoolInput() first).
 */
export function topByStake(pools, n) {
  const arr = Array.from(pools);
  for (const p of arr) {
    // explicit null/undefined guard: Number(null) === 0 would slip past isFinite
    if (p == null || p.activeStakeAda == null) {
      throw new Error("topByStake: pool missing activeStakeAda");
    }
    const v = Number(p.activeStakeAda);
    if (!Number.isFinite(v)) throw new Error("topByStake: pool missing activeStakeAda");
  }
  arr.sort((a, b) => Number(b.activeStakeAda) - Number(a.activeStakeAda));
  const limit = Number.isFinite(n) && n > 0 ? n : arr.length;
  return arr.slice(0, limit);
}

/** Median of a numeric array (0 for empty). */
export function median(values) {
  const a = Array.from(values)
    .map(Number)
    .filter((v) => Number.isFinite(v))
    .sort((x, y) => x - y);
  if (a.length === 0) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Network-wide APY (fraction) = (pot / totalActiveStake) * epochsPerYear.
 * This is the reward the network hands out per epoch, spread over all staked
 * ADA, annualised. `pot` is the reward-pot-for-pools (after treasury cut).
 */
export function networkApy({ potAda, totalActiveStakeAda, epochsPerYear = 73 } = {}) {
  const pot = Number(potAda);
  const st = Number(totalActiveStakeAda);
  if (!Number.isFinite(pot) || !Number.isFinite(st) || st <= 0 || pot <= 0) return 0;
  return (pot / st) * (Number(epochsPerYear) || 73);
}
