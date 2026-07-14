# Rollback v0.79.23 — Читабельні назви відділів

## Межа релізу

- Production branch: `codex/performance-hardening`.
- Попередній стабільний реліз: `v0.79.22`, commit `ddc7f9a812fac483f4500692c9588bef64da3a0a`.
- Product commit: `ea3c4c187` (`fix: keep schedule department labels readable`).
- Release commit: `chore: release v0.79.23`.
- Railway settings, secrets, environment variables і deploy branch configuration не входять у rollback.

## Application rollback

Якщо реліз створює блокуючу UI-регресію, виконати reviewable forward revert у тій самій підтвердженій production branch. Не використовувати force-push і не переписувати історію.

1. Read-only підтвердити, що Railway досі deploy-ить `codex/performance-hardening`.
2. Revert release commit, потім product commit, або створити один еквівалентний forward-fix commit.
3. Push виконувати лише в підтверджену deploy branch.
4. Не змінювати Railway settings, secrets, environment variables або ownership сервісів.
5. Після deploy виконати version smoke і read-only Staff Schedule verification.

## Безпека даних

- Реліз не містить DB migration і не потребує data rollback.
- Не видаляти `hr_shift_segments`, `hr_shift_segment_roles` або production segment rows.
- Не змінювати segment IDs, attendance, payroll, finance transactions чи booking records під час rollback.
- Не запускати write smoke на реальних працівниках.

## Post-rollback checks

- `/api/version` і login HTML показують очікувану rollback-версію.
- Staff Schedule GET залишається read-only.
- Назви відділів, caret і лічильники не перекриваються на desktop та 320/360/390 px.
- Sticky-колонка, today-column, dark mode і горизонтальний scroll не мають блокуючих регресій.
- Browser smoke та live read-only Staff Schedule smoke проходять без mutation requests.
