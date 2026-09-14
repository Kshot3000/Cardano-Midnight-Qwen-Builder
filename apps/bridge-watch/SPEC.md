# 🌉 Bridge Watch — Cardano ↔ Midnight bridge health

A live, keyless dashboard for the **Cardano ↔ Midnight bridge** — the
settlement seam between the two chains. Every bridge operation is a public
extrinsic on Midnight that confirms a Cardano block (or the assets/proofs
inside it), so the bridge's activity is fully auditable without exposing any
private data.

No fake data, no placeholder APIs. If the explorer stops exposing a field, the
page shows `–` rather than inventing a number.

## What it shows

| Item | Source | Status |
|------|--------|--------|
| Lifetime bridge ops | `GET /api/analytics/bridge` → `totalBridgeOps` | 🟢 live |
| Ops in the last 24h | `last24h` | 🟢 live |
| Hourly bridge ops (24h sparkline) | `trend[]` (~24 hourly buckets) | 🟢 live |
| 12h-vs-12h trend growth | derived from `trend[]` | 🟢 derived |
| Ops per unique Cardano block | `recentBridgeOps[]` → parsed `args_summary` | 🟢 derived |
| Cardano epoch + slot context | `GET /api/analytics/overview` → `epoch` | 🟢 live |
| Recent bridge ops table (hash, blocks, age) | `recentBridgeOps[]` | 🟢 live |
| Bridge health score (0–100) | `bridgeHealth` rubric over the above | 🟢 derived |

## The health score (transparent rubric, 0–100)

The same "boring, standardized dashboard" promise Nightwatch makes, applied to
the bridge:

| Check | Points |
|-------|--------|
| Steady flow — avg ≥ 50 bridge ops/hour | 30 |
| Sustained volume — ≥ 1,000 ops in the trailing 24h | 30 |
| Stable trend — 12h-vs-12h growth within ±25% | 25 |
| Fresh observations — recent bridge ops are being confirmed | 15 |

≥80 healthy · ≥50 degraded · ≥25 watch · else critical.

## Data

- Public [NightForge explorer API](https://nightforge.jp/api/docs)
  (`mainnet.nightforge.jp`), CORS-enabled, no auth, no key.
- `/api/analytics/bridge` returns `totalBridgeOps`, `last24h`, `trend`
  (newest-first hourly buckets with `{hour, count}`), and
  `recentBridgeOps` (each `{hash, block_height, timestamp, args_summary}` where
  `args_summary` looks like
  `"Cardano block #13937696 (0xa4d191fd95859e...)"`).
- `/api/analytics/overview` returns the Midnight node's view of the Cardano
  mainchain (`epoch.mainchain_epoch`, `epoch.mainchain_slot`).

The Cardano block number in each recent op is parsed out of `args_summary` with
`/Cardano block #(\d+)/`. One Cardano block can map to several bridge ops — the
**ops / unique Cardano block** ratio makes that explicit instead of counting
ops as if each were a distinct block.

## Modules

| File | Purpose | Tested? |
|------|---------|---------|
| `src/bridge.js` | Pure metric functions: trend sort/summarize, growth, Cardano-block parse, recent-op parsing, ops-per-block, age labels, health score, sparkline normalization | ✅ 26 tests |
| `app.js` | ES-module app: fetch → derive → render, 60s refresh | — |
| `test/bridge.test.mjs` | Unit tests (`node --test`), incl. a vector built from the real 10 most recent bridge ops | — |

All functions in `src/bridge.js` are pure (no network, no `Date.now` inside) so
the whole dashboard logic is testable offline.

## Run the tests

```
node --test apps/bridge-watch/test/bridge.test.mjs
```
