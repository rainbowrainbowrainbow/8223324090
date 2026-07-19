# Post-activation payroll reconciliation

- Дата аудиту: `2026-07-18`
- Середовище: production
- Production build: `v0.79.66 — Simultaneous Pay QA Cleanup Reliability`
- Deployed commit: `7324398413dc75b07a40af44a56476a9a6e64897`
- Effective date: `2026-07-18`
- Policy: `simultaneous-profession-pay-v1`
- Production impact: yes

## Метод

Аудит виконано двома незалежними read-only шляхами:

1. PostgreSQL-транзакція `REPEATABLE READ READ ONLY`.
2. Авторизовані `GET` endpoints schedule, attendance, HR salary та payroll preview.

Прямий SQL перевірив усі `hr_shift_segment_roles` без верхнього обмеження дати,
починаючи з `2026-07-18`. Для payroll reports враховано лише незакриті періоди,
активні `draft` reports без `voided_at`. ПІБ, телефони, ставки, суми та
ідентифікатори у результат не включалися.

Жодні schedule, attendance, profession rates, payroll reports, periods, payroll
entries або payment records не змінювалися.

## Policy state

| Перевірка | Кількість |
| --- | ---: |
| Compensation policies у таблиці | 1 |
| Активна очікувана policy з effective date `2026-07-18` і multiplier `1.0` | 1 |

## Paid-role rows

| Перевірка | Кількість |
| --- | ---: |
| `paid_hourly` rows до effective date | 0 |
| `paid_hourly` rows від effective date | 0 |
| Працівники, яких стосуються paid rows | 0 |
| Paid rows із пов'язаним attendance | 0 |

### Blocker categories

| Category | Кількість |
| --- | ---: |
| `PAID_ROLE_MISSING_PROFESSION_RATE` | 0 |
| `PAID_ROLE_MISSING_POLICY_VERSION` | 0 |
| `PAID_ROLE_POLICY_VERSION_INVALID` | 0 |
| `PAID_ROLE_MISSING_COMPENSATION_SNAPSHOT` | 0 |
| `PAID_ROLE_INVALID_COMPENSATION_SNAPSHOT` | 0 |
| `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED` | 0 |
| `PAID_ROLE_PROFESSION_MISSING_FROM_HR_CARD` | 0 |
| `PAID_ROLE_ASSIGNMENT_NOT_ACTIVE_APPROVED` | 0 |

Категорії мають нульове значення тому, що на момент snapshot у production немає
жодної збереженої `paid_hourly` ролі, а не тому, що невалідні rows були
проігноровані.

## Attendance before and after activation

Дата поділу визначена за `record_date` у payroll policy.

| Attendance group | Records | Із snapshot | Без snapshot | Із paid allocation | Manual review |
| --- | ---: | ---: | ---: | ---: | ---: |
| До `2026-07-18` | 184 | 0 | 184 | 0 | 0 |
| Від `2026-07-18` | 15 | 1 | 14 | 0 | 0 |

Чотирнадцять post-effective attendance records без snapshot не є paid-role
blockers: на відповідні дати немає `paid_hourly` rows і жоден snapshot не містить
simultaneous additional allocation. Вони залишаються base-only records і не мають
отримувати ретроактивну додаткову оплату.

Водночас це operational warning: canonical snapshot coverage після activation
становить лише `1/15`. Причину створення решти 14 records поза snapshot flow
потрібно дослідити окремо без автоматичного backfill.

## Open payroll periods and draft reports

| Перевірка | Результат |
| --- | --- |
| Поточний payroll period | `2026-07`, відкритий |
| Draft reports у `2026-07` | 0 |
| Current July preview blocking issues | 0 |
| Інші відкриті draft periods | `2026-05` |
| Draft reports у `2026-05` | 64 |
| Stored blocking issues у May drafts | 0 |

HR salary view показує лише 54 із 64 May drafts. Решта 10 належать freelance
staff, яких salary query виключає на рівні `active_staff`. У таблиці немає
orphan reports або reports із відсутньою staff-карткою.

## Readiness

Найближчий payroll `2026-07` готовий до read-only розрахунку з точки зору
post-activation simultaneous-pay reconciliation:

- paid-role blockers: `0`;
- current preview blockers: `0`;
- current draft reports: `0`;
- period open: yes.

Цей висновок описує production snapshot на момент аудиту. Він не гарантує
готовність після появи нової `paid_hourly` ролі.

## Статус follow-up після production-релізів

Початкові findings вище залишаються історичним snapshot `v0.79.66`. Вони не є
описом поточного runtime. Усі три follow-up закриті окремими additive змінами:

| Finding | Поточний production-контракт |
| --- | --- |
| Непідтримувані payroll-схеми могли виглядати як `0` | Закрито: `hybrid`, `percent`, `manual` повертають `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED`; generation і commit fail closed |
| 14 post-effective attendance records не мали snapshot | Джерело встановлено: старий Hermes direct-insert path. Supported writers переведені на canonical snapshot flow; автоматичного payroll backfill не погоджено |
| 10 freelance May drafts не були видимі в active-staff rows | Закрито: вони залишаються окремими від active staff і відображаються агрегованим warning `PAYROLL_FREELANCE_DRAFTS_EXCLUDED_FROM_ACTIVE_STAFF` |

Чинна payroll matrix:

| Scheme | Simultaneous additional pay |
| --- | --- |
| `hourly` | Base без змін + explicit snapshot hourly line |
| `per_shift` | Shift amount без змін + explicit snapshot hourly line |
| `monthly_fixed` | Monthly amount без змін + explicit snapshot hourly line |
| `hybrid`, `percent`, `manual` | Fail closed; blocker замість валідної нульової суми |

Policy `simultaneous-profession-pay-v1` активна від `2026-07-18` за Kyiv
`record_date`; multiplier `1.0`. Finalized attendance snapshot є джерелом
additional minutes і ставки. Legacy rows без snapshot використовують лише
base-only fallback і не отримують ретроактивну доплату.

## Follow-up: freelance draft reporting

The follow-up read-only audit classified all 64 stored May drafts:

| Classification | Count |
| --- | ---: |
| Regular staff drafts | 54 |
| Freelance drafts | 10 |
| Missing staff card | 0 |
| Unclassified drafts | 0 |

The reporting contract now keeps the 10 freelance drafts outside active-staff salary rows and exposes them
through the aggregate reconciliation warning
`PAYROLL_FREELANCE_DRAFTS_EXCLUDED_FROM_ACTIVE_STAFF`. No historical draft was deleted, regenerated, or
mixed into active-staff payroll.

## Follow-up: attendance snapshot writer source and post-fix delta audit

Status update after the canonical writer work:

| Item | Status |
| --- | --- |
| Source of the 14 post-effective records without snapshot | Completed: all 14 were Hermes import records created by the old direct `INSERT INTO hr_time_records` path |
| Hermes writer remediation | Completed: `services/hermesAttendanceImport.js` now writes through the canonical attendance clock-in flow |
| Other supported attendance writers | Completed: terminal status, leave approval, no-show scheduler, auto-close, correction, QA helper and clock-in/out paths are covered by canonical snapshot handling |
| Historical 14 records | Intentionally unchanged; no backfill or retroactive payroll recalculation was performed |
| Post-fix proof | Use `scripts/audit-attendance-snapshot-writers.js --release-gate` with the exact CI/Railway deploy-completed cutoff timestamp |

The original counts in this document remain a pre-fix/pre-delta snapshot. They
must not be reused as a current release gate by checking whether the total is
still `14`. The current gate must split records by `created_at` deployment cutoff
and verify that the post-fix cohort has:

- `missingSnapshots = 0`;
- `paidAllocationWithoutValidFinalSnapshot = 0`;
- `unknownWriters = 0`;
- complete query/classification metadata.

The audit remains read-only and aggregate-only. It must not output staff names,
staff IDs, attendance IDs, notes, audit payloads, rates, amounts, or production
identifiers.

### Post-fix delta audit result

The post-fix attendance snapshot release gate was run read-only with cutoff
`2026-07-18T12:17:59Z` from deployment status evidence for the release that
contains the canonical writer fix.

Current aggregate result:

| Check | Count |
| --- | ---: |
| Policy attendance records from `2026-07-18` | 15 |
| With compensation snapshot | 15 |
| Without compensation snapshot | 0 |
| Post-fix records | 0 |
| Post-fix missing snapshots | 0 |
| Post-fix paid allocation without valid final snapshot | 0 |
| Post-fix unknown writers | 0 |

Release gate: `passed`.

No production data was changed by this audit. The original 14-record finding
remains a dated pre-fix audit snapshot and should not be rewritten; the fact that
current production no longer shows those rows as missing snapshots is a separate
history question, not authorization for backfill or payroll recalculation.
