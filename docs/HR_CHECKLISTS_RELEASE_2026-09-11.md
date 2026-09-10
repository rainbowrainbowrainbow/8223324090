# HR Checklists — підготовка production-релізу 2026-09-11

Production impact: yes. Користувач прямо доручив «роби: Push, merge і deploy». Це продовження готового CHK-01–CHK-06, не запуск CHK-F01–F06 або інших CRM задач. Попередній локальний звіт `HR_CHECKLISTS_CHK_2026-09-10.md` описує стан до цього дозволу; його заборона доставки історична.

## Межі CHK-RELEASE-20260911

- Source: `codex/hr-checklists-theme-20260910`; destination: `codex/eventgenix-production`.
- Підтверджена production-база: `3312ace2b5dbe18eda11fd865e6a6218212ff23d`, v0.81.94. Fetch, live `/api/version` і Railway status збігаються.
- Product commit: `806fc72f92fe133103311ae1b98dca69f3ce4882`.
- Merge актуальної бази без конфліктів: `5ed5a345f65e2a58129e28c44c210a38eabc6d70`.
- Candidate: v0.81.95 / HR Checklists Theme. Release commit додає штатні cache/version markers і українські release notes.
- Railway: `fortunate-appreciation`, project `bc28b46c-d4bc-491c-893a-d8401c633668`, environment `production`, service `8223324090` / UUID `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`.
- Домен: `https://8223324090-production.up.railway.app`.
- Не більше 6 годин від поточного дозволу, максимум 3 спроби. Push без force; deploy тільки після зеленого CI точного release SHA через `release:railway-up`.
- Нових міграцій немає. Auth, права, залежності, production settings/secrets і бізнес-правила не змінені. Package-lock містить тільки оновлення номера релізу.
- Live QA: read-only тестовим акаунтом; browser requests запису блокуються. Створення, редагування й видалення production-бізнес-записів не входять у цей реліз.
- Спільний dirty checkout і його Hermes/task зміни не чіпалися.

## Перевірки перед push

- Node 22.23.1 / npm 10.9.8: `npm run check:runtime` PASS.
- Повний `npm test` на кандидатові після version bump: exit 0; зокрема 2619 unit, 334 My Day та 1312 UI checks PASS. Інші guards/suites входили у цю саму успішну команду. Лог: `output/playwright/hr-checklists/release-npm-test.log`.
- `npm exec --offline --package=playwright -c "node tests/browser/hr-checklists-theme-browser-smoke.js --shell"`: exit 0, дві теми й поточні UI handlers на інтегрованій базі PASS. Лог: `release-browser.log` у тій самій папці.
- Початковий after-shell evidence збережено в `output/playwright/hr-checklists/pre-release-evidence-20260911/after-shell`; поточний `after-shell` — новий прогін кандидата. Старий manifest відповідає попередньому знімку доказів.
- Раніше пройшли isolated PostgreSQL writer/readonly, 36 цільових тестів, native zoom 100–200%; це локальні докази, не live mutation proof.
- `git diff --check`: PASS. Порівняння з live base для db/auth/workflows не містить змін.

## Доказ доставки й відкат

Цей файл підготовлено до push. Він не стверджує, що CI або deploy вже завершилися. Точні release SHA, CI URL, Railway deployment ID, live metadata й read-only browser результати потрібно записати після виконання в локальний `output/playwright/hr-checklists/release-delivery.json` та підсумок задачі.

Точка відкату: попередній live `3312ace2b5dbe18eda11fd865e6a6218212ff23d`; штатний release helper у чистій копії з явними project/environment/service/branch та перевіркою CI/metadata. Schema rollback не потрібний: нових міграцій немає. Force-push, reset shared checkout або ручні операції з БД не застосовувати; якщо helper відхиляє rollback, зупинитися й описати причину, не обходити його guards.

Відкриті доробки залишаються в CHK-F01–F06 основного звіту. F01 частково закрито справжнім merge і повним локальним baseline; після доставки додати exact-SHA CI та live QA evidence. Повний staff-card/Training click-шлях, повна матриця ролей/фільтрів, in-flight reopen, ширша accessibility та автоматичне підключення нових browser scripts до CI не оголошуються завершеними.
