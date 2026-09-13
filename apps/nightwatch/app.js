/* Nightwatch — live Midnight privacy-network health dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/health
     GET /api/analytics/overview   -> blocks, tps, shieldedRatio, networkAgeDays
     GET /api/analytics/dust       -> totalTransactions + hourlyActivity (42h)
   Metric logic lives in src/metrics.js (unit-tested).
*/
import {
  ascending,
  summarizeActivity,
  transactionGrowth,
  dustBurn,
  healthScore,
  sparkline,
  standardizedMetrics,
} from "./src/metrics.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));

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
        `<li class="${c.pass ? "pass" : ""}"><span class="${c.pass ? "ok" : "no"}">${c.pass ? "✓" : "✗"}</span> ${c.label} <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">+${c.pts}</span></li>`
    )
    .join("");
}

function renderMetrics(caps, activity, growth) {
  const defs = standardizedMetrics(caps);
  const live = defs.filter((d) => d.status === "live").length;
  $("metric-grid").innerHTML = defs
    .map((d) => {
      let v = "–", sub = "";
      if (d.key === "activity") {
        v = growth ? `${growth.pct >= 0 ? "+" : ""}${growth.pct.toFixed(1)}%` : "–";
        sub = growth
          ? `${fmt(growth.last24)} tx (24h) vs ${fmt(growth.prev24)} (prev 24h)`
          : "need 48h of public history";
      } else if (d.key === "dust" && activity) {
        v = `${fmt(activity.last24.total)}`;
        sub = `tx in 24h — each tx burns DUST · avg ${fmt(activity.last24.avg)}/h`;
      } else if (d.status === "pending") {
        sub = "pending in public indexer — honest label, no fake data";
      }
      return `<div class="metric"><div class="k">${d.name}</div>
        <div class="v">${v} <span class="pill ${d.status}">${d.status}</span></div>
        <div class="d">${sub}</div></div>`;
    })
    .join("") +
    `<div class="metric"><div class="k">Coverage</div>
      <div class="v">${live}/${defs.length} <span class="pill ${live === defs.length ? "live" : "pending"}">${live === defs.length ? "full" : "partial"}</span></div>
      <div class="d">of the four standardized privacy-chain metrics computable today</div></div>`;
}

function renderSpark(series, total) {
  const vals = sparkline(series.slice(-42));
  const max = Math.max(...series.map((r) => r.txs), 1);
  const min = Math.min(...series.map((r) => r.txs), 0);
  $("dust-spark").innerHTML = vals
    .map(
      (v, i) =>
        `<div class="col" style="height:${Math.max(4, v)}%" title="${series[i].hour}: ${fmt(series[i].txs)} tx" data-h="${series[i].hour}" data-t="${series[i].txs}"></div>`
    )
    .join("");
  const first = series[0], last = series[series.length - 1];
  $("dust-legend").innerHTML = `<span>${first.hour.replace(" ", " · ")}</span><span>${last.hour.replace(" ", " · ")}</span>`;
  $("dust-total").textContent = fmt(total);
  $("dust-24h").textContent = fmt(series.slice(-24).reduce((s, r) => s + r.txs, 0));
}

function renderGrowth(growth, recent) {
  if (!growth) {
    $("growth-body").innerHTML =
      'Insufficient public history for a 24h-vs-24h growth figure — the dashboard refuses to show a fake 0%.';
  } else {
    const dir = growth.pct >= 0 ? "up" : "down";
    const arrow = growth.pct >= 0 ? "▲" : "▼";
    $("growth-body").innerHTML =
      `<div style="font-family:var(--mono);font-size:26px;font-weight:700" class="delta ${dir}">${arrow} ${growth.pct >= 0 ? "+" : ""}${growth.pct.toFixed(1)}%</div>
       <div class="d" style="color:var(--muted);font-size:13px;margin-top:6px">${fmt(growth.last24)} tx in the last 24h vs ${fmt(growth.prev24)} in the previous 24h</div>`;
  }
  if (recent && recent.length) {
    $("recent-hours").innerHTML = recent
      .slice(-6)
      .map((r) => `<span style="display:inline-block;font-family:var(--mono);font-size:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;margin:2px">${r.hour.slice(5, 16)} → ${fmt(r.txs)} tx</span>`)
      .join("");
  }
}

async function refresh() {
  try {
    const [health, overview, dust] = await Promise.all([
      getJSON("/api/health"),
      getJSON("/api/analytics/overview"),
      getJSON("/api/analytics/dust"),
    ]);

    const series = ascending(dust.hourlyActivity || []);
    const activity = summarizeActivity(series);
    const growth = transactionGrowth(series);
    const dustView = dustBurn(series, dust.totalTransactions);

    const h = healthScore({
      tps: overview.tps,
      avgPerHour: activity.last24.avg,
      shieldedRatio: overview.shieldedRatio,
      growth,
    });

    renderGauge(h);
    renderMetrics(
      { hasActivity: true, hasDust: true, hasAddresses: false, hasRetention: false },
      activity,
      growth
    );
    renderSpark(series, dustView.lifetimeTxs);
    renderGrowth(growth, series);

    const age = overview.networkAgeDays;
    setLive(true, `live · ${fmt(overview.blocks)} blocks · day ${age}`);
    return { ok: true, blocks: overview.blocks, health: h.score, growth };
  } catch (e) {
    console.error("Nightwatch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
