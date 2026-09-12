"""Unit tests for the Viber UI sender adapter; no desktop or Viber access."""

from pathlib import Path
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_uia_sender import PowerShellViberSender


BRIDGE = "11111111-1111-4111-8111-111111111111"
ACCOUNT = "22222222-2222-4222-8222-222222222222"
CHAT = "33333333-3333-4333-8333-333333333333"
COMMAND = "44444444-4444-4444-8444-444444444444"
SOURCE_CHAT = "c" * 64
PEER = "d" * 64


class FakeRunner:
    def __init__(self, *, marker=None, composer=None, send=None, reconcile=None):
        self.marker = marker or {"status": "active_marker_chat_verified", "complete": True, "same_active_feed": True}
        self.composer = composer or {"status": "composer_ready", "draft_present": False}
        self.send = send or {"status": "submitted_unconfirmed", "dispatch_count": 1, "error_code": ""}
        self.reconcile = reconcile or {"status": "SUBMITTED_UNCONFIRMED", "outbound_occurrence_observed": True}
        self.calls = []

    def __call__(self, args, _timeout):
        joined = " ".join(str(part) for part in args)
        self.calls.append(joined)
        if "Verify-ActiveMarkerChat.ps1" in joined:
            return self.marker
        if "Inspect-ViberComposer.ps1" in joined:
            return self.composer
        if "Send-P1Controlled.ps1" in joined:
            return self.send
        if "verify_p1_send_reconcile_live.py" in joined:
            return self.reconcile
        raise AssertionError(f"unexpected command: {joined}")


class UiaSenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-uia-")
        self.state = Path(self.temp.name) / "bridge.sqlite"
        self.core = BridgeCore(self.state, bridge_id=BRIDGE, account_id=ACCOUNT,
                               account_epoch=1, business_context="event_genix")
        self.core.verify_source(account_ref="a" * 64, source_generation_ref="b" * 64,
                                receive_healthy=True)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT, peer_ref=PEER)
        self.core.verify_peer(chat_id=CHAT, expected_source_chat_ref=SOURCE_CHAT,
                              expected_peer_ref=PEER)

    def tearDown(self):
        self.core.close()
        self.temp.cleanup()

    def sender(self, runner):
        return PowerShellViberSender(state_path=self.state, run_id="0B038E78",
                                     runtime_dir=Path(self.temp.name), runner=runner,
                                     powershell="powershell-fixture", python_exe="python-fixture",
                                     reference_key=b"0123456789abcdef",
                                     anchor_probe=lambda: {
                                         "source_chat_ref": SOURCE_CHAT,
                                         "peer_ref": PEER,
                                         "anchor_event_id": 11,
                                         "max_event_id": 99,
                                     })

    def test_active_peer_uses_verified_binding_and_ui_probes(self):
        adapter = self.sender(FakeRunner())
        result = adapter.active_peer(CHAT)
        self.assertEqual(result["source_chat_ref"], SOURCE_CHAT)
        self.assertEqual(result["peer_ref"], PEER)
        self.assertTrue(result["account_verified"])
        self.assertEqual(result["composer_state"], "empty")

    def test_draft_or_missing_markers_block_send_preflight(self):
        adapter = self.sender(FakeRunner(
            marker={"status": "markers_not_visible", "complete": True, "same_active_feed": False},
            composer={"status": "composer_ready", "draft_present": True},
        ))
        result = adapter.active_peer(CHAT)
        self.assertFalse(result["account_verified"])
        self.assertEqual(result["composer_state"], "foreign_text")

    def test_send_text_reconciles_outbound_occurrence_without_delivery_claim(self):
        runner = FakeRunner(reconcile={"status": "SUBMITTED_UNCONFIRMED",
                                       "outbound_occurrence_observed": True,
                                       "outbound_source_event_id": 100})
        adapter = self.sender(runner)
        adapter.prepare_command({"command_id": COMMAND, "chat_id": CHAT, "text": "Привіт 🙂\nДругий рядок"})
        self.assertTrue(adapter.active_peer(CHAT)["account_verified"])
        self.assertEqual(adapter.dispatch_baseline(), 99)
        result = adapter.send_text("Привіт 🙂\nДругий рядок")
        self.assertEqual(result, {"status": "submitted_unconfirmed", "outbound_observed": True,
                                  "chat_confirmed": True,
                                  "outbound_baseline_event_id": 99,
                                  "outbound_source_event_id": 100})
        self.assertTrue(any("Send-P1Controlled.ps1" in call for call in runner.calls))
        self.assertTrue(any("verify_p1_send_reconcile_live.py" in call for call in runner.calls))
        self.assertTrue(any("--after-event-id 99" in call for call in runner.calls))

    def test_missing_reconciliation_is_unknown_not_retry(self):
        adapter = self.sender(FakeRunner(reconcile={"status": "UNKNOWN", "outbound_occurrence_observed": False}))
        adapter.prepare_command({"command_id": COMMAND, "chat_id": CHAT, "text": "hello"})
        adapter.active_peer(CHAT)
        adapter.dispatch_baseline()
        result = adapter.send_text("hello")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["error_code"], "OUTBOUND_RECONCILIATION_MISSING")

    def test_old_or_missing_active_peer_does_not_send(self):
        runner = FakeRunner()
        adapter = self.sender(runner)
        adapter.prepare_command({"command_id": COMMAND, "chat_id": CHAT, "text": "hello"})
        result = adapter.send_text("hello")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["error_code"], "ACTIVE_PEER_CHANGED_BEFORE_SEND")
        self.assertFalse(any("Send-P1Controlled.ps1" in call for call in runner.calls))

    def test_observed_peer_mismatch_blocks_active_peer(self):
        adapter = PowerShellViberSender(
            state_path=self.state,
            run_id="0B038E78",
            runtime_dir=Path(self.temp.name),
            runner=FakeRunner(),
            powershell="powershell-fixture",
            python_exe="python-fixture",
            reference_key=b"0123456789abcdef",
            anchor_probe=lambda: {
                "source_chat_ref": "e" * 64,
                "peer_ref": PEER,
                "anchor_event_id": 11,
                "max_event_id": 99,
            },
        )
        result = adapter.active_peer(CHAT)
        self.assertFalse(result["account_verified"])


if __name__ == "__main__":
    unittest.main()
