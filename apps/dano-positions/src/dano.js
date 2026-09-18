// dano.js — pure logic for the Dano Finance TVL monitor.
// No DOM, no fetch: everything here is testable with node --test.

export const API_URL = "https://api.llama.fi/protocol/dano-finance";

// Extract a clean [{date, tvl}] series from the DefiLlama protocol payload.
export function tvlSeries(data) {
  if (!data || !Array.isArray(data.tvl)) return [];
  return data.tvl
    .filter((p) => p && typeof p.date === "number" && typeof p.totalLiquidityUSD === "number")
    .map((p) => ({ date: p.date, tvl: p.totalLiquidityUSD }));
}

// Slice the last `days` days of a series (inclusive of today's point).
export function rangeSeries(series, days, now = Date.now()) {
  if (!Array.isArray(series) || days <= 0) return [];
  const cutoff = now - days * 86400000;
  return series.filter((p) => p.date >= cutoff);
}

// Percent change of TVL over the last `days` days. null when it cannot be computed.
export function tvlDeltaPct(series, days, now = Date.now()) {
  const ranged = rangeSeries(series, days, now);
  if (ranged.length < 2) return null;
  const from = ranged[0].tvl;
  const to = ranged[ranged.length - 1].tvl;
  if (!from) return null;
  return ((to - from) / from) * 100;
}

// Most recent TVL from the live chain map, falling back to the series tail.
export function latestTvl(data, series) {
  const cur = data && data.currentChainTvls;
  if (cur && typeof cur === "object") {
    const vals = Object.values(cur).filter((v) => typeof v === "number");
    if (vals.length) return vals.reduce((a, b) => a + b, 0);
  }
  if (Array.isArray(series) && series.length) return series[series.length - 1].tvl;
  return null;
}

// Average TVL over a window of `days`. null when the window is empty.
export function avgTvl(series, days, now = Date.now()) {
  const ranged = rangeSeries(series, days, now);
  if (!ranged.length) return null;
  return ranged.reduce((sum, p) => sum + p.tvl, 0) / ranged.length;
}

// Format a USD value compactly: $6.44M, $980K, $12.
export function formatUsd(n) {
  if (typeof n !== "number" || !isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n.toFixed(0);
}

// Format a signed percent: +12.4% / -3.1% / ±. null → "–"
export function formatDelta(pct) {
  if (typeof pct !== "number" || !isFinite(pct)) return "–";
  const s = pct > 0 ? "+" : "";
  return s + pct.toFixed(1) + "%";
}

// Downsample a series to at most `n` points for a sparkline (keep first & last).
export function downsample(series, n) {
  if (!Array.isArray(series) || n <= 0) return [];
  if (series.length <= n) return series.slice();
  const step = (series.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(series[Math.round(i * step)]);
  return out;
}

// Scale a sparkline series to [minPx, maxPx] bar heights.
export function sparkHeights(series, minPx = 4, maxPx = 88) {
  if (!Array.isArray(series) || !series.length) return [];
  const vals = series.map((p) => p.tvl);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return vals.map(() => (minPx + maxPx) / 2);
  return vals.map((v) => minPx + ((v - lo) / (hi - lo)) * (maxPx - minPx));
}

// A simple health-ish label from 7d change: growing / flat / shrinking.
export function growthLabel(deltaPct) {
  if (typeof deltaPct !== "number" || !isFinite(deltaPct)) return "unknown";
  if (deltaPct > 2) return "growing";
  if (deltaPct < -2) return "shrinking";
  return "flat";
}
