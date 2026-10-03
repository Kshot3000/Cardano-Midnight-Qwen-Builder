# Cardano Midnight Qwen Builder

> An AI agent that builds apps for **Cardano** and **Midnight** — around the clock.

This project integrates with the Midnight Network.

This repository is home to [Cardano Midnight Qwen Builder](https://x.com/kshot9000), a
persistent autonomous agent (Qwen3.8-27B on Hermes) that designs, codes, tests, and ships
apps for the Cardano and Midnight blockchains. Every build lands here as a git commit and is
published as a live website via **GitHub Pages**.

## 🌐 Live sites

All 23 apps are live on GitHub Pages and linked from the [landing page](https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/).

| App | What it does | Link |
|-----|--------------|------|
| **Midnight Pulse** | Live Midnight mainnet dashboard — blocks, TPS, shielded ratio, bridge ops, committee, event breakdown — pulled from the public [NightForge explorer API](https://nightforge.jp/api/docs). API data renders via textContent-only view-models (src/pulse.js). 12 tests. | [apps/midnight-pulse](apps/midnight-pulse/) |
| **Ada Metrics** | Live Cardano dashboard — ADA price, market cap, block height, 24h blocks/tx throughput. Live/stale status is decided only after both APIs settle (no timer race). 12 tests. | [apps/ada-metrics](apps/ada-metrics/) |
| **Ada Yield Tracker** | Live Cardano staking yield — network APY, reward pot, top stake pools with per-pool net APY + saturation (CIP-16 formula, keyless `data.cardano.org`), plus a Pool Inspector for any `pool1…` id. 80 tests. | [apps/ada-yield](apps/ada-yield/) |
| **UTxO Lab** | Cardano coin-selection simulator — exact fee math, min-output-Ada rule, dust folding, 16k UTxO-set cap. Pure client-side, 19 tests. | [apps/utxo-lab](apps/utxo-lab/) |
| **Nightwatch** | Standardized Midnight privacy-chain dashboard — tx growth, DUST consumption, transparent 0–100 health score. Pending metrics labeled, never faked. 20 tests. | [apps/nightwatch](apps/nightwatch/) |
| **Dano Positions** | Live TVL monitor for Dano Finance (Cardano DeFi Kernel) — 24h/7d/30d change, sparklines, verified DefiLlama data. 13 tests. | [apps/dano-positions](apps/dano-positions/) |
| **Midnight Tx Finder** | Midnight mainnet block lookup + live latest-blocks feed and network overview (NightForge API). 9 tests. | [apps/midnight-tx-finder](apps/midnight-tx-finder/) |
| **ADA Price Thermometer** | Three keyless ADA/USD quotes (Minswap, CoinGecko, DefiLlama) fused into a consensus price + 0–100 source-agreement score. 26 tests. | [apps/ada-price-thermometer](apps/ada-price-thermometer/) |
| **Agent Escrow Protocol** | Milestone-based escrow payments for AI agents: release funds only on signed proof of work. JS + Python implementations, unit-tested. | [apps/agent-escrow](apps/agent-escrow/) |
| **AgentProof** | Paste any Agent Escrow receipt and re-derive its validity 100% locally — proof commitments, separation of duties, accounting identity, audit trail. 64 tests. | [apps/agent-proof](apps/agent-proof/) |
| **Midnight DID Wallet** | Build and inspect `did:midnight` identities entirely in-browser — pure-JS BLAKE2s-256, MOD1 offchain-state codec, projected W3C DID Document. Zero network calls. 27 tests. | [apps/midnight-did-wallet](apps/midnight-did-wallet/) |
| **Glacier Drop Checker** | Midnight Glacier Drop NIGHT thaw schedule from the official redemption-contract math, live Cardano tip, bech32 validator. 30 tests. | [apps/glacier-drop](apps/glacier-drop/) |
| **Bridge Watch** | Live Cardano ↔ Midnight bridge health — lifetime ops, 24h volume, transparent 0–100 health score (NightForge API). 26 tests. | [apps/bridge-watch](apps/bridge-watch/) |
| **Contract Watch** | Live Midnight contract ecosystem — census, activity mix, call concentration, deployment trend, byte-exact contract-address codec. 45 tests. | [apps/midnight-contracts](apps/midnight-contracts/) |
| **NIGHT Market Tracker** | Live NIGHT token market dashboard — price, cap, supply vs the 24B cap, 7-day chart, on-chain policy-id cross-check (CoinGecko). 26 tests. | [apps/night-market](apps/night-market/) |
| **Governance Watch** | Who runs Midnight — live council & technical-committee motions, vote tallies, thresholds, 0–100 governance health score. 31 tests. | [apps/governance-watch](apps/governance-watch/) |
| **Block Watch** | Midnight block production, verified — last 120 blocks' hash chain re-checked link-by-link in your browser, cadence + health score. 28 tests. | [apps/block-watch](apps/block-watch/) |
| **Privacy Trend Watch** | Midnight's shielded ratio measured live over 1h–7d windows, decoded unshielded-tx register, 0–100 privacy health score. 23 tests. | [apps/privacy-watch](apps/privacy-watch/) |
| **Transaction Health Monitor** | How cleanly Midnight settles — lifetime applied vs partial-success extrinsics, incident register, D-parameter timeline, health score. 30 tests. | [apps/tx-health](apps/tx-health/) |
| **L1 Sync Watch** | How closely Midnight follows Cardano L1 — live observer lag vs the Koios tip in exact blocks, cadence, sync health score. 22 tests. | [apps/l1-sync](apps/l1-sync/) |
| **Validator Watch** | Who actually produces Midnight's blocks — producer share, HHI concentration recomputed from raw counts, decentralization score. 36 tests. | [apps/validator-watch](apps/validator-watch/) |
| **Reward Flow Watch** | Cardano's monetary engine, accounted — supply vs the 45B cap, real mint per epoch, conservation identities re-checked in-browser. 21 tests. | [apps/reward-flow](apps/reward-flow/) |
| **DRep Watch** | Cardano governance, delegated — live DRep census with CIP-129 bech32 decoding, per-epoch delegation trend, participation score. 39 tests. | [apps/drep-watch](apps/drep-watch/) |

Sites are served from this repo's root (GitHub Pages → `main` branch → `/`), e.g.
`https://Kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/midnight-pulse/`.

## 🤖 What the agent does

1. **Builds** real, runnable code — Plutus-style Cardano contracts, Midnight ZK-network
   tooling, browser dashboards, CLIs — not stubs.
2. **Tests** everything locally (Node `node:test`, Python `unittest`) before committing.
3. **Publishes** a GitHub Pages site describing each app, with live data where possible.
4. **Repeats**, forever — see [ROADMAP.md](ROADMAP.md) for the queue of upcoming builds.

## 💡 Design thesis

The next crypto primitive isn't another dashboard — it's **verifiable workloads**: proving an
AI agent completed a job, paid the right party, and left an audit trail. Cardano gives the
settlement layer; Midnight gives selective disclosure via zero-knowledge proofs. That's how
compute turns into accountable infrastructure. (This repo's escrow protocol is a concrete
prototype of that idea.)


## 🌙 Midnight Compact starters (live)

New Midnight contracts should **not** start from the archived Example Counter.

| Resource | Notes |
| --- | --- |
| [`example-bboard`](https://github.com/midnightntwrk/example-bboard) | **Preferred** full-stack starter (witnesses, identity commitments) |
| [`create-mn-app`](https://github.com/midnightntwrk/create-mn-app) | Official scaffold (`bboard` / battleship / leaderboard templates) |
| [`example-counter`](https://github.com/midnightntwrk/example-counter) | **Archived** — historical only |

**Agent Escrow** off-chain reference: [`apps/agent-escrow`](apps/agent-escrow/) · Compact port notes: [`apps/agent-escrow/COMPACT-PORT.md`](apps/agent-escrow/COMPACT-PORT.md) · Compact skeleton lab: [Midnight-GrokBot-Agent/contracts/agent-escrow](https://github.com/Kshot3000/Midnight-GrokBot-Agent/tree/main/contracts/agent-escrow).

Auth rule (**MPS-0029**): never authorize privileged circuits with `ownPublicKey()` alone — use witness-derived `persistentHash` role commitments (see Compact port notes).

## 👛 Donate (ADA)

If you like what the agent builds:

```
addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v
```

## 🐦 Follow

[X / Twitter: @kshot9000](https://x.com/kshot9000)

## 🛠 Repo layout

```
/                        GitHub Pages landing page (index.html, styles.css)
/apps/<name>/            23 apps — each has index.html + app.js + src/ + test/
/assets/common.js        shared nav, footer, and donation box for every page
/docs/                   community announcements and notes
```

Shared assets (`styles.css`, `assets/common.js`) and each app's `app.js` are
referenced with a `?v=` cache key — bump the key whenever the file changes so
returning visitors never get a stale copy.

## 🧪 Run the tests

687 tests total (664 JavaScript + 23 Python), all passing:

```bash
# every app's JS suite
for d in apps/*/test; do node --test "$d"/*.mjs; done
# escrow protocol, both implementations
node --test apps/agent-escrow/test/escrow.test.mjs
python3 -m unittest discover apps/agent-escrow/test
```

## License

MIT — see [LICENSE](LICENSE).

*Built 24/7 by Cardano Midnight Qwen Builder.*
