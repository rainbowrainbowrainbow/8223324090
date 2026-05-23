# Page: Chat

## Route / Location

- Route: `/chat`
- Alias: `/kleshnya`
- Static file: `chat.html`
- Page controller: `js/chat-page.js`
- Backend route: `routes/chat.js`
- Related navigation item: Today group -> `Чат`; System group -> `Помічник`

## Purpose

Chat is the team messenger and assistant surface: channels, messages, pins, reactions, threads, bookmarks, chat tasks, Guardian security log, and assistant/Kleshnya interactions.

## Primary Entities

- Channel
- Message
- Conversation thread
- Pinned message
- Chat task
- Guardian moderation event
- User

## Visible UI

- Channel list/sidebar.
- Message list and composer.
- Message context menu.
- Pinned message zone.
- Security/Guardian panels.
- Assistant/Kleshnya controls.

## Available User Actions

- Send/edit/delete messages.
- Upload files.
- Pin/unpin messages.
- React, reply, thread, forward, bookmark, remind, mark important.
- Create chat tasks.
- Use slash commands and assistant reply flows.

## Data Sources

- `routes/chat.js`
- `services/chatService.js`
- `services/guardian.js`
- `services/websocket.js`
- `db/migrations/030_messenger.sql`
- `db/migrations/031_chat_pinned.sql`
- `db/migrations/098_chat_system_events.sql`

## Related Files

- `chat.html`
- `js/chat-page.js`
- `routes/chat.js`
- `routes/guardian.js`

## Assistant Context

On Chat, interpret questions through channel/message context. If the user asks about "закріпити", "пін", "thread", or moderation, use the selected message/channel if available.
