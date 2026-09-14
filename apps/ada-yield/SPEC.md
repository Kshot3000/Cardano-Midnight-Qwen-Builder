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
| **Pool Inspector** — any `pool1…` / 56-hex id | `GET /pool_list?pool_id_bech32=eq.…` single row + health flags + CIP-16 yield ladder | 🟢 live |
| Live ADA/USD (ladder) | CoinGecko `simple/price` | 🟢 live (labeled `pending` if unreachable) |

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
- Server-side ordering/filtering works with **dot syntax**:
  `?order=active_stake.desc&limit=5` and `?pool_id_bech32=eq.pool1…` (the
  colon form `order=active_stake:desc` is nulled by the proxy). The
  Pool Inspector uses the `eq.` filter to fetch a single pool row.
  `pool_view` is not used — it 400s behind the data.cardano.org proxy
  ("missing required Host header").
- `pool_info` batch POST is flaky (HaProxy 404) and is **not** used.
- `cli_protocol_params` is intermittently flaky; the app retries (3×) and
  falls back to hard-coded protocol constants (ρ=0.003, τ=0.2, k=500).

## Pool Inspector

Paste any pool id → one live row of metadata, a 0–100 **health score**, and a
CIP-16 **yield ladder** for six stake sizes (1k → 1M ADA) in the pool's live
margin/cost, with live CoinGecko USD.

- `src/poolid.js` — pure bech32 codec for stake-pool ids. A pool id is a
  **28-byte** value (56 hex) with hrp `pool`. Verified byte-for-byte against
  two real live `pool1…` ↔ hex pairs from `data.cardano.org`. Rejects wrong
  hrp, bad checksum, and wrong length.
- `src/poolhealth.js` — pure row normalizer (lovelace→ADA) + health flags:
  `inactive` (no active stake), `retiring`, `oversaturated` (stake > S/k),
  `zero-pledge`, `cost-burden` (fixed cost > 0.5% of active stake / epoch),
  `no-relays`, `no-ticker`, `high-margin` (> 10%). A clean pool gets an
  explicit "No issues flagged" info line.
  Health score: base 100 with per-flag deductions — inactive −60, retiring
  −35, oversaturated −20, no-relays −15, zero-pledge −10, cost-burden −10,
  no-ticker −5, high-margin −5 (floor 0); grades A ≥ 90, B ≥ 75, C ≥ 60,
  D ≥ 40, else F. The yield ladder reuses the exact CIP-16 `annualYield`
  chain from `rewards.js` for six stake sizes (default 1k → 1M ADA), with an
  optional ADA/USD price for the USD columns.

## Modules

| File | Purpose | Tested? |
|------|---------|---------|
| `src/rewards.js` | Pure CIP-16 reward math + network params | ✅ 25 tests |
| `src/poolmath.js` | Data adapter (lovelace→ADA) + network APY / ranking helpers | ✅ 25 tests |
| `src/poolid.js` | Pure bech32 stake-pool-id codec (28-byte, hrp `pool`) | ✅ 26 tests |
| `src/poolhealth.js` | Pool row normalizer + health flags/score + CIP-16 yield ladder | ✅ 29 tests |
| `app.js` | ES-module app: fetch → derive → render → calculator → Pool Inspector | — |
| `test/rewards.test.mjs` | Unit tests (node --test) | — |
| `test/poolid.test.mjs` | Pool-id codec tests (node --test) | — |
| `test/poolhealth.test.mjs` | Health + ladder tests (node --test) | — |

## Run the tests

```
node --test apps/ada-yield/test/rewards.test.mjs
node --test apps/ada-yield/test/poolid.test.mjs
node --test apps/ada-yield/test/poolhealth.test.mjs
```
