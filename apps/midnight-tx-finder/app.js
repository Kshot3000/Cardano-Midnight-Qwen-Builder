import {
  API_BASE,
  parseQuery,
  blockView,
  formatTime,
  shortHash,
  formatAge,
  topBlocks,
} from "./src/midnight.js";

const $ = (id) => document.getElementById(id);

function kv(pairs) {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join("");
}

function renderBlock(el, b) {
  const v = blockView(b);
  if (!v) { el.innerHTML = '<p class="section-sub">no data</p>'; return; }
  el.innerHTML =
    kv([
      ["Height", v.height],
      ["Hash", `<a href="#" onclick="return false" title="${v.hash}">${shortHash(v.hash)}</a>`],
      ["Time", formatTime(v.timestamp)],
      ["Extrinsics", v.extrinsicsCount],
    ]) +
    `<p class="section-sub" style="margin-top:8px">Full hash: <code title="click to select" onclick="selectNode(this)">${v.hash}</code></p>`;
}

function renderFeed(el, blocks, nowSec) {
  const rows = topBlocks(blocks, 12).map((v) =>
    `<li>
      <span class="mono">#${v.height}</span>
      <span class="mono dim">${shortHash(v.hash)}</span>
      <span class="dim">${v.extrinsicsCount} ext</span>
      <span class="dim">${formatAge(v.timestamp, nowSec)}</span>
    </li>`
  ).join("");
  el.innerHTML = rows || '<li class="dim">loading…</li>';
}

function renderOverview(el, o) {
  if (!o || typeof o !== "object") return;
  const pairs = [
    ["Blocks", o.blocks],
    ["Extrinsics", o.extrinsics],
    ["Midnight txs", o.midnightTxs],
    ["Bridge ops", o.bridgeOps],
    ["Avg block time (s)", o.avgBlockTime],
    ["TPS", o.tps],
    ["Shielded ratio", o.shieldedRatio],
    ["Contract deploys", o.contractDeploys],
    ["Contract calls", o.contractCalls],
    ["Committee size", o.committeeSize],
  ];
  el.innerHTML = pairs
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `<div class="stat"><div class="n">${typeof v === "number" && v < 10 ? v : (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v.toLocaleString())}</div><div class="k">${k}</div></div>`)
    .join("");
}

async function loadFeed() {
  try {
    const res = await fetch(API_BASE + "/api/blocks?limit=12", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blocks = await res.json();
    const now = Date.now() / 1000;
    renderFeed($("feed"), blocks, now);
    window.__recentBlocks = blocks;
    $("status").textContent = "live · " + new Date().toLocaleTimeString();
    $("status").className = "status ok";
  } catch (e) {
    $("status").textContent = "error · " + e.message;
    $("status").className = "status bad";
  }
}

async function loadOverview() {
  try {
    const res = await fetch(API_BASE + "/api/analytics/overview", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    renderOverview($("overview"), await res.json());
  } catch (e) {
    $("overview").innerHTML = `<p class="section-sub">overview unavailable: ${e.message}</p>`;
  }
}

async function lookup() {
  const out = $("lookup-out");
  const q = $("q").value;
  const parsed = parseQuery(q);
  if (!parsed) {
    out.innerHTML = '<p class="section-sub">Enter a block height (number) or a 0x hash. Tx-lookup by hash is <b>pending — not in the public indexer yet</b>; block heights search the latest blocks window.</p>';
    return;
  }
  if (parsed.kind === "hash") {
    out.innerHTML = '<p class="section-sub">Hash lookup is <b>pending — not in the public indexer yet</b> (honest disclosure over fake numbers). You can search by block height now.</p>';
    return;
  }
  try {
    out.innerHTML = '<p class="section-sub">searching latest blocks…</p>';
    const res = await fetch(API_BASE + "/api/blocks?limit=100", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blocks = await res.json();
    const hit = blocks.find((b) => b && b.height === parsed.value);
    if (hit) {
      renderBlock(out, hit);
    } else {
      const newest = blocks[0] && blocks[0].height;
      const oldest = blocks[blocks.length - 1] && blocks[blocks.length - 1].height;
      out.innerHTML = `<p class="section-sub">Block #${parsed.value} not found in the latest window (#${oldest}–#${newest}). The public indexer only serves recent blocks — older blocks are <b>pending</b>.</p>`;
    }
  } catch (e) {
    out.innerHTML = '<p class="section-sub">lookup failed: ' + e.message + "</p>";
  }
}

function selectNode(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

$("lookup-btn").addEventListener("click", lookup);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });

loadFeed();
loadOverview();
setInterval(loadFeed, 60000);
setInterval(loadOverview, 300000);
