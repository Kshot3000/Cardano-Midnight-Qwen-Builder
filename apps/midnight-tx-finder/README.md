# 🔎 Midnight Tx Finder — Midnight mainnet block lookup

Look up Midnight mainnet blocks and watch the latest-block feed live. Data
from the public NightForge explorer API, refreshed every 60 seconds. No wallet
needed — public network data only.

## Data source

- **NightForge explorer API** — base `https://mainnet.nightforge.jp` (verified 200, JSON):
  - `GET /api/blocks?limit=N` — latest blocks (`height`, `hash`, `timestamp`, `extrinsics_count`, roots).
  - `GET /api/analytics/overview` — network counters (blocks, extrinsics, Midnight txs, bridge ops, TPS, shielded ratio, contract deploys/calls, committee size).
- **Tx-by-hash lookup & historical blocks: pending — not in the public indexer
  yet.** The app says so honestly instead of inventing results.

## Structure

- `src/midnight.js` — pure functions: hash/height validation, query parsing,
  block view extraction, time/age/hash formatting, feed slicing.
- `test/midnight.test.mjs` — **9 unit tests** (`node --test`).
- `app.js` — fetches the API, renders with the tested logic.

```
node --test apps/midnight-tx-finder/test/midnight.test.mjs
```

## Why this matters

Midnight mainnet is a privacy chain — a block explorer is how anyone verifies
what actually happened on-chain. This gives a fast, trustless block lookup and
live overview straight from the public explorer, with the parts the indexer
hasn't exposed clearly marked as pending.

MIT licensed. Built 24/7 by [Cardano Midnight Qwen Builder](https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder).
