const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { pool } = require('../db');
const {
    apiAudit,
    hermesActionType,
    redactAuditHeaders
} = require('../middleware/apiAudit');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

function waitFor(predicate, timeoutMs = 1000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for audit write'));
            return setTimeout(tick, 5);
        };
        tick();
    });
}

async function request(baseUrl, method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

test('apiAudit writes safe Hermes mutation metadata without raw secrets or PII', async () => {
    const originalQuery = pool.query;
    const writes = [];
    pool.query = async (text, params = []) => {
        if (/INSERT INTO user_action_log/i.test(text)) {
            writes.push({ text, params });
            return { rows: [], rowCount: 1 };
        }
        return originalQuery.call(pool, text, params);
    };

    const app = express();
    app.use(express.json());
    app.use('/api', apiAudit);
    app.post('/api/hermes/tasks/:id/complete', (req, res) => {
        req.user = {
            id: 77,
            username: 'hermes_bot',
            name: 'Hermes Bot'
        };
        req.integration = {
            id: 'hermes-event-genix-crm',
            source: 'hermes',
            authMode: 'x-api-key',
            actorUserId: 77
        };
        req.hermesMutation = {
            sourceSurface: 'hermes',
            source: 'hermes-event-genix-crm',
            idempotencyKey: 'raw-idempotency-key-secret'
        };
        res.json({ success: true });
    });

    const { server, baseUrl } = await listen(app);
    try {
        const res = await request(baseUrl, 'POST', '/api/hermes/tasks/123/complete', {
            phone: '+380001112233',
            email: 'client@example.com'
        }, {
            'x-api-key': 'raw-hermes-api-key',
            Authorization: 'Bearer raw-bearer-token',
            Cookie: 'sid=raw-cookie-secret',
            'X-Request-ID': 'audit-test-1'
        });

        assert.equal(res.status, 200, res.text);
        await waitFor(() => writes.length === 1);

        const [username, action, target, metaText] = writes[0].params;
        const meta = JSON.parse(metaText);
        const serialized = JSON.stringify(writes);

        assert.equal(username, 'hermes_bot');
        assert.equal(action, 'api:POST');
        assert.equal(target, '/api/hermes/tasks/123/complete');
        assert.equal(meta.integrationId, 'hermes-event-genix-crm');
        assert.equal(meta.integrationSource, 'hermes');
        assert.equal(meta.endpoint, '/api/hermes/tasks/123/complete');
        assert.equal(meta.status, 200);
        assert.equal(meta.actionType, 'tasks.complete');
        assert.equal(meta.authMode, 'x-api-key');
        assert.equal(meta.actorUserId, 77);
        assert.match(meta.idempotencyKeyFingerprint, /^[a-f0-9]{12}$/);
        assert.equal(Number.isInteger(meta.latencyMs), true);
        assert.equal(meta.params.id, '123');

        assert.equal(serialized.includes('raw-hermes-api-key'), false);
        assert.equal(serialized.includes('raw-bearer-token'), false);
        assert.equal(serialized.includes('raw-cookie-secret'), false);
        assert.equal(serialized.includes('raw-idempotency-key-secret'), false);
        assert.equal(serialized.includes('+380001112233'), false);
        assert.equal(serialized.includes('client@example.com'), false);
    } finally {
        await close(server);
        pool.query = originalQuery;
    }
});

test('apiAudit stores only the sanitized Hermes staff approval receipt', async () => {
    const originalQuery = pool.query;
    const writes = [];
    pool.query = async (text, params = []) => {
        if (/INSERT INTO user_action_log/i.test(text)) {
            writes.push({ text, params });
            return { rows: [], rowCount: 1 };
        }
        return originalQuery.call(pool, text, params);
    };

    const app = express();
    app.use(express.json());
    app.use('/api', apiAudit);
    app.post('/api/hermes/staff', (req, res) => {
        req.user = {
            id: 77,
            username: 'hermes_bot'
        };
        req.integration = {
            id: 'hermes-event-genix-crm',
            source: 'hermes',
            authMode: 'x-api-key',
            actorUserId: 77
        };
        req.hermesMutation = {
            idempotencyKey: 'raw-staff-idempotency-key',
            auditReceipt: {
                approvalContext: {
                    sourceContext: 'staff_registration',
                    packetId: 'EG_STAFF_REG_PDF_FINISH_WAITER_20260819',
                    chatId: '-1003979718101',
                    messageId: '23',
                    approvalType: 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE',
                    approvalAction: 'APPROVE_CANDIDATE',
                    crmWriteApprovalPresent: true,
                    crmWriteApprovalMatchesPacket: true,
                    crmWriteApproval: 'raw-crm-write-approval-token',
                    approvedByTelegramUserId: 'raw-telegram-user-id',
                    privateForm: { phone: '+380009998877' }
                },
                outcome: 'ALREADY_EXISTS_NO_CREATE',
                staffId: 937,
                idempotencyReplay: true,
                businessWrites: {
                    staffWrites: 0,
                    accountWrites: 0,
                    scheduleWrites: 0,
                    attendanceWrites: 0,
                    payrollWrites: 0,
                    auditWrites: 1,
                    privateCounter: 'raw-private-counter'
                },
                rawPayload: req.body,
                rawHeaders: req.headers
            }
        };
        res.status(409).json({ ok: false });
    });

    const { server, baseUrl } = await listen(app);
    try {
        const res = await request(baseUrl, 'POST', '/api/hermes/staff', {
            name: 'Private Candidate Name',
            phone: '+380001112233',
            password: 'raw-account-password'
        }, {
            'x-api-key': 'raw-hermes-api-key',
            Authorization: 'Bearer raw-bearer-token'
        });

        assert.equal(res.status, 409, res.text);
        await waitFor(() => writes.length === 1);

        const meta = JSON.parse(writes[0].params[3]);
        const serialized = JSON.stringify(writes);

        assert.equal(meta.actionType, 'staff.create');
        assert.deepEqual(meta.approvalContext, {
            sourceContext: 'staff_registration',
            packetId: 'EG_STAFF_REG_PDF_FINISH_WAITER_20260819',
            chatId: '-1003979718101',
            messageId: '23',
            approvalType: 'STAFF_ONLY_NO_ACCOUNT_NO_SCHEDULE',
            approvalAction: 'APPROVE_CANDIDATE',
            crmWriteApprovalPresent: true,
            crmWriteApprovalMatchesPacket: true
        });
        assert.equal(meta.outcome, 'ALREADY_EXISTS_NO_CREATE');
        assert.equal(meta.staffId, 937);
        assert.equal(meta.idempotencyReplay, true);
        assert.deepEqual(meta.businessWrites, {
            staffWrites: 0,
            accountWrites: 0,
            scheduleWrites: 0,
            attendanceWrites: 0,
            payrollWrites: 0
        });

        for (const forbidden of [
            'raw-crm-write-approval-token',
            'raw-telegram-user-id',
            'raw-private-counter',
            'Private Candidate Name',
            '+380001112233',
            '+380009998877',
            'raw-account-password',
            'raw-staff-idempotency-key',
            'raw-hermes-api-key',
            'raw-bearer-token'
        ]) {
            assert.equal(serialized.includes(forbidden), false, `audit must not contain ${forbidden}`);
        }
        assert.equal(Object.hasOwn(meta.businessWrites, 'auditWrites'), false);
    } finally {
        await close(server);
        pool.query = originalQuery;
    }
});

test('Hermes audit redaction helpers hide sensitive headers and classify write actions', () => {
    assert.deepEqual(redactAuditHeaders({
        'x-api-key': 'secret',
        Authorization: 'Bearer secret',
        cookie: 'sid=secret',
        'x-request-id': 'req-1'
    }), {
        'x-api-key': '[redacted]',
        Authorization: '[redacted]',
        cookie: '[redacted]',
        'x-request-id': 'req-1'
    });

    assert.equal(hermesActionType({ method: 'POST', path: '/hermes/tasks' }), 'tasks.create');
    assert.equal(hermesActionType({ method: 'POST', originalUrl: '/api/hermes/staff?source=registration' }), 'staff.create');
    assert.equal(hermesActionType({ method: 'POST', originalUrl: '/api/hermes/tasks/1/reassign?x=1' }), 'tasks.reassign');
    assert.equal(hermesActionType({ method: 'POST', path: '/tasks/1/reassign', originalUrl: '/api/hermes/tasks/1/reassign?x=1' }), 'tasks.reassign');
    assert.equal(hermesActionType({ method: 'POST', path: '/hermes/tasks/1/reschedule' }), 'tasks.reschedule');
});
