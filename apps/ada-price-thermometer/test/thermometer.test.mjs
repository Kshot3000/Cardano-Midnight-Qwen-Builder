import test from "node:test";
import assert from "node:assert/strict";
import {
  SOURCES,
  MINS_URL,
  COINGECKO_URL,
  LLAMA_URL,
  normalizeMinswap,
  normalizeCoinGecko,
  normalizeLlama,
  buildSources,
  median,
  consensus,
  agreementScore,
  agreementLabel,
  trendFromChange,
  deviationPct,
  fmtUsdPrice,
  fmtPct,
  gaugeFill,
} from "../src/thermometer.js";

// --- constants -------------------------------------------------------------
test("URLs are the verified keyless endpoints", () => {
  assert.equal(MINS_URL, "https://agg-api.minswap.org/aggregator/ada-price?currency=usd");
  assert.equal(
    COINGECKO_URL,
    "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true"
  );
  assert.equal(LLAMA_URL, "https://coins.llama.fi/prices/current/coingecko:cardano");
});

test("SOURCES has the three fixed sources", () => {
  assert.deepEqual(Object.keys(SOURCES), ["mins", "cg", "llama"]);
});

// --- normalizers -----------------------------------------------------------
test("normalizeMinswap happy path", () => {
  const r = normalizeMinswap({ currency: "usd", value: { price: 0.219917, change_24h: 8.835 } });
  assert.equal(r.price, 0.219917);
  assert.equal(r.change24h, 8.835);
});

test("normalizeMinswap tolerates missing change_24h", () => {
  const r = normalizeMinswap({ value: { price: 0.5 } });
  assert.equal(r.price, 0.5);
  assert.equal(r.change24h, null);
});

test("normalizeMinswap rejects null / value-less / non-positive / NaN", () => {
  assert.equal(normalizeMinswap(null), null);
  assert.equal(normalizeMinswap({}), null);
  assert.equal(normalizeMinswap({ value: {} }), null);
  assert.equal(normalizeMinswap({ value: { price: 0 } }), null);
  assert.equal(normalizeMinswap({ value: { price: -1 } }), null);
  assert.equal(normalizeMinswap({ value: { price: NaN } }), null);
});

test("normalizeCoinGecko happy path", () => {
  const r = normalizeCoinGecko({ cardano: { usd: 0.219415, usd_24h_change: 9.12 } });
  assert.equal(r.price, 0.219415);
  assert.equal(r.change24h, 9.12);
});

test("normalizeCoinGecko tolerates missing change and rejects bad input", () => {
  assert.equal(normalizeCoinGecko({ cardano: { usd: 1.2 } }).change24h, null);
  assert.equal(normalizeCoinGecko(null), null);
  assert.equal(normalizeCoinGecko({}), null);
  assert.equal(normalizeCoinGecko({ cardano: {} }), null);
  assert.equal(normalizeCoinGecko({ cardano: { usd: 0 } }), null);
});

test("normalizeLlama happy path (no 24h change)", () => {
  const r = normalizeLlama({ coins: { "coingecko:cardano": { price: 0.219868, symbol: "ADA" } } });
  assert.equal(r.price, 0.219868);
  assert.equal(r.change24h, null);
});

test("normalizeLlama rejects empty coins / missing id / bad price", () => {
  assert.equal(normalizeLlama(null), null);
  assert.equal(normalizeLlama({ coins: {} }), null);
  assert.equal(normalizeLlama({ coins: { other: { price: 1 } } }), null);
  assert.equal(normalizeLlama({ coins: { "coingecko:cardano": {} } }), null);
  assert.equal(normalizeLlama({ coins: { "coingecko:cardano": { price: -2 } } }), null);
});

// --- buildSources ----------------------------------------------------------
test("buildSources keeps fixed order and marks failures", () => {
  const s = buildSources({
    mins: { value: { price: 0.22, change_24h: 1 } },
    cg: null, // failed
    llama: { coins: { "coingecko:cardano": { price: 0.2199 } } },
  });
  assert.deepEqual(s.map((x) => x.id), ["mins", "cg", "llama"]);
  assert.equal(s[0].ok, true);
  assert.equal(s[0].price, 0.22);
  assert.equal(s[1].ok, false);
  assert.equal(s[1].price, null);
  assert.equal(s[2].ok, true);
  assert.equal(s[2].price, 0.2199);
});

// --- median ----------------------------------------------------------------
test("median odd/even/empty/single", () => {
  assert.equal(median([3]), 3);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 5]), 5);
  assert.equal(median(null), null);
});

// --- consensus -------------------------------------------------------------
test("consensus over a normal set", () => {
  const cons = consensus([
    { price: 0.22 },
    { price: 0.2199 },
    { price: 0.2194 },
  ]);
  assert.equal(cons.n, 3);
  assert.ok(Math.abs(cons.median - 0.2199) < 1e-9);
  assert.equal(cons.min, 0.2194);
  assert.equal(cons.max, 0.22);
  assert.ok(cons.spreadPct > 0 && cons.spreadPct < 0.5, "tiny spread in pct");
});

test("consensus single price -> 0 spread (trivially consistent)", () => {
  const cons = consensus([{ price: 0.22 }, { price: null }, { price: "x" }, {}]);
  assert.equal(cons.n, 1);
  assert.equal(cons.median, 0.22);
  assert.equal(cons.spreadPct, 0);
});

test("consensus empty returns all-null shape", () => {
  const cons = consensus([]);
  assert.deepEqual(cons, { median: null, n: 0, min: null, max: null, spreadPct: null });
});

// --- agreementScore --------------------------------------------------------
test("agreementScore null with <2 sources", () => {
  assert.equal(agreementScore({ n: 1, spreadPct: 0 }), null);
  assert.equal(agreementScore({ n: 0 }), null);
  assert.equal(agreementScore(null), null);
});

test("agreementScore: 3 sources, 0.005% spread -> 100", () => {
  const score = agreementScore({ n: 3, spreadPct: 0.005 });
  assert.equal(score, 100);
});

test("agreementScore: 2 sources, 0 spread -> 67 (100 scaled to 2/3)", () => {
  const score = agreementScore({ n: 2, spreadPct: 0 });
  assert.equal(score, 67);
});

test("agreementScore: 3 sources, 2.0% spread -> 20", () => {
  const score = agreementScore({ n: 3, spreadPct: 2.0 });
  assert.equal(score, 20);
});

test("agreementScore: 3 sources, 10% spread (clamped) -> 0", () => {
  assert.equal(agreementScore({ n: 3, spreadPct: 10 }), 0);
});

test("agreementScore: 3 sources, 0.1% spread -> 96", () => {
  // base = 100 - 0.1*40 = 96 ; scaled = 96 * 3/3 = 96
  assert.equal(agreementScore({ n: 3, spreadPct: 0.1 }), 96);
});

// --- agreementLabel --------------------------------------------------------
test("agreementLabel buckets", () => {
  assert.equal(agreementLabel(null).label, "Indeterminate");
  assert.equal(agreementLabel(100).label, "Strong consensus");
  assert.equal(agreementLabel(85).label, "Strong consensus");
  assert.equal(agreementLabel(60).label, "Solid consensus");
  assert.equal(agreementLabel(40).label, "Softening agreement");
  assert.equal(agreementLabel(0).label, "Divergent sources");
});

// --- trendFromChange -------------------------------------------------------
test("trendFromChange buckets", () => {
  assert.equal(trendFromChange(null), null);
  assert.equal(trendFromChange(NaN), null);
  assert.equal(trendFromChange(2).label, "Warming up");
  assert.equal(trendFromChange(9.12).label, "Warming up");
  assert.equal(trendFromChange(1.99).label, "Holding steady");
  assert.equal(trendFromChange(0).label, "Holding steady");
  assert.equal(trendFromChange(-2.01).label, "Cooling down");
  assert.equal(trendFromChange(-4.9).label, "Cooling down");
  assert.equal(trendFromChange(-5.01).label, "Chilling");
  assert.equal(trendFromChange(-20).label, "Chilling");
});

// --- deviationPct ----------------------------------------------------------
test("deviationPct", () => {
  assert.ok(Math.abs(deviationPct(0.22, 0.2) - 10) < 1e-9);
  assert.equal(deviationPct(0.2, 0.2), 0);
  assert.equal(deviationPct(null, 0.2), null);
  assert.equal(deviationPct(0.22, 0), null);
  assert.equal(deviationPct(0.22, null), null);
});

// --- formatting ------------------------------------------------------------
test("fmtUsdPrice adaptive precision", () => {
  assert.equal(fmtUsdPrice(0.219415), "$0.21942");
  assert.equal(fmtUsdPrice(12.3456), "$12.346");
  assert.equal(fmtUsdPrice(1234.5), "$1,234.50");
  assert.equal(fmtUsdPrice(0), "$0.00000");
  assert.equal(fmtUsdPrice(null), "–");
  assert.equal(fmtUsdPrice(NaN), "–");
});

test("fmtPct with/without plus", () => {
  assert.equal(fmtPct(9.12), "+9.12%");
  assert.equal(fmtPct(-3.4), "-3.40%");
  assert.equal(fmtPct(0), "+0.00%");
  assert.equal(fmtPct(0, false), "0.00%");
  assert.equal(fmtPct(null), "–");
});

test("gaugeFill clamps and handles null", () => {
  assert.equal(gaugeFill(null), 0);
  assert.equal(gaugeFill(0), 0);
  assert.equal(gaugeFill(50), 0.5);
  assert.equal(gaugeFill(100), 1);
  assert.equal(gaugeFill(200), 1);
  assert.equal(gaugeFill(-10), 0);
});
