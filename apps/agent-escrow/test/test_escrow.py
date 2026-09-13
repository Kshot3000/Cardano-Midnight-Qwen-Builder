"""Agent Escrow Protocol — Python test suite.

Run: python -m unittest discover -s apps/agent-escrow/test
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from escrow import (  # noqa: E402
    CANCELLED,
    CREATED,
    DISPUTED,
    FUNDED,
    IN_PROGRESS,
    REJECTED,
    RELEASED,
    SETTLED,
    REFUNDED,
    Escrow,
    EscrowError,
    Milestone,
)

T0 = 1_700_000_000
L = 1_000_000  # 1 ADA in lovelace


def standard_escrow():
    return Escrow(
        client="client-addr",
        agent="agent-addr",
        approvers=["auditor-addr"],
        milestones=[
            Milestone(id="m1", description="Scaffold", amount=2 * L, deadline=T0 + 1000),
            Milestone(id="m2", description="MVP", amount=3 * L, deadline=T0 + 2000),
            Milestone(id="m3", description="Hardening", amount=5 * L, deadline=T0 + 3000),
        ],
        escrow_id="escrow-test",
        now=lambda: T0,
    )


class EscrowTest(unittest.TestCase):
    def assertCode(self, code, exc):
        self.assertEqual(exc.code, code, f"expected {code}, got {exc.code}")

    # -- happy path ------------------------------------------------------

    def test_full_happy_path(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.approve("m1", "auditor-addr", now=T0 + 11)
        e.submit_proof("m2", "0x1234abcd", now=T0 + 12)
        e.approve("m2", "client-addr", now=T0 + 13)
        e.submit_proof("m3", "0xfedcba98", now=T0 + 14)
        e.approve("m3", "auditor-addr", now=T0 + 15)
        e.settle(now=T0 + 16)

        self.assertEqual(e.state, SETTLED)
        self.assertEqual(e.balance, 0)
        ms = {m.id: m for m in e.milestones()}
        for mid in ("m1", "m2", "m3"):
            self.assertEqual(ms[mid].status, RELEASED)
        self.assertTrue(e.assert_invariants())
        self.assertEqual(len(e.audit()), 9)

    def test_audit_is_monotonic(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.dispute("oops", now=T0 + 3)
        e.resolve_dispute("resume", now=T0 + 4)
        audit = e.audit()
        self.assertEqual(
            [ev.type for ev in audit],
            ["funded", "started", "disputed", "dispute_resolved_resume"],
        )
        self.assertEqual([ev.seq for ev in audit], [1, 2, 3, 4])
        self.assertEqual(audit[0].state_before, CREATED)
        self.assertEqual(audit[0].state_after, FUNDED)
        self.assertEqual(audit[2].state_before, IN_PROGRESS)
        self.assertEqual(audit[2].state_after, DISPUTED)

    # -- separation of duties --------------------------------------------

    def test_agent_cannot_approve_own_work(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        with self.assertRaises(EscrowError) as ctx:
            e.approve("m1", "agent-addr", now=T0 + 11)
        self.assertCode("SELF_APPROVAL", ctx.exception)

    def test_unregistered_approver_rejected(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        with self.assertRaises(EscrowError) as ctx:
            e.approve("m1", "stranger-addr", now=T0 + 11)
        self.assertCode("NOT_APPROVER", ctx.exception)

    def test_approve_before_proof_rejected(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        with self.assertRaises(EscrowError) as ctx:
            e.approve("m1", "auditor-addr", now=T0 + 10)
        self.assertCode("NO_PROOF", ctx.exception)

    def test_only_agent_submits_proofs(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        with self.assertRaises(EscrowError) as ctx:
            e.submit_proof("m1", "0xabcdef12", by="client-addr", now=T0 + 10)
        self.assertCode("FORBIDDEN", ctx.exception)

    def test_malformed_proof_hash_rejected(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        for bad in ("", "nothex", "0x12", "zzzzzzzz"):
            with self.assertRaises(EscrowError) as ctx:
                e.submit_proof("m1", bad, now=T0 + 10)
            self.assertCode("BAD_PROOF", ctx.exception)

    # -- rejection & settlement -------------------------------------------

    def test_reject_keeps_funds_escrowed(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.reject("m1", "auditor-addr", "proof does not match commitment", now=T0 + 11)
        m1 = next(m for m in e.milestones() if m.id == "m1")
        self.assertEqual(m1.status, REJECTED)
        self.assertEqual(m1.reason, "proof does not match commitment")
        self.assertEqual(e.balance, 10 * L)
        with self.assertRaises(EscrowError) as ctx:
            e.approve("m1", "auditor-addr", now=T0 + 12)
        self.assertCode("NO_PROOF", ctx.exception)

    def test_settle_refunds_leftover(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.approve("m1", "auditor-addr", now=T0 + 11)
        e.submit_proof("m2", "0x1234abcd", now=T0 + 12)
        e.reject("m2", "auditor-addr", "incomplete", now=T0 + 13)
        e.submit_proof("m3", "0xfedcba98", now=T0 + 14)
        e.reject("m3", "client-addr", "scope change", now=T0 + 15)
        e.settle(now=T0 + 16)
        self.assertEqual(e.state, SETTLED)
        self.assertEqual(e.audit()[-1].data["refund"], 8 * L)
        self.assertEqual(e.balance, 0)
        self.assertTrue(e.assert_invariants())

    def test_settle_blocked_with_open_milestones(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.approve("m1", "auditor-addr", now=T0 + 11)
        with self.assertRaises(EscrowError) as ctx:
            e.settle(now=T0 + 12)
        self.assertCode("MILESTONES_OPEN", ctx.exception)

    # -- disputes ----------------------------------------------------------

    def test_dispute_freezes_then_resume(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.dispute("agent went quiet", now=T0 + 11)
        self.assertEqual(e.state, DISPUTED)
        with self.assertRaises(EscrowError) as ctx:
            e.approve("m1", "auditor-addr", now=T0 + 12)
        self.assertCode("INVALID_STATE", ctx.exception)
        e.resolve_dispute("resume", now=T0 + 13)
        self.assertEqual(e.state, IN_PROGRESS)
        e.approve("m1", "auditor-addr", now=T0 + 14)
        self.assertEqual(
            next(m for m in e.milestones() if m.id == "m1").status, RELEASED
        )

    def test_dispute_refund(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.approve("m1", "auditor-addr", now=T0 + 11)
        e.dispute("not worth continuing", now=T0 + 12)
        e.resolve_dispute("refund", now=T0 + 13)
        self.assertEqual(e.state, REFUNDED)
        self.assertEqual(e.audit()[-1].data["refund"], 8 * L)
        self.assertEqual(e.balance, 0)
        self.assertTrue(e.assert_invariants())

    def test_only_client_disputes_or_cancels(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        with self.assertRaises(EscrowError) as ctx:
            e.dispute("bad", by="agent-addr", now=T0 + 2)
        self.assertCode("FORBIDDEN", ctx.exception)
        with self.assertRaises(EscrowError) as ctx:
            e.cancel(by="agent-addr", now=T0 + 2)
        self.assertCode("FORBIDDEN", ctx.exception)

    def test_cancel_refunds_deposit(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.cancel(now=T0 + 2)
        self.assertEqual(e.state, CANCELLED)
        self.assertEqual(e.audit()[-1].data["refund"], 10 * L)
        self.assertEqual(e.balance, 0)

    def test_cancel_blocked_after_start(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        with self.assertRaises(EscrowError) as ctx:
            e.cancel(now=T0 + 3)
        self.assertCode("INVALID_STATE", ctx.exception)

    # -- config validation --------------------------------------------------

    def test_over_allocated_start_rejected(self):
        e = standard_escrow()
        e._milestones[2] = Milestone(id="m3", description="Hardening", amount=100 * L, deadline=T0 + 3000)
        e.fund(10 * L, now=T0 + 1)
        with self.assertRaises(EscrowError) as ctx:
            e.start(now=T0 + 2)
        self.assertCode("OVER_ALLOCATED", ctx.exception)

    def test_start_with_no_milestones_rejected(self):
        e = Escrow(client="c", agent="a", milestones=[], now=lambda: T0)
        e.fund(1 * L, now=T0 + 1)
        with self.assertRaises(EscrowError) as ctx:
            e.start(now=T0 + 2)
        self.assertCode("NO_MILESTONES", ctx.exception)

    def test_double_fund_rejected(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        with self.assertRaises(EscrowError) as ctx:
            e.fund(5 * L, now=T0 + 2)
        self.assertCode("INVALID_STATE", ctx.exception)

    def test_client_agent_must_differ(self):
        with self.assertRaises(EscrowError) as ctx:
            Escrow(client="same", agent="same", now=lambda: T0)
        self.assertCode("BAD_CONFIG", ctx.exception)

    def test_late_approval_flagged(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        e.submit_proof("m1", "0xabcdef12", now=T0 + 10)
        e.approve("m1", "auditor-addr", now=T0 + 5000)  # after deadline T0+1000
        m1 = next(m for m in e.milestones() if m.id == "m1")
        self.assertEqual(m1.status, RELEASED)
        self.assertTrue(m1.late)

    def test_bad_amounts_rejected(self):
        e = standard_escrow()
        for bad in (-1, 0, 1.5, "10", None):
            with self.assertRaises(EscrowError) as ctx:
                e.fund(bad, now=T0 + 1)
            self.assertCode("BAD_AMOUNT", ctx.exception)

    def test_unknown_milestone_rejected(self):
        e = standard_escrow()
        e.fund(10 * L, now=T0 + 1)
        e.start(now=T0 + 2)
        with self.assertRaises(EscrowError) as ctx:
            e.submit_proof("nope", "0xabcdef12", now=T0 + 10)
        self.assertCode("UNKNOWN_MILESTONE", ctx.exception)


if __name__ == "__main__":
    unittest.main()
