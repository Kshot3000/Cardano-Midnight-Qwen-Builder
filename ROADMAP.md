# Roadmap — builds in the queue

The agent works continuously. Completed builds are pushed as commits; upcoming
builds are listed here. Newest first in each section.

## ✅ Shipped

| Build | Date | Notes |
|-------|------|-------|
| Landing site + Pages scaffolding | 2026-09-13 | This repo's homepage |
| Midnight Pulse dashboard | 2026-09-13 | Live mainnet stats, NightForge API |
| Ada Metrics dashboard | 2026-09-13 | Live Cardano stats, Blockchair + CoinGecko |
| Agent Escrow Protocol | 2026-09-13 | JS + Python escrow state machines, unit-tested |
| Nightwatch | 2026-09-13 | Standardized privacy-health dashboard (growth, DUST, health score), 20 unit tests |
| AgentProof explorer | 2026-09-13 | Paste-any-receipt escrow auditor — 7 re-derivable checks (proof commitments, separation of duties, accounting, audit trail) in a local browser page, 64 unit tests incl. E2E against the real escrow state machine |
| Ecosystem "tag" for communities | 2026-09-13 | Repo tagged `midnightntwrk` (exact label indexers scan) + README attribution sentence + "Built for Midnight / Built for Cardano" badge on the site + PR to the official Midnight awesome-dapps list (#189) + ready-to-post community announcements (`docs/announcements.md`) |
| Midnight DID Wallet | 2026-09-14 | Build a `did:midnight` identity + inspect any DID in-browser — pure-JS BLAKE2s-256, spec-conformant MOD1 offchain-state codec (byte-for-byte against the official spec vector `3c08b857…fc21`), self-hashing DIDs, projected W3C DID Document. Zero network calls, 25 unit tests |
| Ada Yield Tracker | 2026-09-14 | Live Cardano staking yield — network APY, reward pot, and top stake pools with per-pool net APY + saturation, computed with the official CIP-16 formula from keyless `data.cardano.org` (Koios) mainnet data, plus a delegation calculator. 25 unit tests on the CIP-16 reward math |
| Ada Yield Pool Inspector | 2026-09-14 | Paste any `pool1…` (or 56-hex) id to inspect it live: full operator metadata via keyless `pool_list` (stake, pledge, margin, fixed cost, status, epoch, relays, meta URL), a 0–100 health score with exact flags (retiring / oversaturated / zero pledge / no relays / high margin / high cost), and a CIP-16 yield ladder for six stake sizes in ADA + live CoinGecko USD. Pure bech32 pool-ID codec (28-byte, byte-for-byte against two real live pools) + health/yield modules. 55 new unit tests (80 total in the app) |
| Glacier Drop checker | 2026-09-14 | Midnight Glacier Drop NIGHT thaw — the exact 4-installment unlock schedule (every 90 days, remainder-to-last) from the official `ThawingSchedule.hs` redemption contract math, live `data.cardano.org` mainnet tip + on-chain NIGHT mint total, network thaw progress + "day N of 360", and a bech32 Cardano address validator. 30 unit tests |
| Bridge Watch | 2026-09-14 | Live Cardano ↔ Midnight bridge health — lifetime bridge ops, 24h volume, hourly 24h trend sparkline, 12h-vs-12h growth, ops-per-unique-Cardano-block (parsed from `args_summary`), recent-ops table with Midnight + Cardano block refs and age labels, Cardano epoch/slot context, and a transparent 0–100 bridge health score, all from the public keyless NightForge `/api/analytics/bridge` + `/api/analytics/overview`. 26 unit tests |
| Contract Watch | 2026-09-14 | Live Midnight smart-contract ecosystem — contract census, top-contracts leaderboard, activity mix (active / dormant / abandoned / never called), call concentration (top-1/3/10 share), 30-day deployment trend with 7d-vs-7d growth, and a deploy-events cross-check (dedupe + address sanity), all from public keyless NightForge `/api/analytics/contracts` + `/api/contracts/deployed`. Byte-exact `midnight:contract-address[v2]:` codec (0x + 30-byte ASCII tag + 32-byte digest = 126 hex). 44 unit tests, incl. exact tallies over all 150 real leaderboard rows |
| NIGHT Market Tracker | 2026-09-14 | Live Midnight NIGHT token market — price, market cap, FDV, 24h volume + turnover, 24h range, rank, ATH, 7d/14d/30d changes, 72-bar 7d chart with volatility (σ of 1-step returns), supply vs the 24B cap, and an on-chain cross-check that CoinGecko's Cardano policy id (`0691b2fe…af1fa`) matches the known NIGHT policy byte-for-byte. Transparent 0–100 market-health rubric (7 checks). Keyless CoinGecko `midnight-3` API. 26 unit tests |

## 🚧 Up next

1. **Nightwatch: active-address + retention** — wire in the moment the
   public indexer exposes address-level analytics.

## Principles

- Real code, real tests — no stubs.
- Live public data where an API exists; clearly-labeled snapshots otherwise.
- Every app gets a Pages page with a donation address.
