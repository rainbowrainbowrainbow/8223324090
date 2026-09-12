"""Synthetic tests for P1 identity and exactly-once dispatch gates."""

from pathlib import Path
import tempfile
import unittest
from p1_bridge_core import BridgeCore, BridgeCoreError, CommandConflict, InboundEventConflict


BRIDGE = "11111111-1111-4111-8111-111111111111"
ACCOUNT = "22222222-2222-4222-8222-222222222222"
CHAT = "33333333-3333-4333-8333-333333333333"
COMMAND = "44444444-4444-4444-8444-444444444444"
REQUEST = "55555555-5555-4555-8555-555555555555"
ACCOUNT_REF = "a" * 64
GENERATION = "b" * 64
SOURCE_CHAT = "c" * 64
PEER = "d" * 64
SOURCE_EVENT = "f" * 64


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
        "text": "Synthetic P1 message",
    }
    value.update(changes)
    return value


def observation(**changes):
    value = {
        "source_event_ref": SOURCE_EVENT,
        "source_chat_ref": SOURCE_CHAT,
        "peer_ref": PEER,
        "direction": "inbound",
        "origin": "external_viber",
        "text": "Synthetic inbound P1 message",
        "observed_at": "2026-09-11T12:00:00Z",
    }
    value.update(changes)
    return value


class BridgeCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-")
        self.path = Path(self.temp.name) / "bridge.sqlite"
        self.core = BridgeCore(self.path, bridge_id=BRIDGE, account_id=ACCOUNT,
                               account_epoch=1, business_context="event_genix")

    def tearDown(self):
        self.core.close()
        self.temp.cleanup()

    def ready(self):
        self.core.verify_source(account_ref=ACCOUNT_REF, source_generation_ref=GENERATION,
                                receive_healthy=True)
        discovered = self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT,
                                             peer_ref=PEER)
        self.assertEqual(discovered["identity_level"], "unresolved")
        self.assertEqual(self.core.verify_peer(chat_id=CHAT,
                                              expected_source_chat_ref=SOURCE_CHAT,
                                              expected_peer_ref=PEER), 2)

    def test_accepts_crm_browser_request_id_format(self):
        self.ready()
        saved = self.core.accept_command(command(client_request_id="a" * 40))
        self.assertEqual(saved["client_request_id"], "a" * 40)

    def test_send_capability_requires_account_receive_and_verified_peer(self):
        self.assertFalse(self.core.diagnostics()["send_text"])
        self.core.verify_source(account_ref=ACCOUNT_REF, source_generation_ref=GENERATION,
                                receive_healthy=False)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT, peer_ref=PEER)
        self.core.verify_peer(chat_id=CHAT, expected_source_chat_ref=SOURCE_CHAT,
                              expected_peer_ref=PEER)
        self.assertFalse(self.core.diagnostics()["send_text"])
        self.core.set_receive_health(True)
        self.assertTrue(self.core.diagnostics()["send_text"])

    def test_unknown_contact_is_discovered_unresolved_and_send_is_rejected(self):
        self.core.verify_source(account_ref=ACCOUNT_REF, source_generation_ref=GENERATION,
                                receive_healthy=True)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT, peer_ref=PEER)
        result = self.core.accept_command(command(binding_revision=1))
        self.assertEqual((result["status"], result["error_code"]),
                         ("rejected", "PEER_UNVERIFIED"))
        self.assertEqual(result["dispatch_count"], 0)

    def test_unresolved_new_contact_event_is_durable_but_not_sendable(self):
        self.core.verify_source(account_ref=ACCOUNT_REF, source_generation_ref=GENERATION,
                                receive_healthy=True)
        self.core.discover_chat(chat_id=CHAT, source_chat_ref=SOURCE_CHAT, peer_ref=PEER)
        inbound = self.core.ingest_observation(observation())
        self.assertEqual(inbound["identity_level"], "unresolved")
        self.assertEqual(inbound["sequence"], 1)
        self.assertEqual(self.core.list_pending_events(), [inbound])
        self.assertFalse(self.core.diagnostics()["send_text"])

    def test_inbound_ack_loss_replays_same_event_without_duplicate(self):
        self.ready()
        first = self.core.ingest_observation(observation())
        repeated = self.core.ingest_observation(observation())
        self.assertEqual(first, repeated)
        self.assertEqual(self.core.diagnostics()["inbound_pending"], 1)
        self.assertEqual(self.core.ack_events([first["event_id"], first["event_id"]]), 1)
        self.assertEqual(self.core.ack_events([first["event_id"]]), 0)
        self.assertEqual(self.core.list_pending_events(), [])
        self.core.close()
        self.core = BridgeCore(self.path, bridge_id=BRIDGE, account_id=ACCOUNT,
                               account_epoch=1, business_context="event_genix")
        self.assertEqual(self.core.ingest_observation(observation())["event_id"], first["event_id"])
        self.assertEqual(self.core.diagnostics()["inbound_acked"], 1)

    def test_identical_text_with_distinct_source_occurrences_stays_distinct(self):
        self.ready()
        first = self.core.ingest_observation(observation())
        second = self.core.ingest_observation(observation(source_event_ref="1" * 64))
        self.assertNotEqual(first["event_id"], second["event_id"])
        self.assertEqual([first["sequence"], second["sequence"]], [1, 2])
        self.assertEqual(len(self.core.list_pending_events()), 2)

    def test_changed_source_occurrence_conflicts_and_unknown_ack_is_atomic(self):
        self.ready()
        first = self.core.ingest_observation(observation())
        with self.assertRaises(InboundEventConflict):
            self.core.ingest_observation(observation(direction="outbound", origin="unknown"))
        with self.assertRaises(BridgeCoreError) as caught:
            self.core.ack_events([first["event_id"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])
        self.assertEqual(caught.exception.code, "ACK_EVENT_UNKNOWN")
        self.assertEqual(self.core.list_pending_events()[0]["status"], "pending")

    def test_inbound_rejects_raw_identity_fields_and_peer_mismatch(self):
        self.ready()
        with self.assertRaises(BridgeCoreError) as caught:
            self.core.ingest_observation({**observation(), "display_name": "Synthetic Name"})
        self.assertEqual(caught.exception.code, "OBSERVATION_SHAPE_INVALID")
        with self.assertRaises(BridgeCoreError) as caught:
            self.core.ingest_observation(observation(peer_ref="e" * 64))
        self.assertEqual(caught.exception.code, "OBSERVATION_PEER_MISMATCH")

    def test_scope_and_stale_binding_fail_before_dispatch(self):
        self.ready()
        with self.assertRaises(BridgeCoreError) as caught:
            self.core.accept_command(command(business_context="dar"))
        self.assertEqual(caught.exception.code, "COMMAND_SCOPE_MISMATCH")
        stale = self.core.accept_command(command(binding_revision=1))
        self.assertEqual((stale["status"], stale["error_code"]),
                         ("rejected", "BINDING_REVISION_STALE"))

    def test_duplicate_command_and_request_are_idempotent_but_conflicts_abort(self):
        self.ready()
        first = self.core.accept_command(command())
        for _ in range(100):
            self.assertEqual(self.core.accept_command(command())["command_id"], first["command_id"])
        with self.assertRaises(CommandConflict):
            self.core.accept_command(command(text="Changed synthetic text"))
        with self.assertRaises(CommandConflict):
            self.core.accept_command(command(command_id="66666666-6666-4666-8666-666666666666"))

    def test_active_peer_is_rechecked_immediately_before_dispatch(self):
        self.ready()
        self.core.accept_command(command())
        result = self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                          observed_peer_ref="e" * 64)
        self.assertEqual((result["status"], result["error_code"], result["dispatch_count"]),
                         ("rejected", "ACTIVE_PEER_MISMATCH", 0))

    def test_only_one_dispatch_is_recorded_and_completion_never_resends(self):
        self.ready()
        self.core.accept_command(command())
        started = self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                           observed_peer_ref=PEER)
        self.assertEqual((started["status"], started["dispatch_count"]), ("dispatch_started", 1))
        repeated = self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                            observed_peer_ref=PEER)
        self.assertEqual((repeated["status"], repeated["dispatch_count"]),
                         ("dispatch_started", 1))
        finished = self.core.finish_dispatch(COMMAND, submitted=True)
        self.assertEqual(finished["status"], "submitted_unconfirmed")
        self.assertEqual(self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                                  observed_peer_ref=PEER)["dispatch_count"], 1)

    def test_different_commands_cannot_overlap_one_ui_operation(self):
        self.ready()
        self.core.accept_command(command())
        second_id = "66666666-6666-4666-8666-666666666666"
        second_request = "77777777-7777-4777-8777-777777777777"
        self.core.accept_command(command(command_id=second_id, client_request_id=second_request))
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                 observed_peer_ref=PEER)
        with self.assertRaises(BridgeCoreError) as caught:
            self.core.begin_dispatch(second_id, observed_source_chat_ref=SOURCE_CHAT,
                                     observed_peer_ref=PEER)
        self.assertEqual(caught.exception.code, "UI_OPERATION_BUSY")
        self.assertEqual(self.core.command(second_id)["status"], "accepted")
        self.core.finish_dispatch(COMMAND, submitted=False)
        self.assertEqual(self.core.begin_dispatch(second_id,
                                                  observed_source_chat_ref=SOURCE_CHAT,
                                                  observed_peer_ref=PEER)["dispatch_count"], 1)

    def test_peer_rebind_invalidates_old_commands_until_reverified(self):
        self.ready()
        old = self.core.accept_command(command())
        self.assertEqual(old["status"], "accepted")
        new_peer = "e" * 64
        self.assertEqual(self.core.rebind_peer(chat_id=CHAT,
                                              expected_source_chat_ref=SOURCE_CHAT,
                                              new_peer_ref=new_peer), 3)
        blocked = self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                           observed_peer_ref=new_peer)
        self.assertEqual((blocked["status"], blocked["error_code"], blocked["dispatch_count"]),
                         ("rejected", "BINDING_REVISION_STALE", 0))
        self.assertEqual(self.core.command(COMMAND)["error_code"], "BINDING_REVISION_STALE")
        self.assertEqual(self.core.verify_peer(chat_id=CHAT,
                                              expected_source_chat_ref=SOURCE_CHAT,
                                              expected_peer_ref=new_peer), 4)
        newer = command(command_id="88888888-8888-4888-8888-888888888888",
                        client_request_id="99999999-9999-4999-8999-999999999999",
                        binding_revision=4)
        self.assertEqual(self.core.accept_command(newer)["status"], "accepted")

    def test_restart_after_dispatch_started_becomes_unknown_without_retry(self):
        self.ready()
        self.core.accept_command(command())
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                 observed_peer_ref=PEER)
        self.core.close()
        self.core = BridgeCore(self.path, bridge_id=BRIDGE, account_id=ACCOUNT,
                               account_epoch=1, business_context="event_genix")
        self.assertEqual(self.core.recover_interrupted_dispatches(), 1)
        recovered = self.core.command(COMMAND)
        self.assertEqual((recovered["status"], recovered["error_code"], recovered["dispatch_count"]),
                         ("unknown", "DISPATCH_INTERRUPTED", 1))
        self.assertEqual(self.core.recover_interrupted_dispatches(), 0)

    def test_account_or_source_change_revokes_send(self):
        self.ready()
        for field, value, code in [
            ("account_ref", "e" * 64, "ACCOUNT_SOURCE_CHANGED"),
            ("source_generation_ref", "f" * 64, "SOURCE_GENERATION_CHANGED"),
        ]:
            kwargs = {"account_ref": ACCOUNT_REF, "source_generation_ref": GENERATION,
                      "receive_healthy": True, field: value}
            with self.subTest(field=field), self.assertRaises(BridgeCoreError) as caught:
                self.core.verify_source(**kwargs)
            self.assertEqual(caught.exception.code, code)
            self.assertFalse(self.core.diagnostics()["send_text"])


    def test_failed_dispatch_is_terminal_and_not_dispatchable_again(self):
        self.ready()
        self.core.accept_command(command())
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                 observed_peer_ref=PEER)
        failed = self.core.finish_dispatch(COMMAND, status="failed", error_code="COMPOSER_WRITE_FAILED")
        self.assertEqual((failed["status"], failed["error_code"], failed["dispatch_count"]),
                         ("failed", "COMPOSER_WRITE_FAILED", 1))
        self.assertEqual(self.core.list_dispatchable_commands(), [])
        self.assertEqual(self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                                  observed_peer_ref=PEER)["status"], "failed")

    def test_list_dispatchable_commands_excludes_terminal_and_rejected(self):
        self.ready()
        self.assertEqual(self.core.list_dispatchable_commands(), [])
        accepted = self.core.accept_command(command())
        self.assertEqual([item["command_id"] for item in self.core.list_dispatchable_commands()],
                         [accepted["command_id"]])
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT,
                                 observed_peer_ref=PEER)
        self.core.finish_dispatch(COMMAND, status="unknown")
        self.assertEqual(self.core.list_dispatchable_commands(), [])

    def test_reopen_with_another_business_or_epoch_is_rejected(self):
        self.core.close()
        for business, epoch in [("dar", 1), ("event_genix", 2)]:
            with self.subTest(business=business, epoch=epoch), self.assertRaises(BridgeCoreError) as caught:
                BridgeCore(self.path, bridge_id=BRIDGE, account_id=ACCOUNT,
                           account_epoch=epoch, business_context=business)
            self.assertEqual(caught.exception.code, "BRIDGE_SCOPE_MISMATCH")
        self.core = BridgeCore(self.path, bridge_id=BRIDGE, account_id=ACCOUNT,
                               account_epoch=1, business_context="event_genix")

    def test_state_inside_repository_and_invalid_shapes_are_blocked(self):
        inside = Path(__file__).parent / "must-not-create-p1.sqlite"
        self.assertFalse(inside.exists())
        with self.assertRaises(BridgeCoreError) as caught:
            BridgeCore(inside, bridge_id=BRIDGE, account_id=ACCOUNT,
                       account_epoch=1, business_context="event_genix")
        self.assertEqual(caught.exception.code, "STATE_INSIDE_REPOSITORY")
        self.assertFalse(inside.exists())
        self.ready()
        with self.assertRaises(BridgeCoreError):
            self.core.accept_command({**command(), "selector": "synthetic-forbidden"})
        with self.assertRaises(BridgeCoreError):
            self.core.accept_command(command(text="x" * 4001))


if __name__ == "__main__":
    unittest.main()
