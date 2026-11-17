# CRM bot portability

The CRM owns identities, business permissions, verified recipients, tasks and the
assignment outbox. The Telegram host owns polling offsets, downloaded media,
conversation checkpoints and the durable acknowledgement spool. An arbitrary
confirmed participant follows the same CRM authorization and conversation flow.

## Host boundary

`CrmLane(settings, notes_owner_id=None, operator_id=optional_operator)` supports a
CRM host without the Second Brain notes owner or legacy participant seeds. Supply
an aiogram Bot to `lane.run(bot)` and call `await lane.admit(bot, update)` followed
by `lane.enqueue(update)` when admission has not already handled the update, at
durable ingress before acknowledging the polling offset. The existing Second
Brain host keeps its current defaults.
CRM voice downloads use `services/telegram_media.py`, independently of the notes
worker. CRM task interpretation still requires its Codex composer and voice
transcription configuration; these are explicit dependencies of any future host.

Use a separate `settings.runtime_dir` for every bot. Do not share polling offsets,
SQLite ingress identifiers or message acknowledgements between live bot hosts.
Assignment formatting explicitly selects HTML and does not depend on the host's
default parse mode. Only CRM-validated, currently authorized task content is
included. Missing content schedules a retry instead of sending an empty receipt.

The owners API uses an ascending user-ID cursor and pages of up to 200. All three
bot consumers read subsequent pages and reject stalled/duplicate pagination.
Recipient heartbeats run independently of morning-list processing. These changes
remove the four-person assumption; they do not remove Telegram or CRM rate limits.

## Future cutover procedure

No bot identity, token, service key or production binding is changed by this
release. The target bot and the decision to retain Second Brain remain open.

1. Select the target bot and approve its configuration separately. Verify its
   identity with `getMe`. Prepare its isolated runtime and the same CRM host code.
2. Inventory verified bindings, pending events and all `uncertain` outcomes. Keep
   a manifest associating historical message IDs with the originating bot.
3. Pause the old assignment consumer, drain known acknowledgements, and back up
   its sources and SQLite state. Do not run two assignment consumers during the
   transition. Investigate an ambiguous send before any attempted replay.
4. Follow the existing account-confirmation flow for the selected bot. A user
   must first open/message a new bot before Telegram permits that bot to initiate
   a private conversation. CRM verification cannot override that platform rule.
5. Start the new consumer only after the old one is stopped. Preserve the CRM
   outbox and delivered outcomes. Do not copy old bot updates or media identifiers
   into the new bot, recreate tasks, or replay notification history.
6. Validate with an isolated account: confirmation, task assignment, content,
   saved Telegram message ID, restart and acknowledgement recovery. Verify the
   roster heartbeat and morning empty-list behavior.
7. Roll back by stopping the new consumer before restoring the old host and its
   configuration. Preserve CRM delivery outcomes accumulated during the cutover.

Telegram message IDs are scoped to a chat and file IDs cannot be transferred
between bots. Sources: [Bot API](https://core.telegram.org/bots/api),
[Bots introduction](https://core.telegram.org/bots#how-do-bots-work).
Concurrent multi-bot routing and a real second-bot cutover require an additional
design and acceptance run once the target is chosen. They are not claimed as
verified by the current single-bot release.
