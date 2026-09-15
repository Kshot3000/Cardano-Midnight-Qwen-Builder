// Reward Flow Watch — UI logic.
//
// Live data (keyless, CORS *):
//   data.cardano.org /tip    → current (in-progress) epoch + block info
//   data.cardano.org /totals → one row per completed epoch (lovelace strings)
//
// Pure math (normalization, conservation identities, health rubric,
// formatters) lives in src/flow.js and is unit-tested in test/flow.test.mjs.

import {
  MAX_SUPPLY_ADA,
  PARAMS,
  normalizeTotals,
  summarize,
  engineHealth,
  fmtAda,
  fmtM,
  fmtSignedM,
  fmtPct,
} from "./src/flow.js";

const API = "https://data.cardano.org/k/api/v1";
// Window: last 20 COMPLETED epochs. Fetch 21 rows (newest-first) so we can
// drop the current in-progress epoch when the tip row is already indexed.
const WINDOW = 20;
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
  const out = { tip: null, rows: null };
  try {
    const t = await fetchJson("/tip");
    const tip = Array.isArray(t) ? t[0] : t;
    out.tip = {
      epoch: tip.epoch_no,
      block: tip.block_height,
      blockTime: tip.block_time * 1000,
    };
  } catch (_) { /* tip stays null */ }

  try {
    const rows = await fetchJson(
      `/totals?limit=${WINDOW + 1}&select=epoch_no,supply,reserves,treasury,reward,circulation,fees,treasury_donation,treasury_withdrawal,reserves_withdrawal`
    );
    if (Array.isArray(rows) && rows.length >= 2) {
      let list = rows.map(normalizeTotals);
      // The tip epoch is still in progress — exclude it so every row is a
      // completed snapshot. (The index may lag, so only drop when present.)
      if (out.tip && list[0].epoch === out.tip.epoch) list = list.slice(1);
      list.sort((a, b) => a.epoch - b.epoch);
      if (list.length >= 2) out.rows = list;
    }
  } catch (_) { /* rows stay null → page shows "–", never fake data */ }

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

function renderSupply(s) {
  el("supply-end").textContent = s.supplyEnd != null ? `${fmtM(s.supplyEnd)} ADA` : "–";
  el("reserves-end").textContent = s.reservesEnd != null ? `${fmtM(s.reservesEnd)} ADA` : "–";
  el("reward-end").textContent = s.rewardEnd != null ? `${fmtM(s.rewardEnd)} ADA` : "–";
  if (s.supplyEnd != null) {
    el("cap-util").textContent = fmtPct(s.supplyEnd / MAX_SUPPLY_ADA, 2);
    el("cap-bar").style.setProperty("--pct", (s.supplyEnd / MAX_SUPPLY_ADA) * 100);
  } else {
    el("cap-util").textContent = "–";
  }
  el("cap-start").textContent = `window start: ${fmtM(s.supplyStart)} ADA`;
}

function renderMint(s) {
  const mints = s.pairs.map((p) => p.mint);
  const max = Math.max(...mints.map((m) => Math.abs(m)), 1);
  el("mint-spark").innerHTML = mints
    .map(
      (m) =>
        `<div class="col" title="${fmtAda(m)} ADA" style="height:${Math.max(
          6,
          (m / max) * 100
        )}%"></div>`
    )
    .join("");
  el("mint-avg").textContent = fmtM(s.avgMintPerEpoch) + " ADA";
  el("rate-epoch").textContent = fmtPct(s.avgEffectiveRate, 3);
  el("rate-annual").textContent = fmtPct(s.avgEffectiveRate * 73, 2);
}

function renderAudit(s) {
  const capOk = s.allConserved;
  el("cap-row").innerHTML = capOk
    ? `<span class="verdict ok">✓ PASS</span> — supply + reserves equals the 45,000,000,000 ADA cap in all ${
        s.epochs
      } epoch transitions (max drift ${s.maxAbsDrift.toExponential(2)} ADA).`
    : `<span class="verdict bad">✗ FAIL</span> — supply + reserves drifted up to ${s.maxAbsDrift.toFixed(
        2
      )} ADA from the 45B cap. The indexer's table is internally inconsistent.`;

  const mintDecayOk = Math.abs(s.totalMint - s.totalDecay) < Math.max(1, s.totalDecay * 0.001);
  el("mintdecay-row").innerHTML = mintDecayOk
    ? `<span class="verdict ok">✓ PASS</span> — minted ${fmtM(s.totalMint)} ADA across ${
        s.epochs
      } epochs, headroom fell by exactly ${fmtM(s.totalDecay)} ADA. Every coin minted came from the cap's headroom.`
    : `<span class="verdict bad">✗ FAIL</span> — mint ${fmtM(s.totalMint)} ADA ≠ headroom decay ${fmtM(
        s.totalDecay
      )} ADA; unexplained supply source/sink detected.`;
}

function renderRewards(s) {
  el("reward-delta").textContent = fmtSignedM(s.rewardDelta) + " ADA";
  el("fee-income").textContent = s.feeIncome != null ? fmtM(s.feeIncome) + " ADA" : "–";
  el("claims").textContent = fmtSignedM(s.claims) + " ADA";
  el("rho").textContent = fmtPct(PARAMS.rho, 1) + " / epoch";
}

// rows[i] is the row that pair i describes (pair i = rows[i-1] → rows[i]).
function renderTable(s, rows) {
  el("rows-tbody").innerHTML = s.pairs
    .map((p, i) => ({ p, r: rows[i] }))
    .slice()
    .reverse() // newest first
    .map(
      ({ p, r }) => `<tr>
        <td class="c-mono">#${p.toEpoch}</td>
        <td class="c-mono">${fmtAda(r.supply)}</td>
        <td class="c-mono">${fmtAda(r.reserves)}</td>
        <td class="c-mono">${fmtAda(p.mint)}</td>
        <td class="c-mono">${fmtPct(p.effectiveRate, 3)}</td>
        <td class="c-mono ${p.conserved ? "" : "verdict bad"}">${p.conserved ? "✓" : "✗"}</td>
      </tr>`
    )
    .join("");
}

function setLive(on, label) {
  el("live-dot").className = on ? "dot" : "dot stale";
  el("live-text").textContent = label;
}

// ── boot + refresh ───────────────────────────────────────────────────────
let lastRows = null;

async function refresh() {
  const live = await loadLive();
  if (!live.rows) {
    setLive(false, live.tip ? "totals offline" : "offline");
    if (!lastRows) {
      el("gauge-n").textContent = "–";
      el("gauge-s").textContent = "offline";
      el("checks").innerHTML =
        '<li><span class="no">✗</span><span>data.cardano.org unreachable — retrying every 10 min</span></li>';
    }
    return;
  }
  lastRows = live.rows;

  const s = summarize(live.rows);
  const latest = live.rows[live.rows.length - 1];
  // Use the indexer's own circulation/treasury when present (falls back to
  // "–" honestly when a field is missing from the table).
  if (latest.circulation != null)
    el("circulation-end").textContent = `${fmtM(latest.circulation)} ADA`;
  if (latest.treasury != null) el("treasury-end").textContent = `${fmtM(latest.treasury)} ADA`;

  const h = engineHealth(s);
  renderHealth(h);
  renderSupply(s);
  renderMint(s);
  renderAudit(s);
  renderRewards(s);
  renderTable(s, live.rows);

  setLive(true, `live · epoch ${live.tip ? live.tip.epoch : "n/a"}`);
}

document.addEventListener("DOMContentLoaded", () => {
  refresh().catch(() => setLive(false, "offline"));
  setInterval(() => {
    refresh().catch(() => {});
  }, REFRESH_MS);
});
