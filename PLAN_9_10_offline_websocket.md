# Feature #9: Service Worker + Offline Mode

## Current State
- **Caching in api.js**: No Service Worker or Cache API usage. Caching is purely in-memory via `AppState.cachedBookings` and `AppState.cachedLines` objects with a 10-second TTL (`CACHE_TTL = 10000`). Products (programs) are cached in `AppState.products` with a 5-minute TTL. On fetch error, `apiGetBookings()` returns `null` so the caller can preserve existing cached data — but this is RAM-only, lost on reload.
- **manifest.json**: EXISTS — full PWA manifest with `display: standalone`, Ukrainian lang, 192px and 512px icons, theme color `#10B981`. Ready for SW registration.
- **Service Worker**: DOES NOT EXIST — no `sw.js` or `service-worker.js` found.
- **Offline support**: NONE — the app is fully online-dependent. Mutations (`apiCreateBooking`, `apiDeleteBooking`, etc.) return `{ success: false, offline: true }` on network error, but nothing queues or retries them.

## Service Worker Strategy

### App Shell (Cache-First)
Pre-cache on SW install, serve from cache with background revalidation:
- `index.html`
- `css/*.css` (all 10 modules)
- `js/*.js` (all 8 modules: config, api, ui, auth, timeline, booking, settings, app)
- `manifest.json`
- Google Fonts: Nunito (font files + stylesheet)
- `images/` — logo, program icons, favicon set

Cache name versioning: `pzp-shell-v{VERSION}` — old caches cleaned on activate.

### API Data (Network-First with Cache Fallback)
- `GET /api/bookings/*` — network-first; on success cache response in `pzp-api-data`; on failure serve stale cache
- `GET /api/lines/*` — same strategy
- `GET /api/settings/*` — same strategy
- `GET /api/products` — same strategy (longer TTL acceptable, data changes rarely)
- `GET /api/afisha/*` — same strategy

### Never Cache
- `/api/auth/*` — login/token refresh must always hit network
- `/api/telegram/*` — webhook/bot operations
- `/api/backup/*` — backup/restore operations
- `POST/PUT/DELETE` requests — routed to Offline Queue instead

### SW Lifecycle
1. **install** — pre-cache App Shell assets, `skipWaiting()`
2. **activate** — clean old cache versions, `clients.claim()`
3. **fetch** — route to appropriate strategy (shell vs API vs queue)

## Offline Queue

### Storage: IndexedDB
- Database: `pzp-offline-queue`
- Object store: `mutations`
- Schema per entry:
  ```
  {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    method: 'POST' | 'PUT' | 'DELETE',
    url: '/api/bookings',
    body: { ... },
    headers: { Authorization: 'Bearer ...' },
    retryCount: 0,
    status: 'pending' | 'syncing' | 'failed' | 'conflict'
  }
  ```

### Sync Strategy
- Use Background Sync API (`sync` event with tag `pzp-offline-sync`) where supported
- Fallback: on `online` event, process queue sequentially (FIFO order)
- On each replay:
  - If `2xx` — remove from queue, notify UI via `postMessage`
  - If `409 Conflict` — mark as `conflict`, surface to user (ties into Feature #8 optimistic locking)
  - If `401` — token expired, pause queue, prompt re-login
  - If `5xx` or network error — increment `retryCount`, retry with exponential backoff (max 5 retries)

### Conflict Resolution (ties into Feature #8)
- Each queued mutation carries the `version` field from optimistic locking
- On `409`, the SW stores both the local change and server state
- UI presents a conflict resolution modal: "Ваші зміни конфліктують з оновленнями іншого користувача"
- Options: "Перезаписати" (force-put with new version), "Скасувати мої зміни" (discard)

## UI Changes

### Online/Offline Indicator Bar
- Fixed bar at top of viewport (above header), 32px height
- Online: hidden (no bar shown)
- Offline: amber/yellow bar — "⚠ Офлайн-режим — зміни збережуться при відновленні з'єднання"
- Syncing: blue bar — "🔄 Синхронізація змін..."
- Sync error: red bar — "❌ Помилка синхронізації — N змін в черзі"
- Accessible: `role="status"`, `aria-live="polite"`

### "Pending Sync" Badge
- On the header or status area, small badge showing count of queued mutations
- Example: "3 в черзі" pill badge next to date selector
- Tap to view queue details (list of pending operations with timestamps)

### Offline-aware Booking Actions
- When offline, allow creating/editing bookings with visual indicator "буде збережено при підключенні"
- Disable operations that absolutely require server: login, Telegram notifications, backup

## Files to Create/Modify

### New Files
- **sw.js** — Service Worker (root level, next to index.html for max scope)
- **js/offline.js** — IndexedDB queue manager, sync logic, UI indicator control

### Modified Files
- **js/app.js** — Register SW on load, listen for SW messages, init offline indicator
- **js/api.js** — Intercept mutation failures to queue in IndexedDB (or delegate to SW)
- **index.html** — Add offline indicator bar HTML, `<script src="js/offline.js">`, SW registration snippet
- **css/features.css** — Styles for offline indicator bar and sync badge
- **manifest.json** — Potentially add `serviceworker` field if targeting older browsers

---

# Feature #10: WebSocket Live-Sync

## Server

### Library & Setup
- Use `ws` npm package (lightweight, no Socket.IO overhead)
- Attach to existing HTTP server from `app.listen()` in `server.js`
- Path: `wss://domain/ws` (single endpoint)

### Authentication
- JWT auth via query param on connect: `ws://host/ws?token=JWT_TOKEN`
- On connection: verify JWT using same `authenticateToken` logic from `middleware/auth.js`
- Reject with `4001` close code if invalid/expired
- Attach `userId` and `role` to connection metadata

### Broadcast Events
All events use JSON envelope:
```json
{
  "type": "booking:created",
  "payload": { /* booking data */ },
  "meta": { "userId": "...", "timestamp": "..." }
}
```

Event types:
- `booking:created` — new booking added
- `booking:updated` — booking modified (status, time, line, details)
- `booking:deleted` — booking removed
- `booking:moved` — booking drag-dropped to new slot (Feature #14)
- `line:created` / `line:updated` / `line:deleted` — animator line changes
- `settings:updated` — park settings changed (affects all users)
- `user:connected` / `user:disconnected` — presence awareness (optional v2)

### Broadcasting Logic
- After each successful DB commit in routes (bookings, lines, settings), call `wsBroadcast(event, payload, excludeUserId)`
- `excludeUserId` prevents echo to the user who made the change (they already have the response)
- Per-date rooms: clients subscribe to dates they're viewing; only receive events for those dates
- Room management: `JOIN_DATE` / `LEAVE_DATE` client messages

### Connection Management
- Ping/pong heartbeat every 30 seconds to detect stale connections
- Server-side: close connections that miss 2 consecutive pongs
- Track connections in a `Map<userId, Set<WebSocket>>` for targeted messaging
- Max connections per user: 5 (covers multiple tabs/devices)

## Client

### WebSocket Manager (in js/api.js or dedicated js/ws.js)
- Single WS connection per tab
- Connect after successful login, disconnect on logout

### Reconnection with Exponential Backoff
```
Attempt 1: 1s delay
Attempt 2: 2s delay
Attempt 3: 4s delay
Attempt 4: 8s delay
Attempt 5: 16s delay
Max: 30s delay, then retry indefinitely
```
- Reset backoff on successful connection
- Pause reconnection when `navigator.onLine === false` (resume on `online` event — synergy with Feature #9)

### Event Handling
On receiving a WS event:
- `booking:created/updated/deleted/moved` → Invalidate `AppState.cachedBookings` for affected date → Re-render timeline
- `line:*` → Invalidate `AppState.cachedLines` → Re-render timeline
- `settings:updated` → Refresh settings panel if open

### Replace 10-Second Polling
- Currently: `pendingPollInterval` in `AppState` does periodic `apiGetBookings()` every ~10 seconds
- With WS: remove polling entirely; timeline refreshes only on WS push events
- Fallback: if WS disconnects, temporarily re-enable polling until WS reconnects
- Net effect: lower server load, instant updates instead of up to 10s delay

### Multi-Tab Awareness
- Use `BroadcastChannel('pzp-sync')` for cross-tab coordination
- Only ONE tab maintains the WS connection (elected via `SharedWorker` or leader election with `BroadcastChannel`)
- Leader tab relays WS events to other tabs via `BroadcastChannel`
- On leader tab close, another tab takes over WS connection
- Simpler alternative (v1): all tabs connect independently, server handles dedup via `excludeUserId`

## Files to Create/Modify

### New Files
- **services/websocket.js** — Server-side WS setup: auth, rooms, broadcast, heartbeat, connection tracking
- **js/ws.js** — Client-side WS manager: connect, reconnect, event dispatch, multi-tab coordination

### Modified Files
- **server.js** — `const server = app.listen(...)` → pass `server` to `initWebSocket(server)`; mount WS
- **package.json** — Add `ws` dependency
- **routes/bookings.js** — After commit: `wsBroadcast('booking:created', data)`
- **routes/lines.js** — After commit: `wsBroadcast('line:*', data)`
- **routes/settings.js** — After commit: `wsBroadcast('settings:updated', data)`
- **js/api.js** — Remove/conditionally disable polling; integrate WS event callbacks
- **js/timeline.js** — Accept WS-triggered refreshes; animate incoming changes
- **js/app.js** — Init WS after login; teardown on logout
- **index.html** — Add `<script src="js/ws.js">`

---

# Cross-Dependencies

| Feature | Dependency | Details |
|---------|-----------|---------|
| **#4 Graceful Shutdown** | → #10 WS | Graceful shutdown must iterate all WS connections, send `1001 Going Away` close frame, wait for drain, then close HTTP server |
| **#8 Optimistic Locking** | → #9 Offline | Offline queue mutations carry `version` field; on sync, `409 Conflict` triggers conflict resolution UI |
| **#8 Optimistic Locking** | → #10 WS | WS `booking:updated` events carry new `version`; client updates local version cache to avoid stale-version errors |
| **#9 Offline** | → #10 WS | When coming back online: first process offline queue, THEN reconnect WS to get fresh state |
| **#10 WS** | → #9 Offline | If WS disconnects, fall back to polling; if offline, pause WS reconnection entirely |
| **#14 Drag-Drop** | → #10 WS | `booking:moved` event broadcast so other users see the move in real-time on their timeline |

## Implementation Order (recommended)
1. **Feature #10 first** — WebSocket server + client (replaces polling, immediate value)
2. **Feature #9 second** — Service Worker + Offline (builds on WS for reconnection/sync logic)
3. Integration testing — offline → online transition with WS reconnect + queue flush
