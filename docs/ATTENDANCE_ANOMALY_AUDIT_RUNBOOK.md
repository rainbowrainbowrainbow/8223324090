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

## Тимчасова read-only роль

Для production audit рекомендовано не видавати постійну роль і не зберігати
`ATTENDANCE_AUDIT_DATABASE_URL`. Dormant operator helper створює короткоживучу
роль, запускає audit і гарантовано намагається видалити роль у `finally`:

```powershell
npm --% run audit:attendance-anomalies:temporary-role -- --from 2026-07-01 --to 2026-07-31 --business-context event_genix --categories late-grace,overtime-grace,legacy-status-conflict,null-zero-negative-late,missing-plan-source --format markdown
```

Helper читає admin connection тільки з
`ATTENDANCE_AUDIT_ADMIN_DATABASE_URL`. Цю змінну повинен завантажити в поточний
operator process затверджений secret manager або локальний захищений secret
loader. Не вводьте URL безпосередньо в команду, не використовуйте `setx` і не
зберігайте значення в repository, CI, artifacts або shell history.

Кожний production provisioning потребує окремого operator/admin authorization.
Helper не змінює Railway secrets або settings.

Тимчасова роль:

- має унікальне ім’я `eg_attendance_audit_<UTC>_<random>`;
- використовує випадковий пароль, який існує лише в пам’яті parent/child process;
- передає PostgreSQL SCRAM verifier замість plaintext password у role DDL;
- має `VALID UNTIL` із default TTL 15 хвилин, максимум 60 хвилин;
- має `NOINHERIT`, `CONNECTION LIMIT 1`, `default_transaction_read_only=on`;
- має `statement_timeout=30s` і `lock_timeout=2s`;
- отримує лише явні `CONNECT`, `USAGE` і `SELECT` на сім таблиць цього audit;
- перед запуском проходить effective-privilege preflight.

Якщо `--categories` не передано, helper сам додає безпечний anomaly-набір:
late grace, overtime grace, legacy status conflict, null/zero/negative late і
missing plan source. Категорія `inferred-profession-card` потребує читання
`hr_shifts`, якої немає в погодженому seven-table scope, тому temporary-role
helper блокує її fail-closed. Її можна перевіряти лише окремим read-only
процесом після явного розширення дозволеного table scope.

`VALID UNTIL` обмежує пароль, але не видаляє PostgreSQL роль. Тому нормальне
завершення завжди виконує та перевіряє cleanup:

1. `ALTER ROLE ... NOLOGIN`;
2. terminate sessions тільки exact generated role;
3. `DROP OWNED BY ... RESTRICT`;
4. `DROP ROLE`;
5. повторний count ролі має дорівнювати нулю.

Cleanup виконується також після audit error, `SIGINT` і `SIGTERM`. `SIGKILL`,
аварія хоста або втрата admin connection можуть перервати `finally`; для цього
існує exact-name recovery:

```powershell
npm --% run audit:attendance-anomalies:temporary-role -- --recover-role eg_attendance_audit_20260719t120000z_0123456789
```

Recovery приймає тільки повне ім’я з generated namespace, не виконує prefix або
broad cleanup і є repeat-safe. Якщо cleanup не підтверджено, команда завершується
з ненульовим exit code; audit не можна вважати успішно закритим до recovery та
перевірки `role count = 0`.
