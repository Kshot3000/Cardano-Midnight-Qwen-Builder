/* AgentProof — browser entry point.
 *
 * Runs the same pure `proofs.js` module that the unit tests use, entirely
 * client-side: no network, no server, nothing leaves the page. The demo
 * receipt is produced by driving the real agent-escrow state machine —
 * the exact walkthrough the E2E tests verify.
 */
import { verifyReceipt, summarize, escrowBalance } from "./src/proofs.js";
import { createEscrow } from "../agent-escrow/src/escrow.js";

const L = 1_000_000;
const T0 = 1_700_000_000;
const P1 = "0x9f2c41ab";
const P2 = "0x41b0de77";
const P3 = "0xaa011b3c";

/** Drive the real escrow state machine and export its receipt, exactly as
 *  the E2E tests do — the demo is a genuine artifact, not a fixture. */
function demoReceiptFromEscrow() {
  const e = createEscrow({
    id: "escrow_demo",
    client: "alice-addr",
    agent: "builder-agent",
    approvers: ["charlie-auditor"],
    milestones: [
      { id: "m1", description: "Repo scaffold + CI", amount: 1 * L },
      { id: "m2", description: "Working app + tests", amount: 4 * L },
      { id: "m3", description: "On-chain audit + docs", amount: 5 * L },
    ],
    now: T0,
  });
  e.fund(10 * L, { at: T0 + 10 });
  e.start({ at: T0 + 20 });
  e.submitProof("m1", P1, { at: T0 + 3_600 });
  e.approve("m1", "charlie-auditor", { at: T0 + 3_660 });
  e.submitProof("m2", P2, { at: T0 + 86_400 });
  e.reject("m2", "charlie-auditor", "tests missing — CI red", { at: T0 + 86_460 });
  e.submitProof("m3", P3, { at: T0 + 172_800 });
  e.approve("m3", "alice-addr", { at: T0 + 172_860 });
  e.settle({ at: T0 + 172_900 });
  e.assertInvariants();

  return {
    id: e.id,
    client: e.client,
    agent: e.agent,
    approvers: e.getApprovers(),
    state: e.getState(),
    funded: e.funded,
    released: e.released,
    refunded: e.refunded,
    milestones: e.getMilestones().map((m) => ({
      id: m.id,
      description: m.description,
      amount: m.amount,
      status: m.status,
      proofHash: m.proofHash ?? null,
      approvedBy: m.approvedBy ?? null,
      rejectedBy: m.rejectedBy ?? null,
      reason: m.reason ?? null,
    })),
    commits: Object.fromEntries(
      e.getMilestones().map((m) => [m.id, m.proofHash]).filter(([, h]) => h)
    ),
    audit: e.getAudit().map((ev) => ({ ...ev, data: { ...ev.data } })),
  };
}

const $ = (id) => document.getElementById(id);
const input = $("input");
const checksEl = $("checks");
const verdictEl = $("verdict");
const metaEl = $("meta");

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

function ada(lovelace) {
  if (lovelace == null) return "—";
  return (lovelace / L).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " ADA";
}

function renderReport(report, receipt) {
  verdictEl.className = "verdict " + (report.valid ? "ok" : "bad");
  verdictEl.textContent =
    (report.valid ? "✓ " : "✗ ") + summarize(report) +
    (report.receiptId ? "  ·  " + report.receiptId : "");

  checksEl.innerHTML = report.checks
    .map((c) => {
      const ico = c.pass ? "ok" : "bad";
      const sym = c.pass ? "✓" : "✗";
      const skip = c.detail.startsWith("skipped") ? "skip" : null;
      return (
        '<div class="check-row">' +
        '<div class="check-ico ' + (skip || ico) + '">' + (skip ? "–" : sym) + "</div>" +
        "<div>" +
        '<div class="check-name">' + escapeHtml(c.id) + "</div>" +
        '<div class="check-detail">' + escapeHtml(c.detail) + "</div>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");

  if (receipt) {
    const bal = escrowBalance(receipt);
    metaEl.innerHTML =
      "state <b>" + escapeHtml(receipt.state) + "</b> · funded <b>" + ada(receipt.funded) +
      "</b> · released <b>" + ada(receipt.released) + "</b> · refunded <b>" + ada(receipt.refunded) +
      "</b> · escrowed <b>" + ada(bal) + "</b> · " + receipt.audit.length + " audit events";
  } else {
    metaEl.textContent = "";
  }
}

async function handleVerify() {
  const text = input.value.trim();
  if (!text) {
    verdictEl.className = "verdict bad";
    verdictEl.textContent = "✗ Paste a receipt (or load the demo) first.";
    checksEl.innerHTML = "";
    metaEl.textContent = "";
    return;
  }
  let parsed = text;
  try {
    parsed = JSON.parse(text); // object input is passed through as-is
  } catch {
    /* not a JSON string — pass the raw string to verifyReceipt, whose
       structure check will report "not valid JSON" */
  }
  try {
    const report = await verifyReceipt(parsed);
    renderReport(report, report.receipt);
  } catch (err) {
    verdictEl.className = "verdict bad";
    verdictEl.textContent = "✗ " + (err && err.message ? err.message : String(err));
    checksEl.innerHTML = "";
    metaEl.textContent = "";
  }
}

$("verify").addEventListener("click", handleVerify);
$("load-sample").addEventListener("click", () => {
  input.value = JSON.stringify(demoReceiptFromEscrow(), null, 2);
  handleVerify();
});
$("clear").addEventListener("click", () => {
  input.value = "";
  verdictEl.className = "verdict bad";
  verdictEl.textContent = "Awaiting a receipt…";
  checksEl.innerHTML = "";
  metaEl.textContent = "";
});

// Start with the real demo so the page is live on load.
$("load-sample").click();
