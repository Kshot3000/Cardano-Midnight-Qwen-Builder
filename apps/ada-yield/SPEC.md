# 📈 Ada Yield Tracker — live Cardano staking yield

A live dashboard of **Cardano staking yield** that needs **no API key and no
backend**: it pulls mainnet data from the public, keyless
[data.cardano.org](https://data.cardano.org) (Koios-compatible) API and
computes every number with the **official CIP-16 reward formula** — the same
math the Cardano Foundation reward calculator uses.

No fake data, no placeholder APIs. If an endpoint doesn't supply a field, it's
labeled `pending`/`—` rather than inventing a number.

## What it shows

| Item | Source | Status |
|------|--------|--------|
| Current epoch + era | `GET /tip` (last completed) | 🟢 live |
| Network reward pot / epoch | `GET /totals` fees+reserves, `GET /cli_protocol_params` ρ/τ | 🟢 live |
| Network APY | pot ÷ circulating ADA × 73 epochs/yr | 🟢 live |
| Circulating / total supply | `GET /totals` | 🟢 live |
| Top stake pools (by active stake) | `GET /pool_list` (paged, 400/page, ~7 pages) | 🟢 live |
| Per-pool net APY | CIP-16 `poolReward` − fixed cost − margin | 🟢 live |
| Per-pool saturation | pool stake ÷ optimal size `S/k` | 🟢 live |
| Per-delegation yield | calculator (your ADA, margin, cost) | 🟢 interactive |

## The math (CIP-16)

```
# Reward pot per epoch (Cardano Foundation canonical)
P = (fees + ρ · reserves) · (1 − τ)
  ρ = monetaryExpansion (~0.003)   τ = treasuryCut (~0.2)

# Per-pool gross reward (CIP-16), with σ′/s′ capped at z0 = 1/k
σ  = poolStake / S        σ′ = min(σ, z0)
s  = pledge / S           s′ = min(s, z0)
poolReward = P / (1 + a0) · (σ′ + s′·a0·((σ′ − s′·(z0 − σ′))/z0)) · perf

# Net delegator yield
net = (poolReward − fixedCost) · (1 − margin)
APY = net / poolStake · 73 epochs/yr
saturation = poolStake / (S / k)
```

`S` is the **current total supply** (the CF calculator's convention —
`maxSaturationStake = currentAdaSupply / k`). `a0` (pledge reward) and `perf`
(performance) are assumed optimal.

## Data & units

- **keyless** `data.cardano.org/k/api/v1`, CORS `*`, no token embedded.
- `active_stake`, `pledge`, `fixed_cost`, `fees`, `reserves`, `supply`,
  `circulation` are all **lovelace** (÷ 1e6 → ADA); `margin` is a fraction.
- A pool is "live" when `active_stake > 0` (not by `pool_status`, since a
  `registered` pool can already carry stake).
- `pool_list` cannot be **ordered/filtered** by `active_stake` server-side
  (the HAProxy nulls the column), so the app pages all rows and sorts
  client-side. `pool_info` batch POST is flaky (HaProxy 404) and is **not**
  used.
- `cli_protocol_params` is intermittently flaky; the app retries (3×) and
  falls back to hard-coded protocol constants (ρ=0.003, τ=0.2, k=500).

## Modules

| File | Purpose | Tested? |
|------|---------|---------|
| `src/rewards.js` | Pure CIP-16 reward math + network params | ✅ 25 tests |
| `src/poolmath.js` | Data adapter (lovelace→ADA) + network APY / ranking helpers | ✅ 25 tests |
| `app.js` | ES-module app: fetch → derive → render → calculator | — |
| `test/rewards.test.mjs` | Unit tests (node --test) | — |

## Run the tests

```
node --test apps/ada-yield/test/rewards.test.mjs
```
