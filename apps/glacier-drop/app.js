// Glacier Drop checker — UI logic.
//
// Live data (keyless, CORS *):
//   data.cardano.org /tip  → current epoch, block height, block_time
//   data.cardano.org /mint → NIGHT mint txs (live on-chain NIGHT supply check)
//
// Pure math (thaw schedule, bech32, conversions) lives in src/glacier.js
// and is unit-tested in test/glacier.test.mjs.

import {
  TIMELINE,
  NIGHT_TOKEN,
  thawProgress, allocationStatus,
  phaseStatus, daysUntil, thawDayOf360,
  starToNight, nightToStar, formatStar,
  validateCardanoAddress,
} from "./src/glacier.js";

const API = "https://data.cardano.org/k/api/v1";
const DAY_MS = 86_400_000;
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

// ── live network status ──────────────────────────────────────────────────
async function loadLive() {
  const out = { tip: null, mintStar: null, mintOk: false };
  try {
    const t = await fetchJson("/tip");
    const tip = Array.isArray(t) ? t[0] : t;
    out.tip = {
      epoch: tip.epoch_no,
      block: tip.block_height,
      blockTime: tip.block_time * 1000,
    };
  } catch (_) { /* tip stays null */ }

  // Live NIGHT on-chain check: sum the mint txs for the NIGHT asset.
  // (NIGHT was minted to Cardano in one 24B batch on 2025-10-24, but the
  // live sum proves the asset exists on mainnet and shows the minted total.)
  try {
    const page = await fetchJson(
      `/mint?select=asset_name,policy_id,amount&asset=${NIGHT_TOKEN.assetNameHex}&policy=${NIGHT_TOKEN.policyId}&order=desc&limit=20`
    );
    if (Array.isArray(page)) {
      const rows = page.filter(
        (r) =>
          String(r.policy_id).toLowerCase() === NIGHT_TOKEN.policyId &&
          String(r.asset_name) === "NIGHT"
      );
      if (rows.length > 0) {
        const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        out.mintStar = total;
        out.mintOk = total > 0;
      }
    }
  } catch (_) { /* mint stays null → shown as "pending" */ }

  return out;
}

// ── phase + network thaw progress ────────────────────────────────────────
function renderNow(nowMs, tip, mint) {
  const phases = phaseStatus(nowMs);
  const prog = thawProgress(nowMs);
  const d360 = Math.min(361, Math.max(1, thawDayOf360(nowMs)));
  const daysTo = daysUntil(TIMELINE.thawEnd, nowMs);

  el("phase-claim").textContent = phaseLabel(phases.glacierClaim);
  el("phase-scavenger").textContent = phaseLabel(phases.scavengerMine);
  el("phase-thaw").textContent = phaseLabel(phases.thawing);
  el("prog-pct").textContent = `${(prog * 100).toFixed(1)}%`;
  el("prog-bar").style.width = `${Math.min(100, prog * 100)}%`;
  el("day-of-360").textContent = phases.thawing === "upcoming" ? "—" : `day ${d360} / 360`;
  el("days-left").textContent =
    phases.thawing === "done" ? "complete" : `${daysTo} d`;
  if (tip) {
    el("tip-epoch").textContent = `#${tip.epoch}`;
    el("tip-block").textContent = tip.block.toLocaleString();
    el("tip-time").textContent = new Date(tip.blockTime).toLocaleDateString();
    el("tip-ok").textContent = "live";
  } else {
    el("tip-epoch").textContent = "pending";
    el("tip-block").textContent = "pending";
    el("tip-time").textContent = "pending";
    el("tip-ok").textContent = "offline";
  }
  // live NIGHT mint sum (honest "pending" when the endpoint has no data)
  const mintEl = el("mint-amount");
  if (mint && mint.ok) {
    mintEl.textContent = `${formatStar(mint.star)} NIGHT`;
    mintEl.classList.remove("pending-tag");
  } else {
    mintEl.textContent = "pending — endpoint unreachable";
    mintEl.classList.add("pending-tag");
  }
}

function phaseLabel(p) {
  return p === "done" ? "✓ done" : p === "open" ? "● open" : "○ upcoming";
}

// ── allocation checker ───────────────────────────────────────────────────
function renderAllocation() {
  const night = Number(el("alloc-amount").value);
  const day = Number(el("alloc-day").value);
  const nowMs = Date.now();
  const errEl = el("alloc-error");
  const resEl = el("alloc-result");
  resEl.classList.add("hide");
  errEl.classList.remove("show");

  if (!Number.isFinite(night) || night <= 0) {
    errEl.textContent = "Enter your allocation in NIGHT (e.g. 12,500).";
    errEl.classList.add("show");
    return;
  }
  if (!Number.isInteger(day) || day < 1 || day > 90) {
    errEl.textContent = "The thaw day must be 1–90 (it is shown in the official claim portal).";
    errEl.classList.add("show");
    return;
  }

  const totalStar = nightToStar(night);
  const a = allocationStatus(totalStar, day, nowMs);
  const st = a; // status fields are spread into the same object

  // summary numbers
  el("res-total").textContent = formatStar(totalStar, 6) + " NIGHT";
  el("res-unlocked").textContent = `${st.unlocked} / 4`;
  el("res-unlocked-amt").textContent = formatStar(st.unlockedStar, 6) + " NIGHT";
  el("res-locked").textContent = formatStar(st.lockedStar, 6) + " NIGHT";
  el("res-first").textContent = fmtDate(a.firstUnlockMs);
  el("res-last").textContent = fmtDate(a.schedule[3].dateMs);
  el("res-next").textContent = st.fullyThawed ? "all unlocked" : fmtDate(st.next.dateMs);
  el("res-locked-pct").textContent = `${((st.lockedStar / totalStar) * 100).toFixed(1)}%`;
  el("res-locked-bar").style.width = `${(st.lockedStar / totalStar) * 100}%`;

  // schedule table
  el("schedule").innerHTML = a.schedule
    .map((row) => {
      const released = nowMs >= row.dateMs;
      const isNext = st.next && st.next.dateMs === row.dateMs;
      const tag = released
        ? '<span class="tag done">released</span>'
        : isNext
        ? '<span class="tag next">next</span>'
        : '<span class="tag wait">locked</span>';
      return `<tr>
        <td class="c-idx">#${row.index}</td>
        <td class="c-num">${fmtDate(row.dateMs)}</td>
        <td class="c-num">${formatStar(row.amountStar, 6)} NIGHT</td>
        <td class="c-num">${(starToNight(row.amountStar) / starToNight(totalStar) * 100).toFixed(2)}%</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");

  resEl.classList.remove("hide");
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ── address validator ────────────────────────────────────────────────────
function renderAddress() {
  const input = el("addr-input").value;
  const r = validateCardanoAddress(input);
  const el_ = el("addr-result");
  el_.classList.remove("show", "ok", "bad");
  if (!input.trim()) return;
  el_.classList.add("show");
  if (r.ok) {
    el_.classList.add("ok");
    el_.textContent = `✓ valid ${r.hrp} · ${r.network} · ${r.purpose}-cred · ${r.byteLength} bytes — a valid destination for a NIGHT claim.`;
  } else {
    el_.classList.add("bad");
    el_.textContent = "✗ not a valid Cardano address (" + r.reason + ")";
  }
}

// ── boot ─────────────────────────────────────────────────────────────────
async function boot() {
  const errEl = el("load-error");
  try {
    const live = await loadLive();
    const mint = { star: live.mintStar || 0, ok: live.mintOk };
    renderNow(live.tip ? live.tip.blockTime : Date.now(), live.tip, mint);
    el("updated").textContent = new Date().toLocaleTimeString();
    el("live-pill").innerHTML = live.tip
      ? '<span class="dot"></span> live'
      : '<span class="dot stale"></span> tip offline';
  } catch (e) {
    renderNow(Date.now(), null, { star: 0, ok: false });
    errEl.textContent = "Live Cardano tip unavailable — showing deterministic thaw schedule from the local clock.";
    errEl.classList.add("show");
    el("live-pill").innerHTML = '<span class="dot stale"></span> offline';
  }
  el("status-loading").classList.add("hide");

  el("alloc-amount").addEventListener("input", renderAllocation);
  el("alloc-day").addEventListener("input", renderAllocation);
  el("addr-input").addEventListener("input", renderAddress);

  // pre-fill sensible defaults and render once
  el("alloc-day").value = 1;
  renderAllocation();
}

document.addEventListener("DOMContentLoaded", boot);
