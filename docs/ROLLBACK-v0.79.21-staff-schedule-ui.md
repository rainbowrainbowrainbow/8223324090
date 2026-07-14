# Rollback v0.79.21 — Охайний графік персоналу

## Межа релізу

- Production branch: `codex/performance-hardening`.
- Попередній відомий стабільний реліз: `v0.79.20`, commit `d4754bc383b8f72d18ba208ab5d4486e2e3c29d0`.
- Product commit: `6e987dceafc2300df477433c982f021361a92db1` (`fix: polish staff schedule presentation`).
- Release commit: `chore: release v0.79.21`.
- Railway settings, secrets, environment variables та deploy branch configuration не входять у rollback.

## Application rollback

Якщо реліз створює блокуючу UI-регресію, зробити reviewable forward revert у тій самій підтвердженій production branch. Не виконувати force-push і не переписувати історію.

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
- Короткі періоди мають рівні day columns, а status cells не містять подвійних рамок.
- У «Всі» headcount не дублює працівника з кількома професіями.
- Сегменти відображаються хронологічно та не втрачають additional roles.
- Deep-link focus, dark mode і mobile 320–390 px не мають блокуючих регресій.
