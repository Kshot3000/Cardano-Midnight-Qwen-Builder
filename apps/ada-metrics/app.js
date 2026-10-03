/* Ada Metrics — live Cardano dashboard.
   Data sources (both public, CORS-enabled, no auth):
     CoinGecko:  GET /api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true&include_market_cap=true
     Blockchair: GET /cardano/stats  -> blocks, transactions, blocks_24h, transactions_24h, ...
   Refresh interval: 60s. Each source degrades independently.
   All rendering goes through src/metrics.js view-models + textContent, and
   the live/stale pill is decided only after BOTH fetches settle — the old
   version judged the APIs on a fixed 1.5s timer, so any slower response was
   reported as "APIs unreachable" and stayed wrong until the next cycle. */
import { priceView, statsView } from "./src/metrics.js";

const REFRESH_MS = 60000;

function setPill(state, text) {
  const dot = document.getElementById("live-dot");
  const txt = document.getElementById("live-text");
  if (dot) dot.className = "dot" + (state === "live" ? "" : " stale");
  if (txt) txt.textContent = text;
}

function renderPrice(d) {
  const view = priceView(d);
  const el = document.getElementById("ada-price");
  const ch = document.getElementById("ada-change");
  const mc = document.getElementById("ada-mcap");
  if (el) el.textContent = view.price;
  if (ch && view.change) {
    ch.textContent = view.change.text;
    ch.className = view.change.cls;
  }
  if (mc) mc.textContent = view.mcap;
}

function renderStats(s) {
  const el = document.getElementById("stats");
  if (!el) return;
  el.replaceChildren(...statsView(s).map((it) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = it.label;
    const value = document.createElement("div");
    value.className = "value";
    value.textContent = it.value;
    stat.append(label, value);
    return stat;
  }));
}

function fetchJson(url) {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

async function load() {
  setPill("stale", "refreshing…");
  const [price, stats] = await Promise.all([
    fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true&include_market_cap=true")
      .then((j) => (j && j.cardano ? j.cardano : null)),
    fetchJson("https://api.blockchair.com/cardano/stats")
      .then((j) => (j && j.data ? j.data : null)),
  ]);
  let okCount = 0;
  if (price) { renderPrice(price); okCount++; }
  if (stats) { renderStats(stats); okCount++; }
  // Verdict only now that both requests have actually settled.
  setPill(okCount ? "live" : "stale", okCount ? "live · " + new Date().toLocaleTimeString() : "APIs unreachable — retrying in 60s");
}

load();
setInterval(load, REFRESH_MS);
