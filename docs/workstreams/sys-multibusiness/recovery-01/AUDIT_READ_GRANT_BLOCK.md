# Запропонований SYS-MB-AUDIT-READ-GRANTS

**AUTHORIZED / EXECUTED / RETIRED. Production impact: yes, тільки privileges.**

Погоджено повідомленням користувача «ок дозволяю працюй». Виконано 2026-09-13T13:03:31.9899547Z–13:03:54.4568710Z (22.467 секунди). Retirement PASS, початковий ACL fingerprint відновлено точно; readable tables повернулися до 384, writable=0, inherited roles=0. Докази: `read-lease-execution.json`, `read-lease-retired-plan.json`, `audit-source-after-retirement.json`. Приватний receipt збережено; SHA256 у поточному verification manifest. Повторний apply цим блоком не дозволено.

Мета: завершити readonly registry preflight без нового пароля або використання superuser для operational читань.

- Target: fortunate-appreciation / production / Postgres service `e2aa25d8-29bc-4cdb-99e7-4ebdf5fa5fe6`; application 8223324090.
- Джерело ролі: існуюче перевірене `TASK_AI_ROLLOUT_DATABASE_URL`; role hash `940efc5d4989b4cdd1d23b40678c2fec953499bd4b3d6ecb2856374d8719d857`.
- Endpoint hash `6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd`.
- Початковий ACL fingerprint `78b71644d422a521c9d2f6be540dc7e8010037c83be6491a25bb3da993a057a9`.
- Script: `scripts/sys-mb-audit-read-lease.cjs`; точний SHA256 у `VERIFICATION_MANIFEST.json`.
- Scope: тимчасовий `GRANT SELECT` без grant option лише на public.organizations, public.businesses, public.organization_memberships, public.business_memberships. На них немає credential values. Нові DB role, login, password, CONNECT/USAGE/default grants не створюються.
- Operator credential використовується тільки для catalog metadata, GRANT/REVOKE. Operational data читається окремими connections з verified audit source у READ ONLY transactions.
- Вікно блоку: до 30 хвилин після GRANT; одна apply-спроба, повторні readonly collection дозволено. Це operator retirement deadline, PostgreSQL сам не підтримує TTL таблицевих grants; не називати його автоматичним expiry.
- До apply повторно звірити target, role, ACL, script hash і privileges. Scope/ACL drift — STOP без обходу.
- Receipt у ACL-restricted private directory записується до COMMIT; approval reference — конкретне повідомлення користувача. Ні credentials, ні receipts з role ACL не в Git.
- Після collection REVOKE тільки grants цього receipt, у finally. Crash recovery: прочитати receipt, виконати retire; repeated retire/no-op протестовано. При сторонній ACL зміні fail closed, без широкого REVOKE; окремо повідомити про невідкликані grants.
- Без operational INSERT/UPDATE/DELETE, owner bootstrap, membership apply, deploy, schema changes, provider calls, password або Railway settings changes.

## Перевірено до питання

Dry-run plan проти справжнього audit source визначив тільки ці чотири таблиці. Focused unit tests перевірили approval/state drift, role flags, receipt failure, scope tampering, retry/retirement. Реальний локальний PostgreSQL 16 підтвердив GRANT SELECT, denied INSERT (42501), збереження попереднього SELECT, no-op apply, idempotent retirement, ACL drift refusal і rollback при disk failure після GRANT. Нові test DB/role видалені після тесту.

## Агент виконає після одного дозволу

1. Підхопить secrets локально; збере повторний plan без друку значень; перевірить відповідність цьому manifest.
2. Запише approval reference/expected fingerprint/role hash у process-local env; виконає script apply з private receipt.
3. Збере bounded registry/org/business/member/module/default snapshot, доповнить before→after/access matrix і людський пакет. Повторить існуючі collectors. Ідентичності й mapping — лише private artifacts.
4. У finally виконає script retire, перевірить початкові effective grants і відсутність write прав. Збере receipt hashes/evidence і новий manifest.
5. Покаже один завершений пакет бізнес-рішень, без вимог налаштовувати SQL/env/JSON вручну.

Підстава для одного дозволу: поточний запит дозволяє readonly аудит, але прямо вимагає окремої згоди перед provisioning; AGENTS захищає permissions changes. Наявні попередні release blocks не поширюються автоматично на цю DB роль. Це не tool auto-review rejection.
