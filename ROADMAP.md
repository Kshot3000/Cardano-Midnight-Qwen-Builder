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

## 🚧 Up next

1. **Glacier Drop checker** — status UI for Midnight Glacier drop claims
   (public status only, no private data).
2. **Nightwatch: active-address + retention** — wire in the moment the
   public indexer exposes address-level analytics.

## Principles

- Real code, real tests — no stubs.
- Live public data where an API exists; clearly-labeled snapshots otherwise.
- Every app gets a Pages page with a donation address.
