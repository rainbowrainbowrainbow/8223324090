# SNAPSHOT — Park Booking System

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md

## Де ми
Версія **v16.0.0**. Finance Module.

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
- **v16.0.0: Finance Module — каса, P&L, зарплати, категорії, автозапис, CSV**

## Архітектура
- **10 сторінок:** / (таймлайн), /tasks, /programs, /staff, /hr, /designs, /customers, /finance, /invite, /kleshnya
- **Backend:** 19 routes, 13 services, 4 middleware
- **Frontend:** 23 JS + 11 CSS модулів
- **БД:** ~34 таблиці (+ finance_categories, finance_transactions), 50+ індексів, 5 міграцій
- **13 schedulers** (+ birthday greetings), WebSocket broadcast
- **261 тестів** (3 файли + helpers)
- ~51 000 рядків коду

## Finance Module (v16.0)
- **finance.html** — сторінка з 4 табами (дашборд, транзакції, місячний звіт, зарплати)
- **js/finance-page.js** — фронтенд: CRUD, фільтри, графіки, CSV-експорт
- **routes/finance.js** — CRUD categories + transactions, dashboard, P&L monthly, salary report, CSV export
- **db/index.js** — finance_categories, finance_transactions, bookings.payment_method, certificates.value_uah
- **routes/bookings.js** — автозапис income transaction при підтвердженому бронюванні
- **services/booking.js** — mapBookingRow + paymentMethod
- **Категорії:** 12 початкових (Бронювання, Сертифікати, Кафе, МК, Інший дохід, Зарплата, Оренда, Закупки, Реклама, Комунальні, Обслуговування, Інші витрати)
- **Методи оплати:** cash, card, transfer, mixed
- **Навігація:** посилання "Фінанси" на всіх 10 сторінках

## Dark Mode (v12.1+)
- `initDarkMode()` в config.js — єдина функція для всіх 10 сторінок
- Авто: темна 20:00–07:00, світла 07:00–20:00
- Ручний toggle зберігається в localStorage і перезаписує авто
- Два селектори: `body.dark-mode` + `[data-theme="dark"]`

## Що далі
- Тестування Kleshnya Chat v2 з OpenClaw Bridge
- Swagger /api-docs
- Export PDF/Excel
- Розширення тригерів Клешні
- Бюджетне планування (план vs факт)

## Технічний стан
- Branch: `claude/bump-version-0.1-lj64Q`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- SessionStart hook: `.claude/hooks/session-start.sh`

---
*Оновлено: 2026-02-22, v16.0.0*
