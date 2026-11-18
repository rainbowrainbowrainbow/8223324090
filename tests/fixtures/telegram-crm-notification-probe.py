"""Companion probe for the disposable CRM integration test (no Telegram calls)."""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from urllib.parse import urlsplit
from unittest.mock import AsyncMock, patch

import httpx
from aiogram.types import Update

from d_brain.services.crm_client import CrmClient, CrmError
from d_brain.services.crm_flow import CrmFlow
from d_brain.services.crm_notification_delivery import process_assignments, sync_recipients
from d_brain.services.crm_notifications import queue_morning
from d_brain.services.crm_store import CrmStore
from d_brain.services.crm_task_lists import KYIV


def open_local_fixture(factory, *args, **kwargs):
    if os.name != "nt":
        return factory(*args, **kwargs)
    # Production is Linux. The disposable Windows fixture supplies missing POSIX flags.
    with patch.object(os, "O_NOFOLLOW", 0, create=True), patch.object(os, "fchmod", lambda *_: None, create=True):
        return factory(*args, **kwargs)


async def verify_voice_assignment(client, path, creator, recipient, recipient_user):
    # The isolated CRM lane has no vault and must not attempt advisory locking.
    platform_modules = {"fcntl": ModuleType("fcntl")} if os.name == "nt" else {}
    with patch.dict(sys.modules, platform_modules):
        from d_brain.bot.crm_lane import CrmLane

    settings = SimpleNamespace(
        deepgram_api_key="fixture", deepgram_language="uk", runtime_dir=path / "voice", crm_enabled=False,
    )
    lane = open_local_fixture(CrmLane, settings, notes_owner_id=None)
    lane.client = client
    title = "Disposable voice assignment lifecycle"
    composer = SimpleNamespace(compose=AsyncMock(return_value={"draft": {
        "title": title, "description": "Isolated voice transport fixture", "ownerUserId": recipient_user,
        "businessContext": "event_genix", "date": "2099-11-07", "deadline": None, "taskMode": "work",
    }}))
    lane.flow = CrmFlow(client, composer=composer, checkpoint=lane.store.checkpoint_state, store=lane.store)
    roster = await sync_recipients(lane)
    assert {creator, recipient} <= roster.keys()

    messages = []

    async def send_message(actor, text, **kwargs):
        message_id = 51000 + len(messages)
        messages.append((actor, text, message_id))
        return SimpleNamespace(message_id=message_id)

    bot = SimpleNamespace(send_message=send_message)
    update = Update.model_validate({"update_id": 810000, "message": {
        "message_id": 8100, "date": int(datetime.now(KYIV).timestamp()),
        "chat": {"id": creator, "type": "private"},
        "from": {"id": creator, "is_bot": False, "first_name": "Fixture"},
        "voice": {"file_id": "isolation-voice", "file_unique_id": "isolation-voice", "duration": 4},
    }})
    audio = b"fixture voice data"
    transcript = "Створи задачу: перевірити реквізит для колеги"
    with patch("d_brain.services.telegram_media.download_media", AsyncMock(return_value=audio)) as download, patch(
        "d_brain.services.transcription.DeepgramTranscriber.transcribe", AsyncMock(return_value=transcript),
    ) as transcribe:
        assert lane.enqueue(update) and lane.enqueue(update)  # replay of the same Telegram update
        worker = asyncio.create_task(lane.worker(bot, creator))
        try:
            async with asyncio.timeout(12):
                while lane.store.next(creator):
                    await asyncio.sleep(0.02)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
    download.assert_awaited_once_with(bot, "isolation-voice")
    transcribe.assert_awaited_once_with(audio)
    assert composer.compose.await_count == 1
    assert composer.compose.await_args.args[0] == "перевірити реквізит для колеги"
    assert recipient_user in {owner["id"] for owner in composer.compose.await_args.kwargs["owners"]}
    state = lane.store.state(creator)
    assert state["step"] == "ai_done" and "operationId" not in state and "draft" not in state
    operation = await client.request(creator, f"/operations/{state['lastOperationId']}")
    assert operation["state"] == "committed"
    task_id = operation["receipt"]["task"]["id"]
    assert any("Задача створена" in text for actor, text, _ in messages if actor == creator)
    await process_assignments(lane, bot)
    await process_assignments(lane, bot)
    received = [(text, message_id) for actor, text, message_id in messages if actor == recipient]
    assert len(received) == 1 and title in received[0][0] and f"/tasks?open={task_id}" in received[0][0]
    return task_id, received[0][1]


async def main(base_url, user_id, actor, task_id, creator):
    target = urlsplit(base_url)
    assert target.scheme == "http" and target.hostname in {"localhost", "127.0.0.1"} and target.port
    user_id, actor, creator = int(user_id), int(actor), int(creator)
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

    def lane(path):
        return SimpleNamespace(client=client, store=open_local_fixture(CrmStore, path), events={}, roster_changed=asyncio.Event())

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
        expect_delivery_command = os.environ.get("NOTIFICATION_E2E_EXPECT_DELIVERY_COMMAND") != "0"
        if expect_delivery_command:
            diagnostic, _ = await CrmFlow(client, store=restarted.store).handle(
                actor,
                {
                    "text": f"/crm delivery {task_id}",
                    "action": "",
                    "event_at": int(datetime.now(KYIV).timestamp()),
                    "update_id": 1,
                },
                {},
            )
            assert diagnostic["_bindingVersion"] == version
            assert diagnostic["text"] == f"Задача №{task_id}. Telegram прийняв повідомлення."

        morning = await queue_morning(
            restarted.store, actor, client, datetime(2099, 11, 5, 10, tzinfo=KYIV), expected_version=version
        )
        assert morning and restarted.store.next(actor) is not None
        restarted.store.delivered(restarted.store.next(actor)["id"])
        await queue_morning(
            restarted.store, actor, client, datetime(2099, 11, 6, 10, tzinfo=KYIV), expected_version=version
        )
        assert restarted.store.morning_done(actor, "2099-11-06") and restarted.store.next(actor) is None
        voice_task_id, voice_message_id = await verify_voice_assignment(client, path, creator, actor, user_id)
    print(json.dumps({"sent": len(sent), "messageId": 50001, "restarted": True,
                      "deliveryCommandConfirmed": expect_delivery_command, "morningWithTasks": True,
                      "emptyMorningSilent": True, "voiceTaskId": voice_task_id,
                      "voiceMessageId": voice_message_id}))


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:]))
