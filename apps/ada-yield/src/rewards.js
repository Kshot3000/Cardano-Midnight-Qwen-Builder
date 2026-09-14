// Ada Yield Tracker — Cardano staking reward math (pure, unit-tested).
//
// Implements the official Cardano CIP-16 stake-reward distribution, matching
// the Cardano Foundation reward calculator exactly (cardano-foundation/
// cardano-reward-calculator, pages/index.js recalcAll, lines 485-506):
//
//   reserveAda    = maxSupply - currentSupply
//   grossReward   = fees + reserveAda * rho            (rho = monetaryExpansion = 0.003)
//   pot (P)       = grossReward * (1 - tau)            (tau = treasuryCut = 0.2)
//
//   For each pool (using S = total supply of ADA, NOT total active stake):
//     z0     = 1 / k                                   (k = stakePoolTargetNum = 500)
//     sigma  = poolStake / S                           (pool active stake, incl. pledge)
//     s      = pledge / S
//     sig'   = min(sigma, z0)
//     s'     = min(s, z0)
//     reward = P/(1 + a0) * ( sig' + s' * a0 * ((sig' - s' * (z0 - sig')/z0) / z0) )
//              * perf                                  (perf = performance factor beta, 0..1)
//
//   Delegator payout (docs.cardano.org "Pledging and rewards"):
//     gross  = max(reward - cost, 0)      (operator fixed cost paid first)
//     net    = gross * (1 - margin)       (operator margin taken from the remainder)
//     perAda = net / poolStake            (split pro-rata across staked ADA)
//
//   Annualisation: perAda * epochsPerYear * 100 = APY (%).
//
// All monetary values are whole ADA (numbers). No network access.
// Every function throws a descriptive RangeError on invalid input so the UI
// can show an honest error instead of a fake number.

export const DEFAULTS = Object.freeze({
  maxSupplyAda: 45e9,    // hard protocol cap
  totalSupplyAda: 37e9,  // total supply in existence (incl. reserve) — fallback
  reserveAda: 8e9,       // maxSupply - currentSupply — fallback
  tau: 0.003,            // rho: reserve decay per epoch (monetaryExpansion)
  treasuryShare: 0.2,    // tau: share of (decay + fees) sent to treasury
  k: 500,                // stakePoolTargetNum
  a0: 0.3,               // pledge influence factor
  epochsPerYear: 73,     // 365 / 5-day epochs
});

function reqFinite(name, v) {
  if (typeof v !== "number" || !isFinite(v)) {
    throw new RangeError(`${name} must be a finite number (got ${String(v)})`);
  }
  return v;
}
function reqNonNeg(name, v) {
  reqFinite(name, v);
  if (v < 0) throw new RangeError(`${name} must be >= 0 (got ${v})`);
  return v;
}
function reqUnit(name, v, max = 1) {
  reqNonNeg(name, v);
  if (v > max) throw new RangeError(`${name} must be <= ${max} (got ${v})`);
  return v;
}

/**
 * Total reward available for an epoch (the pool pot P), in ADA.
 * @param {{reserveAda?:number, tau?:number, feesAda?:number, treasuryShare?:number}} p
 */
export function rewardPotAda(p = {}) {
  const reserveAda = reqNonNeg("reserveAda", p.reserveAda ?? DEFAULTS.reserveAda);
  const tau = reqNonNeg("tau", p.tau ?? DEFAULTS.tau);
  const feesAda = reqNonNeg("feesAda", p.feesAda ?? 0);
  const treasuryShare = reqUnit("treasuryShare", p.treasuryShare ?? DEFAULTS.treasuryShare);
  return Math.max(0, (reserveAda * tau + feesAda) * (1 - treasuryShare));
}

/** Relative saturation size z0 = 1/k. */
export function z0(k = DEFAULTS.k) {
  reqFinite("k", k);
  if (k <= 0) throw new RangeError(`k must be > 0 (got ${k})`);
  return 1 / k;
}

/**
 * Gross pool reward for one epoch (before cost/margin), in ADA.
 * Uses the exact CIP-16 formula; denominators use total supply S.
 * @param {object} p
 * @param {number} p.poolStakeAda    ADA staked to this pool (incl. pledge)
 * @param {number} [p.totalSupplyAda] total ADA supply S (default DEFAULTS.totalSupplyAda)
 * @param {number} [p.pledgeAda=0]   ADA pledged by the pool operator(s)
 * @param {number} [p.pot]           epoch reward pot P; computed via rewardPotAda when omitted
 * @param {number} [p.k=500]  @param {number} [p.a0=0.3]
 * @param {number} [p.perf=1]        performance factor beta/sigma_a, 0..1 (default: optimal)
 */
export function poolRewardAda(p = {}) {
  const poolStakeAda = reqNonNeg("poolStakeAda", p.poolStakeAda);
  const totalSupplyAda = reqFinite("totalSupplyAda", p.totalSupplyAda ?? DEFAULTS.totalSupplyAda);
  if (totalSupplyAda <= 0) throw new RangeError(`totalSupplyAda must be > 0 (got ${totalSupplyAda})`);
  const pledgeAda = reqNonNeg("pledgeAda", p.pledgeAda ?? 0);
  const pot = p.pot != null ? reqNonNeg("pot", p.pot) : rewardPotAda(p);
  const k = p.k ?? DEFAULTS.k;
  const a0 = reqNonNeg("a0", p.a0 ?? DEFAULTS.a0);
  const perf = reqUnit("perf", p.perf ?? 1);

  if (poolStakeAda === 0) return 0;
  if (pledgeAda > poolStakeAda) {
    throw new RangeError(`pledgeAda (${pledgeAda}) cannot exceed pool stake (${poolStakeAda})`);
  }

  const z = z0(k);
  const sig = Math.min(poolStakeAda / totalSupplyAda, z); // sig'
  const s = Math.min(pledgeAda / totalSupplyAda, z);      // s'
  const pledgeTerm = s * a0 * ((sig - s * ((z - sig) / z)) / z);
  return Math.max(0, (pot / (1 + a0)) * (sig + pledgeTerm) * perf);
}

/**
 * Net reward paid to all delegators of the pool for one epoch (ADA):
 * gross minus the operator fixed cost, minus the operator margin.
 */
export function delegatorNetAda(p = {}) {
  const gross = poolRewardAda(p);
  const cost = reqNonNeg("cost", p.cost ?? 0);
  const margin = reqUnit("margin", p.margin ?? 0);
  return Math.max(gross - cost, 0) * (1 - margin);
}

/**
 * Net reward per ADA of delegated stake for one epoch.
 * (The remainder after cost+margin is split pro-rata across all staked ADA.)
 */
export function delegatorRewardPerAda(p = {}) {
  const poolStakeAda = reqNonNeg("poolStakeAda", p.poolStakeAda);
  if (poolStakeAda === 0) return 0;
  return delegatorNetAda(p) / poolStakeAda;
}

/** Net epoch reward for a specific delegation, in ADA. */
export function delegatorEpochRewardAda(p = {}) {
  const yourAda = reqNonNeg("yourAda", p.yourAda);
  return delegatorRewardPerAda(p) * yourAda;
}

/**
 * Saturation of a pool as a fraction of its optimal size z0 (0..1..∞).
 * 1.0 = optimally saturated (poolStake = S/k); >1 = oversaturated.
 */
export function saturation(poolStakeAda, totalSupplyAda, k = DEFAULTS.k) {
  reqNonNeg("poolStakeAda", poolStakeAda);
  reqFinite("totalSupplyAda", totalSupplyAda);
  if (totalSupplyAda <= 0) throw new RangeError(`totalSupplyAda must be > 0 (got ${totalSupplyAda})`);
  return (poolStakeAda / totalSupplyAda) / z0(k);
}

/**
 * Expected annual net yield for a delegation.
 * Returns { epochAda, annualAda, apyPct, annualPct, perEpochPct }.
 *   apyPct      = annual ADA reward / delegated ADA * 100   (simple, ADA-denominated)
 *   annualPct   = (1 + perAda*epochsPerYear)^epochsPerYear - 1, *100 (compounded)
 */
export function annualYield(p = {}) {
  const epochsPerYear = reqFinite("epochsPerYear", p.epochsPerYear ?? DEFAULTS.epochsPerYear);
  if (epochsPerYear <= 0) throw new RangeError(`epochsPerYear must be > 0 (got ${epochsPerYear})`);
  const yourAda = reqNonNeg("yourAda", p.yourAda ?? 0);
  const perAda = delegatorRewardPerAda(p);
  const epochAda = perAda * yourAda;
  const annualAda = perAda * epochsPerYear * yourAda;
  const apyPct = yourAda > 0 ? (annualAda / yourAda) * 100 : 0;
  const annualPct = ((1 + perAda * epochsPerYear) ** epochsPerYear - 1) * 100;
  return { epochAda, annualAda, apyPct, annualPct, perEpochPct: perAda * 100 };
}

/**
 * Compare a list of pools head-to-head. `pools` is an array of objects shaped
 * like poolRewardAda params (plus optional `label`); `network` carries shared
 * params (pot, k, a0, totalSupplyAda, yourAda, epochsPerYear, perf).
 * Returns rows sorted by apyPct descending.
 */
export function comparePools(pools, network = {}) {
  if (!Array.isArray(pools)) throw new RangeError("pools must be an array");
  const totalSupplyAda = network.totalSupplyAda ?? DEFAULTS.totalSupplyAda;
  const k = network.k ?? DEFAULTS.k;
  const rows = pools.map((pool, i) => {
    const merged = { ...network, ...pool, totalSupplyAda, k };
    const y = annualYield(merged);
    return {
      label: pool.label != null ? String(pool.label) : `Pool ${i + 1}`,
      poolId: pool.poolId ?? null,
      ticker: pool.ticker ?? null,
      activeStakeAda: merged.poolStakeAda,
      pledgeAda: merged.pledgeAda ?? 0,
      cost: merged.cost ?? 0,
      margin: merged.margin ?? 0,
      satPct: saturation(merged.poolStakeAda, totalSupplyAda, k) * 100,
      epochAda: y.epochAda,
      annualAda: y.annualAda,
      apyPct: y.apyPct,
      annualPct: y.annualPct,
      perEpochPct: y.perEpochPct,
    };
  });
  return rows.sort((a, b) => b.apyPct - a.apyPct);
}

/** True once the pool has reached (or passed) its optimal size z0. */
export function isSaturated(poolStakeAda, totalSupplyAda, k = DEFAULTS.k) {
  return saturation(poolStakeAda, totalSupplyAda, k) >= 1;
}
