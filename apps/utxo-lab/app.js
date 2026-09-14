import * as C from "./src/coinselect.js";

const $ = (id) => document.getElementById(id);
const ADA = 10 ** 6;
const fmt = (l) => (l / ADA).toLocaleString("en-US", { maximumFractionDigits: 3 });
const fmtAda = (l) => `${(l / ADA).toLocaleString("en-US", { maximumFractionDigits: 3 })} Ada`;
const short = (h) => (h && h.length > 12 ? h.slice(0, 6) + "…" + h.slice(-4) : h || "—");

function parseInputs(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([\d.]+)(?:\s+([a-fA-F0-9]{8,})#(\d+))?/);
    if (!m) throw new Error("Bad input line: " + JSON.stringify(line));
    out.push({ lovelace: Math.round(parseFloat(m[1]) * ADA), ref: m[2] ? `${m[2]}#${m[3]}` : "" });
  }
  return out;
}

function parseOutputs(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const script = /@script/i.test(line);
    const am = line.match(/([\d.]+)/);
    if (!am) throw new Error("Bad output line: " + JSON.stringify(line));
    const coin = (line.match(/\+(\d+)/) || [])[1];
    out.push({
      lovelace: Math.round(parseFloat(am[1]) * ADA),
      assetBytes: coin ? Math.round(parseInt(coin, 10) * ADA / C.COIN_SIZE_BYTE_UNIT) : 0,
      script,
    });
  }
  return out;
}

function render() {
  const v = $("o-verdict");
  v.innerHTML = "";
  $("o-tbody").innerHTML = "";
  try {
    const utxos = parseInputs($("in-utxos").value);
    const outputs = parseOutputs($("in-outputs").value);
    if (!utxos.length || !outputs.length) {
      $("o-tbody").innerHTML =
        '<tr><td colspan="5" style="padding:14px;color:var(--muted)">Add some inputs and outputs above.</td></tr>';
      return;
    }
    const plan = C.planTransfer(utxos, outputs, {
      strategy: $("sel-strategy").value,
      foldChange: $("chk-fold").checked,
    });

    const setAfter = C.utxoSetSize(utxos.length - plan.inputs.length + plan.outputs.length);
    $("o-in").textContent = fmtAda(plan.inputs.reduce((s, u) => s + u.lovelace, 0));
    $("o-out").textContent = fmtAda(plan.outputs.reduce((s, o) => s + o.lovelace, 0));
    $("o-change").textContent = plan.changeLovelace ? fmtAda(plan.changeLovelace) : "—";
    $("o-fee").textContent = `${plan.feeLovelace.toLocaleString("en-US")} µAda`;
    $("o-bytes").textContent = plan.bytes.toLocaleString("en-US");

    let rows = "";
    plan.inputs.forEach((u, i) => {
      rows += `<tr><td class="c-mono">in ${i + 1}</td><td>Spend</td><td class="c-mono">${fmt(u.lovelace)}</td><td>—</td><td class="c-mono">${short(u.ref)}</td></tr>`;
    });
    plan.outputs.forEach((o, i) => {
      const role = plan.changeLovelace && o === plan.outputs[plan.outputs.length - 1] && i === plan.outputs.length - 1 && o.lovelace === plan.changeLovelace ? "Change" : "Output";
      const minL = C.minOutputLovelace(o.assetBytes || 0);
      const ok = o.lovelace >= minL;
      rows += `<tr><td class="c-mono">out ${i + 1}</td><td>${role}${o.script ? " 📜" : ""}</td><td class="c-mono">${fmt(o.lovelace)}</td><td class="c-mono" style="color:${ok ? "var(--green)" : "var(--red)"}">min ${fmt(minL)}${o.assetBytes ? ` (+${o.assetBytes} B)` : ""}</td><td>—</td></tr>`;
    });
    $("o-tbody").innerHTML = rows;

    const notes = [];
    if (plan.foldNote) notes.push(plan.foldNote);
    if (setAfter !== null) notes.push(`UTxO set after: ${setAfter.toLocaleString("en-US")} / ${C.UTXO_SET_LIMIT.toLocaleString("en-US")}`);
    v.className = "verdict ok";
    v.innerHTML = `✅ Valid plan — balances exactly (in = out + fee). ${notes.join(" · ")}`;
  } catch (e) {
    v.className = "verdict bad";
    v.innerHTML = `⚠️ <span class="c-mono">${e.message || e}</span>`;
  }
}

[
  $("in-utxos"),
  $("in-outputs"),
  $("sel-strategy"),
  $("chk-fold"),
].forEach((el) => el.addEventListener("input", render));

// sensible defaults so the page is alive on load
$("in-utxos").value =
  "50.0 a0f3c2e1b4…#0\n100.0\n25.5 cafef00d91…#3\n10.2";
$("in-outputs").value = "120.0\n42.5 +8\n3.0 @script";
render();
