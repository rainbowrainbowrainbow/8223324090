'use strict';

const crypto = require('node:crypto');
const { Client } = require('pg');
const { normalizeMinorUnits, uahDecimalToMinorUnits } = require('./payments/money');
const { resolveFinanceQaAccess, assertFinanceQaCommand, assertFinanceQaEntity,
    recordFinanceQaOperation } = require('./financeMoneyQa');

const PG_MAX = 9223372036854775807n;
const COMMAND_FIELDS = {
    enroll: ['accountId', 'openingMinor', 'effectiveAt', 'reason'],
    open_shift: ['accountId'],
    close_shift: ['accountId', 'shiftId', 'actualMinor', 'reason'],
    income: ['accountId', 'categoryId', 'amountMinor', 'description', 'effectiveAt'],
    expense: ['accountId', 'categoryId', 'amountMinor', 'description', 'effectiveAt'],
    booking_receipt: ['accountId', 'bookingId', 'amountMinor', 'effectiveAt'],
    transfer: ['accountId', 'toAccountId', 'amountMinor', 'effectiveAt', 'reason'],
    refund: ['originalId', 'amountMinor', 'reason', 'effectiveAt'],
    reverse: ['originalId', 'reason', 'effectiveAt']
};
const SHIFT_SELECT = `s.*, s.opened_at AT TIME ZONE 'UTC' AS opened_at_utc,
    s.closed_at AT TIME ZONE 'UTC' AS closed_at_utc`;

function fail(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    throw error;
}

function isLocalManualMoneyEnabled(queryable) {
    if (process.env.NODE_ENV !== 'test' || process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true') return false;
    if (Object.keys(process.env).some(key => /^RAILWAY_/.test(key) && process.env[key])) return false;
    try {
        // pg resolves connectionString before discrete options; inspect that same effective configuration without connecting.
        const parameters = queryable?.connectionParameters
            || (queryable?.options ? new Client(queryable.options).connectionParameters : null);
        if (!parameters) return false;
        const host = String(parameters.host || '').toLowerCase();
        const database = String(parameters.database || '').toLowerCase();
        return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)
            && /(^|[_-])(test|testing|ci|disposable)([_-]|$)/.test(database)
            && !/(production|railway|rlwy|primary-db)/.test(`${host}/${database}`)
            && !/(^|[_-])(prod|live)([_-]|$)/.test(database);
    } catch {
        return false;
    }
}

function assertEnabled(pool, context = {}) {
    if (!isLocalManualMoneyEnabled(pool) && !context.qaToken) {
        fail(403, 'MANUAL_MONEY_UNAVAILABLE', 'Ручний облік доступний лише в погодженому тестовому запуску.');
    }
}

function contextValue(value) {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
        fail(400, 'BUSINESS_CONTEXT_INVALID', 'Некоректний контекст бізнесу.');
    }
    return value;
}

function positiveId(value, field) {
    if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))
        || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
        fail(400, 'ID_INVALID', `Некоректне поле ${field}.`);
    }
    return Number(value);
}

function textValue(value, field, maxLength, required = false) {
    if (value === undefined || value === null || value === '') {
        if (required) fail(400, 'TEXT_REQUIRED', `Заповніть поле ${field}.`);
        return null;
    }
    if (typeof value !== 'string' || value.trim().length > maxLength || (required && !value.trim())) {
        fail(400, 'TEXT_INVALID', `Некоректне поле ${field}.`);
    }
    return value.trim() || null;
}

function minorValue(value, field, allowZero = false) {
    if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
        fail(400, 'AMOUNT_INVALID', `${field}: сума має бути рядком цілих копійок.`);
    }
    const minor = normalizeMinorUnits(value);
    if ((!allowZero && minor === 0n) || minor > PG_MAX) fail(400, 'AMOUNT_INVALID', `${field}: сума поза дозволеними межами.`);
    return minor.toString();
}

function canonicalPayload(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(COMMAND_FIELDS, input.command)) {
        fail(400, 'COMMAND_INVALID', 'Невідома команда ручного обліку.');
    }
    const allowed = new Set(['command', 'idempotencyKey', ...COMMAND_FIELDS[input.command]]);
    if (Object.keys(input).some(key => !allowed.has(key))) fail(400, 'COMMAND_FIELDS_INVALID', 'Команда містить зайві поля.');
    const result = { command: input.command, idempotencyKey: textValue(input.idempotencyKey, 'idempotencyKey', 160, true) };
    for (const field of COMMAND_FIELDS[input.command]) {
        const value = input[field];
        if (['accountId', 'toAccountId', 'categoryId', 'shiftId'].includes(field)) result[field] = positiveId(value, field);
        else if (field === 'originalId') {
            if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d{0,18}$/.test(String(value))
                || BigInt(String(value)) > PG_MAX || (typeof value === 'number' && !Number.isSafeInteger(value))) {
                fail(400, 'ID_INVALID', 'Некоректна початкова операція.');
            }
            result[field] = String(value);
        } else if (field.endsWith('Minor')) result[field] = minorValue(value, field, field !== 'amountMinor');
        else if (field === 'bookingId') result[field] = textValue(value, field, 50, true);
        else if (field === 'effectiveAt') {
            if (value === undefined || value === null) result[field] = null;
            else {
                const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
                const calendarValid = parts && Number(parts[1]) >= 1 && Number(parts[2]) >= 1 && Number(parts[2]) <= 12
                    && Number(parts[3]) >= 1 && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate()
                    && Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59;
                if (!calendarValid || !Number.isFinite(Date.parse(value))) fail(400, 'EFFECTIVE_TIME_INVALID', 'Дата операції має містити коректні день, час і часовий пояс.');
                result[field] = new Date(value).toISOString();
            }
        } else result[field] = textValue(value, field, field === 'reason' ? 1000 : 2000, field === 'reason' && input.command !== 'close_shift');
    }
    if (result.command === 'transfer' && result.accountId === result.toAccountId) fail(400, 'SAME_ACCOUNT_TRANSFER', 'Виберіть два різні рахунки.');
    return result;
}

function iso(value) { return value ? new Date(value).toISOString() : null; }

async function assertLegacyAccountWritable(queryable, businessContext, accountId) {
    if (!accountId) return;
    await queryable.query('SELECT id FROM finance_accounts WHERE id = $1 AND business_context = $2 FOR UPDATE', [accountId, businessContext]);
    const result = await queryable.query('SELECT 1 FROM finance_manual_accounts WHERE account_id = $1 AND business_context = $2', [accountId, businessContext]);
    if (result.rowCount) fail(409, 'MANUAL_ACCOUNT_OWNED', 'Цей рахунок ведеться у ручному журналі. Використайте його операції.');
}

async function assertLegacyBookingWritable(queryable, businessContext, bookingId) {
    if (!bookingId) return;
    await queryable.query('SELECT id FROM bookings WHERE id = $1 AND business_context = $2 FOR UPDATE', [bookingId, businessContext]);
    const result = await queryable.query('SELECT 1 FROM finance_manual_booking_scopes WHERE booking_id = $1 AND business_context = $2', [bookingId, businessContext]);
    if (result.rowCount) fail(409, 'MANUAL_BOOKING_OWNED', 'Оплати цього бронювання ведуться у ручному журналі.');
}

async function accountBlockReason(client, account, businessContext) {
    if (!account.is_active) return 'Рахунок архівований.';
    if (account.is_personal || !['cash', 'card', 'bank'].includes(account.type)) return 'Особистий або непідтримуваний тип рахунку.';
    const evidence = await client.query(`SELECT
        EXISTS (SELECT 1 FROM finance_transactions t WHERE t.account_id = $1
            OR (t.account_id IS NULL AND t.account_name = $2 AND COALESCE(t.business_context, 'event_genix') = $3))
        OR EXISTS (SELECT 1 FROM reports r WHERE r.account_id = $1
            OR (r.account_id IS NULL AND r.account_name = $2 AND COALESCE(to_jsonb(r)->>'business_context', 'event_genix') = $3))
        OR EXISTS (SELECT 1 FROM personal_account_transactions WHERE account_id = $1)
        OR EXISTS (SELECT 1 FROM payment_orders p WHERE
            COALESCE(p.business_context, p.source_snapshot->>'business_context', 'event_genix') = $3
            AND (p.source_snapshot->>'account_id' = $1::text OR p.source_snapshot->>'accountId' = $1::text))
        AS blocked`, [account.id, account.name, businessContext]);
    return evidence.rows[0].blocked ? 'Є записи іншого фінансового процесу. Спочатку потрібне узгодження джерела обліку.' : null;
}

async function bookingBlockReason(client, booking, businessContext, returningConfirmedMoney = false) {
    // A later booking status change cannot erase or trap an already confirmed receipt.
    if (!returningConfirmedMoney && booking.status !== 'confirmed') {
        return 'Для нового платежу потрібне підтверджене бронювання.';
    }
    if (booking.linked_to || /banquet/i.test(String(booking.category || ''))) return 'Групові та банкетні бронювання мають окремий процес оплати.';
    if (booking.certificate_id) return 'Сертифікат обслуговується своїм процесом.';
    if (BigInt(booking.paid_amount || 0) !== 0n || ['paid', 'partial'].includes(booking.payment_status)) return 'Є попередній стан оплати. Потрібне узгодження історії.';
    const result = await client.query(`SELECT
        EXISTS (SELECT 1 FROM bookings b WHERE b.linked_to = $1)
        OR EXISTS (SELECT 1 FROM banquet_group_bookings WHERE booking_id = $1)
        OR EXISTS (SELECT 1 FROM banquet_groups WHERE primary_booking_id = $1)
        OR EXISTS (SELECT 1 FROM booking_banquet_links WHERE booking_a_id = $1 OR booking_b_id = $1)
        OR EXISTS (SELECT 1 FROM banquet_deposits WHERE primary_booking_id = $1)
        OR EXISTS (SELECT 1 FROM receipts WHERE booking_id = $1)
        OR EXISTS (SELECT 1 FROM payment_orders p WHERE
            COALESCE(p.business_context, p.source_snapshot->>'business_context', 'event_genix') = $2
            AND ((p.source_type = 'booking' AND p.source_id = $1)
                OR p.source_snapshot->>'booking_id' = $1 OR p.source_snapshot->>'bookingId' = $1)) AS blocked`, [booking.id, businessContext]);
    if (result.rows[0].blocked) return 'Бронювання належить банкетному, фіскальному або іншому процесу оплати.';
    const legacy = await client.query(`SELECT t.*, c.name AS category_name, c.is_system AS category_system
        FROM finance_transactions t LEFT JOIN finance_categories c ON c.id = t.category_id
        WHERE t.booking_id = $1 AND COALESCE(t.business_context, 'event_genix') = $2`, [booking.id, businessContext]);
    // The one full-price unallocated row is the existing booking-value projection, never a receipt.
    if (legacy.rows.length > 1 || legacy.rows.some(row => row.type !== 'income' || row.account_id || row.account_name
        || row.certificate_id || row.staff_id || String(row.amount) !== String(booking.price)
        || !row.category_system || row.category_name !== 'Бронювання'
        || ![null, undefined, 'manual', 'booking', 'booking_sync'].includes(row.source))) {
        return 'Є неоднозначні або фактичні попередні фінансові записи бронювання.';
    }
    return null;
}

async function balanceOf(client, businessContext, accountId) {
    const result = await client.query(`SELECT a.opening_minor::numeric + COALESCE(SUM(l.amount_minor), 0) AS balance
        FROM finance_manual_accounts a LEFT JOIN finance_manual_legs l
          ON l.account_id = a.account_id AND l.business_context = a.business_context
        WHERE a.account_id = $1 AND a.business_context = $2 GROUP BY a.account_id`, [accountId, businessContext]);
    if (!result.rows.length) fail(409, 'ACCOUNT_NOT_ENROLLED', 'Спочатку почніть ручний облік цього рахунку.');
    return BigInt(result.rows[0].balance);
}

async function shiftDto(client, row) {
    if (!row) return null;
    let expected = row.expected_minor;
    if (row.status === 'open') {
        const sum = await client.query('SELECT COALESCE(SUM(amount_minor), 0) AS net FROM finance_manual_legs WHERE shift_id = $1', [row.id]);
        expected = (BigInt(row.opening_minor) + BigInt(sum.rows[0].net)).toString();
    }
    return { id: row.id, accountId: row.account_id, status: row.status, openedAt: iso(row.opened_at_utc), closedAt: iso(row.closed_at_utc),
        openingMinor: String(row.opening_minor), expectedMinor: expected == null ? null : String(expected),
        actualMinor: row.closing_minor == null ? null : String(row.closing_minor),
        differenceMinor: row.difference_minor == null ? null : String(row.difference_minor), reason: row.notes || null };
}

async function bookingSummary(client, businessContext, bookingId, knownBooking) {
    const booking = knownBooking || (await client.query('SELECT * FROM bookings WHERE id = $1 AND business_context = $2', [bookingId, businessContext])).rows[0];
    if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Бронювання не знайдено у цьому бізнесі.');
    const scope = await client.query('SELECT 1 FROM finance_manual_booking_scopes WHERE booking_id = $1 AND business_context = $2', [bookingId, businessContext]);
    const sum = await client.query(`SELECT COALESCE(SUM(l.amount_minor), 0) AS paid FROM finance_manual_operations o
        JOIN finance_manual_legs l ON l.operation_id = o.id AND l.business_context = o.business_context
        WHERE o.booking_id = $1 AND o.business_context = $2`, [bookingId, businessContext]);
    const total = uahDecimalToMinorUnits(String(booking.price || 0));
    const paid = BigInt(sum.rows[0].paid);
    const reason = await bookingBlockReason(client, booking, businessContext);
    return { bookingId, label: booking.label || booking.program_name || bookingId, status: booking.status,
        totalMinor: total.toString(), paidMinor: paid.toString(), remainingMinor: (total - paid).toString(),
        legacyPaidMinor: uahDecimalToMinorUnits(String(booking.paid_amount || 0)).toString(),
        enrolled: scope.rowCount > 0, eligible: !reason, blockedReason: reason };
}

function createFinanceMoneyService(pool) {
    async function readSnapshot(context, endpoint, read) {
        assertEnabled(pool, context);
        const client = await pool.connect();
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const qa = await resolveFinanceQaAccess(client, { actor: context.actor, businessContext: context.businessContext,
                token: context.qaToken, endpoint });
            if (!qa && !isLocalManualMoneyEnabled(pool)) fail(403, 'MANUAL_MONEY_UNAVAILABLE', 'Потрібен чинний тестовий запуск.');
            const result = await read(client, qa);
            await client.query('COMMIT');
            return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async function getWorkspace(context) {
        const { businessContext } = context;
        contextValue(businessContext);
        return readSnapshot(context, 'GET /api/finance/manual-money', async (client, qa) => {
            const source = await client.query(`SELECT a.*, m.opening_minor, m.cutoff_at
                FROM finance_accounts a LEFT JOIN finance_manual_accounts m ON m.account_id = a.id AND m.business_context = a.business_context
                WHERE a.business_context = $1 AND a.finance_qa_run_id IS NOT DISTINCT FROM $2::bigint
                ORDER BY a.sort_order, a.id`, [businessContext, qa?.runId || null]);
            const accounts = [];
            for (const account of source.rows) {
                const blockedReason = await accountBlockReason(client, account, businessContext);
                const shift = await client.query(`SELECT ${SHIFT_SELECT} FROM cash_register_shifts s
                    WHERE s.business_context = $1 AND s.account_id = $2 AND s.status = 'open'`, [businessContext, account.id]);
                accounts.push({ id: account.id, name: account.name, type: account.type, emoji: account.emoji,
                    description: account.description, enrolled: account.cutoff_at != null, eligible: !blockedReason, blockedReason,
                    openingMinor: account.opening_minor == null ? null : String(account.opening_minor), cutoffAt: iso(account.cutoff_at),
                    balanceMinor: account.cutoff_at ? (await balanceOf(client, businessContext, account.id)).toString() : null,
                    openShift: await shiftDto(client, shift.rows[0]) });
            }
            const history = await client.query(`SELECT * FROM finance_manual_operations WHERE business_context = $1
                AND finance_qa_run_id IS NOT DISTINCT FROM $2::bigint
                ORDER BY recorded_at DESC, id DESC LIMIT 101`, [businessContext, qa?.runId || null]);
            const operationIds = history.rows.slice(0, 100).map(row => row.id);
            const legs = operationIds.length ? (await client.query(`SELECT * FROM finance_manual_legs
                WHERE business_context = $1 AND operation_id = ANY($2::bigint[]) ORDER BY id`, [businessContext, operationIds])).rows : [];
            const operations = history.rows.slice(0, 100).map(row => ({ id: String(row.id), command: row.command,
                accountId: row.result?.accountId || null, shiftId: row.result?.shiftId || null,
                amountMinor: row.amount_minor == null ? null : String(row.amount_minor), effectiveAt: iso(row.effective_at), recordedAt: iso(row.recorded_at),
                bookingId: row.booking_id, originalId: row.original_id == null ? null : String(row.original_id), categoryId: row.category_id,
                description: row.description, reason: row.reason, actorId: row.actor_user_id,
                legs: legs.filter(leg => String(leg.operation_id) === String(row.id)).map(leg => ({ accountId: leg.account_id, amountMinor: String(leg.amount_minor), shiftId: leg.shift_id })) }));
            const shiftRows = await client.query(`SELECT ${SHIFT_SELECT} FROM cash_register_shifts s WHERE s.business_context = $1
                AND s.account_id IS NOT NULL AND s.finance_qa_run_id IS NOT DISTINCT FROM $2::bigint
                ORDER BY s.opened_at DESC, s.id DESC LIMIT 101`, [businessContext, qa?.runId || null]);
            const shifts = [];
            for (const row of shiftRows.rows.slice(0, 100)) shifts.push(await shiftDto(client, row));
            return { success: true, available: true, businessContext, currency: 'UAH', coverage: 'manual-only', accounts, operations, shifts,
                qa: qa ? { runId: qa.publicRunId, actorId: qa.actorId, businessContext, expiresAt: qa.expiresAt, counts: qa.counts } : null,
                hasMoreOperations: history.rows.length > 100, hasMoreShifts: shiftRows.rows.length > 100,
                limitations: [qa ? 'Тестовий запуск: ці записи виключені з робочого обліку компанії.' : 'Лише ізольована локальна перевірка; це не загальний баланс компанії.',
                    'Початкові залишки та перекази не є доходом. Дані P&L і старі поля оплати не змінюються.',
                    'Різниця закриття зміни є спостереженням і не змінює обліковий залишок.',
                    'Фіскальні, зарплатні, банкетні та сертифікатні платежі ведуться окремими процесами.'] };
        });
    }

    async function getBookingSummary(context) {
        const { businessContext } = context;
        contextValue(businessContext);
        const bookingId = textValue(context.bookingId, 'bookingId', 50, true);
        return readSnapshot(context, 'GET /api/finance/manual-money/bookings/:bookingId', async (client, qa) => {
            if (qa) await assertFinanceQaEntity(client, qa, 'booking', bookingId);
            return bookingSummary(client, businessContext, bookingId);
        });
    }

    async function execute(context, input) {
        const { businessContext, actor } = context;
        assertEnabled(pool, context);
        contextValue(businessContext);
        const actorId = positiveId(actor?.id, 'actor');
        const payload = canonicalPayload(input);
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Lock order: QA run -> request identity -> booking -> account IDs ascending -> original/shift.
            const qa = await resolveFinanceQaAccess(client, { actor, businessContext, token: context.qaToken,
                endpoint: 'POST /api/finance/manual-money/commands', forUpdate: true });
            if (!qa && !isLocalManualMoneyEnabled(pool)) fail(403, 'MANUAL_MONEY_UNAVAILABLE', 'Потрібен чинний тестовий запуск.');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [JSON.stringify([businessContext, actorId, payload.command, payload.idempotencyKey])]);
            const replay = await client.query(`SELECT request_fingerprint, result, finance_qa_run_id FROM finance_manual_operations
                WHERE business_context = $1 AND actor_user_id = $2 AND command = $3 AND idempotency_key = $4`,
            [businessContext, actorId, payload.command, payload.idempotencyKey]);
            if (replay.rows.length) {
                if (String(replay.rows[0].finance_qa_run_id || '') !== String(qa?.runId || '')) {
                    fail(409, 'IDEMPOTENCY_SCOPE_CONFLICT', 'Цей ключ належить іншому тестовому запуску.');
                }
                if (replay.rows[0].request_fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Цей ключ запиту вже використано з іншими даними.');
                await client.query('COMMIT');
                return { ...replay.rows[0].result, replayed: true };
            }
            const quota = qa ? await assertFinanceQaCommand(client, qa, payload) : null;

            let original = null;
            let originalLegs = [];
            if (payload.originalId) {
                original = (await client.query('SELECT * FROM finance_manual_operations WHERE id = $1 AND business_context = $2', [payload.originalId, businessContext])).rows[0];
                if (!original) fail(404, 'ORIGINAL_NOT_FOUND', 'Початкову операцію не знайдено.');
                const refundable = payload.command === 'refund' ? ['income', 'booking_receipt'] : ['income', 'expense', 'booking_receipt', 'transfer'];
                if (!refundable.includes(original.command)) fail(409, 'ORIGINAL_NOT_REVERSIBLE', 'Для цієї операції така дія недоступна.');
                originalLegs = (await client.query('SELECT * FROM finance_manual_legs WHERE operation_id = $1 AND business_context = $2 ORDER BY account_id', [original.id, businessContext])).rows;
            }
            const bookingId = payload.bookingId || original?.booking_id || null;
            let booking = null;
            if (bookingId) {
                booking = (await client.query('SELECT * FROM bookings WHERE id = $1 AND business_context = $2 FOR UPDATE', [bookingId, businessContext])).rows[0];
                if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Бронювання не знайдено у цьому бізнесі.');
            }
            const accountIds = [...new Set(original ? originalLegs.map(row => row.account_id) : [payload.accountId, payload.toAccountId].filter(Boolean))].sort((a, b) => a - b);
            const locked = await client.query(`SELECT * FROM finance_accounts WHERE business_context = $1
                AND id = ANY($2::integer[]) ORDER BY id FOR UPDATE`, [businessContext, accountIds]);
            if (locked.rows.length !== accountIds.length || !accountIds.length) fail(404, 'ACCOUNT_NOT_FOUND', 'Рахунок не знайдено у цьому бізнесі.');
            const accounts = new Map(locked.rows.map(row => [row.id, row]));
            if (['open_shift', 'close_shift'].includes(payload.command) && accounts.get(payload.accountId).type !== 'cash') {
                fail(409, 'CASH_ACCOUNT_REQUIRED', 'Зміна потрібна лише готівковій касі.');
            }
            const scopes = new Map();
            const balances = new Map();
            const openShifts = new Map();
            for (const account of locked.rows) {
                const reason = await accountBlockReason(client, account, businessContext);
                if (reason) fail(409, 'ACCOUNT_SOURCE_CONFLICT', reason);
                const enrollment = (await client.query('SELECT * FROM finance_manual_accounts WHERE account_id = $1 AND business_context = $2', [account.id, businessContext])).rows[0];
                if (payload.command === 'enroll') {
                    if (enrollment) fail(409, 'ACCOUNT_ALREADY_ENROLLED', 'Рахунок уже має підтверджений початковий залишок.');
                } else {
                    if (!enrollment) fail(409, 'ACCOUNT_NOT_ENROLLED', 'Спочатку почніть ручний облік рахунку.');
                    scopes.set(account.id, enrollment);
                    balances.set(account.id, await balanceOf(client, businessContext, account.id));
                    const shift = (await client.query(`SELECT ${SHIFT_SELECT} FROM cash_register_shifts s
                        WHERE s.account_id = $1 AND s.business_context = $2 AND s.status = 'open' FOR UPDATE`, [account.id, businessContext])).rows[0];
                    openShifts.set(account.id, shift || null);
                }
            }
            if (booking) {
                const reason = await bookingBlockReason(client, booking, businessContext, Boolean(original));
                if (reason) fail(409, 'BOOKING_SOURCE_CONFLICT', reason);
            }
            if (original) await client.query('SELECT id FROM finance_manual_operations WHERE id = $1 FOR UPDATE', [original.id]);
            const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
            const effectiveAt = payload.effectiveAt || iso(now);
            const assertAfter = (boundary, code, message) => {
                if (new Date(effectiveAt) >= new Date(boundary)) return;
                if (!payload.effectiveAt) fail(409, 'MANUAL_CLOCK_REGRESSION', 'Час сервера передує вже підтвердженій фінансовій події. Операцію не записано; повторіть після перевірки часу сервера.');
                fail(400, code, message);
            };
            if (new Date(effectiveAt).getTime() > new Date(now).getTime()) fail(400, 'EFFECTIVE_TIME_FUTURE', 'Дата руху коштів не може бути в майбутньому.');
            if (original) assertAfter(original.effective_at, 'EFFECTIVE_TIME_BEFORE_ORIGINAL', 'Повернення не може передувати початковій операції.');
            for (const [accountId, scope] of scopes) {
                assertAfter(scope.cutoff_at, 'EFFECTIVE_TIME_BEFORE_CUTOFF', 'Дата операції передує початку обліку рахунку.');
                const account = accounts.get(accountId);
                const shift = openShifts.get(accountId);
                if (!['open_shift', 'close_shift'].includes(payload.command) && account.type === 'cash') {
                    if (!shift) fail(409, 'SHIFT_REQUIRED', 'Для операції з готівкою відкрийте зміну вибраної каси.');
                    assertAfter(shift.opened_at_utc, 'EFFECTIVE_TIME_BEFORE_SHIFT', 'Дата операції передує поточній відкритій зміні.');
                }
            }

            let amount = payload.amountMinor || payload.openingMinor || null;
            let categoryId = payload.categoryId || original?.category_id || null;
            let shiftId = null;
            let legs = [];
            if (payload.command === 'enroll') {
                await client.query(`INSERT INTO finance_manual_accounts(account_id, business_context, opening_minor, cutoff_at, enrolled_by, reason, finance_qa_run_id)
                    VALUES($1, $2, $3, $4, $5, $6, $7)`, [payload.accountId, businessContext, payload.openingMinor, effectiveAt, actorId, payload.reason, qa?.runId || null]);
            } else if (payload.command === 'open_shift') {
                if (openShifts.get(payload.accountId)) fail(409, 'SHIFT_ALREADY_OPEN', 'У цієї каси вже є відкрита зміна.');
                const created = await client.query(`INSERT INTO cash_register_shifts
                    (business_context, account_id, opened_by, opened_at, opening_cash, opening_minor, status, finance_qa_run_id)
                    VALUES($1,$2,$3,$4::timestamptz AT TIME ZONE 'UTC',0,$5,'open',$6) RETURNING id`,
                [businessContext, payload.accountId, actorId, effectiveAt, balances.get(payload.accountId).toString(), qa?.runId || null]);
                shiftId = created.rows[0].id;
            } else if (payload.command === 'close_shift') {
                const shift = openShifts.get(payload.accountId);
                if (!shift || shift.id !== payload.shiftId) fail(409, 'SHIFT_NOT_OPEN', 'Ця зміна не є відкритою зміною вибраної каси.');
                const expected = balances.get(payload.accountId);
                const difference = BigInt(payload.actualMinor) - expected;
                if (difference !== 0n && !payload.reason) fail(400, 'RECONCILIATION_REASON_REQUIRED', 'Поясніть різницю фактичної та очікуваної готівки.');
                await client.query(`UPDATE cash_register_shifts SET status = 'closed', closed_by = $1,
                    closed_at = $2::timestamptz AT TIME ZONE 'UTC', closing_minor = $3, expected_minor = $4, difference_minor = $5, notes = $6
                    WHERE id = $7 AND account_id = $8 AND business_context = $9 AND status = 'open'`,
                [actorId, effectiveAt, payload.actualMinor, expected.toString(), difference.toString(), payload.reason, shift.id, payload.accountId, businessContext]);
                shiftId = shift.id;
                amount = payload.actualMinor;
            } else if (['income', 'expense'].includes(payload.command)) {
                const category = (await client.query('SELECT * FROM finance_categories WHERE id = $1 AND business_context = $2 FOR SHARE', [categoryId, businessContext])).rows[0];
                if (!category) fail(404, 'CATEGORY_NOT_FOUND', 'Категорію не знайдено у цьому бізнесі.');
                if (category.type !== payload.command) fail(400, 'CATEGORY_TYPE_INVALID', 'Категорія має інший тип операції.');
                if (!category.is_active || category.is_system) fail(409, 'CATEGORY_SOURCE_CONFLICT', 'Системна або архівна категорія недоступна для довільної ручної операції.');
                legs = [{ accountId: payload.accountId, amountMinor: payload.command === 'expense' ? -BigInt(amount) : BigInt(amount) }];
            } else if (payload.command === 'booking_receipt') {
                const summary = await bookingSummary(client, businessContext, bookingId, booking);
                if (BigInt(amount) > BigInt(summary.remainingMinor)) fail(409, 'BOOKING_OVERPAYMENT', 'Сума перевищує залишок до оплати бронювання.');
                await client.query(`INSERT INTO finance_manual_booking_scopes(booking_id, business_context, enrolled_by, finance_qa_run_id)
                    VALUES($1,$2,$3,$4) ON CONFLICT (booking_id) DO NOTHING`, [bookingId, businessContext, actorId, qa?.runId || null]);
                legs = [{ accountId: payload.accountId, amountMinor: BigInt(amount) }];
            } else if (payload.command === 'transfer') {
                if (locked.rows.some(row => row.type !== 'cash')) fail(409, 'TRANSFER_CASH_ONLY', 'Перший ручний блок підтримує лише переказ між двома касами.');
                legs = [{ accountId: payload.accountId, amountMinor: -BigInt(amount) }, { accountId: payload.toAccountId, amountMinor: BigInt(amount) }];
            } else if (original) {
                const linked = (await client.query(`SELECT command, amount_minor FROM finance_manual_operations
                    WHERE original_id = $1 AND business_context = $2`, [original.id, businessContext])).rows;
                if (linked.some(row => row.command === 'reverse')) fail(409, 'ORIGINAL_ALREADY_REVERSED', 'Початкову операцію вже сторновано.');
                const refunded = linked.reduce((sum, row) => sum + BigInt(row.amount_minor || 0), 0n);
                if (payload.command === 'refund') {
                    if (BigInt(amount) + refunded > BigInt(original.amount_minor)) fail(409, 'REFUND_EXCEEDS_ORIGINAL', 'Сума повернення перевищує неповернений залишок операції.');
                    legs = [{ accountId: originalLegs[0].account_id, amountMinor: -BigInt(amount) }];
                } else {
                    if (refunded !== 0n) fail(409, 'ORIGINAL_PARTIALLY_REFUNDED', 'Після часткового повернення поверніть залишок окремою операцією.');
                    amount = String(original.amount_minor);
                    legs = originalLegs.map(row => ({ accountId: row.account_id, amountMinor: -BigInt(row.amount_minor) }));
                }
            }
            for (const leg of legs) {
                const next = balances.get(leg.accountId) + leg.amountMinor;
                if (next < 0n) fail(409, 'INSUFFICIENT_BALANCE', 'На рахунку недостатньо коштів.');
                if (next > PG_MAX) fail(409, 'BALANCE_LIMIT', 'Залишок перевищує підтримувану межу.');
            }
            const operation = await client.query(`INSERT INTO finance_manual_operations
                (business_context, command, actor_user_id, idempotency_key, request_fingerprint, amount_minor, category_id,
                 booking_id, original_id, description, reason, effective_at, finance_qa_run_id)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [businessContext, payload.command, actorId, payload.idempotencyKey, fingerprint, amount, categoryId, bookingId,
                original?.id || null, payload.description || null, payload.reason || null, effectiveAt, qa?.runId || null]);
            const operationId = String(operation.rows[0].id);
            for (const leg of legs) {
                await client.query(`INSERT INTO finance_manual_legs(operation_id, account_id, business_context, shift_id, amount_minor, finance_qa_run_id)
                    VALUES($1,$2,$3,$4,$5,$6)`, [operationId, leg.accountId, businessContext, openShifts.get(leg.accountId)?.id || null, leg.amountMinor.toString(), qa?.runId || null]);
            }
            const result = { success: true, replayed: false, operationId };
            if (payload.accountId) result.accountId = payload.accountId;
            if (shiftId) result.shiftId = shiftId;
            if (booking) result.bookingSummary = await bookingSummary(client, businessContext, bookingId, booking);
            await client.query('UPDATE finance_manual_operations SET result = $1::jsonb WHERE id = $2', [JSON.stringify(result), operationId]);
            if (qa) await recordFinanceQaOperation(client, qa, { operationId, shiftId, positiveMinor: quota.positiveMinor });
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') fail(409, 'MANUAL_MONEY_CONFLICT', 'Стан обліку вже змінився. Оновіть дані та перевірте результат.');
            throw error;
        } finally { client.release(); }
    }

    return { getWorkspace, getBookingSummary, execute };
}

module.exports = { createFinanceMoneyService, isLocalManualMoneyEnabled, assertLegacyAccountWritable, assertLegacyBookingWritable };
