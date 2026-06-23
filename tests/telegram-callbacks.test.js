const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function installModuleMock(modulePath, exports) {
    const resolved = require.resolve(modulePath);
    const original = require.cache[resolved];
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        children: [],
        paths: module.paths,
        exports
    };
    return () => {
        if (original) require.cache[resolved] = original;
        else delete require.cache[resolved];
    };
}

function installTelegramMock() {
    const calls = [];
    const behavior = {
        telegramRequest: async (method, body) => {
            calls.push({ method, body });
            return { ok: true, result: method === 'sendMessage' ? { message_id: 9001 } : true };
        },
        sendTelegramMessage: async (chatId, text, options) => {
            calls.push({ method: 'sendTelegramMessage', body: { chatId, text, options } });
            return { ok: true };
        },
        getConfiguredChatId: async () => null,
        getConfiguredThreadId: async () => null,
        getTelegramChatId: async () => [],
        ensureWebhook: async () => ({ ok: true })
    };
    const restore = installModuleMock('../services/telegram', {
        TELEGRAM_BOT_TOKEN: 'unit-token',
        WEBHOOK_SECRET: 'unit-secret',
        telegramRequest: (...args) => behavior.telegramRequest(...args),
        sendTelegramMessage: (...args) => behavior.sendTelegramMessage(...args),
        getConfiguredChatId: (...args) => behavior.getConfiguredChatId(...args),
        getConfiguredThreadId: (...args) => behavior.getConfiguredThreadId(...args),
        getTelegramChatId: (...args) => behavior.getTelegramChatId(...args),
        ensureWebhook: (...args) => behavior.ensureWebhook(...args)
    });
    return { calls, behavior, restore };
}

function installDbMock() {
    const db = require('../db');
    const originalQuery = db.pool.query;
    const state = {
        animators: new Map([[1, { status: 'pending', date: '2099-01-01' }]]),
        lineInserts: 0,
        tasks: new Map([[77, 'todo']]),
        trainingInputs: new Map([[5, {
            id: 5,
            status: 'pending',
            content: 'New guest greeting standard',
            staff_id: 10,
            staff_name: 'Trainer',
            week_number: 20,
            year: 2026
        }]]),
        trainingMaterialInserts: 0,
        reviews: new Set(),
        reviewInserts: 0,
        bookings: new Map([
            ['123', { id: '123', business_context: 'event_genix', customer_id: 42, customer_name: 'Customer DB' }],
            ['124', { id: '124', business_context: 'event_genix', customer_id: 43, customer_name: 'Promoter DB' }]
        ]),
        npsReviews: new Set(),
        npsInserts: 0,
        bookingNpsScores: new Map(),
        pulseInserts: 0,
        orders: new Map([[9, 'pending']]),
        orderLookups: 0,
        orderSent: 0
    };

    db.pool.query = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ');

        if (/telegram_known_chats|telegram_known_threads/i.test(text)) {
            return { rows: [], rowCount: 1 };
        }

        if (/SELECT value FROM settings WHERE key/i.test(text)) {
            return { rows: [], rowCount: 0 };
        }

        if (/INSERT INTO pending_animators/i.test(text)) {
            const nextId = Math.max(...state.animators.keys()) + 1;
            state.animators.set(nextId, { status: 'pending', date: params[0], note: params[1] || null });
            return { rows: [{ id: nextId }], rowCount: 1 };
        }

        if (/UPDATE pending_animators SET status/i.test(text)) {
            const [newStatus, id, expected] = params;
            const row = state.animators.get(id);
            if (row?.status === expected) {
                row.status = newStatus;
                return { rows: [{ id, status: newStatus, date: row.date }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM lines_by_date/i.test(text)) {
            return { rows: [] };
        }
        if (/SELECT name FROM lines_by_date/i.test(text)) {
            return { rows: [{ name: 'Аніматор 1' }, { name: 'Аніматор 2' }] };
        }
        if (/INSERT INTO lines_by_date/i.test(text)) {
            state.lineInserts += 1;
            return { rows: [], rowCount: 1 };
        }

        if (/SELECT status FROM tasks WHERE id = \$1/i.test(text)) {
            const status = state.tasks.get(params[0]);
            return { rows: status ? [{ status }] : [], rowCount: status ? 1 : 0 };
        }
        if (/UPDATE tasks SET status = 'cancelled'/i.test(text)) {
            const taskId = params[0];
            const expected = params[1] || null;
            const status = state.tasks.get(taskId);
            const allowed = expected ? status === expected : ['todo', 'in_progress'].includes(status);
            if (!allowed) return { rows: [], rowCount: 0 };
            state.tasks.set(taskId, 'cancelled');
            return { rows: [{ id: taskId }], rowCount: 1 };
        }

        if (/UPDATE staff_training_inputs/i.test(text)) {
            const [newStatus, inputId] = params;
            const input = state.trainingInputs.get(inputId);
            if (!input || input.status !== 'pending') return { rows: [], rowCount: 0 };
            input.status = newStatus;
            return { rows: [{ ...input }], rowCount: 1 };
        }
        if (/INSERT INTO training_materials/i.test(text)) {
            state.trainingMaterialInserts += 1;
            return { rows: [{ id: state.trainingMaterialInserts }], rowCount: 1 };
        }

        if (/SELECT b\.id, COALESCE\(b\.business_context, \$2\) AS business_context/i.test(text)
            && /FROM bookings b/i.test(text)) {
            const booking = state.bookings.get(String(params[0]));
            if (!booking || (booking.business_context || 'event_genix') !== params[1]) {
                return { rows: [], rowCount: 0 };
            }
            return {
                rows: [{
                    id: booking.id,
                    business_context: booking.business_context,
                    customer_id: booking.customer_id,
                    customer_name: booking.customer_name || params[2]
                }],
                rowCount: 1
            };
        }

        if (/INSERT INTO event_reviews/i.test(text) && /nps_score/i.test(text)) {
            const [bookingId, , telegramId, score, businessContext, customerId] = params;
            const key = `${bookingId}:${telegramId}:nps`;
            if (state.npsReviews.has(key)) return { rows: [], rowCount: 0 };
            state.npsReviews.add(key);
            state.npsInserts += 1;
            state.lastNpsInsert = { bookingId, telegramId, score, businessContext, customerId };
            return { rows: [{ id: state.npsInserts }], rowCount: 1 };
        }
        if (/UPDATE bookings SET nps_score = \$1/i.test(text)) {
            const [score, bookingId] = params;
            if (!state.bookings.has(String(bookingId))) return { rows: [], rowCount: 0 };
            state.bookingNpsScores.set(String(bookingId), score);
            return { rows: [{ id: bookingId }], rowCount: 1 };
        }

        if (/INSERT INTO event_reviews/i.test(text)) {
            const [bookingId, , telegramId] = params;
            const key = `${bookingId}:${telegramId}`;
            if (state.reviews.has(key)) return { rows: [], rowCount: 0 };
            state.reviews.add(key);
            state.reviewInserts += 1;
            state.lastLegacyReview = {
                bookingId,
                telegramId,
                customerId: state.bookings.get(String(bookingId))?.customer_id || null,
                rating: params[3],
                sql: text
            };
            return { rows: [{ id: state.reviewInserts }], rowCount: 1 };
        }
        if (/INSERT INTO team_pulse/i.test(text)) {
            state.pulseInserts += 1;
            return { rows: [{ id: state.pulseInserts }], rowCount: 1 };
        }

        if (/UPDATE auto_order_requests SET status = \$1/i.test(text)) {
            const [newStatus, , requestId, expected] = params;
            if (state.orders.get(requestId) !== expected) return { rows: [], rowCount: 0 };
            state.orders.set(requestId, newStatus);
            return { rows: [{ id: requestId, status: newStatus }], rowCount: 1 };
        }
        if (/FROM auto_order_requests aor/i.test(text)) {
            state.orderLookups += 1;
            return {
                rows: [{
                    id: params[0],
                    stock_name: 'Juice',
                    quantity: 5,
                    unit: 'pcs',
                    telegram_chat_id: 9900,
                    contractor_name: 'Supplier'
                }],
                rowCount: 1
            };
        }
        if (/UPDATE auto_order_requests SET status = 'ordered'/i.test(text)) {
            state.orders.set(params[0], 'ordered');
            state.orderSent += 1;
            return { rows: [{ id: params[0] }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
    };

    return {
        state,
        restore() {
            db.pool.query = originalQuery;
        }
    };
}

function installRouteDependencyMocks(dbState) {
    const restores = [
        installModuleMock('../services/scheduler', {
            buildAndSendDigest: async () => ({}),
            sendTomorrowReminder: async () => ({})
        }),
        installModuleMock('../services/booking', {
            ensureDefaultLines: async () => true,
            validateDate: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
        }),
        installModuleMock('../services/bot', {
            handleBotCommand: async () => null,
            handleCertUse: async () => null,
            resolveActorName: async (username, id, firstName) => firstName || username || String(id || 'telegram')
        }),
        installModuleMock('../services/bookingAutomation', {
            handleContractorCallback: async () => null
        }),
        installModuleMock('../services/training', {
            categorizeContent: () => 'soft_skills'
        }),
        installModuleMock('../services/leadNotifier', {
            notifyNewLead: async () => null
        }),
        installModuleMock('../middleware/auth', {
            authenticateToken: (req, res, next) => {
                req.user = { id: 1, username: 'unit', role: 'creator' };
                next();
            }
        }),
        installModuleMock('../services/kleshnya', {
            updateTaskStatus: async (taskId, newStatus) => {
                dbState.tasks.set(taskId, newStatus);
                return { id: taskId, status: newStatus };
            }
        })
    ];
    return () => restores.reverse().forEach(restore => restore());
}

function loadTelegramRoute() {
    delete require.cache[require.resolve('../routes/telegram')];
    return require('../routes/telegram');
}

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

async function postWebhook(baseUrl, callbackData, overrides = {}) {
    const body = {
        callback_query: {
            id: overrides.id || `cb-${callbackData}`,
            data: callbackData,
            from: overrides.from || { id: 4200, first_name: 'Tester', username: 'tester' },
            message: overrides.message || {
                message_id: 8800,
                text: 'Original inline message',
                chat: { id: 7700, type: 'group', title: 'Unit Chat' }
            }
        }
    };

    const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-telegram-bot-api-secret-token': 'unit-secret'
        },
        body: JSON.stringify(body)
    });
    return res;
}

function callsByMethod(calls, method) {
    return calls.filter(call => call.method === method);
}

function hasClearedKeyboard(calls, messageId = 8800) {
    return calls.some(call =>
        ['editMessageReplyMarkup', 'editMessageText'].includes(call.method)
        && call.body.message_id === messageId
        && Array.isArray(call.body.reply_markup?.inline_keyboard)
        && call.body.reply_markup.inline_keyboard.length === 0
    );
}

describe('Telegram callback single-use hardening', () => {
    let telegram;
    let dbMock;
    let restoreDeps;
    let server;
    let baseUrl;

    beforeEach(async () => {
        telegram = installTelegramMock();
        dbMock = installDbMock();
        restoreDeps = installRouteDependencyMocks(dbMock.state);

        const app = express();
        app.use(express.json());
        app.use('/api/telegram', loadTelegramRoute());
        ({ server, baseUrl } = await listen(app));
    });

    afterEach(async () => {
        await close(server);
        delete require.cache[require.resolve('../routes/telegram')];
        restoreDeps();
        dbMock.restore();
        telegram.restore();
    });

    it('does not send ask-animator buttons when webhook setup is not ready', async () => {
        telegram.behavior.getConfiguredChatId = async () => '-1001805304620';
        telegram.behavior.getConfiguredThreadId = async () => 1;
        telegram.behavior.ensureWebhook = async () => ({
            ok: false,
            reason: 'setWebhook_failed',
            description: 'bad webhook'
        });

        const res = await fetch(`${baseUrl}/api/telegram/ask-animator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: '2099-01-01', note: 'unit webhook failure' })
        });
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, false);
        assert.equal(data.reason, 'webhook_unavailable');
        assert.equal(data.fallback, 'manual_line');
        assert.equal(data.target.threadId, 1);
        assert.equal(callsByMethod(telegram.calls, 'sendMessage').length, 0);
        assert.equal(dbMock.state.animators.has(2), false);
    });

    it('sends ask-animator approval buttons after webhook setup is ready', async () => {
        telegram.behavior.getConfiguredChatId = async () => '-1001805304620';
        telegram.behavior.getConfiguredThreadId = async () => 1;
        telegram.behavior.ensureWebhook = async () => ({ ok: true, webhookUrl: 'https://crm.test/api/telegram/webhook' });

        const res = await fetch(`${baseUrl}/api/telegram/ask-animator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: '2099-01-01', note: 'unit ready webhook' })
        });
        const data = await res.json();
        const sendCall = callsByMethod(telegram.calls, 'sendMessage').at(-1);

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.requestId, 2);
        assert.equal(data.target.threadId, 1);
        assert.equal(sendCall.body.chat_id, '-1001805304620');
        assert.equal(sendCall.body.message_thread_id, 1);
        assert.equal(sendCall.body.reply_markup.inline_keyboard[0][0].callback_data, 'add_anim:2');
        assert.equal(sendCall.body.reply_markup.inline_keyboard[0][1].callback_data, 'no_anim:2');
        assert.equal(dbMock.state.animators.get(2).status, 'pending');
    });

    it('processes animator approval once and clears stale animator buttons', async () => {
        const first = await postWebhook(baseUrl, 'add_anim:1', { id: 'anim-first' });
        assert.equal(first.status, 200);
        assert.equal(dbMock.state.lineInserts, 1);
        assert.ok(hasClearedKeyboard(telegram.calls));

        const stale = await postWebhook(baseUrl, 'no_anim:1', { id: 'anim-stale' });
        assert.equal(stale.status, 200);
        assert.equal(dbMock.state.lineInserts, 1);
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'anim-stale');
        assert.ok(hasClearedKeyboard(telegram.calls));
    });

    it('uses expected task status tokens to reject stale task choices from older keyboards', async () => {
        const confirm = await postWebhook(baseUrl, 'task_confirm:77:todo', { id: 'task-confirm' });
        assert.equal(confirm.status, 200);
        assert.equal(dbMock.state.tasks.get(77), 'in_progress');
        assert.ok(hasClearedKeyboard(telegram.calls));

        const staleDone = await postWebhook(baseUrl, 'task_done:77:todo', { id: 'task-stale-done' });
        assert.equal(staleDone.status, 200);
        assert.equal(dbMock.state.tasks.get(77), 'in_progress');
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'task-stale-done');

        const validDone = await postWebhook(baseUrl, 'task_done:77:in_progress', { id: 'task-valid-done' });
        assert.equal(validDone.status, 200);
        assert.equal(dbMock.state.tasks.get(77), 'done');
    });

    it('approves training input once and ignores stale reject taps', async () => {
        const first = await postWebhook(baseUrl, 'training_approve_5', { id: 'training-first' });
        assert.equal(first.status, 200);
        assert.equal(dbMock.state.trainingInputs.get(5).status, 'approved');
        assert.equal(dbMock.state.trainingMaterialInserts, 1);
        assert.ok(hasClearedKeyboard(telegram.calls));

        const stale = await postWebhook(baseUrl, 'training_reject_5', { id: 'training-stale' });
        assert.equal(stale.status, 200);
        assert.equal(dbMock.state.trainingInputs.get(5).status, 'approved');
        assert.equal(dbMock.state.trainingMaterialInserts, 1);
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'training-stale');
    });

    it('stores one review rating per booking/customer callback and clears stale rating keyboards', async () => {
        const first = await postWebhook(baseUrl, 'review:123:5', {
            id: 'review-first',
            from: { id: 5500, first_name: 'Customer' }
        });
        assert.equal(first.status, 200);
        assert.equal(dbMock.state.reviewInserts, 1);
        assert.equal(dbMock.state.lastLegacyReview.customerId, 42);
        assert.equal(dbMock.state.lastLegacyReview.rating, 5);
        assert.doesNotMatch(dbMock.state.lastLegacyReview.sql, /nps_score/i);
        assert.ok(hasClearedKeyboard(telegram.calls));

        const stale = await postWebhook(baseUrl, 'review:123:1', {
            id: 'review-stale',
            from: { id: 5500, first_name: 'Customer' }
        });
        assert.equal(stale.status, 200);
        assert.equal(dbMock.state.reviewInserts, 1);
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'review-stale');
    });

    it('stores true NPS 0 and 10, updates booking score, and ignores duplicate taps', async () => {
        const detractor = await postWebhook(baseUrl, 'nps:123:0', {
            id: 'nps-zero',
            from: { id: 5600, first_name: 'Detractor' }
        });
        assert.equal(detractor.status, 200);
        assert.equal(dbMock.state.npsInserts, 1);
        assert.equal(dbMock.state.lastNpsInsert.bookingId, '123');
        assert.equal(dbMock.state.lastNpsInsert.customerId, 42);
        assert.equal(dbMock.state.lastNpsInsert.score, 0);
        assert.equal(dbMock.state.bookingNpsScores.get('123'), 0);
        assert.match(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.text, /менеджер зв/);
        assert.ok(hasClearedKeyboard(telegram.calls));

        const promoter = await postWebhook(baseUrl, 'nps:124:10', {
            id: 'nps-ten',
            from: { id: 5601, first_name: 'Promoter' }
        });
        assert.equal(promoter.status, 200);
        assert.equal(dbMock.state.npsInserts, 2);
        assert.equal(dbMock.state.lastNpsInsert.bookingId, '124');
        assert.equal(dbMock.state.lastNpsInsert.customerId, 43);
        assert.equal(dbMock.state.lastNpsInsert.score, 10);
        assert.equal(dbMock.state.bookingNpsScores.get('124'), 10);
        assert.match(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.text, /Дякуємо/);

        const stale = await postWebhook(baseUrl, 'nps:124:9', {
            id: 'nps-stale',
            from: { id: 5601, first_name: 'Promoter' }
        });
        assert.equal(stale.status, 200);
        assert.equal(dbMock.state.npsInserts, 2);
        assert.equal(dbMock.state.bookingNpsScores.get('124'), 10);
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'nps-stale');
    });

    it('rejects invalid NPS callback scores without writing reviews', async () => {
        for (const callbackData of ['nps:123:11', 'nps:123:-1', 'nps:123:x', 'nps::5']) {
            const res = await postWebhook(baseUrl, callbackData, { id: `invalid-${callbackData}` });
            assert.equal(res.status, 200);
            assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.text, 'Невалідний запит');
        }

        assert.equal(dbMock.state.npsInserts, 0);
        assert.equal(dbMock.state.bookingNpsScores.size, 0);
    });

    it('preserves pulse as a multi-use callback and does not clear the shared keyboard', async () => {
        const first = await postWebhook(baseUrl, 'pulse:4', { id: 'pulse-first' });
        const second = await postWebhook(baseUrl, 'pulse:5', {
            id: 'pulse-second',
            from: { id: 4201, first_name: 'Other Tester' }
        });

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(dbMock.state.pulseInserts, 2);
        assert.equal(callsByMethod(telegram.calls, 'editMessageText').length, 0);
        assert.equal(callsByMethod(telegram.calls, 'editMessageReplyMarkup').length, 0);
    });

    it('sends approved auto-order once and ignores stale reject taps', async () => {
        const first = await postWebhook(baseUrl, 'order_approve:9', { id: 'order-first' });
        assert.equal(first.status, 200);
        assert.equal(dbMock.state.orders.get(9), 'ordered');
        assert.equal(dbMock.state.orderLookups, 1);
        assert.equal(dbMock.state.orderSent, 1);
        assert.equal(callsByMethod(telegram.calls, 'sendTelegramMessage').length, 1);
        assert.ok(hasClearedKeyboard(telegram.calls));

        const stale = await postWebhook(baseUrl, 'order_reject:9', { id: 'order-stale' });
        assert.equal(stale.status, 200);
        assert.equal(dbMock.state.orders.get(9), 'ordered');
        assert.equal(dbMock.state.orderLookups, 1);
        assert.equal(dbMock.state.orderSent, 1);
        assert.equal(callsByMethod(telegram.calls, 'sendTelegramMessage').length, 1);
        assert.equal(callsByMethod(telegram.calls, 'answerCallbackQuery').at(-1).body.callback_query_id, 'order-stale');
    });
});
