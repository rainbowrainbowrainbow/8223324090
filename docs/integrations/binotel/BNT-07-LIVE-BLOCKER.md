# BNT-07 live calls and queue monitoring blocker

`taskStatus`: `PARTIAL_CAPABILITY_GAP`

The UI has explicit **Просто зараз** and **Моніторинг черг** modes and the authenticated API returns a typed unavailable capability instead of zero calls. No polling starts, so there is no invented interval, provider load, stale value, queue count or operator status.

Binotel's product pages describe Call Center queues and operator states, but the public site states that REST/Webhook/WebSocket documentation is supplied by support. Product availability does not establish an API method or this account's licence/permission. The exact unblock request is: API/WebSocket endpoint and auth, response schema for online calls and queues, rate limits/backoff guidance, timestamp semantics, required Call Center licence/account capability, and a read-only test account authorization.
