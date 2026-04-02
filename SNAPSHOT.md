# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v40.4.0**. package.json: `40.4.0`. Бранч `claude/continue-event-genix-crm-k7nfY`.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "40.4.0"`
- **Бранч**: `claude/continue-event-genix-crm-k7nfY`
- **origin/main**: v28.2.0 (далеко позаду — наш бранч має все)
- **Тести**: 387 (346 api.test.js + 41 v40-features.test.js), 0 fail
- **Сесії 27-28.03.2026** (v39.7→v40.4):
  - v39.7.0: prompt→modals (20), streaks, WS alerts, AI covers, Match-3 fix
  - v39.8.0: Interactive alerts v4, staff CRM badges, HR/schedule sync
  - v39.9.0: Security audit (19 routes, 107 err.message, pool leak, XSS, races)
  - v39.10.0: PDF passwords, safeFetch, mobile fix, dashboard 7 widgets
  - v39.11.0: Staff cleanup, add staff button, HR permissions
  - v40.0.0: «Повний контроль» — partial updates, designer fix, center empty states
  - v40.1.0: Pinata date cast, full button audit (400+)
  - v40.2.0: CSS audit (dark mode, iOS zoom, touch targets, lazy loading)
  - v40.3.0: Certs iPhone 11, search+staff, WS toasts, escapeHtml global
  - v40.4.0: Mobile timeline, 41 tests, print CSS, 17 date casts
### Що залишилось доробити:
1. PDF-друк паролів ✅ (v39.10)
2. Мобільний таймлайн ✅ (v40.4)
3. Тести v40 ✅ (41 новий)

### Міграції (останні)
- 132: staff_accounts_linking (реальні співробітники)
- 133: fix_freelance_duplicates
- 134: separate_trampoline_dept
- 135: catalog_enhancements (items, theme, layout_style, public_token, etc.)
- 136: catalog_automations + page history
- 137: fix_catalog_statuses
- 138: cleanup_test_catalogs

### Тести
- **346 тестів** (api.test.js) — 346 pass / 0 fail
- Запуск: `PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node --test tests/api.test.js`

### Ключові архітектурні рішення цієї сесії
- **ai_style з БД** — catalog_definitions.ai_style = single source of truth для AI промптів
- **Транслітерація** — всі Ukrainian→Latin перед відправкою в Kie.ai
- **confirmModal** — замість native confirm() скрізь
- **hashchange listener** — для sidebar tab navigation
- **users.last_seen_at** — оновлюється при кожному auth запиті
- **Sidebar standard** — staff.html = еталон структури для всіх сторінок

## Промпт для наступної сесії
```
Продовження роботи над Event Genix CRM.
Бранч: claude/continue-event-genix-crm-k7nfY
Версія: v40.5.0

Прочитай CLAUDE.md, SNAPSHOT.md, package.json для контексту.

## Що було зроблено (v39.7→v40.5, сесії 27-28.03.2026):
- 21 dashboard widget (7 role-specific)
- Task Lifecycle: health_score, auto-archive, dedup guard (1798→14 задач)
- Security: 19 routes auth, 107 err.message, pool leak, XSS, races
- Role system: security role, creator=full, sidebar sync, 30 labels
- CSS audit: dark mode, iOS zoom, touch targets, lazy loading
- Mobile timeline, сертифікати iPhone 11
- Partial updates bookings/tasks
- PDF passwords, TTS/Suno, alerts v4
- Staff cleanup, Kateryna account, графік 01.04 з паперу
- 387 тестів (0 fail), ~55 комітів

## Production:
- Railway: v40.5.0, DB connected
- Гілка: claude/continue-event-genix-crm-k7nfY (авто-деплой)
```
