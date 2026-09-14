"use strict";
/**
 * NIGHT Market Tracker — pure metric functions for the Midnight NIGHT token.
 *
 * Data source: CoinGecko public API (CORS-enabled, no key):
 *   GET /coins/midnight-3
 *     -> { id, symbol, name, market_cap_rank,
 *          platforms: { cardano: <policy-hex>, "binance-smart-chain": <hex> },
 *          detail_platforms: { cardano: { decimal_place, contract_address } },
 *          links: { homepage: [...], twitter_screen_name, ... },
 *          market_data: {
 *            current_price: { usd, btc, eth, ... },
 *            market_cap: { usd, ... },
 *            fully_diluted_valuation: { usd, ... },
 *            total_volume: { usd, ... },
 *            high_24h: { usd, ... }, low_24h: { usd, ... },
 *            circulating_supply, total_supply, max_supply,
 *            price_change_percentage_24h_in_currency: { usd },
 *            price_change_percentage_7d_in_currency: { usd },
 *            price_change_percentage_14d_in_currency: { usd },
 *            price_change_percentage_30d_in_currency: { usd },
 *            ath: { usd }, ath_change_percentage: { usd },
 *            last_updated: "2026-..."
 *          } }
 *   GET /coins/midnight-3/market_chart?vs_currency=usd&days=7
 *     -> { prices: [[ms, price], ...], market_caps: [[ms, cap], ...],
 *          total_volumes: [[ms, vol], ...] }
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/** Midnight NIGHT token constants (Cardano native asset). */
export const NIGHT = {
  coingeckoId: "midnight-3",
  symbol: "NIGHT",
  name: "Midnight",
  /** On-chain Cardano policy id (= CoinGecko `platforms.cardano`). */
  policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  decimals: 6,
  /** Public max supply: 24,000,000,000 NIGHT (24B). */
  maxSupplyNight: 24_000_000_000,
  homePage: "https://docs.midnight.network/",
};

/**
 * Pick one value from a CoinGecko multi-currency object.
 * `src` may be null/undefined or a {usd: n, eur: n, ...} map.
 * @param {?Object} src
 * @param {string} [currency="usd"]
 * @returns {?number} finite number or null (never NaN, never a string)
 */
export function pickNum(src, currency = "usd") {
  if (src == null) return null;
  if (typeof src === "number") return Number.isFinite(src) ? src : null;
  if (typeof src !== "object") return null;
  const v = src[currency];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Extract the token identity + platform facts from a CoinGecko coin object.
 * The Cardano policy id is cross-checked against the known NIGHT policy.
 * @param {Object} coin
 * @returns {{id:?string, symbol:?string, name:?string, rank:?number,
 *            cardanoPolicy:?string, bscPolicy:?string, decimals:?number,
 *            policyMatchesNIGHT:boolean, homePage:?string, twitter:?string}}
 */
export function extractToken(coin) {
  const c = coin || {};
  const platforms = c.platforms || {};
  const detail = c.detail_platforms || {};
  const cardano = (detail.cardano || {}).decimal_place != null
    ? detail.cardano.decimal_place
    : null;
  const links = c.links || {};
  const cardanoPolicy = platforms.cardano != null ? String(platforms.cardano) : null;
  const bscPolicy =
    platforms["binance-smart-chain"] != null
      ? String(platforms["binance-smart-chain"])
      : null;
  return {
    id: typeof c.id === "string" ? c.id : null,
    symbol: typeof c.symbol === "string" ? c.symbol : null,
    name: typeof c.name === "string" ? c.name : null,
    rank: typeof c.market_cap_rank === "number" ? c.market_cap_rank : null,
    cardanoPolicy,
    bscPolicy,
    decimals: cardano,
    policyMatchesNIGHT:
      cardanoPolicy != null &&
      cardanoPolicy.toLowerCase() === NIGHT.policyId.toLowerCase(),
    homePage: Array.isArray(links.homepage) && links.homepage[0] ? links.homepage[0] : null,
    twitter: links.twitter_screen_name ? `@${links.twitter_screen_name}` : null,
  };
}

/**
 * Extract the market snapshot from `coin.market_data`.
 * All numeric fields are null when missing — the UI renders "–", never 0.
 * @param {Object} coin
 * @returns {{price:?number, high24h:?number, low24h:?number,
 *            marketCap:?number, fdv:?number, volume24h:?number,
 *            circulating:?number, total:?number, max:?number,
 *            change24h:?number, change7d:?number, change14d:?number, change30d:?number,
 *            ath:?number, athChangePct:?number, lastUpdated:?string}}
 */
export function extractMarket(coin) {
  const md = (coin && coin.market_data) || {};
  return {
    price: pickNum(md.current_price),
    high24h: pickNum(md.high_24h),
    low24h: pickNum(md.low_24h),
    marketCap: pickNum(md.market_cap),
    fdv: pickNum(md.fully_diluted_valuation),
    volume24h: pickNum(md.total_volume),
    circulating: pickNum(md.circulating_supply),
    total: pickNum(md.total_supply),
    max: pickNum(md.max_supply),
    change24h: pickNum(md.price_change_percentage_24h_in_currency),
    change7d: pickNum(md.price_change_percentage_7d_in_currency),
    change14d: pickNum(md.price_change_percentage_14d_in_currency),
    change30d: pickNum(md.price_change_percentage_30d_in_currency),
    ath: pickNum(md.ath),
    athChangePct: pickNum(md.ath_change_percentage),
    lastUpdated:
      typeof md.last_updated === "string" ? md.last_updated : null,
  };
}

/**
 * Normalize a CoinGecko `[[ms, value], ...]` series to chronological
 * `{t, v}` rows. Filters out non-finite entries and duplicates (CoinGecko
 * sometimes repeats the final point).
 * @param {Array<[number, number]>} raw
 * @returns {Array<{t:number, v:number}>}
 */
export function cleanSeries(raw) {
  const rows = [];
  const seen = new Set();
  for (const pt of raw || []) {
    let t, v;
    if (Array.isArray(pt)) {
      if (pt.length < 2) continue;
      t = pt[0]; v = pt[1];
    } else if (pt && typeof pt === "object") {
      t = pt.t; v = pt.v;
    } else {
      continue;
    }
    if (t == null || v == null) continue;
    t = Number(t);
    v = Number(v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    rows.push({ t, v });
  }
  return rows.sort((a, b) => a.t - b.t);
}

/**
 * 7-day statistics from a cleaned price series.
 * @param {Array<{t:number, v:number}>} prices
 * @returns {{points:number, first:?number, last:?number,
 *            high:?number, low:?number, avg:?number,
 *            changePct:?number, hiT:?number, loT:?number}}
 *  `changePct` is null when < 2 points or the first price is 0.
 */
export function marketStats(prices) {
  const s = cleanSeries(prices);
  if (!s.length) {
    return { points: 0, first: null, last: null, high: null, low: null, avg: null, changePct: null, hiT: null, loT: null };
  }
  let high = -Infinity, low = Infinity, hiT = s[0].t, loT = s[0].t, sum = 0;
  for (const p of s) {
    if (p.v > high) { high = p.v; hiT = p.t; }
    if (p.v < low) { low = p.v; loT = p.t; }
    sum += p.v;
  }
  const first = s[0].v;
  const last = s[s.length - 1].v;
  return {
    points: s.length,
    first,
    last,
    high,
    low,
    avg: sum / s.length,
    changePct: s.length >= 2 && first !== 0 ? ((last - first) / first) * 100 : null,
    hiT,
    loT,
  };
}

/**
 * Downsample a price series into `bars` buckets, each taking the bucket
 * MAX price (keeps spikes visible in a sparkline). Always returns exactly
 * `bars` entries when the input has at least one point; fewer when empty.
 * @param {Array<{t:number, v:number}>} prices
 * @param {number} [bars=48]
 * @returns {Array<{t:number, v:number}>}
 */
export function downsample(prices, bars = 48) {
  const s = cleanSeries(prices);
  if (!s.length || bars <= 0) return [];
  const b = Math.min(bars, s.length);
  const out = [];
  for (let i = 0; i < b; i++) {
    const a = Math.floor((i * s.length) / bars);
    const end = Math.max(a + 1, Math.floor(((i + 1) * s.length) / bars));
    let best = null;
    for (let j = a; j < end && j < s.length; j++) {
      if (best == null || s[j].v > best.v) best = s[j];
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Normalized 0–100 sparkline bar heights for a series.
 * Bars are scaled to the series MAX (not min) so the shape reads true.
 * @param {Array<{t:number, v:number}>} prices
 * @returns {number[]} percent values in [0, 100]
 */
export function sparkHeights(prices) {
  const s = cleanSeries(prices);
  if (!s.length) return [];
  const max = Math.max(...s.map((p) => p.v));
  if (!(max > 0)) return s.map(() => 0);
  return s.map((p) => Math.max(0, Math.min(100, (p.v / max) * 100)));
}

/**
 * Volatility over a price series: population standard deviation of
 * 1-step percentage returns, in percent. Null when fewer than 2 points
 * or any return is undefined (zero/missing previous value).
 * @param {Array<{t:number, v:number}>} prices
 * @returns {?number}
 */
export function volatility(prices) {
  const s = cleanSeries(prices);
  if (s.length < 2) return null;
  const rets = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1].v;
    if (prev === 0 || !Number.isFinite(prev)) return null;
    rets.push((s[i].v - prev) / prev);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varr) * 100;
}

/**
 * Market health score: transparent 0–100 rubric for the NIGHT market.
 *
 *   +25  core data complete  (price, market cap, 24h volume,
 *         circulating supply, 24h change all present)
 *   +20  24h momentum        (change24h > 0)
 *   +10  tradable turnover   (24h volume / market cap between 0.25% and 20%)
 *   +15  7d history present  (7d stats computed from >= 2 price points)
 *   +10  7d stability        (7d volatility <= 25%)
 *   +10  supply sanity       (circulating <= max supply cap, max = 24B NIGHT)
 *   +10  policy cross-check  (CoinGecko Cardano platform == NIGHT policy id)
 *
 * Checks that cannot be evaluated are shown as "n/a", not as failures.
 * @param {{market:Object, stats:Object, token:Object, volatility:?number}} args
 * @returns {{score:number, status:string, checks:Array<{label:string, pass:boolean, pts:number}>}}
 */
export function marketHealth({ market, stats, token, volatility: volArg }) {
  const m = market || {};
  const st = stats || {};
  const tk = token || {};
  const checks = [];
  let score = 0;

  const coreOk =
    m.price != null &&
    m.marketCap != null &&
    m.volume24h != null &&
    m.circulating != null &&
    m.change24h != null;
  checks.push({ label: "Core data complete (price · cap · volume · supply · 24h Δ)", pass: coreOk, pts: coreOk ? 25 : 0 });
  score += coreOk ? 25 : 0;

  const momOk = m.change24h != null && m.change24h > 0;
  checks.push({ label: "Positive 24h momentum", pass: momOk, pts: momOk ? 20 : 0 });
  score += momOk ? 20 : 0;

  const turnover = m.volume24h != null && m.marketCap != null && m.marketCap > 0
    ? (m.volume24h / m.marketCap) * 100
    : null;
  const turnOk = turnover != null && turnover >= 0.25 && turnover <= 20;
  checks.push({ label: "Healthy 24h turnover (0.25% – 20% of cap)", pass: turnOk, pts: turnOk ? 10 : 0 });
  score += turnOk ? 10 : 0;

  const histOk = st.points != null && st.points >= 2;
  checks.push({ label: "7d price history present", pass: histOk, pts: histOk ? 15 : 0 });
  score += histOk ? 15 : 0;

  const volVal = volArg != null && Number.isFinite(volArg) ? volArg : null;
  const stabOk = volVal != null && volVal <= 25;
  checks.push({ label: "7d volatility ≤ 25%", pass: stabOk, pts: stabOk ? 10 : 0 });
  score += stabOk ? 10 : 0;

  const supplyOk =
    m.circulating != null &&
    m.circulating > 0 &&
    m.circulating <= NIGHT.maxSupplyNight;
  checks.push({ label: "Circulating supply within 24B cap", pass: supplyOk, pts: supplyOk ? 10 : 0 });
  score += supplyOk ? 10 : 0;

  const polOk = tk.policyMatchesNIGHT === true;
  checks.push({ label: "Cardano policy id matches NIGHT (on-chain cross-check)", pass: polOk, pts: polOk ? 10 : 0 });
  score += polOk ? 10 : 0;

  const status = score >= 80 ? "strong" : score >= 50 ? "fair" : "weak";
  return { score, status, checks };
}

/**
 * Format a percent-delta string like "+3.42%" / "-1.05%". Null → "–".
 * @param {?number} pct
 * @returns {string}
 */
export function pctText(pct, digits = 2) {
  if (pct == null || !Number.isFinite(pct)) return "–";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * Format a USD amount. `big` uses compact locale notation (e.g. $336.9M)
 * for large numbers; small uses fixed 6 dp for sub-cent prices.
 * @param {?number} n
 * @param {{big?:boolean, digits?:number}} [opts]
 * @returns {string}
 */
export function usdText(n, opts = {}) {
  if (n == null || !Number.isFinite(n)) return "–";
  const { big = false, digits } = opts;
  if (big && Math.abs(n) >= 1_000_000) {
    return `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
  }
  const d = digits != null ? digits : Math.abs(n) < 1 ? 6 : 4;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/**
 * Format a NIGHT supply count with thousands separators.
 * @param {?number} n
 * @returns {string}
 */
export function nightText(n) {
  if (n == null || !Number.isFinite(n)) return "–";
  return `${Math.round(n).toLocaleString("en-US")} NIGHT`;
}

/**
 * Human label for a unix-ms timestamp offset from `now` — "3h ago" etc.
 * @param {?number} tMs
 * @param {number} nowMs
 * @returns {string}
 */
export function agoLabel(tMs, nowMs) {
  if (tMs == null || !Number.isFinite(tMs)) return "–";
  const s = Math.max(0, Math.floor((nowMs - tMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
