// Midnight Pulse — pure view-model builders for the live Midnight mainnet
// dashboard (unit-tested in test/pulse.test.mjs). app.js renders these
// strings with textContent only: NightForge API fields (event section /
// method names, block heights, hashes) are third-party data and must never
// be interpolated into innerHTML, where a stray "<" or quote in the payload
// would become live markup / break out of an attribute.
//
// Data: NightForge public explorer API (https://mainnet.nightforge.jp/api)
//   /analytics/overview -> { blocks, avgBlockTime, tps, shieldedRatio,
//                            midnightTxs, bridgeOps, committeeSize,
//                            contractDeploys, contractCalls, networkAgeDays,
//                            eventBreakdown: [{ section, method, count }] }
//   /blocks?limit=N     -> [{ height, hash, timestamp (unix s), extrinsics_count }]

export const PLACEHOLDER = "—";

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Compact number formatting; non-finite / missing values render as the
// placeholder, never "NaN".
export function fmt(n) {
  if (n === null || n === undefined) return PLACEHOLDER;
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return PLACEHOLDER;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n * 100) / 100);
  }
  return String(n);
}

// Overview object -> the 10 stat tiles, in display order.
export function statsView(o) {
  const src = o && typeof o === "object" ? o : {};
  return [
    { label: "Blocks", value: fmt(src.blocks) },
    { label: "Avg block time", value: src.avgBlockTime != null ? String(src.avgBlockTime) + "s" : PLACEHOLDER },
    { label: "TPS (avg)", value: isNum(src.tps) ? src.tps.toFixed(3) : PLACEHOLDER },
    { label: "Shielded ratio", value: isNum(src.shieldedRatio) ? (src.shieldedRatio * 100).toFixed(1) + "%" : PLACEHOLDER },
    { label: "Midnight txs", value: fmt(src.midnightTxs) },
    { label: "Bridge ops", value: fmt(src.bridgeOps) },
    { label: "Committee size", value: src.committeeSize != null ? String(src.committeeSize) : PLACEHOLDER },
    { label: "Contract deploys", value: fmt(src.contractDeploys) },
    { label: "Contract calls", value: fmt(src.contractCalls) },
    { label: "Network age", value: src.networkAgeDays != null ? String(src.networkAgeDays) + " days" : PLACEHOLDER },
  ];
}

// Event breakdown -> bar rows. `name` is a plain string: the caller assigns
// it via textContent / setAttribute, never innerHTML. Bar width is clamped
// to 2–100% so the smallest event still shows a sliver.
export function eventRows(events, limit = 12) {
  if (!Array.isArray(events)) return [];
  const top = events.slice(0, limit);
  const max = top.reduce((m, e) => Math.max(m, isNum(e && e.count) ? e.count : 0), 1);
  return top.map((e) => {
    const ev = e && typeof e === "object" ? e : {};
    const count = isNum(ev.count) ? ev.count : 0;
    return {
      name: String(ev.section != null ? ev.section : "?") + "." + String(ev.method != null ? ev.method : "?"),
      countLabel: fmt(ev.count),
      pct: Math.max(2, Math.round((count / max) * 100)),
    };
  });
}

// Latest blocks -> rows of plain strings (hash pre-truncated for display).
export function blockRows(blocks, limit = 8) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, limit).map((b) => {
    const blk = b && typeof b === "object" ? b : {};
    return {
      height: blk.height != null ? "#" + String(blk.height) : "#" + PLACEHOLDER,
      hash: typeof blk.hash === "string" && blk.hash ? blk.hash.slice(0, 22) + "…" : PLACEHOLDER,
      time: isNum(blk.timestamp) ? new Date(blk.timestamp * 1000).toLocaleString() : PLACEHOLDER,
      ext: blk.extrinsics_count != null ? String(blk.extrinsics_count) + " ext" : "",
    };
  });
}
