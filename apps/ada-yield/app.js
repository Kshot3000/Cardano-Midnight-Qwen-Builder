// Ada Yield Tracker — live Cardano staking yield from data.cardano.org (Koios).
// Keyless, CORS *. Pure math lives in src/rewards.js + src/poolmath.js.
//
// Data sources (all keyless, CORS *, verified 2026-09-14):
//   /tip                    → current epoch
//   /totals?_epoch_no=N     → fees, reserves, supply, circulation (last completed epoch)
//   /cli_protocol_params    → monetaryExpansion(rho), treasuryCut(tau), poolIncentive(k)
//   /pool_list (paged)      → pool_id_bech32, ticker, margin, fixed_cost, pledge, active_stake
//
// Pot model (matches the Cardano Foundation reward calculator exactly):
//   pot = (fees + rho*reserves) * (1 - tau)
// Per-pool APY via the exact CIP-16 formula in src/rewards.js.

import {
  DEFAULTS, rewardPotAda, annualYield, saturation, comparePools,
} from "./src/rewards.js";
import { toPoolInput, topByStake, networkApy } from "./src/poolmath.js";

const API = "https://data.cardano.org/k/api/v1";
const EPOCHS_PER_YEAR = 73; // 365 / 5-day epochs
const LOV = 1e6;

// ── fetch with retry (data.cardano.org HAProxy intermittently 404s/502s) ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(path, { tries = 3, timeoutMs = 45000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${API}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 200) return await r.json();
      last = new Error(`HTTP ${r.status} ${path}`);
      if (r.status !== 404 && r.status !== 502 && r.status !== 503) break;
      if (i < tries - 1) await sleep(400 * (i + 1));
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
  }
  throw last;
}

function lovalce(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / LOV : null;
}

// ── load everything ──
async function loadNetwork() {
  const tipRaw = await fetchJson("/tip");
  const tip = Array.isArray(tipRaw) ? tipRaw[0] : tipRaw;
  const curEpoch = tip.epoch_no;
  const lastDone = curEpoch - 1;

  let totals = null;
  try {
    const t = await fetchJson(`/totals?_epoch_no=${lastDone}`);
    totals = Array.isArray(t) ? t[0] : t;
  } catch (_) { /* keep null */ }

  let params = null;
  try {
    const p = await fetchJson("/cli_protocol_params");
    params = Array.isArray(p) ? p[0] : p;
  } catch (_) { /* keep null */ }

  // page through all pools (no order — active_stake only populates without order)
  const pools = [];
  let offset = 0;
  for (let i = 0; i < 30; i++) {
    const page = await fetchJson(
      `/pool_list?select=pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake&limit=400&offset=${offset}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    pools.push(...page);
    if (page.length < 400) break;
    offset += 400;
  }

  return { tip, curEpoch, lastDone, totals, params, pools };
}

// ── derive the reward model (pot + params) with graceful fallbacks ──
function deriveModel(totals, params) {
  const rho = (params && Number(params.monetaryExpansion)) || DEFAULTS.tau; // tau in DEFAULTS = rho 0.003
  const tauCut = (params && Number(params.treasuryCut)) || DEFAULTS.treasuryShare;
  const k = (params && Number(params.poolIncentive)) || DEFAULTS.k;
  const a0 = DEFAULTS.a0;

  const fees = totals ? lovalce(totals.fees) : null;
  const reserves = totals ? lovalce(totals.reserves) : null;
  const supply = totals ? lovalce(totals.supply) : null;
  const circulation = totals ? lovalce(totals.circulation) : null;
  const totalSupplyAda = supply || DEFAULTS.totalSupplyAda;

  // pot = (fees + rho*reserves) * (1 - tau). Use live totals when available.
  let pot;
  if (fees != null && reserves != null) {
    pot = (fees + rho * reserves) * (1 - tauCut);
  } else {
    // fallback: model pot from reserve + default fees=0
    pot = rewardPotAda({
      reserveAda: reserves ?? DEFAULTS.reserveAda,
      tau: rho,
      feesAda: 0,
      treasuryShare: tauCut,
    });
  }

  return { rho, tauCut, k, a0, pot, fees, reserves, supply, circulation, totalSupplyAda,
           totalsOk: !!totals, paramsOk: !!params };
}

// ── compute per-pool yields using the exact CIP-16 formula ──
function computePools(poolsRaw, model) {
  const input = toPoolInput(poolsRaw); // drops inactive pools, converts to ADA
  const ranked = topByStake(input, 10000);
  const rows = comparePools(
    ranked.map((p) => ({
      label: p.ticker || p.poolId,
      poolId: p.poolId,
      ticker: p.ticker,
      poolStakeAda: p.activeStakeAda,
      pledgeAda: p.pledgeAda,
      cost: p.costAda,
      margin: p.margin,
      yourAda: 1000,
    })),
    {
      totalSupplyAda: model.totalSupplyAda,
      k: model.k,
      a0: model.a0,
      pot: model.pot,
      yourAda: 1000,
      epochsPerYear: EPOCHS_PER_YEAR,
    }
  );
  // comparePools sorts by apy desc; re-sort by stake desc for the main table
  const byStake = rows.slice().sort((a, b) => b.activeStakeAda - a.activeStakeAda);
  return { byApy: rows, byStake, totalActiveStakeAda: input.reduce((s, p) => s + p.activeStakeAda, 0), count: input.length };
}

// ── formatting ──
const fmt = (n, d = 2) => (n == null || !Number.isFinite(n)) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtAda = (n) => (n == null || !Number.isFinite(n)) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtB = (n) => (n == null || !Number.isFinite(n)) ? "—" : `${(n / 1e9).toFixed(2)}B`;
const fmtM = (n) => (n == null || !Number.isFinite(n)) ? "—" : `${(n / 1e6).toFixed(2)}M`;
const name = (r) => (r.ticker && r.ticker.length ? r.ticker : (r.poolId ? r.poolId.slice(0, 10) + "…" : "—"));

// ── state ──
let STATE = null;
const el = (id) => document.getElementById(id);

function renderTable(rows, max) {
  max = max || rows.length;
  const topN = rows.slice(0, max);
  const maxApy = Math.max(...topN.map((r) => r.apyPct), 0.0001);
  el("pools").innerHTML = topN.map((r, i) => {
    const barW = Math.max(4, (r.apyPct / maxApy) * 100);
    const satBadge = r.satPct >= 100 ? `<span class="tag sat">sat</span>` : "";
    const satBar = `<div class="sat-track"><div class="sat-fill" style="width:${Math.min(100, r.satPct)}%"></div></div>`;
    return `<tr>
      <td class="c-idx">${i + 1}</td>
      <td class="c-name" title="${r.poolId || ''}">${name(r)}${satBadge}</td>
      <td class="c-num">${fmtB(r.activeStakeAda)}</td>
      <td class="c-num">${fmtAda(r.pledgeAda)}</td>
      <td class="c-num">${fmt(r.margin * 100, 1)}%</td>
      <td class="c-apy">${fmt(r.apyPct, 2)}%<div class="apy-bar"><div style="width:${barW}%"></div></div></td>
      <td class="c-sat">${satBar}</td>
    </tr>`;
  }).join("");
}

function render() {
  if (!STATE) return;
  const { model, result, netApyPct } = STATE;

  el("sum-epoch").textContent = `#${model.lastDone ?? "—"}`;
  el("sum-pot").textContent = fmtM(model.pot);
  el("sum-apy").textContent = `${fmt(netApyPct, 2)}%`;
  el("sum-circ").textContent = fmtB(model.circulation);
  el("sum-stake").textContent = fmtB(result.totalActiveStakeAda);
  el("sum-pools").textContent = fmtAda(result.count);
  el("sum-rho").textContent = `${fmt(model.rho * 100, 2)}%`;
  el("sum-tau").textContent = `${fmt(model.tauCut * 100, 1)}%`;
  el("sum-k").textContent = fmt(model.k, 0);

  const topApy = result.byApy[0];
  el("sum-top").textContent = topApy ? name(topApy) : "—";
  el("sum-topapy").textContent = topApy ? `${fmt(topApy.apyPct, 2)}%` : "—";

  renderTable(result.byStake, 50);
  wireCalc(model);
}

// ── "what if" calculator: model the user's stake as a solo pool ──
function wireCalc(model) {
  if (window.__calcWired) return;
  window.__calcWired = true;
  const update = () => {
    const stake = Number(el("calc-stake").value) || 0;
    const margin = (Number(el("calc-margin").value) || 0) / 100;
    const cost = Number(el("calc-cost").value) || 0;
    if (stake <= 0) {
      el("calc-apy").textContent = "—";
      el("calc-epoch").textContent = "—";
      el("calc-annual").textContent = "—";
      return;
    }
    const y = annualYield({
      totalSupplyAda: model.totalSupplyAda,
      k: model.k,
      a0: 0,
      pot: model.pot,
      poolStakeAda: stake,
      pledgeAda: 0,
      cost,
      margin,
      yourAda: stake,
      epochsPerYear: EPOCHS_PER_YEAR,
    });
    el("calc-apy").textContent = `${fmt(y.apyPct, 2)}%`;
    el("calc-epoch").textContent = `${fmtM(y.epochAda)} ADA / epoch`;
    el("calc-annual").textContent = `${fmtM(y.annualAda)} ADA / yr`;
    el("calc-per1000").textContent = `${fmtM(y.annualAda / 1000)} ADA per 1k staked`;
  };
  ["calc-stake", "calc-margin", "calc-cost"].forEach((id) => el(id).addEventListener("input", update));
  update();
}

// ── search filter ──
function wireSearch() {
  if (window.__searchWired) return;
  window.__searchWired = true;
  el("search").addEventListener("input", () => {
    if (!STATE) return;
    const q = el("search").value.trim().toLowerCase();
    const all = STATE.result.byStake;
    if (!q) { renderTable(all, 50); return; }
    const hit = all.filter((r) => name(r).toLowerCase().includes(q) || (r.poolId || "").includes(q));
    renderTable(hit, 50);
    el("search-count").textContent = `${hit.length} pool${hit.length === 1 ? "" : "s"}`;
  });
}

// ── boot ──
async function boot() {
  const errEl = el("load-error");
  try {
    const net = await loadNetwork();
    const model = deriveModel(net.totals, net.params);
    model.lastDone = net.lastDone;
    model.curEpoch = net.curEpoch;
    const result = computePools(net.pools, model);
    // Network APY: pot ÷ total staked ADA × epochs/yr. Use `circulation`
    // (the protocol's total active stake, ~36.7B) as the denominator — the
    // pool_list active_stake sum (~21B) undercounts it (only a subset of the
    // delegated stake is populated per pool row). Falls back to the pool sum.
    const netDenom = (model.circulation > 0) ? model.circulation : result.totalActiveStakeAda;
    const netApyPct = networkApy({ potAda: model.pot, totalActiveStakeAda: netDenom, epochsPerYear: EPOCHS_PER_YEAR }) * 100;
    STATE = { model, result, netApyPct, fetchedAt: Date.now() };

    const warns = [];
    if (!net.totals) warns.push("epoch totals unavailable — pot estimated from reserve model");
    if (!net.params) warns.push("live protocol params unavailable — using CIP-16 defaults (ρ 0.3%, τ 20%, k 500)");
    errEl.textContent = warns.length ? "⚠ " + warns.join("; ") : "";
    errEl.classList.toggle("show", warns.length > 0);
    render();
    wireSearch();
    el("live-pill").innerHTML = '<span class="dot"></span> live';
    el("updated").textContent = new Date().toLocaleTimeString();
  } catch (e) {
    errEl.textContent = "Could not load live data (data.cardano.org unreachable): " + e.message;
    errEl.classList.add("show");
    el("live-pill").innerHTML = '<span class="dot stale"></span> offline';
    el("status-loading").classList.add("hide");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  el("status-loading").classList.remove("hide");
  boot();
  // refresh the "updated" timestamp + re-render (for the live pill) every 30s
  setInterval(() => {
    if (STATE) {
      el("updated").textContent = new Date().toLocaleTimeString();
      render();
    }
  }, 30000);
});
