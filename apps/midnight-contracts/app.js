// Midnight Contract Watch — UI logic.
// Fetches live NightForge mainnet data and renders the dashboard.
// Pure analytics live in src/analyze.js + src/address.js (unit-tested).
import {
  tallyActivity,
  concentration,
  interactionStats,
  deploymentTrend,
  dedupeDeployed,
  coverageCheck,
  addressSanity,
  toPct,
  DAY,
} from "./src/analyze.js";
import {
  decodeContractAddress,
  humanizeContractAddress,
  isValidContractAddress,
} from "./src/address.js";

const API_BASE = "https://mainnet.nightforge.jp/api";
const EXPLORER = "https://mainnet.nightforge.jp";

const nf = (path) => `${API_BASE}${path}`;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const fmt = new Intl.NumberFormat("en-US");
export function fmtNum(x) {
  return x == null ? "—" : fmt.format(x);
}
export function fmtPct(x, digits = 1) {
  if (x == null) return "—";
  const p = toPct(x, digits);
  return p == null ? "—" : `${p.toFixed(digits)}%`;
}
export function fmtDelta(x, digits = 1) {
  if (x == null) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(digits)}%`;
}
export function fmtBlock(x) {
  return x == null ? "—" : `#${fmtNum(x)}`;
}
export function fmtTs(x) {
  if (x == null) return "—";
  try {
    return new Date(x * 1000).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}
export function fmtAgeDays(x) {
  if (x == null) return "—";
  if (x < 1) return `${Math.max(0, Math.round(x * 24))}h`;
  return `${x.toFixed(1)}d`;
}
export function shortHash(h, head = 10, tail = 6) {
  if (typeof h !== "string" || h.length <= head + tail + 1) return h ?? "—";
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

// ---------- rendering ----------

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "href") n.setAttribute("href", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function statCard(label, value, sub, tone = "") {
  return el(
    "div",
    { class: `stat-card ${tone}`.trim() },
    el("div", { class: "stat-label" }, label),
    el("div", { class: "stat-value" }, value),
    sub ? el("div", { class: "stat-sub" }, sub) : null
  );
}

function barRow(label, value, pct, tone = "") {
  const p = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return el(
    "div",
    { class: "bar-row" },
    el("div", { class: "bar-top" }, el("span", {}, label), el("span", { class: "bar-val" }, value)),
    el(
      "div",
      { class: "bar-track" },
      el("div", { class: `bar-fill ${tone}`, style: `width:${p.toFixed(2)}%` })
    )
  );
}

function contractRow(i, c, nowSec) {
  const valid = isValidContractAddress(c.address);
  const dec = valid ? decodeContractAddress(c.address) : null;
  const hum = humanizeContractAddress(c.address);
  const ageDays = c.lastSeen != null ? Math.max(0, (nowSec - c.lastSeen) / DAY) : null;
  const cls =
    c.interactions === 0
      ? "act-dead"
      : ageDays == null
        ? "act-abandoned"
        : ageDays <= 7
          ? "act-active"
          : ageDays <= 90
            ? "act-dormant"
            : "act-abandoned";
  const clsLabel =
    c.interactions === 0 ? "never called" : ageDays == null ? "abandoned" : ageDays <= 7 ? "active" : ageDays <= 90 ? "dormant" : "abandoned";
  const addr = el(
    "a",
    {
      href: `${EXPLORER}/contract/${c.address}`,
      target: "_blank",
      rel: "noopener",
      class: "mono",
      title: c.address,
    },
    hum.short
  );
  const digest = dec ? el("span", { class: "digest-note" }, "digest " + shortHash(dec.digest, 8, 8)) : null;
  return el(
    "tr",
    { class: cls },
    el("td", { class: "rank" }, String(i + 1)),
    el("td", {}, addr, digest, valid ? null : el("span", { class: "badge-warn" }, "non-canonical")),
    el("td", { class: "num" }, fmtNum(c.interactions)),
    el("td", {}, fmtTs(c.firstSeen)),
    el("td", {}, fmtTs(c.lastSeen)),
    el("td", { class: "num" }, fmtAgeDays(ageDays)),
    el("td", { class: "num" }, fmtBlock(c.block)),
    el("td", {}, el("span", { class: `badge ${cls}` }, clsLabel)),
    el(
      "td",
      {},
      c.txHash
        ? el(
            "a",
            { href: `${EXPLORER}/tx/${c.txHash}`, target: "_blank", rel: "noopener", class: "mono" },
            shortHash(c.txHash)
          )
        : "—"
    )
  );
}

export function renderDashboard(root, data, nowSec) {
  root.innerHTML = "";
  const { overview, deployed } = data;

  // --- hero stats ---
  const totalContracts = overview.totalContracts;
  const totalCalls = overview.totalCalls;
  const rows = Array.isArray(overview.topContracts) ? overview.topContracts : [];
  const daily = Array.isArray(overview.deploymentsPerDay) ? overview.deploymentsPerDay : [];

  const t = tallyActivity(rows, nowSec);
  const c = concentration(rows, 10);
  const s = interactionStats(rows);
  const d = deploymentTrend(daily, 7);
  const ded = deployed ? dedupeDeployed(deployed.contracts) : null;
  const cov = coverageCheck(totalContracts, ded ? ded.unique : null);
  const sanity = addressSanity(rows);

  const hero = el("section", { class: "card" }, el("h2", {}, "Ecosystem pulse"));
  hero.append(
    el("div", { class: "stat-grid" },
      statCard("Contracts", fmtNum(totalContracts), "indexed on Midnight mainnet"),
      statCard("Total calls", fmtNum(totalCalls), "leaderboard interactions"),
      statCard("Active (7d)", fmtNum(t.active), "called in the last 7 days", "good"),
      statCard("Top-10 share", fmtPct(c.topNShare), "of all calls", "accent")
    )
  );
  root.append(hero);

  // --- activity mix ---
  const act = el("section", { class: "card" }, el("h2", {}, "Activity mix"), el("p", { class: "muted" }, `leaderboard of ${fmtNum(t.total)} contracts, at ${fmtTs(nowSec)}`));
  const actTotal = Math.max(1, t.total);
  act.append(
    el("div", { class: "bars" },
      barRow("Active ≤ 7d", fmtNum(t.active), (t.active / actTotal) * 100, "good"),
      barRow("Dormant 8–90d", fmtNum(t.dormant), (t.dormant / actTotal) * 100, "warn"),
      barRow("Abandoned > 90d", fmtNum(t.abandoned), (t.abandoned / actTotal) * 100, "bad"),
      barRow("Never called", fmtNum(t.neverCalled), (t.neverCalled / actTotal) * 100, "muted")
    )
  );
  root.append(act);

  // --- concentration + stats ---
  const conc = el("section", { class: "card" }, el("h2", {}, "Call concentration"));
  conc.append(
    el("div", { class: "bars" },
      barRow("Top 1", fmtPct(c.top1Share), toPct(c.top1Share), "accent"),
      barRow("Top 3", fmtPct(c.top3Share), toPct(c.top3Share), "accent"),
      barRow("Top 10", fmtPct(c.topNShare), toPct(c.topNShare), "accent")
    ),
    el("div", { class: "stat-grid three" },
      statCard("Total interactions", fmtNum(s.total), `${fmtNum(s.count)} contracts counted`),
      statCard("Average / contract", fmtNum(Math.round(s.average ?? 0)), `median n/a — mean of all rows`),
      statCard("Single largest", fmtNum(s.max), "one contract's total calls")
    )
  );
  root.append(conc);

  // --- deployment trend ---
  const dep = el("section", { class: "card" }, el("h2", {}, "Deployment trend"));
  const chart = el("div", { class: "spark" });
  if (daily.length) {
    const max = Math.max(1, ...daily.map((r) => Number(r.count) || 0));
    const ordered = [...daily].reverse(); // oldest -> newest
    for (const r of ordered) {
      const h = Math.max(2, ((Number(r.count) || 0) / max) * 100);
      const bar = el("div", { class: "spark-bar", style: `height:${h.toFixed(1)}%`, title: `${r.day}: ${r.count}` });
      chart.append(bar);
    }
  } else {
    chart.append(el("span", { class: "muted" }, "no daily series"));
  }
  dep.append(
    chart,
    el("div", { class: "stat-grid three" },
      statCard(`${d.windowDays}d deployments`, fmtNum(d.last), d.growthPct == null ? "no baseline" : `${fmtDelta(d.growthPct)} vs prior ${d.windowDays}d`, d.growthPct != null && d.growthPct >= 0 ? "good" : "warn"),
      statCard("Peak day", d.peakDay ?? "—", d.peakCount != null ? `${fmtNum(d.peakCount)} contracts` : ""),
      statCard(`${fmtNum(d.days)}-day total`, fmtNum(d.total), `avg ${fmtNum(Math.round(d.average ?? 0))}/day`)
    )
  );
  root.append(dep);

  // --- deployed-events cross-check ---
  const dedCard = el("section", { class: "card" }, el("h2", {}, "Deployed-events cross-check"));
  if (ded && ded.raw > 0) {
    dedCard.append(
      el("div", { class: "stat-grid four" },
        statCard("Events fetched", fmtNum(ded.raw), "newest page of deploy events"),
        statCard("Unique deploys", fmtNum(ded.unique), `${fmtNum(ded.duplicates)} duplicate events collapsed`),
        statCard("Span", fmtAgeDays(ded.spanDays), `block ${fmtBlock(ded.firstDeploy.block)} → ${fmtBlock(ded.lastDeploy.block)}`),
        statCard("Unique addresses", fmtNum(ded.uniqueAddresses), "in this sample")
      ),
      el("p", { class: "muted" }, `Leaderboard says ${fmtNum(cov.leaderboard)}; deploy events show ${fmtNum(cov.deployed)} unique in this newest page. ${cov.note}.`,
        el("br"),
        `Address sanity: ${fmtNum(sanity.valid)}/${fmtNum(sanity.total)} canonical Midnight contract addresses${sanity.invalid ? ` — ${fmtNum(sanity.invalid)} non-canonical flagged` : ""}.`
      )
    );
  } else {
    dedCard.append(el("p", { class: "muted" }, "deployed-events endpoint unavailable — cross-check pending."));
  }
  root.append(dedCard);

  // --- leaderboard ---
  const tb = el("section", { class: "card" }, el("h2", {}, "Top contracts by interactions"));
  const thead = el("thead", {}, el("tr", {},
    ...["#", "Contract", "Calls", "First seen", "Last seen", "Age", "Deploy blk", "State", "Deploy tx"].map((h) => el("th", {}, h))
  ));
  const tbody = el("tbody");
  for (let i = 0; i < Math.min(25, rows.length); i++) tbody.append(contractRow(i, rows[i], nowSec));
  tb.append(el("div", { class: "table-wrap" }, el("table", { class: "tbl" }, thead, tbody)));
  root.append(tb);
}

// ---------- boot ----------

function fail(root, err, partial) {
  root.innerHTML = "";
  const box = el("section", { class: "card" },
    el("h2", {}, "Live data unavailable"),
    el("p", {}, String((err && err.message) || err)),
    el("p", { class: "muted" }, "The NightForge explorer may be down or blocked. Retry when it recovers.")
  );
  if (partial) box.append(el("p", { class: "muted" }, "Partial data shown below where available."));
  root.append(box);
}

export async function boot() {
  const root = document.getElementById("app");
  const status = document.getElementById("status");
  if (!root) return;
  root.innerHTML = '<p class="muted">Loading live Midnight mainnet data…</p>';
  const nowSec = Math.floor(Date.now() / 1000);

  let overview = null;
  let deployed = null;
  let errors = [];

  try {
    overview = await fetchJson(nf("/analytics/contracts"));
  } catch (e) {
    errors.push(e);
  }
  try {
    const raw = await fetchJson(nf("/contracts/deployed"));
    deployed = { contracts: Array.isArray(raw?.contracts) ? raw.contracts : [] };
  } catch (e) {
    errors.push(e);
  }

  if (errors.length) {
    if (!overview && !deployed) {
      fail(root, errors[0]);
      status.textContent = "offline";
      return;
    }
    status.textContent = "partial — " + errors.map((e) => e.message).join("; ");
  } else {
    status.textContent = "live";
  }

  if (overview) {
    try {
      renderDashboard(root, { overview, deployed }, nowSec);
    } catch (e) {
      fail(root, e);
      status.textContent = "render error";
    }
  } else if (deployed) {
    fail(root, errors[0], true);
    const wrap = el("section", { class: "card" }, el("h2", {}, "Deployed events (partial)"));
    const ded = dedupeDeployed(deployed.contracts);
    wrap.append(el("p", {}, `${fmtNum(ded.unique)} unique deploys from ${fmtNum(ded.raw)} events, spanning ${fmtAgeDays(ded.spanDays)}.`));
    root.append(wrap);
  }

  const stamp = document.getElementById("updated");
  if (stamp) stamp.textContent = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
