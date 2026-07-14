# Rollback v0.79.22 — Стабільний вигляд графіка

## Межа релізу

- Production branch: `codex/performance-hardening`.
- Попередній відомий стабільний реліз: `v0.79.21`, commit `b1498196b1a064a3b00d3a915e657498bb42cdba`.
- Product commit: `92a8e17a0e24b95f227c9a160f52cbb36095ac51` (`fix: stabilize staff schedule visuals`).
- Release commit: `chore: release v0.79.22`.
- Railway settings, secrets, environment variables та deploy branch configuration не входять у rollback.

## Application rollback

Якщо реліз створює блокуючу UI-регресію, виконати reviewable forward revert у тій самій підтвердженій production branch. Не використовувати force-push і не переписувати історію.

1. Read-only підтвердити, що Railway досі deploy-ить `codex/performance-hardening`.
2. Revert release commit, потім product commit, або створити один еквівалентний forward-fix commit.
3. Push виконувати лише в підтверджену deploy branch.
4. Не змінювати Railway settings, secrets, environment variables або ownership сервісів.
5. Після deploy виконати version smoke і read-only Staff Schedule verification.

## Безпека даних

- Цей реліз не містить DB migration і не потребує data rollback.
- Не видаляти `hr_shift_segments`, `hr_shift_segment_roles` або production segment rows.
- Не змінювати segment IDs, attendance, payroll, finance transactions чи booking records під час rollback.
- Не запускати write smoke на реальних працівниках.

## Post-rollback checks

- `/api/version` і login HTML показують очікувану rollback-версію.
- Staff Schedule GET залишається read-only.
- Sticky-колонка не просвічує, а горизонтальний scroll не змінює вертикальну позицію сторінки.
- Department rail залишається доступним на 320–390 px.
- Deep-link focus, dark mode та multi-segment cell presentation не мають блокуючих регресій.
