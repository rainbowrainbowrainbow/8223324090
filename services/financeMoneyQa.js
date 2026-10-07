'use strict';

const crypto = require('node:crypto');
const { resolveCapability, normalizeRoleList } = require('./accountAccessPolicy');
const { isQaLeaseCandidate, resolveActiveQaCreatorLease } = require('./qaCreatorLease');

const FINANCE_QA_ENDPOINTS = Object.freeze([
    'GET /api/finance/manual-money', 'GET /api/finance/manual-money/bookings/:bookingId',
    'POST /api/finance/manual-money/commands', 'GET /api/finance/accounts', 'POST /api/finance/accounts',
    'GET /api/finance/categories', 'POST /api/finance/categories'
]);
const MAX_OPERATIONS = 40;
const MAX_AMOUNT_MINOR = 1000000n;
const MAX_POSITIVE_MINOR = 3000000n;
const FINANCE_ENTITY_TYPES = new Set(['finance_account', 'finance_category', 'finance_operation', 'finance_shift']);

function qaError(code, message, status = 409) {
    return Object.assign(new Error(message), { code, status, statusCode: status });
}

function assert(condition, code, message, status) {
    if (!condition) throw qaError(code, message, status);
}

function registry() { return require('./trustedQaRuns'); }
function hashFinanceQaPlan(plan) { return crypto.createHash('sha256').update(JSON.stringify(normalizeFinanceQaPlan(plan))).digest('hex'); }

function limitMinor(value, fallback, maximum, field) {
    const text = value === undefined ? fallback.toString() : value;
    assert(typeof text === 'string' && /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= maximum,
        'FINANCE_QA_PLAN_INVALID', `${field} must be an integer kopeck string within the QA cap.`, 400);
    return BigInt(text).toString();
}

function normalizeFinanceQaPlan(raw) {
    assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'FINANCE_QA_PLAN_INVALID', 'A finance QA plan is required.', 400);
    const fields = new Set(['runId', 'testAccountId', 'businessContext', 'ttlMinutes', 'accountTypes', 'categoryTypes',
        'maxOperations', 'maxAmountMinor', 'maxPositiveMinor', 'bookingFixtures']);
    assert(Object.keys(raw).every(key => fields.has(key)), 'FINANCE_QA_PLAN_INVALID', 'Unknown finance QA plan field.', 400);
    assert(typeof raw.runId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw.runId), 'FINANCE_QA_PLAN_INVALID', 'Invalid exact run ID.', 400);
    assert(Number.isSafeInteger(raw.testAccountId) && raw.testAccountId > 0, 'FINANCE_QA_PLAN_INVALID', 'An exact existing QA user ID is required.', 400);
    assert(raw.businessContext === 'event_genix', 'FINANCE_QA_PLAN_INVALID', 'This QA release is limited to event_genix.', 400);
    assert(Number.isInteger(raw.ttlMinutes) && raw.ttlMinutes >= 1 && raw.ttlMinutes <= 30, 'FINANCE_QA_PLAN_INVALID', 'QA TTL must be 1–30 minutes.', 400);
    const accountTypes = raw.accountTypes || ['cash', 'cash', 'bank'];
    const categoryTypes = raw.categoryTypes || ['income', 'expense'];
    assert(Array.isArray(accountTypes) && accountTypes.length === 3 && accountTypes[0] === 'cash'
        && accountTypes[1] === 'cash' && ['bank', 'card'].includes(accountTypes[2]), 'FINANCE_QA_PLAN_INVALID', 'The QA plan contains exactly two cash accounts and one bank/card account.', 400);
    assert(JSON.stringify(categoryTypes) === JSON.stringify(['income', 'expense']), 'FINANCE_QA_PLAN_INVALID', 'The QA plan contains one income and one expense category.', 400);
    const maxOperations = raw.maxOperations === undefined ? MAX_OPERATIONS : raw.maxOperations;
    assert(Number.isInteger(maxOperations) && maxOperations >= 1 && maxOperations <= MAX_OPERATIONS, 'FINANCE_QA_PLAN_INVALID', 'Operation cap exceeds the QA boundary.', 400);
    assert(raw.bookingFixtures === undefined || Array.isArray(raw.bookingFixtures), 'FINANCE_QA_PLAN_INVALID', 'bookingFixtures must be an array.', 400);
    const fixtures = raw.bookingFixtures === undefined || raw.bookingFixtures.length === 0 ? []
        : registry().normalizeTrustedQaBookingFixtures(raw.bookingFixtures, { maxFixtures: 2, statusCode: 400 });
    for (const fixture of fixtures) {
        assert((!fixture.status || fixture.status === 'confirmed') && !fixture.secondAnimatorLineId && !fixture.secondAnimator
            && (!fixture.hosts || fixture.hosts === 1) && (!fixture.pinataMode || fixture.pinataMode === 'none') && !fixture.pinataNumber
            && (!fixture.productId || fixture.productId === fixture.programId)
            && !/banquet|kitchen|certificate|банкет|кух/i.test([fixture.category, fixture.programName, fixture.programCode, fixture.label, fixture.lineId].join(' ')),
        'FINANCE_QA_PLAN_INVALID', 'Finance QA bookings must be standalone, confirmed and without banquet, stock, certificate or second-animator flows.', 400);
    }
    const maxAmountMinor = limitMinor(raw.maxAmountMinor, MAX_AMOUNT_MINOR, MAX_AMOUNT_MINOR, 'maxAmountMinor');
    const maxPositiveMinor = limitMinor(raw.maxPositiveMinor, MAX_POSITIVE_MINOR, MAX_POSITIVE_MINOR, 'maxPositiveMinor');
    assert(BigInt(maxPositiveMinor) >= BigInt(maxAmountMinor), 'FINANCE_QA_PLAN_INVALID', 'Positive movement budget must cover the per-command cap.', 400);
    return { runId: raw.runId, testAccountId: raw.testAccountId, businessContext: raw.businessContext,
        ttlMinutes: raw.ttlMinutes, accountTypes: [...accountTypes], categoryTypes: [...categoryTypes], maxOperations,
        maxAmountMinor, maxPositiveMinor, bookingFixtures: fixtures };
}

async function preflightFinanceQaPlan(client, input, { lock = false } = {}) {
    const plan = normalizeFinanceQaPlan(input);
    const result = await client.query(`SELECT u.*,
        EXISTS(SELECT 1 FROM employee_profiles e WHERE e.user_id = u.id AND COALESCE(e.is_active, true)) AS has_staff_profile
        FROM users u WHERE u.id = $1 ${lock ? 'FOR SHARE OF u' : ''}`, [plan.testAccountId]);
    const principal = result.rows[0];
    assert(principal?.is_active === true && !principal.has_staff_profile && isQaLeaseCandidate(principal),
        'FINANCE_QA_OPERATOR_INVALID', 'Exact active isolated QA account without an active employee profile is required.');
    const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
    const leasedPrincipal = await resolveActiveQaCreatorLease(principal, client);
    const access = await loadMembershipAccess(client, leasedPrincipal, plan.businessContext);
    const actor = applyMembershipAccess(leasedPrincipal, access);
    assert(normalizeRoleList(actor).some(role => ['creator', 'director', 'accountant'].includes(role))
        && resolveCapability(actor, 'finance.manage', { type: 'action' }).allowed
        && resolveCapability(actor, 'view_revenue', { type: 'action' }).allowed,
    'FINANCE_QA_OPERATOR_PERMISSION_REQUIRED', 'The exact QA account does not already have the required finance role and capabilities.', 403);
    assert((actor.business_contexts || actor.businessContexts || []).includes(plan.businessContext)
        || actor.role === 'creator', 'FINANCE_QA_OPERATOR_CONTEXT_REQUIRED', 'The QA account has no access to this business.', 403);
    const schema = (await client.query("SELECT to_regclass('public.finance_money_qa_runs') IS NOT NULL AS installed")).rows[0].installed;
    assert(schema || !lock, 'FINANCE_QA_SCHEMA_REQUIRED', 'Finance QA migration must be installed before creating a run.');
    const open = schema ? await client.query(`SELECT COUNT(*)::int AS count FROM finance_money_qa_runs f
        JOIN trusted_qa_runs r ON r.id = f.run_id WHERE r.state IN ('active', 'cleanup_pending', 'blocked')`, []) : { rows: [{ count: 0 }] };
    assert(Number(open.rows[0].count) === 0, 'FINANCE_QA_RUN_ALREADY_OPEN', 'Another finance QA run requires completion or investigation.');
    const existing = await client.query('SELECT 1 FROM trusted_qa_runs WHERE run_id = $1', [plan.runId]);
    assert(!existing.rowCount, 'FINANCE_QA_RUN_ID_USED', 'This QA run ID has already been used.');
    // Canonical booking creation still validates line/room availability and all booking contracts.
    // Preflight refuses a fixture whose selected product carries side-effect requirements.
    for (const fixture of plan.bookingFixtures) {
        const product = await client.query(`SELECT p.id, p.price, p.is_active, p.domain, p.category,
            EXISTS(SELECT 1 FROM product_stock_requirements s WHERE s.product_id = p.id) AS has_stock
            FROM products p WHERE p.id = $1 AND COALESCE(p.business_context, 'event_genix') = $2`,
        [fixture.productId || fixture.programId, plan.businessContext]);
        const row = product.rows[0];
        assert(row && row.is_active && !row.has_stock && (row.domain || 'program') === 'program'
            && !/banquet|kitchen|certificate|банкет|кух/i.test(String(row.category || '')) && Number.isSafeInteger(Number(row.price))
            && BigInt(row.price || 0) > 0n && BigInt(row.price) * 100n <= BigInt(plan.maxAmountMinor),
        'FINANCE_QA_FIXTURE_PRODUCT_INVALID', 'Booking fixture requires an active positive-price product without stock requirements inside the amount cap.');
    }
    return { plan, planHash: hashFinanceQaPlan(plan), readiness: { isolated: true, openFinanceRuns: 0,
        accountId: principal.id, bookingFixtureCount: plan.bookingFixtures.length, schemaInstalled: schema } };
}

async function createFinanceQaRun(client, input, { approvedHash, token } = {}) {
    const readiness = await preflightFinanceQaPlan(client, input, { lock: true });
    assert(approvedHash === readiness.planHash, 'FINANCE_QA_PLAN_HASH_MISMATCH', 'Exact reviewed finance QA plan hash is required.', 400);
    const plan = readiness.plan;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('finance-money-qa-create', 0))");
    const concurrent = await client.query(`SELECT 1 FROM finance_money_qa_runs f JOIN trusted_qa_runs r ON r.id = f.run_id
        WHERE r.state IN ('active', 'cleanup_pending', 'blocked') LIMIT 1`);
    assert(!concurrent.rowCount, 'FINANCE_QA_RUN_ALREADY_OPEN', 'Another finance QA run requires completion or investigation.');
    const created = await registry().createTrustedQaRun(client, { token, runId: plan.runId, source: 'trusted_qa',
        businessContext: plan.businessContext, operatorUserId: plan.testAccountId, requiredOperatorUserId: plan.testAccountId,
        requiredUserId: plan.testAccountId, testCustomerMarker: `${plan.runId}:finance:disposable`,
        allowedEndpoints: plan.bookingFixtures.length ? ['POST /api/bookings'] : ['POST /api/finance/manual-money/commands'],
        ...(plan.bookingFixtures.length ? { bookingFixtures: plan.bookingFixtures } : {}),
        maxEntityCount: 5 + plan.bookingFixtures.length + plan.maxOperations * 2, ttlMinutes: plan.ttlMinutes });
    await client.query(`INSERT INTO finance_money_qa_runs(run_id, business_context, plan_hash, plan,
        max_operations, max_amount_minor, max_positive_minor) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [created.run.id, plan.businessContext, readiness.planHash, JSON.stringify(plan), plan.maxOperations, plan.maxAmountMinor, plan.maxPositiveMinor]);
    return { ...created, plan, planHash: readiness.planHash };
}

async function resolveFinanceQaAccess(client, { actor, businessContext, token, endpoint, forUpdate = false }) {
    if (!token) return null;
    assert(typeof token === 'string' && token.length <= 300, 'FINANCE_QA_TOKEN_INVALID', 'Invalid finance QA token.', 403);
    assert(FINANCE_QA_ENDPOINTS.includes(endpoint), 'FINANCE_QA_ENDPOINT_DENIED', 'This endpoint is outside the finance QA run.', 403);
    const result = await client.query(`SELECT r.*, f.plan, f.max_operations, f.max_amount_minor, f.max_positive_minor,
        f.operation_count, f.positive_minor FROM trusted_qa_runs r JOIN finance_money_qa_runs f ON f.run_id = r.id
        WHERE r.token_hash = $1 AND r.business_context = $2 AND r.state = 'active' AND r.expires_at > clock_timestamp()
        ${forUpdate ? 'FOR UPDATE OF r, f' : ''}`, [registry().sha256(token), businessContext]);
    const run = result.rows[0];
    assert(run && Number(run.required_user_id) === Number(actor?.id) && Number(run.operator_user_id) === Number(actor?.id),
        'FINANCE_QA_ACCESS_DENIED', 'The finance QA run is absent, expired or belongs to another operator.', 403);
    if (forUpdate) {
        const fresh = await client.query("SELECT state = 'active' AND expires_at > clock_timestamp() AS valid FROM trusted_qa_runs WHERE id = $1", [run.id]);
        assert(fresh.rows[0]?.valid === true, 'FINANCE_QA_ACCESS_DENIED', 'The finance QA run expired while waiting for its lock.', 403);
        await client.query(`SELECT set_config('app.finance_qa_run_id', $1, true),
            set_config('app.finance_qa_actor_id', $2, true)`, [String(run.id), String(actor.id)]);
    }
    return { runId: String(run.id), publicRunId: run.run_id, actorId: Number(actor.id), businessContext,
        expiresAt: new Date(run.expires_at).toISOString(), plan: run.plan, run,
        limits: { maxOperations: run.max_operations, maxAmountMinor: String(run.max_amount_minor), maxPositiveMinor: String(run.max_positive_minor) },
        counts: { operations: run.operation_count, positiveMinor: String(run.positive_minor) } };
}

async function assertFinanceQaEntity(client, scope, entityType, id) {
    assert(scope && (FINANCE_ENTITY_TYPES.has(entityType) || entityType === 'booking'),
        'FINANCE_QA_ENTITY_DENIED', 'This entity type is outside finance QA.', 403);
    const result = await client.query(`SELECT payload FROM trusted_qa_run_entities
        WHERE run_id = $1 AND entity_type = $2 AND entity_id = $3 AND cleanup_state = 'active'`,
    [scope.runId, entityType, String(id)]);
    assert(result.rowCount === 1, 'FINANCE_QA_ENTITY_DENIED', 'The selected record is not owned by this finance QA run.', 403);
    return result.rows[0];
}

async function assertFinanceQaCommand(client, scope, payload) {
    const allowed = ['enroll', 'open_shift', 'close_shift', 'income', 'expense', 'booking_receipt', 'transfer', 'refund', 'reverse'];
    assert(allowed.includes(payload.command), 'FINANCE_QA_COMMAND_DENIED', 'Unsupported finance QA command.', 400);
    for (const id of [payload.accountId, payload.toAccountId].filter(Boolean)) await assertFinanceQaEntity(client, scope, 'finance_account', id);
    if (payload.categoryId) await assertFinanceQaEntity(client, scope, 'finance_category', payload.categoryId);
    if (payload.bookingId) await assertFinanceQaEntity(client, scope, 'booking', payload.bookingId);
    if (payload.shiftId) await assertFinanceQaEntity(client, scope, 'finance_shift', payload.shiftId);
    let original = null;
    if (payload.originalId) {
        await assertFinanceQaEntity(client, scope, 'finance_operation', payload.originalId);
        original = (await client.query(`SELECT * FROM finance_manual_operations WHERE id = $1 AND finance_qa_run_id = $2`,
            [payload.originalId, scope.runId])).rows[0];
        assert(original, 'FINANCE_QA_ENTITY_DENIED', 'The original operation is outside this QA run.', 403);
        if (original.booking_id) await assertFinanceQaEntity(client, scope, 'booking', original.booking_id);
        const legs = await client.query('SELECT account_id FROM finance_manual_legs WHERE operation_id = $1', [original.id]);
        for (const leg of legs.rows) await assertFinanceQaEntity(client, scope, 'finance_account', leg.account_id);
    }
    const amount = String(payload.amountMinor ?? payload.openingMinor ?? payload.actualMinor ?? original?.amount_minor ?? '0');
    assert(/^\d+$/.test(amount) && BigInt(amount) <= BigInt(scope.limits.maxAmountMinor),
        'FINANCE_QA_AMOUNT_CAP', 'QA command exceeds its approved amount cap.', 409);
    let positiveMinor = ['enroll', 'income', 'booking_receipt', 'transfer'].includes(payload.command) ? BigInt(amount) : 0n;
    if (payload.command === 'reverse' && ['expense', 'transfer'].includes(original?.command)) positiveMinor = BigInt(amount);
    const limits = (await client.query('SELECT operation_count, positive_minor FROM finance_money_qa_runs WHERE run_id = $1 FOR UPDATE', [scope.runId])).rows[0];
    assert(limits && limits.operation_count < scope.limits.maxOperations
        && BigInt(limits.positive_minor) + positiveMinor <= BigInt(scope.limits.maxPositiveMinor),
    'FINANCE_QA_BUDGET_EXHAUSTED', 'The approved QA operation or positive movement budget is exhausted.');
    return { positiveMinor: positiveMinor.toString() };
}

function fixtureText(value, field, length, required = false) {
    if (value == null || value === '') { assert(!required, 'FINANCE_QA_INPUT_INVALID', `${field} is required.`, 400); return null; }
    assert(typeof value === 'string' && value.trim().length <= length && (!required || value.trim()), 'FINANCE_QA_INPUT_INVALID', `Invalid ${field}.`, 400);
    return value.trim();
}

async function createFixture(client, scope, input, type) {
    const account = type === 'finance_account';
    const allowed = account ? ['name', 'type', 'emoji', 'description', 'isPersonal'] : ['name', 'type', 'icon', 'color'];
    assert(input && Object.keys(input).every(key => allowed.includes(key)) && (!account || !input.isPersonal),
        'FINANCE_QA_INPUT_INVALID', 'Unsupported QA fixture field.', 400);
    const requestedType = input.type;
    const permitted = account ? scope.plan.accountTypes : scope.plan.categoryTypes;
    const table = account ? 'finance_accounts' : 'finance_categories';
    const used = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE finance_qa_run_id = $1 AND type = $2`, [scope.runId, requestedType]);
    assert(permitted.filter(item => item === requestedType).length > Number(used.rows[0].count),
        'FINANCE_QA_FIXTURE_LIMIT', 'This QA fixture type has reached its approved count.');
    const name = `QA FIN ${scope.runId} · ${fixtureText(input.name, 'name', 60, true)}`;
    const created = account ? await client.query(`INSERT INTO finance_accounts
        (business_context, name, type, emoji, description, is_active, is_personal, created_by, finance_qa_run_id)
        VALUES($1,$2,$3,$4,$5,true,false,$6,$7) RETURNING *`,
    [scope.businessContext, name, requestedType, fixtureText(input.emoji, 'emoji', 10) || '💳', fixtureText(input.description, 'description', 500), String(scope.actorId), scope.runId])
        : await client.query(`INSERT INTO finance_categories(business_context, name, type, icon, color, is_active, is_system, finance_qa_run_id)
            VALUES($1,$2,$3,$4,$5,true,false,$6) RETURNING *`,
        [scope.businessContext, name, requestedType, fixtureText(input.icon, 'icon', 10) || '📋', fixtureText(input.color, 'color', 20) || '#6366f1', scope.runId]);
    await registry().registerQaEntity(client, { trusted: true, run: scope.run }, type, created.rows[0].id,
        { businessContext: scope.businessContext, name, type: requestedType });
    return created.rows[0];
}

const createFinanceQaAccount = (client, scope, input) => createFixture(client, scope, input, 'finance_account');
const createFinanceQaCategory = (client, scope, input) => createFixture(client, scope, input, 'finance_category');

async function recordFinanceQaOperation(client, scope, { operationId, shiftId, positiveMinor = '0' }) {
    const updated = await client.query(`UPDATE finance_money_qa_runs SET operation_count = operation_count + 1,
        positive_minor = positive_minor + $2::bigint WHERE run_id = $1
        AND operation_count < max_operations AND positive_minor + $2::bigint <= max_positive_minor RETURNING run_id`, [scope.runId, positiveMinor]);
    assert(updated.rowCount === 1, 'FINANCE_QA_BUDGET_EXHAUSTED', 'The approved QA budget is exhausted.');
    const ctx = { trusted: true, run: scope.run };
    await registry().registerQaEntity(client, ctx, 'finance_operation', operationId, { businessContext: scope.businessContext });
    if (shiftId) await registry().registerQaEntity(client, ctx, 'finance_shift', shiftId, { businessContext: scope.businessContext });
}

async function prepareFinanceQaCleanup(client, inventory) {
    const qa = (await client.query('SELECT * FROM finance_money_qa_runs WHERE run_id = $1 FOR UPDATE', [inventory.run.id])).rows[0];
    assert(qa, 'FINANCE_QA_RUN_MISSING', 'Finance QA lifecycle metadata is missing.');
    const manifest = inventory.entities || [];
    for (const [table, type] of [['finance_accounts', 'finance_account'], ['finance_categories', 'finance_category'],
        ['finance_manual_operations', 'finance_operation'], ['cash_register_shifts', 'finance_shift']]) {
        const rows = await client.query(`SELECT id FROM ${table} WHERE finance_qa_run_id = $1 ORDER BY id`, [inventory.run.id]);
        const expected = manifest.filter(row => row.entity_type === type).map(row => String(row.entity_id)).sort();
        assert(JSON.stringify(rows.rows.map(row => String(row.id)).sort()) === JSON.stringify(expected),
            'FINANCE_QA_MANIFEST_DRIFT', 'Finance QA records differ from the exact registered manifest.');
    }
    const open = await client.query(`SELECT id FROM cash_register_shifts WHERE finance_qa_run_id = $1 AND status = 'open'`, [inventory.run.id]);
    assert(!open.rowCount, 'FINANCE_QA_OPEN_SHIFT', 'Close every exact QA cash shift before finishing; actual cash is never invented by cleanup.');
    await client.query("SELECT set_config('app.finance_qa_finish_run_id', $1, true)", [String(inventory.run.id)]);
    await client.query('UPDATE finance_accounts SET is_active = false WHERE finance_qa_run_id = $1 AND is_active = true', [inventory.run.id]);
    await client.query('UPDATE finance_categories SET is_active = false WHERE finance_qa_run_id = $1 AND is_active = true', [inventory.run.id]);
    return { runId: inventory.run.run_id, operationCount: qa.operation_count, preservedJournal: true };
}

async function finishFinanceQaRun(client, publicRunId) {
    const result = await client.query(`SELECT r.id FROM trusted_qa_runs r JOIN finance_money_qa_runs f ON f.run_id = r.id
        WHERE r.run_id = $1 FOR UPDATE OF r, f`, [publicRunId]);
    assert(result.rowCount === 1, 'FINANCE_QA_RUN_MISSING', 'Exact finance QA run is missing.', 404);
    const cleanup = await registry().cleanupTrustedQaRun(client, result.rows[0].id, { forUpdate: true });
    return { runId: publicRunId, status: cleanup.status, state: cleanup.state, entityCount: cleanup.entityCount, preservedJournal: true };
}

module.exports = { FINANCE_QA_ENDPOINTS, MAX_OPERATIONS, MAX_AMOUNT_MINOR, MAX_POSITIVE_MINOR,
    normalizeFinanceQaPlan, hashFinanceQaPlan, preflightFinanceQaPlan, createFinanceQaRun, resolveFinanceQaAccess,
    assertFinanceQaEntity, assertFinanceQaCommand, createFinanceQaAccount, createFinanceQaCategory,
    recordFinanceQaOperation, prepareFinanceQaCleanup, finishFinanceQaRun };
