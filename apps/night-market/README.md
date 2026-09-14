# 🌙 NIGHT Market Tracker

Live market dashboard for the **Midnight NIGHT** token — the token that settles the
Midnight network, minted as a native Cardano asset.

Built by the [Cardano Midnight Qwen Builder](https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder) agent.

## What it shows

| Section | Data |
|---|---|
| **Market health score** | Transparent 0–100 rubric (7 checks, +25/+20/+10/+15/+10/+10/+10) |
| **Market snapshot** | Price USD, 24h Δ, 24h low→high range with position dot, market cap, FDV, 24h volume + turnover %, CoinGecko rank, ATH, 7d/14d/30d changes |
| **7-day chart** | 72-bar bucket-max sparkline (hover = exact value/time), week open/last/high/low, 7d change, 7d volatility (σ of 1-step returns) |
| **Supply** | Circulating (bar against the 24B max), total, max supply |
| **Where NIGHT lives** | Cardano native-asset policy id **cross-checked byte-for-byte against the known NIGHT policy** `0691b2fe…af1fa` (the same policy the Glacier Drop thaw math uses), BSC listing, docs / X / CoinGecko links |

Missing API fields render as `–` — the page never invents a number.

## Data source

Public **CoinGecko** API, no key required:

- `GET https://api.coingecko.com/api/v3/coins/midnight-3`
- `GET https://api.coingecko.com/api/v3/coins/midnight-3/market_chart?vs_currency=usd&days=7`

Auto-refresh every 2 minutes (free-tier rate-limit friendly).

## Architecture

```
apps/night-market/
├── index.html            # page (donate-box + common.js nav/footer branding)
├── app.js                # fetch + render only — no logic
├── src/
│   └── nightmarket.js    # pure, zero-dep metric functions
└── test/
    └── market.test.mjs   # 26 unit tests (node --test)
```

Every function in `src/nightmarket.js` is pure (no network, no `Date.now` inside)
so the whole dashboard logic is unit-testable:

- `pickNum` — multi-currency / plain-number safe extraction (null, never NaN)
- `extractToken` / `extractMarket` — CoinGecko payload → typed view
- `cleanSeries` — sort/dedupe/junk-filter for `[[ms, v]]` **or** `[{t, v}]`
- `marketStats` — 7d first/last/high/low/avg/change
- `downsample` / `sparkHeights` — bucket-max sparkline geometry
- `volatility` — σ of 1-step percentage returns
- `marketHealth` — the 7-check rubric (exactly 100 points, no more)
- formatters — `pctText`, `usdText` (6dp sub-cent, compact big), `nightText`, `agoLabel`

## Tests

```bash
node --test apps/night-market/test/market.test.mjs
```

## Cross-checks

- `NIGHT.policyId` in `src/nightmarket.js` **must** equal CoinGecko's
  `platforms.cardano` for `midnight-3` — verified live 2026-09-14
  (`0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa`).
- Same policy id as `apps/glacier-drop/src/glacier.js` (`NIGHT_TOKEN.policyId`).
- 6 decimals, 24B public max supply — consistent with the Glacier Drop
  on-chain mint total (24B NIGHT).
