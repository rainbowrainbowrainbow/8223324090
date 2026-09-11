# HR-CHK-CI-02 та WALLET-LEDGER-01

Обидва блоки явно дозволені користувачем 2026-09-11. Цей документ уточнює відповідні BLOCKED-пункти попереднього `HR_CHECKLISTS_RESIDUALS_2026-09-11.md`.

## Застосовані зміни

- `.github/workflows/ci.yml`: рівно два HR artifact steps оновлено з `actions/upload-artifact@v4` до `@v7`. YAML перевірено структурно: решта jobs, commands, paths, permissions і налаштувань не змінилася. Node застосунку залишається 22.x / npm 10.x; action використовує власний Node 24.
- `routes/wallet.js`: у чотирьох INSERT журналу додано `username`, отриманий із `users` за тим самим `user_id`. Це starter bonus, daily login та обидві сторони gift transfer. Причина початкових помилок — обов'язковий `coin_transactions.username` не передавався жодним із цих INSERT.
- `tests/integration/wallet-ledger.integration.test.js`: справжні login, HTTP API, поточні Wallet routes та PostgreSQL через наявний ізольований runner; нових залежностей, змін production-схеми або auth немає.

Production impact: no для локальних тестів і feature CI. Production impact: yes при майбутньому випуску Wallet diff. Дозвіл на ці два блоки не запускає production deploy чи операції з реальними монетами.

## Перевірки

- Node 22.23.1 / npm 10.9.8 — PASS.
- YAML parse та порівняння структури workflow із базою — PASS, лише два дозволені action references.
- `npm run check:api-surface`, parser перевірка нового тесту, `git diff --check` — PASS.
- Wallet disposable integration: **9 сценаріїв, 10 Node tests разом із батьківським тестом; 10 PASS, 0 FAIL, 0 SKIP**.

Покриті сценарії:

1. Стартові 500 монет, правильний username, повторний послідовний GET не дублює журнал.
2. Daily login дає 10 монет першого дня; повторні/паралельні запити після отримання не дублюють бонус.
3. Переказ у наявний гаманець: правильні власники обох записів, баланси, earned/spent, history API.
4. Переказ із створенням гаманця отримувача: ті самі гарантії.
5. Відмова запису starter ledger відкочує створення гаманця.
6. Відмова daily ledger відкочує coins, earned, streak і дату.
7. Відмова sender ledger відкочує обидва баланси, створення гаманця отримувача та журнал.
8. Відмова recipient ledger відкочує також уже виконаний sender INSERT.
9. Недостатній баланс і self-transfer з числовим ID повертають 400 та не змінюють даних.

Для fault injection створюються constraint-и тільки в БД, перевіреній disposable runner, і тільки для synthetic fixture ID; кожен видаляється у `finally`. PostgreSQL-кластер після перевірки зупинено. Production credentials не використовуються.

Відтворення на окремій loopback test-БД:

```text
TEST_DATABASE_URL=<disposable loopback database>
TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE
node tests/integration/wallet-ledger.integration.test.js --isolated
```

Runner перевіряє ціль та володіє скиданням disposable schema. Без `--isolated` тест запускається тільки за підтвердженням runner; звичайний `node --test` без цього контексту покаже SKIP, а не доказ перевірки Wallet.

## Докази та межі

- `output/wallet-ledger/results.json`
- `output/hr-checklists-residuals/wallet-ledger-integration.log`
- `output/hr-checklists-residuals/ci-02-local-validation.json`
- Результат GitHub CI та артефакти для точного feature SHA записуються окремо у `output/hr-checklists-residuals/protected-blocks-delivery.json`; відсутність цього файла не означає успішний CI.

Wallet integration не додано до автоматичних jobs: дозвіл HR-CHK-CI-02 обмежений двома action references. Він виконується локальним disposable runner. Наявні HR browser та PostgreSQL jobs залишаються в CI.

`WALLET-HARDEN-02` не входить у погоджені блоки: паралельні перші GET/start bonus, рядковий self-transfer ID, строгі числові поля та calendar/streak boundary залишаються наступною окремою задачею. Цей patch не слід подавати як усунення всіх ризиків Wallet.

Залишки HR: ручні Safari/iOS, NVDA/VoiceOver та повний прохід інших shared-dialog consumers; незмінний snapshot offset pagination потребував би окремого API-рішення. Попередні локальні HR зміни збережено в тій самій ізольованій гілці. Основна брудна робоча копія не змінювалася.

Наступна рекомендована задача — `WALLET-HARDEN-02`, з відтворенням перелічених ризиків і включенням Wallet integration у CI перед production release Wallet.
