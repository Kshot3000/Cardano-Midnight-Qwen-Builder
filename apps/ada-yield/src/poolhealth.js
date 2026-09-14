// poolhealth.js — pool quality analysis + yield ladder (pure, unit-tested).
//
// Given one normalized Koios `pool_list` row (ADA units) and the network
// model (total supply, k, a0, pot, epochs/year, ADA/USD price), this module
// derives:
//
//   * a list of human-readable health flags (retiring, oversaturated,
//     zero pledge, no relays, no ticker, heavy fixed-cost burden, inactive);
//   * a 0–100 health score + letter grade, computed from those flags;
//   * a yield ladder: the CIP-16 net annual reward (ADA + USD) for a fixed
//     set of delegation sizes against THIS pool's live margin/cost/stake.
//
// The reward math itself is NOT re-implemented here — each ladder row calls
// `annualYield()` from rewards.js (the exact CIP-16 formula, separately
// tested). All functions are pure: no Date.now(), no network.

import { annualYield, saturation } from "./rewards.js";

const L = 1_000_000; // lovelace per ADA

// Fixed ladder of delegation sizes (ADA).
export const DEFAULT_LADDER = [1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

/**
 * Normalize one raw Koios `pool_list` row into ADA units.
 * (poolmath.js's toPoolInput does this for lists; this is the single-row
 * variant that keeps the metadata fields the inspector needs.)
 */
export function normalizePoolRow(raw) {
  const r = raw || {};
  return {
    poolId: r.pool_id_bech32 ?? r.pool_id_hex ?? null,
    hexId: r.pool_id_hex ?? null,
    ticker: r.ticker ?? null,
    activeStakeAda: (Number(r.active_stake) || 0) / L,
    pledgeAda: (Number(r.pledge) || 0) / L,
    margin: Number(r.margin) || 0,
    costAda: (Number(r.fixed_cost) || 0) / L,
    activeEpochNo: r.active_epoch_no != null ? Number(r.active_epoch_no) : null,
    retiringEpoch: r.retiring_epoch != null ? Number(r.retiring_epoch) : null,
    poolStatus: r.pool_status ?? null,
    relays: Array.isArray(r.relays) ? r.relays : [],
    metaUrl: r.meta_url ?? null,
  };
}

/** Compact ADA formatting: 1.2B / 50.0M / 340. */
function fmtAda(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n.toFixed(0);
}

/**
 * Derive health flags for a pool.
 * @param {object} p normalized pool row
 * @param {object} network { totalSupplyAda, k, a0, pot, epochsPerYear }
 * @returns {Array<{code:string, level:'bad'|'warn'|'info', label:string, detail:string}>}
 */
export function poolHealthFlags(p, network) {
  if (!p || !network) throw new RangeError("poolHealthFlags needs a pool and network model");
  const flags = [];
  const satPct = (saturation(p.activeStakeAda, network.totalSupplyAda, network.k) * 100);

  if (p.activeStakeAda <= 0) {
    flags.push({ code: "inactive", level: "bad", label: "Not live",
      detail: "No active stake in this epoch — delegation earns nothing until it re-activates." });
  }
  if (p.retiringEpoch != null) {
    flags.push({ code: "retiring", level: "bad", label: "Retiring",
      detail: `Announced retirement at epoch ${p.retiringEpoch}. Delegators will be moved to the reserve pool.` });
  }
  if (satPct > 100 && p.activeStakeAda > 0) {
    flags.push({ code: "oversaturated", level: "warn", label: `Oversaturated (${satPct.toFixed(0)}%)`,
      detail: `Stake ${fmtAda(p.activeStakeAda)} ADA is above the optimal size S/k = ${fmtAda(network.totalSupplyAda / network.k)} — per-ADA yield is no longer growing with stake.` });
  }
  if (p.pledgeAda <= 0 && p.activeStakeAda > 0) {
    flags.push({ code: "zero-pledge", level: "warn", label: "Zero pledge",
      detail: "The operator pledged no ADA of its own — the CIP-16 pledge bonus does not apply." });
  }
  if (p.activeStakeAda > 0 && p.costAda / p.activeStakeAda > 0.005) {
    flags.push({ code: "cost-burden", level: "warn", label: `Heavy fixed cost (${p.costAda.toFixed(0)} ADA/epoch)`,
      detail: `The operator's fixed cost exceeds 0.5% of active stake per epoch — it eats a large share of the reward pot before delegators.` });
  }
  if (p.relays.length === 0) {
    flags.push({ code: "no-relays", level: "warn", label: "No relays declared",
      detail: "The pool registered no relay DNS/IP — block production depends on undeclared (or DNS-only) infrastructure." });
  }
  if (!p.ticker) {
    flags.push({ code: "no-ticker", level: "info", label: "No ticker",
      detail: "The pool has not set a ticker — it will show as a raw pool id in explorers." });
  }
  if (p.margin > 0.1) {
    flags.push({ code: "high-margin", level: "info", label: `High margin (${(p.margin * 100).toFixed(1)}%)`,
      detail: "The operator keeps more than 10% of the pool's net reward." });
  }
  if (flags.length === 0) {
    flags.push({ code: "clean", level: "info", label: "No issues flagged",
      detail: "Live, not retiring, within saturation, has pledge, relays, and a ticker." });
  }
  return flags;
}

/**
 * 0–100 health score from the flags. Deterministic:
 *   base 100; −60 inactive; −35 retiring; −20 oversaturated; −15 no relays;
 *   −10 zero pledge; −10 cost burden; −5 no ticker; −5 high margin.
 * Letter grade: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F below.
 */
export function healthScore(flags) {
  const ded = { inactive: 60, retiring: 35, oversaturated: 20, "no-relays": 15,
    "zero-pledge": 10, "cost-burden": 10, "no-ticker": 5, "high-margin": 5 };
  let score = 100;
  for (const f of flags) score -= ded[f.code] ?? 0;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}

/**
 * Yield ladder: for each delegation size in `amountsAda`, the CIP-16 net
 * annual reward in this pool (live margin/cost, current pool stake).
 * @param {object} p  normalized pool row (needs activeStakeAda, pledgeAda, margin, costAda)
 * @param {object} network { totalSupplyAda, k, a0, pot, epochsPerYear }
 * @param {number[]} [amountsAda] ladder sizes (default DEFAULT_LADDER)
 * @param {number|null} [adaUsd] ADA/USD price for the USD column (null → omit)
 */
export function yieldLadder(p, network, amountsAda = DEFAULT_LADDER, adaUsd = null) {
  if (!Array.isArray(amountsAda) || amountsAda.length === 0) {
    throw new RangeError("amountsAda must be a non-empty array");
  }
  return amountsAda.map((ada) => {
    const y = annualYield({
      totalSupplyAda: network.totalSupplyAda,
      k: network.k,
      a0: network.a0,
      pot: network.pot,
      poolStakeAda: p.activeStakeAda,
      pledgeAda: p.pledgeAda,
      cost: p.costAda,
      margin: p.margin,
      yourAda: ada,
      epochsPerYear: network.epochsPerYear,
    });
    return {
      ada,
      usd: adaUsd != null ? ada * adaUsd : null,
      epochAda: y.epochAda,
      annualAda: y.annualAda,
      annualUsd: adaUsd != null ? y.annualAda * adaUsd : null,
      apyPct: y.apyPct,
      perEpochPct: y.perEpochPct,
    };
  });
}

/** Rank a set of normalized pools by health score desc (ties → stake desc). */
export function rankByHealth(pools, network) {
  return pools
    .map((p) => {
      const flags = poolHealthFlags(p, network);
      return { pool: p, flags, score: healthScore(flags) };
    })
    .sort((a, b) => b.score.score - a.score.score || b.pool.activeStakeAda - a.pool.activeStakeAda);
}
