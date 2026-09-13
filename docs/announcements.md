# Community announcements — ready to post

Everything is written to match the official Midnight documentation style guide
(factual, non-promotional, correct terminology: **DApp**, **ZK**, **zero-knowledge proof**,
**Midnight Network**). Copy/paste as-is.

---

## 1) Midnight Discord — #dev-chat

> Hey all — shipping something small for the Midnight ecosystem: **Nightwatch**, a
> privacy-network health dashboard for Midnight mainnet. It pulls the NightForge public
> explorer API and shows transaction activity + 24h/48h growth, DUST consumption, and a
> transparent 0-100 network health score (the scoring rubric is published in the UI).
>
> Repo: https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder
> Live: https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/nightwatch/
>
> The metric logic is pure and unit-tested (20 tests). It's part of a larger repo that also
> has a live Midnight mainnet dashboard (Midnight Pulse) and a milestone escrow protocol
> for AI agents. Feedback welcome — especially on which metrics you'd actually want to see
> on a privacy-chain health page.
>
> PR to the awesome list: https://github.com/midnightntwrk/midnight-awesome-dapps/pull/189

---

## 2) Midnight Forum (forum.midnight.network) — Technical / Show your work

**Title:** Nightwatch — privacy-network health dashboard for Midnight mainnet (open source)

> **What it is**
>
> Nightwatch is an open-source dashboard that monitors Midnight mainnet health from the
> NightForge public explorer API. It is not a wallet, not a DApp, and it does not execute
> transactions — it reads public network data and renders it.
>
> **Metrics**
>
> - Transaction activity (hourly series) and 24h/48h growth, computed over equal windows
> - DUST consumption: active DUST addresses, DUST transaction count, and burn rate over the
>   last 24h vs the previous 24h
> - Network health score (0-100). The score is a transparent weighted rubric shown in the UI;
>   no black-box scoring.
> - Active addresses and 30/90-day retention are marked *pending* until NightForge exposes
>   the underlying series — no fabricated numbers.
>
> **Engineering**
>
> - Metric logic is a pure, unit-tested module (`apps/nightwatch/src/metrics.js`, 20 tests,
>   Node `node:test`, run in GitHub Actions CI).
> - The dashboard degrades gracefully: if a NightForge endpoint is unavailable, the affected
>   card shows `unavailable` instead of an error.
> - Published on GitHub Pages; no build step, no dependencies, no data leaves the browser
>   except the API calls to NightForge.
>
> **Repo** (topic `midnightntwrk` set; attribution: *This project integrates with the
> Midnight Network.*)
>
> - Source: https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder
> - Dashboard: https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/nightwatch/
> - Awesome-list PR: https://github.com/midnightntwrk/midnight-awesome-dapps/pull/189
>
> **What I'd like feedback on**
>
> 1. Which privacy-chain health metrics do you consider most important (committee
>    quorum, bridge throughput, ZK proof times, ...)?
> 2. Is a public health score useful for node operators / auditors, or is it noise?
> 3. Should this become a reusable spec other privacy chains can adopt?
>
> Maintained by an autonomous build agent (Qwen on Hermes) that ships to this repo on a
> 15-minute cycle; issues and PRs are the fastest way to steer it.

---

## 3) Cardano Forum (forum.cardano.org) — Ecosystem / Building

**Title:** Two open-source live dashboards for Cardano + Midnight (Cardano settlement & Midnight ZK)

> Sharing two open-source dashboards my autonomous build agent has been shipping, one for
> each chain:
>
> - **Ada Metrics** — live Cardano: ADA price & market cap (CoinGecko), block height and
>   24h block/transaction throughput (Blockchair).
>   https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/ada-metrics/
> - **Midnight Pulse** — live Midnight mainnet: blocks, TPS, shielded ratio, bridge ops,
>   committee size, event breakdown (NightForge API).
>   https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/midnight-pulse/
>
> Repo (MIT): https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder — also contains a
> milestone-based escrow protocol for AI agents (JS + Python, 45 unit tests) as a reference
> for proof-of-work payment flows.
>
> Follow: https://x.com/kshot9000

---

## 4) X (@kshot9000) — announce thread

> **Post 1 (main):**
> Building for #Midnight and #Cardano 24/7 with an autonomous Qwen agent 🌙💎
>
> Just shipped Nightwatch — a privacy-network health dashboard for Midnight mainnet:
> • tx activity + 24h/48h growth
> • DUST consumption + burn rate
> • transparent 0-100 health score (rubric shown in the UI)
>
> 20 unit tests, live on GitHub Pages 👇
> https://kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/nightwatch/
>
> **Post 2 (repo + ecosystem):**
> The whole repo is open source (MIT) and the agent commits every 15 min:
> • Midnight Pulse — live Midnight dashboard
> • Ada Metrics — live Cardano dashboard
> • Agent Escrow — milestone escrow for AI agents (JS + Python, 45 tests)
>
> https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder
> Tagged `midnightntwrk` — attribution done ✅
>
> **Post 3 (community CTA):**
> What should the agent build next for the #Midnight / #Cardano communities?
> I'm taking suggestions (retention charts, committee quorum, bridge throughput...).
> Donate ADA to keep the builds going:
> addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v
