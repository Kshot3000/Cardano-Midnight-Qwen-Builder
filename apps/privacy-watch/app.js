/* Privacy Trend Watch — live Midnight privacy dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/analytics/privacy?hours=N -> window counts, hourly trend, unshieldedDetails
     GET /api/analytics/overview        -> lifetime shieldedRatio, blocks, networkAgeDays
   All metric logic lives in src/privacy.js (23 unit tests).
*/
import {
  summarizePrivacy,
  trendGrowth,
  parseIncidents,
  privacyHealth,
  ageLabel,
  normalize,
} from "./src/privacy.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;
const WINDOWS = [1, 6, 24, 72, 168];
let hours = 24;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const pct = (x, digits = 2) => (x == null ? "–" : (x * 100).toFixed(digits) + "%");

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

function renderStats(s, growth) {
  $("win-label").textContent = hours;
  $("st-total").textContent = fmt(s.total);
  $("st-shielded").textContent = fmt(s.shielded);
  $("st-shielded-pct").textContent = s.total ? pct(s.ratio) : "";
  $("st-unshielded").textContent = fmt(s.unshielded);
  $("st-unshielded-pct").textContent = s.total ? pct(s.unshielded / s.total) : "";
  $("st-calls").textContent = fmt(s.contractCalls);
  $("st-deploys").textContent = fmt(s.contractDeploys);
  $("st-reported").textContent = s.reportedRatio == null ? "–" : pct(s.reportedRatio);
  $("st-delta").textContent =
    s.ratioDelta == null
      ? "no API value"
      : `Δ ${s.ratioDelta >= 0 ? "+" : ""}${(s.ratioDelta * 100).toFixed(3)}pp`;

  if (!s.trend.length) {
    $("trend-spark").innerHTML = "";
    $("trend-legend").innerHTML = "<span>no hourly data</span><span></span>";
  } else {
    const totals = s.trend.map((r) => Number(r.total) || 0);
    const vals = normalize(totals);
    $("spark-sub").textContent =
      `Each bar is one hour of Midnight transactions in the last ${hours}h, oldest left, newest right. ` +
      "Bars turn red when the hour contained unshielded transactions.";
    $("trend-spark").innerHTML = s.trend
      .map(
        (r, i) =>
          `<div class="col${(r.unshielded || 0) ? " u" : ""}" style="height:${Math.max(4, vals[i])}%" title="${r.hour}: ${fmt(r.total)} tx (${fmt(r.unshielded || 0)} unshielded)"></div>`
      )
      .join("");
    const first = s.trend[0].hour.replace(" ", " · ");
    const last = s.trend[s.trend.length - 1].hour.replace(" ", " · ");
    $("trend-legend").innerHTML = `<span>${first}</span><span>${last}</span>`;
  }
  $("trend-avg").textContent = fmt(s.avgPerHour);
  $("trend-max").textContent = `${fmt(s.peakHour)} tx`;
  $("trend-max-hour").textContent = s.peakHourLabel ? s.peakHourLabel.slice(11, 16) + ":00" : "no data";

  const half = Math.floor(hours / 2);
  if (!growth) {
    $("growth-body").innerHTML =
      `Not enough public history for a ${half}h-vs-${half}h figure at this window — the dashboard refuses to show a fake 0%.`;
  } else {
    const arrow = growth.pct >= 0 ? "▲" : "▼";
    $("growth-body").innerHTML =
      `<div style="font-family:var(--mono);font-size:26px;font-weight:700" class="delta ${growth.pct >= 0 ? "up" : "down"}">${arrow} ${growth.pct >= 0 ? "+" : ""}${growth.pct.toFixed(1)}%</div>
       <div class="d" style="color:var(--muted);font-size:13px;margin-top:6px">${fmt(growth.last)} tx in the second half vs ${fmt(growth.prev)} in the first ${half}h</div>`;
  }
}

function renderIncidents(inc, nowSec) {
  if (!inc.count) {
    $("incident-tbody").innerHTML =
      `<tr><td colspan="5" style="padding:14px;color:var(--green)">✓ Zero unshielded transactions in this window — everything was shielded.</td></tr>`;
    return;
  }
  $("incident-tbody").innerHTML = inc.incidents
    .map((row) => {
      const p = row.payload;
      if (!p) {
        return `<tr>
          <td class="c-mono">${row.block != null ? fmt(row.block) : "–"}</td>
          <td class="c-mono" style="color:var(--muted)">${ageLabel(row.timestamp, nowSec)}</td>
          <td colspan="3" style="color:var(--muted)">payload not decoded by the indexer</td>
        </tr>`;
      }
      const shortAddr = (a) => (a ? a.slice(0, 10) + "…" + a.slice(-6) : "–");
      const addrs = [...new Set(p.spent.concat(p.created).map((e) => e.address).filter(Boolean))];
      const tokens = p.tokenTypes.map((t) => t.slice(0, 10) + "…" + t.slice(-6));
      return `<tr>
        <td class="c-mono">${row.block != null ? fmt(row.block) : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${ageLabel(row.timestamp, nowSec)}</td>
        <td class="c-mono">${addrs.length ? addrs.map(shortAddr).join(", ") : "–"}<div style="color:var(--muted);font-size:11px">${addrs.length} unique</div></td>
        <td class="c-mono">${tokens.length ? tokens.join(", ") : "–"}<div style="color:var(--muted);font-size:11px">${p.uniqueTokens} unique</div></td>
        <td class="c-mono">${fmt(p.spentValue)} / ${fmt(p.createdValue)}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const [privacy, overview] = await Promise.all([
      getJSON(`/api/analytics/privacy?hours=${hours}`),
      getJSON("/api/analytics/overview").catch(() => null),
    ]);

    const s = summarizePrivacy(privacy);
    const half = Math.max(1, Math.floor(hours / 2));
    const growth = trendGrowth(s.trend, half);
    const inc = parseIncidents(privacy.unshieldedDetails);

    const h = privacyHealth({
      total: s.total,
      ratio: s.ratio,
      unshielded: s.unshielded,
      ratioDelta: s.ratioDelta,
      growth,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    renderGauge(h);
    renderStats(s, growth);
    renderIncidents(inc, nowSec);

    if (overview && overview.shieldedRatio != null) {
      $("lifetime-body").innerHTML =
        `Lifetime shielded ratio <strong>${pct(overview.shieldedRatio)}</strong> across ` +
        `${fmt(overview.blocks)} blocks (network age ${overview.networkAgeDays != null ? overview.networkAgeDays + " days" : "–"}). ` +
        `The trailing-${hours}h window above is the same metric at a zoom the network actually runs at.`;
    } else {
      $("lifetime-body").innerHTML = "Lifetime context unavailable right now.";
    }

    setLive(
      true,
      `live · ${fmt(s.total)} tx / ${hours}h · ${s.total ? pct(s.ratio, 1) : "–"} shielded` +
        (inc.count ? ` · ${inc.count} unshielded` : "")
    );
    return { ok: true, window: hours, txs: s.total, health: h.score, unshielded: inc.count };
  } catch (e) {
    console.error("Privacy Trend Watch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

// window switching
document.querySelectorAll("#window-bar button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#window-bar button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    hours = Number(btn.dataset.hours) || 24;
    refresh();
  });
});

refresh();
setInterval(refresh, REFRESH_MS);
