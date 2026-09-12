"""Synthetic daemon dispatch-loop tests; no network, desktop or Viber access."""

from pathlib import Path
import tempfile
import unittest

from p1_bridge_core import BridgeCore
from p1_daemon import BridgeDaemon
from p1_http_client import BridgeHttpClient, HttpClientError


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
        "text": "Synthetic daemon text 💬",
    }
    value.update(changes)
    return value


class FakeClient(BridgeHttpClient):
    def __init__(self, commands):
        self.commands = list(commands)
        self.results = []
        self.heartbeats = 0
        self.last_heartbeat = None

    def heartbeat(self, payload):
        self.heartbeats += 1
        self.last_heartbeat = dict(payload)
        return {"protocol_version": "1.0"}

    def events(self, _payload):
        return {"protocol_version": "1.0", "acknowledged": []}

    def pull_commands(self, _payload):
        commands, self.commands = self.commands, []
        return {"protocol_version": "1.0", "commands": commands}

    def command_result(self, command_id, payload):
        self.results.append({"command_id": command_id, "payload": dict(payload)})
        return {"protocol_version": "1.0", "command_id": command_id, "status": payload["status"]}


class FakeDispatchAdapter:
    def __init__(self, result=None):
        self.result = result or {
            "status": "submitted_unconfirmed",
            "outbound_observed": True,
            "chat_confirmed": True,
            "outbound_baseline_event_id": 50,
            "outbound_source_event_id": 51,
        }
        self.sent = []

    def active_peer(self, _chat_id):
        return {
            "source_chat_ref": SOURCE_CHAT,
            "peer_ref": PEER,
            "account_verified": True,
            "foreground_verified": True,
            "composer_state": "empty",
            "layout_verified": True,
            "dpi_verified": True,
        }

    def send_text(self, text):
        self.sent.append(text)
        return self.result

    def dispatch_baseline(self):
        return 50


class DaemonDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eventgenix-viber-p1-daemon-")
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

    def test_cycle_pulls_dispatches_and_reports_terminal_status_once(self):
        client = FakeClient([command()])
        adapter = FakeDispatchAdapter()
        daemon = BridgeDaemon(self.core, client, runtime_id="99999999-9999-4999-8999-999999999999",
                              clock=lambda: 100.0, dispatch_adapter=adapter)
        result = daemon.cycle()
        self.assertEqual(result["commands"], 1)
        self.assertEqual(result["dispatched"], 1)
        self.assertEqual(adapter.sent, ["Synthetic daemon text 💬"])
        self.assertEqual([entry["payload"]["status"] for entry in client.results],
                         ["dispatch_started", "submitted_unconfirmed"])

        result = daemon.cycle()
        self.assertEqual(result["commands"], 0)
        self.assertEqual(result["dispatched"], 0)
        self.assertEqual(adapter.sent, ["Synthetic daemon text 💬"])
        self.assertEqual([entry["payload"]["status"] for entry in client.results],
                         ["dispatch_started", "submitted_unconfirmed"])


    def test_heartbeat_does_not_advertise_send_without_dispatch_adapter(self):
        client = FakeClient([])
        daemon = BridgeDaemon(self.core, client, runtime_id="99999999-9999-4999-8999-999999999999",
                              clock=lambda: 100.0)
        daemon.send_heartbeat()
        self.assertFalse(client.last_heartbeat["capabilities"]["send_text"])
        self.assertFalse(client.last_heartbeat["capabilities"]["sender_adapter"])
        self.assertEqual(client.last_heartbeat["capabilities"]["inbound_pending"], 0)
        self.assertEqual(client.last_heartbeat["capabilities"]["cycle_status"], "starting")

    def test_cycle_records_success_and_error_without_losing_pending_work(self):
        class FailingClient(FakeClient):
            def pull_commands(self, _payload):
                raise HttpClientError("NETWORK_UNAVAILABLE", retryable=True)

        client = FailingClient([])
        daemon = BridgeDaemon(self.core, client, runtime_id="99999999-9999-4999-8999-999999999999",
                              clock=lambda: 100.0)
        with self.assertRaises(HttpClientError):
            daemon.cycle()
        daemon._record_cycle_error(HttpClientError("NETWORK_UNAVAILABLE", retryable=True))
        self.assertEqual(daemon.cycle_status()["status"], "error")
        self.assertEqual(daemon.cycle_status()["last_error_code"], "NETWORK_UNAVAILABLE")

        ok_client = FakeClient([])
        ok_daemon = BridgeDaemon(self.core, ok_client, runtime_id="99999999-9999-4999-8999-999999999999",
                                 clock=lambda: 100.0)
        result = ok_daemon.cycle()
        self.assertEqual(result["cycle_status"]["status"], "ok")
        ok_daemon.send_heartbeat()
        self.assertEqual(ok_client.last_heartbeat["capabilities"]["cycle_status"], "ok")

    def test_pull_reports_existing_terminal_unknown_without_resend(self):
        self.core.accept_command(command())
        self.core.begin_dispatch(COMMAND, observed_source_chat_ref=SOURCE_CHAT, observed_peer_ref=PEER)
        self.core.finish_dispatch(COMMAND, status="unknown", error_code="DISPATCH_RESULT_UNKNOWN")
        client = FakeClient([command()])
        adapter = FakeDispatchAdapter()
        daemon = BridgeDaemon(self.core, client, runtime_id="99999999-9999-4999-8999-999999999999",
                              clock=lambda: 100.0, dispatch_adapter=adapter)
        daemon.cycle()
        self.assertEqual(adapter.sent, [])
        self.assertEqual(client.results[-1]["payload"]["status"], "unknown")

    def test_failed_dispatch_is_reported_as_failed(self):
        client = FakeClient([command()])
        adapter = FakeDispatchAdapter({"status": "failed", "error_code": "COMPOSER_WRITE_FAILED"})
        daemon = BridgeDaemon(self.core, client, runtime_id="99999999-9999-4999-8999-999999999999",
                              clock=lambda: 100.0, dispatch_adapter=adapter)
        daemon.cycle()
        self.assertEqual([entry["payload"]["status"] for entry in client.results],
                         ["dispatch_started", "failed"])
        self.assertEqual(client.results[-1]["payload"]["status"], "failed")
        self.assertEqual(client.results[-1]["payload"]["error_code"], "COMPOSER_WRITE_FAILED")


if __name__ == "__main__":
    unittest.main()
