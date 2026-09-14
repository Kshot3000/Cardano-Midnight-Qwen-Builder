// UTxO Lab — Cardano coin-selection engine (pure, unit-tested).
//
// Fee model (mainnet standard linear fee, CIP-58 era params):
//   minFee = 44 + 15.3 * bytes
// Minimum output Ada (script data rule, conservative):
//   minOutput = 1 + 34 * coinSize   (Ada), coinSize = ceil(assetBytes/64), min 1
// Byte model (estimates used by cardano-cli planning):
//   each input   = 120 bytes (witness + ref)
//   each output  = 55 base bytes + 34 * (coinSize - 1) extra for multi-asset
//   script out   = +1070 bytes (PlutusV2 script hash + data budget)
// UTxO set limit: 16384 entries.
//
// All amounts in lovelace (integers). coinSize math mirrors Shelley-based rules.

export const FEE_A = 44;
export const FEE_B = 15.3;
export const INPUT_BYTES = 120;
export const OUTPUT_BASE_BYTES = 55;
export const COIN_SIZE_UNIT_BYTES = 34;
export const SCRIPT_OUTPUT_BYTES = 1070;
export const UTXO_SET_LIMIT = 16384;
export const COIN_SIZE_BYTE_UNIT = 64;

export function coinSize(assetBytes) {
  return Math.max(0, Math.ceil((assetBytes || 0) / COIN_SIZE_BYTE_UNIT));
}

// Minimum ADA (lovelace) an output holding `assetBytes` of multi-asset data may carry.
export function minOutputLovelace(assetBytes = 0) {
  const cs = coinSize(assetBytes);
  return Math.round((1 + 34 * cs) * 1e6);
}

// Minimum ADA (lovelace) for a plain ADA output.
export function minAdaOutputLovelace() {
  return minOutputLovelace(0);
}

// Mainnet linear fee: minFee = 44 + 15.3 * bytes, in lovelace (µADA).
export function minFeeLovelace(bytes) {
  return Math.ceil(FEE_A + FEE_B * bytes);
}

// Byte estimate for a tx body with the given shapes.
// plain output = 55 bytes; each coin-size unit of multi-asset data adds 34 bytes;
// a script output adds the PlutusV2 data budget.
export function txBytes({ inputCount, outputs, hasScript = false } = {}) {
  let b = inputCount * INPUT_BYTES;
  for (const o of outputs) {
    b += OUTPUT_BASE_BYTES + COIN_SIZE_UNIT_BYTES * coinSize(o.assetBytes || 0);
  }
  if (hasScript) b += SCRIPT_OUTPUT_BYTES;
  return b;
}

// Select a set of plain-ADA UTxOs (each {lovelace, ...}) to cover `targetLovelace`.
// strategy: "smallest" (default) or "largest".
// Returns { selected, remainderLovelace } or throws Error with code.
export function selectLovelace(utxos, targetLovelace, strategy = "smallest") {
  if (!Array.isArray(utxos) || utxos.length === 0) throw err("EMPTY_SET", "no UTxOs");
  if (!Number.isInteger(targetLovelace) || targetLovelace < 0)
    throw err("BAD_TARGET", "target must be a non-negative integer of lovelace");

  const order =
    strategy === "largest"
      ? [...utxos].sort((a, b) => b.lovelace - a.lovelace)
      : [...utxos].sort((a, b) => a.lovelace - b.lovelace);

  const picked = [];
  let acc = 0;
  for (const u of order) {
    picked.push(u);
    acc += u.lovelace;
    if (acc >= targetLovelace) break;
  }
  if (acc < targetLovelace) {
    throw err("INSUFFICIENT", `need ${targetLovelace}, have ${acc}`);
  }
  return { selected: picked, remainderLovelace: acc - targetLovelace };
}

// Multi-asset selection: each wanted = { policy, name, amount } (amount in units).
// utxos = [{ lovelace, assets: [{policy,name,amount}] }]
// Returns { selected, leftover } (leftover = units still missing per wanted key).
export function selectAssets(utxos, wanted) {
  const wantedMap = new Map();
  for (const w of wanted) {
    const k = w.policy + "/" + w.name;
    wantedMap.set(k, (wantedMap.get(k) || 0) + w.amount);
  }
  const picked = [];
  let accAda = 0;
  const acc = new Map();
  const total = utxos.reduce((s, u) => s + u.lovelace, 0);
  for (const u of utxos) {
    if (picked.length === 0 || !covered(acc, wantedMap)) {
      picked.push(u);
      accAda += u.lovelace;
      for (const a of u.assets || []) {
        const k = a.policy + "/" + a.name;
        acc.set(k, (acc.get(k) || 0) + a.amount);
      }
    }
  }
  const leftover = new Map();
  for (const [k, need] of wantedMap) {
    const have = acc.get(k) || 0;
    if (have < need) leftover.set(k, need - have);
  }
  return { selected: picked, accAda, leftover };
}

function covered(acc, wantedMap) {
  for (const [k, need] of wantedMap) if ((acc.get(k) || 0) < need) return false;
  return true;
}

// Full transfer plan.
// utxos: [{lovelace, assets?}]
// outputs: [{lovelace, assetBytes?, assets?, script?}]
// opts: { strategy, foldChange: bool (default true) }
//
// Algorithm:
//   1. select inputs to cover sum(outputs)
//   2. remainder = in - out
//   3. fee with NO change output; if remainder >= minOutput + fee  -> emit change
//   4. else if remainder >= fee (dust) -> fold into largest plain output (or error)
//   5. else -> INSUFFICIENT_FOR_FEE
// Fee is recomputed with the final output set; balance identity holds:
//   sum(inputs) = sum(outputs) + fee.
export function planTransfer(utxos, outputs, opts = {}) {
  const strategy = opts.strategy || "smallest";
  const foldChange = opts.foldChange !== false;

  if (!Array.isArray(outputs) || outputs.length === 0)
    throw err("NO_OUTPUTS", "need at least one output");
  for (const o of outputs) {
    if (!Number.isInteger(o.lovelace) || o.lovelace < 0)
      throw err("BAD_OUTPUT", "output lovelace must be a non-negative integer");
  }

  const outAda = outputs.reduce((s, o) => s + o.lovelace, 0);
  const script = outputs.some((o) => o.script);
  const changeMin = minOutputLovelace(0);

  const { selected } = selectLovelace(utxos, outAda, strategy);
  const totalIn = selected.reduce((s, u) => s + u.lovelace, 0);
  let remainder = totalIn - outAda;

  const feeNoChange = minFeeLovelace(txBytes({ inputCount: selected.length, outputs, hasScript: script }));

  if (remainder >= changeMin + feeNoChange) {
    // Emit change; recompute fee with change output included.
    const outList = outputs.map((o) => ({ ...o }));
    const feeLovelace = minFeeLovelace(
      txBytes({ inputCount: selected.length, outputs: outList.concat([{ lovelace: 0, assetBytes: 0 }]), hasScript: script })
    );
    const changeLovelace = remainder - feeLovelace;
    if (changeLovelace < changeMin) {
      // Fee with change output is slightly higher than estimated; fall through to dust handling.
      return finishPlan(utxos, outputs, opts, selected, totalIn, remainder, script, changeMin, true);
    }
    outList.push({ lovelace: changeLovelace, assetBytes: 0 });
    const bytes = txBytes({ inputCount: selected.length, outputs: outList, hasScript: script });
    return {
      inputs: selected,
      outputs: outList,
      changeLovelace,
      feeLovelace,
      bytes,
      totalLovelace: totalIn,
      foldNote: null,
    };
  }

  return finishPlan(utxos, outputs, opts, selected, totalIn, remainder, script, changeMin, false);
}

function finishPlan(utxos, outputs, opts, selected, totalIn, remainder, script, changeMin, hadChangeAttempt) {
  const foldChange = opts.foldChange !== false;
  const feeLovelace = minFeeLovelace(txBytes({ inputCount: selected.length, outputs, hasScript: script }));

  if (remainder < feeLovelace) {
    throw err(
      "INSUFFICIENT_FOR_FEE",
      `inputs cover outputs but not the fee (short ${feeLovelace - remainder} lovelace)`
    );
  }

  const dust = remainder - feeLovelace; // 0 <= dust < changeMin
  if (dust > 0) {
    if (!foldChange) throw err("DUST_CHANGE", `change ${dust} < min output ${changeMin} and fold disabled`);
    const outList = outputs.map((o) => ({ ...o }));
    let best = -1;
    for (let i = 0; i < outList.length; i++) {
      if (outList[i].script) continue;
      if (best === -1 || outList[i].lovelace > outList[best].lovelace) best = i;
    }
    if (best === -1) throw err("DUST_NO_TARGET", "dust change but no plain output to fold into");
    outList[best].lovelace += dust;
    const bytes = txBytes({ inputCount: selected.length, outputs: outList, hasScript: script });
    const finalFee = minFeeLovelace(bytes);
    if (remainder < finalFee) {
      throw err("INSUFFICIENT_FOR_FEE", `folded dust leaves balance ${remainder} < fee ${finalFee}`);
    }
    return {
      inputs: selected,
      outputs: outList,
      changeLovelace: 0,
      feeLovelace: finalFee,
      bytes,
      totalLovelace: totalIn,
      foldNote: `folded ${dust} dust into output ${best}`,
    };
  }

  // exact: remainder == fee
  const outList = outputs.map((o) => ({ ...o }));
  const bytes = txBytes({ inputCount: selected.length, outputs: outList, hasScript: script });
  return {
    inputs: selected,
    outputs: outList,
    changeLovelace: 0,
    feeLovelace,
    bytes,
    totalLovelace: totalIn,
    foldNote: null,
  };
}

// UTxO set size guard.
export function utxoSetOk(count) {
  return Number.isInteger(count) && count >= 0 && count <= UTXO_SET_LIMIT;
}

// Asset-group bytes estimate: policy(32) + name(len) + 8 + coin data 4 = 44 + nameLen
export function assetGroupBytes(policy, name) {
  return 44 + name.length;
}

function err(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}
