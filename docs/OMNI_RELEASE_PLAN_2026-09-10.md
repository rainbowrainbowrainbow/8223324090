# Omni: підготовлений план випуску

Production impact: yes. **Цей документ є планом, а не дозволом або доказом deploy.**

## Перевірена база

- Production version: `0.81.89`.
- Live `/api/version` та remote production ref: `a493fe33be17d5bdcb5ebd6e32b515e3148bbb22`.
- Source/destination: `codex/eventgenix-production`.
- Railway: `fortunate-appreciation`, project `bc28b46c-d4bc-491c-893a-d8401c633668`, environment `production` / `d9f9b984-d54d-4620-a8bf-c48882ad5158`.
- Service: `8223324090` / `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`.
- Domain: `https://8223324090-production.up.railway.app`.
- Робочий пакет: `.worktrees/omni-inbox-ready`, detached на перевіреному SHA, локальні зміни Omni. `git apply --3way` переніс пакет з v0.81.88 без конфліктів. Зміни каси v0.81.89 збережено.

## Пакет

Повний статус і невиконані можливості описані в [аудиті](OMNI_AUDIT_2026-09-10.md). До випуску входять тільки його реалізовані зміни, тести та release hygiene. Нових міграцій, нових залежностей і змін lockfile за залежностями немає. Наступний номер версії визначається повторною перевіркою production безпосередньо перед випуском; попередній кандидат — `0.81.90`.

## Межі майбутнього дозволу

`OMNI-INBOX-RELEASE`: дозволені лише reviewed Omni-зміни поверх `a493fe33be17d5bdcb5ebd6e32b515e3148bbb22` і їх release/versioning commit, push у перевірену production-гілку, exact-SHA CI, до трьох випусків/локальних hotfix цього пакета через `release:railway-up`, version proof і read-only live QA. Тривалість — до завершення або шести годин після отримання дозволу. Drift гілки, SHA, сервісу чи обсягу потребує нового preflight; не перезаписувати паралельні зміни.

Не входять: міграції, production secrets/env/settings, керування зовнішніми акаунтами, реальні вихідні повідомлення, платні SMS, створення/редагування реальних бізнес-записів. Mark-read та зміна статусу також є записом: read-only browser QA має блокувати POST/PATCH/PUT/DELETE, крім входу тестового акаунта. Для живого send/read/status canary потрібні окремо названі тестовий діалог і дозволені дії.

## Виконання після дозволу

1. Повторно звірити live version/SHA, remote ref і Railway identity. Якщо live просунувся, зберегти пакет і спочатку сумістити його з новою базою.
2. Окремо зафіксувати reviewed Omni product diff; окремо зробити patch version/cache sync, українські `CHANGELOG.md` та changelog modal. Залежності не змінювати.
3. Push лише підтвердженої гілки; дочекатися всіх обов’язкових CI для точного SHA. При fail спочатку діагностувати.
4. `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production` передати процесу `npm run release:railway-up`. Використати явний project ID; не запускати raw `railway up`.
5. Перевірити `/api/version`, SHA, branch, login/assets та read-only TG/Всі, перемикання, канали/стан, permissions, відсутність JS errors, 1440/390 px. Надсилання клієнтам не виконувати.

## Відкат

Попередній live SHA — `a493fe33be17d5bdcb5ebd6e32b515e3148bbb22`. Відкат коду — через стандартний manual release helper із цим точним SHA та branch; без reset/force-push і без відкату/видалення даних. У пакеті немає нових міграцій. Зберегти історичний rollback ref `codex/checkbox-hardening-release-v080103`.

## Текст рішення власника

УВАГА · OMNI-INBOX-RELEASE

Дія: опублікувати перевірений пакет виправлень Omni поверх актуальної production-бази.

Наслідки:
1. Діалоги залишаються ручними, без старої зовнішньої AI-автовідповіді.
2. Зміняться фільтри, історія, прочитане, менеджери та робота з вхідними вкладеннями.
3. Запрацюють виправлені перевірки доступу, підписів, дублів та квитанцій.
4. Випуск пройде через commit, push, CI, manual Railway deploy та read-only live QA.
5. Непідключені канали не стануть підключеними; реальних повідомлень і платних SMS не буде.

Межі: гілка, SHA, сервіс, дії, строк і три спроби — як описано вище; без production data/settings/secrets змін.
Відкат: попередній live SHA через стандартний helper, без змін даних.
Потрібний дозвіл: «Дозволяю блок OMNI-INBOX-RELEASE».

Підстава окремого дозволу: [Production Autonomy Runbook](CODEX_PRODUCTION_AUTONOMY.md), розділ Yellow: “One named authorization envelope is required” для production push і manual deploy. Дозвіл на локальне виправлення доступу та webhook вже отримано; цей дозвіл повторно не запитується.
