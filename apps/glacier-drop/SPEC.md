# 🧊 Glacier Drop Checker — Midnight NIGHT thaw

A live checker for the **Midnight Glacier Drop** (NIGHT) distribution that needs
**no API key and no backend**: it replicates the exact arithmetic of the
official `ThawingSchedule` redemption contract
([`midnightntwrk/night-token-distribution`](https://github.com/midnightntwrk/night-token-distribution)
→ `mgdoc/src/Midnight/GlacierDrop/Scripts/ThawingSchedule.hs`), reads the live
Cardano mainnet tip from the public, keyless
[data.cardano.org](https://data.cardano.org) (Koios-compatible) API, and
validates Cardano destination addresses.

No fake data, no placeholder APIs. If an endpoint doesn't supply a field, it's
labeled `pending` rather than inventing a number.

## What it shows

| Item | Source | Status |
|------|--------|--------|
| Cardano epoch / block height / time | `GET /tip` (last completed) | 🟢 live |
| NIGHT on-chain mint total | `GET /mint?policy=…&asset=4e49474854` | 🟢 live (summed) |
| Phase states (claim / scavenger / thawing) | deterministic `phaseStatus(now)` | 🟢 deterministic |
| Network thaw progress + "day N of 360" | `thawProgress(now)` over the 360-day window | 🟢 deterministic |
| Your 4-installment unlock schedule | `thawSchedule` (contract math) | 🟢 interactive |
| Unlocked / locked amounts + next unlock | `thawStatus` | 🟢 interactive |
| Destination address validity | `validateCardanoAddress` (bech32) | 🟢 interactive |

## The thaw math (mirrors `ThawingSchedule.hs`)

```
# Per address: a pseudo-random "jitter stratum" sets FIRST-UNLOCK somewhere in
# the first 90-day window (2025-12-10 … 2026-03-09). Then:

count = 4            -- INCREMENT_COUNT
period = 90 days     -- INCREMENT_PERIOD
q     = floor(total / count)

installments = [
  (first + 0*period, q),
  (first + 1*period, q),
  (first + 2*period, q),
  (first + 3*period, total - 3*q),   # remainder → last, so Σ == total
]

# Status at now:  unlocked = #(installments with date <= now)
#                 unlockedStar = Σ their amounts
#                 next = schedule[unlocked]  (null when fully thawed)
```

Contract comment: *"the last thawing can be a little bit bigger because it
includes the remainder."* Amounts are in **STAR** (`1 NIGHT = 1,000,000 STAR`,
6 decimals); the contract only handles integer STAR, so all math is
deterministic integer arithmetic — no float drift.

## Timeline (UTC)

| Milestone | Date |
|-----------|------|
| Eligibility snapshot | 2025-06-11 |
| Glacier Drop claim | 2025-08-05 → 2025-10-20 |
| Scavenger Mine | 2025-10-29 → 2025-11-19 |
| NIGHT minted on Cardano (24B) | 2025-10-24 |
| Thaw start / first-unlock window opens | 2025-12-10 |
| Midnight mainnet | 2026-03-30 |
| Thaw end (last installment reachable) | 2026-12-04 |

## Why the first-unlock day is an input

The per-address first-unlock date is derived from the **claim signature**,
which only exists after claiming in the official portal. The checker takes that
day (1–90) as shown in the portal and computes the rest of the schedule from
it. Network-wide progress, phase states, and the live tip are independent of
your address.

## Data & units

- keyless `data.cardano.org/k/api/v1`, CORS `*`, no token embedded.
- NIGHT asset: policy `0691b2fe…af1fa`, hex name `4e49474854` ("NIGHT"), 6
  decimals, 24,000,000,000 NIGHT total supply.
- `/mint` `amount` is in STAR; the app sums the rows for the NIGHT asset to
  show the live on-chain minted total. When the endpoint is unreachable or has
  no rows, the UI shows `pending` (honest), not a fabricated number.

## Address validation

Shelley addresses are bech32. The validator checks hrp (`addr`/`stake`),
character set, the BIP-173 checksum (`polymod(hrp_expand + data) == 1`), and a
sane decoded byte length (21–109). Cardano base addresses run ~100–111 chars,
so the length cap is 111, not the BIP-173 default of 90.

## Modules

| File | Purpose | Tested? |
|------|---------|---------|
| `src/glacier.js` | Pure thaw math, STAR⇄NIGHT, phase/progress, bech32 + address validation | ✅ 30 tests |
| `app.js` | ES-module app: fetch → derive → render → allocation/validator UI | — |
| `test/glacier.test.mjs` | Unit tests (node --test) | — |

## Run the tests

```
node --test apps/glacier-drop/test/glacier.test.mjs
```
