const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const TEST_API_KEY = 'report-bot-submit-key';

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/report-bot',
        '../routes/report-bot'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function cloneState(state) {
    return {
        submissions: state.submissions.map(row => ({ ...row })),
        financeTransactions: state.financeTransactions.map(row => ({ ...row })),
        reports: state.reports.map(row => ({ ...row })),
        personalTransactions: state.personalTransactions.map(row => ({ ...row }))
    };
}

function makeDb(options = {}) {
    let committed = {
        submissions: [],
        financeTransactions: [],
        reports: [],
        personalTransactions: []
    };
    let working = null;
    let nextSubmissionId = 1;
    let nextFinanceId = 100;
    let nextReportId = 200;
    let nextPersonalId = 300;

    const state = {
        tx: [],
        released: 0,
        get committed() {
            return committed;
        }
    };

    function current() {
        return working || committed;
    }

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();

        if (sql === 'BEGIN') {
            state.tx.push('BEGIN');
            working = cloneState(committed);
            return { rows: [], rowCount: 0 };
        }
        if (sql === 'COMMIT') {
            state.tx.push('COMMIT');
            committed = working;
            working = null;
            return { rows: [], rowCount: 0 };
        }
        if (sql === 'ROLLBACK') {
            state.tx.push('ROLLBACK');
            working = null;
            return { rows: [], rowCount: 0 };
        }

        const data = current();

        if (/^INSERT INTO report_bot_submissions/i.test(sql)) {
            const idempotencyKey = params[11];
            const existing = data.submissions.find(row => row.idempotency_key === idempotencyKey);
            if (existing) return { rows: [], rowCount: 0 };

            const row = {
                id: nextSubmissionId++,
                raw_type: params[0],
                amount: params[1],
                description: params[2],
                category: params[3],
                account_name: params[4],
                object_name: params[5],
                submitted_by: params[6],
                submitted_by_id: params[7],
                photo_url: params[8],
                ocr_text: params[9],
                voice_transcript: params[10],
                idempotency_key: idempotencyKey,
                status: 'new',
                finance_transaction_id: null,
                personal_tx_id: null,
                report_id: null
            };
            data.submissions.push(row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }

        if (/FROM report_bot_submissions WHERE idempotency_key = \$1/i.test(sql)) {
            const row = data.submissions.find(item => item.idempotency_key === params[0]);
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }

        if (/SELECT finance_category_id FROM report_bot_category_map/i.test(sql)) {
            return { rows: [{ finance_category_id: 77 }], rowCount: 1 };
        }

        if (/^INSERT INTO finance_transactions/i.test(sql)) {
            const row = {
                id: nextFinanceId++,
                type: params[0],
                category_id: params[1],
                amount: params[2],
                description: params[3],
                date: params[4],
                payment_method: params[5],
                object_name: params[6],
                account_name: params[7],
                created_by: params[8]
            };
            data.financeTransactions.push(row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }

        if (/^INSERT INTO reports/i.test(sql)) {
            if (options.failReportsInsert) {
                throw new Error('simulated reports insert failure');
            }

            const row = {
                id: nextReportId++,
                type: params[0],
                amount: params[1],
                description: params[2],
                category: params[3],
                submitted_by: params[4],
                submitted_via: params[5],
                raw_data: JSON.parse(params[9]),
                status: params[10],
                account_id: params[11],
                account_name: params[12]
            };
            data.reports.push(row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }

        if (/UPDATE report_bot_submissions SET status='processed'/i.test(sql)) {
            const row = data.submissions.find(item => item.id === params[2]);
            row.status = 'processed';
            row.finance_transaction_id = params[0];
            row.report_id = params[1];
            return { rows: [], rowCount: 1 };
        }

        if (/SELECT id FROM finance_accounts/i.test(sql)) {
            return { rows: [{ id: 400 }], rowCount: 1 };
        }

        if (/^INSERT INTO personal_account_transactions/i.test(sql)) {
            const row = {
                id: nextPersonalId++,
                account_id: params[0],
                type: params[1],
                amount: params[2],
                description: params[3],
                category: params[4],
                date: params[5],
                submitted_by_telegram: params[6]
            };
            data.personalTransactions.push(row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }

        if (/UPDATE report_bot_submissions SET status='personal'/i.test(sql)) {
            const row = data.submissions.find(item => item.id === params[1]);
            row.status = 'personal';
            row.personal_tx_id = params[0];
            return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected report-bot submit query: ${sql}`);
    }

    const pool = {
        query,
        connect: async () => ({
            query,
            release: () => { state.released += 1; }
        })
    };

    return { pool, state };
}

function submitBody(overrides = {}) {
    return {
        type: 'expense',
        amount: 123.45,
        description: 'Unit submit',
        category: 'Supplies',
        submitted_by: 'Report User',
        submitted_by_id: 123456,
        submitted_via: 'bot',
        account_name: 'Card',
        object_name: 'Company',
        raw_data: { update_id: 'unit-update-1' },
        date: '2026-05-11',
        ...overrides
    };
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

async function request(baseUrl, body) {
    const res = await fetch(`${baseUrl}/api/report-bot/submit`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': TEST_API_KEY
        },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

async function withApp(db, fn) {
    const originalKey = process.env.REPORT_BOT_API_KEY;
    const originalSecret = process.env.REPORT_WEBHOOK_SECRET;
    process.env.REPORT_BOT_API_KEY = TEST_API_KEY;
    process.env.REPORT_WEBHOOK_SECRET = 'report-submit-secret';

    clearModules();
    installMock('../db', { pool: db.pool });
    installMock('../services/report-bot', {
        handleCommand: async () => {},
        handleCallback: async () => {},
        handleTextMessage: async () => {},
        handlePhoto: async () => {},
        handleVoice: async () => {},
        REPORT_WEBHOOK_SECRET: 'report-submit-secret'
    });

    const app = express();
    app.use(express.json());
    app.use('/api/report-bot', require('../routes/report-bot'));
    const { server, baseUrl } = await listen(app);

    try {
        await fn({ baseUrl, state: db.state });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
        if (originalKey === undefined) delete process.env.REPORT_BOT_API_KEY;
        else process.env.REPORT_BOT_API_KEY = originalKey;
        if (originalSecret === undefined) delete process.env.REPORT_WEBHOOK_SECRET;
        else process.env.REPORT_WEBHOOK_SECRET = originalSecret;
    }
}

test('report-bot submit commits submission, finance transaction, report, and back-reference together', async () => {
    const db = makeDb();
    await withApp(db, async ({ baseUrl, state }) => {
        const res = await request(baseUrl, submitBody());

        assert.equal(res.status, 201, JSON.stringify(res.data));
        assert.equal(res.data.id, 1);
        assert.equal(res.data.transactionId, 100);
        assert.equal(res.data.reportId, 200);
        assert.equal(res.data.routed, 'finance');
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.committed.submissions.length, 1);
        assert.equal(state.committed.financeTransactions.length, 1);
        assert.equal(state.committed.reports.length, 1);
        assert.equal(state.committed.submissions[0].status, 'processed');
        assert.equal(state.committed.submissions[0].finance_transaction_id, 100);
        assert.equal(state.committed.submissions[0].report_id, 200);
        assert.equal(state.committed.financeTransactions[0].date, '2026-05-11');
        assert.equal(state.committed.reports[0].raw_data.report_bot_submission_id, 1);
        assert.equal(state.committed.reports[0].raw_data.report_bot_idempotency_key, 'explicit:unit-update-1');
    });
});

test('report-bot submit returns existing result for duplicate idempotency key without duplicate writes', async () => {
    const db = makeDb();
    await withApp(db, async ({ baseUrl, state }) => {
        const body = submitBody({ raw_data: { update_id: 'same-submit' } });

        const first = await request(baseUrl, body);
        const second = await request(baseUrl, body);

        assert.equal(first.status, 201, JSON.stringify(first.data));
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(second.data.duplicate, true);
        assert.equal(second.data.id, first.data.id);
        assert.equal(second.data.transactionId, first.data.transactionId);
        assert.equal(second.data.reportId, first.data.reportId);
        assert.equal(state.committed.submissions.length, 1);
        assert.equal(state.committed.financeTransactions.length, 1);
        assert.equal(state.committed.reports.length, 1);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    });
});

test('report-bot submit rolls back all writes when the legacy report write fails', async () => {
    const db = makeDb({ failReportsInsert: true });
    await withApp(db, async ({ baseUrl, state }) => {
        const res = await request(baseUrl, submitBody({ raw_data: { update_id: 'fail-submit' } }));

        assert.equal(res.status, 500, JSON.stringify(res.data));
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.committed.submissions.length, 0);
        assert.equal(state.committed.financeTransactions.length, 0);
        assert.equal(state.committed.reports.length, 0);
        assert.equal(state.released, 1);
    });
});
