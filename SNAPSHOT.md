# SNAPSHOT — Park Booking System

> Оновлюється кожні 10-15 повідомлень. Швидкий контекст для продовження роботи.

## Де ми
Версія **v7.5.0**. Задачник MVP — **ЗАВЕРШЕНА**.

## Що готово
- v5.30–v5.38: UI/UX overhaul (design system, responsive, dark mode, PWA)
- v5.39–v5.41: Bugfixes, Security, Performance
- v5.42–v5.48: Design System v4.0 + Integration
- v5.49–v5.51: Program Search, Duplicate Booking, Undo
- v6.0: Test Mode (безпарольний вхід, тимчасовий)
- v7.0: Product Catalog MVP (програми в БД, API read-only)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, role manager, product form)
- v7.2: Clawd Bot (7 Telegram-команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування про завтра)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси, пріоритети, фільтрація)

## Що далі (план)
- Зв'язок афіша → завдання (автоматичне створення)
- Clawd Bot команди для задач (/tasks, /done)
- Експорт блоків
- Export PDF/Excel

## Технічний стан
- Branch: `claude/project-passport-docs-XKYIn`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- routes/tasks.js — CRUD + PATCH status, фільтрація, сортування
- services/bot.js — Clawd Bot command router
- services/templates.js — formatAfishaBlock() з розділенням подій/іменинників
- afisha.type: event | birthday | regular
- tasks.status: todo | in_progress | done
- tasks.priority: low | normal | high

---
*Оновлено: 2026-02-11, після v7.5*
