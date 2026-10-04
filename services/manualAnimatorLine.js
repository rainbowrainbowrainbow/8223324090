'use strict';

const { randomUUID } = require('node:crypto');
const { getAnimatorTimelineLines } = require('./booking');
const { DEFAULT_TIMELINE_CONTEXT } = require('./timelineContext');

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL_ANIMATOR_COLORS = Object.freeze([
    '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'
]);

function nextManualAnimatorName(lines) {
    const used = new Set((Array.isArray(lines) ? lines : []).map(line => {
        const match = String(line?.name || '').match(/^Аніматор\s+(\d+)$/i);
        return match ? Number(match[1]) : 0;
    }).filter(Number.isInteger));
    let number = 1;
    while (used.has(number)) number++;
    return { name: `Аніматор ${number}`, number };
}

async function appendManualAnimatorLine(pool, date, requestId, options = {}) {
    const normalizedRequestId = requestId || randomUUID();
    if (!REQUEST_ID_PATTERN.test(normalizedRequestId)) {
        const error = new Error('Invalid manual line request ID');
        error.statusCode = 400;
        throw error;
    }
    const businessContext = DEFAULT_TIMELINE_CONTEXT;
    const lineId = `manual_animator_${normalizedRequestId.toLowerCase()}`;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            [`timeline_manual_animator:${businessContext}`, date]);
        const existing = await client.query(
            'SELECT line_id, name, color FROM lines_by_date WHERE business_context = $1 AND date = $2 AND line_id = $3',
            [businessContext, date, lineId]
        );
        if (existing.rows.length) {
            await client.query('COMMIT');
            const row = existing.rows[0];
            return {
                created: false,
                line: { id: row.line_id, name: row.name, color: row.color, fromSheet: false, source: 'manual',
                    businessContext, resourceId: row.line_id, resourceType: 'animator' }
            };
        }

        const visibleLines = await (options.getLines || getAnimatorTimelineLines)(date, client);
        const { name, number } = nextManualAnimatorName(visibleLines);
        const color = MANUAL_ANIMATOR_COLORS[(number - 1) % MANUAL_ANIMATOR_COLORS.length];
        await client.query(
            `INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
             VALUES ($1, $2, $3, $4, $5, false)`,
            [businessContext, date, lineId, name, color]
        );
        await client.query('COMMIT');
        return {
            created: true,
            line: { id: lineId, name, color, fromSheet: false, source: 'manual',
                businessContext, resourceId: lineId, resourceType: 'animator' }
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { appendManualAnimatorLine, nextManualAnimatorName, REQUEST_ID_PATTERN };
