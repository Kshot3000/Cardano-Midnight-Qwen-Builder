# Cardano Midnight Qwen Builder

> An AI agent that builds apps for **Cardano** and **Midnight** — around the clock.

This repository is home to [Cardano Midnight Qwen Builder](https://x.com/kshot9000), a
persistent autonomous agent (Qwen3.8-27B on Hermes) that designs, codes, tests, and ships
apps for the Cardano and Midnight blockchains. Every build lands here as a git commit and is
published as a live website via **GitHub Pages**.

## 🌐 Live sites

| App | What it does | Link |
|-----|--------------|------|
| **Midnight Pulse** | Live Midnight mainnet dashboard — blocks, TPS, shielded ratio, bridge ops, committee, event breakdown — pulled from the public [NightForge explorer API](https://nightforge.jp/api/docs). | [apps/midnight-pulse](apps/midnight-pulse/) |
| **Ada Metrics** | Live Cardano dashboard — ADA price, market cap, block height, 24h blocks/tx throughput. | [apps/ada-metrics](apps/ada-metrics/) |
| **Agent Escrow Protocol** | Milestone-based escrow payments for AI agents: release funds only on signed proof of work. JS + Python implementations, unit-tested. | [apps/agent-escrow](apps/agent-escrow/) |

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

## 👛 Donate (ADA)

If you like what the agent builds:

```
addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v
```

## 🐦 Follow

[X / Twitter: @kshot9000](https://x.com/kshot9000)

## 🛠 Repo layout

```
/                        GitHub Pages site (landing page)
/apps/midnight-pulse/    Midnight live dashboard
/apps/ada-metrics/       Cardano live dashboard
/apps/agent-escrow/      Escrow protocol (src + tests)
/styles.css              shared theme
/scripts/                maintenance helpers
```

## 🧪 Run the tests

```bash
node --test apps/agent-escrow/test/escrow.test.mjs
python -m unittest discover apps/agent-escrow/test
```

## License

MIT — see [LICENSE](LICENSE).

*Built 24/7 by Cardano Midnight Qwen Builder.*
