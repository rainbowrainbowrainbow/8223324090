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

## Окремі follow-up задачі

1. Завершити й окремо доставити fail-closed blocker
   `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED`. У production `v0.79.66`
   цього guard ще немає; поточний нульовий результат пояснюється відсутністю paid
   rows.
2. Read-only відтворити джерело 14 post-effective attendance records без
   compensation snapshot. Не виконувати backfill без окремого погодження.
3. Узгодити поведінку HR salary view для 10 freelance May drafts: показувати їх у
   reconciliation view або явно винести в окремий агрегований warning. Не
   перегенеровувати й не видаляти reports у межах цієї задачі.
