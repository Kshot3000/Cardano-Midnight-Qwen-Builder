/* Block Watch — live Midnight block-production dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/blocks?limit=120 -> newest 120 blocks (hash, parent_hash,
                                  timestamp, extrinsics_count, height)
     GET /api/analytics/overview -> network context (epoch, age, tps)
   All metric logic lives in src/blocks.js (28 unit tests).
*/
import {
  verifyChain,
  verifyContiguity,
  interblockGaps,
  paceStats,
  epochProgress,
  networkAge,
  blockHealth,
  normalize,
} from "./src/blocks.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;
const WINDOW = 120; // ~12 minutes of Midnight at 6s blocks

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

function renderSummary(blocks, overview, nowSec) {
  const newest = blocks[0]; // API returns newest first
  $("latest-height").textContent = fmt(newest.height);
  $("latest-hash").textContent = newest.hash.slice(0, 10) + "…";
  $("latest-age").textContent = fmt(Math.max(0, nowSec - newest.timestamp)) + "s";
  const p = paceStats(blocks);
  $("blocks-per-min").textContent = p.blocksPerMin == null ? "–" : p.blocksPerMin.toFixed(1);
  $("avg-gap").textContent = p.avgGapSec == null ? "–" : p.avgGapSec.toFixed(1) + "s";
  $("window-blocks").textContent = fmt(p.blocks);
  const age = networkAge(overview, nowSec);
  if (age) $("network-age").textContent = Math.round(age.ageDays) + " days";

  const ep = overview && epochProgress(overview.epoch, nowSec * 1000);
  const bar = $("epoch-bar");
  const txt = $("epoch-text");
  if (ep && ep.epoch != null) {
    $("epoch-label").textContent = `Cardano epoch #${ep.epoch}`;
    bar.style.setProperty("--pct", ep.pct.toFixed(1));
    txt.textContent = ep.remainingMin
      ? `${ep.pct.toFixed(1)}% through · ~${fmt(ep.remainingMin)} min to next epoch`
      : `${ep.pct.toFixed(0)}% through · epoch boundary reached`;
  } else {
    txt.textContent = "epoch progress not exposed by the indexer yet";
  }
}

function renderGapChart(blocks) {
  const gaps = interblockGaps(blocks); // chronological (oldest first)
  const vals = normalize(gaps);
  $("gap-spark").innerHTML = gaps
    .map(
      (g, i) =>
        `<div class="col${g < 0 ? " bad" : ""}" style="height:${Math.max(4, vals[i])}%" title="gap: ${g}s"></div>`
    )
    .join("");
  const p = paceStats(blocks);
  $("gap-min").textContent = p.minGapSec == null ? "–" : p.minGapSec + "s";
  $("gap-max").textContent = p.maxGapSec == null ? "–" : p.maxGapSec + "s";
  $("gap-neg").textContent = p.negativeGaps;
}

function renderAudit(blocks) {
  const chain = verifyChain(blocks);
  const cont = verifyContiguity(blocks);
  const chainEl = $("chain-row");
  const contEl = $("contig-row");
  chainEl.innerHTML = chain.broken
    ? `<span class="verdict bad">✗ ${chain.broken} of ${chain.links} hash links broken</span>`
    : `<span class="verdict ok">✓ ${chain.links} hash links verified</span>`;
  contEl.innerHTML = cont.gaps
    ? `<span class="verdict bad">✗ ${cont.gaps} height gap${cont.gaps > 1 ? "s" : ""} (missing ${cont.gapDetails.reduce((s, g) => s + g.missing, 0)} blocks)</span>`
    : `<span class="verdict ok">✓ heights contiguous across the window</span>`;
}

function renderRecent(blocks, nowSec) {
  $("recent-tbody").innerHTML = blocks
    .slice(0, 10)
    .map((b, i) => {
      const linked = i > 0 && b.parent_hash === blocks[i - 1].hash ? "✓" : "";
      const age = Math.max(0, nowSec - b.timestamp);
      return `<tr>
        <td class="c-mono">#${fmt(b.height)}</td>
        <td class="c-mono" title="${b.hash}">${b.hash.slice(0, 10)}…</td>
        <td class="c-mono">${b.extrinsics_count != null ? b.extrinsics_count : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${age}s</td>
        <td>${linked}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const [blocks, overview] = await Promise.all([
      getJSON(`/api/blocks?limit=${WINDOW}`),
      getJSON("/api/analytics/overview").catch(() => null),
    ]);
    if (!Array.isArray(blocks) || blocks.length < 2) throw new Error("block window too small");

    const nowSec = Math.floor(Date.now() / 1000);
    const p = paceStats(blocks);
    const chain = verifyChain(blocks);
    const cont = verifyContiguity(blocks);
    const h = blockHealth({
      chainBroken: chain.broken,
      gaps: cont.gaps,
      avgGapSec: p.avgGapSec,
      negativeGaps: p.negativeGaps,
      expectedGapSec: 6,
      newestAgeSec: nowSec - blocks[0].timestamp,
    });

    renderGauge(h);
    renderSummary(blocks, overview, nowSec);
    renderGapChart(blocks);
    renderAudit(blocks);
    renderRecent(blocks, nowSec);
    setLive(true, `live · block #${fmt(blocks[0].height)}`);
  } catch (e) {
    console.error("Block Watch refresh failed:", e);
    setLive(false);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
