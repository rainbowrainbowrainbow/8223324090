# Feature #8: Optimistic Locking

> Запобігання конфліктів при одночасному редагуванні одного бронювання двома адмінами.

---

## 1. Current State

### 1.1 Колонка `updated_at` — вже існує

Колонка `updated_at` додається при ініціалізації БД в `db/index.js:70`:

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
```

Колонка вже **маппиться** у `mapBookingRow()` (`services/booking.js:152`):

```js
updatedAt: row.updated_at,
```

Фронтенд вже **відображає** `updatedAt` у деталях бронювання (`js/booking.js:884`):

```js
${booking.updatedAt ? `<div ...>Оновлено: ${new Date(booking.updatedAt).toLocaleString('uk-UA')}</div>` : ''}
```

### 1.2 Як працює PUT (повне оновлення)

Єдиний endpoint для оновлення — `PUT /api/bookings/:id` (`routes/bookings.js:264-406`):

1. Валідація `id`, `date`, `time`
2. `pool.connect()` + `BEGIN` (транзакція)
3. `SELECT * FROM bookings WHERE id = $1` — зчитати старий запис
4. `checkServerConflicts()` + `checkRoomConflict()` — перевірка конфліктів
5. `UPDATE bookings SET ... updated_at=NOW() WHERE id=$23` — **WHERE тільки по id**, без перевірки `updated_at`
6. Синхронізація linked bookings (видалення/створення/оновлення залежно від зміни `secondAnimator`)
7. `INSERT INTO history` — запис в історію
8. `COMMIT`
9. Telegram-сповіщення (fire-and-forget після commit)
10. Відповідь `{ success: true }`

### 1.3 PATCH — не використовується для bookings

Для бронювань немає PATCH endpoint. Зміна статусу (`changeBookingStatus` в `js/ui.js:425`) використовує повний PUT, надсилаючи весь об'єкт бронювання через `apiUpdateBooking()`.

### 1.4 Як фронтенд відправляє оновлення

- `apiUpdateBooking(id, booking)` (`js/api.js:98-115`) — простий `PUT` з повним об'єктом, **`updatedAt` не включається** в тіло запиту.
- `handleBookingSubmit()` (`js/booking.js:598-708`) — збирає дані з форми через `buildBookingObject()`, який **не включає `updatedAt`**.
- `shiftBookingTime()` (`js/booking.js:1138-1219`) — копіює booking-об'єкт з `...booking` (updatedAt є), але сервер його ігнорує.
- `changeBookingStatus()` (`js/ui.js:425-457`) — `{ ...booking, status: newStatus }` — копіює updatedAt, але сервер ігнорує.
- `switchBookingLine()` (`js/booking.js:1225-1264`) — аналогічно.

### 1.5 Проблема

Зараз два адміни можуть одночасно:
1. Адмін A відкриває бронювання BK-2026-0042
2. Адмін B відкриває те ж бронювання BK-2026-0042
3. Адмін A міняє кімнату, зберігає (PUT) — `updated_at` оновлюється на сервері
4. Адмін B міняє час, зберігає (PUT) — **перезаписує зміни Адміна A**, бо WHERE не перевіряє `updated_at`

Це типова проблема "lost update" — останній save виграє.

### 1.6 Транзакції

Транзакції (`BEGIN/COMMIT/ROLLBACK/finally release`) використовуються коректно, але вони захищають від часткових записів, **не від lost updates**. Два послідовних коміти — обидва пройдуть.

---

## 2. Database Changes

### 2.1 Тригер для автоматичного оновлення `updated_at`

Зараз `updated_at = NOW()` встановлюється вручну в кожному UPDATE-запиті. Для надійності потрібен тригер:

```sql
-- Trigger function (reusable)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to bookings table
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 2.2 Де додати

В `db/index.js` `initDatabase()`, після рядка 70 (`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at ...`), додати:

```js
// Optimistic locking: auto-update trigger for updated_at
await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
`);
await pool.query(`
    DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings
`);
await pool.query(`
    CREATE TRIGGER trg_bookings_updated_at
        BEFORE UPDATE ON bookings
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
`);
```

### 2.3 Наслідки

- Всі `updated_at=NOW()` в UPDATE-запитах стають **необов'язковими** (тригер зробить це автоматично), але їх можна залишити для наочності.
- Тригер гарантує, що `updated_at` завжди змінюється при будь-якому UPDATE, навіть якщо запит не встановлює його явно.
- Існуючі записи без `updated_at` (створені до v5.x) матимуть `NULL` — потрібна обробка на бекенді (див. розділ 3.5).

---

## 3. Backend Changes

### 3.1 Прийняти `updatedAt` в PUT body

В `routes/bookings.js`, рядок ~268, після деструктуризації `req.body`:

```js
const { id } = req.params;
const b = req.body;
const clientUpdatedAt = b.updatedAt || null; // optimistic locking
```

### 3.2 Перевірка версії при UPDATE

Замінити поточний UPDATE (`routes/bookings.js:304-313`) на умовний:

```js
let updateQuery, updateParams;

if (clientUpdatedAt) {
    // Optimistic locking: check updated_at
    updateQuery = `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
         label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
         second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
         linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22
         WHERE id=$23 AND updated_at = $24
         RETURNING *`;
    updateParams = [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
         b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
         b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
         b.kidsCount || null, b.groupName || null,
         b.extraData ? JSON.stringify(b.extraData) : null, id, clientUpdatedAt];
} else {
    // Legacy: no optimistic locking (backward compatibility)
    updateQuery = `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
         label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
         second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
         linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, updated_at=NOW()
         WHERE id=$23
         RETURNING *`;
    updateParams = [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
         b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
         b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
         b.kidsCount || null, b.groupName || null,
         b.extraData ? JSON.stringify(b.extraData) : null, id];
}

const updateResult = await client.query(updateQuery, updateParams);
```

### 3.3 Реакція на 0 rows affected (409 Conflict)

```js
if (updateResult.rowCount === 0) {
    // Optimistic locking conflict: fetch current version
    const currentResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
    await client.query('ROLLBACK');

    if (currentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Бронювання не знайдено' });
    }

    const currentBooking = mapBookingRow(currentResult.rows[0]);
    return res.status(409).json({
        success: false,
        error: 'Бронювання було змінено іншим користувачем',
        conflict: true,
        currentData: currentBooking
    });
}
```

### 3.4 Повертати `updatedAt` у відповіді

Зараз PUT повертає лише `{ success: true }`. Після впровадження locking потрібно повертати свіжі дані, щоб фронтенд оновив свою копію `updatedAt`:

```js
const savedBooking = mapBookingRow(updateResult.rows[0]);

// ... (решта логіки: linked bookings, history, commit, telegram) ...

res.json({ success: true, booking: savedBooking });
```

### 3.5 Обробка legacy записів (NULL `updated_at`)

Записи, створені до додавання колонки, можуть мати `updated_at = NULL`. Два варіанти:

**Варіант A (рекомендований):** Одноразова міграція в `initDatabase()`:

```sql
UPDATE bookings SET updated_at = created_at WHERE updated_at IS NULL;
```

**Варіант B:** В UPDATE WHERE: `AND (updated_at = $24 OR updated_at IS NULL)` — менш безпечний, дозволяє перезапис без перевірки для старих записів.

### 3.6 Повний flow (sequence diagram)

```
Client A                  Server                    Client B
   |                        |                          |
   |--- GET bookings ------>|                          |
   |<-- [{..., updatedAt: "2026-02-14T10:00:00"}] ----|
   |                        |                          |
   |                        |<--- GET bookings --------|
   |                        |--- [{..., updatedAt: "2026-02-14T10:00:00"}] -->|
   |                        |                          |
   |--- PUT {updatedAt: "2026-02-14T10:00:00"} ------>|
   |<-- 200 {booking: {updatedAt: "2026-02-14T10:05:00"}} --|
   |                        |                          |
   |                        |<--- PUT {updatedAt: "2026-02-14T10:00:00"} --|
   |                        |     WHERE updated_at = "10:00" → 0 rows!    |
   |                        |--- 409 {conflict: true, currentData: {...}} -->|
   |                        |                          |
```

---

## 4. Frontend Changes

### 4.1 Зберігати `updatedAt` при завантаженні

`updatedAt` вже є в об'єктах бронювань, які повертає `apiGetBookings()` через `mapBookingRow()`. Додаткового коду не потрібно — кешування через `AppState.cachedBookings` вже зберігає повний об'єкт.

### 4.2 Надсилати `updatedAt` при збереженні

**4.2.1 `buildBookingObject()` (`js/booking.js:452-484`):**

Додати `updatedAt` в об'єкт, що будується:

```js
function buildBookingObject(formData, program) {
    // ... existing code ...
    const obj = {
        // ... existing fields ...
    };

    // Optimistic locking: include updatedAt from the booking being edited
    if (AppState.editingBookingId) {
        // updatedAt was stored when loading the booking for editing
        obj.updatedAt = AppState.editingBookingUpdatedAt || null;
    }

    return obj;
}
```

**4.2.2 `editBooking()` (`js/booking.js:901-971`):**

Зберегти `updatedAt` при відкритті форми редагування:

```js
async function editBooking(bookingId) {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Store updatedAt for optimistic locking
    AppState.editingBookingUpdatedAt = booking.updatedAt || null;

    // ... rest of existing code ...
}
```

**4.2.3 `handleBookingSubmit()` (`js/booking.js:643-670`, гілка редагування):**

Після успішного оновлення, оновити `updatedAt` в кеші з відповіді сервера:

```js
const updateResult = await apiUpdateBooking(booking.id, booking);
if (updateResult && updateResult.success === false) {
    // Check if it's a conflict
    if (updateResult.conflict) {
        await handleOptimisticLockConflict(updateResult, booking);
        unlockSubmitBtn();
        return;
    }
    showNotification(updateResult.error || 'Помилка оновлення бронювання', 'error');
    unlockSubmitBtn();
    return;
}
// Update stored updatedAt from server response
if (updateResult && updateResult.booking) {
    AppState.editingBookingUpdatedAt = updateResult.booking.updatedAt;
}
```

**4.2.4 `shiftBookingTime()` (`js/booking.js:1138-1219`):**

Додати `updatedAt` при переносі часу:

```js
const newBooking = { ...booking, time: newTime };
// updatedAt is already in the spread from booking object
```

Тут `updatedAt` вже копіюється через spread operator `...booking`, бо `booking` отримано з `getBookingsForDate()`, який повертає маппований об'єкт з `updatedAt`.

**4.2.5 `changeBookingStatus()` (`js/ui.js:425-457`):**

Аналогічно, `{ ...booking, status: newStatus }` вже включає `updatedAt`.

**4.2.6 `switchBookingLine()` (`js/booking.js:1225-1264`):**

Вже включає `updatedAt` через spread.

### 4.3 Обробка 409 Conflict в `apiUpdateBooking()`

Зараз `apiUpdateBooking()` (`js/api.js:98-115`) повертає `{ success: false, error }` для всіх помилок. Потрібно розрізняти 409:

```js
async function apiUpdateBooking(id, booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(booking)
        });
        if (handleAuthError(response)) return { success: false };
        if (response.status === 409) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                conflict: body.conflict || false,
                error: body.error || 'Конфлікт даних',
                currentData: body.currentData || null
            };
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}
```

**Примітка:** 409 вже використовується для конфліктів часу (`checkServerConflicts`), тому потрібно розрізняти за полем `conflict: true` (optimistic locking) vs звичайний 409 (time overlap). Поточні 409 НЕ мають поля `conflict`, тому backward compatibility зберігається.

### 4.4 Діалог конфлікту

Нова функція `handleOptimisticLockConflict()`:

```js
async function handleOptimisticLockConflict(result, localBooking) {
    const serverData = result.currentData;
    if (!serverData) {
        showNotification('Бронювання було змінено іншим користувачем. Оновіть сторінку.', 'error');
        return;
    }

    // Build a summary of what changed
    const changes = [];
    if (serverData.time !== localBooking.time) changes.push(`Час: ${serverData.time}`);
    if (serverData.room !== localBooking.room) changes.push(`Кімната: ${serverData.room}`);
    if (serverData.status !== localBooking.status) changes.push(`Статус: ${serverData.status}`);
    if (serverData.lineId !== localBooking.lineId) changes.push(`Лінія змінена`);
    if (serverData.notes !== localBooking.notes) changes.push(`Примітки змінені`);
    if (serverData.kidsCount !== localBooking.kidsCount) changes.push(`К-сть дітей: ${serverData.kidsCount}`);

    const changesText = changes.length > 0
        ? `\n\nЗміни на сервері:\n${changes.map(c => `  - ${c}`).join('\n')}`
        : '';

    const message = `Бронювання було змінено іншим користувачем.${changesText}\n\nЩо зробити?`;

    // Show custom conflict dialog with two options
    const overwrite = await customConfirm(
        message,
        'Конфлікт редагування',
        'Перезаписати',   // confirm button text
        'Оновити дані'    // cancel button text
    );

    if (overwrite) {
        // Force overwrite: re-send with current server's updatedAt
        localBooking.updatedAt = serverData.updatedAt;
        const retryResult = await apiUpdateBooking(localBooking.id, localBooking);
        if (retryResult && retryResult.success) {
            delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeBookingPanel();
            await renderTimeline();
            showNotification('Бронювання перезаписано!', 'success');
        } else if (retryResult && retryResult.conflict) {
            // Another conflict happened — recursive, but extremely unlikely
            showNotification('Повторний конфлікт. Оновіть сторінку.', 'error');
        } else {
            showNotification(retryResult?.error || 'Помилка збереження', 'error');
        }
    } else {
        // Refresh data: reload bookings and re-open edit form
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();
        // Re-open editing with fresh data
        await editBooking(localBooking.id);
        showNotification('Дані оновлено з сервера', 'info');
    }
}
```

### 4.5 Кнопки діалогу (UI)

| Кнопка | Дія | Пояснення для користувача |
|---|---|---|
| **Перезаписати** | Повторний PUT з актуальним `updatedAt` з сервера | Мої зміни важливіші — перезаписати чужі |
| **Оновити дані** | Перезавантажити бронювання і відкрити форму заново | Подивлюсь на чужі зміни і вирішу |

### 4.6 Очищення `editingBookingUpdatedAt`

В `closeBookingPanel()` (`js/booking.js:114-129`):

```js
function closeBookingPanel() {
    // ... existing code ...
    if (AppState.editingBookingId) {
        AppState.editingBookingId = null;
        AppState.editingBookingUpdatedAt = null; // Clear optimistic lock
        // ... existing code ...
    }
}
```

---

## 5. Special Cases

### 5.1 Linked bookings: який `updated_at` перевіряти?

**Поточна поведінка:**
- Main booking (linked_to = NULL) є "головним". Linked bookings (linked_to = main.id) автоматично синхронізуються сервером при PUT головного.
- При зміні secondAnimator сервер видаляє старі linked і створює нові (`routes/bookings.js:316-367`).
- При перенесенні часу (`shiftBookingTime`) — окремі PUT для кожного linked.

**Рішення для optimistic locking:**
- **Перевіряти `updated_at` тільки для main booking.** Linked bookings оновлюються каскадно всередині тієї ж транзакції, тому їх `updated_at` не потрібно перевіряти окремо.
- При `shiftBookingTime()` кожен linked PUT буде відправляти свій `updatedAt` — якщо хтось змінив linked booking окремо (переключив лінію), конфлікт буде виявлений.
- Для `changeBookingStatus()` — кожен linked оновлюється окремим PUT, кожен з своїм `updatedAt`.

### 5.2 Status-only changes vs full edits

**Статус через `changeBookingStatus()` (`js/ui.js:425`):**
- Використовує повний PUT з `{ ...booking, status: newStatus }`.
- `updatedAt` вже є в spread — буде працювати автоматично.
- При конфлікті: показати діалог "Бронювання змінено іншим користувачем".

**Зміна статусу через кнопку в деталях:**
- Тут потрібен свіжий `updatedAt`. Дані беруться з `getBookingsForDate()` — якщо кеш актуальний, `updatedAt` буде правильним.
- **Рекомендація:** перед зміною статусу оновити кеш: `delete AppState.cachedBookings[...]`.

### 5.3 Drag-and-drop moves (майбутній Feature #14)

Коли drag-and-drop буде реалізований:
- При drag кінці (drop) — відправляти PUT з `updatedAt` з поточного об'єкта бронювання.
- Якщо drag виконується через деякий час після завантаження таймлайну, може бути конфлікт.
- **Рекомендація для #14:** При початку drag зберігати `updatedAt`, при drop — відправляти. При 409 — скасувати drag візуально і показати повідомлення.

### 5.4 Soft delete interaction

Soft delete (`DELETE /api/bookings/:id`, `routes/bookings.js:217-261`) встановлює `status = 'cancelled'` та `updated_at = NOW()`.

**Сценарій:** Адмін A видалив бронювання, Адмін B намагається його редагувати.
- Зараз: PUT повертає 404, бо GET фільтрує `status != 'cancelled'`.
- З optimistic locking: буде 404 (бронювання не знайдено в кеші), або 409 якщо воно ще в кеші фронтенду.
- **Обробка:** При 409 сервер повертає `currentData` з `status: 'cancelled'` — фронтенд побачить, що бронювання вже видалено.

### 5.5 Перенос часу (`shiftBookingTime`)

- Вже копіює `updatedAt` через `{ ...booking, time: newTime }`.
- При конфлікті показувати спрощене повідомлення без діалогу (бо форма не відкрита): `showNotification('Бронювання змінено іншим користувачем. Оновіть таймлайн.', 'error')`.

### 5.6 Переключення лінії (`switchBookingLine`)

- Аналогічно `shiftBookingTime` — копіює `updatedAt` через spread.
- При конфлікті — спрощене повідомлення.

### 5.7 Існуючі 409 відповіді (час overlap)

Зараз 409 використовується для:
- `checkServerConflicts`: `{ success: false, error: "Час зайнятий: ..." }`
- `checkRoomConflict`: `{ success: false, error: "Кімната зайнята: ..." }`

Ці 409 НЕ мають поля `conflict: true`. Optimistic locking 409 матиме `conflict: true`. Тому frontend розрізняє їх коректно:

```js
if (updateResult.conflict) {
    // Optimistic locking conflict
    await handleOptimisticLockConflict(updateResult, booking);
} else {
    // Time/room overlap
    showNotification(updateResult.error, 'error');
}
```

---

## 6. Cross-Dependencies with #10, #11, #14

### 6.1 #10 — Оновлення цін каталогу

З IMPROVEMENT_PLAN.md (3.4):

> При зміні ціни продукту в каталозі — **всі бронювання** з цим `program_id` оновлюють `price`.

```sql
UPDATE bookings SET price = :new_price, updated_at = NOW()
WHERE program_id = :product_id;
```

**Вплив на optimistic locking:**
- Масовий UPDATE змінить `updated_at` для всіх бронювань з цим продуктом.
- Якщо адмін в цей момент редагує одне з цих бронювань — отримає 409.
- **Це правильна поведінка:** ціну змінили під час редагування, потрібно побачити нову ціну.
- **Рекомендація:** Після масового оновлення цін — показувати повідомлення "Ціни оновлено, перезавантажте таймлайн" через broadcast/notification.

### 6.2 #11 — Клієнтська база

З IMPROVEMENT_PLAN.md:

> client_name/client_phone на bookings — НЕ додаємо поки (рішення Q&A #11).

**Вплив:** Мінімальний. Якщо в майбутньому додадуть поля `client_name`/`client_phone` до bookings, вони просто стануть частиною UPDATE SET і будуть захищені optimistic locking автоматично.

**Готовність:** Optimistic locking не блокує і не ускладнює додавання нових полів у bookings.

### 6.3 #14 — Drag-and-Drop переміщення

Зі SNAPSHOT.md:

> Drag-n-drop сортування програм

**Вплив:**
- Drag-and-drop для переміщення бронювань на таймлайні буде використовувати PUT для оновлення `time` та/або `line_id`.
- Потрібно передавати `updatedAt` при drop.
- Drag з кешованих даних: якщо таймлайн не оновлювався, `updatedAt` може бути застарілим.

**Рекомендації для #14:**
1. При dragstart — зберегти `updatedAt` з бронювання.
2. При drop — відправити PUT з цим `updatedAt`.
3. При 409 — скасувати переміщення (повернути блок на місце), показати `showNotification()`.
4. Не відкривати діалог "Перезаписати/Оновити" — для drag це занадто складно. Просто скасувати і оновити.
5. Після конфлікту — автоматично перезавантажити таймлайн: `delete AppState.cachedBookings[...]; await renderTimeline()`.

---

## 7. Implementation Checklist

### 7.1 Database (1 change)

- [ ] `db/index.js`: Додати тригер `update_updated_at_column()` + `trg_bookings_updated_at` в `initDatabase()`
- [ ] `db/index.js`: Одноразова міграція `UPDATE bookings SET updated_at = created_at WHERE updated_at IS NULL`

### 7.2 Backend (routes/bookings.js)

- [ ] Прийняти `b.updatedAt` з req.body
- [ ] Додати `AND updated_at = $N` в WHERE для PUT (коли `updatedAt` надано)
- [ ] Додати `RETURNING *` в UPDATE (вже є в деяких місцях, потрібна уніфікація)
- [ ] Перевіряти `updateResult.rowCount === 0` — повертати 409 з `conflict: true` та `currentData`
- [ ] Повертати `{ success: true, booking: savedBooking }` замість `{ success: true }`
- [ ] Backward compatibility: якщо `updatedAt` не надано — працювати як раніше (без locking)

### 7.3 Frontend (js/)

- [ ] `js/api.js`: Обробка `response.status === 409` з полем `conflict`
- [ ] `js/booking.js`: `AppState.editingBookingUpdatedAt` — зберігати при `editBooking()`
- [ ] `js/booking.js`: `buildBookingObject()` — включити `updatedAt`
- [ ] `js/booking.js`: `handleBookingSubmit()` — обробка `conflict` в результаті PUT
- [ ] `js/booking.js`: `handleOptimisticLockConflict()` — діалог "Перезаписати / Оновити дані"
- [ ] `js/booking.js`: `closeBookingPanel()` — очистити `editingBookingUpdatedAt`
- [ ] `js/booking.js`: `shiftBookingTime()` — обробка 409 (спрощене повідомлення)
- [ ] `js/booking.js`: `switchBookingLine()` — обробка 409 (спрощене повідомлення)
- [ ] `js/ui.js`: `changeBookingStatus()` — обробка 409 (спрощене повідомлення)

### 7.4 Tests (tests/api.test.js)

- [ ] Test: PUT з правильним `updatedAt` — 200 OK
- [ ] Test: PUT з застарілим `updatedAt` — 409 Conflict з `conflict: true`
- [ ] Test: PUT без `updatedAt` — 200 OK (backward compatibility)
- [ ] Test: 409 response contains `currentData` з актуальними даними
- [ ] Test: Повторний PUT з оновленим `updatedAt` після конфлікту — 200 OK
- [ ] Test: Soft deleted booking + PUT — 404 (не 409)
- [ ] Test: Linked booking update — main booking's `updatedAt` перевіряється

---

## 8. Migration Strategy

### 8.1 Backward Compatibility

Optimistic locking **не є breaking change**:
- Якщо клієнт не надсилає `updatedAt` — працює як раніше (legacy mode).
- Це дозволяє поступово розкочувати зміни: спочатку backend, потім frontend.
- Старі версії фронтенду (кеш браузера) продовжують працювати.

### 8.2 Порядок деплою

1. **DB trigger** — безпечно, не впливає на існуюче
2. **Backend (routes/bookings.js)** — backward compatible, новий код лише для запитів з `updatedAt`
3. **Frontend** — поступово, з оновленням кешу
4. **Tests** — перевірити обидва шляхи (з і без `updatedAt`)

### 8.3 Версіонування

Ця фіча відповідає bump версії (наприклад, **v8.8.0** або **v9.0.0** залежно від контексту релізу). CHANGELOG entry:

```
### v8.8.0 — Optimistic Locking
- feat: Захист від перезапису чужих змін (optimistic locking через updated_at)
- feat: Діалог конфлікту "Перезаписати / Оновити дані"
- feat: PUT повертає оновлений об'єкт бронювання
- fix: Тригер auto-update для updated_at
```
