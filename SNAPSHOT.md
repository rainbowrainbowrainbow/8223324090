# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v18.3.0**. Demo-режим + Packages + ROADMAP 30-day plan 100% ✅.

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
- v10.3.0–v10.5.0: Особистий кабінет PRO + profile на sub-pages
- v11.0.0: Kleshnya greeting/chat + перебудований кабінет
- v12.0.0: Дизайн-борд
- v12.1.0: Авто dark mode + мобільний UX
- v13.0.0: Kleshnya Chat v2 — multi-session + sidebar + media + WebSocket
- v14.0.0–v14.4.0: Branding, Warehouse, тести
- v15.0.0: HR Module — повний HR-блок
- v15.1.0: CRM Phase 2 — клієнтська база, фільтри, RFM, ДН, сертифікати, експорт
- v16.0.0: Finance Module — каса, P&L, зарплати, категорії, автозапис, CSV
- v16.1.0: Analytics v2 — єдиний дашборд (bookings + finance + HR + CRM)
- v16.2.0: Swagger API Docs — /api-docs, OpenAPI 3.0, 136 ендпоінтів
- v17.0.0: Export Excel/PDF + Бюджетне планування + Система закупок
- v17.1.0: AI Team редизайн — акордеон-панелі, журнал, відправка на завдання
- v17.4.0: Світлана Task Bot live
- v17.8.0: Multi-agent workflow rules (CLAUDE.md)
- v17.9.0: ROADMAP Week 1 — API Audit + Backup Verify + System Status
- v17.10.0: Digital Worker Forge v1 + Backup failure alerts
- v18.0.0: Sidebar Navigation — вертикальне бокове меню на всіх сторінках
- v18.1.0: Центр керування — Digital Workers, KPI, Price Matrix, задачі, звіт
- v18.2.0: Art Director v1 — Brand Memory, 10 шаблонів, Content Pipeline, Approval Workflow
- **v18.3.0: Demo-режим + Packages — 5 сценаріїв, 3 пакети, 15 feature flags**

## Що нове (поточна сесія)
### Demo-режим & Packages — v18.3.0
- **Нова сторінка /demo** — 3 вкладки: Демо-сценарії, Пакети, Feature Flags
- **5 демо-сценаріїв** — booking_flow, print_cert, hr_shift, boss_kpi, art_content
- **Scenario player** — покрокова навігація з progress tracking і рейтингом
- **3 пакети** — Starter (2 990 ₴/міс, 200 бронювань, 3 workers), Business (7 990 ₴, безліміт, 10 workers), Lite (990 ₴, без AI)
- **15 feature flags** — per-package контроль модулів (demo_mode, crab_chat, art_director, finance, hr, warehouse, ...)
- **Demo login** — гостьовий JWT (viewer, 2h) з трекінгом сесій
- **Міграція 013** — 4 таблиці: packages, feature_flags, demo_scenarios, demo_sessions

### Art Director v1 — v18.2.0
- **Нова сторінка /art-director** — контентний конвеєр з 4 вкладками
- **Огляд** — стан конвеєра (draft/review/approved/rejected/published), останні зміни, терміновий контент
- **Конвеєр (Kanban)** — дошка з колонками (чернетка → перевірка → затвердження → публікація), фільтри по категорії/пріоритету/пошуку
- **Шаблони** — 10 seed шаблонів парку (poster_a4, ig_story, ig_post, tg_post, cert_birthday, cert_gift, banner_site, flyer_a5, menu_board, sticker_pack), фільтрація по категоріях
- **Brand Book** — Brand Memory: кольори (#10B981, #059669, #6366F1, #F0FDF4, #EF4444), шрифти (Nunito), тон, правила логотипу/емоджі/цін

### Backend
- **routes/art-director.js** — 15 ендпоінтів (overview, brand CRUD, templates CRUD, content CRUD + status change + history)
- **Міграція 012** — 4 таблиці: brand_guidelines, content_templates, content_items, content_approvals
- **Approval workflow** — валідація переходів статусу (draft→review→approved→published), повний лог в content_approvals
- **13 seed brand guidelines** — кольори, шрифти, тон, правила
- **10 seed content templates** — з JSON fields схемою

### Navigation
- **Art Director у sidebar** — 🎬 додано на всі 13 сторінок (admin only)

## Архітектура
- **15 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /analytics, /invite, /kleshnya, /warehouse, /center, /art-director, /demo
- **Backend:** 31 routes, 16 services, 5 middleware
- **Frontend:** 26 JS + 11 CSS модулів
- **БД:** ~60 таблиць, 55+ індексів, 13 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **291 тестів** (3 файли + helpers)
- ~58 000 рядків коду

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто

## Що далі (ROADMAP.md)
- **Week 1 ✅:** Повністю завершено (аудит, verify, status, алерти)
- **Week 2 ✅:** Digital Worker Forge v1
- **Week 3 ✅:** Demo-режим + пакети/ліміти
- **Week 4 ✅:** Boss v1 (Center) + Art Director v1
- **30-day ROADMAP: 100% COMPLETE**

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-25, v18.3.0*
