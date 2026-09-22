# Meta names: handoff задачі 1

## Стан репозиторію

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\omni-meta-profile-names`.
- Branch: `codex/omni-meta-profile-names`.
- HEAD/upstream/live SHA: `7095178709951a63e73decb340ddbe7b5076b185`.
- Live: v0.82.4, branch `codex/eventgenix-production`.
- Підготовлений продуктовий diff залишено незакоміченим без змін чужого root
  checkout. Його резервна patch-копія збережена локально в ignored `.codex-temp`.
- Commit, push, deploy і production UPDATE не виконувалися.

## Точний read-only scope

Business: `event_genix`.

| Канал | Точний native `created_at::text` | Унікальність |
| --- | --- | --- |
| Facebook | `2026-09-20 15:12:32.92626` | рівно 1 |
| Instagram | `2026-09-21 14:02:59.33485` | рівно 1 |

У виборі не використовувалися довільні Unknown, `LIMIT 1` або JavaScript Date.
Внутрішні/external/Page IDs існували лише в пам'яті процесу.

Combined diagnostic digest:
`d91fc01bc75376b253d5d6278214860c63226084f0e244269d97939b9d475e76`.

Instagram recovery digest для задачі 3:
`839180666f8eb8f6fc78554fa78bd4aeb927019194d20c13df87d8103766adcb`.

## Результат Instagram

До GET пройшли:

- absolute-path/output-directory preflight;
- санітизований report write/read;
- fail-closed `STARTED` marker;
- inspect-only provenance без Meta request.

Виконано рівно один канонічний GET з полями `name,username` через чинне scoped
підключення. Санітизований результат:

- `READY`;
- success=true;
- exact returned/requested profile ID match;
- name присутнє;
- username присутній;
- production writes=0.

Бюджет нових GET цієї задачі: **1/1 використано**. Попередній невдалий запуск
залишається окремо врахованим як один запит із невідомим результатом. Повторів
після успішного звіту не було. Ім'я, username, токен і raw IDs не публікувалися.

## Результат Facebook

Підтверджено:

- точний business/channel/timestamp;
- sender = conversation external ID;
- recipient = Page ID чинного Facebook connection;
- webhook message ID = stored external message ID;
- echo відсутній;
- інший Facebook-профіль через те саме business/channel connection раніше був
  доступний;
- профіль цього чату раніше стабільно повернув `PROFILE_OBJECT_UNAVAILABLE`
  (Graph 100/subcode 33).

Не підтверджено причину недоступності. Meta for Developers у доступному браузері
відкрився на сторінці входу; авторизованого сеансу немає. Тому не перевірені
видимість конкретного діалогу, App Mode, App Review/Advanced Access і Business
Asset User Profile Access. Це blocker для перевірки, а не доказ несправного
токена, неправильного ID або відсутності конкретного permission.

Наступна адресна перевірка: власник входить у Meta for Developers/Business Suite,
після чого read-only звіряються правильна Page, видимість саме цього діалогу,
Live mode та фактичний статус потрібного profile-access feature. Нічого не
змінювати за припущенням.

## Передача задачі 2/3

Instagram готовий до bounded recovery. Майбутній apply повинен:

1. Перед GET знову перевірити точний digest і поточне blank/Unknown ім'я.
2. Повторно звірити business, channel, conversation identity, connection binding
   і returned profile ID.
3. Використати канонічний name, а username — тільки fallback.
4. Змінити лише `customer_name` і стандартний `updated_at` умовним UPDATE.
5. Пропустити запис при ручному/конкурентному перейменуванні або будь-якій
   відмові Meta.

Apply потребує окремої production-write авторизації та нового bounded GET.
Facebook не включати до відновлених профілів без нових доказів доступності.

Відкриті питання:

- фактичний App Mode/App Review/Business Asset User Profile Access для Facebook;
- чи видимий проблемний діалог під правильною Page у Business Suite;
- окремий дозвіл задачі 3 на один Instagram UPDATE і потрібний apply GET.
