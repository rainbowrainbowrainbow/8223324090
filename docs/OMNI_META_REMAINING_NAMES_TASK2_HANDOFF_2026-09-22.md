# Meta names: handoff задачі 2

## Репозиторій і межі

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\omni-meta-profile-names`.
- Branch: `codex/omni-meta-profile-names`.
- База змін і перевірений live SHA на початку задачі:
  `7095178709951a63e73decb340ddbe7b5076b185`.
- Exact SHA локального продуктового commit передається у фінальному звіті задачі;
  у worktree його можна отримати командою `git rev-parse HEAD`.
- Push, deploy, Meta GET і production UPDATE у задачі 2 не виконувалися.
- Version/cache markers не змінювалися; release bump залишається окремим commit
  задачі 3.

## Результат реалізації

- Instagram profile lookup бере справжнє `name`, а за його відсутності —
  валідний `@username`. Blank/Unknown, окремий `@` і malformed username
  відхиляються; кілька початкових `@` нормалізуються до одного.
- Canonical adapter, exact returned profile-ID check, business/channel binding,
  відповідний Page token, timeout, response-size limit, concurrency, cooldown і
  dedup залишилися єдиним шляхом для inbound enrichment та bounded repair.
- Inbound message зберігається до lookup. Відмова Meta не блокує webhook,
  delivery або notification.
- Conditional UPDATE змінює лише blank/Unknown `customer_name` і повторно звіряє
  conversation ID, business, channel та external profile ID. Ручне або
  конкурентне перейменування зберігається.
- Список, відкритий заголовок, avatar і assistant використовують однаковий
  fallback. Scoped numeric ID показується як технічна частина fallback і не
  видається за Instagram-тег. Assistant label не дублює назву каналу.
- Нова lead draft не отримує Unknown як ім'я або scoped ID як Instagram.
  Валідний збережений `@handle` заповнює лише поле Instagram. Ручні поля відкритої
  чернетки зберігаються під час фонового refresh списку.
- Історичні записи залишаються під контролем наявного bounded repair. Нових API,
  scheduler, queue, масового backfill, schema, dependency або settings немає.

## Змінені файли

- `services/omni-facebook-profile.js`
- `omni.html`
- `tests/omni-facebook-profile.test.js`
- `tests/omni-meta-name-repair.test.js`
- `tests/omni-workspace-behavior.test.js`
- `docs/OMNI_FACEBOOK_PROFILE.md`
- `docs/OMNI_META_REMAINING_NAMES_ANALYSIS_2026-09-22.md`
- `docs/OMNI_META_REMAINING_NAMES_TASK1_HANDOFF_2026-09-22.md`
- `docs/OMNI_META_REMAINING_NAMES_TASK2_HANDOFF_2026-09-22.md`

## Перевірка

Node 22.23.1 / npm 10.9.8:

```powershell
npm run check:runtime
node --test tests/omni-facebook-profile.test.js tests/omni-meta-profile-adapters.test.js tests/omni-meta-name-repair.test.js tests/omni-workspace-behavior.test.js
node --test tests/omni-lead-assistant.test.js tests/omni-hardening.test.js tests/omni-inbox.test.js tests/omni-completion.test.js tests/omni-history-pagination.test.js
npm run check:version
npm run test:ui
git diff --check
```

Результати:

- runtime: pass;
- profile/adapters/repair/workspace: 157/157 pass;
- lead/hardening/inbox/completion/history: 91/91 pass;
- version consistency: pass;
- static UI: 1320/1320 pass; frontend code-splitting: 4/4 pass;
- whitespace check: pass.

Focused покриття включає Facebook success, Instagram name/`@username`, empty
profile, returned-ID mismatch, Meta 100/33, timeout, business isolation,
правильний token/Page context, manual rename race, dry-run/apply guards,
idempotent rerun, Meta failure без втрати inbound та UI refresh із збереженням
ручних значень.

## Передача задачі 3

Read-only діагностика задачі 1 встановила:

- новий Instagram-профіль доступний, має exact ID match та name+username;
- recovery scope digest:
  `839180666f8eb8f6fc78554fa78bd4aeb927019194d20c13df87d8103766adcb`;
- combined diagnostic digest:
  `d91fc01bc75376b253d5d6278214860c63226084f0e244269d97939b9d475e76`;
- дозволений у задачі 1 бюджет використано: 1/1 Meta GET, production writes 0;
- Facebook-профіль лишається `PROFILE_OBJECT_UNAVAILABLE` (Graph 100/33).

Для Facebook підтверджено коректний sender/external ID, recipient/Page binding і
message provenance. Причина недоступності об'єкта не доведена. Авторизованого
Meta Dashboard/Business Suite сеансу не було, тому App Mode, App Review/Advanced
Access, Business Asset User Profile Access і видимість конкретного діалогу не
перевірені. Не виправляти ID або permission за припущенням.

Задачі 3 потрібно: звірити актуальний upstream/live, інтегрувати цей локальний
commit, підготувати окремий patch release/version commit, отримати green CI для
exact release SHA, виконати штатний manual Railway deploy, а потім повторити
bounded dry-run/apply лише в уже авторизованих production межах. Недоступний
Facebook-профіль пропустити з точним safe code; не оголошувати його відновленим.
