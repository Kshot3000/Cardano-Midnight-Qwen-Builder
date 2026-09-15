// Reward Flow Watch — Node.js test suite.
// Run: node --test apps/reward-flow/test/flow.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUPPLY_ADA,
  PARAMS,
  normalizeTotals,
  flowBetween,
  summarize,
  engineHealth,
  fmtAda,
  fmtM,
  fmtSignedM,
  fmtPct,
} from "../src/flow.js";

// Build an exact-conservation series: reserves is always the headroom to max
// supply, so supply + reserves == 45e9 by construction (mirrors live data).
function makeRows({ n = 10, mint = 7_200_000, feeStep = 28_000_000, claims = 3_000_000, base = 36_350_000_000 } = {}) {
  const rows = [];
  let supply = base;
  let reward = 800_000_000; // unclaimed pot
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      supply += mint;
      reward += mint + feeStep - claims;
    }
    rows.push({
      epoch: 645 + i,
      supply,
      reserves: MAX_SUPPLY_ADA - supply,
      treasury: 1_450_000_000,
      reward,
      circulation: supply * 0.95,
      fees: i > 0 ? feeStep : 0, // PER-epoch fee income (row 0's own fees are irrelevant)
      treasuryDonation: 0,
      treasuryWithdrawal: 0,
      reservesWithdrawal: 0,
    });
  }
  return rows;
}

test("PARAMS match live mainnet values", () => {
  assert.equal(PARAMS.rho, 0.003);
  assert.equal(PARAMS.tau, 0.2);
  assert.equal(PARAMS.k, 500);
  assert.equal(MAX_SUPPLY_ADA, 45_000_000_000);
});

test("normalizeTotals converts lovelace strings to ADA", () => {
  // Real live row, data.cardano.org /k/api/v1/totals?_epoch_no=650 (fetched 2026-09-14).
  const row = normalizeTotals({
    epoch_no: 650,
    supply: "38823451407346130",
    reserves: "6176548592653870",
    treasury: "1337356659543733",
    reward: "920674556326878",
    circulation: "36559963986360525",
    fees: "21839114994",
    treasury_donation: "0",
    treasury_withdrawal: "0",
    reserves_withdrawal: "0",
  });
  assert.equal(row.epoch, 650);
  // float64 has ~15-16 significant digits; a 17-digit lovelace integer divided
  // by 1e6 is exact to ~1e-3 ADA.
  assert.ok(Math.abs(row.supply - 38_823_451_407.34613) < 1e-3);
  assert.ok(Math.abs(row.reserves - 6_176_548_592.65387) < 1e-3);
  // The live row must satisfy the hard-cap identity the whole app is built on.
  assert.ok(Math.abs(row.supply + row.reserves - 45_000_000_000) < 1e-3);
  assert.equal(row.treasuryDonation, 0);
  assert.equal(row.treasuryWithdrawal, 0);
  assert.equal(row.reservesWithdrawal, 0);
});

test("normalizeTotals maps missing fields to null (never fake 0)", () => {
  const row = normalizeTotals({ epoch_no: 1, supply: "1000000" });
  assert.equal(row.supply, 1);
  assert.equal(row.reserves, null);
  assert.equal(row.fees, null);
  assert.equal(row.reward, null);
});

test("normalizeTotals rejects non-objects", () => {
  assert.throws(() => normalizeTotals(null), RangeError);
  assert.throws(() => normalizeTotals("nope"), RangeError);
});

test("flowBetween: exact conservation on constructed rows", () => {
  const rows = makeRows();
  const f = flowBetween(rows[0], rows[1]);
  assert.equal(f.fromEpoch, 645);
  assert.equal(f.toEpoch, 646);
  assert.equal(f.mint, 7_200_000);
  assert.equal(f.reserveDecay, 7_200_000); // mint == headroom consumed, exactly
  assert.equal(f.conservationDrift, 0);
  assert.equal(f.conserved, true);
  assert.ok(Math.abs(f.effectiveRate - 7_200_000 / 36_350_000_000) < 1e-15);
});

test("flowBetween: reward-pot claims identity", () => {
  const rows = makeRows({ mint: 7_200_000, feeStep: 28_000_000, claims: 3_000_000 });
  const f = flowBetween(rows[0], rows[1]);
  assert.equal(f.feeIncome, 28_000_000); // epoch 646's per-epoch fee income
  assert.equal(f.rewardDelta, 7_200_000 + 28_000_000 - 3_000_000);
  // claims == mint + feeIncome - dReward  -> reconstructs the input exactly
  assert.equal(f.mint + f.feeIncome - f.rewardDelta, 3_000_000);
  assert.equal(f.claims, 3_000_000);
});

test("flowBetween: omits reward fields when absent", () => {
  const rows = makeRows().map(({ reward, ...rest }) => rest);
  const f = flowBetween(rows[0], rows[1]);
  assert.equal(f.rewardDelta, null);
  assert.equal(f.claims, null);
  assert.equal(f.conserved, true);
});

test("flowBetween throws on missing supply/reserves", () => {
  assert.throws(() => flowBetween({ supply: 1 }, { supply: 2, reserves: 1 }), RangeError);
  assert.throws(() => flowBetween(null, { supply: 1, reserves: 1 }), RangeError);
});

test("summarize aggregates the whole window correctly", () => {
  const rows = makeRows({ n: 10, mint: 7_200_000, feeStep: 28_000_000, claims: 3_000_000 });
  const s = summarize(rows);
  assert.equal(s.epochs, 9);
  assert.equal(s.fromEpoch, 645);
  assert.equal(s.toEpoch, 654);
  assert.equal(s.totalMint, 9 * 7_200_000);
  assert.equal(s.totalDecay, 9 * 7_200_000); // decay == mint exactly
  assert.ok(Math.abs(s.avgMintPerEpoch - 7_200_000) < 1e-9);
  assert.equal(s.feeIncome, 9 * 28_000_000); // SUM of per-epoch fee income
  // claims over window = mint + fees - dReward
  assert.equal(s.claims, 9 * 7_200_000 + 9 * 28_000_000 - (rows[9].reward - rows[0].reward));
  assert.equal(s.allConserved, true);
  assert.ok(s.maxAbsDrift < 1e-6);
});

test("summarize rejects too few rows", () => {
  assert.throws(() => summarize([]), RangeError);
  assert.throws(() => summarize([{ supply: 1, reserves: 1 }]), RangeError);
});

test("engineHealth: healthy window scores 100", () => {
  const s = summarize(makeRows({ n: 12 }));
  const h = engineHealth(s);
  assert.equal(h.score, 100);
  assert.equal(h.label, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
  assert.ok(h.annualRate != null && h.annualRate > 0);
});

test("engineHealth: drift breaks conservation check", () => {
  const rows = makeRows({ n: 6 });
  // Inject a headroom leak: reserves jumps down without a matching mint.
  rows[3].reserves -= 50_000_000;
  const s = summarize(rows);
  const h = engineHealth(s);
  assert.equal(s.allConserved, false);
  assert.ok(h.checks[0].pass === false);
  assert.ok(h.score < 100);
});

test("engineHealth: absurd rate fails the sane-band check", () => {
  // 10% mint per epoch -> annual rate far above 5%.
  const s = summarize(makeRows({ n: 5, mint: 3_600_000_000 })); // 1% per epoch
  const h = engineHealth(s);
  // 1%/epoch * 73 = 73%/yr -> above the 5% band, so D must fail.
  assert.equal(h.checks[3].pass, false);
});

test("engineHealth: tiny rate (near-dead epoch) fails the band", () => {
  const s = summarize(makeRows({ n: 5, mint: 100 })); // ~0 mint -> rate ~0
  const h = engineHealth(s);
  assert.equal(h.checks[3].pass, false);
});

test("fmtAda / fmtM / fmtSignedM / fmtPct handle null and scale", () => {
  assert.equal(fmtAda(null), "–");
  assert.equal(fmtAda(1234567.8), "1,234,568");
  assert.equal(fmtM(45_000_000_000), "45.00B");
  assert.equal(fmtM(7_200_000), "7.20M");
  assert.equal(fmtM(28_000), "28.0K");
  assert.equal(fmtSignedM(500), "+500");
  assert.equal(fmtSignedM(-500), "−500");
  assert.equal(fmtSignedM(null), "–");
  assert.equal(fmtPct(0.003), "0.300%");
  assert.equal(fmtPct(null), "–");
});
