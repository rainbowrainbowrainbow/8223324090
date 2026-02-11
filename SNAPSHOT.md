# SNAPSHOT — Park Booking System

> Оновлюється кожні 10-15 повідомлень. Швидкий контекст для продовження роботи.

## Де ми
Версія **v7.3.0**. Афіша в Telegram — **ЗАВЕРШЕНА**.

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

## Що далі (план)
- Тести для афіші в Telegram
- Регулярні заходи (іменинники), задачник, експорт
- Export PDF/Excel

## Технічний стан
- 156/157 тестів (1 flaky — rate limit в auth edge cases)
- Branch: `claude/project-passport-docs-XKYIn`
- Сервер: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql`
- services/bot.js — Clawd Bot command router
- services/templates.js — formatAfishaBlock() для Telegram
- requireRole middleware, canManageProducts/isAdmin helpers

---
*Оновлено: 2026-02-11, після v7.3*
