import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProcessTokens,
  analyzeExtrinsics,
  median,
  observationCadence,
  l1Lag,
  syncHealth,
  ageLabel,
  formatTokens,
  normalize,
  CARDANO_BLOCK_SECONDS,
} from "../src/sync.js";

/* ------------------------------------------------------------------ *
 * Fixtures — captured from the live NightForge /api/extrinsics stream.
 * `args` is a JSON string of [ <eventsJson>, <blockRefJson> ]; the
 * events element is itself a JSON string (array), the block reference a
 * JSON string (object).
 * ------------------------------------------------------------------ */

// A real "no events" observation (empty batch) — block ref only.
const EMPTY_OBS = [
  "[]",
  '{"blockHash":"0x3e29083095f454791b57651df27ce49ac369b94b05e354e690cf76e94cafe2a9","blockNumber":13938612,"blockTimestamp":1789365084000,"txIndexInBlock":3}',
];

// A real observation carrying token events. NOTE: in this live sample the
// events element carries txPosition blocks 13938626 and 13938627 (a batched
// multi-block call), while the top-level block reference is 13938627. The
// parser must report the highest observed block (13938627).
const EVENT_OBS = [
  JSON.stringify([
    {
      header: {
        txPosition: {
          blockHash: "0x0bebce3ad5230a0e640575155a9d4db047bd02de6d76a0f73630f4e8166ee79f",
          blockNumber: 13938626,
          blockTimestamp: 1789365346000,
          txIndexInBlock: 1,
        },
        txHash: "0xdf8f15c4e9396c75b4b885e8390e5d1f0bbf7352b905dd9184f1584d704b6071",
        utxoTxHash: "0xdf8f15c4e9396c75b4b885e8390e5d1f0bbf7352b905dd9184f1584d704b6071",
        utxoIndex: 1,
      },
      data: {
        assetCreate: {
          value: 23979307864694,
          owner: "0xe152563c5410bff6a0d43ccebb7c37e1f69f5eb260552521adff33b9c2",
          utxoTxHash: "0xdf8f15c4e9396c75b4b885e8390e5d1f0bbf7352b905dd9184f1584d704b6071",
          utxoTxIndex: 1,
        },
      },
    },
    {
      header: {
        txPosition: {
          blockHash: "0x9221afc4f4730100bb406192876a771c98cf0f167a51ed23035007ea3c382c64",
          blockNumber: 13938627,
          blockTimestamp: 1789365428000,
          txIndexInBlock: 1,
        },
        txHash: "0x3eebde2271c1cfc7804afafeaed0bb217f824dd2b7aaa2229450a241e9bfce77",
        utxoTxHash: "0x3eebde2271c1cfc7804afafeaed0bb217f824dd2b7aaa2229450a241e9bfce77",
        utxoIndex: 0,
      },
      data: {
        assetCreate: {
          value: 6938775488,
          owner: "0xe115576b49d18dafff5cd547692c8931360ac100cf788f5b88415308c1",
          utxoTxHash: "0x3eebde2271c1cfc7804afafeaed0bb217f824dd2b7aaa2229450a241e9bfce77",
          utxoTxIndex: 0,
        },
      },
    },
    {
      header: {
        txPosition: {
          blockHash: "0x9221afc4f4730100bb406192876a771c98cf0f167a51ed23035007ea3c382c64",
          blockNumber: 13938627,
          blockTimestamp: 1789365428000,
          txIndexInBlock: 2,
        },
        txHash: "0x8ab3e6d92e9189a697b79c89aec1689d26a318fcb1767dceb137b6243a6cf0f3",
        utxoTxHash: "0xacc853b1a845a82aedffea130ac3dc22dc40bb17ceef9203f5b818b4e5f93149",
        utxoIndex: 2,
      },
      data: {
        assetSpend: {
          value: 15948847907063,
          owner: "0xe19b491a702c6829075f83ad92f02e6885a8d7964b9d8e86cf518f0427",
          utxoTxHash: "0xacc853b1a845a82aedffea130ac3dc22dc40bb17ceef9203f5b818b4e5f93149",
          utxoTxIndex: 2,
          spendingTxHash: "0x8ab3e6d92e9189a697b79c89aec1689d26a318fcb1767dceb137b6243a6cf0f3",
        },
      },
    },
  ]),
  '{"blockHash":"0x9221afc4f4730100bb406192876a771c98cf0f167a51ed23035007ea3c382c64","blockNumber":13938627,"blockTimestamp":1789365428000,"txIndexInBlock":1}',
];

const mkExtrinsic = (i, block, ts, args) => ({
  id: 1000 + i,
  hash: `0xhash${i}`,
  block_height: block,
  block_hash: `0xbh${i}`,
  index_in_block: 0,
  section: "cNightObservation",
  method: "processTokens",
  args: JSON.stringify(args),
  signer: null,
  success: 1,
  timestamp: ts,
  created_at: ts,
});

// Newest-first observation stream (5 observations).
const STREAM = [
  mkExtrinsic(5, 2581758, 1789409460, EVENT_OBS), // observed L1 13938627
  mkExtrinsic(4, 2581756, 1789409454, [
    "[]",
    '{"blockHash":"0xaaaa","blockNumber":13938625,"blockTimestamp":1789365300000,"txIndexInBlock":0}',
  ]),
  mkExtrinsic(3, 2581754, 1789409448, [
    "[]",
    '{"blockHash":"0xbbbb","blockNumber":13938624,"blockTimestamp":1789365280000,"txIndexInBlock":0}',
  ]),
  mkExtrinsic(2, 2581752, 1789409442, [
    "[]",
    '{"blockHash":"0xcccc","blockNumber":13938623,"blockTimestamp":1789365260000,"txIndexInBlock":0}',
  ]),
  mkExtrinsic(1, 2581750, 1789409436, [
    "[]",
    '{"blockHash":"0xdddd","blockNumber":13938622,"blockTimestamp":1789365240000,"txIndexInBlock":0}',
  ]),
  // Interleaved non-observation (timestamp.set) that must be ignored.
  {
    id: 999,
    hash: "0xts",
    block_height: 2581757,
    block_hash: "0xbh999",
    index_in_block: 0,
    section: "timestamp",
    method: "set",
    args: '["1789409457000"]',
    signer: null,
    success: 1,
    timestamp: 1789409457,
    created_at: 1789409457,
  },
];

test("parseProcessTokens: empty-batch observation extracts the block ref", () => {
  const p = parseProcessTokens(JSON.stringify(EMPTY_OBS));
  assert.equal(p.observedL1Block, 13938612);
  assert.equal(p.observedL1BlockHash, "0x3e29083095f454791b57651df27ce49ac369b94b05e354e690cf76e94cafe2a9");
  assert.equal(p.observedL1TsMs, 1789365084000);
  assert.equal(p.eventCount, 0);
  assert.equal(p.assetCreates, 0);
  assert.equal(p.assetSpend, 0);
  assert.equal(p.createdValueTotal, 0);
  assert.equal(p.spentValueTotal, 0);
});

test("parseProcessTokens: token-event observation folds the highest event block", () => {
  const p = parseProcessTokens(JSON.stringify(EVENT_OBS));
  // Highest txPosition block in the batch is 13938627 (top-level ref agrees).
  assert.equal(p.observedL1Block, 13938627);
  assert.equal(p.observedL1BlockHash, "0x9221afc4f4730100bb406192876a771c98cf0f167a51ed23035007ea3c382c64");
  assert.equal(p.observedL1TsMs, 1789365428000);
  assert.equal(p.eventCount, 3);
  assert.equal(p.assetCreates, 2);
  assert.equal(p.assetSpend, 1);
  assert.equal(p.createdValueTotal, 23979307864694 + 6938775488);
  assert.equal(p.spentValueTotal, 15948847907063);
});

test("parseProcessTokens: multi-block batch reports the max event block, not the head", () => {
  // Head block ref is 100, but events span 101 and 102 -> observed = 102.
  const args = [
    JSON.stringify([
      {
        header: { txPosition: { blockHash: "0xh1", blockNumber: 101, blockTimestamp: 1000, txIndexInBlock: 0 } },
        data: { assetCreate: { value: 5, owner: "0xo", utxoTxHash: "0xt", utxoTxIndex: 0 } },
      },
      {
        header: { txPosition: { blockHash: "0xh2", blockNumber: 102, blockTimestamp: 2000, txIndexInBlock: 0 } },
        data: { assetSpend: { value: 7, owner: "0xo", utxoTxHash: "0xt", utxoTxIndex: 0 } },
      },
    ]),
    JSON.stringify({ blockHash: "0xhead", blockNumber: 100, blockTimestamp: 900, txIndexInBlock: 0 }),
  ];
  const p = parseProcessTokens(JSON.stringify(args));
  assert.equal(p.observedL1Block, 102);
  assert.equal(p.observedL1BlockHash, "0xh2");
  assert.equal(p.observedL1TsMs, 2000);
  assert.equal(p.eventCount, 2);
});

test("parseProcessTokens: null/empty/garbage input returns null", () => {
  assert.equal(parseProcessTokens(null), null);
  assert.equal(parseProcessTokens(""), null);
  assert.equal(parseProcessTokens("not json"), null);
  // Deep parse fails AND no top-level ref keys -> null.
  assert.equal(parseProcessTokens('["[]","{}"]'), null);
});

test("parseProcessTokens: truncated args fall back to regex scrape", () => {
  // Malformed (unterminated) JSON but with a visible top-level ref.
  const raw = '["[...truncated...", \\"blockHash\\":\\"0xdeadbeef\\",\\"blockNumber\\":424242,\\"blockTimestamp\\":1789365000000';
  const p = parseProcessTokens(raw);
  assert.ok(p);
  assert.equal(p.observedL1Block, 424242);
});

test("analyzeExtrinsics: counts only cNightObservation.processTokens", () => {
  const a = analyzeExtrinsics(STREAM);
  assert.equal(a.observations.length, 5);
  assert.equal(a.latestObservedL1Block, 13938627);
  assert.equal(a.oldestObservedL1Block, 13938622);
  assert.deepEqual(a.midnightWindow, [2581750, 2581758]);
  assert.equal(a.uniqueL1BlocksInWindow, 5);
  assert.equal(a.l1BlockSpanInWindow, 13938627 - 13938622);
  assert.equal(a.tokenEventsInWindow, 3);
  assert.equal(a.assetCreatesInWindow, 2);
  assert.equal(a.assetSpendInWindow, 1);
});

test("analyzeExtrinsics: empty / no-observation input", () => {
  const a = analyzeExtrinsics([]);
  assert.equal(a.observations.length, 0);
  assert.equal(a.latestObservedL1Block, null);
  assert.equal(a.oldestObservedL1Block, null);
  assert.deepEqual(a.midnightWindow, [null, null]);
  const b = analyzeExtrinsics([{ section: "timestamp", method: "set", args: "[]" }]);
  assert.equal(b.observations.length, 0);
});

test("median: even, odd, empty, and non-finite handling", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 4, 6]), 5);
});

test("observationCadence: consecutive-observation gaps", () => {
  const a = analyzeExtrinsics(STREAM);
  const c = observationCadence(a);
  // Sorted newest-first, ts deltas: 6,6,6,6 (five obs -> four gaps)
  assert.deepEqual(c.cadenceSeconds, [6, 6, 6, 6]);
  assert.equal(c.medianCadenceSeconds, 6);
  assert.equal(c.minCadenceSeconds, 6);
  assert.equal(c.maxCadenceSeconds, 6);
});

test("observationCadence: variable gaps", () => {
  const obs = {
    observations: [
      { midnightTs: 100 },
      { midnightTs: 90 },
      { midnightTs: 70 },
      { midnightTs: 69 },
    ],
  };
  const c = observationCadence(obs);
  assert.deepEqual(c.cadenceSeconds, [10, 20, 1]);
  assert.equal(c.medianCadenceSeconds, 10);
  assert.equal(c.minCadenceSeconds, 1);
  assert.equal(c.maxCadenceSeconds, 20);
});

test("observationCadence: empty analysis", () => {
  const c = observationCadence({ observations: [] });
  assert.deepEqual(c.cadenceSeconds, []);
  assert.equal(c.medianCadenceSeconds, null);
});

test("l1Lag: computes block + seconds estimate vs a Koios tip row", () => {
  const tip = { hash: "x", epoch_no: 655, block_height: 13940806, block_time: 1789409452 };
  const lag = l1Lag(13938627, tip);
  assert.equal(lag.lagBlocks, 13940806 - 13938627);
  assert.equal(lag.lagSecondsEstimate, (13940806 - 13938627) * CARDANO_BLOCK_SECONDS);
  assert.equal(lag.observedL1Block, 13938627);
  assert.equal(lag.cardanoTipBlock, 13940806);
  assert.equal(lag.estimate, true);
});

test("l1Lag: accepts a bare number tip", () => {
  const lag = l1Lag(1000, 1010);
  assert.equal(lag.lagBlocks, 10);
  assert.equal(lag.lagSecondsEstimate, 10 * CARDANO_BLOCK_SECONDS);
});

test("l1Lag: null when either side is unknown", () => {
  assert.equal(l1Lag(null, { block_height: 5 }), null);
  assert.equal(l1Lag(5, null), null);
  assert.equal(l1Lag(5, { block_height: "nope" }), null);
});

test("syncHealth: perfect stats -> 100 healthy", () => {
  const h = syncHealth({ lagBlocks: 500, medianCadenceSeconds: 6, uniqueL1BlocksInWindow: 40, tokenEventsInWindow: 12 });
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
});

test("syncHealth: tight lag fails when far behind", () => {
  const h = syncHealth({ lagBlocks: 99999, medianCadenceSeconds: 6, uniqueL1BlocksInWindow: 40, tokenEventsInWindow: 12 });
  assert.equal(h.score, 70);
  assert.equal(h.status, "degraded");
  assert.equal(h.checks[0].pass, false);
});

test("syncHealth: cadence fails when too slow", () => {
  const h = syncHealth({ lagBlocks: 100, medianCadenceSeconds: 5000, uniqueL1BlocksInWindow: 40, tokenEventsInWindow: 12 });
  assert.equal(h.score, 70);
  assert.equal(h.checks[1].pass, false);
});

test("syncHealth: no observations -> 0 critical", () => {
  const h = syncHealth({});
  assert.equal(h.score, 0);
  assert.equal(h.status, "critical");
  assert.ok(h.checks.every((c) => !c.pass));
});

test("syncHealth: negative lag (observing ahead of tip) fails tight-lag", () => {
  const h = syncHealth({ lagBlocks: -5, medianCadenceSeconds: 6, uniqueL1BlocksInWindow: 40, tokenEventsInWindow: 1 });
  assert.equal(h.checks[0].pass, false);
});

test("ageLabel: seconds/minutes/hours/days + future clamp", () => {
  const now = 2000;
  assert.equal(ageLabel(1990, now), "10s ago");
  assert.equal(ageLabel(1911, now), "89s ago");
  assert.equal(ageLabel(1910, now), "1m ago"); // 90s rolls to minutes
  assert.equal(ageLabel(1500, now), "8m ago");
  assert.equal(ageLabel(700, now), "21m ago");
  assert.equal(ageLabel(2100, now), "0s ago"); // future clamped to "now"
  assert.equal(ageLabel(null, now), "—");
});

test("formatTokens: 6-decimal formatting", () => {
  assert.equal(formatTokens(1250000), "1.25");
  assert.equal(formatTokens(1), "0.00");
  assert.equal(formatTokens(0), "0.00");
  assert.equal(formatTokens(null), "0.00");
});

test("normalize: min-max to 0..100, flat -> 50s, empty -> []", () => {
  assert.deepEqual(normalize([10, 20, 30]), [0, 50, 100]);
  assert.deepEqual(normalize([5, 5, 5]), [50, 50, 50]);
  assert.deepEqual(normalize([]), []);
  assert.deepEqual(normalize([{ value: 0 }, { value: 100 }]), [0, 100]);
});
