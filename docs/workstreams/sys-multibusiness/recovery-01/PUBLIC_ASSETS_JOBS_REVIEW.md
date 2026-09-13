# Public / assets / jobs — фактичні межі для RECOVER-02

Source: live `4214598e263057b1cb1524d7fb84f328031d288d`. Жодних public URLs/tokens/provider payloads не експортовано. Це read-only inventory і правила майбутньої реалізації, не approval apply/publication.

| Поверхня | Факт | Правило / наступна перевірка | Статус |
|---|---|---|---|
| Catalog root ownership | 9 roots без owner; точні IDs/назви у private mapping | Власник погоджує business кожного root. Не визначати з назви/creator/порядку | BUSINESS_DECISION_PENDING |
| Children | 17 pages, 8 items, 10 subcategories, 9 settings, 9 page history; перевірені relational orphan counts=0 | Узгоджений owner root успадковують тільки перевірені children; embedded JSON graph додатково перевірити | PARTIAL_OBSERVED |
| Public tokens | 3 токени: у 2 draft та 1 ready каталогу | Live `server.js` GET `/catalog/:slug/:token` перевіряє id+token та active pages, але не root publication status. Не вважати draft приватним. Збереження/відкликання current tokens — рішення власника | DECISION_AND_IMPLEMENTATION_PENDING |
| Publish ingress | `routes/catalogs.js` POST `/:catalogId/public-link` замінює token | Bind business-owned root, explicit publish capability, повний child/asset scope. Ротацію чинних links цим аудитом не дозволено | NOT_MIGRATED |
| Public branding | Live `server.js` catalog HTML має Park address/contact | Business-owned branding до публічності під іншою компанією; не копіювати Park contact автоматично | NOT_MIGRATED |
| Images | 72 `catalog_image_blobs`, key filename; `services/imageStorage.js`, GET/HEAD `/uploads/catalog-images/items/:filename` та static fallback у server.js | Full consumer graph і publication policy мають охопити DB blobs, filesystem fallback, item/gallery/JSON/external refs; token-only protection без static paths недостатня | NOT_MIGRATED |
| Candidate asset graph | Перевірено лише page JSON substring з `/uploads/catalog-images/items/<filename>`; 0 matched assets | Це неповний pattern, НЕ 72 orphaned files. Не delete/reassign; з'ясувати source_url/metadata/item/інших consumers без витоку credential URLs | NOT_TESTABLE_FOR_COMPLETE_GRAPH |
| Automation config | 2 catalog_settings.auto_enabled=true; 0 catalog_automations rows | Назви двох roots у private human table. Простежити фактичного caller/scheduler, owner, recipient, idempotency; flag не доказ traffic | CONFIG_OBSERVED_EXECUTION_UNVERIFIED |
| Hermes jobs | 5 rows already event_genix, ready_for_review/revision_requested | Залишити контекст; source_entity, actorless retries, claims та destination binding перевірити в RECOVER-02. Не replay і не надсилати provider calls у цьому аудиті | CONTEXT_OBSERVED_NOT_END_TO_END |
| Booking templates / recurring | 0 templates/series/skips/instances | Explicit empty snapshot mapping; все одно business-owned creation/children/retry/rollback для нових записів | EMPTY_SNAPSHOT_NOT_FEATURE_PASS |
| HR / payroll / certificates / Art / payments | Потрібні домени ширші за roots collector; наявність organization owner не дозволяє payroll | Зберегти protected contract/domain blockers; не міняти фінансові формули й не вимикати required modules | NOT_MIGRATED_IN_THIS_TASK |

Public live rendering за реальним токеном не виконувався, щоб не розкривати/експортувати токен. Стан визначено з booleans/aggregate SQL і exact-source route review. Authenticated profile/JWT/live lifecycle не зараховані як PASS: middleware має last_seen side effect. Поточна задача не створює fixtures і не змінює production records.

Це доповнення до існуючого RECOVER-02, не новий паралельний план. Required domain HOLD лишається до implementation + isolated/live acceptance; grants/preflight PASS не означає cutover READY.
