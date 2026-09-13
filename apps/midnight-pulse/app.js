/* Midnight Pulse — live Midnight mainnet dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
   Endpoints used:
     GET /api/health                 -> service status
     GET /api/analytics/overview     -> blocks, tps, shielded ratio, events...
     GET /api/blocks?limit=N         -> latest blocks
   Refresh interval: 60s. All failures degrade gracefully. */
(function () {
  "use strict";

  var API = "https://mainnet.nightforge.jp/api";
  var REFRESH_MS = 60000;

  function fmt(n) {
    if (n === null || n === undefined) return "—";
    if (typeof n === "number") {
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(Math.round(n * 100) / 100);
    }
    return String(n);
  }

  function setPill(state, text) {
    var dot = document.getElementById("live-dot");
    var txt = document.getElementById("live-text");
    if (dot) dot.className = "dot" + (state === "live" ? "" : " stale");
    if (txt) txt.textContent = text;
  }

  function renderStats(o) {
    var items = [
      { label: "Blocks", value: fmt(o.blocks) },
      { label: "Avg block time", value: o.avgBlockTime != null ? o.avgBlockTime + "s" : "—" },
      { label: "TPS (avg)", value: o.tps != null ? o.tps.toFixed(3) : "—" },
      { label: "Shielded ratio", value: o.shieldedRatio != null ? (o.shieldedRatio * 100).toFixed(1) + "%" : "—" },
      { label: "Midnight txs", value: fmt(o.midnightTxs) },
      { label: "Bridge ops", value: fmt(o.bridgeOps) },
      { label: "Committee size", value: o.committeeSize != null ? String(o.committeeSize) : "—" },
      { label: "Contract deploys", value: fmt(o.contractDeploys) },
      { label: "Contract calls", value: fmt(o.contractCalls) },
      { label: "Network age", value: o.networkAgeDays != null ? o.networkAgeDays + " days" : "—" }
    ];
    var el = document.getElementById("stats");
    el.innerHTML = items.map(function (it) {
      return '<div class="stat"><div class="label">' + it.label + '</div>' +
             '<div class="value">' + it.value + '</div></div>';
    }).join("");
  }

  function renderEvents(events) {
    var el = document.getElementById("events");
    if (!events || !events.length) { el.innerHTML = '<div class="section-sub">no data</div>'; return; }
    var top = events.slice(0, 12);
    var max = top.reduce(function (m, e) { return Math.max(m, e.count || 0); }, 1);
    el.innerHTML = top.map(function (e) {
      var pct = Math.max(2, Math.round(((e.count || 0) / max) * 100));
      var name = (e.section || "?") + "." + (e.method || "?");
      return '<div class="bar-row"><div class="name" title="' + name + '">' + name +
             '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
             '<div class="num">' + fmt(e.count) + '</div></div>';
    }).join("");
  }

  function renderBlocks(blocks) {
    var el = document.getElementById("blocks");
    if (!blocks || !blocks.length) { el.innerHTML = '<div class="section-sub">no blocks yet</div>'; return; }
    el.innerHTML = blocks.slice(0, 8).map(function (b) {
      var t = b.timestamp ? new Date(b.timestamp * 1000).toLocaleString() : "—";
      var h = b.hash ? b.hash.slice(0, 22) + "…" : "—";
      return '<div class="block-row"><span class="h">#' + b.height +
             '</span><span class="hash">' + h +
             '</span><span class="time">' + t +
             '</span><span class="ext">' + (b.extrinsics_count != null ? b.extrinsics_count + " ext" : "") +
             '</span></div>';
    }).join("");
  }

  function load() {
    setPill("stale", "refreshing…");
    Promise.all([
      fetch(API + "/analytics/overview").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(API + "/blocks?limit=8").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(API + "/health").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var overview = res[0], blocks = res[1], health = res[2];
      if (overview) {
        renderStats(overview);
        renderEvents(overview.eventBreakdown);
        var age = health && health.network ? health.network : (overview.network || "Midnight Mainnet");
        setPill("live", "live · " + age + " · " + new Date().toLocaleTimeString());
      } else {
        setPill("stale", "API unreachable — retrying in 60s");
      }
      if (blocks) renderBlocks(blocks);
    });
  }

  load();
  setInterval(load, REFRESH_MS);
})();
