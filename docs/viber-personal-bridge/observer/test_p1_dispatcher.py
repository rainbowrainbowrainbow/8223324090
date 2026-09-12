"""Synthetic safe-dispatch tests; no desktop or Viber access."""

from pathlib import Path
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_dispatcher import DispatcherError, execute_text


BRIDGE = "11111111-1111-4111-8111-111111111111"
ACCOUNT = "22222222-2222-4222-8222-222222222222"
CHAT = "33333333-3333-4333-8333-333333333333"
COMMAND = "44444444-4444-4444-8444-444444444444"
REQUEST = "55555555-5555-4555-8555-555555555555"
SOURCE_CHAT = "c" * 64
PEER = "d" * 64


def command(**changes):
    value = {
        "command_id": COMMAND,
        "client_request_id": REQUEST,
        "bridge_id": BRIDGE,
        "account_id": ACCOUNT,
        "account_epoch": 1,
        "business_context": "event_genix",
        "chat_id": CHAT,
        "binding_revision": 2,
        "text": "Synthetic dispatcher text",
    }
    value.update(changes)
    return value


class FakeAdapter:
    def __init__(self, *, source_chat_ref=SOURCE_CHAT, peer_ref=PEER,
                 result=None, active_error=None, send_error=None):
        self.source_chat_ref = source_chat_ref
        self.peer_ref = peer_ref
        self.result = {"submitted": True} if result is None else result
        self.active_error = active_error
        self.send_error = send_error
        self.active_calls = 0
        self.send_calls = 0
        self.sent_texts = []

    def active_peer(self, _chat_id):
        self.active_calls += 1
        if self.active_error:
            raise self.active_error
        return {"source_chat_ref": self.source_chat_ref, "peer_ref": self.peer_ref}

    def send_text(self, text):
        self.send_calls += 1
        self.sent_texts.append(text)
        if self.send_error:
            raise self.send_error
        return self.result


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-dispatch-")
        self.core = BridgeCore(Path(self.temp.name) / "bridge.sqlite", bridge_id=BRIDGE,
                               account_id=ACCOUNT, account_epoch=1,
                               business_context="event_genix")
        self.core.verify_source(account_ref="a" * 64, source_generation_ref="b" * 64,
                                receive_healthy=True)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT, peer_ref=PEER)
        self.core.verify_peer(chat_id=CHAT, expected_source_chat_ref=SOURCE_CHAT,
                              expected_peer_ref=PEER)

    def tearDown(self):
        self.core.close()
        self.temp.cleanup()

    def test_success_is_submitted_unconfirmed_and_repeat_never_touches_ui(self):
        adapter = FakeAdapter()
        first = execute_text(self.core, command(), adapter)
        self.assertEqual((first["status"], first["dispatch_count"]),
                         ("submitted_unconfirmed", 1))
        repeated = execute_text(self.core, command(), adapter)
        self.assertEqual(repeated["status"], "submitted_unconfirmed")
        self.assertEqual((adapter.active_calls, adapter.send_calls), (1, 1))
        self.assertEqual(adapter.sent_texts, ["Synthetic dispatcher text"])

    def test_active_peer_mismatch_aborts_before_send(self):
        adapter = FakeAdapter(peer_ref="e" * 64)
        result = execute_text(self.core, command(), adapter)
        self.assertEqual((result["status"], result["error_code"], result["dispatch_count"]),
                         ("rejected", "ACTIVE_PEER_MISMATCH", 0))
        self.assertEqual(adapter.send_calls, 0)

    def test_peer_check_failure_does_not_cross_dispatch_boundary(self):
        adapter = FakeAdapter(active_error=RuntimeError("synthetic private failure"))
        with self.assertRaises(DispatcherError) as caught:
            execute_text(self.core, command(), adapter)
        self.assertEqual(caught.exception.code, "ACTIVE_PEER_CHECK_FAILED")
        self.assertEqual(self.core.command(COMMAND)["status"], "accepted")
        self.assertEqual(adapter.send_calls, 0)

    def test_timeout_after_dispatch_boundary_becomes_unknown_and_never_retries(self):
        adapter = FakeAdapter(send_error=TimeoutError("synthetic"))
        first = execute_text(self.core, command(), adapter)
        self.assertEqual((first["status"], first["error_code"], first["dispatch_count"]),
                         ("unknown", "DISPATCH_RESULT_UNKNOWN", 1))
        second = execute_text(self.core, command(), adapter)
        self.assertEqual(second["status"], "unknown")
        self.assertEqual((adapter.active_calls, adapter.send_calls), (1, 1))

    def test_malformed_adapter_success_is_unknown(self):
        for result in [True, {}, {"submitted": False}, {"submitted": True, "delivery": "delivered"}]:
            with self.subTest(result=result):
                command_id = f"{len(str(result)) + 1:08x}-6666-4666-8666-666666666666"
                request_id = f"{len(str(result)) + 20:08x}-7777-4777-8777-777777777777"
                adapter = FakeAdapter(result=result)
                outcome = execute_text(self.core,
                                       command(command_id=command_id,
                                               client_request_id=request_id), adapter)
                self.assertEqual(outcome["status"], "unknown")
                self.assertEqual(adapter.send_calls, 1)

    def test_existing_dispatch_started_is_reconciled_without_ui(self):
        self.core.accept_command(command())
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                 observed_peer_ref=PEER)
        adapter = FakeAdapter()
        result = execute_text(self.core, command(), adapter)
        self.assertEqual((result["status"], result["dispatch_count"]), ("unknown", 1))
        self.assertEqual((adapter.active_calls, adapter.send_calls), (0, 0))


if __name__ == "__main__":
    unittest.main()
