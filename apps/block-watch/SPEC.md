# ⛓ Block Watch — Midnight block production, verified

A live, keyless dashboard that audits **how Midnight makes blocks** — the
last 120 blocks' hash chain re-verified link by link in the browser, block
heights checked for skipped numbers, cadence measured against the 6-second
target, plus the Cardano epoch progress the Midnight node tracks.

No fake data, no placeholder APIs. If the explorer stops exposing a field,
the page shows `–` rather than inventing a number.

## What it shows

| Item | Source | Status |
|------|--------|--------|
| Latest block height / hash / age | `GET /api/blocks?limit=120` | 🟢 live |
| Blocks/minute + avg gap over the window | derived from `timestamp[]` | 🟢 derived |
| Per-block gap chart (120 bars) | derived from `timestamp[]` | 🟢 derived |
| Hash-chain audit (119 parent-hash links) | derived from `hash` / `parent_hash` | 🟢 derived |
| Height-contiguity audit | derived from `height[]` | 🟢 derived |
| Cardano epoch + progress bar | `GET /api/analytics/overview` → `epoch` | 🟢 live (5-day span assumption, labeled) |
| Network age | `overview` → `networkAgeDays` | 🟢 live |
| Block production health score (0–100) | `blockHealth` rubric over the above | 🟢 derived |

## The health score (transparent rubric, 0–100)

| Check | Points |
|-------|--------|
| Intact hash chain — every parent-hash link verified in the window | 30 |
| Contiguous block heights — no skipped numbers | 25 |
| Steady cadence — avg gap within 6s ± 50%, no negative gaps | 25 |
| Fresh tip — newest block younger than 5 minutes | 20 |

≥80 healthy · ≥50 degraded · ≥25 watch · else critical.

## Data

- `https://mainnet.nightforge.jp/api/blocks?limit=120` — newest blocks,
  newest first: `height`, `hash`, `parent_hash`, `state_root`,
  `extrinsics_root`, `timestamp` (unix s), `extrinsics_count`.
- `https://mainnet.nightforge.jp/api/analytics/overview` — `epoch
  {mainchain_epoch, mainchain_slot, next_epoch_timestamp (unix ms)}`,
  `genesisTime` (unix s), `networkAgeDays`.

## Files

- `index.html` — self-contained page (donation box + X account via `common.js`)
- `app.js` — fetch + render, auto-refresh every 60 s
- `src/blocks.js` — pure metric functions (28 unit tests)
- `test/blocks.test.mjs` — `node --test apps/block-watch/test/blocks.test.mjs`
