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

## 🚧 Up next

1. **Nightwatch** — DUST + committee monitor for Midnight: epoch tracking,
   committee member changes, cNight observation counts, alerting on anomalies.
2. **AgentProof explorer** — browse + verify milestone escrow receipts
   (proof-hash → commitment matching) as a public audit page.
3. **Midnight DID mini-wallet** — web wallet scaffold around `did:midnight`
   identities and the 1AM `connectedAPI`.
4. **Ada Yield Tracker** — staking pool stats + delegation calculator for
   Cardano, with an interactive pool comparison table.
5. **Glacier Drop checker** — status UI for Midnight Glacier drop claims
   (public status only, no private data).

## Principles

- Real code, real tests — no stubs.
- Live public data where an API exists; clearly-labeled snapshots otherwise.
- Every app gets a Pages page with a donation address.
