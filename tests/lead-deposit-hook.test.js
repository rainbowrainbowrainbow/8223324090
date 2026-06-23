const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/kleshnya',
        '../services/banquetDeposits',
        '../services/leadNotifier',
        '../services/telegram',
        '../services/maysternyaBookingWebhook',
        '../routes/leads'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function createLead(overrides = {}) {
    return {
        id: 501,
        business_context: 'event_genix',
        client_name: 'Client Deposit',
        phone: '+380000000001',
        instagram: 'client_deposit',
        source: 'instagram',
        source_channel: 'instagram',
        assigned_to: null,
        status: 'proposal',
        pipeline_stage: 'deal',
        lead_type: 'quality',
        quality_category: 'birthday',
        event_date: '2099-07-20',
        booking_id: null,
        lost_reason: null,
        notes: 'Lead note',
        created_at: '2099-05-01T10:00:00Z',
        updated_at: '2099-05-02T10:00:00Z',
        ...overrides
    };
}

function createPoolFixture({ oldStage = 'deal', depositProjection = {}, depositTaskId = null } = {}) {
    const queries = [];
    const state = {
        lead: createLead({ pipeline_stage: oldStage, status: oldStage === 'deposit_received' ? 'booked' : 'proposal' })
    };
    const client = {
        async query(text, params = []) {
            queries.push({ text: String(text), params });
            const sql = String(text);
            if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: 0 };
            if (/SELECT id, pipeline_stage, status\s+FROM leads/i.test(sql) && /FOR UPDATE/i.test(sql)) {
                return {
                    rows: [{
                        id: state.lead.id,
                        pipeline_stage: oldStage,
                        status: oldStage === 'deposit_received' ? 'booked' : 'proposal'
                    }]
                };
            }
            if (/UPDATE leads SET/i.test(sql) && /RETURNING \*/i.test(sql)) {
                const paramFor = column => {
                    const match = sql.match(new RegExp(`${column} = \\$(\\d+)`, 'i'));
                    return match ? params[Number(match[1]) - 1] : undefined;
                };
                const next = {
                    ...state.lead,
                    pipeline_stage: paramFor('pipeline_stage') || state.lead.pipeline_stage,
                    status: paramFor('status') || state.lead.status,
                    business_context: params[params.length - 1] || state.lead.business_context
                };
                state.lead = next;
                return { rows: [next], rowCount: 1 };
            }
            if (/INSERT INTO lead_interactions/i.test(sql)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected client query: ${sql}`);
        },
        release() {}
    };
    const pool = {
        async connect() { return client; },
        async query(text, params = []) {
            queries.push({ text: String(text), params });
            const sql = String(text);
            if (/FROM tasks t/i.test(sql) && /source_type = 'banquet_deposit'/i.test(sql)) {
                return { rows: [] };
            }
            if (/FROM tasks t/i.test(sql) && /t\.id = \$1/i.test(sql)) {
                return depositTaskId ? { rows: [{ id: depositTaskId, status: 'todo' }] } : { rows: [] };
            }
            if (/FROM users/i.test(sql) && /accountant/i.test(sql)) {
                return { rows: [{ id: 19, username: 'accountant', name: 'Accountant User', role: 'accountant' }] };
            }
            if (/FROM bookings/i.test(sql)) return { rows: [] };
            if (/FROM customers/i.test(sql)) return { rows: [] };
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    };
    return {
        pool,
        queries,
        depositRow: {
            id: 77,
            accountantTaskId: depositTaskId,
            status: depositProjection.status || 'needs_booking_link',
            ...depositProjection.deposit
        },
        depositProjection: {
            state: 'pending',
            status: 'needs_booking_link',
            businessContext: 'event_genix',
            bookingId: null,
            banquetGroupId: null,
            needsBookingLink: true,
            deposit: {
                id: 77,
                status: 'needs_booking_link',
                accountantTaskId: depositTaskId,
                ...depositProjection.deposit
            },
            display: {
                clientName: 'Client Deposit',
                eventDate: '2099-07-20',
                banquetNumber: 'booking link required',
                needsBookingLink: true,
                ...depositProjection.display
            },
            ...depositProjection
        }
    };
}

async function withLeadApp(options, run) {
    clearModules();
    const fixture = createPoolFixture(options);
    const calls = {
        createTask: [],
        createOrLoadDepositHandoff: [],
        attachAccountantTask: []
    };

    installMock('../db', { pool: fixture.pool });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = {
                id: 12,
                username: 'manager',
                name: 'Manager',
                role: 'manager',
                business_contexts: ['event_genix'],
                default_business_context: 'event_genix'
            };
            next();
        },
        requireRole: () => (_req, _res, next) => next(),
        requireMinRole: () => (_req, _res, next) => next()
    });
    installMock('../services/leadNotifier', { notifyNewLead: async () => {} });
    installMock('../services/telegram', { sendTelegramMessage: async () => {} });
    installMock('../services/maysternyaBookingWebhook', {
        createMaysternyaBotBooking: async () => ({}),
        createMaysternyaAvailabilityResponse: async () => ({}),
        isMaysternyaBookingDryRun: () => false
    });
    installMock('../services/banquetDeposits', {
        createOrLoadDepositHandoff: async input => {
            calls.createOrLoadDepositHandoff.push(input);
            return {
                created: !options.depositTaskId,
                deposit: fixture.depositRow,
                projection: fixture.depositProjection,
                context: {
                    businessContext: 'event_genix',
                    leadId: 501,
                    primaryBookingId: null,
                    bookingId: null,
                    banquetGroupId: null
                }
            };
        },
        attachAccountantTask: async input => {
            calls.attachAccountantTask.push(input);
            return { deposit: { ...fixture.depositRow, accountantTaskId: input.accountantTaskId } };
        }
    });
    installMock('../services/kleshnya', {
        createTask: async payload => {
            const task = { id: 901 + calls.createTask.length, status: 'todo', ...payload };
            calls.createTask.push(task);
            return task;
        }
    });

    const app = express();
    app.use(express.json());
    app.use('/api/leads', require('../routes/leads'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async body => {
        const res = await fetch(`${baseUrl}/api/leads/501?businessContext=event_genix`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, data: text ? JSON.parse(text) : null };
    };
    const waitForHook = async () => {
        for (let i = 0; i < 20; i += 1) {
            await new Promise(resolve => setImmediate(resolve));
            if (calls.createTask.some(task => task.source_type === 'banquet_deposit')
                || calls.createOrLoadDepositHandoff.length === 0) {
                break;
            }
        }
    };

    try {
        await run({ request, calls, waitForHook, queries: fixture.queries });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('deal to deposit_received creates exactly one accountant banquet deposit task', async () => {
    await withLeadApp({ oldStage: 'deal' }, async ({ request, calls, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));

        await waitForHook();

        const accountantTasks = calls.createTask.filter(task => task.source_type === 'banquet_deposit');
        assert.equal(accountantTasks.length, 1);
        assert.equal(calls.createOrLoadDepositHandoff.length, 1);
        assert.equal(calls.createOrLoadDepositHandoff[0].businessContext, 'event_genix');
        assert.equal(calls.attachAccountantTask.length, 1);
        assert.equal(calls.attachAccountantTask[0].accountantTaskId, accountantTasks[0].id);
        assert.equal(accountantTasks[0].owner_user_id, 19);
        assert.equal(accountantTasks[0].owner_role, 'accountant');
        assert.equal(accountantTasks[0].source_entity_type, 'banquet_deposit');
        assert.equal(accountantTasks[0].control_meta.depositId, 77);
        assert.equal(accountantTasks[0].control_meta.leadId, 501);
        assert.equal(accountantTasks[0].control_meta.needsBookingLink, true);
        assert.match(accountantTasks[0].description, /Client Deposit/);
        assert.match(accountantTasks[0].description, /2099-07-20/);
        assert.match(accountantTasks[0].description, /Booking is not linked yet/);
    });
});

test('deal to deposit_received reuses stored active accountant task without duplicate task', async () => {
    await withLeadApp({ oldStage: 'deal', depositTaskId: 950 }, async ({ request, calls, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));

        await waitForHook();

        assert.equal(calls.createOrLoadDepositHandoff.length, 1);
        assert.equal(calls.createTask.filter(task => task.source_type === 'banquet_deposit').length, 0);
        assert.equal(calls.attachAccountantTask.length, 0);
        assert.ok(calls.createTask.every(task => task.source_type !== 'banquet_deposit'));
    });
});

test('resaving deposit_received does not create accountant handoff duplicate', async () => {
    await withLeadApp({ oldStage: 'deposit_received' }, async ({ request, calls, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));

        await waitForHook();

        assert.equal(calls.createOrLoadDepositHandoff.length, 0);
        assert.equal(calls.createTask.filter(task => task.source_type === 'banquet_deposit').length, 0);
        assert.equal(calls.attachAccountantTask.length, 0);
        assert.ok(calls.createTask.every(task => task.businessContext === 'event_genix'));
    });
});
