const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    REPLY_ESCALATION_SOURCE_TYPE,
    closeReplyEscalationForMessage,
    runReplyAutoEscalation
} = require('../services/replyEscalation');

const OVERDUE_REPLY = {
    conversation_id: 41,
    channel: 'viber',
    customer_name: 'Reply Client',
    customer_phone: '+380000000041',
    customer_id: 401,
    assigned_to: 'manager user',
    reply_expected: true,
    awaiting_reply_since: '2026-05-13T09:00:00.000Z',
    reply_expected_message_id: 1201,
    reply_owner: 'manager user',
    reply_owner_user_id: 501,
    reply_sla_at: '2026-05-13T09:30:00.000Z',
    business_context: 'maysternya_doli',
    last_inbound_at: '2026-05-13T08:00:00.000Z',
    last_outbound_at: '2026-05-13T09:00:00.000Z',
    reply_expected_delivery_status: 'delivered',
    lead_id: 41
};

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createEscalationPool(rows, { existingTask = false } = {}) {
    const queries = [];
    return {
        queries,
        query: async (sql, params = []) => {
            const text = compact(sql);
            queries.push({ text, params });

            if (/WITH stale AS/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM conversations c/i.test(text) && /reply_expected IS TRUE/i.test(text)) {
                return { rows };
            }
            if (/WITH inserted AS/i.test(text) && /INSERT INTO tasks/i.test(text)) {
                assert.equal(params[0], 'maysternya_doli');
                assert.equal(params[9], REPLY_ESCALATION_SOURCE_TYPE);
                assert.equal(params[10], '1201');
                return {
                    rows: [{
                        id: existingTask ? 91 : 90,
                        business_context: params[0],
                        title: params[1],
                        description: params[2],
                        status: existingTask ? 'done' : 'todo',
                        priority: 'high',
                        owner_user_id: params[6],
                        deadline: params[8],
                        source_type: params[9],
                        source_id: params[10],
                        created: !existingTask
                    }]
                };
            }
            if (/INSERT INTO task_logs/i.test(text)) {
                return { rows: [] };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };
}

describe('reply auto-escalation', () => {
    it('creates exactly one linked task for overdue explicit waiting reply', async () => {
        const pool = createEscalationPool([OVERDUE_REPLY]);
        const result = await runReplyAutoEscalation({
            pool,
            now: '2026-05-13T10:00:00.000Z',
            today: '2026-05-13'
        });

        assert.equal(result.checked, 1);
        assert.equal(result.created, 1);
        assert.equal(result.reused, 0);
        assert.equal(result.escalations[0].task.source_type, 'conversation_reply');
        assert.equal(result.escalations[0].task.source_id, '1201');
        assert.equal(result.escalations[0].task.business_context, 'maysternya_doli');
        assert.match(result.escalations[0].task.description, /Reply owner user id: 501/);
        assert.match(result.escalations[0].task.title, /Прострочена відповідь/);

        const findQuery = pool.queries.find(q => /FROM conversations c/i.test(q.text));
        assert.ok(findQuery);
        assert.match(findQuery.text, /c\.reply_sla_at <= \$1::timestamp/i);
        assert.match(findQuery.text, /c\.reply_expected_message_id IS NOT NULL/i);
        assert.match(findQuery.text, /c\.reply_owner_user_id/i);
        assert.match(findQuery.text, /COALESCE\(cm\.delivery_status, ''\) NOT IN \('failed', 'later_failed'\)/i);

        const insertQuery = pool.queries.find(q => /INSERT INTO tasks/i.test(q.text));
        assert.ok(insertQuery);
        assert.match(insertQuery.text, /business_context, title/i);
        assert.match(insertQuery.text, /source_type, source_id/i);
        assert.match(insertQuery.text, /ON CONFLICT \(source_id\)/i);
        assert.match(insertQuery.text, /source_type = 'conversation_reply'/i);
    });

    it('reuses an existing linked task instead of duplicating scheduler output', async () => {
        const pool = createEscalationPool([OVERDUE_REPLY], { existingTask: true });
        const result = await runReplyAutoEscalation({
            pool,
            now: '2026-05-13T10:00:00.000Z',
            today: '2026-05-13'
        });

        assert.equal(result.created, 0);
        assert.equal(result.reused, 1);
        assert.equal(result.escalations[0].reason, 'reused');
        assert.equal(result.escalations[0].task.status, 'done');
    });

    it('does not escalate rows that are no longer active waiting reply', async () => {
        const pool = createEscalationPool([{
            ...OVERDUE_REPLY,
            last_inbound_at: '2026-05-13T09:15:00.000Z'
        }]);
        const result = await runReplyAutoEscalation({
            pool,
            now: '2026-05-13T10:00:00.000Z',
            today: '2026-05-13'
        });

        assert.equal(result.checked, 0);
        assert.equal(result.created, 0);
        assert.equal(pool.queries.some(q => /INSERT INTO tasks/i.test(q.text)), false);
    });

    it('closes stale active escalation tasks by reply message anchor', async () => {
        const queries = [];
        const pool = {
            query: async (sql, params = []) => {
                const text = compact(sql);
                queries.push({ text, params });
                if (/UPDATE tasks/i.test(text) && /source_type = \$1/i.test(text)) {
                    return {
                        rows: [{
                            id: 90,
                            status: 'cancelled',
                            source_type: params[0],
                            source_id: params[1]
                        }]
                    };
                }
                if (/INSERT INTO task_logs/i.test(text)) {
                    return { rows: [] };
                }
                throw new Error(`Unexpected close query: ${text}`);
            }
        };

        const closed = await closeReplyEscalationForMessage(1201, {
            pool,
            reason: 'inbound_reply'
        });

        assert.equal(closed.length, 1);
        assert.equal(closed[0].source_type, 'conversation_reply');
        assert.equal(closed[0].source_id, '1201');
        assert.match(queries[0].text, /status = 'cancelled'/i);
        assert.match(queries[0].text, /COALESCE\(status, 'todo'\) NOT IN \('done','cancelled','archived'\)/i);
    });

    it('defines a narrow partial unique index for reply escalation task anchors', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const migration = fs.readFileSync(
            path.join(repoRoot, 'db/migrations/171_reply_auto_escalation_v2.sql'),
            'utf8'
        );

        assert.match(migration, /MIGRATION_KIND: schema/);
        assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_conversation_reply_source_unique/);
        assert.match(migration, /WHERE source_type = 'conversation_reply'/);
        assert.doesNotMatch(migration, /ALTER TABLE conversations/i);
    });
});
