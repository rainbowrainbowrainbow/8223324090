# Cake Decorations Live Smoke Runbook

Цей smoke створює рівно один disposable QA booking для перевірки каталогу «Оформлення торта» і завжди прибирає його в `finally`.

## Перед запуском

- Запускайте тільки після фінального deploy і з test-обліковим записом.
- Завантажте локальні EventGenix CRM secrets, не виводячи їх у terminal або чат.
- Переконайтесь, що production `/api/version` та `/api/health` доступні.
- Не використовуйте `LIVE_CAKE_DECORATIONS_KEEP_BOOKING`: він навмисно блокує запуск.

```powershell
. "C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1"
npm run smoke:cake-decorations -- https://<live-crm-host>
```

## Години та overrides

Для `event_genix` smoke сам формує слоти з кроком 15 хвилин:

- будні: від 12:00 до 20:00;
- вихідні: від 10:00 до 20:00;
- останній слот враховує повну duration booking.

`LIVE_CAKE_DECORATIONS_TIMES` — лише override-кандидати. Кожне значення локально перевіряється до першого write. Наприклад, `09:00`, невалідний формат або слот, що виходить за 20:00, завершить smoke до create.

```powershell
$env:LIVE_CAKE_DECORATIONS_DURATION_MINUTES='60'
$env:LIVE_CAKE_DECORATIONS_TIMES='12:00,12:15,12:30'
npm run smoke:cake-decorations -- https://<live-crm-host>
```

Можна задати `LIVE_CAKE_DECORATIONS_DATE` та `LIVE_CAKE_DECORATIONS_BUSINESS_CONTEXT`. Для іншого business context smoke не припускає години EventGenix і зупиняється до write.

## Cleanup contract

До create виконується preflight disposable marker і `DELETE` до гарантовано неіснуючого sentinel ID: очікуваний `404` підтверджує canonical cleanup transport та права без зміни даних. Створений booking має:

- унікальний `runId`;
- source `live_cake_decorations_smoke`;
- `cleanupExpected=true`;
- `extraData.disposableQa` із exact test-customer marker;
- точний in-memory список створених booking і group ID.

Cleanup працює лише для ID поточного запуску після повторної перевірки exact marker. Немає cleanup за label, date або старими QA записами. Після delete smoke перевіряє відсутність booking в активному room timeline. Якщо cleanup не підтверджений, команда завершується помилкою.

Очікувані докази:

```text
OK cleanup: <mode> delete for <booking-id>; active record absent
OK exact cleanup IDs: bookings=<booking-id>, groups=<group-id або ->
OK slot: <date> <time>, room selected, candidateSlots=<count>
```

Якщо cleanup не пройшов, не запускайте broad cleanup. Передайте тільки exact ID, run ID та повідомлення помилки відповідальному оператору; не показуйте customer data, токени або raw payload.
