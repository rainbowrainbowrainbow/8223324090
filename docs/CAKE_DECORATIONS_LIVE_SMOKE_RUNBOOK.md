# Cake Decorations Live Smoke Runbook

Цей runbook описує безпечний повторний запуск live smoke для розділу меню
`Оформлення торта`. Smoke перевіряє Products API/UI, booking catalog tab, cart
subtotal, створення safe test booking і cleanup.

## Command

```bash
npm run smoke:cake-decorations -- https://8223324090-production.up.railway.app
```

URL також можна передати через `LIVE_CAKE_DECORATIONS_URL`, `LIVE_SMOKE_URL` або
`TEST_URL`. CLI-аргумент має пріоритет.

## Required Auth

Використовуйте один із варіантів, не друкуючи значення в terminal/chat/docs:

```bash
LIVE_CAKE_DECORATIONS_TOKEN=<jwt>
```

або:

```bash
LIVE_CAKE_DECORATIONS_USER=<login>
LIVE_CAKE_DECORATIONS_PASS=<password>
```

Fallback env names:

- Token: `LIVE_SMOKE_TOKEN`, `LIVE_SMOKE_BEARER_TOKEN`
- Login: `LIVE_SMOKE_USER`, `LIVE_SMOKE_USERNAME`, `TEST_USER`
- Password: `LIVE_SMOKE_PASS`, `LIVE_SMOKE_PASSWORD`, `TEST_PASS`

Для локального Codex запуску можна підхопити затверджений secrets file, але його
не можна комітити або цитувати:

```powershell
. "C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1"
npm run smoke:cake-decorations -- https://8223324090-production.up.railway.app
```

## Optional Settings

- `LIVE_CAKE_DECORATIONS_BUSINESS_CONTEXT` або `LIVE_SMOKE_BUSINESS_CONTEXT`:
  business context, default `event_genix`.
- `LIVE_CAKE_DECORATIONS_HEADLESS=false`: показати browser window.
- `LIVE_CAKE_DECORATIONS_TIMEOUT_MS`: Playwright/API timeout, default `30000`.
- `LIVE_CAKE_DECORATIONS_DATE` або `LIVE_SMOKE_DATE`: preferred booking date.
  Якщо не задано, script бере дату приблизно через 45 днів.
- `LIVE_CAKE_DECORATIONS_TIMES`: comma-separated preferred times, наприклад
  `09:00,10:00,11:00`.
- `LIVE_CAKE_DECORATIONS_DURATION_MINUTES`: test booking duration, default `60`.
- `LIVE_CAKE_DECORATIONS_PERMANENT_CLEANUP=false`: не пробувати permanent delete;
  script використає normal delete і все одно перевірить, що запис відсутній в
  active list.

`LIVE_CAKE_DECORATIONS_KEEP_BOOKING` навмисно заборонений. Якщо його встановити,
script впаде до створення booking, бо cleanup має залишатися обов'язковим.

## Safety Contract

Script створює тільки disposable booking із явними safe markers:

- label/group/program name починається з `QA Cake Decorations Smoke`;
- notes містять `safe automated smoke; disposable booking; cleanup expected`;
- `extraData.smokeTest.kind = "cake_decorations"`;
- `extraData.smokeTest.cleanupExpected = true`;
- `extraData.bookingWorkspace.source = "live_cake_decorations_smoke"`.

Перед вибором slot script також прибирає stale active bookings, які мають ці safe
markers, у перевіреній даті. Він не має торкатися реальних customer bookings.

## Cleanup Behavior

Cleanup виконується у `finally` після browser/API перевірок:

1. Якщо booking створено, script викликає `DELETE /api/bookings/:id`.
2. За замовчуванням він спершу пробує delete з `permanent=true`, потім fallback
   normal delete.
3. Після delete script читає active room bookings за ту саму дату і підтверджує,
   що booking ID більше не присутній.
4. Якщо cleanup не завершився або не підтвердився, smoke завершується помилкою.

Успішний рядок має містити:

```text
OK cleanup: <mode> delete for <booking-id>; active record absent
```

## Troubleshooting

Якщо smoke впав до створення booking:

- перевірте URL;
- перевірте auth env vars;
- перевірте, що live `/api/version` і `/api/health` відповідають.

Якщо booking створено, але cleanup failed:

1. Не запускайте широкі cleanup scripts.
2. Візьміть booking ID тільки зі smoke output.
3. Перевірте в CRM, що label починається з `QA Cake Decorations Smoke` і notes
   містять safe marker.
4. Видаліть тільки цей safe booking через CRM або точковий API delete.
5. Після ручного cleanup повторіть smoke або read-only перевірте, що booking ID
   не присутній в active room bookings за дату smoke.

Не видаляйте production records без safe markers і не публікуйте customer data,
tokens, passwords або raw booking details у logs/chats/PR descriptions.
