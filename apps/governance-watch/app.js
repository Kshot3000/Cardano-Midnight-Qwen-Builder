/* Governance Watch — live Midnight governance dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
     GET /api/governance -> council {proposals,votes}, technicalCommittee {proposals,votes},
                            authorityResets[], summary {totalGovernanceActions, lastActivity}
   All metric logic lives in src/governance.js (31 unit tests).
*/
import {
  computeGovernanceStats,
  governanceHealth,
} from "./src/governance.js";

const API = "https://mainnet.nightforge.jp";
const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const shortHash = (h, n = 10) => (h ? h.slice(0, n) + "…" : "–");
const shortKey = (k, n = 10) => (k ? k.slice(0, n) + "…" : "–");

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

function ageLabel(ts, nowSec) {
  if (ts == null) return "–";
  const days = (nowSec - ts) / 86400;
  if (days < 1) return `${Math.max(1, Math.round((nowSec - ts) / 3600))}h ago`;
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30.44)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
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
        `<li class="${c.pass ? "pass" : ""}"><span class="${c.pass ? "ok" : "no"}">${c.pass ? "✓" : "✗"}</span> ${c.label} <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${c.pts}/${c.max}</span></li>`
    )
    .join("");
}

function statusPill(s) {
  const label = s === "approved" ? "approved" : s === "rejected" ? "rejected" : "active";
  return `<span class="pill st-${s}">${label}</span>`;
}

function renderSummary(stats, nowSec) {
  $("total-actions").textContent = fmt(stats.totalActions);
  $("last-activity").textContent = stats.lastActivity ? new Date(stats.lastActivity * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "–";
  $("last-activity-age").textContent = stats.lastActivity ? ageLabel(stats.lastActivity, nowSec) : "";
  if (stats.latestAuthority) {
    $("auth-size").textContent = fmt(stats.latestAuthority.count);
    $("auth-rotations").textContent = `${stats.authorityTimeline.length} reset${stats.authorityTimeline.length === 1 ? "" : "s"} recorded`;
  } else {
    $("auth-size").textContent = "–";
    $("auth-rotations").textContent = "no resets recorded";
  }
  for (const c of stats.committees) {
    const id = c.key === "council" ? "council" : "tech";
    $(`${id}-count`).textContent = fmt(c.motionCount);
    const st = c.byStatus;
    $(`${id}-status`).textContent = `${st.approved}✓ ${st.rejected}✗ ${st.active}…`;
    $(`${id}-count-2`).textContent = `${c.motionCount} motion${c.motionCount === 1 ? "" : "s"} · ${st.approved} approved · ${st.rejected} rejected · ${st.active} active`;
  }
}

function tallyBar(ayes, anos, threshold) {
  const total = Math.max(ayes + anos, threshold, 1);
  const yesPct = Math.min(100, (ayes / total) * 100);
  const noPct = Math.min(100 - yesPct, (anos / total) * 100);
  return `<div class="tally-bar" title="yes ${ayes} / no ${anos} (threshold ${threshold})"><div class="yes" style="width:${yesPct}%"></div><div class="no" style="width:${noPct}%"></div></div>`;
}

function renderCommittee(el, c) {
  if (!c.motions.length) {
    el.innerHTML = `<p class="section-sub" style="margin:0">No motions recorded yet.</p>`;
    return;
  }
  el.innerHTML = c.motions
    .map((m) => {
      const meta = [];
      meta.push(`motion #${m.motionIndex != null ? m.motionIndex : "–"}`);
      meta.push(`block ${fmt(m.block)}`);
      if (m.members != null) meta.push(`authority of ${m.members}`);
      meta.push(`threshold ${m.threshold != null ? m.threshold : "–"}`);
      return `<div class="motion-row">
        <div class="motion-head">
          ${statusPill(m.status)}
          <span class="motion-hash" title="${m.motionHash}">${shortHash(m.motionHash)}</span>
          <span class="motion-meta">${meta.join(" · ")}</span>
        </div>
        <div class="tally-row">
          ${tallyBar(m.ayes, m.anos, m.threshold || 1)}
          <span class="tally-num"><span class="yes">${fmt(m.ayes)} yes</span> / <span class="no">${fmt(m.anos)} no</span></span>
          <span class="motion-meta">${fmt(m.voters)} voter${m.voters === 1 ? "" : "s"} · proposer ${shortKey(m.proposer)}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderResets(stats, nowSec) {
  const tl = stats.authorityTimeline;
  if (!tl.length) {
    $("resets-tbody").innerHTML = '<tr><td colspan="4" style="padding:14px;color:var(--muted)">No authority resets recorded.</td></tr>';
    return;
  }
  // most recent first
  const rows = [...tl].reverse().map((r, i) => ({ r, rank: tl.length - i }));
  $("resets-tbody").innerHTML = rows
    .map(({ r, rank }) => {
      const chips = r.members.map((m) => `<span class="member-chip" title="${m}">${shortKey(m, 8)}</span>`).join("");
      return `<tr>
        <td class="c-mono">#${rank}</td>
        <td class="c-mono">${fmt(r.block)}</td>
        <td>${chips}<div class="motion-meta" style="margin-top:4px">${r.count} member${r.count === 1 ? "" : "s"} · ${r.pubkeys.length} pubkey${r.pubkeys.length === 1 ? "" : "s"}</div></td>
        <td class="c-mono" style="color:var(--muted)">${ageLabel(r.timestamp, nowSec)}</td>
      </tr>`;
    })
    .join("");
}

async function refresh() {
  try {
    const api = await getJSON("/api/governance");
    const stats = computeGovernanceStats(api);
    const nowSec = Math.floor(Date.now() / 1000);
    const h = governanceHealth(stats, nowSec);

    renderGauge(h);
    renderSummary(stats, nowSec);
    renderCommittee($("council-motions"), stats.committees.find((c) => c.key === "council"));
    renderCommittee($("tech-motions"), stats.committees.find((c) => c.key === "technicalCommittee"));
    renderResets(stats, nowSec);

    setLive(true, `live · ${fmt(stats.totalActions)} governance actions`);
    return { ok: true, health: h.score };
  } catch (e) {
    console.error("Governance Watch refresh failed:", e);
    setLive(false);
    return { ok: false, error: String(e) };
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
