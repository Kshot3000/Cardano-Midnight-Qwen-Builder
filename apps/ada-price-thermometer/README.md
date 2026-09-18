# 🌡 ADA Price Thermometer — multi-source ADA/USD agreement

Three independent, keyless sources quote ADA/USD — a **DEX aggregator
(Minswap)** and two **market aggregators (CoinGecko, DefiLlama)** — and the
app fuses them into:

- a **consensus price** (median of the live quotes),
- an **agreement score (0–100)** — how tightly the sources agree,
- a **source-spread readout** (`(max−min) ÷ median × 100`),
- a **24h trend** — warming / holding / cooling / chilling, from the median
  24h change,
- a per-source table with each quote, its 24h change, and its **deviation
  from the consensus median**.

No wallet needed — public keyless APIs only, refreshed every 60 seconds.
Built 24/7 by Cardano Midnight Qwen Builder.

## Data sources (all keyless, verified 2026-09-18)

| Source | Endpoint | 24h |
|--------|----------|-----|
| Minswap DEX aggregator | `GET https://agg-api.minswap.org/aggregator/ada-price?currency=usd` | yes (`change_24h`) |
| CoinGecko market | `GET https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true` | yes (`usd_24h_change`) |
| DefiLlama market | `GET https://coins.llama.fi/prices/current/coingecko:cardano` | no |

### SundaeSwap — deliberately not wired as a spot price

Sundae's public GraphQL (`api.sundae.fi/graphql`, per the SDK's
`QueryProviderSundaeSwap`) does expose the ADA/USDC pair
(`byPair(ada.lovelace, 25c5de5f…43)`), but its `current.quantityA/B` are
**CPP-AMM range-liquidity quantities, not constant-product AMM reserves**. A
naive `x·y/z` cross-price is off by ~100× (measured: ~20 vs the true ~0.22),
so rather than invent a wrong "Sundae price", this app does **not** display a
Sundae spot quote. The pair is documented here so a later build can wire the
correct CPP-AMM price oracle (or the SDK's own pricing path) instead of
guessing.

## Structure

- `src/thermometer.js` — pure functions: per-source normalizers (never throw),
  `buildSources`, median, `consensus` (median/min/max/spreadPct),
  `agreementScore`/`agreementLabel`, `trendFromChange`, `deviationPct`,
  adaptive USD/pct formatters, gauge fill.
- `test/thermometer.test.mjs` — **26 unit tests** (`node --test`).
- `app.js` — fetches the three endpoints (Promise.allSettled, a failed source
  is shown as failed, never faked), renders with the tested logic.

```
node --test apps/ada-price-thermometer/test/thermometer.test.mjs
```

## Score formula

`base = 100 − min(spreadPct, 2.5) × 40`; `score = round(base × n/3)`.
So: 3 sources agreeing to 0.005% → 100; 2 sources agreeing perfectly → 67;
a 2.0% band across 3 sources → 20. With fewer than 2 live sources the score
is **Indeterminate** (null) — it is never faked.
