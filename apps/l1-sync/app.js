/* L1 Sync Watch — live Midnight -> Cardano L1 observation dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/extrinsics?limit=N -> newest-first extrinsics
   Cross-checked against the Cardano mainchain tip via Koios:
     GET https://data.cardano.org/k/api/v1/tip -> [{ block_height, epoch_no, block_time, ... }]
   All metric logic lives in src/sync.js (unit-tested).
*/
import {
  analyzeExtrinsics,
  observationCadence,
  l1Lag,
  syncHealth,
  ageLabel,
  formatTokens,
  normalize,
} from "./src/sync.js";

const API = "https://mainnet.nightforge.jp";
const KOIOS = "https://data.cardano.org/k/api/v1";
const EXTRINSICS_LIMIT = 400;
const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const secLabel = (s) =>
  s == null ? "–" : s < 90 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

function setLive(ok, label) {
  const dot = $("live-dot");
  const txt = $("live-text");
  if (dot) dot.classList.toggle("stale", !ok);
  if (txt) txt.textContent = ok ? label || "live" : "stale — retrying";
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

function renderLag(analysis, lag, tip) {
  $("observed-block").textContent = analysis.latestObservedL1Block != null ? fmt(analysis.latestObservedL1Block) : "–";
  const obs = analysis.observations.find((o) => o.observedL1Block === analysis.latestObservedL1Block);
  $("observed-hash").textContent = obs && obs.observedL1BlockHash ? String(obs.observedL1BlockHash).slice(0, 18) + "…" : "";
  $("tip-block").textContent = tip ? fmt(Number(tip.block_height)) : "–";
  $("tip-epoch").textContent = tip && tip.epoch_no != null ? `epoch #${tip.epoch_no}` : "";
  if (!lag) {
    $("lag-blocks").textContent = "–";
    $("lag-seconds").textContent = "waiting for both sides…";
  } else {
    $("lag-blocks").textContent = fmt(lag.lagBlocks);
    $("lag-seconds").textContent = `≈ ${secLabel(lag.lagSecondsEstimate)} behind tip (est. @20s blocks)`;
  }
}

function renderCadence(cad) {
  const series = cad.cadenceSeconds.slice().reverse(); // oldest -> newest
  if (!series.length) {
    $("cadence-spark").innerHTML = "";
    $("cadence-legend").innerHTML = '<span>no observations in window</span><span></span>';
  } else {
    const vals = normalize(series);
    $("cadence-spark").innerHTML = series
      .map(
        (v, i) =>
          `<div class="col" style="height:${Math.max(4, vals[i])}%" title="${secLabel(v)} gap" data-v="${v}"></div>`
      )
      .join("");
    $("cadence-legend").innerHTML = `<span>${series.length} gaps</span><span>oldest → newest</span>`;
  }
  $("cadence-median").textContent = secLabel(cad.medianCadenceSeconds);
  $("cadence-min").textContent = secLabel(cad.minCadenceSeconds);
  $("cadence-max").textContent = secLabel(cad.maxCadenceSeconds);
}

function renderWindow(analysis) {
  const w = analysis.midnightWindow;
  if (!w[0]) {
    $("window-body").innerHTML = "No observations found in the scanned window.";
    return;
  }
  const parts = [
    `<div style="font-family:var(--mono);font-size:15px">Midnight blocks <span class="delta up" style="color:var(--green)">${fmt(w[0])} → ${fmt(w[1])}</span></div>`,
    `<div class="d" style="color:var(--muted);font-size:13px;margin-top:8px;line-height:1.8">
      ${analysis.observations.length} observations scanned ·
      <span class="c-mono">${analysis.uniqueL1BlocksInWindow}</span> distinct Cardano blocks covered
      (span ${fmt(analysis.l1BlockSpanInWindow)}) ·
      <span class="c-mono">${analysis.tokenEventsInWindow}</span> token events
      (${fmt(analysis.assetCreatesInWindow)} creates / ${fmt(analysis.assetSpendInWindow)} spends) ·
      created ${formatTokens(analysis.createdValueInWindow)} · spent ${formatTokens(analysis.spentValueInWindow)}
    </div>`,
  ];
  $("window-body").innerHTML = parts.join("");
}

function renderRecent(analysis, nowSec) {
  const obs = analysis.observations;
  if (!obs.length) {
    $("recent-tbody").innerHTML =
      '<tr><td colspan="5" style="padding:14px;color:var(--muted)">No L1 observations reported in the scanned window.</td></tr>';
    return;
  }
  $("recent-tbody").innerHTML = obs
    .slice(0, 12)
    .map((o) => {
      const short = o.midnightHash ? o.midnightHash.slice(0, 10) + "…" : "–";
      const ev = o.eventCount
        ? `${o.eventCount} ev (${o.assetCreates} create / ${o.assetSpend} spend)`
        : "no token events";
      return `<tr>
        <td class="c-mono" title="${o.midnightHash || ""}">${short}</td>
        <td class="c-mono">${o.midnightBlock != null ? fmt(o.midnightBlock) : "–"}</td>
        <td class="c-mono">${o.observedL1Block != null ? fmt(o.observedL1Block) : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${ev}</td>
        <td class="c-mono" style="color:var(--muted)">${ageLabel(o.midnightTs, nowSec)}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const [exts, tipRaw] = await Promise.all([
      getJSON(`${API}/api/extrinsics?limit=${EXTRINSICS_LIMIT}`),
      getJSON(`${KOIOS}/tip`).catch(() => null),
    ]);
    const extrinsics = Array.isArray(exts) ? exts : exts && Array.isArray(exts.extrinsics) ? exts.extrinsics : [];
    const tip = Array.isArray(tipRaw) ? tipRaw[0] : tipRaw && typeof tipRaw === "object" ? tipRaw : null;

    const analysis = analyzeExtrinsics(extrinsics);
    const cad = observationCadence(analysis);
    const lag = l1Lag(analysis.latestObservedL1Block, tip);

    const h = syncHealth({
      lagBlocks: lag ? lag.lagBlocks : null,
      medianCadenceSeconds: cad.medianCadenceSeconds,
      uniqueL1BlocksInWindow: analysis.uniqueL1BlocksInWindow,
      tokenEventsInWindow: analysis.tokenEventsInWindow,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    renderGauge(h);
    renderLag(analysis, lag, tip);
    renderCadence(cad);
    renderWindow(analysis);
    renderRecent(analysis, nowSec);

    setLive(
      true,
      `live · ${analysis.observations.length} obs · lag ${lag ? fmt(lag.lagBlocks) + " blocks" : "n/a"}`
    );
    return { ok: true, lag: lag && lag.lagBlocks, health: h.score };
  } catch (e) {
    console.error("L1 Sync Watch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
