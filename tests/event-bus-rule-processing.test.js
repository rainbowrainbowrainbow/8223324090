const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/eventBus',
        '../services/telegram',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function makeRule(overrides = {}) {
    return {
        id: overrides.id ?? 10,
        code: overrides.code || 'test_rule',
        trigger_event: overrides.trigger_event || 'test.event',
        conditions: overrides.conditions || {},
        actions: overrides.actions || []
    };
}

function makePool() {
    return {
        async query(sql, params = []) {
            const text = compact(sql);
            state.queries.push({ text, params });

            if (text.startsWith('SELECT * FROM rule_definitions')) {
                return { rows: state.rules, rowCount: state.rules.length };
            }

            if (text.startsWith('SELECT output FROM rule_execution_log')) {
                const [ruleId, eventId] = params;
                const rows = state.ruleExecutionLog
                    .filter(row => String(row.rule_id) === String(ruleId) && String(row.event_id) === String(eventId))
                    .map(row => ({ output: row.output }));
                return { rows, rowCount: rows.length };
            }

            if (text.startsWith('INSERT INTO rule_execution_log')) {
                const hasEventId = text.includes('rule_id, event_id, trigger_event');
                const row = hasEventId
                    ? {
                        rule_id: params[0],
                        event_id: params[1],
                        trigger_event: params[2],
                        result: text.includes("'error'") ? 'error' : 'success',
                        error: text.includes("'error'") ? params[3] : null,
                        output: JSON.parse(text.includes("'error'") ? params[4] : params[3])
                    }
                    : {
                        rule_id: params[0],
                        trigger_event: params[1],
                        result: text.includes("'error'") ? 'error' : 'success',
                        error: text.includes("'error'") ? params[2] : null,
                        output: JSON.parse(text.includes("'error'") ? params[3] : params[2])
                    };
                state.ruleExecutionLog.push(row);
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('UPDATE event_queue SET status = \'processed\'')) {
                state.queueUpdate = {
                    status: 'processed',
                    convergence_status: params[1],
                    event_id: params[0]
                };
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('UPDATE event_queue SET status = $1')) {
                state.queueUpdate = {
                    status: params[0],
                    convergence_status: params[1],
                    failure_class: params[2],
                    last_error: params[3],
                    event_id: params[5]
                };
                state.attempts += 1;
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected event bus query: ${text}`);
        },
        connect() {
            throw new Error('rule processing tests should not open a dedicated client');
        }
    };
}

function loadEventBus() {
    clearModules();
    installMock('../db', { pool: makePool() });
    installMock('../utils/logger', {
        createLogger: () => ({
            debug: () => {},
            info: (...args) => state.loggerInfo.push(args),
            warn: (...args) => state.loggerWarn.push(args),
            error: (...args) => state.loggerErrors.push(args)
        })
    });
    installMock('../services/telegram', {
        getConfiguredChatId: async () => '10001',
        sendTelegramMessage: async (chatId, message) => {
            state.telegramSends.push({ chatId, message });
            if (state.failTelegram) throw new Error('telegram provider failed');
        }
    });
    return require('../services/eventBus');
}

describe('event bus rule processing truth', () => {
    beforeEach(() => {
        state = {
            rules: [],
            ruleExecutionLog: [],
            queries: [],
            queueUpdate: null,
            attempts: 0,
            telegramSends: [],
            failTelegram: false,
            loggerInfo: [],
            loggerWarn: [],
            loggerErrors: []
        };
    });

    afterEach(() => {
        clearModules();
    });

    it('does not mark a thrown action as rule success or processed queue completion', async () => {
        state.failTelegram = true;
        state.rules.push(makeRule({
            actions: [{ type: 'send_telegram', message: 'hello' }]
        }));
        const { processEventRules } = loadEventBus();

        const applied = await processEventRules({
            id: 501,
            event_type: 'test.event',
            payload: { customer: 'Park' }
        });

        assert.equal(applied, 0);
        assert.equal(state.telegramSends.length, 1);
        assert.equal(state.queueUpdate.status, 'failed');
        assert.equal(state.queueUpdate.convergence_status, 'retryable_failed');
        assert.equal(state.queueUpdate.failure_class, 'rule_processing_failed');
        assert.match(state.queueUpdate.last_error, /telegram provider failed/);
        assert.equal(state.attempts, 1);
        assert.equal(state.ruleExecutionLog.length, 1);
        assert.equal(state.ruleExecutionLog[0].result, 'error');
        assert.deepEqual(state.ruleExecutionLog[0].output.failed_action_indexes, [0]);
    });

    it('skips completed actions from a previous partial failure before retrying remaining actions', async () => {
        state.ruleExecutionLog.push({
            rule_id: 11,
            event_id: 777,
            output: { completed_action_indexes: [0] }
        });
        state.rules.push(makeRule({
            id: 11,
            actions: [
                { type: 'log', message: 'already done' },
                { type: 'send_telegram', message: 'retry only this' }
            ]
        }));
        const { processEventRules } = loadEventBus();

        const applied = await processEventRules({
            id: 777,
            event_type: 'test.event',
            payload: {}
        });

        assert.equal(applied, 1);
        assert.equal(state.telegramSends.length, 1);
        assert.equal(state.telegramSends[0].message, 'retry only this');
        assert.equal(state.queueUpdate.status, 'processed');
        assert.equal(state.queueUpdate.convergence_status, 'accepted');
        const success = state.ruleExecutionLog.at(-1);
        assert.equal(success.result, 'success');
        assert.deepEqual(success.output.skipped_action_indexes, [0]);
        assert.deepEqual(success.output.completed_action_indexes, [0, 1]);
    });

    it('marks matched empty-action rules as no_action instead of delivered work', async () => {
        state.rules.push(makeRule({ actions: [] }));
        const { processEventRules } = loadEventBus();

        const applied = await processEventRules({
            id: 888,
            event_type: 'test.event',
            payload: {}
        });

        assert.equal(applied, 1);
        assert.equal(state.queueUpdate.status, 'processed');
        assert.equal(state.queueUpdate.convergence_status, 'no_action');
        assert.equal(state.ruleExecutionLog[0].output.outcome, 'no_action');
    });
});
