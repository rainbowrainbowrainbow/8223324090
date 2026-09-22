'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// The harness owns the real app process, migrations, login and disposable DB.
// No router, auth, principal, SQL result or provider is replaced by this module.
async function requireDisposableDatabase(db) {
    const { rows } = await db.query('SELECT current_database() AS name');
    assert.match(rows[0].name, /(?:^|_)(?:test|testing|disposable|acceptance|d06)(?:_|$)/i);
    assert.doesNotMatch(rows[0].name, /(?:^|_)(?:prod|production|live)(?:_|$)/i);
}

async function seed({ db, fixture }) {
    await requireDisposableDatabase(db);
    assert.ok(fixture.runId && fixture.date && fixture.actors?.owner?.id);
    const prefix = `d06_${createHash('sha256').update(fixture.runId).digest('hex').slice(0, 10)}`;
    const client = await db.connect();
    const records = {};
    const markers = {};
    const unownedWarehouseSentinels = {};
    try {
        await client.query('BEGIN');
        for (const [alias, context] of Object.entries(fixture.contexts)) {
            const actor = alias === 'other' ? fixture.actors.otherOrg : fixture.actors.owner;
            const key = `${prefix}_${alias}`;
            const marker = `D06-${key}`;
            const row = { productId: `${key}_product`, bookingId: `${key}_booking`,
                lineId: `${key}_line`, resourceId: `${key}_resource`, roomResourceId: `${key}_room` };
            markers[context] = Object.fromEntries(['product', 'customer', 'lead', 'task', 'booking',
                'warehouse', 'graduationPackage', 'graduationQuote', 'resource', 'stock']
                .map(kind => [kind, `${marker}-${kind}`]));
            const names = markers[context];
            await client.query(`INSERT INTO products
                (id,business_context,code,timeline_code,label,name,category,duration,price,hosts,description,sort_order)
                VALUES ($1,$2,$3,$3,$4,$4,'animation',30,1201,1,$5,-1000)`,
            [row.productId, context, `Q6${alias[0].toUpperCase()}`, names.product, `${names.product} full synthetic description`]);
            row.customerId = (await client.query(`INSERT INTO customers
                (business_context,name,source,notes) VALUES ($1,$2,'manual',$3) RETURNING id`,
            [context, names.customer, marker])).rows[0].id;
            await client.query(`INSERT INTO timeline_resources
                (business_context,resource_id,type,name,short_name,capacity,metadata)
                VALUES ($1,$2,'cabinet',$3,$4,20,$5::jsonb)`,
            [context, row.resourceId, names.resource, alias, JSON.stringify({ source: 'd06_acceptance', runId: fixture.runId })]);
            await client.query(`INSERT INTO timeline_resources
                (business_context,resource_id,type,name,short_name,capacity,metadata)
                VALUES ($1,$2,'room',$3,$4,20,$5::jsonb)`,
            [context, row.roomResourceId, `${marker}-room`, alias, JSON.stringify({ source: 'd06_acceptance', runId: fixture.runId })]);
            await client.query(`INSERT INTO lines_by_date
                (business_context,date,line_id,name,color) VALUES ($1,$2,$3,$4,'#10B981')`,
            [context, fixture.date, row.lineId, `${marker}-line`]);
            await client.query(`INSERT INTO bookings
                (id,business_context,date,time,line_id,program_id,program_code,label,program_name,
                 category,duration,price,hosts,room,notes,status,customer_id,created_by,skip_notification,room_resource_id)
                VALUES ($1,$2,$3,'12:00',$4,$5,$6,$7,$7,'animation',30,1201,1,$8,$9,'confirmed',$10,$11,true,$12)`,
            [row.bookingId, context, fixture.date, row.lineId, row.productId, `Q6${alias[0].toUpperCase()}`,
                names.booking, `${marker}-room`, marker, row.customerId, actor.username, row.roomResourceId]);
            row.leadId = (await client.query(`INSERT INTO leads
                (business_context,client_name,status,pipeline_stage,lead_type,program_id,booking_id,
                 assigned_to,event_date,children_count,notes)
                VALUES ($1,$2,'new','new','quality',$3,$4,$5,$6,10,$7) RETURNING id`,
            [context, names.lead, row.productId, row.bookingId, actor.id, fixture.date, marker])).rows[0].id;
            await client.query(`INSERT INTO lead_customer_links
                (business_context,lead_id,customer_id,link_type,source,created_by)
                VALUES ($1,$2,$3,'customer_card','d06_acceptance',$4)`,
            [context, row.leadId, row.customerId, actor.id]);
            row.conversationId = (await client.query(`INSERT INTO conversations
                (business_context,channel,external_id,customer_name,customer_id,status,meta,last_message_at)
                VALUES ($1,'telegram',$2,$3,$4,'open',$5::jsonb,NOW()) RETURNING id`,
            [context, `${key}_synthetic_inbox`, `${marker}-conversation`, row.customerId,
                JSON.stringify({ leadId: row.leadId, source: 'd06_acceptance' })])).rows[0].id;
            row.messageId = (await client.query(`INSERT INTO conversation_messages
                (conversation_id,direction,content,content_type,meta)
                VALUES ($1,'inbound',$2,'text',$3::jsonb) RETURNING id`,
            [row.conversationId, `${marker}-synthetic-message`, JSON.stringify({ source: 'd06_acceptance' })])).rows[0].id;
            row.taskId = (await client.query(`INSERT INTO tasks
                (business_context,title,description,date,status,priority,created_by,owner_user_id,
                 task_mode,task_kind,visibility,workflow_state,type,source_type)
                VALUES ($1,$2,$3,$4,'todo','normal',$5,$6,'work','action','team','todo','manual','manual') RETURNING id`,
            [context, names.task, marker, fixture.date, actor.username, actor.id])).rows[0].id;
            row.locationId = (await client.query(`INSERT INTO warehouse_locations
                (business_context,slug,name) VALUES ($1,$2,$3) RETURNING id`,
            [context, `${key}_location`, names.warehouse])).rows[0].id;
            row.stockId = (await client.query(`INSERT INTO warehouse_stock
                (business_context,name,category,quantity,min_quantity,unit,location_id,notes)
                VALUES ($1,$2,'consumable',10,1,'шт',$3,$4) RETURNING id`,
            [context, names.stock, row.locationId, marker])).rows[0].id;
            row.financeCategoryId = (await client.query(`INSERT INTO finance_categories
                (business_context,name,type) VALUES ($1,$2,'expense') RETURNING id`,
            [context, `${marker}-expense`])).rows[0].id;
            row.financeAccountId = (await client.query(`INSERT INTO finance_accounts
                (business_context,name,type,created_by) VALUES ($1,$2,'cash',$3) RETURNING id`,
            [context, `${marker}-account`, actor.username])).rows[0].id;
            row.financeTransactionId = (await client.query(`INSERT INTO finance_transactions
                (business_context,type,category_id,account_id,amount,date,description,booking_id,created_by)
                VALUES ($1,'expense',$2,$3,123,$4,$5,$6,$7) RETURNING id`,
            [context, row.financeCategoryId, row.financeAccountId, fixture.date, marker, row.bookingId, actor.username])).rows[0].id;
            row.graduationServiceId = (await client.query(`INSERT INTO graduation_services
                (business_context,name,description,price_type,price_per_child,duration_min)
                VALUES ($1,$2,$3,'fixed',125,30) RETURNING id`,
            [context, `${marker}-service`, marker])).rows[0].id;
            row.graduationPackageSlug = `${key}_package`;
            row.graduationPackageId = (await client.query(`INSERT INTO graduation_packages
                (business_context,name,slug,description) VALUES ($1,$2,$3,$4) RETURNING id`,
            [context, names.graduationPackage, row.graduationPackageSlug, marker])).rows[0].id;
            await client.query(`INSERT INTO graduation_package_items
                (business_context,package_id,service_id,override_price) VALUES ($1,$2,$3,125)`,
            [context, row.graduationPackageId, row.graduationServiceId]);
            row.graduationQuoteId = (await client.query(`INSERT INTO graduation_quotes
                (business_context,quote_number,customer_id,kids_count,selected_services,package_id,
                 total_per_child,total_all,notes,created_by,event_date)
                VALUES ($1,$2,$3,10,$4::jsonb,$5,125,1250,$6,$7,$8) RETURNING id`,
            [context, names.graduationQuote, row.customerId, JSON.stringify([{ serviceId: row.graduationServiceId }]),
                row.graduationPackageId, marker, actor.username, fixture.date])).rows[0].id;
            records[context] = row;
        }
        // These legacy tables have no organization/business ownership column.
        // A stock/location association is evidence for a foreign-ID read probe,
        // never an inferred assignment of the contractor/procurement owner.
        for (const context of [fixture.contexts.park, fixture.contexts.dar]) {
            const owned = records[context];
            const marker = `D06-${prefix}-UNASSIGNED-${context}`;
            const contractorId = (await client.query(`INSERT INTO contractors
                (name,notes) VALUES ($1,$2) RETURNING id`,
            [`${marker}-contractor`, 'Synthetic unassigned legacy row; no owner is asserted'])).rows[0].id;
            const procurementListId = (await client.query(`INSERT INTO procurement_lists
                (title,department,status,target_location_id,contractor_id,notes,created_by)
                VALUES ($1,'admin','draft',$2,$3,$4,$5) RETURNING id`,
            [`${marker}-list`, owned.locationId, contractorId,
                'Synthetic unassigned legacy row referencing explicitly owned stock', fixture.actors.owner.username])).rows[0].id;
            const procurementItemId = (await client.query(`INSERT INTO procurement_items
                (list_id,name,quantity,unit,warehouse_stock_id,contractor_id)
                VALUES ($1,$2,1,'шт',$3,$4) RETURNING id`,
            [procurementListId, `${marker}-item`, owned.stockId, contractorId])).rows[0].id;
            unownedWarehouseSentinels[context] = { contractorId, procurementListId, procurementItemId,
                stockId: owned.stockId, locationId: owned.locationId, stockBusinessContext: context,
                legacyRowOwnership: 'UNASSIGNED_GLOBAL_ROW' };
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
    fixture.records = { ...(fixture.records || {}), ...records };
    fixture.markers = { ...(fixture.markers || {}), ...markers };
    fixture.domainPrefix = prefix;
    fixture.unownedWarehouseSentinels = unownedWarehouseSentinels;
    return { records, markers };
}

function arrayAt(body, key) {
    const value = key ? body?.[key] : body;
    assert.ok(Array.isArray(value), `Expected array response${key ? ` at ${key}` : ''}`);
    return value;
}

function idSet(rows, field = 'id') { return new Set(rows.map(row => String(row[field]))); }
function expectStatus(response, status) {
    assert.equal(response.status, status, `HTTP ${response.status}; expected ${status}; code=${response.body?.code || 'none'}`);
}

async function run({ baseUrl, fixture, request, db, record }) {
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname), 'Acceptance must use loopback');
    await requireDisposableDatabase(db);
    const { park, dar, other } = fixture.contexts;
    const outcomes = [];
    let activeEvidence = [];
    async function http(input) {
        const response = await request(input);
        activeEvidence.push({ method: input.method || 'GET', path: input.path, actor: typeof input.actor === 'string' ? input.actor : 'same_jwt_snapshot',
            context: input.context ?? null, status: response.status, code: response.body?.code || null });
        return response;
    }
    async function scenario(id, domain, expected, fn) {
        activeEvidence = [];
        const started = Date.now();
        let status = 'PASS';
        let observed = 'Expected assertions satisfied through actual HTTP and stored rows';
        try { await fn(); }
        catch (error) { status = 'FAIL'; observed = String(error.message || error).slice(0, 700); }
        const outcome = { id, domain, status, method: activeEvidence[0]?.method || 'SQL',
            path: activeEvidence[0]?.path || null, expected, observed,
            evidence: { localActualApp: true, elapsedMs: Date.now() - started, requests: activeEvidence } };
        outcomes.push(outcome);
        record(outcome);
    }
    const scopes = [[park, 'owner'], [dar, 'owner'], [other, 'otherOrg']];
    const lists = [
        ['bookings', `/api/bookings/${fixture.date}`, null, 'bookingId'],
        ['timeline', '/api/timeline/resources?type=cabinet', 'resources', 'resourceId', 'resourceId'],
        ['customers', '/api/customers?limit=100', 'customers', 'customerId'],
        ['leads', '/api/leads?limit=100', 'leads', 'leadId'],
        ['tasks', `/api/tasks?date=${fixture.date}&limit=100`, null, 'taskId'],
        ['finance', `/api/finance/transactions?from=${fixture.date}&to=${fixture.date}&limit=200`, 'transactions', 'financeTransactionId'],
        ['warehouse', '/api/warehouse', 'items', 'stockId'],
        ['products', '/api/products', null, 'productId']
    ];
    for (const [context, actor] of scopes) {
        for (const [domain, path, arrayKey, fixtureKey, responseKey] of lists) {
            await scenario(`domain.${context}.${domain}.list`, domain, 'Own sentinel included; other-business and other-organization sentinels absent', async () => {
                const result = await http({ actor, path, context });
                expectStatus(result, 200);
                const ids = idSet(arrayAt(result.body, arrayKey), responseKey);
                assert.ok(ids.has(String(fixture.records[context][fixtureKey])), 'Own fixture record must be returned');
                for (const otherContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    assert.ok(!ids.has(String(fixture.records[otherContext][fixtureKey])), 'Foreign fixture record must be absent');
                }
            });
        }
    }
    const migratedBusinessReads = [
        [fixture.contexts.maysternya, 'owner', lists.filter(([domain]) => !['warehouse'].includes(domain))],
        [fixture.contexts.crm, 'owner', lists.filter(([domain]) => ['customers', 'leads', 'tasks', 'finance'].includes(domain))]
    ];
    for (const [context, actor, enabledLists] of migratedBusinessReads) {
        for (const [domain, path, arrayKey, fixtureKey, responseKey] of enabledLists) {
            await scenario(`domain.${context}.${domain}.required_read`, domain,
                'Enabled MD/CRM domain returns its owned sentinel and excludes every foreign business', async () => {
                    const result = await http({ actor, path, context });
                    expectStatus(result, 200);
                    const ids = idSet(arrayAt(result.body, arrayKey), responseKey);
                    assert.ok(ids.has(String(fixture.records[context][fixtureKey])));
                    for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                        assert.ok(!ids.has(String(fixture.records[foreignContext][fixtureKey])));
                    }
                });
        }
    }
    await scenario('auth.md_crm_roles', 'auth', 'Director, manager, admin and worker roles come only from active MD/CRM memberships', async () => {
        const expected = [
            ['owner', fixture.contexts.maysternya, 200, 'director'],
            ['owner', fixture.contexts.crm, 200, 'director'],
            ['manager', fixture.contexts.maysternya, 200, 'manager'],
            ['manager', fixture.contexts.crm, 403, null],
            ['admin', fixture.contexts.maysternya, 200, 'admin'],
            ['admin', fixture.contexts.crm, 200, 'admin'],
            ['worker', fixture.contexts.maysternya, 200, 'animator'],
            ['worker', fixture.contexts.crm, 200, 'animator']
        ];
        for (const [actor, context, status, role] of expected) {
            const profile = await http({ actor, context, path: '/api/auth/business-profile' });
            expectStatus(profile, status);
            if (role) assert.equal(profile.body.user.role, role);
        }
    });
    const details = [
        ['bookings', row => `/api/bookings/detail/${row.bookingId}`, 'bookingId', body => body.booking?.id],
        ['customers', row => `/api/customers/${row.customerId}`, 'customerId', body => body.id],
        ['leads', row => `/api/leads/${row.leadId}/booking-context`, 'leadId', body => body.leadContext?.leadId],
        ['tasks', row => `/api/tasks/${row.taskId}`, 'taskId', body => body.id],
        ['warehouse', row => `/api/warehouse/${row.stockId}`, 'stockId', body => body.id],
        ['products', row => `/api/products/${row.productId}`, 'productId', body => body.id]
    ];
    for (const [context, actor] of scopes) {
        for (const [domain, pathFor, fixtureKey, resultId] of details) {
            await scenario(`domain.${context}.${domain}.direct_id`, domain, 'Own direct ID works; every seeded foreign direct ID is404', async () => {
                const own = await http({ actor, path: pathFor(fixture.records[context]), context });
                expectStatus(own, 200);
                assert.equal(String(resultId(own.body)), String(fixture.records[context][fixtureKey]));
                for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    expectStatus(await http({ actor, path: pathFor(fixture.records[foreignContext]), context }), 404);
                }
            });
        }
    }
    for (const [context, actor] of scopes) {
        await scenario(`domain.${context}.graduation`, 'graduation', context === other
            ? 'Unsupported custom graduation denied explicitly; no Park fallback'
            : 'Owned package/service and quote work; foreign package/quote IDs denied', async () => {
            const packages = await http({ actor, path: '/api/graduation/packages', context });
            if (context === other) {
                expectStatus(packages, 403);
                assert.equal(packages.body?.code, 'graduation_business_context_unavailable');
                expectStatus(await http({ actor, path: '/api/graduation/packages' }), 403);
                return;
            }
            expectStatus(packages, 200);
            const own = fixture.records[context];
            const ids = idSet(arrayAt(packages.body));
            assert.ok(ids.has(String(own.graduationPackageId)));
            for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                const foreign = fixture.records[foreignContext];
                assert.ok(!ids.has(String(foreign.graduationPackageId)));
                expectStatus(await http({ actor, path: `/api/graduation/packages/${foreign.graduationPackageSlug}`, context }), 404);
                expectStatus(await http({ actor, path: `/api/graduation/quotes/${foreign.graduationQuoteId}`, context }), 404);
            }
            const detail = await http({ actor, path: `/api/graduation/packages/${own.graduationPackageSlug}`, context });
            expectStatus(detail, 200);
            assert.equal(String(detail.body.id), String(own.graduationPackageId));
            assert.ok(idSet(detail.body.services).has(String(own.graduationServiceId)));
            const quote = await http({ actor, path: `/api/graduation/quotes/${own.graduationQuoteId}`, context });
            expectStatus(quote, 200);
            assert.equal(String(quote.body.id), String(own.graduationQuoteId));
        });
    }
    for (const [context, actor] of scopes) {
        await scenario(`domain.${context}.timeline_get_no_insert`, 'timeline', 'Repeated resource/availability GET does not create resources', async () => {
            const before = (await db.query('SELECT id,business_context,resource_id FROM timeline_resources ORDER BY id')).rows;
            for (let index = 0; index < 2; index++) {
                expectStatus(await http({ actor, path: '/api/timeline/resources', context }), 200);
                expectStatus(await http({ actor, path: `/api/timeline/resources/availability?type=cabinet&date=${fixture.date}&time=12:00&duration=30`, context }), 200);
            }
            assert.deepEqual((await db.query('SELECT id,business_context,resource_id FROM timeline_resources ORDER BY id')).rows, before);
        });
    }
    const rowTables = { bookings: ['bookings', 'bookingId'], customers: ['customers', 'customerId'],
        leads: ['leads', 'leadId'], tasks: ['tasks', 'taskId'], finance: ['finance_transactions', 'financeTransactionId'],
        warehouse: ['warehouse_stock', 'stockId'], products: ['products', 'productId'], graduation: ['graduation_quotes', 'graduationQuoteId'] };
    const mutationPaths = {
        bookings: row => `/api/bookings/${row.bookingId}`, customers: row => `/api/customers/${row.customerId}`,
        leads: row => `/api/leads/${row.leadId}`, tasks: row => `/api/tasks/${row.taskId}`,
        finance: row => `/api/finance/transactions/${row.financeTransactionId}`, warehouse: row => `/api/warehouse/${row.stockId}`,
        products: row => `/api/products/${row.productId}`, graduation: row => `/api/graduation/quotes/${row.graduationQuoteId}`
    };
    for (const [context, actor] of scopes.filter(([value]) => value !== other)) {
        for (const [domain, [table, key]] of Object.entries(rowTables)) {
            await scenario(`domain.${context}.${domain}.foreign_write`, domain, 'Foreign update rejected404; exact stored target row unchanged', async () => {
                for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    const row = fixture.records[foreignContext];
                    const before = (await db.query(`SELECT * FROM ${table} WHERE id=$1`, [row[key]])).rows;
                    const body = { name: 'D06 forbidden edit', title: 'D06 forbidden edit', notes: 'D06 forbidden edit', amount: 321 };
                    const result = await http({ actor, context, method: domain === 'leads' ? 'PATCH' : 'PUT', path: mutationPaths[domain](row), body });
                    expectStatus(result, 404);
                    assert.deepEqual((await db.query(`SELECT * FROM ${table} WHERE id=$1`, [row[key]])).rows, before);
                }
            });
        }
    }
    for (const [context, actor] of scopes) {
        const own = fixture.records[context];
        await scenario(`domain.${context}.products.create`, 'products', 'Actual product create persists active business and submitted fixture price', async () => {
            const suffix = context === park ? 'P' : context === dar ? 'D' : 'O';
            const name = `${fixture.markers[context].product}-created`;
            const result = await http({ actor, context, method: 'POST', path: '/api/products',
                body: { code: `N6${suffix}`, timelineCode: `N6${suffix}`, label: name, name,
                    category: 'animation', duration: 30, price: 1281, hosts: 1, description: 'Synthetic acceptance description' } });
            expectStatus(result, 201);
            assert.equal((await db.query('SELECT business_context FROM products WHERE id=$1', [result.body.id])).rows[0]?.business_context, context);
            const read = await http({ actor, context, path: `/api/products/${result.body.id}` });
            expectStatus(read, 200);
            assert.equal(Number(read.body.price), 1281);
        });
        await scenario(`domain.${context}.tasks.priority`, 'tasks', 'Actual task priority update affects only its active-business record', async () => {
            const foreignIds = Object.values(fixture.contexts).filter(value => value !== context).map(value => fixture.records[value].taskId);
            const before = (await db.query('SELECT id,business_context,priority FROM tasks WHERE id=ANY($1::int[]) ORDER BY id', [foreignIds])).rows;
            const result = await http({ actor, context, method: 'PATCH', path: `/api/tasks/${own.taskId}/priority`, body: { priority: 'high' } });
            expectStatus(result, 200);
            assert.equal((await db.query('SELECT priority FROM tasks WHERE id=$1', [own.taskId])).rows[0]?.priority, 'high');
            assert.deepEqual((await db.query('SELECT id,business_context,priority FROM tasks WHERE id=ANY($1::int[]) ORDER BY id', [foreignIds])).rows, before);
        });
        await scenario(`domain.${context}.customers.create`, 'customers', 'Actual customer create persists the active business', async () => {
            const result = await http({ actor, context, method: 'POST', path: '/api/customers', body: { name: `${fixture.markers[context].customer}-created` } });
            expectStatus(result, 200);
            assert.equal((await db.query('SELECT business_context FROM customers WHERE id=$1', [result.body.id])).rows[0]?.business_context, context);
        });
        await scenario(`domain.${context}.finance.own_and_foreign_references`, 'finance', 'Expense write with own references succeeds; foreign category/account/booking rejected without a new ledger row', async () => {
            const payload = { type: 'expense', amount: 127, date: fixture.date, description: `${fixture.domainPrefix}-http-expense`,
                categoryId: own.financeCategoryId, accountId: own.financeAccountId, bookingId: own.bookingId };
            const result = await http({ actor, context, method: 'POST', path: '/api/finance/transactions', body: payload });
            expectStatus(result, 201);
            const stored = (await db.query('SELECT business_context,amount,booking_id FROM finance_transactions WHERE id=$1', [result.body.id])).rows[0];
            assert.deepEqual(stored, { business_context: context, amount: 127, booking_id: own.bookingId });
            const before = (await db.query('SELECT id,business_context,amount FROM finance_transactions ORDER BY id')).rows;
            for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                const foreign = fixture.records[foreignContext];
                for (const patch of [{ categoryId: foreign.financeCategoryId }, { accountId: foreign.financeAccountId }, { bookingId: foreign.bookingId }]) {
                    expectStatus(await http({ actor, context, method: 'POST', path: '/api/finance/transactions', body: { ...payload, ...patch } }), 400);
                }
            }
            assert.deepEqual((await db.query('SELECT id,business_context,amount FROM finance_transactions ORDER BY id')).rows, before);
        });
        await scenario(`domain.${context}.leads.foreign_references`, 'leads', 'Own lead accepts its retained relation; foreign product/booking fails and rolls back notes', async () => {
            const valid = await http({ actor, context, method: 'PATCH', path: `/api/leads/${own.leadId}`,
                body: { program_id: own.productId, booking_id: own.bookingId } });
            expectStatus(valid, 200);
            const before = (await db.query('SELECT * FROM leads WHERE id=$1', [own.leadId])).rows;
            for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                const foreign = fixture.records[foreignContext];
                for (const patch of [{ program_id: foreign.productId }, { booking_id: foreign.bookingId }]) {
                    expectStatus(await http({ actor, context, method: 'PATCH', path: `/api/leads/${own.leadId}`,
                        body: { ...patch, notes: 'D06 must roll back' } }), 404);
                }
            }
            assert.deepEqual((await db.query('SELECT * FROM leads WHERE id=$1', [own.leadId])).rows, before);
        });
        await scenario(`domain.${context}.warehouse.foreign_location`, 'warehouse', 'Own stock create persists active owner; foreign location fails without new stock', async () => {
            const payload = { name: `${fixture.markers[context].stock}-created`, category: 'consumable', quantity: 2, unit: 'шт', locationId: own.locationId };
            const valid = await http({ actor, context, method: 'POST', path: '/api/warehouse', body: payload });
            expectStatus(valid, 201);
            assert.equal((await db.query('SELECT business_context FROM warehouse_stock WHERE id=$1', [valid.body.item?.id])).rows[0]?.business_context, context);
            const before = (await db.query('SELECT id,business_context FROM warehouse_stock ORDER BY id')).rows;
            for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                expectStatus(await http({ actor, context, method: 'POST', path: '/api/warehouse',
                    body: { ...payload, name: `${payload.name}-foreign`, locationId: fixture.records[foreignContext].locationId } }), 400);
            }
            assert.deepEqual((await db.query('SELECT id,business_context FROM warehouse_stock ORDER BY id')).rows, before);
        });
    }
    for (const context of [park, dar]) {
        const own = fixture.records[context];
        await scenario(`domain.${context}.graduation.foreign_references`, 'graduation', 'Foreign service/package/customer rejected without changing quote or quote count', async () => {
            const before = (await db.query('SELECT * FROM graduation_quotes ORDER BY id')).rows;
            for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                const foreign = fixture.records[foreignContext];
                for (const patch of [{ selectedServices: [{ serviceId: foreign.graduationServiceId }] },
                    { packageId: foreign.graduationPackageId }, { customerId: foreign.customerId }]) {
                    const result = await http({ actor: 'owner', context, method: 'PUT',
                        path: `/api/graduation/quotes/${own.graduationQuoteId}`, body: { ...patch, notes: 'D06 must not persist' } });
                    expectStatus(result, 400);
                }
            }
            assert.deepEqual((await db.query('SELECT * FROM graduation_quotes ORDER BY id')).rows, before);
        });
    }
    const aggregateQuery = `businessScope=multi&businessContexts=${encodeURIComponent(`${park},${dar}`)}`;
    for (const [domain, path, arrayKey, fixtureKey] of lists.filter(([domain]) => ['customers', 'leads', 'tasks', 'products'].includes(domain))) {
        await scenario(`aggregate.${domain}.same_org`, domain, 'Same-role, same-organization aggregate includes Park+Dar and excludes organization2', async () => {
            const result = await http({ actor: 'owner', context: park, path: `${path}${path.includes('?') ? '&' : '?'}${aggregateQuery}` });
            expectStatus(result, 200);
            const ids = idSet(arrayAt(result.body, arrayKey));
            for (const context of [park, dar]) assert.ok(ids.has(String(fixture.records[context][fixtureKey])));
            assert.ok(!ids.has(String(fixture.records[other][fixtureKey])));
        });
    }
    await scenario('aggregate.permissions_and_organizations', 'auth', 'Mixed role and mixed organization aggregate requests fail closed', async () => {
        const mixedRole = await http({ actor: 'worker', context: park, path: `/api/products?${aggregateQuery}` });
        expectStatus(mixedRole, 403);
        assert.equal(mixedRole.body.code, 'business_scope_permissions_mismatch');
        const mixedOrg = await http({ actor: 'multiOrg', context: park, path: `/api/products?businessScope=multi&businessContexts=${park},${other}` });
        expectStatus(mixedOrg, 403);
        assert.equal(mixedOrg.body.code, 'business_scope_organization_mismatch');
    });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await scenario(`aggregate.write.${method}`, 'auth', 'Every mutating method rejects aggregate scope before writes', async () => {
            const own = fixture.records[park];
            const before = (await db.query('SELECT * FROM customers WHERE id=$1', [own.customerId])).rows;
            const path = method === 'POST' ? '/api/customers' : `/api/customers/${own.customerId}`;
            const result = await http({ actor: 'owner', context: park, method, path: `${path}?${aggregateQuery}`, body: { name: 'D06 aggregate must not persist' } });
            expectStatus(result, 403);
            assert.equal(result.body.code, 'business_scope_read_only');
            assert.deepEqual((await db.query('SELECT * FROM customers WHERE id=$1', [own.customerId])).rows, before);
        });
    }
    await scenario('auth.explicit_foreign_context', 'auth', 'Every supported router denies inaccessible organization context', async () => {
        for (const [, path] of lists) expectStatus(await http({ actor: 'owner', path, context: other }), 403);
    });
    await scenario('auth.default_and_role_isolation', 'auth', 'Same account receives Park director versus Dar animator rights; defaults are read from server', async () => {
        for (const [context, role] of [[park, 'director'], [dar, 'animator']]) {
            const profile = await http({ actor: 'worker', context, path: '/api/auth/business-profile' });
            expectStatus(profile, 200);
            assert.equal(profile.body.user.role, role);
            assert.equal(profile.body.businessProfile.activeBusinessContext, context);
        }
        expectStatus(await http({ actor: 'worker', context: park, path: '/api/finance/accounts' }), 200);
        expectStatus(await http({ actor: 'worker', context: dar, path: '/api/finance/accounts' }), 403);
        for (const [actor, context] of [['owner', park], ['otherOrg', other]]) {
            const profile = await http({ actor, path: '/api/auth/business-profile' });
            expectStatus(profile, 200);
            assert.equal(profile.body.businessProfile.activeBusinessContext, context);
        }
    });
    await scenario('lifecycle.last_owner', 'lifecycle', 'Non-platform last owner cannot demote their organization ownership', async () => {
        const ownerId = fixture.actors.owner.id;
        assert.notEqual((await db.query('SELECT role FROM users WHERE id=$1', [ownerId])).rows[0]?.role, 'creator');
        const path = `/api/organizations/${fixture.organizations.primaryId}/members/${ownerId}`;
        const before = (await db.query('SELECT role,is_active FROM organization_memberships WHERE organization_id=$1 AND user_id=$2',
            [fixture.organizations.primaryId, ownerId])).rows;
        const result = await http({ actor: 'owner', context: park, method: 'PUT', path,
            body: { businessId: fixture.businesses.parkId, role: 'director', organizationRole: 'member' } });
        expectStatus(result, 409);
        assert.equal(result.body.code, 'organization_last_owner');
        assert.deepEqual((await db.query('SELECT role,is_active FROM organization_memberships WHERE organization_id=$1 AND user_id=$2',
            [fixture.organizations.primaryId, ownerId])).rows, before);
    });
    await scenario('lifecycle.management_boundaries', 'lifecycle', 'Member cannot promote self; owner cannot configure organization2; admin cannot create business', async () => {
        expectStatus(await http({ actor: 'worker', context: park, method: 'PUT',
            path: `/api/organizations/${fixture.organizations.primaryId}/members/${fixture.actors.worker.id}`,
            body: { businessId: fixture.businesses.darId, role: 'director' } }), 403);
        expectStatus(await http({ actor: 'owner', context: park, method: 'PATCH',
            path: `/api/organizations/businesses/${fixture.businesses.customId}/configuration`,
            body: { label: 'D06 forbidden cross-organization label' } }), 403);
        expectStatus(await http({ actor: 'admin', context: park, method: 'POST',
            path: `/api/organizations/${fixture.organizations.primaryId}/businesses`,
            body: { contextKey: `${fixture.domainPrefix}_admin_denied`, label: 'D06 forbidden admin business', modules: [] } }), 403);
    });
    await scenario('lifecycle.owner_custom_business', 'lifecycle', 'Owner creates, configures and deactivates a custom cabinet; disabled modules and unconfigured resources remain explicit', async () => {
        const context = `${fixture.domainPrefix}_cabinet`;
        const label = `D06 ${fixture.domainPrefix} Cabinet`;
        const created = await http({ actor: 'owner', context: park, method: 'POST',
            path: `/api/organizations/${fixture.organizations.primaryId}/businesses`,
            body: { contextKey: context, label, shortLabel: 'D06 Cabinet', modules: [] } });
        expectStatus(created, 201);
        const id = created.body.business?.id;
        assert.ok(id, 'Created business ID required');
        fixture.lifecycleBusiness = { id, context, label, finalStatus: 'pending_deactivation' };
        try {
            expectStatus(await http({ actor: 'owner', context: park, method: 'PUT',
                path: `/api/organizations/${fixture.organizations.primaryId}/members/${fixture.actors.owner.id}`,
                body: { businessId: id, role: 'director', isDefault: false } }), 200);
            const disabled = await http({ actor: 'owner', context, path: '/api/products' });
            expectStatus(disabled, 403);
            assert.equal(disabled.body.code, 'business_module_disabled');
            expectStatus(await http({ actor: 'owner', context: park, method: 'PATCH',
                path: `/api/organizations/businesses/${id}/configuration`,
                body: { label: `${label} Updated`, modules: ['programs', 'timeline'] } }), 200);
            const profile = await http({ actor: 'owner', context, path: '/api/auth/business-profile' });
            expectStatus(profile, 200);
            assert.equal(profile.body.businessProfile.activeProfile.label, `${label} Updated`);
            const products = await http({ actor: 'owner', context, path: '/api/products' });
            expectStatus(products, 200);
            assert.equal(arrayAt(products.body).length, 0);
            const resources = await http({ actor: 'owner', context, path: '/api/timeline/resources' });
            expectStatus(resources, 200);
            assert.equal(arrayAt(resources.body, 'resources').length, 0);
            for (let attempt = 0; attempt < 2; attempt++) {
                const initialized = await http({ actor: 'owner', context: park, method: 'POST',
                    path: `/api/organizations/businesses/${id}/initialize-resources`, body: {} });
                expectStatus(initialized, 200);
                assert.equal(initialized.body.initialization.created, 0);
                assert.ok(initialized.body.initialization.resourceTypes.every(row => row.status === 'no_defaults'));
            }
            const forbiddenModule = await http({ actor: 'owner', context: park, method: 'PATCH',
                path: `/api/organizations/businesses/${id}/configuration`, body: { modules: ['programs', 'graduation'] } });
            expectStatus(forbiddenModule, 400);
            assert.equal(forbiddenModule.body.code, 'business_module_not_supported');
        } finally {
            const deactivated = await http({ actor: 'owner', context: park, method: 'PATCH',
                path: `/api/organizations/businesses/${id}`, body: { status: 'inactive' } });
            expectStatus(deactivated, 200);
            fixture.lifecycleBusiness.finalStatus = 'inactive';
        }
        expectStatus(await http({ actor: 'owner', context, path: '/api/products' }), 403);
    });
    const containment = [
        ['/api/catalogs', 'catalogs_not_migrated'], ['/api/booking-templates', 'booking_templates_not_migrated'],
        ['/api/recurring', 'recurring_not_migrated'], ['/api/warehouse/photo-intake/status', 'warehouse_photo_intake_not_migrated'],
        ['/api/warehouse/photo-intake', 'warehouse_photo_intake_not_migrated'], ['/api/chat/channels', 'chat_not_migrated'],
        ['/api/kleshnya/sessions', 'kleshnya_not_migrated'], ['/api/finance/report/salary', 'finance_salary_not_migrated']
    ];
    for (const [context, actor] of scopes) {
        for (const [path, code] of containment) {
            await scenario(`containment.${context}.${code}.${path.endsWith('/status') ? 'status' : 'read'}`, 'containment', 'Membership entry returns its explicit NOT_MIGRATED code', async () => {
                const result = await http({ actor, context, path });
                expectStatus(result, 403);
                assert.equal(result.body.code, code);
            });
        }
    }
    // Keep this actor separate from browser workers. Restore through the same
    // lifecycle API; never mint another token to make a revocation test pass.
    await scenario('auth.same_jwt_role_and_revoke', 'auth', 'Role reduction and membership revoke take effect immediately on the same JWT', async () => {
        const actor = { ...fixture.actors.revocable };
        assert.ok(actor.token, 'Real login token required');
        const memberPath = `/api/organizations/${fixture.organizations.primaryId}/members/${actor.id}`;
        const businessId = fixture.businesses.parkId;
        const prior = (await db.query(`SELECT role,extra_roles,page_allowlist,page_denylist,action_allowlist,action_denylist,is_default
            FROM business_memberships WHERE business_id=$1 AND user_id=$2`, [businessId, actor.id])).rows[0];
        assert.ok(prior, 'Revocable actor must have a seeded membership');
        const restore = { businessId, role: prior.role, extraRoles: prior.extra_roles,
            pageAllowlist: prior.page_allowlist, pageDenylist: prior.page_denylist,
            actionAllowlist: prior.action_allowlist, actionDenylist: prior.action_denylist, isDefault: prior.is_default };
        try {
            expectStatus(await http({ actor, context: park, path: '/api/finance/accounts' }), 200);
            expectStatus(await http({ actor: 'owner', context: park, method: 'PUT', path: memberPath,
                body: { businessId, role: 'animator', actionAllowlist: [], actionDenylist: [], extraRoles: [] } }), 200);
            expectStatus(await http({ actor, context: park, path: '/api/finance/accounts' }), 403);
            const profile = await http({ actor, context: park, path: '/api/auth/business-profile' });
            expectStatus(profile, 200);
            assert.equal(profile.body.user.role, 'animator');
            expectStatus(await http({ actor: 'owner', context: park, method: 'DELETE', path: `${memberPath}/${businessId}` }), 200);
            expectStatus(await http({ actor, context: park, path: '/api/products' }), 403);
            expectStatus(await http({ actor, context: park, path: '/api/auth/business-profile' }), 403);
            assert.equal(actor.token, fixture.actors.revocable.token);
        } finally {
            expectStatus(await http({ actor: 'owner', context: park, method: 'PUT', path: memberPath, body: restore }), 200);
        }
        expectStatus(await http({ actor, context: park, path: '/api/finance/accounts' }), 200);
    });
    // Main reads for the remaining enabled modules. Existing core counts stay
    // separate; provider-facing and unowned indirect adapters are not certified.
    for (const [context, actor] of scopes) {
        for (const [widget, key, arrayKey] of [['tasks', 'taskId', 'tasks'], ['leads_new', 'leadId', 'leads']]) {
            await scenario(`enabled_extra.${context}.dashboard.${widget}`, 'dashboard',
                'Owned dashboard sentinel included; foreign business and organization sentinels absent', async () => {
                    const result = await http({ actor, context, path: `/api/dashboard/widgets/${widget}` });
                    expectStatus(result, 200);
                    const ids = idSet(arrayAt(result.body?.data, arrayKey));
                    assert.ok(ids.has(String(fixture.records[context][key])), 'Owned dashboard sentinel required');
                    for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                        assert.ok(!ids.has(String(fixture.records[foreignContext][key])), 'Foreign dashboard sentinel must be absent');
                    }
                });
        }
        for (const [kind, path] of [['cabinet', '/api/business/cabinet'], ['timeline_display', '/api/settings/timeline-display']]) {
            await scenario(`enabled_extra.${context}.settings.${kind}`, 'settings',
                'Scoped settings identify the selected business and do not insert or alter persisted settings', async () => {
                    const snapshot = async () => (await db.query(`SELECT key,md5(COALESCE(value,'')) AS fingerprint
                        FROM settings WHERE key=ANY($1::text[]) ORDER BY key`,
                    [[`business_cabinet:${context}`, `timeline_display:${context}`]])).rows;
                    const before = await snapshot();
                    const result = await http({ actor, context, path });
                    expectStatus(result, 200);
                    if (kind === 'cabinet') {
                        assert.equal(result.body.businessContext, context);
                        assert.equal(result.body.cabinet?.context, context);
                        assert.equal(result.body.cabinet?.modules?.source, 'business_registry');
                        assert.equal(result.body.cabinet?.modules?.readOnly, true);
                        const registered = (await db.query('SELECT modules FROM businesses WHERE context_key=$1', [context])).rows[0];
                        assert.ok(registered);
                        assert.deepEqual([...result.body.cabinet.modules.enabledIds].sort(), [...registered.modules].sort());
                    } else assert.equal(result.body.context, context);
                    assert.deepEqual(await snapshot(), before, 'GET must not create defaults or change scoped settings');
                });
        }
        await scenario(`enabled_extra.${context}.omni.list`, 'omni',
            'Owned synthetic conversation included; foreign conversations absent without provider calls', async () => {
                const result = await http({ actor, context, path: '/api/omni/conversations?limit=100' });
                expectStatus(result, 200);
                assert.equal(result.body.businessContext, context);
                const ids = idSet(arrayAt(result.body.data, 'conversations'));
                assert.ok(ids.has(String(fixture.records[context].conversationId)));
                for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    assert.ok(!ids.has(String(fixture.records[foreignContext].conversationId)));
                }
            });
        await scenario(`enabled_extra.${context}.omni.context`, 'omni',
            'Owned conversation resolves its customer/lead/booking; every foreign conversation ID returns404', async () => {
                const own = fixture.records[context];
                const result = await http({ actor, context, path: `/api/omni/conversations/${own.conversationId}/context` });
                expectStatus(result, 200);
                assert.equal(String(result.body.data?.conversation?.id), String(own.conversationId));
                assert.equal(result.body.data?.conversation?.businessContext, context);
                for (const [relation, key] of [['customer', 'customerId'], ['lead', 'leadId'], ['booking', 'bookingId']]) {
                    assert.equal(String(result.body.data?.exact?.[relation]?.id), String(own[key]));
                }
                for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    expectStatus(await http({ actor, context,
                        path: `/api/omni/conversations/${fixture.records[foreignContext].conversationId}/context` }), 404);
                }
            });
        await scenario(`enabled_extra.${context}.omni.messages`, 'omni',
            'Owned synthetic message readable; foreign conversations return an empty message collection', async () => {
                const own = fixture.records[context];
                const result = await http({ actor, context, path: `/api/omni/conversations/${own.conversationId}/messages` });
                expectStatus(result, 200);
                assert.ok(idSet(arrayAt(result.body.data, 'messages')).has(String(own.messageId)));
                for (const foreignContext of Object.values(fixture.contexts).filter(value => value !== context)) {
                    const foreign = await http({ actor, context,
                        path: `/api/omni/conversations/${fixture.records[foreignContext].conversationId}/messages` });
                    expectStatus(foreign, 200);
                    assert.equal(arrayAt(foreign.body.data, 'messages').length, 0);
                    assert.equal(foreign.body.data.total, 0);
                }
            });
    }
    for (const [domain, paths] of [
        ['dashboard', ['/api/dashboard/widgets/tasks', '/api/dashboard/widgets/leads_new']],
        ['settings', ['/api/business/cabinet', '/api/settings/timeline-display']],
        ['omni', ['/api/omni/conversations', `/api/omni/conversations/${fixture.records[park].conversationId}/context`]]
    ]) {
        await scenario(`enabled_extra.${domain}.inaccessible_organization`, domain,
            'Explicit context from an inaccessible organization is rejected before the read', async () => {
                for (const path of paths) {
                    expectStatus(await http({ actor: 'otherOrg', context: park, path }), 403);
                    expectStatus(await http({ actor: 'owner', context: other, path }), 403);
                }
            });
    }
    // Additional residual probes are separate from the 123 core scenarios.
    // No contractor message, order mutation, export or provider action is used.
    for (const [context, actor] of scopes) {
        for (const [domain, path, arrayKey, key] of [
            ['contractors', '/api/contractors', null, 'contractorId'],
            ['procurement', '/api/procurement', 'lists', 'procurementListId']
        ]) {
            await scenario(`warehouse_residual.${context}.${domain}.unassigned_list`, 'warehouse_residual',
                'Unassigned legacy rows are quarantined or excluded from membership reads', async () => {
                    const result = await http({ actor, context, path });
                    if (result.status === 403) return;
                    expectStatus(result, 200);
                    const ids = idSet(arrayAt(result.body, arrayKey));
                    const exposed = Object.values(fixture.unownedWarehouseSentinels)
                        .filter(row => ids.has(String(row[key]))).map(row => row[key]);
                    activeEvidence[activeEvidence.length - 1].sentinelEvidence = {
                        legacyRowOwnership: 'UNASSIGNED_GLOBAL_ROW', exposedSyntheticIds: exposed };
                    assert.equal(exposed.length, 0, `Unassigned ${domain} rows returned to ${context}: ${exposed.join(',')}`);
                });
        }
    }
    for (const ownerContext of [park, dar]) {
        const sentinel = fixture.unownedWarehouseSentinels[ownerContext];
        for (const [context, actor] of [[ownerContext === park ? dar : park, 'owner'], [other, 'otherOrg']]) {
            for (const [kind, parameter, id] of [
                ['direct_stock', 'stockItemId', sentinel.stockId],
                ['procurement_stock', 'procurementItemId', sentinel.procurementItemId]
            ]) {
                await scenario(`warehouse_residual.${context}.${ownerContext}.${kind}`, 'warehouse_residual',
                    'Contractor order-context cannot return a stock item owned by another business or organization', async () => {
                        const stored = (await db.query('SELECT id,business_context FROM warehouse_stock WHERE id=$1',
                            [sentinel.stockId])).rows[0];
                        assert.equal(stored?.business_context, ownerContext, 'Foreign stock must have explicit stored ownership');
                        assert.notEqual(context, ownerContext);
                        const result = await http({ actor, context,
                            path: `/api/contractors/${sentinel.contractorId}/order-context?${parameter}=${id}` });
                        activeEvidence[activeEvidence.length - 1].sentinelEvidence = {
                            storedStockId: stored.id, storedStockBusinessContext: stored.business_context,
                            returnedStockId: result.body?.stockItem?.id ?? null,
                            returnedStockBusinessContext: result.body?.stockItem?.business_context ?? null,
                            returnedProcurementItemId: result.body?.procurementItem?.id ?? null,
                            legacyRowOwnership: sentinel.legacyRowOwnership };
                        if ([403, 404].includes(result.status)) return;
                        expectStatus(result, 200);
                        assert.notEqual(String(result.body?.stockItem?.id), String(sentinel.stockId),
                            `Foreign stock ${sentinel.stockId} owned by ${ownerContext} returned to ${context} through ${kind}`);
                    });
            }
        }
    }
    return { scenarios: outcomes.length, pass: outcomes.filter(row => row.status === 'PASS').length,
        fail: outcomes.filter(row => row.status === 'FAIL').length, outcomes };
}

module.exports = { seed, run };
