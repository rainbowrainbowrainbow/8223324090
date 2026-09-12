"""Synthetic G3-to-P1 adapter tests."""

from pathlib import Path
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_g3_adapter import G3AdapterError, import_pending


BRIDGE = "11111111-1111-4111-8111-111111111111"
ACCOUNT = "22222222-2222-4222-8222-222222222222"
ACCOUNT_REF = "a" * 64
GENERATION = "b" * 64
CHAT_REF = "c" * 64
PEER_REF = "d" * 64
KEY = b"synthetic-p1-adapter-key-only!!!"


def row(source_event_id=11, **changes):
    value = {
        "source_event_id": source_event_id,
        "event_id": "evt_" + "1" * 32,
        "chat_ref": CHAT_REF,
        "peer_ref": PEER_REF,
        "marker": "EGXG3-A1B2C3D4-DUP",
        "direction_code": 0,
        "status": "pending",
    }
    value.update(changes)
    return value


class G3AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-adapter-")
        self.core = BridgeCore(Path(self.temp.name) / "bridge.sqlite", bridge_id=BRIDGE,
                               account_id=ACCOUNT, account_epoch=1,
                               business_context="event_genix")
        self.core.verify_source(account_ref=ACCOUNT_REF, source_generation_ref=GENERATION,
                                receive_healthy=True)

    def tearDown(self):
        self.core.close()
        self.temp.cleanup()

    def test_import_is_durable_and_idempotent_across_changed_observation_time(self):
        first = import_pending(self.core, [row()], reference_key=KEY,
                               observed_at="2026-09-11T12:00:00Z")[0]
        second = import_pending(self.core, [row()], reference_key=KEY,
                                observed_at="2026-09-11T12:01:00Z")[0]
        self.assertEqual(first, second)
        self.assertEqual(first["observed_at"], "2026-09-11T12:00:00Z")
        self.assertEqual(first["identity_level"], "unresolved")
        self.assertEqual(len(self.core.list_pending_events()), 1)

    def test_two_identical_markers_with_distinct_source_ids_are_not_collapsed(self):
        events = import_pending(self.core, [row(11), row(12, event_id="evt_" + "2" * 32)],
                                reference_key=KEY, observed_at="2026-09-11T12:00:00Z")
        self.assertEqual([event["sequence"] for event in events], [1, 2])
        self.assertNotEqual(events[0]["source_event_ref"], events[1]["source_event_ref"])

    def test_direction_remains_unknown_without_explicit_verified_mapping(self):
        event = import_pending(self.core, [row()], reference_key=KEY,
                               observed_at="2026-09-11T12:00:00Z")[0]
        self.assertEqual((event["direction"], event["origin"]), ("unknown", "unknown"))
        mapped = import_pending(self.core, [row(12, event_id="evt_" + "2" * 32)],
                                reference_key=KEY, observed_at="2026-09-11T12:00:01Z",
                                direction_map={0: "inbound"})[0]
        self.assertEqual((mapped["direction"], mapped["origin"]),
                         ("inbound", "external_viber"))

    def test_private_or_ambiguous_shape_is_rejected(self):
        for invalid in [
            {**row(), "display_name": "Synthetic Name"},
            row(marker="ordinary private message"),
            row(status="failed"),
            row(direction_code=True),
        ]:
            with self.subTest(invalid=invalid), self.assertRaises(G3AdapterError):
                import_pending(self.core, [invalid], reference_key=KEY,
                               observed_at="2026-09-11T12:00:00Z")
        self.assertEqual(self.core.list_pending_events(), [])


if __name__ == "__main__":
    unittest.main()
