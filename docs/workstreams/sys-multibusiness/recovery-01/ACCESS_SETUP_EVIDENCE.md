# SYS-MB-RECOVER-01 — доступ і реальний preflight

Статус: **RECOVER_01_TECHNICAL_COLLECTION_COMPLETE / BUSINESS_DECISIONS_PENDING**. 2026-09-13 UTC.
Production impact: виконано тільки погоджені тимчасові SELECT grants; operational mutations=0.

## Актуальний результат після погодженого блоку

- Grant/collection/retire виконано за 22.467 секунди, 13:03:31.990–13:03:54.457 UTC. Початковий ACL fingerprint відновився точно. Повторна незалежна metadata перевірка: writable=0, inherited roles=0, readable=384. Нових ролей/паролів/settings немає.
- Реальний registry: 1 active organization, 2 active membership-mode businesses (Парк і Дар), 26 organization memberships, 30 business memberships. Один чинний owner, його особу підтверджено membership row і збережено приватно. MD/CRM business records відсутні.
- `ownership-preflight-with-registry.json`: COMPLETE для declared collector scope, ownershipEstablished=false. MD/CRM `*-with-registry.json`: 48/49 observations; останній MISSING_SCHEMA — помилкова вимога `id` для catalog_image_blobs, де ключ filename. Незалежний counts-only ownership collector того самого lease спостеріг 72 blobs. Код виправлено: COUNT не вимагає id, PostgreSQL regression fixture відтворює справжні version/filename поля. Сирі JSON не переписано заднім числом.
- `registry-snapshot.json`, `reviewed-draft-mapping.json`, `legacy-consumers-snapshot.json` у приватній папці. Mapping заповнено actual organization ID, before memberships, reserved logical refs MD/CRM без вигаданих business IDs, 8 explicit proposals і capability deltas. Статус DRAFT_UNAPPROVED, не runnable apply authorization.
- 104 context/access rows (26 accounts × 4 contexts) обчислено офлайн з точних live версій businessContext, businessMembership, accountAccessPolicy, permissionRegistry та buildAuthUserPayload. Context admitted: Парк 26, Дар 4, MD 3, CRM 3. Жодного missing organization membership чи foreign/orphan business membership у registry snapshot. Це DB-backed pure-policy evidence, не HTTP/JWT/domain QA.
- Для чинного owner пропозиція operational director прибирає `/maysternya-doli` у live page registry; окреме делегування потрібне до cutover. Для чинної директорки role/page/action mask збережено без added capabilities. Технічному Hermes не додаємо MD/CRM. Призначення іншого creator-акаунта потребує бізнес-відповіді.
- Публічність, assets/jobs і точні remaining boundaries — `PUBLIC_ASSETS_JOBS_REVIEW.md`. Запитано один людський пакет рішень; SQL/env/JSON від користувача не потрібні.
- Поточні перевірки цього продовження: 9 unit/policy tests PASS, 10 disposable PostgreSQL cutover tests PASS (включно cleanup). Попередні 25 PASS збережено як prior-stage evidence, не видаються за повторний запуск. Новий snapshot collector реально успішно виконався через readonly production role.

Далі — тільки бізнес-рішення й незалежна реалізація RECOVER-02 за його scope. Технічного блокера доступу більше немає. Grant block закрито; migration/owner/membership apply не виконувалися. Нижче збережено історію підготовки до цього блоку.

## Історія до тимчасового GRANT (не поточні blockers)

## Checkpoint

- Ізольований worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-recover-01-20260913`.
- Гілка: `codex/sys-mb-recover-01-20260913`; база `827b7ab4d0a9fa50a04dcb7c93d4392513c50f81`.
- Live і remote production: `4214598e263057b1cb1524d7fb84f328031d288d`, `codex/eventgenix-production`, v0.81.153, «Рішення щодо legacy-матеріалів Design Board». `live-version.json` містить відповідь GET /api/version.
- Target: fortunate-appreciation / production / 8223324090. Production PostgreSQL service: `e2aa25d8-29bc-4cdb-99e7-4ebdf5fa5fe6`.
- Поточний SYS-MB candidate не опублікований. Не було commit/push/deploy, migration/bootstrap або змін operational записів.

## Доступ організовано агентом

Secrets завантажено лише process-local з погодженого credential store. Існуюче `TASK_AI_ROLLOUT_DATABASE_URL` перевірене як SELECT-only source; після перевірки явно використане в `MULTIBUSINESS_AUDIT_DATABASE_URL` поточного процесу. App DATABASE_URL, Railway settings і persistent env не змінювалися.

Порівняння з `railway variables --service Postgres --environment production --json` відбулося лише в пам'яті: host/port/database audit source збігаються з DATABASE_PUBLIC_URL. Значення не збережено. Endpoint hash: `6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd`.

`audit-source.json`: немає superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, inherited membership, DB CREATE/TEMP чи schema CREATE; 0 writable/owned tables, 0 writable sequences. Readable 384 із 399 public relations. Немає executable SECURITY DEFINER user functions. Перевірено 52 executable user functions: volatile trigger functions, read-only next_chat_seq і pg_stat_statements/info; reset недоступний. Функції не викликалися. Це перевірка придатності наявного audit source, не твердження, що його історичні 384 SELECT grants мінімальні саме для SYS-MB.

`TRUSTED_QA_OPERATOR_DATABASE_URL` виявився write-capable superuser. Через нього перевірено лише metadata, не читали operational rows і не запускали collectors. Він НЕ є readonly fallback. Новий lease `plan` використовує саме audit source; operator URL потрібний тільки для окремо погодженого GRANT/REVOKE.

Відсутні SELECT рівно на `public.organizations`, `public.businesses`, `public.organization_memberships`, `public.business_memberships`. Нова роль/пароль не потрібні. Точний план з role/target/fingerprint hashes: `read-lease-plan.json`.

## Реально зібрано

- MD/CRM: по 44/49 declared observations. Чотири registry/module/membership/default observations очікують SELECT; ще одна missing-schema observation не прирівнюється до нуля. Повний domain inventory ширший за ці 49.
- Ledger справді має `357_organizations_business_memberships`; `363_multibusiness_cutover_journal_telemetry` відсутня. Історичне посилання на «migration 356 memberships» неправильне: 356 — omni_whatsapp_channel.
- Майстерня: 14 bookings, 8 customers, 8 leads, 6 tasks, 2 products, 1 timeline resource. CRM: 1 task. Нуль у решті перевірених таблиць не означає непотрібність модуля.
- 11 MD booking product references і 4 lead product references не знайшли products parent. Це може бути чинний external-code contract; не виправляли й не називали доведеними сиротами без перевірки адаптера.
- 9 catalog definitions, 17 pages, 72 image blobs; durable owner columns відсутні. 3 tokens існують (значення не читалися); 2 auto_enabled settings. Catalog automations, booking templates, recurring templates/skips порожні.
- 5 Hermes jobs уже мають event_genix; payload, claim tokens, recipients і provider credentials не читалися.
- 4 relevant active accounts → 8 draft rows для MD/CRM. Для кожного бізнесу 3 legacy-potential access і 1 assigned-but-denied. Два акаунти мають global creator, що не визначає business owner/operational роль.

Legacy policy виконано із точного live commit через `git show`, а не з відмінного local candidate. Це potential legacy policy; поточну membership-effective authorization ще не доведено. Collector `source=OPERATOR_SELECTED_DATABASE_NOT_INDEPENDENTLY_ATTESTED` лишено чесним; окрема Railway target attestation наведена вище.

## Приватні артефакти

`C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913/draft-mapping.json` — заповнені IDs, before access arrays/defaults, proposals і unresolved owners. Це draft envelope, НЕ runnable approved apply mapping.

`C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913/OWNER_DECISIONS_REVIEW_PRIVATE.md` — людська таблиця з конкретними іменами акаунтів і каталогів.

Папка поза Git/web root, Windows ACL inheritance вимкнено, доступ тільки поточному користувачу й SYSTEM. JSON не містить password hashes, emails, телефони, tokens, URLs, job payloads, фінансові суми або клієнтські записи. Публічний summary і SHA256 — `draft-summary.json`.

## Помилки collectors і перевірки

1. Symptom: ownership collector завершується 42501 на registry без SELECT. Expected: unavailable metrics з null плюс незалежні counts. Root cause: metadata враховувала schema/RLS, але не SELECT. Додано fail-closed visibility classification до читання таблиць і dependent joins.
2. Symptom: migration observation MISSING_SCHEMA при наявному ledger. Root cause: hardcoded filename замість фактичного version. Виправлено collector, повторний production read підтвердив membershipSchemaApplied=1, journal=0.

PASS: 16 focused unit tests; 1 справжній PostgreSQL lease integration; 8 PostgreSQL ownership collector tests. Node Windows 22.23.1, WSL 22.22.2, PostgreSQL 16. Обидві disposable test DB/roles прибрані тестовими finally. Runtime check і git diff --check PASS. Це не live membership QA.

Не запускали login/profile чи browser lifecycle: authenticated GET може мати last_seen/enrollment side effects; повний role/profile proof лишається NOT_TESTABLE до дозволеного безпечного snapshot/lifecycle. Жодних provider calls, генерації, export або lifecycle writes не виконано.

## Наступний крок

Єдиний технічний дозвіл — `AUDIT_READ_GRANT_BLOCK.md`. Після нього агент сам виконує тимчасовий GRANT, readonly registry/profile snapshot і collectors, доповнює human mapping, REVOKE у finally та перевіряє відновлення прав. Власник не налаштовує SQL/env/JSON. Бізнес-рішення залишаються окремими людськими рішеннями; grant не авторизує cutover або призначення owner.
