# Release Reliability Runbook

Цей документ описує мінімальний контур, який треба виконувати перед кожним
деплоєм і одразу після нього. Мета: не повторювати ситуацію, коли локально все
зелене, а production показує порожній таймлайн або працює з не тією схемою БД.

## Production Branch

Manual Railway CLI uploads must expose commit/branch evidence through `/api/version`.
The evidence order is strict:

1. `RAILWAY_GIT_COMMIT_SHA` and `RAILWAY_GIT_BRANCH`, when Railway provides both;
2. `eventgenix-release-deployment.json` bundled in the exact uploaded clean export;
3. legacy `RELEASE_DEPLOY_*` only as an incomplete diagnostic state.

The deployment manifest is created by `scripts/railway-release-up.js` immediately
inside the clean `git archive` export. It records the exact pushed HEAD, branch,
and package version that are uploaded to Railway. Runtime rejects malformed,
stale-version, missing, or conflicting artifact metadata. A manual env pair can
never override a valid manifest or Railway Git metadata.

`RELEASE_DEPLOY_COMMIT` and `RELEASE_DEPLOY_BRANCH` must not be used as runtime
release identity. They are legacy inputs only and should be absent from the
production service after the migration. If either remains and conflicts with the
manifest/platform pair, `/api/version` returns `status = conflict` and
`complete = false`.

The release helper runs strict post-deploy proof automatically with the exact
HEAD and branch. For a separate read-only proof, pass the expected target
explicitly:

```powershell
$env:VERSION_SMOKE_EXPECT_COMMIT = '<exact-release-sha>'
$env:VERSION_SMOKE_EXPECT_BRANCH = 'codex/lead-guest-context-v08018-final'
npm run version:smoke -- https://<live-crm-host>
```

`version:smoke` fails for manual, partial, unavailable, malformed, stale, or
conflicting metadata. `VERSION_SMOKE_ALLOW_MISSING_METADATA=true` is local/dev
only and never a release acceptance override.

Re-confirm the active Railway deploy source read-only before every release or
rollback; do not rely on historical branch names in this document.

Перед кожним release або rollback треба read-only перевіркою підтвердити активну
Railway source branch і явно передати її helper через trailing branch argument.
`codex/timeline-leads-hardening` і `deployed` є історичними deploy sources,
доки власник окремо не підтвердить переналаштування Railway.

Production deploy policy: Railway GitHub auto-deploy вимкнений для production app
service. Production deploy запускається вручну тільки після зелених required
GitHub CI checks на точному release SHA. Деплоїти треба саме перевірений SHA, а
не випадковий стан локальної директорії.

Якщо Railway знову стартує deploy одразу після push і раніше завершення CI, це
process drift: release не закривати як доставлений, доки CI не зелений і live
version/health smoke не підтверджені.

## Preferred Railway Deploy Helper

For manual production deploys, prefer the repo helper over raw `railway up`:

~~~powershell
# Canonical PowerShell/npm form. Keep `--` before helper flags.
npm run release:railway-up -- --branch <confirmed-production-branch> --commit <exact-release-sha> --live-url https://<live-crm-host>

# Safe dry run: cannot deploy.
npm run release:railway-up:dry-run:branch -- codex/lead-guest-context-v08018-final

# Production deploy after CI is green. The helper writes the deployment manifest
# into a clean git-archive export and runs strict post-deploy version proof.
npm run release:railway-up:branch -- codex/lead-guest-context-v08018-final
~~~

For a non-default service, environment, or URL, invoke the helper directly:

~~~powershell
node scripts/railway-release-up.js --branch codex/lead-guest-context-v08018-final --service 8223324090 --environment production --live-url https://<live-crm-host>
~~~

The helper fails closed when the worktree is dirty, when local HEAD is not the
same SHA as `origin/<branch>`, when the branch is unsafe/missing, when the
clean export lacks the release manifest, or when live `/api/version` does not
prove the uploaded SHA and branch. It never writes `RELEASE_DEPLOY_*` to
Railway. Use raw `railway up` only if the helper itself is unavailable; in that
case the deploy is not a complete release proof until an equivalent manifest
and strict live verification exist.

The helper also passes the production Railway project ID explicitly. This is
required for clean or detached worktrees: a Railway CLI invocation without a
linked project can otherwise create a new project instead of deploying the
existing service. Use `RELEASE_RAILWAY_PROJECT` or `--project` only when the
owner has explicitly approved a Railway project change. Before deployment,
verify that `railway status --json` resolves project `fortunate-appreciation`,
environment `production`, service `8223324090`, and the expected live domain.
## Production Branch Rule Exception

Owner decision on 2026-07-19: keep production commit `0658c09c7`
(`Merge current production into guarded reconciliation release`) as a documented
one-time exception. Do not rewrite `codex/production` history with
`force-with-lease` for this release.

Reason: the release was already deployed, production CI was green, Railway served
`v0.79.98`, and live health/version checks passed. Rewriting production history
would add operational risk without changing the deployed code.

Rule after this exception: future promotions to the currently confirmed production
branch (currently `codex/zrs-financial-integrity`) must use linear history only.
If its `origin/<branch>` advances during a release,
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
