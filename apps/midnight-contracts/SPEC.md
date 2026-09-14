# 📜 Contract Watch — Midnight smart-contract ecosystem

A live, keyless dashboard for the **Midnight smart-contract ecosystem**:
a census of every deployed contract, which ones are still being called, how
concentrated the call volume is, and the deployment pace over the last 30
days. Every contract address is decoded with a byte-exact codec for
Midnight's `midnight:contract-address[v2]:` format.

No fake data, no placeholder APIs. If the explorer stops exposing a field,
the page shows `—` rather than inventing a number.

## What it shows

| Item | Source | Status |
|------|--------|--------|
| Contract census | `GET /api/analytics/contracts` → `totalContracts` | 🟢 live |
| Total call volume | `totalCalls` | 🟢 live |
| Top-contracts leaderboard (address, calls, first/last seen, deploy block, deploy tx) | `topContracts[]` | 🟢 live |
| Activity mix (active / dormant / abandoned / never called) | derived from `topContracts[]` + `lastSeen` | 🟢 derived |
| Call concentration (top-1 / top-3 / top-10 share) | derived from `topContracts[]` + `interactions` | 🟢 derived |
| Interaction stats (total / average / largest) | derived | 🟢 derived |
| Deployment trend (30-day sparkline, 7d-vs-7d growth, peak day) | `deploymentsPerDay[]` | 🟢 live |
| Deployed-events cross-check (unique deploys, duplicates, span, address sanity) | `GET /api/contracts/deployed` → `contracts[]` | 🟢 live |

Activity states: **active** = called within 7 days, **dormant** = 8–90 days,
**abandoned** = over 90 days, **never called** = zero interactions.

## The contract-address codec

Every Midnight contract address observed on mainnet is exactly 126 hex
characters with this layout:

```
0x ┬ 60-hex ASCII tag "midnight:contract-address[v2]:" ┬ 64-hex 32-byte digest
   (30 bytes)                                          (the on-chain identity)
```

`address.js` encodes/decodes/validates this format and produces a human
`0x<digest-head>…<digest-tail>` form. All 150 live leaderboard addresses
captured on 2026-09-14 round-trip through the codec byte-for-byte (covered
by tests).

## Data

- Public [NightForge explorer API](https://nightforge.jp/api/docs)
  (`mainnet.nightforge.jp`), CORS-enabled, no auth, no key.
- `/api/analytics/contracts` returns `totalContracts`, `totalCalls`,
  `topContracts` (150 rows: `{address, txHash, interactions, firstSeen,
  lastSeen, block}`, newest-activity first) and `deploymentsPerDay`
  (30 rows of `{day, count}`, newest first).
- `/api/contracts/deployed` returns `{total, contracts[]}` — a newest-first
  stream of deploy events where each contract appears multiple times
  (once per observed event), so the dashboard dedupes by `(txHash, block)`.

## Modules

| File | Purpose | Tested? |
|------|---------|---------|
| `src/address.js` | Pure codec: tag constant, hex helpers, encode/decode/validate/humanize | ✅ 17 tests |
| `src/analyze.js` | Pure analytics: activity classification + tally, concentration, interaction stats, deployment trend, deploy-event dedupe, coverage cross-check, address sanity | ✅ 27 tests |
| `app.js` | ES-module app: fetch → derive → render, graceful partial/offline states | — |
| `test/address.test.mjs` | Codec unit tests incl. round-trips over 10 real live addresses | — |
| `test/analyze.test.mjs` | Analytics unit tests incl. exact tallies over all 150 real leaderboard rows | — |
| `test/fixture.mjs` | Real captured mainnet data (2026-09-14) used as test vectors | — |

All functions in `src/` are pure (no network, no `Date.now` inside) so the
whole dashboard logic is testable offline.

## Run the tests

```
node --test apps/midnight-contracts/test/address.test.mjs
node --test apps/midnight-contracts/test/analyze.test.mjs
```
