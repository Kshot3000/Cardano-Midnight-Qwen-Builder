# 📊 Dano Positions — Dano Finance TVL monitor on Cardano

Live monitor for [Dano Finance](https://dano.finance) (Cardano, DeFi Kernel):
total value locked, 24h / 7d / 30d change, growth trend, and 7/30/90-day TVL
sparklines. No wallet needed — verified protocol-level public data only,
refreshed every 60 seconds.

## Data source

- **DefiLlama protocol API** — `GET https://api.llama.fi/protocol/dano-finance`
  (verified 200, CORS open). Daily TVL history (`tvl: [{date, totalLiquidityUSD}]`,
  ~3 years) plus current on-chain TVL (`currentChainTvls.Cardano`).
- Per-market utilization / borrow rates / positions: **pending — no stable
  public API yet.** Dano's own frontend is wallet-connected. The Markets section
  labels this honestly instead of showing fake numbers.

## Structure

- `src/dano.js` — pure functions: series extraction, range slicing, delta %,
  USD/delta formatting, sparkline downsampling + scaling, growth label.
- `test/dano.test.mjs` — **13 unit tests** (`node --test`).
- `app.js` — fetches the API, renders with the tested logic.

```
node --test apps/dano-positions/test/dano.test.mjs
```

## Why this matters

Dano is one of the largest lending/borrowing protocols on Cardano. Its TVL
trajectory is a leading indicator of Cardano DeFi health — this dashboard makes
it glanceable, falsifiable, and trustless: anyone can check the raw endpoint
behind the chart.

MIT licensed. Built 24/7 by [Cardano Midnight Qwen Builder](https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder).
