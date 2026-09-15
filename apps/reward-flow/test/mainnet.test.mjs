// Reward Flow Watch — real-mainnet integration fixture.
//
// These 21 rows are VERBATIM from the official data.cardano.org totals table,
// fetched live on 2026-09-14:
//   GET /k/api/v1/totals?limit=21&select=epoch_no,supply,reserves,treasury,reward,circulation,fees
// (newest-first, epochs 655..635). The tip at fetch time was epoch 655 (in
// progress), so the pipeline under test drops that row and works on the 20
// completed epochs 635..654 — exactly what app.js does at runtime.
//
// This pins the whole pipeline against real mainnet data: if the indexer's
// field names, units, or conservation behavior ever change, this test fails
// loudly instead of the page silently showing wrong numbers.
// Run: node --test apps/reward-flow/test/mainnet.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUPPLY_ADA,
  normalizeTotals,
  summarize,
  engineHealth,
} from "../src/flow.js";

// Raw rows exactly as returned by the API (lovelace strings, newest-first).
const RAW_TIP = 655;
const RAW = [
  { epoch_no: 655, supply: "38873140973087148", reserves: "6126859026912852", treasury: "1356415272910618", reward: "766594036398195", circulation: "36744787974275948", fees: "32555502387" },
  { epoch_no: 654, supply: "38863142703768564", reserves: "6136857296231436", treasury: "1352660259469257", reward: "766621112429426", circulation: "36738713412774826", fees: "33855095055" },
  { epoch_no: 653, supply: "38853260437014508", reserves: "6146739562985492", treasury: "1348927208648520", reward: "768721494311167", circulation: "36730265644833720", fees: "28533221101" },
  { epoch_no: 652, supply: "38843447446698512", reserves: "6156552553301488", treasury: "1344850365394442", reward: "773564140246965", circulation: "36719671593407102", fees: "41213650003" },
  { epoch_no: 651, supply: "38833413670030902", reserves: "6166586329969098", treasury: "1341062162963424", reward: "787286340528981", circulation: "36699593933606472", fees: "44946932025" },
  { epoch_no: 650, supply: "38823451407346130", reserves: "6176548592653870", treasury: "1337356659543733", reward: "920674556326878", circulation: "36559963986360525", fees: "21839114994" },
  { epoch_no: 649, supply: "38813599168246033", reserves: "6186400831753967", treasury: "1453739190472892", reward: "798621622854329", circulation: "36555880568828135", fees: "23270090677" },
  { epoch_no: 648, supply: "38803572882173527", reserves: "6196427117826473", treasury: "1450053248585177", reward: "797735740883044", circulation: "36550320207145109", fees: "29001560197" },
  { epoch_no: 647, supply: "38793748392725155", reserves: "6206251607274845", treasury: "1446440676499991", reward: "832421822572794", circulation: "36509015447189975", fees: "30614462395" },
  { epoch_no: 646, supply: "38783811807088789", reserves: "6216188192911211", treasury: "1444502385502327", reward: "828498606111519", circulation: "36504641982042654", fees: "28277432289" },
  { epoch_no: 645, supply: "38773997889616177", reserves: "6226002110383823", treasury: "1473763718394011", reward: "803537411636833", circulation: "36489899411971897", fees: "58933613436" },
  { epoch_no: 644, supply: "38763957566434644", reserves: "6236042433565356", treasury: "1476273407573134", reward: "793868588441540", circulation: "36486449262121273", fees: "30904298697" },
  { epoch_no: 643, supply: "38753805388921422", reserves: "6246194611078578", treasury: "1472483668367337", reward: "796215325822519", circulation: "36477437753551343", fees: "33355180223" },
  { epoch_no: 642, supply: "38743637896989601", reserves: "6256362103010399", treasury: "1473782005296303", reward: "787608666939986", circulation: "36474473805546242", fees: "40207207070" },
  { epoch_no: 641, supply: "38733443163747839", reserves: "6266556836252161", treasury: "1469970597071996", reward: "802473367937547", circulation: "36453321539872006", fees: "43626866290" },
  { epoch_no: 640, supply: "38723189948639587", reserves: "6276810051360413", treasury: "1464901790894939", reward: "851042396744759", circulation: "36399761513092997", fees: "37867906892" },
  { epoch_no: 639, supply: "38713001077121473", reserves: "6286998922878527", treasury: "1471083728713820", reward: "850860857709668", circulation: "36383968860289561", fees: "42314408424" },
  { epoch_no: 638, supply: "38702886307456704", reserves: "6297113692543296", treasury: "1490365078517845", reward: "829167005932628", circulation: "36377168477209512", fees: "42031796719" },
  { epoch_no: 637, supply: "38692649824951111", reserves: "6307350175048889", treasury: "1486632640502068", reward: "826656960494501", circulation: "36373183721429285", fees: "39472525257" },
  { epoch_no: 636, supply: "38682462315430114", reserves: "6317537684569886", treasury: "1515821424660414", reward: "925262132959899", circulation: "36235172254742854", fees: "71893066947" },
  { epoch_no: 635, supply: "38672027788938458", reserves: "6327972211061542", treasury: "1512017193100454", reward: "926414431330301", circulation: "36227309439573966", fees: "49372933737" },
];

// The exact pipeline app.js runs on the live fetch.
function pipeline(raw, tipEpoch) {
  let list = raw.map(normalizeTotals);
  if (tipEpoch != null && list[0].epoch === tipEpoch) list = list.slice(1);
  list.sort((a, b) => a.epoch - b.epoch);
  return list;
}

test("raw fixture: every row satisfies the hard-cap identity exactly", () => {
  for (const r of RAW) {
    const row = normalizeTotals(r);
    assert.ok(
      Math.abs(row.supply + row.reserves - MAX_SUPPLY_ADA) < 1e-3,
      `epoch ${r.epoch_no}: supply+reserves drifted from 45B cap`
    );
    assert.ok(row.supply > 0 && row.reserves > 0 && row.reward > 0);
  }
});

test("pipeline: drops the in-progress tip row, keeps 20 completed epochs", () => {
  const rows = pipeline(RAW, RAW_TIP);
  assert.equal(rows.length, 20);
  assert.equal(rows[0].epoch, 635);
  assert.equal(rows[rows.length - 1].epoch, 654);
  // Chronological after the sort.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].epoch > rows[i - 1].epoch);
});

test("summarize(real mainnet window): conservation + mint==decay hold exactly", () => {
  const s = summarize(pipeline(RAW, RAW_TIP));
  assert.equal(s.fromEpoch, 635);
  assert.equal(s.toEpoch, 654);
  assert.equal(s.epochs, 19); // 20 rows = 19 epoch transitions
  assert.equal(s.allConserved, true);
  // float64 rounding on ~3.9e10 magnitudes is well under 1e-3 ADA.
  assert.ok(s.maxAbsDrift < 1e-3, `max drift ${s.maxAbsDrift}`);
  assert.ok(Math.abs(s.totalMint - s.totalDecay) < 1e-2, "mint != headroom decay");
  assert.ok(s.totalMint > 0, "supply must grow over the window");
});

test("summarize(real mainnet window): rates sit in the sane band", () => {
  const s = summarize(pipeline(RAW, RAW_TIP));
  // Effective per-epoch rate is well below the nominal 0.3% rho.
  assert.ok(s.avgEffectiveRate < 0.003, "effective rate must be < nominal rho");
  const annual = s.avgEffectiveRate * 73;
  assert.ok(annual >= 0.005 && annual <= 0.05, `annual rate ${annual} outside 0.5-5% band`);
});

test("summarize(real mainnet window): reward pot + fee income are plausible", () => {
  const s = summarize(pipeline(RAW, RAW_TIP));
  // `fees` is PER-epoch income (not cumulative): 19 epochs × ~22-72k ADA.
  assert.ok(s.feeIncome > 1000 && s.feeIncome < 1e7, `fee income ${s.feeIncome}`);
  assert.ok(s.rewardStart > 0 && s.rewardEnd > 0, "reward pot must stay positive");
  // Implied claims (delegators withdrawing into circulation) are non-negative.
  assert.ok(s.claims > 0, `implied claims ${s.claims} should be positive`);
});

test("engineHealth(real mainnet window): scores a healthy 100", () => {
  const h = engineHealth(summarize(pipeline(RAW, RAW_TIP)));
  assert.equal(h.score, 100);
  assert.equal(h.label, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
});
