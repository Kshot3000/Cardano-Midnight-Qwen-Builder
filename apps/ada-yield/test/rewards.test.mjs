import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS, rewardPotAda, z0, poolRewardAda, delegatorNetAda,
  delegatorRewardPerAda, delegatorEpochRewardAda, saturation,
  annualYield, comparePools, isSaturated,
} from "../src/rewards.js";
import { toPoolInput, topByStake, median, networkApy, L } from "../src/poolmath.js";

const S = 3.7e10; // total supply (ADA) used throughout
const K = 500, A0 = 0.3, POT = 4.2e8;

// ─── rewards.js ────────────────────────────────────────────────────────────

test("DEFAULTS are sane Cardano constants", () => {
  assert.equal(DEFAULTS.k, 500);
  assert.equal(DEFAULTS.a0, 0.3);
  assert.equal(DEFAULTS.treasuryShare, 0.2);
  assert.equal(DEFAULTS.tau, 0.003);
  assert.ok(DEFAULTS.epochsPerYear > 70 && DEFAULTS.epochsPerYear < 74); // 5-day epochs
  assert.ok(DEFAULTS.maxSupplyAda > DEFAULTS.totalSupplyAda);
});

test("z0 = 1/k; rejects k<=0", () => {
  assert.ok(Math.abs(z0(500) - 0.002) < 1e-12);
  assert.throws(() => z0(0));
  assert.throws(() => z0(-5));
});

test("rewardPotAda = (reserve*tau + fees)*(1 - treasuryShare)", () => {
  const pot = rewardPotAda({ reserveAda: 4e9, feesAda: 3.5e7, tau: 0.003, treasuryShare: 0.2 });
  const expected = (4e9 * 0.003 + 3.5e7) * 0.8;
  assert.ok(Math.abs(pot - expected) < 1e-6, `got ${pot} want ${expected}`);
});

test("rewardPotAda uses defaults when omitted and never goes negative", () => {
  assert.ok(rewardPotAda({}) > 0);
  assert.equal(rewardPotAda({ reserveAda: 0, feesAda: 0 }), 0);
});

test("rewardPotAda rejects negative / out-of-range input", () => {
  assert.throws(() => rewardPotAda({ reserveAda: -1 }));
  assert.throws(() => rewardPotAda({ treasuryShare: 1.5 }));
  assert.throws(() => rewardPotAda({ feesAda: NaN }));
});

test("poolRewardAda: zero stake → 0", () => {
  assert.equal(poolRewardAda({ poolStakeAda: 0, totalSupplyAda: S, pot: POT }), 0);
});

test("poolRewardAda: larger pool (below saturation) gets more", () => {
  const base = { totalSupplyAda: S, pot: POT, k: K, a0: A0 };
  const small = poolRewardAda({ poolStakeAda: 1e7, ...base });
  const big = poolRewardAda({ poolStakeAda: 5e7, ...base });
  assert.ok(big > small, `big ${big} should exceed small ${small}`);
});

test("poolRewardAda: pledge influence raises reward (same stake)", () => {
  const base = { poolStakeAda: 5e6, totalSupplyAda: S, pot: POT, k: K, a0: A0 };
  const noPledge = poolRewardAda({ ...base, pledgeAda: 0 });
  const withPledge = poolRewardAda({ ...base, pledgeAda: 2e6 });
  assert.ok(withPledge > noPledge, `pledge ${withPledge} should exceed no-pledge ${noPledge}`);
});

test("poolRewardAda: fully-saturated pool (S/k stake, no pledge, a0=0) = exactly pot/k", () => {
  // With a0=0 the pledge term vanishes and at sig'=z0: pot * z0 = pot/k exactly.
  const r = poolRewardAda({ poolStakeAda: S / K, totalSupplyAda: S, pot: POT, k: K, a0: 0, pledgeAda: 0 });
  assert.ok(Math.abs(r - POT / K) / (POT / K) < 1e-9, `got ${r} want ${POT / K}`);
  // With a0=0.3 the saturated pool earns pot/(k*(1+a0)) (the (1+a0) rescale).
  const r3 = poolRewardAda({ poolStakeAda: S / K, totalSupplyAda: S, pot: POT, k: K, a0: 0.3, pledgeAda: 0 });
  assert.ok(Math.abs(r3 - POT / (K * 1.3)) / (POT / (K * 1.3)) < 1e-9, `got ${r3}`);
});

test("poolRewardAda: matches the closed-form CF expression for an unsaturated pool", () => {
  const stake = 2e7, pledge = 3e6;
  const zz = 1 / K;
  const sig = Math.min(stake / S, zz);
  const ss = Math.min(pledge / S, zz);
  const cf = (POT / (1 + A0)) * (sig + ss * A0 * ((sig - ss * ((zz - sig) / zz)) / zz));
  const mine = poolRewardAda({ poolStakeAda: stake, pledgeAda: pledge, totalSupplyAda: S, pot: POT, k: K, a0: A0 });
  assert.ok(Math.abs(mine - cf) / cf < 1e-12, `got ${mine} want CF ${cf}`);
});

test("poolRewardAda: perf factor scales reward; pledge>stake throws", () => {
  const base = { poolStakeAda: 1e7, totalSupplyAda: S, pot: POT, k: K, a0: A0 };
  const full = poolRewardAda({ ...base, perf: 1 });
  const half = poolRewardAda({ ...base, perf: 0.5 });
  assert.ok(Math.abs(half - full / 2) < 1e-9);
  assert.throws(() => poolRewardAda({ poolStakeAda: 1e6, pledgeAda: 2e6, totalSupplyAda: S, pot: POT }));
});

test("delegatorNetAda: gross − cost (floor 0) × (1 − margin)", () => {
  const p = { poolStakeAda: 5e6, pledgeAda: 1e6, totalSupplyAda: S, pot: POT, k: K, a0: A0, cost: 340, margin: 0.003 };
  const gross = poolRewardAda(p);
  const expected = Math.max(gross - 340, 0) * (1 - 0.003);
  assert.ok(Math.abs(delegatorNetAda(p) - expected) < 1e-6);
  // Huge cost → floored to 0
  assert.equal(delegatorNetAda({ ...p, cost: 1e12 }), 0);
});

test("delegatorRewardPerAda: net per ADA < gross per ADA", () => {
  const p = { poolStakeAda: 5e6, pledgeAda: 1e6, totalSupplyAda: S, pot: POT, k: K, a0: A0, cost: 340, margin: 0.003 };
  const perAda = delegatorRewardPerAda(p);
  const grossPerAda = poolRewardAda(p) / 5e6;
  assert.ok(perAda > 0 && perAda < grossPerAda, `perAda ${perAda} vs gross ${grossPerAda}`);
});

test("delegatorEpochRewardAda = perAda × yourAda", () => {
  const p = { poolStakeAda: 5e6, pledgeAda: 1e6, totalSupplyAda: S, pot: POT, k: K, a0: A0, cost: 340, margin: 0.003 };
  const yours = delegatorEpochRewardAda({ ...p, yourAda: 100_000 });
  assert.ok(Math.abs(yours - delegatorRewardPerAda(p) * 100_000) < 1e-6);
});

test("saturation: 1.0 at optimal size (S/k)", () => {
  const atOptimal = S / K;
  assert.ok(Math.abs(saturation(atOptimal, S, K) - 1) < 1e-9);
  assert.ok(saturation(atOptimal * 2, S, K) > 1);
  assert.ok(saturation(atOptimal / 2, S, K) < 1);
});

test("isSaturated: below / at / above", () => {
  const opt = S / K;
  assert.equal(isSaturated(opt / 2, S, K), false);
  assert.equal(isSaturated(opt, S, K), true);
  assert.equal(isSaturated(opt * 3, S, K), true);
  assert.equal(isSaturated(0, S, K), false);
});

test("annualYield: apyPct = perEpoch% × epochsPerYear; single-digit sanity", () => {
  // Realistic pot: ~0.28% reserve decay + fees, after treasury cut ≈ 30M ADA/epoch.
  const p = { poolStakeAda: 5e6, pledgeAda: 1e6, totalSupplyAda: S, pot: 30e6, k: K, a0: A0, cost: 340, margin: 0.003, yourAda: 100_000, epochsPerYear: 73 };
  const y = annualYield(p);
  const perAda = delegatorRewardPerAda(p);
  assert.ok(Math.abs(y.apyPct - perAda * 73 * 100) < 1e-6, `apyPct ${y.apyPct}`);
  assert.ok(y.annualAda > 0);
  assert.ok(y.apyPct > 0 && y.apyPct < 15, `APY sanity: ${y.apyPct}%`);
  assert.ok(y.annualPct > y.apyPct, "compounded > simple");
});

test("annualYield: zero yourAda → 0 apy", () => {
  const y = annualYield({ poolStakeAda: 5e6, totalSupplyAda: S, pot: POT, yourAda: 0 });
  assert.equal(y.apyPct, 0);
});

test("comparePools: sorts by apyPct desc, keeps label/poolId/satPct", () => {
  const net = { totalSupplyAda: S, pot: POT, k: K, a0: A0, yourAda: 100_000, epochsPerYear: 73, perf: 1 };
  const rows = comparePools([
    { label: "Cheap", poolId: "p1", ticker: "CHEAP", poolStakeAda: 5e6, pledgeAda: 1e6, cost: 340, margin: 0.003 },
    { label: "Pricey", poolId: "p2", ticker: "PRICE", poolStakeAda: 5e6, pledgeAda: 1e6, cost: 340, margin: 0.1 },
  ], net);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "Cheap"); // lower margin → higher APY → first
  assert.equal(rows[0].poolId, "p1");
  assert.ok(rows[0].apyPct > rows[1].apyPct);
  assert.ok(rows[0].satPct > 0);
});

test("comparePools: rejects non-array", () => {
  assert.throws(() => comparePools("nope"));
});

// ─── poolmath.js ───────────────────────────────────────────────────────────

test("toPoolInput: lovelace→ADA, drops non-live rows", () => {
  const rows = [
    { pool_id_bech32: "p1", active_stake: "5000000000000", pledge: "1000000000", margin: 0.009, fixed_cost: "340000000", ticker: "TST", active_epoch_no: 589 },
    { pool_id_bech32: "p2", active_stake: null, pledge: "0", margin: 0.01, fixed_cost: "340000000" },
    { pool_id_bech32: "p3", active_stake: "0", pledge: "0", margin: 0, fixed_cost: "0" },
  ];
  const out = toPoolInput(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].poolId, "p1");
  assert.ok(Math.abs(out[0].activeStakeAda - 5_000_000) < 1e-6);
  assert.ok(Math.abs(out[0].pledgeAda - 1_000) < 1e-6);
  assert.ok(Math.abs(out[0].margin - 0.009) < 1e-12);
  assert.ok(Math.abs(out[0].costAda - 340) < 1e-6);
});

test("topByStake: sorts desc + slices; throws on missing", () => {
  const pools = [
    { poolId: "a", activeStakeAda: 100 },
    { poolId: "b", activeStakeAda: 300 },
    { poolId: "c", activeStakeAda: 200 },
  ];
  assert.deepEqual(topByStake(pools, 2).map((p) => p.poolId), ["b", "c"]);
  assert.throws(() => topByStake([{ poolId: "x", activeStakeAda: null }], 1));
});

test("median: odd/even/empty", () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test("networkApy: pot/stake × epochs; zero/invalid → 0", () => {
  const apy = networkApy({ potAda: 4.2e8, totalActiveStakeAda: 2.14e10, epochsPerYear: 73 });
  const expected = (4.2e8 / 2.14e10) * 73;
  assert.ok(Math.abs(apy - expected) < 1e-12, `got ${apy} want ${expected}`);
  assert.equal(networkApy({ potAda: 1e8, totalActiveStakeAda: 0 }), 0);
  assert.equal(networkApy({ potAda: -1, totalActiveStakeAda: 1e9 }), 0);
});

test("L constant = 1e6", () => {
  assert.equal(L, 1_000_000);
});
