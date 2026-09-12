"""HTTPS transport for the Viber Personal Bridge.

Only protocol JSON is returned to callers. The Bearer credential is kept in
memory and is never added to URLs, exceptions, logs, or persisted state.
"""

from __future__ import annotations

import json
import random
import ssl
import time
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


PROTOCOL_VERSION = "1.0"
MAX_RESPONSE_BYTES = 256 * 1024


class HttpClientError(Exception):
    def __init__(self, code: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.status = status


def _base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise HttpClientError("BASE_URL_INVALID")
    path = parsed.path.rstrip("/")
    return f"https://{parsed.netloc}{path}"


class BridgeHttpClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 12.0,
                 opener: Callable[..., Any] = urlopen, sleeper: Callable[[float], None] = time.sleep,
                 jitter: Callable[[], float] = random.random):
        self.base_url = _base_url(base_url)
        if not isinstance(token, str) or not 24 <= len(token) <= 256:
            raise HttpClientError("BRIDGE_TOKEN_INVALID")
        self._token = token
        self.timeout = timeout
        self._opener = opener
        self._sleeper = sleeper
        self._jitter = jitter

    def post(self, path: str, payload: Mapping[str, Any], *, attempts: int = 5) -> Mapping[str, Any]:
        if not path.startswith("/") or "?" in path or "#" in path or ".." in path:
            raise HttpClientError("REQUEST_PATH_INVALID")
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > 256 * 1024:
            raise HttpClientError("REQUEST_TOO_LARGE")
        last_error = HttpClientError("NETWORK_UNKNOWN", retryable=True)
        for attempt in range(attempts):
            request = Request(self.base_url + path, data=body, method="POST", headers={
                "Authorization": "Bearer " + self._token,
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "EventGenix-Viber-Personal-Bridge/1.0",
            })
            try:
                with self._opener(request, timeout=self.timeout, context=ssl.create_default_context()) as response:
                    raw = response.read(MAX_RESPONSE_BYTES + 1)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        raise HttpClientError("RESPONSE_TOO_LARGE")
                    status = int(response.status)
                    if status != 200:
                        raise HttpClientError("HTTP_ERROR", retryable=status in {429, 502, 503, 504}, status=status)
                    parsed = json.loads(raw.decode("utf-8"))
                    if not isinstance(parsed, Mapping) or parsed.get("protocol_version") != PROTOCOL_VERSION:
                        raise HttpClientError("PROTOCOL_RESPONSE_INVALID")
                    return parsed
            except HTTPError as error:
                last_error = HttpClientError("HTTP_ERROR", retryable=error.code in {429, 502, 503, 504}, status=error.code)
                retry_after = error.headers.get("Retry-After") if error.headers else None
                delay = min(30.0, float(retry_after)) if retry_after and retry_after.isdigit() else None
            except (URLError, TimeoutError, OSError):
                last_error = HttpClientError("NETWORK_UNKNOWN", retryable=True)
                delay = None
            except (UnicodeError, json.JSONDecodeError):
                raise HttpClientError("PROTOCOL_RESPONSE_INVALID") from None
            except HttpClientError as error:
                last_error = error
                delay = None
            if not last_error.retryable or attempt + 1 >= attempts:
                raise last_error
            backoff = delay if delay is not None else min(30.0, 2 ** attempt)
            self._sleeper(backoff + min(0.5, self._jitter()))
        raise last_error

    def heartbeat(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        return self.post("/api/omni/bridge/v1/heartbeat", payload)

    def events(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        return self.post("/api/omni/bridge/v1/events", payload)

    def pull_commands(self, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        return self.post("/api/omni/bridge/v1/commands/pull", payload)

    def command_result(self, command_id: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        if not isinstance(command_id, str) or len(command_id) != 36:
            raise HttpClientError("COMMAND_ID_INVALID")
        return self.post(f"/api/omni/bridge/v1/commands/{command_id}/result", payload)
