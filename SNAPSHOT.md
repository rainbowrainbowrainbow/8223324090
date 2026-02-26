# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v20.5.0**. Master TZ виконано повністю (v20.1.0–v20.5.0).

## Що готово (коротко)
- v5.30–v5.51: Design System v4.0, responsive, dark mode, PWA, security, performance
- v6.0: Test Mode
- v7.0–v7.6: Каталог, Clawd Bot, Афіша, Задачник, auto-tasks
- v7.8–v7.9: Standalone pages, мобільна адаптація, дошка задач
- v8.3–v8.6: Автоматизація, сертифікати, розумний розподіл
- v9.0: DnD, recurring bookings, analytics, offline, migrations
- v9.1.0: WebSocket live-sync, SessionStart hook
- v10.0.0–v10.5.0: Tasker, Kleshnya, Security, Data Integrity, Reliability, Profile
- v11.0.0: Kleshnya greeting/chat
- v12.0.0–v12.1.0: Design board, auto dark mode
- v13.0.0: Kleshnya Chat v2
- v14.0.0–v14.4.0: Branding, Warehouse, тести
- v15.0.0–v15.1.0: HR Module, CRM Phase 2
- v16.0.0–v16.2.0: Finance, Analytics v2, Swagger
- v17.0.0–v17.10.0: Export, Budget, Procurement, AI Team, Task Bot, Worker Forge
- v18.0.0–v18.4.0: Sidebar Nav, Center, Art Director, Demo/Packages, Leo v2, Status Page
- v19.0.0–v19.17.0: Event Queue, Rule Engine, Deep Integration, UI Polish, Search, Loyalty, Charts, Backend Hardening, Room Load Panel, Query Optimization, Smart Updates, Input Hardening, Concurrency Safety, Caching Layer, Monitoring
- **v20.0.0: Milestone Release**
- **v20.0.1: Backup Fix + Test Deploy**
- **v20.1.0: Role System — 10 ролей, матриця доступу, захист сторінок, user management API**
- **v20.2.0: Floating Command Panel — KPI dashboard, quick notes, draggable**
- **v20.3.0: Navigation — unified sidebar, Center tabs (Finance/Analytics/Status), Art rename**
- **v20.4.0: Staff Trainer — Telegram weekly prompts, review system, training.html**
- **v20.5.0: Sales Techniques — call script, upsells, free slots, price-per-child, reviews**

## Що нове (поточна сесія) — v20.1.0–v20.5.0

### v20.1.0 — Role System
- 10 ролей: creator, director, vice_director, senior_manager, manager, admin, senior_instructor, instructor, animator, waiter
- PAGE_ACCESS + ACTION_PERMISSIONS матриця
- LEGACY_ROLE_MAP для зворотної сумісності
- /api/users — CRUD для керування користувачами

### v20.2.0 — Floating Command Panel
- Плаваюча панель з KPI (бронювання, персонал, задачі, виручка)
- Quick Notes CRUD
- Draggable, collapsible, позиція в localStorage

### v20.3.0 — Navigation
- js/components/sidebar.js — єдиний компонент навігації
- Center поглинає Finance, Analytics, Status як вкладки
- /art-director → /art з 301 redirect
- program_price_rules таблиця

### v20.4.0 — Staff Trainer
- 3 таблиці: staff_training_inputs, training_materials, training_prompts_sent
- Щопонеділка 09:00 Kyiv — Telegram prompt усім staff
- Щоп'ятниці 17:00 Kyiv — зведення Сергію
- training.html — UI з матеріалами, фільтрами, pending review
- Авто-категоризація за ключовими словами

### v20.5.0 — Sales Techniques (Якуба)
- Скрипт дзвінка (7 кроків) у формі бронювання
- Каталог апсейлів (торт, фото, декор, аніматор, сувеніри)
- Лічильник вільних вихідних
- Ціна за дитину
- Відгуки по програмах (з notes бронювань)

## Архітектура
- **16+ сторінок**, **40+ routes**, 18+ services, 5 middleware
- **~90+ таблиць**, 80+ індексів, 23 міграцій
- ~73 000+ рядків коду
- 291 тестів, 0 fail

## Технічний стан
- Branch: `claude/event-maestro-crm-m3Jlp`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`

---
*Оновлено: 2026-02-26, v20.5.0*
