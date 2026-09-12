"""Synthetic transport and ACK-loss tests for the P1 outbox."""

from pathlib import Path
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_transport import TransportError, deliver_pending, event_batch


BRIDGE = "11111111-1111-4111-8111-111111111111"
ACCOUNT = "22222222-2222-4222-8222-222222222222"
RUNTIME = "33333333-3333-4333-8333-333333333333"
CHAT = "44444444-4444-4444-8444-444444444444"


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-transport-")
        self.core = BridgeCore(Path(self.temp.name) / "bridge.sqlite", bridge_id=BRIDGE,
                               account_id=ACCOUNT, account_epoch=1,
                               business_context="event_genix")
        self.core.verify_source(account_ref="a" * 64, source_generation_ref="b" * 64,
                                receive_healthy=True)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref="c" * 64, peer_ref="d" * 64)
        for index in range(2):
            self.core.ingest_observation({
                "source_event_ref": str(index + 1) * 64,
                "source_chat_ref": "c" * 64,
                "peer_ref": "d" * 64,
                "direction": "unknown",
                "origin": "unknown",
                "text": "EGXG3-A1B2C3D4-DUP",
                "observed_at": f"2026-09-11T12:00:0{index}Z",
            })

    def tearDown(self):
        self.core.close()
        self.temp.cleanup()

    def test_batch_has_scope_string_sequence_and_no_raw_source_identity(self):
        payload = event_batch(self.core, runtime_id=RUNTIME)
        self.assertEqual(payload["protocol_version"], "1.0")
        self.assertEqual([event["sequence"] for event in payload["events"]], ["1", "2"])
        self.assertTrue(all(event["business_context"] == "event_genix" for event in payload["events"]))
        serialized = repr(payload)
        self.assertNotIn("source_event_ref", serialized)
        self.assertNotIn("source_chat_ref", serialized)

    def test_timeout_and_non_200_keep_every_event_pending(self):
        def timeout(_payload):
            raise TimeoutError("synthetic")

        unknown = deliver_pending(self.core, runtime_id=RUNTIME, post_json=timeout)
        self.assertEqual((unknown["status"], unknown["acked"], unknown["pending"]),
                         ("unknown", 0, 2))
        failed = deliver_pending(self.core, runtime_id=RUNTIME,
                                 post_json=lambda _payload: {"status": 503, "body": {}})
        self.assertEqual((failed["status"], failed["acked"], failed["pending"]),
                         ("retryable", 0, 2))

    def test_partial_ack_is_durable_and_replay_contains_only_remaining_event(self):
        first_id = self.core.list_pending_events()[0]["event_id"]
        result = deliver_pending(
            self.core, runtime_id=RUNTIME,
            post_json=lambda _payload: {"status": 200,
                                        "body": {"protocol_version": "1.0",
                                                 "acked_event_ids": [first_id]}},
        )
        self.assertEqual((result["acked"], result["pending"]), (1, 1))
        replay = event_batch(self.core, runtime_id=RUNTIME)
        self.assertEqual(len(replay["events"]), 1)
        self.assertNotEqual(replay["events"][0]["event_id"], first_id)

    def test_invalid_or_forged_ack_never_changes_local_state(self):
        invalid = [
            {"status": 200, "body": {}},
            {"status": 200, "body": {"protocol_version": "2.0", "acked_event_ids": []}},
            {"status": 200, "body": {"protocol_version": "1.0",
                                      "acked_event_ids": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}},
        ]
        for response in invalid:
            with self.subTest(response=response), self.assertRaises(TransportError):
                deliver_pending(self.core, runtime_id=RUNTIME,
                                post_json=lambda _payload, value=response: value)
            self.assertEqual(len(self.core.list_pending_events()), 2)

    def test_empty_outbox_does_not_call_transport(self):
        ids = [row["event_id"] for row in self.core.list_pending_events()]
        self.core.ack_events(ids)
        called = False

        def post(_payload):
            nonlocal called
            called = True

        result = deliver_pending(self.core, runtime_id=RUNTIME, post_json=post)
        self.assertFalse(called)
        self.assertEqual(result["status"], "idle")

    def test_invalid_runtime_is_rejected_before_transport(self):
        called = False

        def post(_payload):
            nonlocal called
            called = True

        with self.assertRaises(TransportError) as caught:
            deliver_pending(self.core, runtime_id="not-a-runtime-uuid-xxxxxxxxxxxxxx",
                            post_json=post)
        self.assertEqual(caught.exception.code, "RUNTIME_ID_INVALID")
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
