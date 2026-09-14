// poolhealth.test.mjs — unit tests for pool quality + yield-ladder logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePoolRow,
  poolHealthFlags,
  healthScore,
  yieldLadder,
  rankByHealth,
  DEFAULT_LADDER,
} from "../src/poolhealth.js";
import { annualYield } from "../src/rewards.js";

// A realistic network model (numbers close to mainnet 2026-09).
const NET = {
  totalSupplyAda: 37e9,
  k: 500,
  a0: 0.3,
  pot: 9_000_000, // ~9M ADA / epoch
  epochsPerYear: 73,
};
const OPTIMAL = NET.totalSupplyAda / NET.k; // 74,000,000 ADA (S/k)

const L = 1_000_000;

// Base pool: 50M ADA stake (below optimal), 5M pledge, 340 ADA cost, 5% margin.
function rawPool(over = {}) {
  return {
    pool_id_bech32: "pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt",
    pool_id_hex: "153806dbcd134ddee69a8c5204e38ac80448f62342f8c23cfe4b7edf",
    ticker: "OCTAS",
    active_stake: String(50e6 * L),
    pledge: String(5e6 * L),
    margin: "0.05",
    fixed_cost: String(340 * L),
    active_epoch_no: 654,
    retiring_epoch: null,
    pool_status: "registered",
    relays: [{ dns: "relay.example", port: 3001 }],
    meta_url: "https://example.com/p.json",
    ...over,
  };
}

test("network model: optimal pool size S/k = 74M ADA", () => {
  assert.equal(OPTIMAL, 74e6);
});

test("normalizePoolRow converts lovelace → ADA and keeps metadata", () => {
  const p = normalizePoolRow(rawPool());
  assert.equal(p.activeStakeAda, 50e6);
  assert.equal(p.pledgeAda, 5e6);
  assert.equal(p.costAda, 340);
  assert.equal(p.margin, 0.05);
  assert.equal(p.ticker, "OCTAS");
  assert.equal(p.activeEpochNo, 654);
  assert.equal(p.retiringEpoch, null);
  assert.equal(p.relays.length, 1);
});

test("normalizePoolRow tolerates missing/odd fields", () => {
  const p = normalizePoolRow({});
  assert.equal(p.activeStakeAda, 0);
  assert.equal(p.pledgeAda, 0);
  assert.deepEqual(p.relays, []);
  assert.equal(p.ticker, null);
});

test("normalizePoolRow accepts numeric (not string) lovelace fields", () => {
  const p = normalizePoolRow({ active_stake: 1e12, fixed_cost: 340e6, margin: 0.1 });
  assert.equal(p.activeStakeAda, 1e6);
  assert.equal(p.costAda, 340);
  assert.equal(p.margin, 0.1);
});

test("a clean, healthy pool gets exactly one info flag", () => {
  const p = normalizePoolRow(rawPool());
  const flags = poolHealthFlags(p, NET);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].code, "clean");
  assert.equal(flags[0].level, "info");
});

test("retiring pool is flagged bad with the epoch", () => {
  const p = normalizePoolRow(rawPool({ retiring_epoch: 660 }));
  const flags = poolHealthFlags(p, NET);
  const ret = flags.find((f) => f.code === "retiring");
  assert.ok(ret, "retiring flag present");
  assert.equal(ret.level, "bad");
  assert.match(ret.detail, /660/);
});

test("oversaturated pool (stake > S/k) is flagged warn", () => {
  const p = normalizePoolRow(rawPool({ active_stake: String(OPTIMAL * 1.2 * L) }));
  const flags = poolHealthFlags(p, NET);
  const ov = flags.find((f) => f.code === "oversaturated");
  assert.ok(ov, "oversaturated flag present");
  assert.equal(ov.level, "warn");
  assert.match(ov.label, /Oversaturated/);
});

test("pool exactly at optimal size is NOT flagged oversaturated", () => {
  const p = normalizePoolRow(rawPool({ active_stake: String(OPTIMAL * L) }));
  const flags = poolHealthFlags(p, NET);
  assert.ok(!flags.some((f) => f.code === "oversaturated"));
});

test("zero pledge is flagged warn (only when the pool is live)", () => {
  const p = normalizePoolRow(rawPool({ pledge: "0" }));
  const flags = poolHealthFlags(p, NET);
  assert.ok(flags.some((f) => f.code === "zero-pledge"));
});

test("no relays is flagged warn", () => {
  const p = normalizePoolRow(rawPool({ relays: [] }));
  const flags = poolHealthFlags(p, NET);
  assert.ok(flags.some((f) => f.code === "no-relays"));
});

test("heavy fixed cost (>0.5% of stake) is flagged warn", () => {
  // 50M stake: 0.5% = 250k ADA. Cost 100k → fine; 500k → flagged.
  const ok = poolHealthFlags(normalizePoolRow(rawPool({ fixed_cost: String(1e5 * L) })), NET);
  assert.ok(!ok.some((f) => f.code === "cost-burden"));
  const bad = poolHealthFlags(normalizePoolRow(rawPool({ fixed_cost: String(5e5 * L) })), NET);
  assert.ok(bad.some((f) => f.code === "cost-burden"));
});

test("inactive pool (zero stake) is flagged bad", () => {
  const p = normalizePoolRow(rawPool({ active_stake: "0" }));
  const flags = poolHealthFlags(p, NET);
  const inact = flags.find((f) => f.code === "inactive");
  assert.ok(inact);
  assert.equal(inact.level, "bad");
});

test("high margin (>10%) is flagged info; exactly 10% is not", () => {
  assert.ok(poolHealthFlags(normalizePoolRow(rawPool({ margin: "0.11" })), NET).some((f) => f.code === "high-margin"));
  assert.ok(!poolHealthFlags(normalizePoolRow(rawPool({ margin: "0.10" })), NET).some((f) => f.code === "high-margin"));
});

test("no ticker is flagged info", () => {
  assert.ok(poolHealthFlags(normalizePoolRow(rawPool({ ticker: null })), NET).some((f) => f.code === "no-ticker"));
});

test("healthScore: clean pool = 100 / A", () => {
  const { score, grade } = healthScore(poolHealthFlags(normalizePoolRow(rawPool()), NET));
  assert.equal(score, 100);
  assert.equal(grade, "A");
});

test("healthScore: penalties are deterministic and clamped to [0,100]", () => {
  const worst = [
    { code: "inactive", level: "bad" },
    { code: "retiring", level: "bad" },
    { code: "oversaturated", level: "warn" },
    { code: "no-relays", level: "warn" },
    { code: "zero-pledge", level: "warn" },
    { code: "cost-burden", level: "warn" },
    { code: "no-ticker", level: "info" },
    { code: "high-margin", level: "info" },
  ];
  const { score } = healthScore(worst);
  // 100 - (60+35+20+15+10+10+5+5) = -60 → clamped to 0
  assert.equal(score, 0);
  const mid = healthScore([{ code: "no-relays", level: "warn" }]);
  assert.equal(mid.score, 85);
  assert.equal(mid.grade, "B");
});

test("healthScore: grade boundaries A/B/C/D/F", () => {
  assert.equal(healthScore([]).grade, "A");
  assert.equal(healthScore([{ code: "no-ticker", level: "info" }]).grade, "A"); // 95
  assert.equal(healthScore([{ code: "no-relays", level: "warn" }]).grade, "B"); // 85
  assert.equal(healthScore([{ code: "oversaturated", level: "warn" }, { code: "no-relays", level: "warn" }]).grade, "C"); // 65
  assert.equal(healthScore([{ code: "retiring", level: "bad" }, { code: "no-relays", level: "warn" }]).grade, "D"); // 50
  assert.equal(healthScore([{ code: "inactive", level: "bad" }, { code: "retiring", level: "bad" }]).grade, "F"); // 5
});

test("healthScore: unknown flag codes are ignored (no crash)", () => {
  assert.equal(healthScore([{ code: "mystery", level: "info" }]).score, 100);
});

test("yieldLadder: rows match annualYield() exactly (same formula)", () => {
  const p = normalizePoolRow(rawPool());
  const rows = yieldLadder(p, NET, [1000, 100_000], 0.21);
  for (const row of rows) {
    const ref = annualYield({
      totalSupplyAda: NET.totalSupplyAda, k: NET.k, a0: NET.a0, pot: NET.pot,
      poolStakeAda: p.activeStakeAda, pledgeAda: p.pledgeAda,
      cost: p.costAda, margin: p.margin, yourAda: row.ada, epochsPerYear: NET.epochsPerYear,
    });
    assert.equal(row.epochAda, ref.epochAda);
    assert.equal(row.annualAda, ref.annualAda);
    assert.equal(row.apyPct, ref.apyPct);
  }
});

test("yieldLadder: per-epoch rate is identical across ladder rows (cost/margin fixed, stake fixed)", () => {
  const p = normalizePoolRow(rawPool());
  const rows = yieldLadder(p, NET);
  const rates = new Set(rows.map((r) => r.perEpochPct));
  assert.equal(rates.size, 1);
  // …and the simple APY matches that rate × epochsPerYear.
  for (const r of rows) assert.ok(Math.abs(r.apyPct - r.perEpochPct * NET.epochsPerYear) < 1e-9);
});

test("yieldLadder: annualAda scales linearly with stake", () => {
  const p = normalizePoolRow(rawPool());
  const rows = yieldLadder(p, NET, [1_000, 10_000, 100_000]);
  assert.ok(Math.abs(rows[1].annualAda - rows[0].annualAda * 10) < 1e-6);
  assert.ok(Math.abs(rows[2].annualAda - rows[0].annualAda * 100) < 1e-6);
});

test("yieldLadder: USD columns use the given price; null price → null USD", () => {
  const p = normalizePoolRow(rawPool());
  const withUsd = yieldLadder(p, NET, [1000], 0.21);
  assert.equal(withUsd[0].usd, 210);
  assert.equal(withUsd[0].annualUsd, withUsd[0].annualAda * 0.21);
  const noUsd = yieldLadder(p, NET, [1000], null);
  assert.equal(noUsd[0].usd, null);
  assert.equal(noUsd[0].annualUsd, null);
});

test("yieldLadder: default ladder is the documented sizes", () => {
  assert.deepEqual(DEFAULT_LADDER, [1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000]);
  assert.equal(yieldLadder(normalizePoolRow(rawPool()), NET).length, 6);
});

test("yieldLadder: throws on empty amounts", () => {
  assert.throws(() => yieldLadder(normalizePoolRow(rawPool()), NET, []), /non-empty/);
});

test("yieldLadder: zero-stake pool yields 0 for every row", () => {
  const p = normalizePoolRow(rawPool({ active_stake: "0", pledge: "0" }));
  const rows = yieldLadder(p, NET, [1000, 100_000]);
  assert.ok(rows.every((r) => r.epochAda === 0 && r.annualAda === 0 && r.apyPct === 0));
});

test("yieldLadder: margin+cost reduce the yield vs a zero-cost pool", () => {
  const base = normalizePoolRow(rawPool({ margin: "0", fixed_cost: "0" }));
  const taxed = normalizePoolRow(rawPool({ margin: "0.1", fixed_cost: String(1e5 * L) }));
  const rBase = yieldLadder(base, NET, [100_000])[0];
  const rTax = yieldLadder(taxed, NET, [100_000])[0];
  assert.ok(rTax.annualAda < rBase.annualAda);
});

test("rankByHealth: sorts by score desc, ties by stake desc", () => {
  const clean = normalizePoolRow(rawPool()); // 50M stake → 100
  const smallerClean = normalizePoolRow(rawPool({
    active_stake: String(1e6 * L),
    pool_id_bech32: "pool1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  })); // 1M stake → 100
  const dirty = normalizePoolRow(rawPool({ relays: [], ticker: null })); // 50M stake → 80
  const ranked = rankByHealth([dirty, smallerClean, clean], NET);
  assert.equal(ranked[0].pool, clean); // 100, biggest stake
  assert.equal(ranked[1].pool, smallerClean); // 100
  assert.equal(ranked[2].pool, dirty); // 80
  assert.equal(ranked[2].score.score, 80);
});

test("rankByHealth: every entry carries its own flags", () => {
  const dirty = normalizePoolRow(rawPool({ relays: [] }));
  const [one] = rankByHealth([dirty], NET);
  assert.ok(one.flags.some((f) => f.code === "no-relays"));
});

test("poolHealthFlags: throws on missing args", () => {
  assert.throws(() => poolHealthFlags(null, NET), /pool/);
  assert.throws(() => poolHealthFlags({ activeStakeAda: 1 }, null), /network/);
});
