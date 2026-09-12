'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { paymentProgress } = require('../services/payments/paymentProgress');
const { nextPendingWait } = require('../services/payments/paymentPendingWait');

const forbidden = () => assert.fail('Unexpected dependency call in progress-only test');
const deniedExports = new Proxy({}, { get: () => forbidden });

function evaluate(relative, dependencies) {
    const filename = path.resolve(__dirname, '..', relative);
    const module = { exports: {} };
    const wrapper = vm.runInThisContext('(function(require,module,exports,process,setTimeout,setInterval,fetch){\n'
        + fs.readFileSync(filename, 'utf8') + '\n})', { filename });
    wrapper(id => {
        assert.ok(Object.hasOwn(dependencies, id), 'Unexpected import: ' + id);
        return dependencies[id];
    }, module, module.exports, { env: {} }, forbidden, forbidden, forbidden);
    return module.exports;
}

function loadService(dbPool, authorize) {
    const dependencies = Object.fromEntries([
        './testDrainGate', '../admissionTickets', '../businessContext', './money', './cashierOperationsService',
        './paymentStateMachine', './paymentOutboxWakeup', './paymentReadinessService', '../checkbox/config'
    ].map(id => [id, deniedExports]));
    return evaluate('services/payments/paymentService.js', {
        ...dependencies, 'node:crypto': require('node:crypto'), '../../db': { pool: dbPool },
        './fiscalAccess': { authorizeFiscalAction: authorize, authorizeFiscalActorAction: authorize },
        './paymentProgress': { paymentProgress }
    });
}

function loadProjection(service) {
    const router = {};
    for (const method of ['use', 'get', 'post', 'put']) {
        router[method] = (...args) => {
            for (const handler of args.slice(typeof args[0] === 'string' ? 1 : 0)) assert.equal(typeof handler, 'function');
        };
    }
    const dependencies = Object.fromEntries([
        '../services/payments/sharedTestDayService', '../services/payments/catalogSaleService',
        '../services/payments/cashierBindingAdminService', '../services/payments/cashierOperationsService',
        '../services/payments/paymentReadinessService', '../services/payments/fiscalSaleRouteService'
    ].map(id => [id, deniedExports]));
    return evaluate('routes/payments.js', {
        ...dependencies, express: { Router: () => router },
        '../db': { pool: { query: forbidden, connect: forbidden } },
        '../middleware/auth': { authenticateToken: forbidden, requireAction: () => forbidden },
        '../services/businessContext': { canAccessBusinessContext: () => false },
        '../services/checkbox/config': {
            isCashierProEnabled: () => false,
            isParkDarTestServiceOutEnabled: () => false,
            isParkDarTestXzEnabled: () => false,
            isCheckboxIntegrationEnabled: () => false
        },
        '../services/payments/paymentService': service
    }).__cashierProjectionTest.projectPaymentOrderDetailsForViewer;
}

function fixture({ denied = false, business = 'event_genix', route = 'park_test' } = {}) {
    const calls = [];
    const authorizations = [];
    const now = Date.now();
    const wait = nextPendingWait({}, now).wait;
    const order = {
        id: 41, fiscal_profile_id: 11, fiscal_location_id: 12, fiscal_register_id: 13,
        crm_profile_key: 'event_genix', business_context: business, fiscal_sale_route_option_id: route,
        route_expected_is_test: true, payment_status: 'confirmed', fiscal_status: 'pending',
        total_amount_minor: '1000', currency: 'UAH'
    };
    const client = {
        async query(sql, params = []) {
            const text = sql.trim().replace(/\s+/g, ' ');
            calls.push(text);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
            if (text.startsWith('SELECT po.*')) { assert.deepEqual(params, [41]); return { rows: [order] }; }
            assert.equal(authorizations.length, 2, 'details require view and test-route authorization first');
            assert.deepEqual(params, [11, 41]);
            if (text.includes('FROM payment_order_items') || text.includes('FROM fiscal_receipts')) return { rows: [] };
            if (text.includes('FROM fiscal_operations operation')) {
                assert.match(text, /shift.fiscal_profile_id = operation.fiscal_profile_id/);
                return { rows: [{ id: 21, operation_type: 'sale', status: 'pending', external_stage: 'receipt_lookup', provider_operation_id: 'hidden-uuid' }] };
            }
            if (text.includes('FROM payment_outbox_jobs')) return { rows: [{
                id: 101, job_type: 'receipt_sell', status: 'queued', external_stage: 'receipt_lookup', attempts: 0, max_attempts: 10,
                next_run_at: new Date(now + 5000).toISOString(),
                payload: { provider_pending_wait: wait, external_stage_recorded_at: new Date(now).toISOString(), hidden: 'synthetic-payload' }
            }] };
            assert.fail('Unexpected progress query: ' + text);
        },
        release() { calls.push('RELEASE'); }
    };
    const authorize = async (_client, scope) => {
        authorizations.push(scope);
        if (denied) throw new Error('synthetic access denied');
        assert.equal(scope.crmProfileKey, business);
        assert.ok(['payments.view', 'fiscal.configure'].includes(scope.action));
        return {};
    };
    return { service: loadService({ connect: async () => client }, authorize), calls, authorizations, wait };
}

test('actual order service and route projection expose safe persisted progress for both shared-register routes', async () => {
    for (const [business, route] of [['event_genix', 'park_test'], ['dar', 'dar_test']]) {
        const f = fixture({ business, route });
        const details = await f.service.getPaymentOrderDetails({ user: { id: 7 }, orderId: 41 });
        assert.equal(details.progress.stage, 'awaiting_receipt');
        assert.equal(details.progress.lastCheckAt, f.wait.lastCheckAt);
        assert.equal(details.progress.waitDeadlineAt, f.wait.deadlineAt);
        assert.ok(details.progress.stageUpdatedAt);
        assert.equal(details.outboxJob.payload, undefined);
        const project = loadProjection(f.service);
        const projected = project({ id: 7 }, { ...details, progress: { ...details.progress, payload: 'hidden', providerId: 'hidden' } });
        assert.deepEqual(projected.progress, details.progress);
        assert.ok(!JSON.stringify(projected).includes('synthetic-payload'));
        assert.ok(!JSON.stringify(projected).includes('hidden-uuid'));
        assert.deepEqual(f.calls.slice(-2), ['COMMIT', 'RELEASE']);
        assert.deepEqual(f.authorizations.map(scope => scope.action), ['payments.view', 'fiscal.configure']);
        assert.equal(f.authorizations[0].fiscalRegisterId, 13);
    }
});

test('progress does not bypass order authorization or issue mutations/provider requests', async () => {
    const f = fixture({ denied: true });
    await assert.rejects(f.service.getPaymentOrderDetails({ user: { id: 7 }, orderId: 41 }), /synthetic access denied/);
    assert.deepEqual(f.calls.slice(-2), ['ROLLBACK', 'RELEASE']);
    assert.equal(f.calls.filter(sql => sql.startsWith('SELECT')).length, 1);
    assert.ok(!f.calls.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)));
});
