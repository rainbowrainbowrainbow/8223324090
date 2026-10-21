'use strict';

const { validateDate, validateTime } = require('./booking');
const { insertHistory } = require('./historyLog');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function lineIdsOf(event) {
    return [event.line_id, event.second_line_id].filter(Boolean).map(String);
}

function normalizeLineIds(value) {
    if (!Array.isArray(value) || value.length > 2 || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) {
        throw fail(400, 'Оберіть не більше двох аніматорів');
    }
    const ids = value.map(id => id.trim());
    if (new Set(ids).size !== ids.length) throw fail(400, 'Аніматорів не можна дублювати');
    return ids;
}

function normalizePromotionId(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 1) throw fail(400, 'Некоректна акція');
    return value;
}

async function validateTargets(client, date, lineIds, promotionId, retainedPromotionId = null) {
    if (lineIds.length) {
        const result = await client.query(
            `SELECT line_id FROM lines_by_date WHERE date = $1
             AND COALESCE(business_context, 'event_genix') = 'event_genix' AND line_id = ANY($2::text[])
             FOR KEY SHARE`,
            [date, lineIds]
        );
        if (result.rows.length !== lineIds.length) throw fail(400, 'Аніматор недоступний на обрану дату');
    }
    if (promotionId !== null) {
        const result = await client.query(
            `SELECT id, is_active, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
                to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM timeline_promotions
             WHERE id = $1 AND business_context = 'event_genix' FOR SHARE`, [promotionId]
        );
        const promotion = result.rows[0];
        if (!promotion || (!promotion.is_active && promotionId !== retainedPromotionId)
            || date < String(promotion.starts_on).slice(0, 10)
            || date > String(promotion.ends_on).slice(0, 10)) {
            throw fail(400, 'Дата заходу має входити до активної акції');
        }
    }
}

async function createTimelineAfisha(pool, input, actor) {
    const { date, time, title, description = '', type = 'event', duration = 60 } = input;
    if (!validateDate(date) || !validateTime(time)) throw fail(400, 'Некоректна дата або час');
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 180) throw fail(400, 'Назва має містити від 1 до 180 символів');
    if (typeof description !== 'string' || description.length > 4000) throw fail(400, 'Опис: максимум 4000 символів');
    if (!['event', 'regular'].includes(type)) throw fail(400, 'Некоректний тип заходу');
    if (!Number.isInteger(duration) || duration < 15 || duration > 480 || duration % 15 !== 0) {
        throw fail(400, 'Тривалість має бути від 15 до 480 хвилин із кроком 15 хвилин');
    }
    const lineIds = normalizeLineIds(input.lineIds || []);
    const promotionId = normalizePromotionId(input.promotionId ?? null);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await validateTargets(client, date, lineIds, promotionId);
        const result = await client.query(
            `INSERT INTO afisha (date, time, title, duration, type, description, original_time,
                line_id, second_line_id, promotion_id)
             VALUES ($1,$2,$3,$4,$5,$6,$2,$7,$8,$9) RETURNING *`,
            [date, time, title.trim(), duration, type, description, lineIds[0] || null, lineIds[1] || null, promotionId]
        );
        const item = result.rows[0];
        await insertHistory(client, { businessContext: 'event_genix', action: 'afisha_create', username: actor,
            data: { id: item.id, date, time, lineIds, promotionId } });
        await client.query('COMMIT');
        return item;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function updateTimelineAfisha(pool, id, input, actor) {
    if (!/^[1-9]\d*$/.test(String(id))) throw fail(400, 'Некоректний ID заходу');
    const lineIds = normalizeLineIds(input.lineIds);
    const expectedLineIds = normalizeLineIds(input.expectedLineIds);
    const promotionId = normalizePromotionId(input.promotionId);
    const expectedPromotionId = normalizePromotionId(input.expectedPromotionId);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query('SELECT * FROM afisha WHERE id = $1 FOR UPDATE', [id]);
        const event = found.rows[0];
        if (!event) throw fail(404, 'Захід не знайдено');
        if (event.type === 'birthday') throw fail(400, 'Призначення привітання змінюється окремо');
        if (JSON.stringify(lineIdsOf(event)) !== JSON.stringify(expectedLineIds)
            || (event.promotion_id ?? null) !== expectedPromotionId) {
            throw fail(409, 'Захід уже змінено. Оновіть таймлайн і повторіть дію.');
        }
        await validateTargets(client, event.date, lineIds, promotionId, event.promotion_id);
        const result = await client.query(
            `UPDATE afisha SET line_id = $2, second_line_id = $3, promotion_id = $4
             WHERE id = $1 RETURNING *`, [id, lineIds[0] || null, lineIds[1] || null, promotionId]
        );
        await insertHistory(client, { businessContext: 'event_genix', action: 'afisha_tl_update', username: actor,
            data: { id: event.id, from: { lineIds: lineIdsOf(event), promotionId: event.promotion_id },
                to: { lineIds, promotionId } } });
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

module.exports = { createTimelineAfisha, updateTimelineAfisha, normalizeLineIds, lineIdsOf };
