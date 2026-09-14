"use strict";
/**
 * L1 Sync Watch — pure logic for Midnight's Cardano L1 observation stream.
 *
 * Data sources (public, keyless, CORS-enabled):
 *   NightForge explorer — https://mainnet.nightforge.jp
 *     GET /api/extrinsics?limit=N
 *       newest-first list of extrinsics:
 *       { id, hash, block_height, block_hash, index_in_block,
 *         section, method, args, signer, success, timestamp, created_at }
 *       Midnight's L1 observer is section "cNightObservation", method
 *       "processTokens". Its `args` is a JSON string of
 *       [ eventsJson, blockRefJson ] — two *nested JSON strings*: an array
 *       of token events, and the block reference
 *       { blockHash, blockNumber, blockTimestamp, txIndexInBlock }. The
 *       events array can span several L1 blocks (batched); the observed
 *       L1 block reported is the highest of { block reference, event
 *       txPosition.blockNumber }. Each token event is
 *       { header: { txPosition: { blockHash, blockNumber, blockTimestamp,
 *         txIndexInBlock }, txHash, utxoTxHash, utxoIndex },
 *         data: { assetCreate: { value, owner, utxoTxHash, utxoIndex }
 *                | assetSpend: { value, owner, utxoTxHash, utxoIndex,
 *                  spendingTxHash } | <future event kinds> } }.
 *
 *   data.cardano.org (Koios) — https://data.cardano.org/k/api/v1
 *     GET /tip -> [{ hash, epoch_no, abs_slot, block_height, block_time, ... }]
 *
 * Every function is pure (no network, no Date.now inside) so the whole
 * dashboard logic is unit-testable. Zero deps.
 */

/** Cardano Mainnet block time in seconds (since Babbage). */
export const CARDANO_BLOCK_SECONDS = 20;

/**
 * Parse one cNightObservation.processTokens `args` string.
 *
 * Tolerant by design: the block reference is extracted from the raw string
 * (first occurrence of each key) so it survives even when the JSON is
 * malformed or truncated, while token events are parsed from the real JSON
 * when available. Returns null when `args` is not a usable string.
 *
 * @param {string} argsRaw the extrinsic `args` field
 * @returns {?{observedL1Block:number|null, observedL1BlockHash:string|null,
 *   observedL1TsMs:number|null, eventCount:number,
 *   assetCreates:number, assetSpend:number,
 *   createdValueTotal:number, spentValueTotal:number}}
 */
export function parseProcessTokens(argsRaw) {
  if (typeof argsRaw !== "string" || !argsRaw.length) return null;

  let observedL1Block = null;
  let observedL1BlockHash = null;
  let observedL1TsMs = null;
  let eventCount = 0;
  let assetCreates = 0;
  let assetSpend = 0;
  let createdValueTotal = 0;
  let spentValueTotal = 0;
  let deepParsed = false;

  // Primary path: deep-parse. `args` is a JSON array of two JSON *strings*:
  //   [ <eventsJson>, <blockRefJson> ]
  // The events element parses to an ARRAY of token events (each with its own
  // nested txPosition); the block-reference element parses to an OBJECT with
  // top-level blockHash / blockNumber / blockTimestamp. We identify each by
  // shape (array vs object) rather than by position, so a single call that
  // processes token events spanning several L1 blocks is still attributed to
  // the correct top-level observed block.
  try {
    const outer = JSON.parse(argsRaw);
    if (Array.isArray(outer)) {
      for (const el of outer) {
        let parsed = el;
        if (typeof el === "string") {
          try {
            parsed = JSON.parse(el);
          } catch {
            continue;
          }
        }
        if (!parsed) continue;
        if (Array.isArray(parsed)) {
          // Token events. A single call can carry events from several L1
          // blocks (batched), so track the highest txPosition (block + hash
          // + timestamp) seen and fold it into the observed head below.
          let maxEventBlock = null;
          let maxEventHash = null;
          let maxEventTs = null;
          for (const ev of parsed) {
            if (!ev) continue;
            eventCount += 1;
            const tp = ev.header && ev.header.txPosition;
            if (tp && Number.isFinite(Number(tp.blockNumber))) {
              const nb = Number(tp.blockNumber);
              if (maxEventBlock == null || nb > maxEventBlock) {
                maxEventBlock = nb;
                maxEventHash = tp.blockHash != null ? String(tp.blockHash) : null;
                maxEventTs = tp.blockTimestamp != null ? Number(tp.blockTimestamp) : null;
              }
            }
            const d = ev.data || {};
            if (d.assetCreate && Number.isFinite(Number(d.assetCreate.value))) {
              assetCreates += 1;
              createdValueTotal += Number(d.assetCreate.value);
            } else if (d.assetSpend && Number.isFinite(Number(d.assetSpend.value))) {
              assetSpend += 1;
              spentValueTotal += Number(d.assetSpend.value);
            }
          }
          if (maxEventBlock != null) {
            if (observedL1Block == null || maxEventBlock > observedL1Block) {
              observedL1Block = maxEventBlock;
              if (maxEventHash != null) observedL1BlockHash = maxEventHash;
              if (maxEventTs != null) observedL1TsMs = maxEventTs;
            }
          }
        } else if (parsed && typeof parsed === "object" && parsed.blockNumber != null) {
          // Block reference (the L1 block this call is processing). Take the
          // max with any event blocks already folded in — a batched call can
          // carry events from blocks newer than its own reference.
          const rn = Number(parsed.blockNumber);
          if (Number.isFinite(rn) && (observedL1Block == null || rn > observedL1Block)) {
            observedL1Block = rn;
            if (parsed.blockHash != null) observedL1BlockHash = String(parsed.blockHash);
            if (parsed.blockTimestamp != null) observedL1TsMs = Number(parsed.blockTimestamp);
          }
        }
      }
      deepParsed = true;
    }
  } catch {
    /* fall through to regex fallback */
  }

  // Fallback: the deep parse failed (e.g. truncated args). Scrape the first
  // top-level block reference keys out of the raw string. Best effort. The
  // keys may appear backslash-escaped (they are nested inside a JSON
  // string), so match on a de-escaped copy.
  if (!deepParsed) {
    const cleaned = argsRaw.replace(/\\/g, "");
    const pick = (re) => {
      const m = re.exec(cleaned);
      return m ? m[1] : null;
    };
    const bn = pick(/"blockNumber"\s*:\s*(\d+)/);
    const bh = pick(/"blockHash"\s*:\s*"([0-9a-fA-Fx]+)"/);
    const bt = pick(/"blockTimestamp"\s*:\s*(\d{12,})/);
    if (bn) observedL1Block = Number(bn);
    if (bh) observedL1BlockHash = bh;
    if (bt) observedL1TsMs = Number(bt);
  }

  if (observedL1Block == null && observedL1TsMs == null && eventCount === 0) {
    // Nothing recognisable — treat as a non-observation.
    return null;
  }

  return {
    observedL1Block,
    observedL1BlockHash,
    observedL1TsMs,
    eventCount,
    assetCreates,
    assetSpend,
    createdValueTotal,
    spentValueTotal,
  };
}

/**
 * Scan a newest-first extrinsic list for the L1 observation stream.
 *
 * @param {Array<object>} extrinsics newest-first extrinsics (any section)
 * @returns {{observations:Array, midnightWindow:[?number,?number],
 *   latestObservedL1Block:number|null, oldestObservedL1Block:number|null,
 *   uniqueL1BlocksInWindow:number, l1BlockSpanInWindow:number,
 *   tokenEventsInWindow:number, assetCreatesInWindow:number,
 *   assetSpendInWindow:number, createdValueInWindow:number,
 *   spentValueInWindow:number}}
 */
export function analyzeExtrinsics(extrinsics) {
  const observations = [];
  for (const ex of extrinsics || []) {
    if (!ex || ex.section !== "cNightObservation" || ex.method !== "processTokens") continue;
    const p = parseProcessTokens(ex.args);
    if (!p) continue;
    observations.push({
      midnightExtrinsicId: ex.id,
      midnightBlock: ex.block_height,
      midnightHash: ex.hash,
      midnightTs: ex.timestamp,
      ...p,
    });
  }
  // observations keep input order (newest first)
  const blocks = observations
    .map((o) => o.observedL1Block)
    .filter((n) => Number.isFinite(n));
  const mids = observations
    .map((o) => o.midnightBlock)
    .filter((n) => Number.isFinite(n));
  const created = observations.reduce((s, o) => s + o.createdValueTotal, 0);
  const spent = observations.reduce((s, o) => s + o.spentValueTotal, 0);
  return {
    observations,
    midnightWindow: mids.length ? [Math.min(...mids), Math.max(...mids)] : [null, null],
    latestObservedL1Block: blocks.length ? Math.max(...blocks) : null,
    oldestObservedL1Block: blocks.length ? Math.min(...blocks) : null,
    uniqueL1BlocksInWindow: new Set(blocks).size,
    l1BlockSpanInWindow: blocks.length ? Math.max(...blocks) - Math.min(...blocks) : 0,
    tokenEventsInWindow: observations.reduce((s, o) => s + o.eventCount, 0),
    assetCreatesInWindow: observations.reduce((s, o) => s + o.assetCreates, 0),
    assetSpendInWindow: observations.reduce((s, o) => s + o.assetSpend, 0),
    createdValueInWindow: created,
    spentValueInWindow: spent,
  };
}

/**
 * Median of a numeric list (empty -> null). Robust for cadence stats.
 * @param {number[]} xs
 * @returns {?number}
 */
export function median(xs) {
  const a = (xs || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Observation cadence: seconds between successive Midnight observations
 * of the L1 stream, over consecutive Midnight blocks that each contain an
 * observation. Gaps of Midnight blocks without observations are NOT
 * fabricated — the cadence series is "time between observations".
 *
 * @param {{observations:Array}} analysis output of analyzeExtrinsics
 * @returns {{cadenceSeconds:Array, medianCadenceSeconds:number|null,
 *   minCadenceSeconds:number|null, maxCadenceSeconds:number|null}}
 */
export function observationCadence(analysis) {
  const obs = (analysis && analysis.observations) || [];
  const cadence = [];
  for (let i = 0; i + 1 < obs.length; i++) {
    const a = obs[i]; // newer
    const b = obs[i + 1]; // older
    if (a.midnightTs == null || b.midnightTs == null) continue;
    const d = Math.max(0, a.midnightTs - b.midnightTs);
    if (Number.isFinite(d)) cadence.push(d);
  }
  return {
    cadenceSeconds: cadence,
    medianCadenceSeconds: median(cadence),
    minCadenceSeconds: cadence.length ? Math.min(...cadence) : null,
    maxCadenceSeconds: cadence.length ? Math.max(...cadence) : null,
  };
}

/**
 * How far Midnight's observation stream lags the Cardano tip.
 * `lagBlocks` is null when either side is unknown. `lagSeconds` estimates
 * wall-clock lag from block distance at the 20s Cardano block time — it is
 * an estimate and the returned object says so explicitly.
 *
 * @param {?number} latestObservedL1Block highest L1 block Midnight observed
 * @param {?{block_height:number}|number|null} cardanoTip Koios /tip row or height
 * @returns {?{lagBlocks:number, lagSecondsEstimate:number,
 *   observedL1Block:number, cardanoTipBlock:number, estimate:boolean}}
 */
export function l1Lag(latestObservedL1Block, cardanoTip) {
  const tipHeight =
    cardanoTip == null ? null : Number.isFinite(Number(cardanoTip))
      ? Number(cardanoTip)
      : Number.isFinite(Number(cardanoTip.block_height))
        ? Number(cardanoTip.block_height)
        : null;
  const obs =
    latestObservedL1Block != null && Number.isFinite(Number(latestObservedL1Block))
      ? Number(latestObservedL1Block)
      : null;
  if (obs == null || tipHeight == null) return null;
  const lagBlocks = tipHeight - obs;
  return {
    lagBlocks,
    lagSecondsEstimate: lagBlocks * CARDANO_BLOCK_SECONDS,
    observedL1Block: obs,
    cardanoTipBlock: tipHeight,
    estimate: true,
  };
}

/**
 * L1 sync health score, 0-100. Transparent rubric:
 *   +30  tight lag:  Midnight is observing within ~3,000 Cardano blocks
 *        (~100 min at 20s blocks) of the tip
 *   +30  steady stream: median observation cadence <= 300s (every ~5 min)
 *   +20  broad coverage: >= 10 distinct Cardano blocks observed in the
 *        scanned window
 *   +20  asset flow: token events (creates + spends) present in the window
 * @param {{lagBlocks?:number|null, medianCadenceSeconds?:number|null,
 *   uniqueL1BlocksInWindow?:number, tokenEventsInWindow?:number}} stats
 * @returns {{score:number, status:string, checks:Array<{label:string,pass:boolean,pts:number}>}}
 */
export function syncHealth(stats) {
  const st = stats || {};
  const lag = Number.isFinite(Number(st.lagBlocks)) ? Number(st.lagBlocks) : null;
  const cad = Number.isFinite(Number(st.medianCadenceSeconds))
    ? Number(st.medianCadenceSeconds)
    : null;
  const checks = [
    {
      label: "Tight lag (observing within 3,000 Cardano blocks of tip)",
      pass: lag != null && lag >= 0 && lag <= 3000,
      pts: 30,
    },
    {
      label: "Steady observation stream (median gap ≤ 300s)",
      pass: cad != null && cad <= 300,
      pts: 30,
    },
    {
      label: "Broad coverage (≥ 10 distinct Cardano blocks in window)",
      pass: (Number(st.uniqueL1BlocksInWindow) || 0) >= 10,
      pts: 20,
    },
    {
      label: "Asset flow (token events observed in window)",
      pass: (Number(st.tokenEventsInWindow) || 0) > 0,
      pts: 20,
    },
  ];
  const score = checks.reduce((s, c) => s + (c.pass ? c.pts : 0), 0);
  const status =
    score >= 80 ? "healthy" : score >= 50 ? "degraded" : score >= 25 ? "watch" : "critical";
  return { score, status, checks };
}

/**
 * Human "N ago" label for a unix-seconds timestamp, relative to `now`
 * (unix seconds). Future/clamped input renders as "now" — never a
 * negative age.
 * @param {number} timestamp unix seconds
 * @param {number} now unix seconds
 * @returns {string}
 */
export function ageLabel(timestamp, now) {
  if (timestamp == null || !Number.isFinite(Number(timestamp))) return "—";
  const sec = Math.max(0, Math.floor(now - Number(timestamp)));
  if (sec < 90) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 90) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Format a raw value with 6 decimal places (Midnight token units are
 * micro-units, same as Cardano lovelaces).
 * @param {number} v raw units
 * @returns {string}
 */
export function formatTokens(v) {
  const n = Number(v) || 0;
  return (n / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * Min-max scale a numeric series to 0..100 for bar charts. A flat
 * series yields all 50 (no divide-by-zero); empty input yields [].
 * @param {Array<{value:number}>|number[]} series
 * @returns {number[]}
 */
export function normalize(series) {
  const vals = (series || []).map((r) =>
    typeof r === "number" ? r : Number(r.value) || 0
  );
  if (!vals.length) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  if (!range) return vals.map(() => 50);
  return vals.map((v) => Math.round(((v - min) / range) * 100));
}
