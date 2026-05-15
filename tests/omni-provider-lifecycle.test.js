const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../routes/omnichannel',
        '../services/omni-hub',
        '../services/omni-accounts',
        '../services/omni-normalizer',
        '../services/kleshnya-chat',
        '../services/websocket',
        '../services/telegram',
        '../services/omni-viber',
        '../services/omni-sms',
        '../services/omni-facebook',
        '../services/omni-instagram',
        '../middleware/auth',
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function loadHub(pool) {
    clearModules();
    installMock('../db', { pool });
    installMock('../services/kleshnya-chat', { generateChatResponse: async () => '' });
    installMock('../services/websocket', { getWSS: () => ({ clients: [] }) });
    installMock('../services/telegram', { sendTelegramMessage: async () => ({ ok: true, result: { message_id: 42 } }) });
    installMock('../services/omni-viber', { sendViber: async () => ({ success: true, messageToken: 43 }) });
    installMock('../services/omni-sms', { sendSMS: async () => ({ success: true, messageId: 'sms-44' }) });
    installMock('../services/omni-facebook', { sendFacebook: async () => ({ success: true, messageId: 'fb-45' }) });
    installMock('../services/omni-instagram', { sendInstagram: async () => ({ success: true, messageId: 'ig-46' }) });
    return require('../services/omni-hub');
}

function createLifecyclePool() {
    const state = { update: null, replyClear: null, escalationClose: null };
    return {
        state,
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/UPDATE tasks/i.test(text) && /source_type = \$1/i.test(text)) {
                state.escalationClose = {
                    sourceType: params[0],
                    sourceId: params[1],
                };
                return {
                    rows: [{
                        id: 9001,
                        source_type: params[0],
                        source_id: params[1],
                        status: 'cancelled',
                    }],
                };
            }
            if (/INSERT INTO task_logs/i.test(text)) {
                return { rows: [] };
            }
            if (/UPDATE conversations/i.test(text) && /reply_expected = false/i.test(text)) {
                state.replyClear = {
                    conversationId: params[0],
                    messageId: params[1],
                };
                return {
                    rows: [{
                        id: params[0],
                        channel: 'viber',
                        reply_expected: false,
                        awaiting_reply_since: null,
                        reply_expected_message_id: null,
                        reply_owner: null,
                        reply_owner_user_id: null,
                        reply_sla_at: null,
                    }],
                };
            }
            if (!/UPDATE conversation_messages cm/i.test(text) || !/provider_lifecycle_at/i.test(text)) {
                throw new Error(`Unexpected lifecycle query: ${text}`);
            }

            const mergedMeta = JSON.parse(params[3]);
            state.update = {
                channel: params[0],
                providerMessageId: params[1],
                deliveryStatus: params[2],
                meta: mergedMeta,
                providerLifecycleAt: params[4],
                providerLifecycleEvent: params[5],
                providerLifecycleSource: params[6],
                deliveryError: params[7],
            };

            return {
                rows: [{
                    id: 1201,
                    conversation_id: 501,
                    direction: 'outbound',
                    sender_name: 'Manager',
                    content: 'Hello',
                    content_type: 'text',
                    media_url: null,
                    external_message_id: null,
                    ai_generated: false,
                    read_at: null,
                    meta: mergedMeta,
                    provider_message_id: params[1],
                    delivery_status: params[2],
                    delivery_error: params[2] === 'later_failed' ? params[7] : null,
                    send_attempted_at: '2026-05-13T10:00:00.000Z',
                    provider_accepted_at: '2026-05-13T10:00:01.000Z',
                    failed_at: params[2] === 'later_failed' ? '2026-05-13T10:00:02.000Z' : null,
                    provider_lifecycle_at: params[4],
                    provider_lifecycle_event: params[5],
                    provider_lifecycle_source: params[6],
                    created_at: '2026-05-13T09:59:00.000Z',
                }],
            };
        },
    };
}

function loadOmniRouter(hubMock) {
    clearModules();
    installMock('../services/omni-hub', hubMock);
    installMock('../middleware/auth', { authenticateToken: (req, res, next) => next() });
    return require('../routes/omnichannel');
}

async function postJson(router, routePath, payload, headers = {}) {
    const app = express();
    app.use(express.json());
    app.use(router);

    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    try {
        const address = server.address();
        const res = await fetch(`http://127.0.0.1:${address.port}${routePath}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

describe('Provider Lifecycle v1 for Viber and TurboSMS', () => {
    afterEach(clearModules);

    it('classifies Viber lifecycle callbacks separately from inbound messages', () => {
        const normalizer = require('../services/omni-normalizer');

        const delivered = normalizer.classifyViberWebhook({
            event: 'delivered',
            message_token: 43,
            timestamp: 1778676000000,
        });
        assert.equal(delivered.type, 'delivery_receipt');
        assert.equal(delivered.receipt.deliveryStatus, 'delivered');
        assert.equal(delivered.receipt.providerMessageId, '43');

        const seen = normalizer.classifyViberWebhook({
            event: 'seen',
            message_token: 43,
            timestamp: 1778676000000,
        });
        assert.equal(seen.type, 'read_receipt');
        assert.equal(seen.receipt.deliveryStatus, 'read');

        const failed = normalizer.classifyViberWebhook({
            event: 'failed',
            message_token: 43,
            desc: 'No suitable device',
        });
        assert.equal(failed.type, 'delivery_receipt');
        assert.equal(failed.receipt.deliveryStatus, 'later_failed');
        assert.match(failed.receipt.deliveryError, /No suitable device/);

        const inbound = normalizer.classifyViberWebhook({
            event: 'message',
            sender: { id: 'viber-user-1', name: 'Guest' },
            message: { type: 'text', text: 'Hi' },
            message_token: 99,
        });
        assert.equal(inbound.type, 'inbound_message');
        assert.equal(inbound.normalized.channel, 'viber');
    });

    it('maps TurboSMS DLR terminal statuses without treating them as inbound SMS', () => {
        const normalizer = require('../services/omni-normalizer');

        const delivered = normalizer.classifySmsWebhook({
            message_id: 'sms-44',
            status: 'DELIVRD',
        });
        assert.equal(delivered.type, 'delivery_receipt');
        assert.equal(delivered.receipt.deliveryStatus, 'delivered');
        assert.equal(delivered.receipt.providerLifecycleEvent, 'DELIVRD');

        for (const status of ['UNDELIV', 'REJECTD', 'EXPIRED']) {
            const failed = normalizer.classifySmsWebhook({
                message_id: 'sms-44',
                status,
            });
            assert.equal(failed.type, 'delivery_receipt');
            assert.equal(failed.receipt.deliveryStatus, 'later_failed');
            assert.equal(failed.receipt.deliveryError, status);
        }

        const unsupported = normalizer.classifySmsWebhook({
            message_id: 'sms-44',
            status: 'ENROUTE',
        });
        assert.equal(unsupported.type, 'ignored');

        const inbound = normalizer.classifySmsWebhook({
            from: '+380501112233',
            text: 'Reply',
        });
        assert.equal(inbound.type, 'inbound_message');
        assert.equal(inbound.normalized.externalId, '+380501112233');
    });

    it('updates outbound lifecycle truth by provider reference', async () => {
        const pool = createLifecyclePool();
        const hub = loadHub(pool);

        const message = await hub.applyProviderLifecycleReceipt({
            channel: 'viber',
            providerMessageId: '43',
            deliveryStatus: 'read',
            providerLifecycleAt: '2026-05-13T10:00:02.000Z',
            providerLifecycleEvent: 'seen',
            providerLifecycleSource: 'viber_webhook',
        });

        assert.equal(pool.state.update.channel, 'viber');
        assert.equal(pool.state.update.providerMessageId, '43');
        assert.equal(pool.state.update.deliveryStatus, 'read');
        assert.equal(pool.state.update.meta.providerLifecycle.source, 'viber_webhook');
        assert.equal(message.deliveryStatus, 'read');
        assert.equal(message.providerLifecycleEvent, 'seen');
        assert.equal(message.sendTruth.status, 'provider_read');
        assert.equal(message.sendTruth.deliveryConfirmed, true);
        assert.equal(pool.state.replyClear, null);
    });

    it('clears active reply expectation when the expected outbound message later fails', async () => {
        const pool = createLifecyclePool();
        const hub = loadHub(pool);

        const message = await hub.applyProviderLifecycleReceipt({
            channel: 'viber',
            providerMessageId: '43',
            deliveryStatus: 'later_failed',
            deliveryError: 'No suitable device',
            providerLifecycleAt: '2026-05-13T10:00:02.000Z',
            providerLifecycleEvent: 'failed',
            providerLifecycleSource: 'viber_webhook',
        });

        assert.equal(message.deliveryStatus, 'later_failed');
        assert.deepEqual(pool.state.replyClear, {
            conversationId: 501,
            messageId: 1201,
        });
        assert.deepEqual(pool.state.escalationClose, {
            sourceType: 'conversation_reply',
            sourceId: '1201',
        });
    });

    it('contains unsupported provider lifecycle receipts', async () => {
        const pool = {
            query: async () => {
                throw new Error('unsupported provider receipt should not hit the database');
            },
        };
        const hub = loadHub(pool);

        const result = await hub.applyProviderLifecycleReceipt({
            channel: 'telegram',
            providerMessageId: '42',
            deliveryStatus: 'delivered',
        });

        assert.equal(result, null);
    });

    it('routes Viber receipts to lifecycle updater without creating inbound messages', async () => {
        const calls = { inbound: [], lifecycle: [] };
        const router = loadOmniRouter({
            processInboundMessage: async normalized => calls.inbound.push(normalized),
            applyProviderLifecycleReceipt: async receipt => calls.lifecycle.push(receipt),
        });

        const payloads = [
            { event: 'delivered', message_token: 43, timestamp: 1778676000000 },
            { event: 'seen', message_token: 43, timestamp: 1778676001000 },
            { event: 'failed', message_token: 44, desc: 'No suitable device' },
        ];

        for (const payload of payloads) {
            const res = await postJson(router, '/webhook/viber', payload);
            assert.equal(res.status, 200);
            assert.equal(res.body.status, 0);
        }

        assert.equal(calls.inbound.length, 0);
        assert.deepEqual(
            calls.lifecycle.map(receipt => receipt.deliveryStatus),
            ['delivered', 'read', 'later_failed']
        );
        assert.equal(calls.lifecycle[0].providerMessageId, '43');
        assert.equal(calls.lifecycle[2].providerMessageId, '44');
    });

    it('routes TurboSMS DLRs to lifecycle updater without creating inbound SMS messages', async () => {
        const calls = { inbound: [], lifecycle: [] };
        const router = loadOmniRouter({
            processInboundMessage: async normalized => calls.inbound.push(normalized),
            applyProviderLifecycleReceipt: async receipt => calls.lifecycle.push(receipt),
        });

        const res = await postJson(router, '/webhook/sms', [
            { message_id: 'sms-44', status: 'DELIVRD' },
            { message_id: 'sms-45', status: 'UNDELIV' },
        ]);

        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        assert.equal(calls.inbound.length, 0);
        assert.equal(calls.lifecycle.length, 2);
        assert.equal(calls.lifecycle[0].channel, 'sms');
        assert.equal(calls.lifecycle[0].deliveryStatus, 'delivered');
        assert.equal(calls.lifecycle[1].deliveryStatus, 'later_failed');
    });

    it('defines the additive provider lifecycle migration without lifecycle backfill', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/169_provider_lifecycle_v1.sql'),
            'utf8'
        );

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS provider_lifecycle_at/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS provider_lifecycle_event/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS provider_lifecycle_source/);
        assert.match(migration, /'delivered'/);
        assert.match(migration, /'read'/);
        assert.match(migration, /'later_failed'/);
        assert.doesNotMatch(migration, /UPDATE\s+conversation_messages/i);
    });
});
