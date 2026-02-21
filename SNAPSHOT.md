# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v14.2.0**. Тест 33.

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.0.1–v9.0.2: Staff toolbar fix, accessibility (skip-links, reduced motion)
- v9.1.0: WebSocket live-sync, SessionStart hook
- v10.0.0: Tasker + Клешня — операційний центр
- v10.0.1: Security hotfix (RBAC, input validation)
- v10.1.0: Data integrity (unique indexes, atomic dedup, optimistic locking)
- v10.2.0: Reliability (logging, ROLLBACK safety, graceful shutdown)
- v10.3.0: Особистий кабінет (profile modal)
- v10.4.0: Особистий кабінет PRO (15+ SQL queries, бали, лідерборд, сертифікати)
- v10.5.0: Profile modal на sub-pages (tasks, programs, staff)
- v11.0.0: Kleshnya greeting/chat + перебудований кабінет з 4 табами, 12 досягненнями
- v12.0.0: Дизайн-борд (галерея, колекції, прайс-лист, календар, Telegram)
- v12.1.0: Авто dark mode + мобільний UX + фікси авторизації та скролу
- **v13.0.0: Kleshnya Chat v2 — multi-session + sidebar + media + reactions + WebSocket**
- v14.0.0: Branding Integration
- v14.1.0: Склад (warehouse stock management)
- **v14.2.0: Тест 33**

## Архітектура
- **7 сторінок:** / (таймлайн), /tasks, /programs, /staff, /designs, /invite, /kleshnya
- **Backend:** 18 routes, 13 services, 4 middleware
- **Frontend:** 21 JS + 11 CSS модулів (+ kleshnya-page.js)
- **БД:** ~32 таблиці + chat_sessions + kleshnya_media, 40+ індексів, 5 міграцій
- **11 schedulers**, WebSocket broadcast
- **364 тести** (3 файли + helpers)
- ~47 000 рядків коду

## Kleshnya Chat v2 (v12.8)
- **kleshnya.html** — повний редизайн: sidebar сесій + chat area
- **js/kleshnya-page.js** — вся фронтенд-логіка (sessions, messages, reactions, WS, voice)
- **routes/kleshnya.js** — CRUD sessions, paginated messages, reactions, media proxy, webhook
- **services/kleshnya-bridge.js** — Telegram Bridge для OpenClaw (227 рядків)
- **services/kleshnya-greeting.js** — greeting engine з session support
- **services/websocket.js** — kleshnya:thinking, kleshnya:reply, kleshnya:media events
- **js/api.js** — 10 клієнтських функцій для Kleshnya v2
- **db/migrations/005_kleshnya_chat_v2.sql** — chat_sessions, нові колонки, kleshnya_media

### Фічі фронтенду
1. Sidebar сесій (desktop 280px, mobile overlay)
2. Multi-session: створення, перемикання, перейменування, pin, emoji, видалення
3. Context menu (right-click / long press)
4. Media bubbles (image, audio, video) + captions
5. Reactions (👍/👎) toggle на assistant повідомленнях
6. Generation indicator з progress bar (~30 сек)
7. WebSocket real-time: kleshnya:thinking → typing, kleshnya:reply → message
8. Voice input (Web Speech API)
9. FAB на мобільному для нового чату
10. Dark mode повна підтримка

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх 7 сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто
- Два селектори: `body.dark-mode` + `[data-theme="dark"]`

## Що далі
- Тестування Kleshnya Chat v2 з OpenClaw Bridge
- Swagger /api-docs
- Export PDF/Excel
- Розширення тригерів Клешні

## Технічний стан
- Branch: `claude/continue-project-12.6.0-8O2BS`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-18, v13.0.0*
