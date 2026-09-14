// NIGHT Market Tracker — Node.js test suite.
// Run: node --test apps/night-market/test/market.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NIGHT,
  pickNum,
  extractToken,
  extractMarket,
  cleanSeries,
  marketStats,
  downsample,
  sparkHeights,
  volatility,
  marketHealth,
  pctText,
  usdText,
  nightText,
  agoLabel,
} from "../src/nightmarket.js";

// ── pickNum ────────────────────────────────────────────────────────────────

test("pickNum returns the finite number for the currency", () => {
  assert.equal(pickNum({ usd: 0.0142, eur: 0.013 }, "usd"), 0.0142);
  assert.equal(pickNum({ eur: 0.013 }, "eur"), 0.013);
});

test("pickNum defaults to usd and rejects non-numbers / missing", () => {
  assert.equal(pickNum({ usd: 5 }), 5);
  assert.equal(pickNum({ usd: "3.14" }), null);
  assert.equal(pickNum({ usd: NaN }), null);
  assert.equal(pickNum({ usd: Infinity }), null);
  assert.equal(pickNum({}), null);
  assert.equal(pickNum(null), null);
  assert.equal(pickNum(undefined, "btc"), null);
  assert.equal(pickNum("nope"), null);
});

// ── extractToken ────────────────────────────────────────────────────────────

test("extractToken pulls identity + Cardano policy and cross-checks NIGHT", () => {
  const coin = {
    id: "midnight-3",
    symbol: "night",
    name: "Midnight",
    market_cap_rank: 128,
    platforms: {
      cardano: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
      "binance-smart-chain": "0xfe930c2d63aed9b82fc4dbc801920dd2c1a3224f",
    },
    detail_platforms: { cardano: { decimal_place: 6, contract_address: "0691b2" } },
    links: { homepage: ["https://docs.midnight.network/"], twitter_screen_name: "MidnightNtwrk" },
  };
  const t = extractToken(coin);
  assert.equal(t.id, "midnight-3");
  assert.equal(t.symbol, "night");
  assert.equal(t.name, "Midnight");
  assert.equal(t.rank, 128);
  assert.equal(t.cardanoPolicy, "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa");
  assert.equal(t.bscPolicy, "0xfe930c2d63aed9b82fc4dbc801920dd2c1a3224f");
  assert.equal(t.decimals, 6);
  assert.equal(t.policyMatchesNIGHT, true);
  assert.equal(t.homePage, "https://docs.midnight.network/");
  assert.equal(t.twitter, "@MidnightNtwrk");
});

test("extractToken flags a mismatched Cardano policy", () => {
  const t = extractToken({ platforms: { cardano: "abcd0000" } });
  assert.equal(t.policyMatchesNIGHT, false);
});

test("extractToken is null-safe on empty / weird input", () => {
  const t = extractToken(null);
  assert.equal(t.id, null);
  assert.equal(t.rank, null);
  assert.equal(t.cardanoPolicy, null);
  assert.equal(t.policyMatchesNIGHT, false);
  assert.equal(t.decimals, null);
  assert.equal(t.twitter, null);
  const t2 = extractToken({ market_cap_rank: "12", platforms: { cardano: null } });
  assert.equal(t2.rank, null);
  assert.equal(t2.cardanoPolicy, null);
});

test("NIGHT constant policy id is a 56-hex Cardano policy", () => {
  assert.match(NIGHT.policyId, /^[0-9a-f]{56}$/);
  assert.equal(NIGHT.decimals, 6);
  assert.equal(NIGHT.maxSupplyNight, 24_000_000_000);
});

// ── extractMarket ───────────────────────────────────────────────────────────

test("extractMarket reads all fields from a real-shaped payload", () => {
  const coin = {
    market_data: {
      current_price: { usd: 0.014202954210383156 },
      high_24h: { usd: 0.0161 },
      low_24h: { usd: 0.0138 },
      market_cap: { usd: 336945674 },
      fully_diluted_valuation: { usd: 340515200 },
      total_volume: { usd: 18431297 },
      circulating_supply: 23_719_614_480,
      total_supply: 24_000_000_000,
      max_supply: 24_000_000_000,
      price_change_percentage_24h_in_currency: { usd: -33.61 },
      price_change_percentage_7d_in_currency: { usd: -51.12 },
      price_change_percentage_14d_in_currency: { usd: -48.3 },
      price_change_percentage_30d_in_currency: { usd: -57.4 },
      ath: { usd: 0.08147 },
      ath_change_percentage: { usd: -82.56 },
      last_updated: "2026-09-14T12:00:00.000Z",
    },
  };
  const m = extractMarket(coin);
  assert.equal(m.price, 0.014202954210383156);
  assert.equal(m.high24h, 0.0161);
  assert.equal(m.low24h, 0.0138);
  assert.equal(m.marketCap, 336945674);
  assert.equal(m.fdv, 340515200);
  assert.equal(m.volume24h, 18431297);
  assert.equal(m.circulating, 23_719_614_480);
  assert.equal(m.total, 24_000_000_000);
  assert.equal(m.max, 24_000_000_000);
  assert.equal(m.change24h, -33.61);
  assert.equal(m.change7d, -51.12);
  assert.equal(m.change14d, -48.3);
  assert.equal(m.change30d, -57.4);
  assert.equal(m.ath, 0.08147);
  assert.equal(m.athChangePct, -82.56);
  assert.equal(m.lastUpdated, "2026-09-14T12:00:00.000Z");
});

test("extractMarket null-safety: missing pieces stay null, never NaN", () => {
  const m = extractMarket(null);
  for (const k of Object.keys(m)) assert.equal(m[k], null);
  const m2 = extractMarket({ market_data: { current_price: { usd: "oops" }, total_volume: null } });
  assert.equal(m2.price, null);
  assert.equal(m2.volume24h, null);
});

// ── cleanSeries ─────────────────────────────────────────────────────────────

test("cleanSeries sorts, drops junk and de-dupes timestamps", () => {
  const raw = [
    [200, 3], [100, 1], [300, 9], [200, 4], // duplicate t=200
    [400, 7], [null, 1], [500, "x"], [600], [700, NaN], [800, Infinity],
  ];
  const s = cleanSeries(raw);
  assert.deepEqual(s.map((p) => p.t), [100, 200, 300, 400]);
  assert.deepEqual(s.map((p) => p.v), [1, 3, 9, 7]);
  assert.deepEqual(cleanSeries([]), []);
  assert.deepEqual(cleanSeries(null), []);
});

// ── marketStats ─────────────────────────────────────────────────────────────

test("marketStats computes full 7d stats", () => {
  const prices = [[0, 1], [1000, 2], [2000, 4], [3000, 3]].map(([t, v]) => ({ t, v }));
  const st = marketStats(prices);
  assert.equal(st.points, 4);
  assert.equal(st.first, 1);
  assert.equal(st.last, 3);
  assert.equal(st.high, 4);
  assert.equal(st.low, 1);
  assert.ok(Math.abs(st.avg - 2.5) < 1e-12);
  assert.ok(Math.abs(st.changePct - 200) < 1e-9); // (3-1)/1
  assert.equal(st.hiT, 2000);
  assert.equal(st.loT, 0);
});

test("marketStats edge cases", () => {
  const empty = marketStats([]);
  assert.equal(empty.points, 0);
  assert.equal(empty.changePct, null);
  assert.equal(empty.high, null);
  const one = marketStats([{ t: 0, v: 5 }]);
  assert.equal(one.points, 1);
  assert.equal(one.changePct, null);
  const zeroFirst = marketStats([{ t: 0, v: 0 }, { t: 1, v: 5 }]);
  assert.equal(zeroFirst.changePct, null); // first = 0 -> undefined pct
});

// ── downsample ──────────────────────────────────────────────────────────────

test("downsample keeps bucket maxima and returns exactly `bars` entries", () => {
  const prices = [];
  for (let i = 0; i < 100; i++) prices.push({ t: i, v: i % 10 === 9 ? 100 : i });
  const ds = downsample(prices, 10);
  assert.equal(ds.length, 10);
  // every bucket of 10 contains an i%10===9 spike -> value 100
  assert.ok(ds.every((p) => p.v === 100));
  // monotonic timestamps
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i].t >= ds[i - 1].t);
});

test("downsample edge cases", () => {
  assert.deepEqual(downsample([]), []);
  assert.deepEqual(downsample(null, 8), []);
  assert.deepEqual(downsample([{ t: 0, v: 1 }], 0), []);
  const one = downsample([{ t: 0, v: 42 }], 5);
  assert.equal(one.length, 1);
  assert.equal(one[0].v, 42);
  // more bars than points -> at most one point
  assert.equal(downsample([{ t: 0, v: 1 }, { t: 1, v: 2 }], 50).length, 2);
});

// ── sparkHeights ────────────────────────────────────────────────────────────

test("sparkHeights scales to max, clamps to [0,100]", () => {
  const h = sparkHeights([{ t: 0, v: 50 }, { t: 1, v: 100 }, { t: 2, v: 0 }]);
  assert.deepEqual(h, [50, 100, 0]);
  assert.deepEqual(sparkHeights([]), []);
  assert.deepEqual(sparkHeights([{ t: 0, v: 0 }]), [0]);
});

// ── volatility ──────────────────────────────────────────────────────────────

test("volatility of a flat series is 0", () => {
  const prices = [0, 1, 2, 3].map((t) => ({ t, v: 2 }));
  assert.ok(Math.abs(volatility(prices)) < 1e-12);
});

test("volatility of a perfectly alternating +10%/-10% series", () => {
  // 100 -> 110 -> 99 -> 108.9 : returns +10%, -10%, +10%
  const prices = [
    { t: 0, v: 100 }, { t: 1, v: 110 }, { t: 2, v: 99 }, { t: 3, v: 108.9 },
  ];
  const rets = [0.1, -0.1, 0.1];
  const mean = 0.1 / 3;
  const expect = Math.sqrt(((rets[0] - mean) ** 2 + (rets[1] - mean) ** 2 + (rets[2] - mean) ** 2) / 3) * 100;
  assert.ok(Math.abs(volatility(prices) - expect) < 1e-9);
});

test("volatility null on <2 points or zero previous value", () => {
  assert.equal(volatility([]), null);
  assert.equal(volatility([{ t: 0, v: 1 }]), null);
  assert.equal(volatility([{ t: 0, v: 0 }, { t: 1, v: 5 }]), null);
});

// ── marketHealth ────────────────────────────────────────────────────────────

test("marketHealth: all-pass market scores 100 and is 'strong'", () => {
  const prices = [
    { t: 0, v: 0.02 }, { t: 1000, v: 0.021 }, { t: 2000, v: 0.02 }, { t: 3000, v: 0.0205 },
  ];
  const stats = marketStats(prices);
  const vol = volatility(prices);
  const h = marketHealth({
    market: {
      price: 0.0205, marketCap: 400_000_000, volume24h: 10_000_000,
      circulating: 20_000_000_000, change24h: 1.2,
    },
    stats,
    token: { policyMatchesNIGHT: true },
    volatility: vol,
  });
  assert.equal(h.score, 100);
  assert.equal(h.status, "strong");
  assert.ok(h.checks.every((c) => c.pass));
  assert.equal(h.checks.length, 7);
  // points add up exactly to 100
  assert.equal(h.checks.reduce((s, c) => s + c.pts, 0), 100);
});

test("marketHealth: empty market scores 0 and is 'weak'", () => {
  const h = marketHealth({ market: {}, stats: { points: 0 }, token: {} });
  assert.equal(h.score, 0);
  assert.equal(h.status, "weak");
  assert.ok(h.checks.every((c) => !c.pass));
});

test("marketHealth: negative momentum loses points, bad turnover loses points", () => {
  const h = marketHealth({
    market: { price: 1, marketCap: 1_000_000, volume24h: 10, circulating: 100, change24h: -5 },
    stats: { points: 0 },
    token: { policyMatchesNIGHT: false },
    volatility: null,
  });
  const labels = Object.fromEntries(h.checks.map((c) => [c.label, c.pass]));
  assert.equal(labels["Positive 24h momentum"], false);
  assert.equal(labels["Healthy 24h turnover (0.25% – 20% of cap)"], false); // 0.001%
  assert.equal(h.score, 25 + 10); // core + supply only
});

test("marketHealth: supply above the 24B cap fails the sanity check", () => {
  const h = marketHealth({
    market: { price: 1, marketCap: 1e6, volume24h: 1e4, circulating: 30_000_000_000, change24h: 1 },
    stats: { points: 0 },
    token: { policyMatchesNIGHT: true },
  });
  const c = h.checks.find((c) => c.label.includes("24B cap"));
  assert.equal(c.pass, false);
  // turnover 1e4/1e6 = 1% is within range
  const t = h.checks.find((c) => c.label.includes("turnover"));
  assert.equal(t.pass, true);
});

test("marketHealth: exact rubric arithmetic for a mid-pack market", () => {
  // core 25 + momentum 20 + turnover 10 + history 15 = 70 -> 'strong'
  const h = marketHealth({
    market: { price: 1, marketCap: 1_000_000, volume24h: 10_000, circulating: 1e9, change24h: 2 },
    stats: { points: 10 },
    token: { policyMatchesNIGHT: false },
    volatility: 50, // > 25 -> stability fails
  });
  assert.equal(h.score, 25 + 20 + 10 + 15 + 10); // +10 supply
  assert.equal(h.status, "strong");
});

// ── formatters ──────────────────────────────────────────────────────────────

test("pctText signs and formats", () => {
  assert.equal(pctText(3.416), "+3.42%");
  assert.equal(pctText(-1.05), "-1.05%");
  assert.equal(pctText(0), "+0.00%");
  assert.equal(pctText(null), "–");
  assert.equal(pctText(NaN), "–");
  assert.equal(pctText(12.345, 1), "+12.3%");
});

test("usdText: sub-cent uses 6dp, big uses compact, null uses dash", () => {
  assert.equal(usdText(0.014202954), "$0.014203");
  assert.equal(usdText(336945674), "$336,945,674.0000");
  assert.equal(usdText(336_945_674, { big: true }), "$336.9M");
  assert.equal(usdText(null), "–");
  assert.equal(usdText(5, { digits: 0 }), "$5");
  assert.equal(usdText(NaN), "–");
});

test("nightText formats supply with separators", () => {
  assert.equal(nightText(24_000_000_000), "24,000,000,000 NIGHT");
  assert.equal(nightText(1234.7), "1,235 NIGHT");
  assert.equal(nightText(null), "–");
});

test("agoLabel buckets elapsed time", () => {
  const now = 1_000_000_000_000;
  assert.equal(agoLabel(now - 30_000, now), "30s ago");
  assert.equal(agoLabel(now - 5 * 60_000, now), "5m ago");
  assert.equal(agoLabel(now - 3 * 3600_000, now), "3h ago");
  assert.equal(agoLabel(now - 5 * 24 * 3600_000, now), "5d ago");
  assert.equal(agoLabel(null, now), "–");
  assert.equal(agoLabel(now + 1000, now), "0s ago"); // future clamps to 0
});
