# SNAPSHOT — Event Genix CRM

> Швидкий контекст для продовження роботи. Деталі → PROJECT_PASSPORT.md, зміни → CHANGELOG.md, план покращень → ROADMAP.md

## Де ми
Версія **v39.9.0**. package.json: `39.8.0`. Бранч `claude/continue-event-genix-crm-k7nfY`.

## Актуальний стан

### Версія та бранч
- **package.json**: `"version": "39.8.0"`
- **Бранч**: `claude/continue-event-genix-crm-k7nfY`
- **origin/main**: v28.2.0 (далеко позаду — наш бранч має все)
- **Зміни v39.1.0-v39.7.0** (сесія 27.03.2026):
  - v39.1.0: Графік — реальні 65 співробітників + зв'язка акаунтів CRM
  - v39.2.0: Графік підгрупи + іконки + CSV експорт + друк
  - v39.2.1: Графік UX polish — unset статус, trampoline chip, час 10-20
  - v39.3.0-v39.4.0: Каталоги повний редизайн (5 етапів): картки, inline edit, Image2Image, drag-n-drop, public links, автоматизації, bulk gen, version history
  - v39.4.1: Bugfixes — sidebar navigation, team online, catalog clicks
  - v39.5.0: System-wide: confirm→confirmModal (15), -webkit-backdrop-filter (45), error handling (15 fixes), task edit modal, warehouse hash
  - v39.5.1: Image generation error handling + debug log + smart AI prompts
  - v39.6.0: System consistency — 10 HTML sidebar fixes, profileModal на 17 pages, skip-links, headers, ?v= tags
  - v39.7.0: 5 features — prompt→modals (20), streaks by profession, WS alerts, catalog AI covers, Match-3 fix
  - v39.9.0: Interactive alerts v4 (grouped, inline actions, dismiss), staff CRM badges on all lists

### Що залишилось доробити:
1. Bulk create: PDF-друк паролів

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
