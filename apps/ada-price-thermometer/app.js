import {
  MINS_URL,
  COINGECKO_URL,
  LLAMA_URL,
  buildSources,
  consensus,
  agreementScore,
  agreementLabel,
  trendFromChange,
  deviationPct,
  fmtUsdPrice,
  fmtPct,
  gaugeFill,
} from "./src/thermometer.js";

const $ = (id) => document.getElementById(id);

const GETS = [
  { id: "mins", url: MINS_URL },
  { id: "cg", url: COINGECKO_URL },
  { id: "llama", url: LLAMA_URL },
];

function setStatus(el, ok, text) {
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("bad", !ok);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function renderSources(rows, sources, med) {
  rows.innerHTML = sources
    .map((s) => {
      const dev = deviationPct(s.price, med);
      const price = s.ok ? fmtUsdPrice(s.price) : "failed";
      const chg = s.ok ? fmtPct(s.change24h) : "–";
      const devTxt =
        dev == null ? "–" : (dev >= 0 ? "+" : "") + dev.toFixed(3) + "%";
      const rowCls = s.ok ? "" : "row-fail";
      return `<tr class="${rowCls}">
        <td class="src">${s.label}${s.ok ? "" : ' <span class="fail">✕</span>'}</td>
        <td class="num">${price}</td>
        <td class="num">${chg}</td>
        <td class="num">${devTxt}</td>
      </tr>`;
    })
    .join("");
}

async function load() {
  const status = $("status");
  const results = await Promise.allSettled(GETS.map((g) => fetchJson(g.url)));
  const raw = { mins: null, cg: null, llama: null };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw[GETS[i].id] = r.value;
  });

  const sources = buildSources(raw);
  const okCount = sources.filter((s) => s.ok).length;

  const cons = consensus(sources);
  const score = agreementScore(cons, 3);
  const label = agreementLabel(score);
  const medChange = sources
    .map((s) => s.change24h)
    .filter((c) => typeof c === "number" && isFinite(c));
  const medChg = medChange.length
    ? medChange.slice().sort((a, b) => a - b)[Math.floor(medChange.length / 2)]
    : null;
  const trend = trendFromChange(medChg);

  // Hero
  if (cons.median != null) $("consensus-price").textContent = fmtUsdPrice(cons.median);
  else $("consensus-price").textContent = "–";
  $("consensus-sub").textContent =
    cons.n + " of 3 sources quoted · spread " +
    (cons.spreadPct == null ? "–" : cons.spreadPct.toFixed(3) + "%");

  // Gauge
  const fill = gaugeFill(score);
  const needle = $("gauge-needle");
  needle.style.setProperty("--fill", fill);
  needle.style.background =
    "linear-gradient(90deg, var(--green) 0%, var(--accent-2) " +
    Math.round(fill * 100) + "%, var(--border) " +
    Math.round(fill * 100) + "%)";
  $("gauge-score").textContent = score == null ? "–" : String(score);

  const lbl = $("consensus-label");
  lbl.textContent = label.label;
  lbl.className = "consensus-label " + label.cls;

  // Trend
  const t = $("trend");
  if (trend) {
    t.textContent = trend.label;
    t.className = "trend " + trend.cls;
  } else {
    t.textContent = "No 24h data";
    t.className = "trend flat";
  }
  $("med-change").textContent = fmtPct(medChg);

  renderSources($("src-rows"), sources, cons.median);

  setStatus(status, okCount >= 2, `updated ${new Date().toLocaleTimeString()} · ${okCount}/3 sources`);
}

load();
setInterval(() => load().catch(() => {}), 60000);
