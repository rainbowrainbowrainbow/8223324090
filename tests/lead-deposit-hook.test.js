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

function createPoolFixture({
    oldStage = 'deal',
    depositProjection = {},
    depositTaskId = null,
    foreignCustomerCandidate = null,
    initialCustomerChildren = [],
    customerChildrenStorageMissing = false,
    customerChildrenCustomerFkMissing = false,
    customerSyncLockTimeout = false,
    leadOverrides = {}
} = {}) {
    const queries = [];
    const state = {
        lead: createLead({
            pipeline_stage: oldStage,
            status: oldStage === 'deposit_received' ? 'booked' : 'proposal',
            ...leadOverrides
        }),
        customer: null,
        customerChildren: initialCustomerChildren.map(row => ({ ...row })),
        foreignCustomerCandidate
    };
    const client = {
        async query(text, params = []) {
            queries.push({ text: String(text), params });
            const sql = String(text);
            if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT\s+\w+|RELEASE SAVEPOINT\s+\w+|ROLLBACK TO SAVEPOINT\s+\w+)$/i.test(sql.trim())
                || /^SET LOCAL (lock_timeout|statement_timeout|idle_in_transaction_session_timeout) = /i.test(sql.trim())) {
                return { rows: [], rowCount: 0 };
            }
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
            if (customerSyncLockTimeout && /FROM customers|INSERT INTO customers|UPDATE customers/i.test(sql)) {
                const err = new Error('canceling statement due to lock timeout');
                err.code = '55P03';
                throw err;
            }
            if (/FROM customers\s+WHERE lead_id = \$1\s+AND COALESCE\(business_context, 'event_genix'\) = \$2\s+ORDER BY updated_at DESC NULLS LAST, id DESC\s+LIMIT 1/i.test(sql)) {
                return { rows: state.customer && Number(state.customer.lead_id) === Number(params[0]) ? [state.customer] : [] };
            }
            if (/FROM lead_customer_links lcl\s+JOIN customers c ON c\.id = lcl\.customer_id/i.test(sql)) {
                return { rows: [] };
            }
            if (/FROM customers\s+WHERE COALESCE\(business_context, 'event_genix'\) = \$1\s+AND \(/i.test(sql) && /regexp_replace\(COALESCE\(phone, ''\)/i.test(sql)) {
                return { rows: state.foreignCustomerCandidate ? [state.foreignCustomerCandidate] : [] };
            }
            if (/INSERT INTO customers \(business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities\)/i.test(sql)) {
                state.customer = {
                    id: 8701,
                    business_context: params[0],
                    name: params[1],
                    phone: params[2],
                    instagram: params[3],
                    child_name: params[4],
                    source: params[5],
                    notes: params[6],
                    lead_id: params[7],
                    social_identities: params[8] ? JSON.parse(params[8]) : [],
                    created_at: '2099-05-02T10:05:00Z',
                    updated_at: '2099-05-02T10:05:00Z'
                };
                return { rows: [state.customer], rowCount: 1 };
            }
            if (/INSERT INTO lead_customer_links \(business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at\)/i.test(sql)) {
                return {
                    rows: [{
                        id: 9901,
                        business_context: params[0],
                        lead_id: params[1],
                        customer_id: params[2],
                        link_type: params[3],
                        source: params[4],
                        metadata: params[5] ? JSON.parse(params[5]) : {},
                        created_by: params[6] || null,
                        updated_at: '2099-05-02T10:05:00Z'
                    }],
                    rowCount: 1
                };
            }
            if (/DELETE FROM customer_children[\s\S]*AND source_kind = \$3[\s\S]*AND lead_id = \$4/i.test(sql)) {
                if (customerChildrenStorageMissing) {
                    const err = new Error('relation "customer_children" does not exist');
                    err.code = '42P01';
                    throw err;
                }
                state.customerChildren = state.customerChildren.filter(row =>
                    !(Number(row.customer_id) === Number(params[0])
                        && row.business_context === params[1]
                        && row.source_kind === params[2]
                        && Number(row.lead_id) === Number(params[3]))
                );
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO customer_children/i.test(sql)) {
                if (customerChildrenStorageMissing) {
                    const err = new Error('relation "customer_children" does not exist');
                    err.code = '42P01';
                    throw err;
                }
                if (customerChildrenCustomerFkMissing) {
                    const err = new Error('insert or update on table "customer_children" violates foreign key constraint "customer_children_customer_id_fkey"');
                    err.code = '23503';
                    err.constraint = 'customer_children_customer_id_fkey';
                    throw err;
                }
                state.customerChildren.push({
                    id: 12000 + state.customerChildren.length,
                    business_context: params[0],
                    customer_id: params[1],
                    lead_id: params[2],
                    booking_id: params[3],
                    name: params[4],
                    birthday: params[5],
                    age_snapshot: params[6],
                    note: params[7],
                    source_kind: params[8],
                    source_payload: params[9] ? JSON.parse(params[9]) : {},
                    sort_order: params[10],
                    created_at: '2099-05-02T10:05:00Z',
                    updated_at: '2099-05-02T10:05:00Z'
                });
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(sql)) {
                if (customerChildrenStorageMissing) {
                    const err = new Error('relation "customer_children" does not exist');
                    err.code = '42P01';
                    throw err;
                }
                return {
                    rows: state.customerChildren.filter(row =>
                        Number(row.customer_id) === Number(params[0])
                        && row.business_context === params[1]
                    ),
                    rowCount: state.customerChildren.length
                };
            }
            if (/UPDATE customers\s+SET child_name = CASE/i.test(sql)) {
                state.customer = {
                    ...(state.customer || {}),
                    id: params[1],
                    business_context: params[2],
                    child_name: params[0],
                    lead_id: params[3],
                    updated_at: '2099-05-02T10:06:00Z'
                };
                return { rows: [state.customer], rowCount: 1 };
            }
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
        state,
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
        await run({ request, calls, waitForHook, queries: fixture.queries, state: fixture.state });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('deal to deposit_received creates exactly one accountant banquet deposit task', async () => {
    await withLeadApp({ oldStage: 'deal' }, async ({ request, calls, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.customer.id, 8701);
        assert.equal(res.data.customer.name, 'Client Deposit');
        assert.equal(res.data.customerLinkMode, 'created_new');

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

test('customer card auto-link ignores same-phone customer from another business context', async () => {
    await withLeadApp({
        oldStage: 'deal',
        foreignCustomerCandidate: {
            id: 7600,
            business_context: 'dar',
            name: 'Foreign Customer',
            phone: '+380000000001',
            instagram: 'client_deposit',
            lead_id: null,
            notes: null,
            social_identities: []
        }
    }, async ({ request, queries, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.customer.id, 8701);
        assert.equal(res.data.customerLinkMode, 'created_new');

        await waitForHook();

        const candidateLookup = queries.find(query =>
            /FROM customers\s+WHERE COALESCE\(business_context, 'event_genix'\) = \$1\s+AND \(/i.test(query.text)
        );
        assert.equal(candidateLookup.params[0], 'event_genix');
        const linkInsert = queries.find(query => /INSERT INTO lead_customer_links/i.test(query.text));
        assert.equal(linkInsert.params[2], 8701);
        assert.notEqual(linkInsert.params[2], 7600);
    });
});

test('customer card creation syncs lead celebrants without replacing manual children', async () => {
    await withLeadApp({
        oldStage: 'deal',
        leadOverrides: {
            celebrants: [{ name: 'Lead Child', birthday: '2019-01-02' }]
        },
        initialCustomerChildren: [{
            id: 42,
            business_context: 'event_genix',
            customer_id: 8701,
            lead_id: null,
            booking_id: null,
            name: 'Manual Child',
            birthday: null,
            age_snapshot: null,
            note: null,
            source_kind: 'customer_api',
            source_payload: {},
            sort_order: 0
        }]
    }, async ({ request, state, queries, waitForHook }) => {
        const res = await request({ pipeline_stage: 'deposit_received' });
        assert.equal(res.status, 200, JSON.stringify(res.data));

        await waitForHook();

        const scopedDelete = queries.find(query =>
            /DELETE FROM customer_children[\s\S]*AND source_kind = \$3[\s\S]*AND lead_id = \$4/i.test(query.text)
        );
        assert.deepEqual(scopedDelete.params, [8701, 'event_genix', 'lead_celebrant', 501]);
        assert.ok(!queries.some(query =>
            /DELETE FROM customer_children[\s\S]*WHERE customer_id = \$1[\s\S]*AND business_context = \$2\s*$/i.test(query.text)
        ));

        assert.deepEqual(state.customerChildren.map(child => child.name).sort(), ['Lead Child', 'Manual Child']);
        const manualChild = state.customerChildren.find(child => child.name === 'Manual Child');
        const syncedChild = state.customerChildren.find(child => child.name === 'Lead Child');
        assert.equal(manualChild.source_kind, 'customer_api');
        assert.equal(syncedChild.source_kind, 'lead_celebrant');
        assert.equal(syncedChild.lead_id, 501);
        assert.equal(syncedChild.source_payload.source_lead_id, 501);
    });
});

test('customer card stage still commits when customer_children storage is unavailable', async () => {
    await withLeadApp({
        oldStage: 'info_sent',
        customerChildrenStorageMissing: true,
        leadOverrides: {
            pipeline_stage: 'info_sent',
            status: 'contact',
            celebrants: [{ name: 'Lead Child', birthday: '2019-01-02' }]
        }
    }, async ({ request, state, queries }) => {
        const res = await request({ pipeline_stage: 'deal' });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.pipeline_stage, 'deal');
        assert.equal(res.data.customer.id, 8701);
        assert.equal(res.data.customerLinkMode, 'created_new');

        assert.ok(queries.some(query => /^SET LOCAL lock_timeout = '2500ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SET LOCAL statement_timeout = '10000ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SET LOCAL idle_in_transaction_session_timeout = '5000ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^ROLLBACK TO SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^RELEASE SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^COMMIT$/i.test(query.text)));
        assert.ok(!queries.some(query => /^ROLLBACK$/i.test(query.text)));
        assert.equal(state.lead.pipeline_stage, 'deal');
        assert.deepEqual(state.customerChildren, []);
    });
});

test('customer card stage still commits when customer_children customer FK is stale', async () => {
    await withLeadApp({
        oldStage: 'info_sent',
        customerChildrenCustomerFkMissing: true,
        leadOverrides: {
            pipeline_stage: 'info_sent',
            status: 'contact',
            celebrants: [{ name: 'Lead Child', birthday: '2019-01-02' }]
        }
    }, async ({ request, state, queries }) => {
        const res = await request({ pipeline_stage: 'deal' });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.pipeline_stage, 'deal');
        assert.equal(res.data.customer.id, 8701);
        assert.equal(res.data.customerLinkMode, 'created_new');

        assert.ok(queries.some(query => /^SET LOCAL lock_timeout = '2500ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SET LOCAL statement_timeout = '10000ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SET LOCAL idle_in_transaction_session_timeout = '5000ms'$/i.test(query.text)));
        assert.ok(queries.some(query => /^SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^ROLLBACK TO SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^RELEASE SAVEPOINT lead_customer_child_sync$/i.test(query.text)));
        assert.ok(queries.some(query => /^COMMIT$/i.test(query.text)));
        assert.ok(!queries.some(query => /^ROLLBACK$/i.test(query.text)));
        assert.equal(state.lead.pipeline_stage, 'deal');
        assert.deepEqual(state.customerChildren, []);
    });
});

test('customer card stage still commits when post-commit customer sync hits a lock timeout', async () => {
    await withLeadApp({
        oldStage: 'info_sent',
        customerSyncLockTimeout: true,
        leadOverrides: {
            pipeline_stage: 'info_sent',
            status: 'contact'
        }
    }, async ({ request, state, queries }) => {
        const res = await request({ pipeline_stage: 'deal' });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.pipeline_stage, 'deal');
        assert.equal(res.data.customer, undefined);

        const firstCommitIndex = queries.findIndex(query => /^COMMIT$/i.test(query.text));
        const postCommitRollbackIndex = queries.findIndex((query, index) => index > firstCommitIndex && /^ROLLBACK$/i.test(query.text));
        assert.ok(firstCommitIndex >= 0);
        assert.ok(postCommitRollbackIndex > firstCommitIndex);
        assert.equal(state.lead.pipeline_stage, 'deal');
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
