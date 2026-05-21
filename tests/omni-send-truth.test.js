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
        '../services/omni-accounts',
        '../services/omni-sms-providers',
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
        replyExpectationUpdates: [],
        connectionStatusQueries: []
    };
    const client = {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/SELECT reply_expected_message_id FROM conversations/i.test(text)) {
                return { rows: [] };
            }
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
            if (/FROM omni_provider_connections WHERE channel = \$1/i.test(text)) {
                const channel = String(params[0] || conversation.channel || 'telegram');
                state.connectionStatusQueries.push(channel);
                return {
                    rows: [{
                        channel,
                        provider_kind: channel === 'binotel' ? 'telephony' : 'bot',
                        status: channel === 'binotel' ? 'history_only' : 'connected',
                        credentials: {},
                        account_display_name: channel,
                        masked_identifier: channel,
                        send_enabled: channel !== 'binotel',
                        receive_enabled: true,
                        warning: null,
                        last_checked_at: '2099-05-13T09:59:00Z',
                        last_changed_at: '2099-05-13T09:58:00Z',
                        changed_by: 'Test Manager',
                        last_test_at: null,
                        last_test_status: null,
                        last_test_message: null
                    }]
                };
            }
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
                    ownerUserId: params[3],
                    slaAt: params[4]
                };
                state.replyExpectationUpdates.push(update);
                return {
                    rows: [{
                        ...conversation,
                        reply_expected: true,
                        awaiting_reply_since: '2099-05-13T10:00:04Z',
                        reply_expected_message_id: update.messageId,
                        reply_owner: update.owner,
                        reply_owner_user_id: update.ownerUserId,
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
            if (/SELECT reply_expected_message_id FROM conversations/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO conversation_messages/i.test(text)) {
                return { rows: [{ ...inserted, sender_name: params[1], content: params[2] }] };
            }
            if (/UPDATE conversations/i.test(text) && /last_inbound_at = NOW\(\)/i.test(text)) {
                state.inboundUpdateSeen = true;
                state.replyClearSeen = /reply_expected/i.test(text)
                    && /awaiting_reply_since/i.test(text)
                    && /reply_owner_user_id/i.test(text);
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

    it('surfaces Omni account connectivity truth and disconnected alerts', () => {
        const previous = {
            TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
            VIBER_TOKEN: process.env.VIBER_TOKEN,
            TURBOSMS_TOKEN: process.env.TURBOSMS_TOKEN,
            FLYSMS_API_KEY: process.env.FLYSMS_API_KEY,
            SMS_FLY_API_KEY: process.env.SMS_FLY_API_KEY,
            SMSFLY_API_KEY: process.env.SMSFLY_API_KEY,
            FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN,
            IG_PAGE_TOKEN: process.env.IG_PAGE_TOKEN,
            BINOTEL_WEBHOOK_SECRET: process.env.BINOTEL_WEBHOOK_SECRET,
        };
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.VIBER_TOKEN;
        delete process.env.FLYSMS_API_KEY;
        delete process.env.SMS_FLY_API_KEY;
        delete process.env.SMSFLY_API_KEY;
        process.env.TURBOSMS_TOKEN = 'sms-token';
        delete process.env.FB_PAGE_TOKEN;
        delete process.env.IG_PAGE_TOKEN;
        process.env.BINOTEL_WEBHOOK_SECRET = 'binotel-secret';
        clearModules();
        const accounts = require('../services/omni-accounts');

        try {
            const statuses = accounts.getOmniAccountStatuses({ now: new Date('2099-05-15T10:00:00Z') });
            const sms = statuses.find(acc => acc.channel === 'sms');
            const telegram = statuses.find(acc => acc.channel === 'telegram');
            const binotel = statuses.find(acc => acc.channel === 'binotel');
            assert.equal(sms.status, 'connected');
            assert.equal(sms.sendCapable, true);
            assert.equal(telegram.status, 'disconnected');
            assert.equal(telegram.sendCapable, false);
            assert.equal(binotel.status, 'history_only');
            assert.equal(binotel.sendCapable, false);

            const alerts = accounts.getOmniAccountAlerts({ now: new Date('2099-05-15T10:00:00Z') });
            assert.ok(alerts.some(alert => alert.id === 'omni_telegram_disconnected'));
            assert.ok(alerts.some(alert => alert.id === 'omni_binotel_history_only'));
            assert.ok(alerts.every(alert => alert.source === 'omni_accounts'));
        } finally {
            Object.entries(previous).forEach(([key, value]) => {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            });
            clearModules();
        }
    });

    it('exposes SMS as a provider-selectable channel with FlySMS default and TurboSMS compatibility', () => {
        const previous = {
            TURBOSMS_TOKEN: process.env.TURBOSMS_TOKEN,
            TURBOSMS_SENDER: process.env.TURBOSMS_SENDER,
            FLYSMS_API_KEY: process.env.FLYSMS_API_KEY,
            SMS_FLY_API_KEY: process.env.SMS_FLY_API_KEY,
            SMSFLY_API_KEY: process.env.SMSFLY_API_KEY,
            FLYSMS_SENDER: process.env.FLYSMS_SENDER,
            SMS_FLY_SENDER: process.env.SMS_FLY_SENDER,
            SMSFLY_SENDER: process.env.SMSFLY_SENDER,
        };
        Object.keys(previous).forEach(key => delete process.env[key]);

        try {
            clearModules();
            let accounts = require('../services/omni-accounts');
            let sms = accounts.getOmniAccountStatuses({ now: new Date('2099-05-15T10:00:00Z') })
                .find(acc => acc.channel === 'sms');
            assert.equal(sms.provider, 'flysms');
            assert.equal(sms.providerLabel, 'FlySMS');
            assert.deepEqual(sms.providerOptions.map(option => option.value), ['turbosms', 'flysms']);
            assert.ok(sms.setupFields.some(field => field.name === 'apiKey' && /FlySMS/.test(field.label)));
            assert.ok(!sms.setupFields.some(field => field.label === 'TurboSMS token'));

            clearModules();
            process.env.TURBOSMS_TOKEN = 'legacy-turbosms-token';
            accounts = require('../services/omni-accounts');
            sms = accounts.getOmniAccountStatuses({ now: new Date('2099-05-15T10:00:00Z') })
                .find(acc => acc.channel === 'sms');
            assert.equal(sms.provider, 'turbosms');
            assert.equal(sms.providerLabel, 'TurboSMS');
            assert.ok(sms.setupFields.some(field => field.name === 'token' && field.label === 'TurboSMS token'));
        } finally {
            Object.entries(previous).forEach(([key, value]) => {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            });
            clearModules();
        }
    });

    it('separates Telegram inbox readiness from the report bot binding', () => {
        const previous = {
            TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
            TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
            REPORT_BOT_TOKEN: process.env.REPORT_BOT_TOKEN,
            REPORT_BOT_USERNAME: process.env.REPORT_BOT_USERNAME,
        };
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_BOT_USERNAME;
        process.env.REPORT_BOT_TOKEN = '123456:abcdefghijklmnopqrstuvwxyz';
        process.env.REPORT_BOT_USERNAME = '@eventgenix_report_bot';
        clearModules();
        const accounts = require('../services/omni-accounts');

        try {
            const statuses = accounts.getOmniAccountStatuses({ now: new Date('2099-05-15T10:00:00Z') });
            const telegram = statuses.find(acc => acc.channel === 'telegram');
            const reportBot = statuses.find(acc => acc.channel === 'report_bot');
            assert.equal(telegram.provider, 'telegram');
            assert.equal(telegram.purpose, 'inbox');
            assert.equal(telegram.connected, false);
            assert.equal(telegram.sendCapable, false);
            assert.equal(reportBot.provider, 'telegram');
            assert.equal(reportBot.purpose, 'reports');
            assert.equal(reportBot.connected, true);
            assert.equal(reportBot.sendCapable, true);
        } finally {
            Object.entries(previous).forEach(([key, value]) => {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            });
            clearModules();
        }
    });

    it('treats needs_rebind Telegram inbox rows as disconnected and non-send-capable', async () => {
        clearModules();
        installMock('../db', {
            pool: {
                query: async (sql, params = []) => {
                    const text = String(sql).replace(/\s+/g, ' ').trim();
                    if (/FROM omni_provider_connections WHERE channel = \$1/i.test(text)) {
                        assert.equal(params[0], 'telegram');
                        return {
                            rows: [{
                                channel: 'telegram',
                                provider: 'telegram',
                                purpose: 'inbox',
                                provider_kind: 'bot',
                                status: 'needs_rebind',
                                credentials: {
                                    values: { botUsername: '@old_report_bot' },
                                    secrets: { apiKey: 'masked' },
                                    masks: {},
                                },
                                account_display_name: 'Old report bot',
                                masked_identifier: '@old_report_bot',
                                send_enabled: false,
                                receive_enabled: false,
                                warning: 'Legacy Telegram row looked like a report/alerts bot.',
                                last_checked_at: '2099-05-15T09:00:00Z',
                                last_changed_at: '2099-05-15T09:00:00Z',
                                changed_by: 'legacy repair',
                                last_test_at: null,
                                last_test_status: null,
                                last_test_message: null,
                            }],
                        };
                    }
                    throw new Error(`Unexpected query: ${text}`);
                },
            },
        });
        const accounts = require('../services/omni-accounts');
        const telegram = await accounts.getOmniAccountStatusAsync('telegram', { now: new Date('2099-05-15T10:00:00Z') });

        assert.equal(telegram.status, 'needs_rebind');
        assert.equal(telegram.connected, false);
        assert.equal(telegram.sendCapable, false);
        assert.equal(telegram.receiveCapable, false);
        assert.ok(telegram.supportedActions.includes('connect'));
        assert.ok(telegram.supportedActions.includes('disconnect'));
        clearModules();
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
            replyOwnerUserId: 501,
            replySlaAt: '2099-05-14T10:00:00.000Z'
        });

        assert.equal(pool.state.replyExpectationUpdates.length, 1);
        assert.deepEqual(pool.state.replyExpectationUpdates[0], {
            conversationId: 916,
            messageId: 777,
            owner: 'Manager User',
            ownerUserId: 501,
            slaAt: '2099-05-14T10:00:00.000Z'
        });
        assert.equal(result.conversation.replyExpected, true);
        assert.equal(result.conversation.waitingReply, true);
        assert.equal(result.conversation.replyOwner, 'Manager User');
        assert.equal(result.conversation.replyOwnerUserId, 501);
        assert.equal(result.conversation.replySlaState, 'on_track');
        assert.equal(result.replyExpectation.expected, true);
        assert.equal(result.replyExpectation.owner, 'Manager User');
        assert.equal(result.replyExpectation.ownerUserId, 501);
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

    it('defines typed reply owner migration without historical backfill', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/172_reply_owner_typing_v1.sql'),
            'utf8'
        );

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS reply_owner_user_id INTEGER REFERENCES users\(id\) ON DELETE SET NULL/);
        assert.match(migration, /idx_conversations_reply_owner_user_waiting/);
        assert.match(migration, /WHERE reply_expected IS TRUE/);
        assert.doesNotMatch(migration, /UPDATE\s+conversations/i);
        assert.doesNotMatch(migration, /ALTER TABLE tasks/i);
    });

    it('wires Omni UI for disabled channels and truthful send feedback', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const omniHtml = fs.readFileSync(path.join(repoRoot, 'omni.html'), 'utf8');
        const omniRoute = fs.readFileSync(path.join(repoRoot, 'routes/omnichannel.js'), 'utf8');

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
        assert.match(omniRoute, /replyOwnerUserId = req\.user\?\.id \|\| null/);
        assert.match(omniRoute, /replyOwnerUserId,/);
        assert.match(omniHtml, /Провайдер прийняв запит/);
    });

    it('defines the manual connection control-plane persistence surface', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/181_omni_provider_connections.sql'),
            'utf8'
        );
        const telegramPurposeMigration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/202_omni_telegram_binding_purpose.sql'),
            'utf8'
        );
        const accountsService = fs.readFileSync(path.join(repoRoot, 'services/omni-accounts.js'), 'utf8');
        const omniRoute = fs.readFileSync(path.join(repoRoot, 'routes/omnichannel.js'), 'utf8');

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /CREATE TABLE IF NOT EXISTS omni_provider_connections/);
        assert.match(migration, /credentials JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
        assert.match(migration, /changed_by_user_id INTEGER REFERENCES users\(id\)/);
        assert.match(migration, /last_test_status/);
        assert.match(telegramPurposeMigration, /ADD COLUMN IF NOT EXISTS provider/);
        assert.match(telegramPurposeMigration, /ADD COLUMN IF NOT EXISTS purpose/);
        assert.match(telegramPurposeMigration, /needs_rebind/);
        assert.match(telegramPurposeMigration, /report_bot/);
        assert.match(accountsService, /encryptSecret/);
        assert.match(accountsService, /SECRET_PREFIX/);
        assert.match(accountsService, /setupFieldsForClient/);
        assert.match(accountsService, /resolveOmniRuntimeConfig/);
        assert.match(accountsService, /report_bot/);
        assert.match(accountsService, /repairTelegramLegacyBindings/);
        assert.match(accountsService, /purposeLabel/);
        assert.match(omniRoute, /requireMinRole\('manager'\)/);
        assert.match(omniRoute, /\/accounts\/:channel\/test/);
        assert.match(omniRoute, /\/accounts\/:channel\/disconnect/);
        assert.match(omniRoute, /\/accounts\/telegram\/inbox\/test/);
        assert.match(omniRoute, /\/accounts\/telegram\/inbox\/disconnect/);
        assert.match(omniRoute, /auditConnectionAction\(req, 'disconnect'/);
    });

    it('wires the human-friendly connection center UX', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const omniHtml = fs.readFileSync(path.join(repoRoot, 'omni.html'), 'utf8');

        assert.match(omniHtml, /id="omniAccountSummary"/);
        assert.match(omniHtml, /id="omniConnectionModal"/);
        assert.match(omniHtml, /openConnectModal/);
        assert.match(omniHtml, /openDisconnectModal/);
        assert.match(omniHtml, /collectConnectionFields/);
        assert.match(omniHtml, /id="conn_sms_provider"/);
        assert.match(omniHtml, /data-provider-selector="sms"/);
        assert.match(omniHtml, /providerOptionsForAccount/);
        assert.match(omniHtml, /providerLabel/);
        assert.match(omniHtml, /Telegram inbox/);
        assert.match(omniHtml, /Бот звітів/);
        assert.match(omniHtml, /accountPurposeNote/);
        assert.match(omniHtml, /data-account-action="test"/);
        assert.match(omniHtml, /data-account-action="disconnect"/);
        assert.match(omniHtml, /Відправка заблокована/);
        assert.match(omniHtml, /Наслідки відключення/);
        assert.match(omniHtml, /Порядок підключення/);
    });
});
