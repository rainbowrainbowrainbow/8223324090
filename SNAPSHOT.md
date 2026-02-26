# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v19.8.0**. Charts, Loyalty & Search — глобальний пошук, програма лояльності, промокоди, графіки Chart.js, автозвіт.

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
- v19.0.0: Event Queue, Rule Engine, Print & Assets, Employee Mapping, Support/SLA, Music Center
- v19.1.0: Deep Integration — EventBus, Rule Engine v2, SLA auto-breach, Activity tracking
- v19.2.0: Light UI — collapsible sidebar, light design, dashboard widgets, task overdue, retention
- v19.3.0: UI Polish — white header, unified buttons, dark mode fixes, loading states, print styles
- v19.4.0: Micro-Animations — stagger effects, touch feedback, theme transitions, skeleton loaders
- v19.5.0: Clean UI — emoji cleanup, nav-icon system, category dots, mobile text fix
- **v19.6.0: Global Search — Cmd+K modal, fuzzy search across bookings/customers/tasks/programs**
- **v19.7.0: Loyalty & Discounts — loyalty tiers, promo codes, discount proposals, birthday discounts**
- **v19.8.0: Charts & Reports — Chart.js dashboard, auto-report Telegram, send report button**

## Що нове (поточна сесія) — v19.6.0–v19.8.0

### v19.6.0 — Global Search
- Cmd+K / Ctrl+K — відкриває модальне вікно пошуку
- Пошук по бронюваннях, клієнтах, задачах, програмах (fuzzy ILIKE)
- Keyboard навігація: ↑↓ стрілки, Enter для переходу, Escape для закриття
- Результати згруповані по типам з кольоровими badge
- Навігація до результату: бронювання → таймлайн, клієнт → сторінка, задача → дошка
- Backend: routes/search.js — паралельні SQL запити з лімітом
- Frontend: js/search.js — debounced input (200ms), highlight animation
- CSS: features.css — overlay, container, results, dark mode

### v19.7.0 — Loyalty & Discounts
- **Loyalty Tiers**: Новий(0%), Постійний(5%), VIP(10%), Premium(15%)
  - Автоматичний перерахунок по total_bookings + total_spent
  - UI в Центрі з кольоровими картками і кількістю клієнтів
- **Discount Codes**: CRUD для промокодів
  - Типи: percent (%) або fixed (₴)
  - Валідація: активність, дати, ліміт використань, мін. замовлення, категорія
  - UI з формою додавання, статусами (активний/закінчився/неактивний)
- **Discount Proposals**: спеціальні пропозиції
  - Сегменти: всі, нові, постійні, VIP, під ризиком, іменинники
  - Прив'язка до промокодів, кольорові банери, дати дії
- Migration: db/migrations/017_loyalty_discounts.sql
- Backend: routes/loyalty.js (15 endpoints)
- Frontend: center-page.js — render + CRUD

### v19.8.0 — Charts & Reports
- **Dashboard Charts** (Chart.js 4.4.7 via CDN):
  - Виручка за тиждень (bar chart)
  - Бронювання за тиждень (line chart)
  - Топ програми (doughnut chart)
  - Завантаженість по днях тижня (bar chart)
  - Dark mode адаптація кольорів
- **Auto-Report Telegram**:
  - Scheduler: checkAutoReport — щоденний звіт о auto_report_time
  - Налаштовується через settings: auto_report_chat_id, auto_report_time
  - Формат: дата, бронювання, виручка, сер. чек, топ програми, задачі
- **Send Report Button**: кнопка в Центрі для ручного надсилання дайджесту

## Архітектура
- **16 сторінок**, **38 routes**, 17 services, 5 middleware
- **~87 таблиць**, 77+ індексів, 17 міграцій
- ~70 000 рядків коду

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`

---
*Оновлено: 2026-02-26, v19.8.0*
