'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { BASE_URL, getToken } = require('../helpers');

// Actual migrated PostgreSQL + auth + booking/deposit/finance HTTP routes.
// Banquet deposits are manual accounting confirmations, not a Checkbox order.
// The acceptance stub below models a provider-accepted receipt before that
// manual confirmation. It makes no network calls or fiscal receipts.
class LocalAcceptanceStub {
    constructor() { this.accepted = new Map(); this.attempts = 0; this.charges = 0; }
    async accept(key, amount, { decline = false } = {}) {
        this.attempts++;
        if (this.accepted.has(key)) {
            const existing = this.accepted.get(key);
            assert.equal(existing.amount, amount, 'a replay key cannot change amount');
            return existing;
        }
        if (decline) return { accepted: false, amount };
        const receipt = { accepted: true, amount, reference: `LOCAL-RECEIPT-${key}` };
        this.accepted.set(key, receipt);
        this.charges++;
        return receipt;
    }
}

test('booking optimistic lock, deposit retry and balance with isolated PostgreSQL', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 180000
}, async t => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    const db = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(db.isLocal, true);
    assertSafeIsolatedTestUrl(BASE_URL);
    assert.equal(String(process.env.TELEGRAM_BOT_TOKEN || ''), '');
    assert.equal(String(process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED || 'false'), 'false');
    const pool = new Pool({ connectionString: db.url.toString(), ssl: false, max: 6 });
    const suffix = crypto.randomBytes(5).toString('hex');
    let bookingId;
    const roomId = `qa-room-deposit-${suffix}`;
    const lineId = `qa-line-deposit-${suffix}`;
    const eventDate = '2099-10-20';
    const receivedDate = new Date().toISOString().slice(0, 10);
    const provider = new LocalAcceptanceStub();
    let token;
    let directorToken;
    let booking;
    let deposit;
    let customerId;
    async function api(method, route, body, actor = token, headers = {}) {
        const response = await fetch(BASE_URL + route, { method, signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json', 'X-Business-Context': 'event_genix',
                Connection: 'close', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
    }
    const errorLabel = result => `${result.status}: ${result.body?.code || result.body?.error || 'unexpected result'}`;
    const reload = () => api('GET', `/api/bookings/detail/${bookingId}`);
    const update = (snapshot, notes) => api('PUT', `/api/bookings/${bookingId}`, { ...snapshot, notes, skipNotification: true });
    const projection = () => api('GET', `/api/banquet-deposits/${deposit.id}`);
    const confirmPayload = { clientName: 'LOCAL synthetic client', receivedDate, eventDate,
        banquetNumber: 'LOCAL synthetic banquet', amount: 600, paymentMethod: 'card', note: 'LOCAL acceptance stub receipt' };
    const confirm = payload => api('POST', `/api/banquet-deposits/${deposit.id}/confirm`, payload, directorToken,
        { 'Idempotency-Key': `qa-deposit-confirm-${suffix}` });
    try {
        token = await getToken();
        await pool.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name, is_active)
            VALUES ('event_genix', $1, 'room', 'LOCAL deposit room', true)`, [roomId]);
        await pool.query(`INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
            VALUES ('event_genix', $1, $2, 'LOCAL deposit line', '#4488aa', false)`, [eventDate, lineId]);
        await pool.query(`INSERT INTO products (id,business_context,code,timeline_code,label,name,category,duration,price,hosts)
            VALUES ('qa-local-service','event_genix','QA','QA','LOCAL QA','LOCAL service','kitchen',60,3000,1)`);
        customerId = (await pool.query(`INSERT INTO customers (business_context,name,child_name)
            VALUES ('event_genix','LOCAL synthetic client','LOCAL synthetic child') RETURNING id`)).rows[0].id;
        const password = crypto.randomBytes(22).toString('base64url');
        const director = await api('POST', '/api/users', { username: `qa.deposit.director.${suffix}`, password,
            name: 'LOCAL deposit director', role: 'director', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' });
        assert.equal(director.status, 200, errorLabel(director));
        const login = await api('POST', '/api/auth/login', { username: `qa.deposit.director.${suffix}`, password });
        assert.equal(login.status, 200, errorLabel(login));
        directorToken = login.body.accessToken;

        await t.test('valid catalog room fixture creates a booking and exactly one manager deposit', async () => {
            const created = await api('POST', '/api/bookings', { date: eventDate, time: '12:00', lineId,
                room: 'LOCAL deposit room', roomResourceId: roomId, programId: 'qa-local-service', programCode: 'QA',
                label: 'LOCAL booking deposit QA', programName: 'LOCAL service', category: 'kitchen', duration: 60,
                price: 3000, hosts: 1, kidsCount: 0, customerId, status: 'confirmed', createdBy: process.env.TEST_USER, skipNotification: true,
                deposit: { provided: true, expectedAmount: 600, managerStatus: 'Очікуємо оплату', dueDate: receivedDate } });
            assert.equal(created.status, 200, errorLabel(created));
            bookingId = created.body.booking?.id;
            assert.match(bookingId, /^BK-\d{4}-\d{4,}$/);
            confirmPayload.banquetNumber = bookingId;
            const detail = await reload();
            assert.equal(detail.status, 200, errorLabel(detail));
            booking = detail.body.booking || detail.body;
            assert.equal(booking.id, bookingId);
            assert.equal(booking.roomResourceId, roomId);
            assert.ok(booking.updatedAtVersion);
            const rows = (await pool.query('SELECT * FROM banquet_deposits WHERE primary_booking_id=$1', [bookingId])).rows;
            assert.equal(rows.length, 1);
            deposit = rows[0];
            assert.equal(deposit.expected_amount, 600);
            assert.equal(deposit.paid_amount, null);
        });
        if (!booking || !deposit) return;

        await t.test('two independent versions preserve the first save and reject the stale second save', async () => {
            const initialVersion = booking.updatedAtVersion;
            const first = await update(booking, 'LOCAL first editor');
            assert.equal(first.status, 200, errorLabel(first));
            const stale = await update(booking, 'LOCAL stale second editor');
            assert.equal(stale.status, 409, errorLabel(stale));
            assert.equal(stale.body.conflict, true);
            assert.equal(stale.body.currentData.notes, 'LOCAL first editor');
            const latest = await reload();
            booking = latest.body.booking || latest.body;
            assert.equal(booking.notes, 'LOCAL first editor');
            assert.notEqual(booking.updatedAtVersion, initialVersion);
        });

        await t.test('concurrent edits from one version produce one commit, one conflict and one finance row', async () => {
            const shared = booking;
            const results = await Promise.all([update(shared, 'LOCAL concurrent A'), update(shared, 'LOCAL concurrent B')]);
            assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
            const latest = await reload();
            booking = latest.body.booking || latest.body;
            assert.ok(['LOCAL concurrent A', 'LOCAL concurrent B'].includes(booking.notes));
            const finance = (await pool.query('SELECT amount FROM finance_transactions WHERE booking_id=$1', [bookingId])).rows;
            assert.equal(finance.length, 1);
            assert.equal(Number(finance[0].amount), 3000);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM banquet_deposits WHERE primary_booking_id=$1', [bookingId])).rows[0].n, 1);
        });

        await t.test('a declined local acceptance does not mutate deposit or balance', async () => {
            const receipt = await provider.accept('declined', 600, { decline: true });
            assert.equal(receipt.accepted, false);
            const row = (await pool.query('SELECT paid_amount FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            assert.equal(row.paid_amount, null);
            assert.equal(provider.charges, 0);
        });

        await t.test('provider accepted then local DB failure rolls back confirmation and retry recovers once', async () => {
            const receipt = await provider.accept(`deposit-${suffix}`, 600);
            confirmPayload.sourcePayload = { localAcceptanceReference: receipt.reference };
            const fn = `qa_deposit_fail_${suffix}`;
            await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.id = ${Number(deposit.id)} AND NEW.paid_amount IS NOT NULL THEN
                RAISE EXCEPTION 'LOCAL QA injected deposit confirmation failure'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER ${fn} BEFORE UPDATE ON banquet_deposits FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
            let failed;
            try { failed = await confirm(confirmPayload); }
            finally { await pool.query(`DROP TRIGGER ${fn} ON banquet_deposits; DROP FUNCTION ${fn}()`); }
            assert.equal(failed.status, 500);
            const afterFailure = (await pool.query('SELECT paid_amount,status FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            assert.equal(afterFailure.paid_amount, null);
            assert.equal(afterFailure.status, 'manager_reported');
            const replayReceipt = await provider.accept(`deposit-${suffix}`, 600);
            assert.deepEqual(replayReceipt, receipt);
            const accepted = await confirm(confirmPayload);
            if (accepted.status !== 200) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    try {
                        await require('../../services/banquetDeposits').confirmDeposit({ ...confirmPayload,
                            depositId: deposit.id, businessContext: 'event_genix',
                            clientNameSnapshot: confirmPayload.clientName, banquetNumberSnapshot: confirmPayload.banquetNumber }, { client });
                    } catch (error) {
                        console.log(JSON.stringify({ localConfirmationDiagnostic: true, code: error.code,
                            message: error.message, detail: error.detail, position: error.position, routine: error.routine }));
                    }
                } finally { await client.query('ROLLBACK'); client.release(); }
            }
            assert.equal(accepted.status, 200, errorLabel(accepted));
            assert.equal(provider.charges, 1);
            const row = (await pool.query('SELECT paid_amount,status FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            assert.equal(row.paid_amount, 600);
            assert.equal(row.status, 'accountant_verified');
        });

        await t.test('duplicate confirmation clicks preserve the verified deposit and its correction history', async () => {
            const before = (await pool.query('SELECT paid_amount,status,verified_at,corrected_at,updated_at FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            const results = await Promise.all([confirm(confirmPayload), confirm(confirmPayload)]);
            assert.deepEqual(results.map(result => result.status), [200, 200]);
            const after = (await pool.query('SELECT paid_amount,status,verified_at,corrected_at,updated_at FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            assert.deepEqual(after, before, 'identical retries must not create a financial correction');
            assert.equal(provider.charges, 1);
        });

        await t.test('confirmed deposit stays separate from performed revenue and does not double the booking balance', async () => {
            const rows = (await pool.query(`SELECT b.price,d.paid_amount,d.expected_amount,d.finance_transaction_id
                FROM bookings b JOIN banquet_deposits d ON d.primary_booking_id=b.id WHERE b.id=$1`, [bookingId])).rows;
            assert.equal(rows.length, 1);
            assert.equal(Number(rows[0].price) - Number(rows[0].paid_amount), 2400);
            assert.equal(rows[0].finance_transaction_id, null, 'manual deposit confirmation must not manufacture performed-revenue finance rows');
            const finance = (await pool.query('SELECT amount,date FROM finance_transactions WHERE booking_id=$1', [bookingId])).rows;
            assert.equal(finance.length, 1);
            assert.equal(Number(finance[0].amount), 3000, 'booking quote is not increased by the deposit');
            assert.equal(String(finance[0].date).slice(0, 10), eventDate);
            const pnl = await api('GET', `/api/finance/report/pnl?year=${receivedDate.slice(0, 4)}&month=${Number(receivedDate.slice(5, 7))}`);
            assert.equal(pnl.status, 200, errorLabel(pnl));
            assert.equal(typeof pnl.body.summary.totalIncome, 'number');
            assert.equal(pnl.body.summary.totalIncome, 0);
            assert.equal(pnl.body.bookingRevenue, 0);
            const current = await projection();
            assert.equal(current.status, 200, errorLabel(current));
            assert.equal(current.body.deposit.paidAmount, 600);
            assert.equal(current.body.deposit.primaryBookingId, bookingId);
        });

        await t.test('a real deposit correction still changes the amount and retains the original verification', async () => {
            const before = (await pool.query('SELECT paid_amount,verified_at,verified_by FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            const changed = await confirm({ ...confirmPayload, amount: 700, note: 'LOCAL genuine correction' });
            assert.equal(changed.status, 200, errorLabel(changed));
            const corrected = (await pool.query('SELECT paid_amount,status,verified_at,verified_by,corrected_at FROM banquet_deposits WHERE id=$1', [deposit.id])).rows[0];
            assert.equal(corrected.paid_amount, 700);
            assert.equal(corrected.status, 'corrected');
            assert.deepEqual(corrected.verified_at, before.verified_at);
            assert.equal(corrected.verified_by, before.verified_by);
            assert.ok(corrected.corrected_at);
            const restored = await confirm(confirmPayload);
            assert.equal(restored.status, 200, errorLabel(restored));
        });

        if (process.env.QA_BOOKING_BROWSER_HELPER) {
            await t.test('two actual local CRM tabs use the canonical edit and save workflow', async () => {
                const { runTwoTabBookingQa } = require(process.env.QA_BOOKING_BROWSER_HELPER);
                const session = await api('POST', '/api/auth/login', { username: process.env.TEST_USER, password: process.env.TEST_PASS });
                assert.equal(session.status, 200, errorLabel(session));
                await runTwoTabBookingQa({ base: BASE_URL, session: session.body, bookingId, eventDate });
            });
        }
    } finally { await pool.end(); }
});
