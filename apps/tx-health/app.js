/* Tx Health Monitor — live Midnight transaction-settlement dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/analytics/tx-health        -> lifetime applied vs partial-success + recent partials
     GET /api/governance/d-parameter     -> on-chain decentralization parameter timeline
   All metric logic lives in src/txhealth.js (30 unit tests).
*/
import {
  summarizeTxHealth,
  parseRecentPartial,
  parseDParam,
  dParamDelta,
  txHealthScore,
  ageLabel,
  shortHash,
} from "./src/txhealth.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const pct = (x, digits = 2) => (x == null ? "–" : (x * 100).toFixed(digits) + "%");
const fmtDate = (sec) =>
  sec
    ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
    : "—";

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

function renderStats(s) {
  $("st-applied").textContent = fmt(s.applied);
  $("st-partial").textContent = fmt(s.partial);
  $("st-total").textContent = fmt(s.total);
  $("st-rate").textContent = s.ratePct == null ? "–" : s.ratePct.toFixed(3) + "%";
  $("st-applied-share").textContent = s.appliedShare == null ? "" : pct(s.appliedShare);
  $("st-reported").textContent = s.reportedRatePct == null ? "–" : s.reportedRatePct.toFixed(2) + "%";
  $("st-delta").textContent =
    s.rateDeltaPct == null
      ? "no API value"
      : `Δ ${s.rateDeltaPct >= 0 ? "+" : ""}${s.rateDeltaPct.toFixed(4)}pp`;
  $("st-sum").textContent = s.sumCheck
    ? "✓ applied + partial = total"
    : "✗ counts do not add up";
  $("st-sum").style.color = s.sumCheck ? "var(--green)" : "var(--red)";

  const partialPct = s.total ? (s.partial / s.total) * 100 : 0;
  $("split-applied").style.width = (s.total ? 100 - partialPct : 0) + "%";
  $("split-partial").style.width = s.total ? Math.max(partialPct, 0.4) + "%" : "0%";
  $("split-legend-l").textContent = s.total
    ? `${fmt(s.applied)} applied (${s.appliedShare == null ? "–" : pct(s.appliedShare)})`
    : "–";
  $("split-legend-r").textContent = s.total
    ? `${fmt(s.partial)} partial (${partialPct.toFixed(3)}%)`
    : "–";
}

function renderPartials(p, nowSec) {
  if (!p.count) {
    $("partial-tbody").innerHTML =
      `<tr><td colspan="4" style="padding:14px;color:var(--green)">✓ No partial-success transactions recorded.</td></tr>`;
    $("dup-note").textContent = "";
    return;
  }
  $("partial-tbody").innerHTML = p.rows
    .map(
      (row) => `<tr>
        <td class="c-mono">${shortHash(row.txHash)}</td>
        <td class="c-mono">${row.block != null ? fmt(row.block) : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${row.timestampSec ? fmtDate(row.timestampSec) : "–"}</td>
        <td class="c-mono" style="color:var(--muted)">${ageLabel(row.timestampSec, nowSec)}</td>
      </tr>`
    )
    .join("");
  $("dup-note").textContent = p.duplicateEmissions
    ? `${p.duplicateEmissions} duplicate emission${p.duplicateEmissions === 1 ? "" : "s"} dropped during de-duplication (the indexer re-emits the same partial tx up to 3×).`
    : "";
}

function renderDParam(timeline, delta) {
  if (!timeline.length) {
    $("dparam-body").innerHTML =
      `<div class="section-sub" style="color:var(--muted)">No D-parameter history exposed by the indexer right now — showing nothing rather than inventing a number.</div>`;
    return;
  }
  $("dparam-body").innerHTML = timeline
    .map((s, i) => {
      const tag =
        timeline.length > 1
          ? i === 0
            ? `<span class="pill live">genesis</span>`
            : i === timeline.length - 1
              ? `<span class="pill warn">current</span>`
              : ""
          : `<span class="pill live">only state</span>`;
      const share =
        s.permissionedShare == null
          ? "–"
          : s.permissionedShare === 1
            ? "100% (no registered candidates yet)"
            : pct(s.permissionedShare);
      return `<div class="kv">
        <span class="k">block ${s.blockHeight != null ? fmt(s.blockHeight) : "–"} · ${s.timestampSec ? fmtDate(s.timestampSec) : "–"} ${tag}</span>
        <span class="v">${fmt(s.permissioned)} permissioned + ${fmt(s.registered)} registered → ${share}</span>
      </div>`;
    })
    .join("");

  if (!delta) {
    $("dparam-summary").innerHTML = "—";
  } else {
    $("dparam-summary").innerHTML =
      `Since genesis the on-chain candidate pool went from ` +
      `<span style="font-family:var(--mono)">${fmt(delta.first.permissioned)}</span> to ` +
      `<span style="font-family:var(--mono)">${fmt(delta.latest.permissioned)}</span> ` +
      `permissioned candidates (<span style="font-family:var(--mono)">` +
      `${delta.deltaPermissioned >= 0 ? "+" : ""}${fmt(delta.deltaPermissioned)}</span>), with ` +
      `<span style="font-family:var(--mono)">${fmt(delta.latest.registered)}</span> openly registered candidates on the current state.`;
  }
}

async function refresh() {
  try {
    const [txh, dp] = await Promise.all([
      getJSON("/api/analytics/tx-health"),
      getJSON("/api/governance/d-parameter").catch(() => null),
    ]);

    const s = summarizeTxHealth(txh);
    const h = txHealthScore(s);
    const p = parseRecentPartial(txh.recentPartial);
    const timeline = dp ? parseDParam(dp.history) : [];
    const delta = dParamDelta(timeline);

    const nowSec = Math.floor(Date.now() / 1000);
    renderGauge(h);
    renderStats(s);
    renderPartials(p, nowSec);
    renderDParam(timeline, delta);

    setLive(
      true,
      `live · ${fmt(s.total)} tx indexed · ${s.ratePct == null ? "–" : s.ratePct.toFixed(2) + "%"} partial`
    );
    return { ok: true, total: s.total, health: h.score, partials: p.count };
  } catch (e) {
    console.error("Tx Health Monitor refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
