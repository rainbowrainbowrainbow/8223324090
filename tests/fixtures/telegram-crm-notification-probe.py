"""Companion probe for the disposable CRM integration test (no Telegram calls)."""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from urllib.parse import urlsplit
from unittest.mock import patch

import httpx

from d_brain.services.crm_client import CrmClient, CrmError
from d_brain.services.crm_notification_delivery import process_assignments, sync_recipients
from d_brain.services.crm_notifications import queue_morning
from d_brain.services.crm_store import CrmStore
from d_brain.services.crm_task_lists import KYIV


async def main(base_url, user_id, actor, task_id):
    target = urlsplit(base_url)
    assert target.scheme == "http" and target.hostname in {"localhost", "127.0.0.1"} and target.port
    user_id, actor = int(user_id), int(actor)
    lost_ack = False
    sent = []

    async def redirect(req):
        nonlocal lost_ack
        async with httpx.AsyncClient() as local:
            response = await local.request(
                req.method, base_url + req.url.raw_path.decode(), content=req.content,
                headers={k: v for k, v in req.headers.items() if k != "host"},
            )
        if req.url.path.endswith("/result") and not lost_ack:
            assert response.is_success
            lost_ack = True
            raise httpx.ReadTimeout("Fixture lost response after the CRM persisted acceptance")
        return response

    client = CrmClient(
        "https://notification-fixture.invalid", "isolated-telegram-crm-fixture-only",
        transport=httpx.MockTransport(redirect),
    )

    async def send_message(recipient, text, **_kwargs):
        sent.append((recipient, text, _kwargs["parse_mode"]))
        return SimpleNamespace(message_id=50001)

    def store(path):
        if os.name != "nt":
            return CrmStore(path)
        # Production is Linux. This disposable Windows fixture supplies POSIX
        # file flags that are unavailable on its host.
        with patch.object(os, "O_NOFOLLOW", 0, create=True), patch.object(os, "fchmod", lambda *_: None, create=True):
            return CrmStore(path)

    def lane(path):
        return SimpleNamespace(client=client, store=store(path), events={}, roster_changed=asyncio.Event())

    bot = SimpleNamespace(send_message=send_message)
    with TemporaryDirectory() as folder:
        path = Path(folder)
        running = lane(path)
        roster = await sync_recipients(running)
        assert roster[actor]["userId"] == user_id and actor in running.events
        try:
            await process_assignments(running, bot)
        except CrmError as error:
            assert error.code == "CRM_TIMEOUT" and lost_ack
        else:
            raise AssertionError("Fault was not exercised")
        assert len(sent) == 1 and len(running.store.assignment_results()) == 1
        recipient, text, parse_mode = sent[0]
        assert recipient == actor and f"/tasks?open={task_id}" in text
        assert "Disposable notification lifecycle" in text
        assert "Виконати до:</b> 05.11.2099 о 10:00 (Київ)" in text, text
        assert parse_mode == "HTML"
        restarted = lane(path)
        await process_assignments(restarted, bot)
        assert len(sent) == 1 and not restarted.store.assignment_results()

        version = roster[actor]["bindingVersion"]
        morning = await queue_morning(
            restarted.store, actor, client, datetime(2099, 11, 5, 10, tzinfo=KYIV), expected_version=version
        )
        assert morning and restarted.store.next(actor) is not None
        restarted.store.delivered(restarted.store.next(actor)["id"])
        await queue_morning(
            restarted.store, actor, client, datetime(2099, 11, 6, 10, tzinfo=KYIV), expected_version=version
        )
        assert restarted.store.morning_done(actor, "2099-11-06") and restarted.store.next(actor) is None
    print(json.dumps({"sent": len(sent), "messageId": 50001, "restarted": True,
                      "morningWithTasks": True, "emptyMorningSilent": True}))


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:]))
