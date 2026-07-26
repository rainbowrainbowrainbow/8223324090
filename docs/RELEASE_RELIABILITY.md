# Release Reliability Runbook

Цей документ описує мінімальний контур, який треба виконувати перед кожним
деплоєм і одразу після нього. Мета: не повторювати ситуацію, коли локально все
зелене, а production показує порожній таймлайн або працює з не тією схемою БД.

## Production Branch

Manual Railway deploys must expose commit/branch evidence through `/api/version`.
Use Railway git metadata when it is present. If manual/API exact-SHA deploy does
not provide `RAILWAY_GIT_COMMIT_SHA` and `RAILWAY_GIT_BRANCH`, configure explicit
runtime metadata:

```bash
RELEASE_DEPLOY_COMMIT=<exact-release-sha>
RELEASE_DEPLOY_BRANCH=codex/production
```

`npm run version:smoke` and `npm run release:timeline-proof` must be fail-closed
for production release acceptance when this metadata is unavailable, partial, or
conflicting. Run release smokes with the same `RELEASE_DEPLOY_COMMIT` and
`RELEASE_DEPLOY_BRANCH` in the operator shell so the live API is compared
against the exact intended SHA. `VERSION_SMOKE_ALLOW_MISSING_METADATA=true` is
allowed only for local/dev diagnostics.

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

## Preferred Railway Deploy Helper

For manual production deploys, prefer the repo helper over raw railway up:

~~~bash
RELEASE_DEPLOY_BRANCH=codex/production npm run release:railway-up -- --service 8223324090 --environment production
~~~

On PowerShell/Windows, invoke the helper directly so npm does not consume named flags:

~~~powershell
node scripts/railway-release-up.js --branch codex/production --service 8223324090 --environment production
~~~

The helper resolves the bundled native Railway CLI on Windows. For a non-standard installation, set `RELEASE_RAILWAY_BIN` to the exact `railway.exe` path.

The helper fails closed when the worktree is dirty, when local HEAD is not the same SHA as origin/<branch>, or when the deploy branch is missing. By default it creates a clean `git archive` export of the exact HEAD, validates release assets in that export, then deploys that export path with `railway up <clean-export> --path-as-root`. It sets the non-secret `RELEASE_DEPLOY_COMMIT` / `RELEASE_DEPLOY_BRANCH` metadata before the deploy. Use raw `railway up` only if the helper itself is unavailable, and then deploy a clean archive/export path, not a dirty workspace directory, plus the metadata variables.

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
