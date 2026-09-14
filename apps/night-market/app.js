/* NIGHT Market Tracker — live Midnight NIGHT token market dashboard.
   Data: CoinGecko public API (CORS-enabled, no key):
     GET /coins/midnight-3              -> identity, platforms, market_data
     GET /coins/midnight-3/market_chart -> 7d prices / market caps / volumes
   All metric logic lives in src/nightmarket.js (26 unit tests).
*/
import {
  NIGHT,
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
} from "./src/nightmarket.js";

const API = "https://api.coingecko.com/api/v3";
const REFRESH_MS = 120_000; // CoinGecko free tier: be polite

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function getJSON(path) {
  const r = await fetch(API + path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

function setLive(ok, label) {
  const dot = $("live-dot");
  const txt = $("live-text");
  if (dot) dot.classList.toggle("stale", !ok);
  if (txt) txt.textContent = ok ? (label || "live") : "stale — retrying";
}

function deltaEl(pct) {
  if (pct == null) return `<span style="color:var(--muted)">–</span>`;
  const cls = pct > 0 ? "delta up" : pct < 0 ? "delta down" : "";
  return `<span class="${cls}">${pct >= 0 ? "▲" : "▼"} ${pctText(pct)}</span>`;
}

function renderGauge(h) {
  const g = $("gauge");
  const color = h.score >= 80 ? "var(--green)" : h.score >= 50 ? "var(--amber)" : "var(--red)";
  g.style.setProperty("--pct", h.score);
  g.style.setProperty("--gc", color);
  $("gauge-n").textContent = h.score;
  $("gauge-s").textContent = h.status;
  $("gauge-n").style.color = color;
  $("checks").innerHTML = h.checks
    .map(
      (c) =>
        `<li class="${c.pass ? "pass" : ""}"><span class="${c.pass ? "ok" : "no"}">${c.pass ? "✓" : "✗"}</span> ${esc(c.label)} <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">+${c.pts}</span></li>`
    )
    .join("");
}

function renderToken(tk) {
  $("token-rank").textContent = tk.rank != null ? `#${tk.rank}` : "–";
  $("token-name").textContent = tk.name || "–";
  const pol = $("policy");
  if (tk.cardanoPolicy) {
    pol.innerHTML = `
      <div class="policy-row"><span>Cardano (native asset)</span><code>${esc(tk.cardanoPolicy)}</code></div>
      <div class="policy-row ${tk.policyMatchesNIGHT ? "match" : "mismatch"}">
        <span>${tk.policyMatchesNIGHT ? "✓ matches NIGHT policy" : "✗ does NOT match NIGHT policy"}</span>
        <span style="font-size:11px">${tk.policyMatchesNIGHT ? "on-chain cross-check passed" : "verify manually"}</span>
      </div>`;
  } else {
    pol.innerHTML = '<div class="policy-row" style="color:var(--muted)">Cardano policy not reported</div>';
  }
  if (tk.bscPolicy) {
    $("bsc-policy").textContent = `BSC: <code>${esc(tk.bscPolicy)}</code>`;
  }
  const links = [];
  if (tk.homePage) links.push(`<a href="${esc(tk.homePage)}" target="_blank" rel="noopener">docs</a>`);
  if (tk.twitter) links.push(`<a href="https://x.com/${esc(tk.twitter.slice(1))}" target="_blank" rel="noopener">${esc(tk.twitter)}</a>`);
  if (tk.id) links.push(`<a href="https://www.coingecko.com/en/coins/${esc(tk.id)}" target="_blank" rel="noopener">CoinGecko</a>`);
  $("token-links").innerHTML = links.join(" · ");
}

function renderMarket(m, tk) {
  $("price").textContent = usdText(m.price);
  $("price-delta-24h").innerHTML = deltaEl(m.change24h);
  $("mcap").textContent = usdText(m.marketCap, { big: true });
  $("fdv").textContent = usdText(m.fdv, { big: true });
  $("vol").textContent = usdText(m.volume24h, { big: true });
  $("turnover").textContent =
    m.volume24h != null && m.marketCap != null && m.marketCap > 0
      ? `${((m.volume24h / m.marketCap) * 100).toFixed(2)}% of cap`
      : "–";
  $("circ").textContent = nightText(m.circulating);
  $("total").textContent = nightText(m.total);
  const maxRef = m.max != null ? m.max : NIGHT.maxSupplyNight;
  $("max").textContent = nightText(maxRef);
  if (m.circulating != null && maxRef > 0) {
    $("circ-bar").style.width = `${Math.min(100, (m.circulating / maxRef) * 100).toFixed(2)}%`;
    $("circ-pct").textContent = `${((m.circulating / maxRef) * 100).toFixed(1)}% of max in circulation`;
  }
  // 24h range
  const rng = $("range");
  if (m.low24h != null && m.high24h != null && m.price != null) {
    const lo = m.high24h - m.low24h;
    const pct = lo > 0 ? ((m.price - m.low24h) / lo) * 100 : 0;
    rng.innerHTML = `
      <div class="range-bar"><div class="range-fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div><div class="range-dot" style="left:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div></div>
      <div class="range-ends"><span>${usdText(m.low24h)}</span><span>${usdText(m.high24h)}</span></div>`;
  }
  // change grid
  $("chg-7d").innerHTML = deltaEl(m.change7d);
  $("chg-14d").innerHTML = deltaEl(m.change14d);
  $("chg-30d").innerHTML = deltaEl(m.change30d);
  // ATH
  if (m.ath != null) {
    $("ath").innerHTML = `${usdText(m.ath)} ${deltaEl(m.athChangePct)}`;
  }
  $("updated").textContent = m.lastUpdated
    ? `price as of ${new Date(m.lastUpdated).toLocaleString("en-US")}`
    : "price timestamp not reported";
}

function renderChart(prices) {
  const st = marketStats(prices);
  const spark = $("spark");
  if (!st.points) {
    spark.innerHTML = '<div class="no-data">no price history reported</div>';
  } else {
    const ds = downsample(prices, 72);
    const hs = sparkHeights(ds);
    spark.innerHTML = ds
      .map(
        (p, i) =>
          `<div class="col" style="height:${Math.max(3, hs[i])}%" title="${new Date(p.t).toLocaleString("en-US")} · ${usdText(p.v)}"></div>`
      )
      .join("");
    $("chart-legend").innerHTML =
      `<span>${new Date(ds[0].t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit" })}</span><span>${new Date(ds[ds.length - 1].t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit" })}</span>`;
  }
  $("st-first").textContent = usdText(st.first);
  $("st-last").textContent = usdText(st.last);
  $("st-high").textContent = usdText(st.high);
  $("st-low").textContent = usdText(st.low);
  $("st-change").innerHTML = deltaEl(st.changePct);
  const vol = volatility(prices);
  $("st-vol").textContent = vol != null ? `${vol.toFixed(1)}%` : "–";
  $("st-points").textContent = `${st.points} points`;
}

async function refresh() {
  try {
    const [coin, chart] = await Promise.all([
      getJSON(`/coins/${NIGHT.coingeckoId}`),
      getJSON(`/coins/${NIGHT.coingeckoId}/market_chart?vs_currency=usd&days=7`).catch(() => null),
    ]);

    const tk = extractToken(coin);
    const m = extractMarket(coin);
    const prices = chart ? cleanSeries(chart.prices) : [];
    const st = marketStats(prices);
    const vol = volatility(prices);
    const h = marketHealth({ market: m, stats: st, token: tk, volatility: vol });

    renderGauge(h);
    renderToken(tk);
    renderMarket(m, tk);
    renderChart(prices);

    let label = `live · ${usdText(m.price)} NIGHT · mcap ${usdText(m.marketCap, { big: true })}`;
    if (m.lastUpdated) {
      const t = Date.parse(m.lastUpdated);
      if (Number.isFinite(t)) label += ` · updated ${agoLabel(t, Date.now())}`;
    }
    setLive(true, label);
    return { ok: true, price: m.price, score: h.score };
  } catch (e) {
    console.error("NIGHT Market refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
