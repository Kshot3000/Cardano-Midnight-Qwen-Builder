// Ada Metrics — pure view-model builders for the live Cardano dashboard
// (unit-tested in test/metrics.test.mjs). app.js renders these strings with
// textContent only, so API data can never become markup.
//
// Data sources:
//   CoinGecko  /api/v3/simple/price -> { cardano: { usd, usd_24h_change, usd_market_cap } }
//   Blockchair /cardano/stats       -> { data: { blocks, transactions, blocks_24h,
//                                        transactions_24h, circulation (lovelace),
//                                        blockchain_size (bytes), best_block_epoch,
//                                        best_block_time } }

export const PLACEHOLDER = "—";

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Compact number formatting. Anything that is not a finite number renders
// as the placeholder — never "NaN" or "Infinity" (the old inline version
// printed the literal string "NaN" for a missing circulation figure).
export function fmt(n, dec) {
  if (n === null || n === undefined) return PLACEHOLDER;
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return PLACEHOLDER;
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    if (n < 1) return n.toFixed(dec != null ? dec : 4);
    return String(Math.round(n * 100) / 100);
  }
  return String(n);
}

// CoinGecko cardano object -> hero price view-model.
// change is null when the API omitted the 24h figure (render nothing then).
export function priceView(d) {
  const src = d && typeof d === "object" ? d : {};
  const view = {
    price: isNum(src.usd) ? "$" + src.usd.toFixed(4) : "$" + PLACEHOLDER,
    change: null,
    mcap: isNum(src.usd_market_cap) ? "market cap " + fmt(src.usd_market_cap) + " USD" : "",
  };
  if (isNum(src.usd_24h_change)) {
    const up = src.usd_24h_change >= 0;
    view.change = {
      text: (up ? "▲ +" : "▼ ") + src.usd_24h_change.toFixed(2) + "% (24h)",
      cls: "delta " + (up ? "up" : "down"),
    };
  }
  return view;
}

// Blockchair stats object -> the 8 stat tiles, in display order.
export function statsView(s) {
  const src = s && typeof s === "object" ? s : {};
  return [
    { label: "Block height", value: fmt(src.blocks) },
    { label: "Total transactions", value: fmt(src.transactions) },
    { label: "Blocks (24h)", value: fmt(src.blocks_24h) },
    { label: "Transactions (24h)", value: fmt(src.transactions_24h) },
    // Blockchair reports circulation in lovelace; /1e6 converts to ADA.
    { label: "ADA in circulation", value: isNum(src.circulation) ? fmt(src.circulation / 1e6) : PLACEHOLDER },
    { label: "Chain size", value: isNum(src.blockchain_size) ? fmt(src.blockchain_size / 1e9) + " GB" : PLACEHOLDER },
    { label: "Current epoch", value: src.best_block_epoch != null ? "#" + src.best_block_epoch : PLACEHOLDER },
    { label: "Latest block time", value: src.best_block_time ? String(src.best_block_time) : PLACEHOLDER },
  ];
}
