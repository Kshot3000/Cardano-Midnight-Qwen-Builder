/* Bridge Watch — live Cardano <-> Midnight bridge dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/analytics/bridge   -> totalBridgeOps, last24h, trend[24h], recentBridgeOps
     GET /api/analytics/overview -> Cardano mainchain epoch/slot context
   All metric logic lives in src/bridge.js (26 unit tests).
*/
import {
  summarizeTrend,
  trendGrowth,
  parseRecentOps,
  opsPerBlock,
  ageLabel,
  bridgeHealth,
  normalize,
} from "./src/bridge.js";

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

function renderSummary(bridge, overview) {
  $("total-ops").textContent = fmt(bridge.totalBridgeOps);
  $("last24-ops").textContent = fmt(bridge.last24h);
  const ep = overview && overview.epoch;
  if (ep && ep.mainchain_epoch != null) {
    $("cardano-epoch").textContent = `#${ep.mainchain_epoch}`;
    $("cardano-slot").textContent = fmt(ep.mainchain_slot);
  }
  // ops / unique Cardano block (from the recent window)
  const recent = parseRecentOps(bridge.recentBridgeOps);
  const ppb = opsPerBlock(recent);
  $("ops-per-block").textContent = ppb == null ? "–" : ppb.toFixed(1);
}

function renderTrend(bridge, growth) {
  const s = summarizeTrend(bridge.trend);
  const vals = normalize(s.series);
  $("trend-spark").innerHTML = s.series
    .map(
      (r, i) =>
        `<div class="col" style="height:${Math.max(4, vals[i])}%" title="${r.hour}: ${fmt(r.count)} ops" data-h="${r.hour}" data-c="${r.count}"></div>`
    )
    .join("");
  if (s.series.length >= 2) {
    $("trend-legend").innerHTML =
      `<span>${s.series[0].hour.replace(" ", " · ")}</span><span>${s.series[s.series.length - 1].hour.replace(" ", " · ")}</span>`;
  }
  $("trend-avg").textContent = fmt(s.avgPerHour);
  $("trend-max").textContent = `${fmt(s.max)} ops`;
  $("trend-max-hour").textContent = s.hours ? `${s.hours}h window` : "no data";

  if (!growth) {
    $("growth-body").innerHTML =
      'Insufficient public history for a 12h-vs-12h trend figure — the dashboard refuses to show a fake 0%.';
  } else {
    const dir = growth.pct >= 0 ? "up" : "down";
    const arrow = growth.pct >= 0 ? "▲" : "▼";
    $("growth-body").innerHTML =
      `<div style="font-family:var(--mono);font-size:26px;font-weight:700" class="delta ${dir}">${arrow} ${growth.pct >= 0 ? "+" : ""}${growth.pct.toFixed(1)}%</div>
       <div class="d" style="color:var(--muted);font-size:13px;margin-top:6px">${fmt(growth.last)} ops in the last ${growth.windowHours}h vs ${fmt(growth.prev)} in the previous ${growth.windowHours}h</div>`;
  }
}

function renderRecent(bridge, nowSec) {
  const parsed = parseRecentOps(bridge.recentBridgeOps);
  if (!parsed.ops.length) {
    $("recent-tbody").innerHTML =
      '<tr><td colspan="5" style="padding:14px;color:var(--muted)">No recent bridge operations reported.</td></tr>';
    return;
  }
  $("recent-tbody").innerHTML = parsed.ops
    .map((op) => {
      const short = op.hash ? op.hash.slice(0, 10) + "…" : "–";
      return `<tr>
        <td class="c-mono" title="${op.hash || ""}">${short}</td>
        <td class="c-mono">${op.midnightBlock != null ? fmt(op.midnightBlock) : "–"}</td>
        <td class="c-mono">${op.cardanoBlock != null ? fmt(op.cardanoBlock) : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${ageLabel(op.timestamp, nowSec)}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const [bridge, overview] = await Promise.all([
      getJSON("/api/analytics/bridge"),
      getJSON("/api/analytics/overview").catch(() => null),
    ]);

    const s = summarizeTrend(bridge.trend);
    const growth = trendGrowth(bridge.trend, 12);
    const recent = parseRecentOps(bridge.recentBridgeOps);

    const h = bridgeHealth({
      avgPerHour: s.avgPerHour,
      last24Total: bridge.last24h,
      growth,
      hasRecent: recent.ops.length > 0,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    renderGauge(h);
    renderSummary(bridge, overview);
    renderTrend(bridge, growth);
    renderRecent(bridge, nowSec);

    const ep = overview && overview.epoch;
    setLive(
      true,
      `live · ${fmt(bridge.last24h)} bridge ops / 24h${ep && ep.mainchain_epoch != null ? ` · Cardano epoch #${ep.mainchain_epoch}` : ""}`
    );
    return { ok: true, bridgeOps: bridge.totalBridgeOps, health: h.score };
  } catch (e) {
    console.error("Bridge Watch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
