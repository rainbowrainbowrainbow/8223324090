# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v19.2.0**. Light UI — легкий дизайн, складна панель, розширені віджети.

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
- v19.1.0: Deep Integration — EventBus, Rule Engine v2 (real actions), SLA auto-breach, Activity tracking
- **v19.2.0: Light UI — collapsible sidebar, light design, dashboard widgets, task overdue, retention**

## Що нове (поточна сесія) — v19.2.0

### 1. Light Sidebar
- Білий фон замість темно-зеленого градієнта
- Легкий бордер + мінімальна тінь
- Кольори тексту з design tokens (gray-600, primary для active)

### 2. Collapsible Sidebar
- Кнопка згортання внизу сайдбару (◀ Згорнути)
- Collapsed: 64px ширина, тільки іконки
- Стан зберігається в localStorage (`pzp_sidebar_collapsed`)
- Header і main-content автоматично адаптуються

### 3. Dashboard Widget Cards
- Quick stats bar перероблений з простого тексту в картки
- Бронювання, дохід, підтверджені, попередні, аніматори
- Асинхронно підвантажуються задачі та сертифікати
- Респонсив: 2 колонки на мобілці, auto-fit на десктопі

### 4. Lighter Design
- Body background: #F8FAFC (чистий сірий замість градієнту)
- Header: легший зелений градієнт (#059669 → #10B981)
- Control panel: shadow-xs замість shadow-sm
- Sidebar shadow: мінімальна (1px 0 8px rgba(0,0,0,0.04))

### 5. Task Overdue Auto-detect (scheduler)
- checkTaskOverdue: щохвилини перевіряє прострочені задачі
- Автоматично змінює status на 'overdue'
- Публікує event `task.overdue` через EventBus

### 6. Customer Retention (scheduler)
- checkCustomerRetention: щоденно о 09:00
- Знаходить клієнтів без візитів 60+ днів
- Логує в customer_retention_log (міграція 016)
- Публікує event `customer.retention`

## Архітектура
- **16 сторінок**, **37 routes**, 17 services, 5 middleware
- **~82 таблиці**, 75+ індексів, 16 міграцій
- ~67 000 рядків коду

## Технічний стан
- Branch: `claude/continue-deployment-v18-6LOJW`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=127.0.0.1 PGPASSWORD=postgres`

---
*Оновлено: 2026-02-26, v19.2.0*
