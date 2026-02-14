# Feature #2: Certificate Tests

## Current Test Patterns

### Structure (describe/it blocks)
Tests use Node.js built-in test runner (`node --test`) with `describe`, `it`, `before`, and `after` from `node:test`. Assertions use `assert` from `node:assert/strict`.

Each feature area is wrapped in a `describe()` block with a comment header like:
```js
// ==========================================
// SECTION NAME
// ==========================================
describe('Section Name', () => { ... });
```

Individual test cases use `it('METHOD /path — description', async () => { ... })`.

### Auth handling
- `tests/helpers.js` exports `request()` (unauthenticated) and `authRequest()` (auto-attaches cached JWT).
- `getToken()` logs in as `admin/admin123` and caches the token for all subsequent calls.
- Unauthenticated tests call `request()` directly without a token.
- Role-based tests are not currently exercised (only `admin` user is used).

### Cleanup strategy
- Tests use `before()` to set up prerequisite data (lines, bookings).
- Tests use `after()` to delete created records via API (e.g., `DELETE /api/bookings/:id?permanent=true`).
- Far-future dates (`2099-XX-XX`) avoid collision with real data.
- Each `describe` block uses a unique date (e.g., `2099-01-15`, `2099-02-01`, etc.) for isolation.
- Inline cleanup: some tests clean up immediately after the assertion (`if (res.data.booking) await authRequest('DELETE', ...)`).

### Response validation pattern
- Check `res.status` with `assert.equal()`.
- Check response structure with `assert.ok(res.data.property, 'message')`.
- Check specific values with `assert.equal()`.
- For regex: `assert.match(value, /pattern/)`.

---

## Endpoints to Test

### POST /api/certificates

**Route:** `routes/certificates.js` line 113
**Auth:** `requireRole('admin', 'user')` + global `authenticateToken` (from server.js middleware)
**Returns:** 201 with mapped certificate object, or 400/500

#### Test cases:

1. **Create with all valid fields**
   - Body: `{ displayMode: 'fio', displayValue: 'Тестова Дитина', typeText: 'на одноразовий вхід', validUntil: '2099-12-31', notes: 'smoke test', season: 'winter' }`
   - Assert: status 201
   - Assert: response has `id`, `certCode`, `displayMode`, `displayValue`, `typeText`, `validUntil`, `status`, `season`
   - Assert: `status === 'active'`
   - Assert: `certCode` matches pattern `/^CERT-\d{4}-\d{5}$/`
   - Assert: `displayValue === 'Тестова Дитина'`
   - Assert: `season === 'winter'`

2. **Create with minimal fields (defaults applied)**
   - Body: `{}` (empty, all optional)
   - Assert: status 201
   - Assert: `displayMode === 'fio'` (default)
   - Assert: `displayValue === ''` (trimmed empty)
   - Assert: `typeText === 'на одноразовий вхід'` (default)
   - Assert: `validUntil` is set (auto-calculated, default 45 days from now)
   - Assert: `season` matches one of `['winter', 'spring', 'summer', 'autumn']` (auto-detected)
   - Assert: `status === 'active'`

3. **Create with displayMode 'number'**
   - Body: `{ displayMode: 'number', displayValue: '12345' }`
   - Assert: status 201
   - Assert: `displayMode === 'number'`

4. **Validation: invalid displayMode returns 400**
   - Body: `{ displayMode: 'invalid_mode' }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'displayMode'

5. **Validation: displayValue too long (>200 chars) returns 400**
   - Body: `{ displayValue: 'x'.repeat(201) }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'displayValue'

6. **Validation: typeText too long (>200 chars) returns 400**
   - Body: `{ typeText: 'x'.repeat(201) }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'typeText'

7. **Validation: invalid validUntil date format returns 400**
   - Body: `{ validUntil: 'not-a-date' }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'validUntil'

8. **Seasonal background selection — explicit season**
   - Body: `{ season: 'summer' }`
   - Assert: status 201
   - Assert: `res.data.season === 'summer'`

9. **Seasonal background selection — invalid season falls back to auto-detection**
   - Body: `{ season: 'invalid_season' }`
   - Assert: status 201
   - Assert: `res.data.season` is one of `['winter', 'spring', 'summer', 'autumn']`

10. **History entry recorded on create**
    - Create a certificate, then query `GET /api/history?action=certificate_create`
    - Assert: history contains an entry with the cert code

11. **Created certificate has issuedByName set**
    - Assert: `res.data.issuedByName` is truthy (matches the logged-in user)

---

### POST /api/certificates/batch

**Route:** `routes/certificates.js` line 187
**Auth:** `requireRole('admin', 'user')`
**Returns:** 201 with `{ success: true, certificates: [...] }`, or 400/500

#### Test cases:

1. **Batch of 5 certificates**
   - Body: `{ quantity: 5 }`
   - Assert: status 201
   - Assert: `res.data.success === true`
   - Assert: `res.data.certificates.length === 5`
   - Assert: all certificates have `status === 'active'`
   - Assert: all certificates have valid `certCode` matching `/^CERT-\d{4}-\d{5}$/`

2. **Batch of 10 certificates**
   - Body: `{ quantity: 10 }`
   - Assert: status 201
   - Assert: `res.data.certificates.length === 10`

3. **Batch of 15 certificates**
   - Body: `{ quantity: 15 }`
   - Assert: status 201
   - Assert: `res.data.certificates.length === 15`

4. **Batch of 20 certificates**
   - Body: `{ quantity: 20 }`
   - Assert: status 201
   - Assert: `res.data.certificates.length === 20`

5. **All generated codes are unique**
   - Create batch of 20
   - Collect all `certCode` values into a Set
   - Assert: Set size === array length (no duplicates)

6. **Invalid batch count — 0 returns 400**
   - Body: `{ quantity: 0 }`
   - Assert: status 400

7. **Invalid batch count — 3 returns 400**
   - Body: `{ quantity: 3 }`
   - Assert: status 400

8. **Invalid batch count — 25 returns 400**
   - Body: `{ quantity: 25 }`
   - Assert: status 400

9. **Invalid batch count — negative returns 400**
   - Body: `{ quantity: -5 }`
   - Assert: status 400

10. **Invalid batch count — non-number returns 400**
    - Body: `{ quantity: 'abc' }`
    - Assert: status 400

11. **Batch respects custom typeText**
    - Body: `{ quantity: 5, typeText: 'VIP пропуск' }`
    - Assert: status 201
    - Assert: all certificates have `typeText === 'VIP пропуск'`

12. **Batch respects custom season**
    - Body: `{ quantity: 5, season: 'autumn' }`
    - Assert: status 201
    - Assert: all certificates have `season === 'autumn'`

13. **Batch notes contain quantity info**
    - Create batch of 5
    - Assert: each certificate's `notes` contains 'Пакетна генерація'

14. **History entry recorded for batch**
    - Create batch, then query `GET /api/history?action=certificate_batch`
    - Assert: history contains matching entry

---

### GET /api/certificates

**Route:** `routes/certificates.js` line 17
**Auth:** global `authenticateToken` (from server.js)
**Returns:** `{ items: [...], total: N }`

#### Test cases:

1. **List all — returns object with items and total**
   - Assert: status 200
   - Assert: `res.data.items` is array
   - Assert: `typeof res.data.total === 'number'`
   - Assert: `total >= items.length`

2. **Filter by status 'active'**
   - Query: `?status=active`
   - Assert: status 200
   - Assert: all items have `status === 'active'`

3. **Filter by status 'used'**
   - Pre-condition: create a cert, then mark it as 'used'
   - Query: `?status=used`
   - Assert: status 200
   - Assert: all items have `status === 'used'`

4. **Filter by status 'revoked'**
   - Query: `?status=revoked`
   - Assert: all items (if any) have `status === 'revoked'`

5. **Filter by status 'blocked'**
   - Query: `?status=blocked`
   - Assert: all items (if any) have `status === 'blocked'`

6. **Filter by status 'expired'**
   - Query: `?status=expired`
   - Assert: all items (if any) have `status === 'expired'`

7. **Search by cert_code**
   - Create a certificate, capture its certCode
   - Query: `?search=CERT-` (partial code match)
   - Assert: status 200
   - Assert: results contain the created certificate

8. **Search by displayValue (name)**
   - Create certificate with `displayValue: 'Тестовий Пошук'`
   - Query: `?search=Тестовий`
   - Assert: results contain the created certificate

9. **Pagination: limit**
   - Query: `?limit=2`
   - Assert: `items.length <= 2`

10. **Pagination: offset**
    - Query: `?limit=1&offset=0` then `?limit=1&offset=1`
    - Assert: the two results are different items (or total allows it)

11. **Pagination: limit capped at 500**
    - Query: `?limit=999`
    - Assert: status 200 (does not crash, items returned <= 500)

12. **Default limit is 100**
    - Query without limit parameter
    - Assert: `items.length <= 100`

13. **Items are ordered by created_at DESC**
    - Create two certificates sequentially
    - Query list
    - Assert: first item's `createdAt` >= second item's `createdAt`

---

### GET /api/certificates/:id

**Route:** `routes/certificates.js` line 99
**Auth:** global `authenticateToken`
**Returns:** mapped certificate object or 404

#### Test cases:

1. **Existing certificate returns 200 with full data**
   - Create a certificate, capture its `id`
   - GET `/api/certificates/:id`
   - Assert: status 200
   - Assert: response has all mapped fields: `id`, `certCode`, `displayMode`, `displayValue`, `typeText`, `issuedAt`, `validUntil`, `issuedByUserId`, `issuedByName`, `status`, `usedAt`, `invalidatedAt`, `invalidReason`, `notes`, `season`, `telegramAlertSent`, `createdAt`, `updatedAt`

2. **Non-existent certificate returns 404**
   - GET `/api/certificates/999999`
   - Assert: status 404
   - Assert: `res.data.error === 'Certificate not found'`

3. **Invalid ID format (non-numeric) returns 500 or 404**
   - GET `/api/certificates/not-a-number`
   - Assert: status is 404 or 500

---

### GET /api/certificates/code/:code

**Route:** `routes/certificates.js` line 85
**Auth:** global `authenticateToken`
**Returns:** mapped certificate object or 404

#### Test cases:

1. **Valid code returns certificate**
   - Create a cert, capture `certCode`
   - GET `/api/certificates/code/:certCode`
   - Assert: status 200
   - Assert: `res.data.certCode === certCode`
   - Assert: response has all expected fields

2. **Code lookup is case-insensitive (uppercase normalization)**
   - Create a cert with code like `CERT-2026-12345`
   - GET `/api/certificates/code/cert-2026-12345` (lowercase)
   - Assert: status 200 (route does `.toUpperCase()`)

3. **Invalid/non-existent code returns 404**
   - GET `/api/certificates/code/CERT-0000-00000`
   - Assert: status 404
   - Assert: `res.data.error === 'Certificate not found'`

4. **Code with whitespace is trimmed**
   - GET `/api/certificates/code/ CERT-2026-12345 ` (with spaces encoded)
   - Assert: status 200 (route does `.trim()`)

---

### GET /api/certificates/qr/:code

**Route:** `routes/certificates.js` line 57
**Auth:** global `authenticateToken`
**Returns:** `{ dataUrl, deepLink, certCode }` or 404/500

#### Test cases:

1. **QR generation success for valid code**
   - Create a cert, capture `certCode`
   - GET `/api/certificates/qr/:certCode`
   - Assert: status 200 or 500 (500 if bot username not configured, which is likely in test env)
   - If 200:
     - Assert: `res.data.dataUrl` starts with `'data:image/png;base64,'`
     - Assert: `res.data.deepLink` starts with `'https://t.me/'`
     - Assert: `res.data.certCode === certCode`

2. **QR for non-existent code returns 404**
   - GET `/api/certificates/qr/CERT-0000-00000`
   - Assert: status 404

3. **QR with bot not configured returns 500**
   - This may happen naturally in test environment (no TELEGRAM_BOT_TOKEN)
   - Assert: status 500, error mentions bot username

---

### PATCH /api/certificates/:id/status

**Route:** `routes/certificates.js` line 253
**Auth:** `requireRole('admin', 'user')`
**Returns:** mapped certificate with new status, or 400/404

#### Test cases:

1. **Valid transition: active -> used**
   - Create cert (status=active)
   - PATCH with `{ status: 'used' }`
   - Assert: status 200
   - Assert: `res.data.status === 'used'`
   - Assert: `res.data.usedAt` is set (not null)

2. **Valid transition: active -> revoked**
   - Create cert
   - PATCH with `{ status: 'revoked', reason: 'Помилка видачі' }`
   - Assert: status 200
   - Assert: `res.data.status === 'revoked'`
   - Assert: `res.data.invalidatedAt` is set
   - Assert: `res.data.invalidReason === 'Помилка видачі'`

3. **Valid transition: active -> blocked**
   - Create cert
   - PATCH with `{ status: 'blocked', reason: 'Підозра на шахрайство' }`
   - Assert: status 200
   - Assert: `res.data.status === 'blocked'`
   - Assert: `res.data.invalidatedAt` is set
   - Assert: `res.data.invalidReason === 'Підозра на шахрайство'`

4. **Valid transition: active -> expired**
   - Create cert
   - PATCH with `{ status: 'expired' }`
   - Assert: status 200
   - Assert: `res.data.status === 'expired'`

5. **Invalid transition: used -> used (one-time use check)**
   - Create cert, mark as 'used'
   - PATCH again with `{ status: 'used' }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'вже використаний'

6. **Invalid transition: expired -> anything**
   - Create cert, mark as 'expired'
   - PATCH with `{ status: 'used' }`
   - Assert: status 400
   - Assert: `res.data.error` includes 'прострочений'

7. **Invalid status value returns 400**
   - PATCH with `{ status: 'invalid_status' }`
   - Assert: status 400
   - Assert: error mentions valid statuses

8. **Missing status field returns 400**
   - PATCH with `{}`
   - Assert: status 400

9. **Status change with reason text**
   - Create cert, PATCH with `{ status: 'revoked', reason: 'Тестова причина' }`
   - Assert: `res.data.invalidReason === 'Тестова причина'`

10. **Status change without reason**
    - Create cert, PATCH with `{ status: 'blocked' }` (no reason)
    - Assert: status 200
    - Assert: `res.data.invalidReason` is null

11. **Non-existent certificate returns 404**
    - PATCH `/api/certificates/999999/status` with `{ status: 'used' }`
    - Assert: status 404

12. **History entry recorded for status change**
    - Create cert, change status to 'used'
    - Query `GET /api/history?action=certificate_used`
    - Assert: history entry exists with cert code

---

### PUT /api/certificates/:id

**Route:** `routes/certificates.js` line 345
**Auth:** `requireRole('admin', 'user')`
**Returns:** mapped certificate with updated fields, or 404

#### Test cases:

1. **Update displayValue**
   - Create cert, PUT with `{ displayValue: 'Новий Отримувач' }`
   - Assert: status 200
   - Assert: `res.data.displayValue === 'Новий Отримувач'`

2. **Update typeText**
   - PUT with `{ typeText: 'VIP доступ на 3 дні' }`
   - Assert: `res.data.typeText === 'VIP доступ на 3 дні'`

3. **Update notes**
   - PUT with `{ notes: 'Оновлені нотатки' }`
   - Assert: `res.data.notes === 'Оновлені нотатки'`

4. **Update validUntil**
   - PUT with `{ validUntil: '2099-06-30' }`
   - Assert: response `validUntil` reflects new date

5. **Non-existent certificate returns 404**
   - PUT `/api/certificates/999999`
   - Assert: status 404

6. **History entry recorded for edit**
   - After PUT, query history for `certificate_edit`
   - Assert: entry exists

---

### DELETE /api/certificates/:id

**Route:** `routes/certificates.js` line 382
**Auth:** `requireRole('admin', 'user')`
**Returns:** `{ success: true }` or 404

#### Test cases:

1. **Delete existing certificate**
   - Create cert, DELETE
   - Assert: status 200
   - Assert: `res.data.success === true`
   - Verify: GET by id returns 404

2. **Delete non-existent certificate returns 404**
   - DELETE `/api/certificates/999999`
   - Assert: status 404

3. **History entry recorded for delete**
   - After DELETE, query history for `certificate_delete`
   - Assert: entry exists with cert data

---

### POST /api/certificates/:id/send-image

**Route:** `routes/certificates.js` line 414
**Auth:** `requireRole('admin', 'user')`
**Returns:** `{ success: true }` or 400/404/500

#### Test cases:

1. **Missing imageBase64 returns 400**
   - POST with `{}`
   - Assert: status 400
   - Assert: `res.data.error === 'imageBase64 is required'`

2. **Non-existent certificate returns 404**
   - POST `/api/certificates/999999/send-image` with `{ imageBase64: 'dGVzdA==' }`
   - Assert: status 404

3. **Telegram chat not configured returns 400 or 500**
   - In test env without Telegram config, POST with valid cert id and imageBase64
   - Assert: status 400 or 500

---

### Auth tests (Unauthenticated access)

All certificate endpoints go through the global `authenticateToken` middleware mounted in `server.js` line 48-53.

#### Test cases:

1. **GET /api/certificates — without token returns 401**
   - `request('GET', '/api/certificates')`
   - Assert: status 401

2. **GET /api/certificates/:id — without token returns 401**
   - `request('GET', '/api/certificates/1')`
   - Assert: status 401

3. **GET /api/certificates/code/:code — without token returns 401**
   - `request('GET', '/api/certificates/code/CERT-2026-00001')`
   - Assert: status 401

4. **GET /api/certificates/qr/:code — without token returns 401**
   - `request('GET', '/api/certificates/qr/CERT-2026-00001')`
   - Assert: status 401

5. **POST /api/certificates — without token returns 401**
   - `request('POST', '/api/certificates', {})`
   - Assert: status 401

6. **POST /api/certificates/batch — without token returns 401**
   - `request('POST', '/api/certificates/batch', { quantity: 5 })`
   - Assert: status 401

7. **PATCH /api/certificates/:id/status — without token returns 401**
   - `request('PATCH', '/api/certificates/1/status', { status: 'used' })`
   - Assert: status 401

8. **PUT /api/certificates/:id — without token returns 401**
   - `request('PUT', '/api/certificates/1', {})`
   - Assert: status 401

9. **DELETE /api/certificates/:id — without token returns 401**
   - `request('DELETE', '/api/certificates/1')`
   - Assert: status 401

10. **POST /api/certificates/:id/send-image — without token returns 401**
    - `request('POST', '/api/certificates/1/send-image', {})`
    - Assert: status 401

---

## Test Data Setup & Cleanup

### How to create test certificates
```js
// Single certificate
const createRes = await authRequest('POST', '/api/certificates', {
    displayMode: 'fio',
    displayValue: 'Тест Сертифікат',
    typeText: 'на одноразовий вхід',
    validUntil: '2099-12-31',
    season: 'winter'
});
const certId = createRes.data.id;
const certCode = createRes.data.certCode;
```

### Cleanup strategy

1. **Individual cleanup via DELETE endpoint:**
   ```js
   await authRequest('DELETE', `/api/certificates/${certId}`);
   ```

2. **Use `after()` hooks** in each `describe()` block to clean up all created certificates:
   ```js
   const createdIds = [];
   // ... in each test: createdIds.push(res.data.id);
   after(async () => {
       for (const id of createdIds) {
           await authRequest('DELETE', `/api/certificates/${id}`).catch(() => {});
       }
   });
   ```

3. **No far-future date trick needed** for certificates (unlike bookings which key on date). Certificates use sequential IDs and random codes, so they are isolated by nature. However, cleanup is still needed to avoid polluting the database.

4. **Batch cleanup** is essential since batch tests create 5-20 certs at once:
   ```js
   const batchRes = await authRequest('POST', '/api/certificates/batch', { quantity: 5 });
   // ... assertions ...
   for (const cert of batchRes.data.certificates) {
       await authRequest('DELETE', `/api/certificates/${cert.id}`).catch(() => {});
   }
   ```

---

## Cross-Dependencies

### Impact on other tests
- **History table**: Certificate creation, status changes, edits, and deletions all write to the `history` table. This means history tests that count total records or filter by action could see certificate-related entries. Mitigation: certificate history entries use unique actions (`certificate_create`, `certificate_used`, `certificate_revoked`, `certificate_blocked`, `certificate_batch`, `certificate_edit`, `certificate_delete`) that do not overlap with booking actions (`create`, `edit`, `delete`).

- **Certificate counter table**: The `certificate_counter` table tracks sequential fallback codes. Running certificate tests will increment this counter, but since the primary code generation is random (5-digit), this should not cause issues.

- **Settings table**: Certificate tests may read from `settings` table (key `cert_default_days` for validity period, key `cert_director_chat_id` for Telegram). These are read-only interactions and should not affect other tests. The `send-image` test may fail gracefully if Telegram is not configured.

- **Telegram side effects**: Certificate status changes fire async Telegram notifications (fire-and-forget after commit). In test environment without `TELEGRAM_BOT_TOKEN`, these silently fail. No impact on other tests.

### Test isolation
- Certificate tests are fully independent from booking/afisha/task tests since they operate on a separate `certificates` table.
- The `helpers.js` token cache is shared across all test suites (same admin user), which is fine.
- Certificate tests should run **after** Auth tests (to ensure login works) but can run in any order relative to other feature tests.
- Each `describe()` block must manage its own created certificate IDs and clean up in `after()`.
- Batch tests should be mindful of database load (creating up to 20 certs per test) and clean up promptly.

### Recommended test order within the certificate suite
1. `POST /api/certificates` (single create + validation) -- produces IDs for subsequent tests
2. `POST /api/certificates/batch` (batch create)
3. `GET /api/certificates` (list + filter + search + pagination)
4. `GET /api/certificates/:id` (single get)
5. `GET /api/certificates/code/:code` (lookup by code)
6. `GET /api/certificates/qr/:code` (QR generation)
7. `PUT /api/certificates/:id` (update)
8. `PATCH /api/certificates/:id/status` (status transitions)
9. `DELETE /api/certificates/:id` (delete)
10. `POST /api/certificates/:id/send-image` (Telegram image)
11. Unauthenticated access tests (all endpoints without token -> 401)

### Total estimated test count: ~65 test cases
