# Release Reliability Runbook

Цей документ описує мінімальний контур, який треба виконувати перед кожним
деплоєм і одразу після нього. Мета: не повторювати ситуацію, коли локально все
зелене, а production показує порожній таймлайн або працює з не тією схемою БД.

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

## Якщо Smoke Червоний

1. Не закривати реліз як live.
2. Зафіксувати endpoint, HTTP status, `requestId` або текст помилки.
3. Якщо `/api/version` не збігається з `package.json`, це неповний deploy/cache.
4. Якщо `/api/ready` або `/api/health/deep` показує `schema.status != ok`, це DB/schema drift.
5. Якщо падають `bookings` або `lines`, перевірити `businessContext`, auth token і SQL error у логах.
6. Якщо причина не очевидна за 10-15 хвилин, rollback або revert у deploy branch краще, ніж правки наосліп.

## Зміна Підходу

- Не деплоїти без зеленого `release:gate`.
- Не вважати реліз готовим без live smoke.
- Не приймати "порожній екран" як нормальний empty state, доки Network/API не підтвердили `200` і правильний формат.
- Для production проблем спочатку дивитись API контракт, schema health і live version, а вже потім UI.
