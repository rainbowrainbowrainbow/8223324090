# Release Reliability Runbook

Цей документ описує мінімальний контур, який треба виконувати перед кожним
деплоєм і одразу після нього. Мета: не повторювати ситуацію, коли локально все
зелене, а production показує порожній таймлайн або працює з не тією схемою БД.

## Production Branch

Остання фактично перевірена production-гілка Railway (20.07.2026):
`codex/production`.

Перед кожним release або rollback треба read-only перевіркою підтвердити активну
Railway source branch і явно передати її в командах через
`RELEASE_DEPLOY_BRANCH=<branch>`. Не покладатися на fallback у release-proof
скрипті. `codex/timeline-leads-hardening` і `deployed` є історичними deploy
sources, доки власник окремо не підтвердить переналаштування Railway.

Production deploy policy з 20.07.2026: Railway GitHub auto-deploy вимкнений
для production app service. Production deploy має запускатися вручну тільки
після зелених required GitHub CI checks на точному release SHA. Деплоїти треба
саме перевірений SHA, а не випадковий стан локальної директорії.

Якщо Railway знову стартує deploy одразу після push і раніше завершення CI, це
process drift: release не закривати як доставлений, доки CI не зелений і live
version/health smoke не підтверджені.

## Production Branch Rule Exception

Owner decision on 2026-07-19: keep production commit `0658c09c7`
(`Merge current production into guarded reconciliation release`) as a documented
one-time exception. Do not rewrite `codex/production` history with
`force-with-lease` for this release.

Reason: the release was already deployed, production CI was green, Railway served
`v0.79.98`, and live health/version checks passed. Rewriting production history
would add operational risk without changing the deployed code.

Rule after this exception: future promotions to `codex/production` must use
linear history only. If `origin/codex/production` advances during a release,
rebase/cherry-pick onto the new production head and rerun CI before promotion;
do not promote a merge commit unless the owner explicitly approves a new
documented exception.

## Перед Деплоєм

Запустити:

```bash
npm run release:gate
```

Команда виконує:
- `npm run version:current`;
- повний `npm test`;
- якщо передано live URL, також `smoke:live` і `release:timeline-proof`.

Приклад із live URL:

```bash
npm run release:gate -- https://<live-crm-host>
```

Якщо `release:gate` червоний, деплой не починати.

## Після Деплою

Запустити:

```bash
npm run smoke:live -- https://<live-crm-host>
npm run release:timeline-proof -- https://<live-crm-host>
```

Для повної перевірки захищених API треба один із варіантів:

```bash
LIVE_SMOKE_TOKEN=<jwt> npm run smoke:live -- https://<live-crm-host>
```

або:

```bash
LIVE_SMOKE_USER=<login> LIVE_SMOKE_PASS=<password> npm run smoke:live -- https://<live-crm-host>
```

Без токена/логіна можна запустити тільки public checks:

```bash
LIVE_SMOKE_PUBLIC_ONLY=true npm run smoke:live -- https://<live-crm-host>
```

Public-only режим не вважається повним production smoke, бо не перевіряє
`bookings`, `lines` і `leads`.

## Health Endpoints

- `/api/health` - легкий uptime/database check. Підходить для Railway health.
- `/api/ready` - readiness check: database + schema. Повертає `503`, якщо схема не готова.
- `/api/health/deep` - diagnostic check: database, schema, missing migrations/columns.

Production smoke має дивитись саме `/api/ready` і `/api/health/deep`, а не тільки
`/api/health`.

`/api/health/deep` також показує data-only migration warnings у
`schema.pendingDataMigrations`. Такі warnings не валять `/api/ready`, якщо
runtime-схема готова, але їх треба розбирати як data/backfill debt.

## Якщо Smoke Червоний

1. Не закривати реліз як live.
2. Зафіксувати endpoint, HTTP status, `requestId` або текст помилки.
3. Якщо `/api/version` не збігається з `package.json`, це неповний deploy/cache.
4. Якщо `/api/ready` або `/api/health/deep` показує `schema.status != ok`, це DB/schema drift.
5. Якщо падають `bookings` або `lines`, перевірити `businessContext`, auth token і SQL error у логах.
6. Якщо причина не очевидна за 10-15 хвилин, rollback або revert у deploy branch краще, ніж правки наосліп.
7. Якщо production дає `502`, спочатку перевірити GitHub deployment status і
   Railway logs; не робити новий feature-fix, доки app startup не відновлений.

## Зміна Підходу

- Не деплоїти без зеленого `release:gate`.
- Не вважати реліз готовим без live smoke.
- Public-only smoke достатній тільки для перевірки, що app ожив після deploy;
  повне закриття релізу потребує `LIVE_SMOKE_TOKEN` або live login/password.
- Не приймати "порожній екран" як нормальний empty state, доки Network/API не підтвердили `200` і правильний формат.
- Для production проблем спочатку дивитись API контракт, schema health і live version, а вже потім UI.
