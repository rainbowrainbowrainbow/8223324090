const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/omni-hub',
        '../services/kleshnya-chat',
        '../services/websocket',
        '../services/telegram',
        '../services/omni-viber',
        '../services/omni-sms',
        '../services/omni-facebook',
        '../services/omni-instagram'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function loadHub(pool, providerMocks = {}) {
    clearModules();
    installMock('../db', { pool: pool || { query: async () => ({ rows: [] }) } });
    installMock('../services/kleshnya-chat', { generateChatResponse: async () => '' });
    installMock('../services/websocket', { getWSS: () => ({ clients: [] }) });
    installMock('../services/telegram', { sendTelegramMessage: providerMocks.sendTelegramMessage || (async () => ({ ok: true, result: { message_id: 42 } })) });
    installMock('../services/omni-viber', { sendViber: providerMocks.sendViber || (async () => ({ success: true, messageToken: 43 })) });
    installMock('../services/omni-sms', { sendSMS: providerMocks.sendSMS || (async () => ({ success: true, messageId: 'sms-44' })) });
    installMock('../services/omni-facebook', { sendFacebook: providerMocks.sendFacebook || (async () => ({ success: true, messageId: 'fb-45' })) });
    installMock('../services/omni-instagram', { sendInstagram: providerMocks.sendInstagram || (async () => ({ success: true, messageId: 'ig-46' })) });
    return require('../services/omni-hub');
}

function createManualSendPool(conversation) {
    const inserted = {
        id: 777,
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_name: 'Manager',
        content: 'Привіт',
        content_type: 'text',
        ai_generated: false,
        meta: {},
        provider_message_id: null,
        delivery_status: null,
        delivery_error: null,
        send_attempted_at: null,
        provider_accepted_at: null,
        failed_at: null,
        created_at: '2099-05-13T10:00:00Z'
    };
    const state = {
        connectCalled: false,
        savedTruth: null,
        deliveryUpdates: [],
        conversationUpdates: [],
        replyExpectationUpdates: []
    };
    const client = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/INSERT INTO conversation_messages/i.test(text)) {
                return { rows: [{ ...inserted, sender_name: params[1], content: params[2] }] };
            }
            if (/UPDATE conversations/i.test(text) && /last_outbound_at = NOW\(\)/i.test(text)) {
                state.conversationUpdates.push(text);
                return { rows: [] };
            }
            throw new Error(`Unexpected client query: ${text}`);
        },
        release: () => {}
    };

    return {
        state,
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/SELECT \* FROM conversations WHERE id = \$1/i.test(text)) {
                return { rows: [conversation] };
            }
            if (/UPDATE conversation_messages/i.test(text) && /delivery_status/i.test(text)) {
                const sendTruth = JSON.parse(params[1]).sendTruth;
                const update = {
                    sendTruth,
                    providerMessageId: params[2],
                    deliveryStatus: params[3],
                    deliveryError: params[4],
                    sendAttempted: params[5],
                    providerAccepted: params[6],
                    failed: params[7]
                };
                state.savedTruth = sendTruth;
                state.deliveryUpdates.push(update);
                return {
                    rows: [{
                        ...inserted,
                        meta: { sendTruth },
                        provider_message_id: update.providerMessageId,
                        delivery_status: update.deliveryStatus,
                        delivery_error: update.deliveryError,
                        send_attempted_at: update.sendAttempted ? '2099-05-13T10:00:01Z' : null,
                        provider_accepted_at: update.providerAccepted ? '2099-05-13T10:00:02Z' : null,
                        failed_at: update.failed ? '2099-05-13T10:00:03Z' : null
                    }]
                };
            }
            if (/UPDATE conversations/i.test(text) && /reply_expected = true/i.test(text)) {
                const update = {
                    conversationId: params[0],
                    messageId: params[1],
                    owner: params[2],
                    slaAt: params[3]
                };
                state.replyExpectationUpdates.push(update);
                return {
                    rows: [{
                        ...conversation,
                        reply_expected: true,
                        awaiting_reply_since: '2099-05-13T10:00:04Z',
                        reply_expected_message_id: update.messageId,
                        reply_owner: update.owner,
                        reply_sla_at: update.slaAt,
                        last_inbound_at: conversation.last_inbound_at || null
                    }]
                };
            }
            throw new Error(`Unexpected pool query: ${text}`);
        },
        connect: async () => {
            state.connectCalled = true;
            return client;
        }
    };
}

function createInboundPool() {
    const inserted = {
        id: 778,
        conversation_id: 901,
        direction: 'inbound',
        sender_name: 'Guest',
        content: 'Hello',
        content_type: 'text',
        media_url: null,
        external_message_id: 'in-1',
        ai_generated: false,
        read_at: null,
        meta: {},
        provider_message_id: null,
        delivery_status: null,
        delivery_error: null,
        send_attempted_at: null,
        provider_accepted_at: null,
        failed_at: null,
        created_at: '2099-05-13T10:00:00Z'
    };
    const state = { inboundUpdateSeen: false, replyClearSeen: false };
    const client = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/INSERT INTO conversation_messages/i.test(text)) {
                return { rows: [{ ...inserted, sender_name: params[1], content: params[2] }] };
            }
            if (/UPDATE conversations/i.test(text) && /last_inbound_at = NOW\(\)/i.test(text)) {
                state.inboundUpdateSeen = true;
                state.replyClearSeen = /reply_expected/i.test(text) && /awaiting_reply_since/i.test(text);
                return { rows: [] };
            }
            throw new Error(`Unexpected inbound client query: ${text}`);
        },
        release: () => {}
    };

    return {
        state,
        query: async () => ({ rows: [] }),
        connect: async () => client
    };
}

describe('Communication Send Truth v1', () => {
    afterEach(clearModules);

    it('normalizes Telegram ok=false as immediate provider failure', () => {
        const hub = loadHub();
        const failed = hub.normalizeProviderResult('telegram', { ok: false, description: 'No bot token configured' });
        assert.equal(failed.status, 'provider_failed_immediate');
        assert.equal(failed.providerAttempted, true);
        assert.equal(failed.providerAccepted, false);
        assert.match(failed.error, /No bot token configured/);

        const accepted = hub.normalizeProviderResult('telegram', { ok: true, result: { message_id: 42 } });
        assert.equal(accepted.status, 'provider_attempted');
        assert.equal(accepted.providerAccepted, true);
        assert.equal(accepted.providerReference, 42);
        assert.equal(accepted.deliveryConfirmed, false);
    });

    it('blocks inbound-only conversations before persisting outbound rows', async () => {
        const pool = createManualSendPool({
            id: 903,
            channel: 'binotel',
            external_id: '+380000000001',
            customer_name: 'Phone Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool);

        await assert.rejects(
            () => hub.sendManualMessage(903, 'Привіт', 'Manager'),
            err => err.code === 'CHANNEL_UNAVAILABLE' && err.sendTruth?.status === 'channel_unavailable'
        );
        assert.equal(pool.state.connectCalled, false);
    });

    it('maintains durable last inbound timestamp when inbound messages are saved', async () => {
        const pool = createInboundPool();
        const hub = loadHub(pool);

        const message = await hub.saveInboundMessage(901, {
            senderName: 'Guest',
            content: 'Hello',
            contentType: 'text',
            externalMessageId: 'in-1',
            meta: { source: 'test' }
        });

        assert.equal(message.direction, 'inbound');
        assert.equal(message.deliveryStatus, null);
        assert.equal(pool.state.inboundUpdateSeen, true);
        assert.equal(pool.state.replyClearSeen, true);
    });

    it('persists send truth in message meta and durable fields after immediate provider failure', async () => {
        const pool = createManualSendPool({
            id: 904,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({ ok: false, description: 'No bot token configured' })
        });

        const result = await hub.sendManualMessage(904, 'Привіт', 'Manager');
        assert.equal(result.sendTruth.status, 'provider_failed_immediate');
        assert.equal(result.message.meta.sendTruth.status, 'provider_failed_immediate');
        assert.equal(result.message.deliveryStatus, 'failed');
        assert.match(result.message.deliveryError, /No bot token configured/);
        assert.equal(pool.state.savedTruth.providerAccepted, false);
        assert.deepEqual(
            pool.state.deliveryUpdates.map(update => update.deliveryStatus),
            ['saved', 'attempted', 'failed']
        );
        assert.equal(pool.state.deliveryUpdates.at(-1).failed, true);
        assert.equal(pool.state.conversationUpdates.length, 1);
    });

    it('persists provider references and accepted immediate status without claiming final delivery', async () => {
        const pool = createManualSendPool({
            id: 905,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({ ok: true, result: { message_id: 42 } })
        });

        const result = await hub.sendManualMessage(905, 'Привіт', 'Manager');
        assert.equal(result.sendTruth.status, 'provider_attempted');
        assert.equal(result.sendTruth.deliveryConfirmed, false);
        assert.equal(result.message.deliveryStatus, 'accepted');
        assert.equal(result.message.providerMessageId, '42');
        assert.equal(result.message.providerAcceptedAt, '2099-05-13T10:00:02Z');
        assert.deepEqual(
            pool.state.deliveryUpdates.map(update => update.deliveryStatus),
            ['saved', 'attempted', 'accepted']
        );
    });

    it('does not set reply expectation on ordinary outbound sends', async () => {
        const pool = createManualSendPool({
            id: 915,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({ ok: true, result: { message_id: 42 } })
        });

        await hub.sendManualMessage(915, 'Привіт', 'Manager');

        assert.equal(pool.state.replyExpectationUpdates.length, 0);
    });

    it('sets explicit reply expectation only when requested and delivery did not fail immediately', async () => {
        const pool = createManualSendPool({
            id: 916,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({ ok: true, result: { message_id: 42 } })
        });

        const result = await hub.sendManualMessage(916, 'Привіт', 'Manager', {
            replyExpected: true,
            replyOwner: 'Manager User',
            replySlaAt: '2099-05-14T10:00:00.000Z'
        });

        assert.equal(pool.state.replyExpectationUpdates.length, 1);
        assert.deepEqual(pool.state.replyExpectationUpdates[0], {
            conversationId: 916,
            messageId: 777,
            owner: 'Manager User',
            slaAt: '2099-05-14T10:00:00.000Z'
        });
        assert.equal(result.conversation.replyExpected, true);
        assert.equal(result.conversation.waitingReply, true);
        assert.equal(result.conversation.replySlaState, 'on_track');
        assert.equal(result.replyExpectation.expected, true);
        assert.equal(result.replyExpectation.slaState, 'on_track');
    });

    it('does not leave waiting_reply active when immediate delivery fails', async () => {
        const pool = createManualSendPool({
            id: 917,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({ ok: false, description: 'No bot token configured' })
        });

        const result = await hub.sendManualMessage(917, 'Привіт', 'Manager', {
            replyExpected: true,
            replyOwner: 'Manager User'
        });

        assert.equal(result.message.deliveryStatus, 'failed');
        assert.equal(pool.state.replyExpectationUpdates.length, 0);
    });

    it('persists unknown immediate provider result conservatively', async () => {
        const pool = createManualSendPool({
            id: 906,
            channel: 'telegram',
            external_id: '12345',
            customer_name: 'Telegram Lead',
            status: 'open',
            meta: {}
        });
        const hub = loadHub(pool, {
            sendTelegramMessage: async () => ({})
        });

        const result = await hub.sendManualMessage(906, 'Привіт', 'Manager');
        assert.equal(result.sendTruth.status, 'provider_unknown');
        assert.equal(result.message.deliveryStatus, 'unknown');
        assert.equal(result.message.providerAcceptedAt, null);
        assert.equal(result.message.failedAt, null);
        assert.deepEqual(
            pool.state.deliveryUpdates.map(update => update.deliveryStatus),
            ['saved', 'attempted', 'unknown']
        );
    });

    it('maps durable delivery fields safely when legacy meta is absent', () => {
        const hub = loadHub();
        const mapped = hub.mapMessageRow({
            id: 907,
            conversation_id: 901,
            direction: 'outbound',
            sender_name: 'Manager',
            content: 'Hello',
            content_type: 'text',
            media_url: null,
            external_message_id: null,
            ai_generated: false,
            read_at: null,
            meta: {},
            provider_message_id: 'provider-42',
            delivery_status: 'accepted',
            delivery_error: null,
            send_attempted_at: '2099-05-13T10:00:01Z',
            provider_accepted_at: '2099-05-13T10:00:02Z',
            failed_at: null,
            created_at: '2099-05-13T10:00:00Z'
        });

        assert.equal(mapped.deliveryStatus, 'accepted');
        assert.equal(mapped.providerMessageId, 'provider-42');
        assert.equal(mapped.sendTruth.status, 'provider_attempted');
        assert.equal(mapped.meta.sendTruth.providerReference, 'provider-42');
    });

    it('defines the additive durable communication truth migration', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/168_durable_communication_truth_schema.sql'),
            'utf8'
        );

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS provider_message_id/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS delivery_status/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS send_attempted_at/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS last_inbound_at/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS last_outbound_at/);
        assert.match(migration, /delivery_status IN \('saved', 'attempted', 'accepted', 'failed', 'unknown'\)/);
        assert.doesNotMatch(migration, /awaiting_reply_since/);
        assert.doesNotMatch(migration, /reply_expected/);
    });

    it('defines the additive canonical reply expectation migration without backfill', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/170_canonical_reply_expectation_v1.sql'),
            'utf8'
        );

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS reply_expected BOOLEAN NOT NULL DEFAULT false/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS awaiting_reply_since/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS reply_expected_message_id/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS reply_owner/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS reply_sla_at/);
        assert.match(migration, /idx_conversations_reply_waiting/);
        assert.doesNotMatch(migration, /UPDATE\s+conversations/i);
    });

    it('wires Omni UI for disabled channels and truthful send feedback', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const omniHtml = fs.readFileSync(path.join(repoRoot, 'omni.html'), 'utf8');

        assert.match(omniHtml, /id="omniSendTruth"/);
        assert.match(omniHtml, /SEND_DISABLED_CHANNELS = new Set\(\['binotel'\]\)/);
        assert.match(omniHtml, /sendTruthFromDurableStatus/);
        assert.match(omniHtml, /renderSendTruthState/);
        assert.match(omniHtml, /id="omniReplyExpected"/);
        assert.match(omniHtml, /reply_expected: !!\(replyExpectedEl && replyExpectedEl\.checked\)/);
        assert.match(omniHtml, /replyWaitingBadge/);
        assert.match(omniHtml, /omni-conv-waiting/);
        assert.match(omniHtml, /omni-reply-state/);
        assert.match(omniHtml, /channel_unavailable/);
        assert.match(omniHtml, /Провайдер прийняв запит/);
    });
});
