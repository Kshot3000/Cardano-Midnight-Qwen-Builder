// thermometer.js — pure logic for the ADA Price Thermometer.
// No DOM, no fetch: everything here is testable with node --test.
//
// Concept: three independent, keyless sources quote ADA/USD — one DEX
// aggregator (Minswap) and two market aggregators (CoinGecko, DefiLlama).
// The "thermometer" measures how strongly they agree (spread) and the
// direction of the median 24h change (warming / cooling).

export const SOURCES = {
  mins: { id: "mins", label: "Minswap DEX aggregator" },
  cg: { id: "cg", label: "CoinGecko market" },
  llama: { id: "llama", label: "DefiLlama market" },
};

export const MINS_URL = "https://agg-api.minswap.org/aggregator/ada-price?currency=usd";
export const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true";
export const LLAMA_URL = "https://coins.llama.fi/prices/current/coingecko:cardano";

// --- normalizers -----------------------------------------------------------
// Each returns {price, change24h} (change24h may be null) or null when the
// payload is unusable. Never throws.

// Minswap: {"currency":"usd","value":{"change_24h":8.83,"price":0.219917}}
export function normalizeMinswap(json) {
  const v = json && json.value;
  if (!v || typeof v.price !== "number" || !isFinite(v.price) || v.price <= 0) return null;
  const chg = typeof v.change_24h === "number" && isFinite(v.change_24h) ? v.change_24h : null;
  return { price: v.price, change24h: chg };
}

// CoinGecko: {"cardano":{"usd":0.2194,"usd_24h_change":9.12}}
export function normalizeCoinGecko(json) {
  const c = json && json.cardano;
  if (!c || typeof c.usd !== "number" || !isFinite(c.usd) || c.usd <= 0) return null;
  const chg =
    typeof c.usd_24h_change === "number" && isFinite(c.usd_24h_change) ? c.usd_24h_change : null;
  return { price: c.usd, change24h: chg };
}

// DefiLlama: {"coins":{"coingecko:cardano":{"price":0.2198,"symbol":"ADA",...}}}
// No 24h change is provided.
export function normalizeLlama(json) {
  const coin = json && json.coins && json.coins["coingecko:cardano"];
  if (!coin || typeof coin.price !== "number" || !isFinite(coin.price) || coin.price <= 0) return null;
  return { price: coin.price, change24h: null };
}

// buildSources from the three normalizer inputs; keeps the fixed order and
// records which source failed so the UI can be honest about it.
export function buildSources({ mins, cg, llama }) {
  const out = [];
  for (const [key, json] of [
    ["mins", mins],
    ["cg", cg],
    ["llama", llama],
  ]) {
    const norm = { mins: normalizeMinswap, cg: normalizeCoinGecko, llama: normalizeLlama }[key](json);
    out.push({
      ...SOURCES[key],
      price: norm ? norm.price : null,
      change24h: norm ? norm.change24h : null,
      ok: !!norm,
    });
  }
  return out;
}

// --- consensus -------------------------------------------------------------

export function median(nums) {
  const a = (Array.isArray(nums) ? nums : []).filter((n) => typeof n === "number" && isFinite(n));
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// {median, n, min, max, spreadPct} over the available prices.
// spreadPct = (max-min)/median*100 — relative width of the agreement band.
export function consensus(sources) {
  const prices = (Array.isArray(sources) ? sources : [])
    .map((s) => s && s.price)
    .filter((p) => typeof p === "number" && isFinite(p) && p > 0);
  if (!prices.length) return { median: null, n: 0, min: null, max: null, spreadPct: null };
  const med = median(prices);
  const mn = Math.min(...prices);
  const mx = Math.max(...prices);
  const spread = med > 0 ? ((mx - mn) / med) * 100 : null;
  return { median: med, n: prices.length, min: mn, max: mx, spreadPct: spread };
}

// Agreement score 0–100. With <2 sources it is indeterminate (null).
// A 2.5% band width zeroes the base; the score then scales with how many of
// the 3 sources actually quoted (fewer sources = less confidence).
export function agreementScore(cons, totalSources = 3) {
  if (!cons || cons.n < 2 || cons.spreadPct == null) return null;
  const base = 100 - Math.min(cons.spreadPct, 2.5) * 40;
  const scaled = base * (cons.n / totalSources);
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function agreementLabel(score) {
  if (score == null) return { label: "Indeterminate", cls: "ind" };
  if (score >= 85) return { label: "Strong consensus", cls: "strong" };
  if (score >= 60) return { label: "Solid consensus", cls: "solid" };
  if (score >= 40) return { label: "Softening agreement", cls: "soft" };
  return { label: "Divergent sources", cls: "div" };
}

// Direction of the median 24h change. Null when no source reports a change.
export function trendFromChange(change24h) {
  if (typeof change24h !== "number" || !isFinite(change24h)) return null;
  if (change24h >= 2) return { label: "Warming up", cls: "warm", dir: 1 };
  if (change24h > -2) return { label: "Holding steady", cls: "steady", dir: 0 };
  if (change24h >= -5) return { label: "Cooling down", cls: "cool", dir: -1 };
  return { label: "Chilling", cls: "chill", dir: -1 };
}

// Deviation of one price from the consensus median, in percent (null-safe).
export function deviationPct(price, med) {
  if (typeof price !== "number" || typeof med !== "number" || !med) return null;
  return ((price - med) / med) * 100;
}

// --- formatting --------------------------------------------------------------

// Adaptive-precision USD price: $0.21941 / $12.345 / $1,234.
export function fmtUsdPrice(n) {
  if (typeof n !== "number" || !isFinite(n)) return "–";
  const abs = Math.abs(n);
  const digits = abs < 1 ? 5 : abs < 100 ? 3 : 2;
  return (
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  );
}

export function fmtPct(n, withPlus = true) {
  if (typeof n !== "number" || !isFinite(n)) return "–";
  const s = (n >= 0 && withPlus ? "+" : "") + n.toFixed(2) + "%";
  return s;
}

// Thermometer fill 0..1 from a score (for the CSS gauge).
export function gaugeFill(score) {
  if (score == null) return 0;
  return Math.max(0, Math.min(1, score / 100));
}
