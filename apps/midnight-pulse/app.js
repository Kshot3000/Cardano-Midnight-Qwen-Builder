/* Midnight Pulse — live Midnight mainnet dashboard.
   Data: NightForge public explorer API (CORS-enabled, no auth).
   Endpoints used:
     GET /api/health                 -> service status
     GET /api/analytics/overview     -> blocks, tps, shielded ratio, events...
     GET /api/blocks?limit=N         -> latest blocks
   Refresh interval: 60s. All failures degrade gracefully.
   Rendering uses src/pulse.js view-models + textContent throughout: API
   strings are third-party data and are never interpolated into HTML markup
   (the old version did exactly that, so a "<" or quote in an event name or
   block field would have become live markup in the page). */
import { statsView, eventRows, blockRows } from "./src/pulse.js";

const API = "https://mainnet.nightforge.jp/api";
const REFRESH_MS = 60000;

function setPill(state, text) {
  const dot = document.getElementById("live-dot");
  const txt = document.getElementById("live-text");
  if (dot) dot.className = "dot" + (state === "live" ? "" : " stale");
  if (txt) txt.textContent = text;
}

function statTile(it) {
  const stat = document.createElement("div");
  stat.className = "stat";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = it.label;
  const value = document.createElement("div");
  value.className = "value";
  value.textContent = it.value;
  stat.append(label, value);
  return stat;
}

function emptyNote(text) {
  const div = document.createElement("div");
  div.className = "section-sub";
  div.textContent = text;
  return div;
}

function renderStats(o) {
  const el = document.getElementById("stats");
  if (el) el.replaceChildren(...statsView(o).map(statTile));
}

function renderEvents(events) {
  const el = document.getElementById("events");
  if (!el) return;
  const rows = eventRows(events);
  if (!rows.length) { el.replaceChildren(emptyNote("no data")); return; }
  el.replaceChildren(...rows.map((row) => {
    const wrap = document.createElement("div");
    wrap.className = "bar-row";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = row.name;
    name.title = row.name;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = row.pct + "%";
    track.appendChild(fill);
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = row.countLabel;
    wrap.append(name, track, num);
    return wrap;
  }));
}

function renderBlocks(blocks) {
  const el = document.getElementById("blocks");
  if (!el) return;
  const rows = blockRows(blocks);
  if (!rows.length) { el.replaceChildren(emptyNote("no blocks yet")); return; }
  el.replaceChildren(...rows.map((row) => {
    const wrap = document.createElement("div");
    wrap.className = "block-row";
    const parts = [["h", row.height], ["hash", row.hash], ["time", row.time], ["ext", row.ext]];
    for (const [cls, text] of parts) {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      wrap.appendChild(span);
    }
    return wrap;
  }));
}

function fetchJson(url) {
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

function load() {
  setPill("stale", "refreshing…");
  Promise.all([
    fetchJson(API + "/analytics/overview"),
    fetchJson(API + "/blocks?limit=8"),
    fetchJson(API + "/health"),
  ]).then(([overview, blocks, health]) => {
    if (overview) {
      renderStats(overview);
      renderEvents(overview.eventBreakdown);
      const age = health && health.network ? health.network : (overview.network || "Midnight Mainnet");
      setPill("live", "live · " + age + " · " + new Date().toLocaleTimeString());
    } else {
      setPill("stale", "API unreachable — retrying in 60s");
    }
    if (blocks) renderBlocks(blocks);
  });
}

load();
setInterval(load, REFRESH_MS);
