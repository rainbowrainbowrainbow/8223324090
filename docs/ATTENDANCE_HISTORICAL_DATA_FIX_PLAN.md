# Historical attendance data-fix plan

Цей документ описує безпечний підхід до можливого перерахунку старих attendance/payroll записів після уніфікації attendance-логіки. Поточний статус: **read-only audit only**. Жоден historical data-fix не є частиною attendance-релізу без окремого бізнес-погодження.

## Що перевіряє read-only audit

Скрипт:

```bash
node scripts/audit-attendance-historical-impact.js --format markdown
```

Підтримувані фільтри:

```bash
node scripts/audit-attendance-historical-impact.js \
  --from 2026-01-01 \
  --to 2026-07-31 \
  --business-context event_genix \
  --format json
```

Джерело підключення:

- `ATTENDANCE_AUDIT_DATABASE_URL`
- `PRODUCTION_READONLY_DATABASE_URL`
- `DATABASE_URL`
- або стандартні `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`

Скрипт відкриває `BEGIN READ ONLY`, перевіряє `transaction_read_only = on` і не має write/apply режиму. Прапорці `--apply`, `--fix`, `--write`, `--execute`, `--update` навмисно блокуються.

Якщо connection URL не заданий, `PGDATABASE` є обовʼязковим. Це не дає audit випадково підʼєднатися до неочікуваної default PostgreSQL бази.

Audit рахує:

- `status = 'late'`, але `late_minutes <= 5`;
- `overtime_minutes` у межах `1–15`;
- records із `clock_in`, для яких не знайдено валідний `plan_source` у першому `clock_in` audit;
- records, які reports зараз трактують як inferred `profession_card` через snapshot `planned_start/planned_end` без HR shift;
- періоди payroll, де є такі candidate records;
- чи є повʼязані `payroll_reports`, closed/paid reports або locked payroll periods.

## Як читати impact report

Основні секції:

- `overview` — загальна кількість `hr_time_records` у фільтрі.
- `metrics` — кількість rows по кожній категорії ризику.
- `auditPlanSourceBreakdown` — які `plan_source` реально є в `hr_audit_log.details`.
- `inferredProfessionCardAuditBreakdown` — скільки inferred `profession_card` rows мають або не мають audit source.
- `payrollImpact` — місяці, candidate records, payroll reports, locked/paid indicators.

Ризик для payroll:

- `none_detected` — не знайдено payroll reports для candidate records.
- `low` — є payroll reports, але немає closed/paid/locked ознак.
- `medium` — є reviewed/approved reports.
- `high` — є paid reports або locked payroll period.

## Data-fix strategy, якщо бізнес погодить

Write-mode має бути окремою задачею, окремим PR/commit і окремим explicit approval. Мінімальна безпечна стратегія:

1. Зафіксувати scope:
   - date range;
   - business context;
   - які категорії виправляємо: late grace, overtime grace, plan source metadata, inferred source.
2. Зняти backup:
   - `hr_time_records`;
   - `hr_audit_log`;
   - `payroll_reports`;
   - `payroll_period_locks`;
   - повʼязані finance salary transactions, якщо payroll вже committed.
3. Запустити dry-run write planner:
   - показує точні candidate IDs;
   - показує old/new values;
   - показує payroll periods, які будуть зачеплені;
   - не виконує `UPDATE`.
4. Заборонити автоматичні зміни для:
   - paid payroll reports;
   - locked payroll periods;
   - records без зрозумілого rollback payload.
5. Для дозволеного scope виконати transaction:
   - `BEGIN`;
   - lock тільки потрібних rows;
   - write audit event із before/after snapshot;
   - update тільки погоджених полів;
   - read-back verification;
   - `COMMIT`.
6. Rollback plan:
   - rollback SQL/script із backup snapshots;
   - повторний read-only audit після rollback;
   - заборона повторного apply без нового approval string.

## Що не робити

- Не запускати mass update по всій історії без date range.
- Не змінювати paid або locked payroll periods автоматично.
- Не вважати legacy `status` єдиним джерелом аналітики.
- Не додавати DB schema/migration у цю read-only задачу.
- Не змішувати historical data-fix із поточним attendance-релізом.

## Production rule

Поточний read-only audit дозволений для оцінки impact. Будь-який write-mode потребує окремої задачі з явним текстом погодження від owner/business.
