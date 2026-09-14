// app.js — Midnight DID Wallet UI.
// 100% local: builds and inspects did:midnight identities entirely in the
// browser using the same codec the unit tests exercise. No network calls.
import {
  encodeState,
  makeOffchainDid,
  parseDid,
  resolveDid,
  projectDocument,
  LEDGER_NETWORKS,
  RELATIONSHIPS,
  KEY_PROFILES,
} from "./src/midnight-did.js";

const $ = (id) => document.getElementById(id);
const CRVES = ["Ed25519", "X25519", "Jubjub", "P-256", "secp256k1", "BLS12381G1", "BLS12381G2"];

// --- base64url helpers (browser) -------------------------------------------
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function toB64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// Curve -> { kty, xBytes, yBytes (0 = none), demoable }
function curveMeta(crv) {
  for (const [k, p] of Object.entries(KEY_PROFILES)) {
    if (p.crv === crv) return { kty: p.kty, xBytes: p.xBytes, yBytes: p.yBytes || 0, kind: Number(k) };
  }
  return null;
}

// --- demo key generation ----------------------------------------------------
// Honest policy: Ed25519 uses real WebCrypto (a genuine key); the other curves
// are not all supported by browser SubtleCrypto, so we fill with random bytes
// and LABEL them as demo material. The wallet can encode any of them; only
// WebCrypto-backed keys can actually sign in-page (out of scope here).
async function generateDemoKey(crv) {
  const m = curveMeta(crv);
  if (!m) return { x: "", y: "", demo: true, note: "unknown curve" };
  const subtle = crypto.subtle;
  if (crv === "Ed25519" && subtle && subtle.generateKey) {
    try {
      const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
      const pub = await subtle.exportKey("jwk", pair.publicKey);
      return { x: pub.x, y: "", demo: false, note: "real Ed25519 keypair (WebCrypto)" };
    } catch (_) {
      /* fall through to random demo */
    }
  }
  const x = toB64url(randomBytes(m.xBytes));
  const y = m.yBytes ? toB64url(randomBytes(m.yBytes)) : "";
  const demo = crv === "Ed25519" ? "random placeholder (not a real keypair)" : "demo material (encode-only)";
  return { x, y, demo: true, note: demo };
}

// --- form state -------------------------------------------------------------
const form = {
  aka: ["https://example.org/holders/alice"],
  curve: "Ed25519",
  kid: "#holder-key-1",
  x: "",
  y: "",
  rel: Object.fromEntries(RELATIONSHIPS.map((r) => [r, false])),
  svcs: [],
};

function renderAka() {
  const list = $("aka-list");
  list.innerHTML = "";
  form.aka.forEach((val, i) => {
    const row = document.createElement("div");
    row.className = "aka-row";
    const inp = document.createElement("input");
    inp.value = val;
    inp.spellcheck = false;
    inp.addEventListener("input", () => (form.aka[i] = inp.value));
    const del = document.createElement("button");
    del.className = "aka-del";
    del.textContent = "×";
    del.addEventListener("click", () => {
      form.aka.splice(i, 1);
      renderAka();
    });
    row.appendChild(inp);
    row.appendChild(del);
    list.appendChild(row);
  });
}
function renderRel() {
  const box = $("relops");
  box.innerHTML = "";
  for (const r of RELATIONSHIPS) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = form.rel[r];
    cb.addEventListener("change", () => (form.rel[r] = cb.checked));
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(r));
    box.appendChild(lab);
  }
}
function renderSvc() {
  const list = $("svc-list");
  list.innerHTML = "";
  form.svcs.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "svc-row";
    const mk = (key, ph) => {
      const inp = document.createElement("input");
      inp.value = s[key] || "";
      inp.placeholder = ph;
      inp.spellcheck = false;
      inp.addEventListener("input", () => (s[key] = inp.value));
      return inp;
    };
    row.appendChild(mk("id", "#id"));
    row.appendChild(mk("type", "type"));
    row.appendChild(mk("serviceEndpoint", "endpoint"));
    list.appendChild(row);
  });
}
function curveChanged() {
  form.curve = $("f-curve").value;
  const m = curveMeta(form.curve);
  const yWrap = $("y-wrap");
  if (m && m.yBytes) {
    yWrap.style.display = "";
    $("f-y").disabled = false;
  } else {
    yWrap.style.display = "none";
    $("f-y").disabled = true;
    form.y = "";
  }
  $("x-hint").textContent = m ? `${m.kty} · ${m.xBytes}-byte x${m.yBytes ? ` + ${m.yBytes}-byte y` : " · no y"}` : "";
}
function syncFromDom() {
  form.curve = $("f-curve").value;
  form.kid = $("f-kid").value.trim();
  form.x = $("f-x").value.trim();
  form.y = $("f-y").value.trim();
}

function currentState() {
  syncFromDom();
  const aka = form.aka.map((a) => a.trim()).filter(Boolean).slice(0, 4);
  const rels = {};
  for (const r of RELATIONSHIPS) rels[r] = !!form.rel[r];
  const svcs = form.svcs
    .filter((s) => (s.id || "").trim() && (s.type || "").trim() && (s.serviceEndpoint || "").trim())
    .slice(0, 4)
    .map((s) => ({ id: s.id.trim(), type: s.type.trim(), serviceEndpoint: s.serviceEndpoint.trim() }));
  return {
    version: 1,
    alsoKnownAs: aka,
    verificationMethod: [
      {
        id: form.kid,
        publicKeyJwk: { kty: curveMeta(form.curve).kty, crv: form.curve, x: form.x, ...(form.y ? { y: form.y } : {}) },
        relationships: rels,
      },
    ],
    service: svcs,
  };
}

function verdict(el, cls, html) {
  el.className = "verdict " + cls;
  el.innerHTML = html;
}

function build() {
  const v = $("verdict");
  try {
    if (!form.kid.startsWith("#")) throw new Error("key id must start with '#'");
    if (!form.x) throw new Error("publicKeyJwk.x is required");
    const state = currentState();
    const long = makeOffchainDid(state, { long: true });
    const hash = long.split(":")[3];
    const doc = projectDocument(long, parseDid(long).state);
    $("out-did").textContent = long;
    $("out-did").classList.remove("empty");
    $("out-hash").textContent = "state hash (BLAKE2s-256): " + hash;
    $("out-doc").textContent = JSON.stringify(doc, null, 2);
    verdict(v, "ok", `✓ Built — hash <code>${hash}</code> recomputes from the embedded state.`);
    $("build-meta").textContent = `payload ${(long.length - 22 - hash.length - 1)} chars · ${state.alsoKnownAs.length} aka · ${state.service.length} svc`;
  } catch (e) {
    verdict(v, "bad", `✗ ${e.message}`);
  }
}

function clearForm() {
  form.aka = [""];
  form.kid = "#key-1";
  form.x = "";
  form.y = "";
  form.svcs = [];
  form.rel = Object.fromEntries(RELATIONSHIPS.map((r) => [r, false]));
  renderAka();
  renderRel();
  renderSvc();
  $("f-kid").value = form.kid;
  $("f-x").value = "";
  $("f-y").value = "";
  curveChanged();
  $("verdict").className = "verdict mut";
  $("verdict").textContent = "Cleared.";
  $("out-did").textContent = "— build one —";
  $("out-did").classList.add("empty");
  $("out-doc").textContent = "{ }";
  $("out-hash").textContent = "";
  $("build-meta").textContent = "";
}

function loadSpec() {
  form.aka = ["https://example.org/holders/alice"];
  form.curve = "Jubjub";
  form.kid = "#holder-key-1";
  form.rel = Object.fromEntries(
    RELATIONSHIPS.map((r) => [r, r === "authentication" || r === "assertionMethod"])
  );
  form.svcs = [{ id: "#profile", type: "LinkedDomains", serviceEndpoint: "https://example.org/profile/alice" }];
  renderAka();
  renderRel();
  renderSvc();
  $("f-curve").value = "Jubjub";
  $("f-kid").value = form.kid;
  $("f-x").value = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  $("f-y").value = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
  curveChanged();
  build();
  // scroll to the built DID
  $("out-did").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function randomIdentity() {
  syncFromDom();
  const k = await generateDemoKey(form.curve);
  form.x = k.x;
  form.y = k.y;
  $("f-x").value = k.x;
  $("f-y").value = k.y;
  if (!form.kid) {
    form.kid = "#key-1";
    $("f-kid").value = "#key-1";
  }
  if (!form.aka[0]) form.aka[0] = "https://example.org/holders/" + Math.random().toString(36).slice(2, 10);
  renderAka();
  $("x-hint").textContent = k.note;
  build();
}

function inspect() {
  const out = $("inspect-out");
  const raw = $("inspect-in").value.trim();
  out.innerHTML = "";
  if (!raw) return;
  try {
    const p = parseDid(raw);
    const box = document.createElement("div");
    let head;
    if (p.kind === "offchain" && p.form === "long") head = `✓ valid long offchain DID — hash verified`;
    else if (p.kind === "offchain") head = `✓ valid short offchain DID (hash ${p.hash})`;
    else head = `✓ valid ledger DID on ${p.network}`;
    box.innerHTML = `<div class="verdict ok">${head}</div>`;
    const kv = document.createElement("div");
    kv.className = "kv";
    const put = (k, v) => {
      const a = document.createElement("span");
      a.className = "k";
      a.textContent = k;
      const b = document.createElement("span");
      b.className = "v";
      b.textContent = v;
      kv.appendChild(a);
      kv.appendChild(b);
    };
    put("kind", p.kind + (p.form ? " · " + p.form : ""));
    if (p.kind === "ledger") {
      put("network", p.network);
      put("contractId", p.contractId);
    } else {
      put("hash", p.hash);
      if (p.form === "long") put("state", "embedded & hash-verified");
    }
    box.appendChild(kv);
    if (p.state) {
      const doc = projectDocument(p.subject, p.state);
      const pre = document.createElement("pre");
      pre.className = "doc";
      pre.style.marginTop = "12px";
      pre.textContent = JSON.stringify(doc, null, 2);
      box.appendChild(pre);
    }
    out.appendChild(box);
  } catch (e) {
    out.innerHTML = `<div class="verdict bad">✗ ${e.message}</div>`;
  }
}

// --- wire up ----------------------------------------------------------------
$("add-aka").addEventListener("click", () => {
  if (form.aka.length < 4) {
    form.aka.push("");
    renderAka();
  }
});
$("add-svc").addEventListener("click", () => {
  if (form.svcs.length < 4) {
    form.svcs.push({ id: "", type: "", serviceEndpoint: "" });
    renderSvc();
  }
});
$("f-curve").addEventListener("change", curveChanged);
$("gen-key").addEventListener("click", randomIdentity);
$("btn-build").addEventListener("click", build);
$("btn-spec").addEventListener("click", loadSpec);
$("btn-random").addEventListener("click", randomIdentity);
$("btn-clear").addEventListener("click", clearForm);
$("btn-inspect").addEventListener("click", inspect);
$("copy-did").addEventListener("click", async () => {
  const t = $("out-did").textContent;
  if (t === "— build one —") return;
  try {
    await navigator.clipboard.writeText(t);
    $("copy-did").textContent = "Copied!";
    setTimeout(() => ($("copy-did").textContent = "Copy DID"), 1500);
  } catch (_) {}
});

// init
renderAka();
renderRel();
renderSvc();
curveChanged();
