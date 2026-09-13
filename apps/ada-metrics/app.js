/* Ada Metrics — live Cardano dashboard.
   Data sources (both public, CORS-enabled, no auth):
     CoinGecko:  GET /api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true&include_market_cap=true
     Blockchair: GET /cardano/stats  -> blocks, transactions, blocks_24h, transactions_24h, ...
   Refresh interval: 60s. Each source degrades independently. */
(function () {
  "use strict";

  var REFRESH_MS = 60000;

  function fmt(n, dec) {
    if (n === null || n === undefined) return "—";
    if (typeof n === "number") {
      if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      if (n < 1) return n.toFixed(dec != null ? dec : 4);
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

  function renderPrice(d) {
    var el = document.getElementById("ada-price");
    var ch = document.getElementById("ada-change");
    var mc = document.getElementById("ada-mcap");
    el.textContent = "$" + (d.usd != null ? d.usd.toFixed(4) : "—");
    if (d.usd_24h_change != null) {
      var up = d.usd_24h_change >= 0;
      ch.textContent = (up ? "▲ +" : "▼ ") + d.usd_24h_change.toFixed(2) + "% (24h)";
      ch.className = "delta " + (up ? "up" : "down");
    }
    mc.textContent = d.usd_market_cap != null ? "market cap " + fmt(d.usd_market_cap) + " USD" : "";
  }

  function renderStats(s) {
    var items = [
      { label: "Block height", value: fmt(s.blocks) },
      { label: "Total transactions", value: fmt(s.transactions) },
      { label: "Blocks (24h)", value: fmt(s.blocks_24h) },
      { label: "Transactions (24h)", value: fmt(s.transactions_24h) },
      { label: "ADA in circulation", value: fmt(s.circulation / 1e6) },
      { label: "Chain size", value: s.blockchain_size != null ? fmt(s.blockchain_size / 1e9) + " GB" : "—" },
      { label: "Current epoch", value: s.best_block_epoch != null ? "#" + s.best_block_epoch : "—" },
      { label: "Latest block time", value: s.best_block_time || "—" }
    ];
    var el = document.getElementById("stats");
    el.innerHTML = items.map(function (it) {
      return '<div class="stat"><div class="label">' + it.label + '</div>' +
             '<div class="value">' + it.value + '</div></div>';
    }).join("");
  }

  function load() {
    setPill("stale", "refreshing…");
    var okCount = 0;
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true&include_market_cap=true")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.cardano) { renderPrice(j.cardano); okCount++; } })
      .catch(function () {});
    fetch("https://api.blockchair.com/cardano/stats")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.data) { renderStats(j.data); okCount++; } })
      .catch(function () {});
    setTimeout(function () {
      setPill(okCount ? "live" : "stale", okCount ? "live · " + new Date().toLocaleTimeString() : "APIs unreachable — retrying in 60s");
    }, 1500);
  }

  load();
  setInterval(load, REFRESH_MS);
})();
