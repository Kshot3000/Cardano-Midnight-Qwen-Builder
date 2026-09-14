/* Validator Watch — live Midnight block-producer decentralization dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/block-producers?limit=200    -> sampled producer leaderboard
     GET /api/analytics/block-rate?hours=24 -> hourly block cadence
     GET /api/governance/d-parameter       -> on-chain D-parameter timeline
   All metric logic lives in src/producers.js (36 unit tests).
*/
import {
  normalizeProducers,
  concentration,
  producerIntegrity,
  parseDParamTimeline,
  dParamJourney,
  blockRateStats,
  validatorHealth,
} from "./src/producers.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const pct = (x, digits = 2) => (x == null ? "–" : (x * 100).toFixed(digits) + "%");
const fmtDate = (sec) =>
  sec
    ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
    : "—";
const shortPub = (pk) => (pk ? pk.slice(0, 10) + "…" + pk.slice(-6) : "—");

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

function renderConcentration(prods, conc, integ) {
  $("st-n").textContent = fmt(prods.length);
  const types = [...new Set(prods.map((p) => p.type).filter(Boolean))];
  $("st-type").textContent = types.length ? types.join(", ") : "";

  const sampledMatch = integ.sampledMatch;
  $("st-sampled").textContent = fmt(integ.recomputedTotal);
  $("st-rawsum").textContent = sampledMatch
    ? "✓ raw sum == API sample"
    : "✗ raw sum ≠ API sample";
  $("st-rawsum").style.color = sampledMatch ? "var(--green)" : "var(--red)";

  $("st-top1").textContent = pct(conc.top1Share);
  $("st-top3").textContent = pct(conc.top3Share);
  $("st-hhi").textContent = conc.hhi == null ? "–" : conc.hhi.toFixed(4);
  const even = prods.length ? 1 / prods.length : null;
  $("st-hhi-ev").textContent =
    even == null ? "" : `even ${prods.length}-split ≈ ${even.toFixed(4)} · Δ ${(conc.hhi - even).toFixed(4)}`;
  $("st-hhi-ev").style.color =
    conc.hhi == null || even == null ? "var(--muted)" : conc.hhi <= even + 0.02 ? "var(--green)" : "var(--amber)";
}

function renderProducers(prods) {
  const wrap = $("producer-rows");
  if (!prods.length) {
    wrap.innerHTML = `<div class="share-row"><span class="nm" style="color:var(--muted)">no producers exposed by the indexer right now</span></div>`;
    return;
  }
  const total = prods.reduce((s, p) => s + p.blocks, 0);
  wrap.innerHTML = prods
    .map((p, i) => {
      const share = total ? p.blocks / total : null;
      const nm = p.name || shortPub(p.pubkey);
      const sub = p.name ? shortPub(p.pubkey) : "";
      return `<div class="share-row">
        <span class="rank">${i + 1}</span>
        <span class="nm" title="${p.pubkey || ""}">${nm}${sub ? ` <span class="pub">${sub}</span>` : ""}</span>
        <span class="bar"><i style="width:${share == null ? 0 : (share * 100).toFixed(2)}%"></i></span>
        <span class="bl">${fmt(p.blocks)}</span>
        <span class="pc">${p.percentage == null ? "–" : p.percentage.toFixed(2)}</span>
      </div>`;
    })
    .join("");
}

function renderCadence(cad) {
  $("st-cad-mean").textContent = cad.meanBlocksPerHour == null ? "–" : fmt(cad.meanBlocksPerHour);
  $("st-cad-dev").textContent =
    cad.deviationPct == null ? "" : `${cad.deviationPct >= 0 ? "+" : ""}${cad.deviationPct.toFixed(2)}% vs 600/h`;
  $("st-cad-target").textContent = `${cad.onTargetHours} / ${cad.hours} h`;
  $("st-cad-total").textContent = fmt(cad.totalBlocks);
  $("st-cad-extr").textContent = `${fmt(cad.totalExtrinsics)} extrinsics`;
}

function renderCadenceStrip(rows, expected) {
  const strip = $("cadence-strip");
  const maxB = Math.max(expected, ...rows.map((r) => Number(r.blocks) || 0), 1);
  strip.innerHTML = rows
    .map((r) => {
      const b = Number(r.blocks) || 0;
      const h = new Date((Number(r.hour) || 0) * 1000).getUTCHours();
      const cls = b >= 0.98 * expected ? "" : " partial";
      return `<div class="ch${cls}" style="height:${Math.max(4, (b / maxB) * 100)}%" title="${h}:00 UTC — ${b} blocks (${b === expected ? "on target" : b < expected ? "partial hour" : "above target"})"></div>`;
    })
    .join("");
}

function renderDParam(timeline, journey, nowSec) {
  if (!timeline.length) {
    $("dparam-body").innerHTML =
      `<div class="section-sub" style="color:var(--muted)">No D-parameter history exposed by the indexer right now — showing nothing rather than inventing a number.</div>`;
    $("dparam-summary").innerHTML = "";
    return;
  }
  // cap to the most recent states so the list stays scannable
  const shown = timeline.length > 8 ? timeline.slice(-8) : timeline;
  const skip = timeline.length - shown.length;
  $("dparam-body").innerHTML =
    (skip ? `<div class="journey-step"><span class="jm">… ${skip} earlier state${skip === 1 ? "" : "s"} since genesis …</span></div>` : "") +
    shown
      .map((s, i) => {
        const isLast = i === shown.length - 1 && timeline.length > 1;
        const isGenesis = i === 0 && skip === 0;
        const tag = isGenesis
          ? `<span class="pill live">genesis</span>`
          : isLast
            ? `<span class="pill warn">current</span>`
            : "";
        return `<div class="journey-step">
          <span class="jv">${fmt(s.permissioned)} perm + ${fmt(s.registered)} reg</span>
          <span class="jm">blk ${s.blockHeight != null ? fmt(s.blockHeight) : "–"} · ${s.timestampSec ? fmtDate(s.timestampSec) : "–"} ${tag}</span>
        </div>`;
      })
      .join("");
  if (!journey) {
    $("dparam-summary").innerHTML = "—";
  } else {
    const days = journey.daysBetween != null ? ` over ${journey.daysBetween.toFixed(1)} days` : "";
    $("dparam-summary").innerHTML =
      `Candidate pool grew from <span class="jv">${fmt(journey.first.permissioned)}</span> to ` +
      `<span class="jv">${fmt(journey.latest.permissioned)}</span> permissioned validators` +
      ` (<span class="jv">${journey.deltaPermissioned >= 0 ? "+" : ""}${fmt(journey.deltaPermissioned)}</span>${days}), with ` +
      `<span class="jv">${fmt(journey.latest.registered)}</span> openly registered on the current state.`;
  }
}

async function refresh() {
  try {
    const [bp, rate, dp] = await Promise.all([
      getJSON("/api/block-producers?limit=200"),
      getJSON("/api/analytics/block-rate?hours=24").catch(() => []),
      getJSON("/api/governance/d-parameter").catch(() => null),
    ]);

    const prods = normalizeProducers(bp && bp.producers);
    const conc = concentration(prods);
    const integ = producerIntegrity(prods, bp);
    const h = validatorHealth({
      sampled: integ.recomputedTotal,
      top1Share: conc.top1Share,
      top3Share: conc.top3Share,
      integrity: integ,
    });
    const cad = blockRateStats(rate, { expectedBlocksPerHour: 600 });
    const timeline = dp ? parseDParamTimeline(dp.history) : [];
    const journey = dParamJourney(timeline, Math.floor(Date.now() / 1000));

    renderGauge(h);
    renderConcentration(prods, conc, integ);
    renderProducers(prods);
    renderCadence(cad);
    renderCadenceStrip(Array.isArray(rate) ? rate : [], 600);
    renderDParam(timeline, journey, Math.floor(Date.now() / 1000));

    setLive(
      true,
      `live · ${fmt(prods.length)} producers · ${fmt(integ.recomputedTotal)} blocks sampled`
    );
    return { ok: true, producers: prods.length, sampled: integ.recomputedTotal, health: h.score };
  } catch (e) {
    console.error("Validator Watch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
