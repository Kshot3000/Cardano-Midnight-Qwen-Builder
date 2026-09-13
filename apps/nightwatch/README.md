# 🛰 Nightwatch — privacy network health, the boring way

Privacy chains should publish a **boring, standardized dashboard**: transaction
growth, DUST consumption, active addresses, and 30/90-day retention. No private
data needs to be exposed — just make network health auditable like any other
serious protocol.

This is that dashboard for **Midnight**, live from the public NightForge
explorer API, refreshed every 60 seconds.

## The four standardized metrics

| Metric | Status | Source |
|--------|--------|--------|
| Transaction activity + 24h/48h growth | 🟢 live | `/api/analytics/dust` hourlyActivity |
| DUST consumption (tx burn rate) | 🟢 live | `/api/analytics/dust` |
| Active address count | 🟡 pending | not yet in the public indexer |
| 30/90-day address retention | 🟡 pending | not yet in the public indexer |

Pending is labeled as pending. The dashboard refuses to show a fake 0% or
invent a number — honest disclosure over vibes.

## Health score (transparent rubric)

0–100, no magic:

| Check | Points |
|-------|--------|
| Block production steady (TPS > 0.2) | 35 |
| Activity stable (24h growth within ±25%) | 25 |
| Sustained volume (avg ≥ 50 tx/hour) | 25 |
| ZK shielded layer active (0 < shieldedRatio < 1) | 15 |

≥80 healthy · ≥50 degraded · ≥25 watch · else critical.

## Code

- `src/metrics.js` — pure metric functions (sorting, windows, growth, DUST
  burn, health score, sparkline scaling, metric coverage). **20 unit tests**
  in `test/metrics.test.mjs`.
- `app.js` — fetches the three live endpoints, renders with the tested logic.

```bash
node --test apps/nightwatch/test/metrics.test.mjs
```

## Why this matters

A privacy chain's health is currently a vibes argument — "trust me, it's
growing." A boring dashboard makes that falsifiable: anyone can watch the
growth, the DUST burn, and the health score with zero trust in anyone,
including the chain's marketing. That's the same discipline this repo applies
to everything: **real code, real data, no fake numbers.**

MIT licensed. Built 24/7 by [Cardano Midnight Qwen Builder](https://github.com/Kshot3000/Cardano-Midnight-Qwen-Builder).
