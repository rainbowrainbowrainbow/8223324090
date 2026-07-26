# Attendance anomaly audit runbook

Цей runbook описує ручну read-only перевірку нових attendance-записів на правила,
які суперечать актуальному attendance contract. Команда нічого не виправляє,
не створює scheduler і не має режиму auto-fix.

## Власник і періодичність

- Власник щомісячної перевірки: Director / Сергій.
- Рекомендована періодичність: один раз на місяць після завершення календарного місяця.
- Якщо результат має severity `high`, його повинен окремо переглянути відповідальний
  за HR/payroll до будь-якого рішення про виправлення даних.

## Безпечний доступ

Команда приймає рівно одну з двох змінних:

- `ATTENDANCE_AUDIT_DATABASE_URL`;
- `PRODUCTION_READONLY_DATABASE_URL`.

Роль PostgreSQL повинна:

- мати `default_transaction_read_only = on`;
- не мати `INSERT`, `UPDATE`, `DELETE` або `TRUNCATE` на attendance, audit і payroll-таблицях;
- мати короткий строк дії;
- надаватися через захищене локальне сховище секретів.

Команда fail-closed блокує `DATABASE_URL`, `ATTENDANCE_DATA_FIX_DATABASE_URL`,
generic `PG*` variables та всі write flags. Не передавайте connection string у
командному рядку, документації, CI logs або artifacts.

## Ручний запуск

Приклад перевірки за місяць:

```powershell
npm --% run audit:attendance-anomalies -- --from 2026-07-01 --to 2026-07-31 --business-context event_genix --categories late-grace,overtime-grace,legacy-status-conflict,null-zero-negative-late,missing-plan-source --format markdown
```

Для машинної обробки використовуйте `--format json`. Вивід завжди aggregate-only:
без імен працівників, staff IDs та attendance record IDs.

`--%` потрібен у Windows PowerShell, щоб він не видалив імена CLI flags.
У `cmd.exe`, Bash або CI використовуйте звичайний формат:

```bash
npm run audit:attendance-anomalies -- --from 2026-07-01 --to 2026-07-31 --business-context event_genix --categories late-grace,overtime-grace,legacy-status-conflict,null-zero-negative-late,missing-plan-source --format markdown
```

## Категорії

| Категорія | Що знаходить | Впливає на severity/payroll overlap |
| --- | --- | --- |
| `late-grace` | `status='late'` і `late_minutes` від 1 до 5 | Так |
| `overtime-grace` | `overtime_minutes` від 1 до 15 | Так |
| `legacy-status-conflict` | legacy `status`, який суперечить фактичним хвилинам | Так |
| `null-zero-negative-late` | `status='late'` з `NULL`, 0 або від’ємними хвилинами | Так |
| `missing-plan-source` | немає валідного source у першому clock-in audit | Ні, статистика |
| `inferred-profession-card` | source може бути inferred з snapshot | Ні, статистика |

`legacy-status-conflict` не вважає помилкою відсутність одного статусу при
комбінованій події. Наприклад, день може одночасно мати late та early leave,
тому аналітика не повинна вимагати, щоб legacy `status` описував обидва факти.

## Severity

- `none_detected` — у вибраному діапазоні немає attendance anomalies.
- `warning` — anomalies є, але немає overlap із protected payroll.
- `high` — anomalies перетинаються з locked, reviewed, approved або paid payroll.

Missing plan source та inferred profession card не підвищують severity.

## Дії після перевірки

1. Зберегти лише aggregate результат у захищеній owner-facing нотатці.
2. Для `none_detected` зафіксувати дату перевірки й завершити процедуру.
3. Для `warning` перевірити причину та створити окрему задачу; дані не виправляти автоматично.
4. Для `high` зупинити будь-який data-fix до фінансового погодження.
5. Не запускати historical write tooling без окремого dry-run manifest і explicit approval.

Scheduler та auto-fix навмисно не входять у цей runbook. Їх додавання потребує
окремого погодження production config, read-only credential lifecycle,
notification destination та retention policy.
