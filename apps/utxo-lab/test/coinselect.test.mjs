import test from "node:test";
import assert from "node:assert/strict";
import {
  coinSize,
  minOutputLovelace,
  minFeeLovelace,
  txBytes,
  selectLovelace,
  selectAssets,
  planTransfer,
  utxoSetOk,
  assetGroupBytes,
  UTXO_SET_LIMIT,
} from "../src/coinselect.js";

const ADA = 1_000_000;

test("coinSize: 0 bytes -> 0, sub-64 -> 1, exactly 64 -> 1, 65 -> 2", () => {
  assert.equal(coinSize(0), 0);
  assert.equal(coinSize(1), 1);
  assert.equal(coinSize(64), 1);
  assert.equal(coinSize(65), 2);
  assert.equal(coinSize(128), 2);
  assert.equal(coinSize(129), 3);
});

test("minOutputLovelace: plain ADA = 1 ADA; multi-asset cs=1 = 35 ADA; cs=2 = 69 ADA", () => {
  assert.equal(minOutputLovelace(0), 1 * ADA);
  assert.equal(minOutputLovelace(55), 35 * ADA);
  assert.equal(minOutputLovelace(100), 69 * ADA);
});

test("minFeeLovelace: linear fee 44 + 15.3*bytes (already in lovelace), ceil", () => {
  // 217 bytes: 44 + 15.3*217 = 3364.1 -> ceil -> 3365 lovelace
  const bytes = 217;
  assert.equal(minFeeLovelace(bytes), Math.ceil(44 + 15.3 * bytes));
  // 1 byte: 44 + 15.3 = 59.3 -> 60
  assert.equal(minFeeLovelace(1), 60);
  // 350 bytes (2-in/2-out): 44 + 15.3*350 = 5399 -> 5399
  assert.equal(minFeeLovelace(350), 5399);
});

test("txBytes: 1 input, 2 plain outputs", () => {
  assert.equal(txBytes({ inputCount: 1, outputs: [{ assetBytes: 0 }, { assetBytes: 0 }] }), 120 + 55 + 55);
});

test("txBytes: script output adds 1070", () => {
  const base = txBytes({ inputCount: 1, outputs: [{ assetBytes: 0 }], hasScript: false });
  const script = txBytes({ inputCount: 1, outputs: [{ assetBytes: 0 }], hasScript: true });
  assert.equal(script - base, 1070);
});

test("selectLovelace smallest-first picks fewest-from-bottom until covered", () => {
  const utxos = [
    { id: "a", lovelace: 5 * ADA },
    { id: "b", lovelace: 1 * ADA },
    { id: "c", lovelace: 2 * ADA },
  ];
  const r = selectLovelace(utxos, 3 * ADA, "smallest");
  assert.deepEqual(r.selected.map((u) => u.id), ["b", "c"]);
  assert.equal(r.remainderLovelace, 0);
});

test("selectLovelace largest-first grabs the biggest first", () => {
  const utxos = [
    { id: "a", lovelace: 1 * ADA },
    { id: "b", lovelace: 10 * ADA },
    { id: "c", lovelace: 2 * ADA },
  ];
  const r = selectLovelace(utxos, 3 * ADA, "largest");
  assert.deepEqual(r.selected.map((u) => u.id), ["b"]);
  assert.equal(r.remainderLovelace, 7 * ADA);
});

test("selectLovelace throws INSUFFICIENT when set cannot cover target", () => {
  const utxos = [{ lovelace: 1 * ADA }];
  assert.throws(() => selectLovelace(utxos, 2 * ADA), (e) => e.code === "INSUFFICIENT");
});

test("selectLovelace rejects empty set and bad target", () => {
  assert.throws(() => selectLovelace([], 1), (e) => e.code === "EMPTY_SET");
  assert.throws(() => selectLovelace([{ lovelace: 1 }], -5), (e) => e.code === "BAD_TARGET");
  assert.throws(() => selectLovelace([{ lovelace: 1 }], 1.5), (e) => e.code === "BAD_TARGET");
});

test("selectAssets: collects multi-asset utxos until every wanted key covered", () => {
  const P = "a".repeat(56);
  const N1 = "b".repeat(56);
  const N2 = "c".repeat(56);
  const utxos = [
    { id: "x", lovelace: 2 * ADA, assets: [{ policy: P, name: N1, amount: 3 }] },
    { id: "y", lovelace: 1 * ADA, assets: [{ policy: P, name: N2, amount: 5 }] },
    { id: "z", lovelace: 1 * ADA, assets: [] },
  ];
  const wanted = [
    { policy: P, name: N1, amount: 3 },
    { policy: P, name: N2, amount: 5 },
  ];
  const r = selectAssets(utxos, wanted);
  assert.deepEqual([...r.leftover.keys()], []);
  assert.equal(r.selected.length, 2);
  assert.equal(r.accAda, 3 * ADA);
});

test("selectAssets: reports leftover shortfall when set lacks units", () => {
  const P = "a".repeat(56);
  const N1 = "b".repeat(56);
  const utxos = [{ lovelace: 2 * ADA, assets: [{ policy: P, name: N1, amount: 2 }] }];
  const r = selectAssets(utxos, [{ policy: P, name: N1, amount: 10 }]);
  assert.equal(r.leftover.get(P + "/" + N1), 8);
});

test("planTransfer: change output created above min, inputs balanced with fee", () => {
  const utxos = [
    { lovelace: 100 * ADA },
    { lovelace: 50 * ADA },
  ];
  const outputs = [{ lovelace: 120 * ADA }];
  const p = planTransfer(utxos, outputs, { strategy: "smallest" });
  // smallest-first picks 50 then 100 => in 150, out 120, remainder 30 ADA
  // bytes: 2*120 + 2*55 = 350 -> fee = ceil(44 + 15.3*350) = 5399 (µADA)
  assert.equal(p.feeLovelace, 5399);
  assert.equal(p.changeLovelace, 30 * ADA - 5399); // 29_994_601
  const totalIn = p.inputs.reduce((s, u) => s + u.lovelace, 0);
  const totalOut = p.outputs.reduce((s, o) => s + o.lovelace, 0);
  assert.equal(totalOut + p.feeLovelace, totalIn);
  assert.equal(p.outputs.length, 2);
});

test("planTransfer: dust change folded into largest plain output", () => {
  // p1: remainder 4 ADA >= min(1 ADA) + fee -> change output emitted
  // bytes 1-in/2-out = 120 + 2*55 = 230 -> fee = ceil(44 + 15.3*230) = 3563
  const utxos = [{ lovelace: 104 * ADA }];
  const p1 = planTransfer(utxos, [{ lovelace: 100 * ADA }]);
  assert.equal(p1.feeLovelace, 3563);
  assert.equal(p1.changeLovelace, 4 * ADA - 3563); // 3_996_437
  assert.equal(p1.outputs.length, 2);
  assert.equal(p1.foldNote, null);
  const t1in = p1.inputs.reduce((s, u) => s + u.lovelace, 0);
  const t1out = p1.outputs.reduce((s, o) => s + o.lovelace, 0);
  assert.equal(t1out + p1.feeLovelace, t1in);

  // p2: remainder 500k < 1 ADA -> dust folded into the only plain output
  const p2 = planTransfer(utxos.slice(0), [{ lovelace: 103 * ADA + 500_000 }]);
  // bytes 1-in/1-out = 120 + 55 = 175 -> fee = ceil(44 + 15.3*175) = 2722
  assert.equal(p2.feeLovelace, 2722);
  assert.equal(p2.changeLovelace, 0);
  assert.equal(p2.outputs.length, 1);
  assert.equal(p2.foldNote, "folded 497278 dust into output 0");
  const t2in = p2.inputs.reduce((s, u) => s + u.lovelace, 0);
  const t2out = p2.outputs.reduce((s, o) => s + o.lovelace, 0);
  assert.equal(t2out + p2.feeLovelace, t2in);
});

test("planTransfer: fold disabled throws on dust change", () => {
  const utxos = [{ lovelace: 100 * ADA }];
  const outputs = [{ lovelace: 99 * ADA + 500_000 }];
  assert.throws(
    () => planTransfer(utxos, outputs, { foldChange: false }),
    (e) => e.code === "DUST_CHANGE"
  );
});

test("planTransfer: insufficient inputs throws", () => {
  const utxos = [{ lovelace: 1 * ADA }];
  const outputs = [{ lovelace: 10 * ADA }];
  assert.throws(() => planTransfer(utxos, outputs), (e) => e.code === "INSUFFICIENT");
});

test("planTransfer: script output raises fee and is excluded from folding", () => {
  const utxos = [{ lovelace: 200 * ADA }];
  const outputs = [{ lovelace: 100 * ADA, script: true }];
  const plain = planTransfer(utxos, [{ lovelace: 100 * ADA }]);
  const withScript = planTransfer(utxos, outputs);
  assert.ok(withScript.feeLovelace > plain.feeLovelace);
});

test("planTransfer rejects bad outputs", () => {
  const utxos = [{ lovelace: 10 * ADA }];
  assert.throws(() => planTransfer(utxos, []), (e) => e.code === "NO_OUTPUTS");
  assert.throws(() => planTransfer(utxos, [{ lovelace: -1 }]), (e) => e.code === "BAD_OUTPUT");
});

test("utxoSetOk: boundary at 16384", () => {
  assert.equal(utxoSetOk(0), true);
  assert.equal(utxoSetOk(UTXO_SET_LIMIT), true);
  assert.equal(utxoSetOk(UTXO_SET_LIMIT + 1), false);
  assert.equal(utxoSetOk(-1), false);
  assert.equal(utxoSetOk(1.5), false);
});

test("assetGroupBytes: 44 + name length", () => {
  assert.equal(assetGroupBytes("p".repeat(56), "n".repeat(8)), 52);
  assert.equal(assetGroupBytes("p".repeat(56), ""), 44);
});
