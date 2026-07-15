# Rollback v0.79.33 — HR ставки та чеклісти

## Коли відкочувати

- migration 294 не завершується на production startup;
- profession workspace повертає системні помилки для ставок, типового часу або чеклістів;
- canonical checklist progress відрізняється між HR, onboarding і Training;
- після deploy з’являється регресія доступу або фактичного графіка/payroll.

## Безпечний rollback

1. Зупинити подальші HR-мутації та зафіксувати deployment/error logs без персональних даних.
2. На підтвердженій Railway source branch `codex/performance-hardening` відкотити лише release/product commits v0.79.33 і дочекатися зеленого CI та redeploy v0.79.32.
3. Перевірити `/api/version`, відкриття HR, структури, profession workspace, Training і read-only доступ.
4. Не видаляти створені checklist items, progress, audit або migration issue rows вручну.

## База даних

Migration 294 є additive й зберігає legacy JSON/progress. Під час аварійного application rollback нові таблиці та nullable references залишаються в БД: старий код їх ігнорує, а фізичний down-migration не виконується. Drop колонок/таблиць або переписування `item_N` допускається лише як окрема погоджена операція після backup і reconciliation report.

## Перевірка після rollback

- production повертає v0.79.32;
- HR-вкладки завантажуються без console/network errors;
- структура, profession links, actual schedule та payroll history не змінені;
- migration 294 у ledger не запускається повторно й не видаляється;
- test records не залишаються активними після QA.
