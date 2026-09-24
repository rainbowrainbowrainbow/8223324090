const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    createOwnerDmSecureCredentialHandoff,
    handoffEnabled,
    resolveOwnerUserId
} = require('../services/hermesSecureCredentialHandoff');

test('owner DM secure credential handoff preflight resolves target without sending', async () => {
    const queries = [];
    const pool = {
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: [{ telegram_chat_id: '777000111' }] };
        }
    };
    const sent = [];
    const handoff = createOwnerDmSecureCredentialHandoff({
        env: { TELEGRAM_BOT_TOKEN: 'unit-token' },
        pool,
        telegramService: {
            TELEGRAM_BOT_TOKEN: 'unit-token',
            async sendTelegramMessage(...args) {
                sent.push(args);
                return { ok: true, result: { message_id: 1 } };
            }
        }
    });

    const preflight = await handoff.preflight();
    assert.equal(preflight.ready, true);
    assert.equal(preflight.channel, 'owner_dm');
    assert.equal(preflight.target, 'owner_dm');
    assert.equal(preflight.meta.ownerUserId, 4);
    assert.equal(preflight.meta.credentialIssued, false);
    assert.equal(preflight.meta.credentialMaterialReturnedInHermesResponse, false);
    assert.equal(queries.length, 1);
    assert.equal(sent.length, 0);
});

test('owner DM secure credential handoff sends only through injected Telegram sink', async () => {
    const sent = [];
    const handoff = createOwnerDmSecureCredentialHandoff({
        env: {
            TELEGRAM_BOT_TOKEN: 'unit-token',
            HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_OWNER_CHAT_ID: '777000111'
        },
        pool: {
            async query() {
                throw new Error('env chat id should avoid DB lookup');
            }
        },
        telegramService: {
            TELEGRAM_BOT_TOKEN: 'unit-token',
            async sendTelegramMessage(chatId, text, options) {
                sent.push({ chatId, text, options });
                return { ok: true, result: { message_id: 42 } };
            }
        }
    });

    const result = await handoff({
        credential: {
            username: 'worker.login',
            password: 'ONE_TIME_PASSWORD'
        },
        request: {
            requestId: 'request-1',
            requestType: 'existing_staff_reissue_existing_account'
        }
    });

    assert.equal(result.delivered, true);
    assert.equal(result.channel, 'owner_dm');
    assert.equal(result.target, 'owner_dm');
    assert.equal(result.meta.telegramMessageId, 42);
    assert.equal(result.meta.credentialMaterialReturnedInHermesResponse, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, '777000111');
    assert.match(sent[0].text, /worker\.login/);
    assert.match(sent[0].text, /ONE_TIME_PASSWORD/);
    assert.equal(sent[0].options.skipThread, true);
    assert.equal(sent[0].options.businessContext, 'event_genix');
});

test('default handoff enablement stays explicit and can be disabled', () => {
    assert.equal(handoffEnabled({}), false);
    assert.equal(handoffEnabled({ TELEGRAM_BOT_TOKEN: 'unit-token' }), false);
    assert.equal(handoffEnabled({ TELEGRAM_BOT_TOKEN: 'unit-token', EVENT_GENIX_CRM_AGENT_OWNER_USER_ID: '4' }), true);
    assert.equal(handoffEnabled({
        TELEGRAM_BOT_TOKEN: 'unit-token',
        HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_MODE: 'disabled'
    }), false);
    assert.equal(handoffEnabled({
        HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_MODE: 'owner_dm'
    }), true);
    assert.equal(resolveOwnerUserId({}), 4);
    assert.equal(resolveOwnerUserId({ EVENT_GENIX_CRM_AGENT_OWNER_USER_ID: '9' }), 9);
});
