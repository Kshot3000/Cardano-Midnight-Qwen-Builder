// DRep Watch — UI logic.
//
// Live data (keyless, CORS *):
//   data.cardano.org /tip                  → current in-progress epoch
//   data.cardano.org /k/api/v1/drep_epoch_summary
//                                          → per-epoch delegated stake + active DRep count
//   data.cardano.org /k/api/v1/drep_list   → current DRep census (id/hex/script/registered)
//   data.cardano.org /k/api/v1/totals      → per-epoch circulation (denominator)
//
// Pure logic (bech32 codec, normalization, census aggregation, delegation
// trend, share, health rubric, formatters) lives in src/codec.js + src/trend.js
// and is unit-tested in test/*.test.mjs.

import {
  normalizeEpochRow,
  normalizeCensusRow,
  censusStats,
  delegationTrend,
  shareOfCirculation,
  drepHealth,
  fmtInt,
  fmtM,
  fmtSignedM,
  fmtPct,
} from "./src/trend.js";

const API = "https://data.cardano.org";
const REFRESH_MS = 10 * 60_000; // the hero promises 10-minute auto-refresh
const el = (id) => document.getElementById(id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(path, { tries = 3, timeoutMs = 40000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${API}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 200) return await r.json();
      last = new Error(`HTTP ${r.status} ${path}`);
      if (r.status !== 404 && r.status !== 502 && r.status !== 503 && r.status !== 400) break;
      if (i < tries - 1) await sleep(400 * (i + 1));
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
  }
  throw last;
}

// ── live data ────────────────────────────────────────────────────────────
async function loadLive() {
  const out = { tip: null, epochRows: null, census: null, circulation: null };
  try {
    const t = await fetchJson("/tip");
    const tip = Array.isArray(t) ? t[0] : t;
    out.tip = { epoch: tip.epoch_no, block: tip.block_height, blockTime: tip.block_time * 1000 };
  } catch (_) { /* tip stays null */ }

  // Per-epoch delegated stake + active DRep count (all Conway epochs).
  try {
    const rows = await fetchJson("/k/api/v1/drep_epoch_summary");
    if (Array.isArray(rows) && rows.length >= 2) {
      let list = rows.map(normalizeEpochRow).filter((r) => r.epoch != null && r.amountAda != null);
      // The tip epoch may still be in progress — exclude it (same rule as
      // reward-flow) so every row is a completed snapshot.
      if (out.tip && list.length && list[0].epoch === out.tip.epoch) list = list.slice(1);
      list.sort((a, b) => a.epoch - b.epoch);
      if (list.length >= 2) out.epochRows = list;
    }
  } catch (_) { /* epochRows stay null → page shows "–", never fake data */ }

  // Current DRep census.
  try {
    const list = await fetchJson("/k/api/v1/drep_list");
    if (Array.isArray(list) && list.length) out.census = list.map(normalizeCensusRow);
  } catch (_) { /* census stays null */ }

  // Circulation for the latest COMPLETED epoch (denominator for the share).
  try {
    const totals = await fetchJson("/k/api/v1/totals?limit=2");
    if (Array.isArray(totals) && totals.length) {
      let done = totals.filter((r) => Number(r.epoch_no) !== (out.tip ? out.tip.epoch : Number.MIN_SAFE_INTEGER));
      if (out.tip) done = totals.filter((r) => Number(r.epoch_no) < out.tip.epoch);
      const row = done.length ? done[done.length - 1] : null;
      if (row && row.circulation != null) out.circulation = Number(row.circulation) / 1e6;
    }
  } catch (_) { /* circulation stays null */ }

  return out;
}

// ── rendering ────────────────────────────────────────────────────────────
function gaugeColor(score) {
  if (score >= 90) return "var(--green)";
  if (score >= 65) return "var(--amber)";
  return "var(--red)";
}

function renderHealth(h) {
  el("gauge").style.setProperty("--pct", h.score);
  el("gauge").style.setProperty("--gc", gaugeColor(h.score));
  el("gauge-n").textContent = String(h.score);
  el("gauge-s").textContent = h.label;
  el("checks").innerHTML = h.checks
    .map(
      (c) =>
        `<li class="${c.pass ? "pass" : ""}"><span class="${c.pass ? "ok" : "no"}">${
          c.pass ? "✓" : "✗"
        }</span><span>${c.label}</span><span class="c-mono" style="margin-left:auto">${c.pts} pts</span></li>`
    )
    .join("");
}

function renderCensus(census) {
  if (!census) {
    ["census-total", "census-active", "census-key", "census-script"].forEach((id) => (el(id).textContent = "–"));
    return;
  }
  const c = censusStats(census);
  el("census-total").textContent = fmtInt(c.total);
  el("census-key").textContent = fmtInt(c.key);
  el("census-script").textContent = fmtInt(c.script);
  el("census-integrity").textContent = c.integrity != null ? fmtPct(c.integrity, 1) : "–";
  el("census-integrity-bar").style.setProperty("--pct", (c.integrity ?? 0) * 100);
}

function renderTrend(t) {
  if (!t) {
    ["trend-end", "trend-growth", "trend-growpct", "trend-active", "trend-start"].forEach((id) => (el(id).textContent = "–"));
    return;
  }
  el("trend-end").textContent = fmtM(t.endAda) + " ADA";
  el("trend-growth").textContent = fmtSignedM(t.growthAda) + " ADA";
  el("trend-growpct").textContent = t.growthPct != null ? `${(t.growthPct).toFixed(1)}×` : "–";
  el("trend-active").textContent = fmtInt(t.latestDreps);
  el("trend-start").textContent = `${fmtInt(t.startDreps)} → ${fmtInt(t.latestDreps)} DReps`;
}

function renderSpark(id, values, fmtTip) {
  if (!values || !values.length) { el(id).innerHTML = ""; return; }
  const max = Math.max(...values, 1);
  el(id).innerHTML = values
    .map(
      (v, i) =>
        `<div class="col" title="${fmtTip ? fmtTip(v) : v}" style="height:${Math.max(
          6,
          (v / max) * 100
        )}%"></div>`
    )
    .join("");
}

function renderShare(share) {
  if (share == null) {
    el("share-val").textContent = "–";
    el("share-bar").style.setProperty("--pct", 0);
    return;
  }
  el("share-val").textContent = fmtPct(share, 2);
  el("share-bar").style.setProperty("--pct", Math.min(100, share * 100));
}

function renderTable(rows) {
  if (!rows || !rows.length) return;
  const recent = rows.slice(-12).reverse(); // newest first, last 12
  el("rows-tbody").innerHTML = recent
    .map(
      (r) => `<tr>
        <td class="c-mono">#${r.epoch}</td>
        <td class="c-mono">${fmtM(r.amountAda)} ADA</td>
        <td class="c-mono">${fmtInt(r.dreps)}</td>
        <td class="c-mono ${r.deltaAda != null && r.deltaAda < 0 ? "verdict bad" : ""}">${
          r.deltaAda != null ? fmtSignedM(r.deltaAda) : "–"
        }</td>
        <td class="c-mono">${r.deltaDreps != null ? fmtSignedM(r.deltaDreps) : "–"}</td>
      </tr>`
    )
    .join("");
}

function setLive(on, label) {
  el("live-dot").className = on ? "dot" : "dot stale";
  el("live-text").textContent = label;
}

// ── boot + refresh ───────────────────────────────────────────────────────
let lastRendered = null;

async function refresh() {
  const live = await loadLive();
  const hasData = live.epochRows || live.census;
  if (!hasData) {
    setLive(!!live.tip, live.tip ? "indexer offline" : "offline");
    if (!lastRendered) {
      el("gauge-n").textContent = "–";
      el("gauge-s").textContent = "offline";
      el("checks").innerHTML =
        '<li><span class="no">✗</span><span>data.cardano.org unreachable — retrying every 10 min</span></li>';
    }
    return;
  }
  lastRendered = true;

  let trend = null;
  if (live.epochRows) trend = delegationTrend(live.epochRows);
  const share =
    trend && live.circulation != null ? shareOfCirculation(trend.endAda, live.circulation) : null;
  const census = live.census ? censusStats(live.census) : null;

  const h = drepHealth({ share, trend, census });
  renderHealth(h);
  renderCensus(live.census ? census : null);
  renderTrend(trend);
  renderShare(share);

  if (trend) {
    renderSpark("stake-spark", trend.rows.map((r) => r.amountAda), (v) => fmtM(v) + " ADA");
    renderSpark("dreps-spark", trend.rows.map((r) => r.dreps ?? 0), (v) => fmtInt(v) + " DReps");
    renderTable(trend.rows);
    el("stake-legend-l").textContent = `epoch ${trend.startEpoch}: ${fmtM(trend.startAda)} ADA`;
    el("dreps-legend-l").textContent = `epoch ${trend.startEpoch}: ${fmtInt(trend.startDreps)}`;
  }

  setLive(true, `live · epoch ${live.tip ? live.tip.epoch : "n/a"}`);
}

document.addEventListener("DOMContentLoaded", () => {
  refresh().catch(() => setLive(false, "offline"));
  setInterval(() => {
    refresh().catch(() => {});
  }, REFRESH_MS);
});
