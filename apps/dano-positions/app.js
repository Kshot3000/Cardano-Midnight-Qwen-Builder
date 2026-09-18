import {
  API_URL,
  tvlSeries,
  rangeSeries,
  tvlDeltaPct,
  latestTvl,
  avgTvl,
  formatUsd,
  formatDelta,
  downsample,
  sparkHeights,
  growthLabel,
} from "./src/dano.js";

const $ = (id) => document.getElementById(id);

function setStatus(el, ok, text) {
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("bad", !ok);
}

function setDelta(el, pct) {
  el.textContent = formatDelta(pct);
  el.classList.toggle("pos", typeof pct === "number" && pct >= 0);
  el.classList.toggle("neg", typeof pct === "number" && pct < 0);
}

function renderSpark(el, series) {
  const pts = downsample(series, 40);
  const heights = sparkHeights(pts);
  el.innerHTML = heights
    .map((h, i) => `<div class="col" style="height:${h}px" title="${formatUsd(pts[i].tvl)}"></div>`)
    .join("");
}

async function load() {
  const status = $("status");
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const series = tvlSeries(data);
    if (!series.length) throw new Error("no tvl data");

    const now = Date.now();
    const cur = latestTvl(data, series);
    $("tvl-now").textContent = formatUsd(cur);

    const d1 = tvlDeltaPct(series, 1, now);
    const d7 = tvlDeltaPct(series, 7, now);
    const d30 = tvlDeltaPct(series, 30, now);
    setDelta($("delta-1d"), d1);
    setDelta($("delta-7d"), d7);
    setDelta($("delta-30d"), d30);

    $("range-7d").textContent = formatUsd(avgTvl(series, 7, now));
    $("range-30d").textContent = formatUsd(avgTvl(series, 30, now));
    $("range-90d").textContent = formatUsd(avgTvl(series, 90, now));

    const label = growthLabel(d7);
    const lbl = $("growth-label");
    lbl.textContent = label;
    lbl.className = "growth-" + label;

    renderSpark($("spark-7d"), rangeSeries(series, 7, now));
    renderSpark($("spark-30d"), rangeSeries(series, 30, now));
    renderSpark($("spark-90d"), rangeSeries(series, 90, now));

    const last = series[series.length - 1].date;
    $("updated").textContent = new Date(last).toUTCString().slice(5, 22) + " UTC";
    setStatus(status, true, "live · " + new Date().toLocaleTimeString());
  } catch (e) {
    setStatus(status, false, "error · " + e.message + " · retrying…");
  }
}

load();
setInterval(load, 60000);
