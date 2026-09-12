import json
import unittest
from urllib.error import URLError

from p1_http_client import BridgeHttpClient, HttpClientError


TOKEN = "bridge_test_token_1234567890"


class Response:
    def __init__(self, body, status=200):
        self.status = status
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _limit):
        return self.body


class HttpClientTests(unittest.TestCase):
    def test_rejects_non_https_and_url_credentials(self):
        for url in ("http://crm.example", "https://user:pass@crm.example", "https://crm.example/?token=x"):
            with self.subTest(url=url), self.assertRaises(HttpClientError):
                BridgeHttpClient(url, TOKEN)

    def test_posts_token_only_in_authorization_header(self):
        captured = {}

        def opener(request, **_kwargs):
            captured["url"] = request.full_url
            captured["authorization"] = request.get_header("Authorization")
            captured["body"] = json.loads(request.data)
            return Response({"protocol_version": "1.0", "server_time": "synthetic"})

        client = BridgeHttpClient("https://crm.example", TOKEN, opener=opener)
        result = client.heartbeat({"protocol_version": "1.0"})
        self.assertEqual(result["protocol_version"], "1.0")
        self.assertNotIn(TOKEN, captured["url"])
        self.assertEqual(captured["authorization"], "Bearer " + TOKEN)

    def test_network_ambiguity_retries_same_payload(self):
        bodies = []
        sleeps = []

        def opener(request, **_kwargs):
            bodies.append(request.data)
            if len(bodies) < 3:
                raise URLError("synthetic")
            return Response({"protocol_version": "1.0", "commands": []})

        client = BridgeHttpClient("https://crm.example", TOKEN, opener=opener,
                                  sleeper=sleeps.append, jitter=lambda: 0)
        result = client.pull_commands({"protocol_version": "1.0", "limit": 10})
        self.assertEqual(result["commands"], [])
        self.assertEqual(bodies, [bodies[0], bodies[0], bodies[0]])
        self.assertEqual(sleeps, [1, 2])

    def test_malformed_success_is_not_acknowledgement(self):
        client = BridgeHttpClient("https://crm.example", TOKEN,
                                  opener=lambda *_args, **_kwargs: Response({"ok": True}))
        with self.assertRaises(HttpClientError) as caught:
            client.events({"protocol_version": "1.0", "events": []})
        self.assertEqual(caught.exception.code, "PROTOCOL_RESPONSE_INVALID")


if __name__ == "__main__":
    unittest.main()
