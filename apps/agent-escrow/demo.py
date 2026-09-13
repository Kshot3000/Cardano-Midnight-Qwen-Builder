#!/usr/bin/env python3
"""Agent Escrow Protocol — Python demo walkthrough.

Run: python apps/agent-escrow/demo.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from escrow import Escrow, Milestone  # noqa: E402

L = 1_000_000
T0 = 1_700_000_000


def log(e, note=""):
    a = e.audit()[-1]
    data = "  " + str(a.data) if a.data else ""
    print(f"  [{a.seq}] {a.type:<22} actor={a.actor:<14} "
          f"{a.state_before} -> {a.state_after}{data}  # {note}")


print("=== Agent Escrow Protocol — demo walkthrough ===\n")

e = Escrow(
    client="alice-addr",
    agent="builder-agent",
    approvers=["charlie-auditor"],
    milestones=[
        Milestone(id="m1", description="Repo scaffold + CI", amount=1 * L, deadline=T0 + 86_400),
        Milestone(id="m2", description="Working app + tests", amount=4 * L, deadline=T0 + 2 * 86_400),
        Milestone(id="m3", description="On-chain audit + docs", amount=5 * L, deadline=T0 + 3 * 86_400),
    ],
    escrow_id="escrow_demo",
    now=lambda: T0,
)

print("1) Alice creates an escrow for a builder agent: 3 milestones, 10 ADA budget.")
print("2) She funds it — 10 ADA (10,000,000 lovelace).")
e.fund(10 * L, now=T0 + 10); log(e)

print("\n3) Work starts.")
e.start(now=T0 + 20); log(e)

print("\n4) Milestone 1: the agent submits its proof hash.")
e.submit_proof("m1", "0x9f2c41ab", now=T0 + 3_600); log(e)
print("5) The auditor verifies the repo scaffold and releases m1 (1 ADA).")
e.approve("m1", "charlie-auditor", now=T0 + 3_660); log(e)

print("\n6) Milestone 2: submitted — but the auditor finds the tests missing.")
e.submit_proof("m2", "0x41b0de77", now=T0 + 86_400); log(e)
print("7) Auditor rejects m2 — funds stay escrowed.")
e.reject("m2", "charlie-auditor", "tests missing — CI red", now=T0 + 86_460); log(e)

print("\n8) Milestone 3: submitted and approved by the client (a registered approver).")
e.submit_proof("m3", "0xaa011b3c", now=T0 + 172_800); log(e)
e.approve("m3", "alice-addr", now=T0 + 172_860); log(e)

print("\n9) All milestones decided -> settle refunds the unspent remainder.")
e.settle(now=T0 + 172_900); log(e)

statuses = {m.id: m.status for m in e.milestones()}
released = sum(m.amount for m in e.milestones() if m.status == "released")
print(f"\nMilestones: {statuses}")
print(f"Final state: {e.state} | released: {released // L} ADA")
assert e.assert_invariants()
print("Invariants OK: released + refunded == funded, audit seqs monotonic.")

print("\n=== Security check: the agent tries to approve its own work ===")
e2 = Escrow(
    client="alice-addr",
    agent="builder-agent",
    milestones=[Milestone(id="m1", description="mvp", amount=1 * L, deadline=T0 + 86_400)],
    escrow_id="escrow_sec",
    now=lambda: T0,
)
e2.fund(1 * L, now=T0 + 1)
e2.start(now=T0 + 2)
e2.submit_proof("m1", "0xdeadbeef", now=T0 + 3)
try:
    e2.approve("m1", "builder-agent", now=T0 + 4)
    print("UNEXPECTED: self-approval succeeded (BUG)")
    sys.exit(1)
except Exception as err:  # EscrowError
    print(f"Blocked as designed: {err.code} — {err}")
print("\nDone. Separation of duties holds: the agent earns, a human releases.")
