'use strict';

const { validateDate } = require('./booking');
const { insertHistory } = require('./historyLog');
const COLORS = new Set(['amber', 'violet', 'green', 'blue']);
const projection = `id, business_context, title, description, color_key, is_active, version,
    created_by, created_at, updated_at,
    to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on`;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function validatePromotion(input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 180) {
        throw fail(400, 'Назва має містити від 1 до 180 символів');
    }
    if (typeof input.description !== 'string' || input.description.length > 4000) throw fail(400, 'Умови: максимум 4000 символів');
    if (!COLORS.has(input.color_key)) throw fail(400, 'Оберіть колір із палітри');
    if (!validateDate(input.starts_on) || !validateDate(input.ends_on) || input.ends_on < input.starts_on) {
        throw fail(400, 'Некоректний діапазон дат');
    }
    if (typeof input.is_active !== 'boolean') throw fail(400, 'Некоректний стан акції');
    return { ...input, title: input.title.trim() };
}

async function listPromotions(pool, context, from, to) {
    if (!validateDate(from) || !validateDate(to) || to < from) throw fail(400, 'Некоректний діапазон дат');
    const result = await pool.query(`SELECT ${projection} FROM timeline_promotions
        WHERE business_context = $1 AND is_active AND starts_on <= $3::date AND ends_on >= $2::date
        ORDER BY starts_on, id`, [context, from, to]);
    return result.rows;
}

async function savePromotion(pool, context, id, input, actor) {
    if (id != null && !/^[1-9]\d*$/.test(String(id))) throw fail(400, 'Некоректний ID акції');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let previous;
        if (id != null) {
            const result = await client.query(`SELECT ${projection} FROM timeline_promotions
                WHERE id = $1 AND business_context = $2 FOR UPDATE`, [id, context]);
            previous = result.rows[0];
            if (!previous) throw fail(404, 'Акцію не знайдено');
            if (!Number.isInteger(input.version) || input.version !== previous.version) {
                throw fail(409, 'Акцію вже змінено. Оновіть її перед редагуванням.');
            }
        }
        // Explicit whitelist: request bodies cannot move records to another business or change ownership.
        const value = validatePromotion(Object.fromEntries(['title', 'description', 'color_key', 'starts_on', 'ends_on', 'is_active']
            .map(key => [key, input[key] ?? previous?.[key] ?? ({ description: '', color_key: 'amber', is_active: true })[key]])));
        if (previous && value.is_active) {
            const outside = await client.query(
                `SELECT id FROM afisha WHERE promotion_id = $1 AND (date < $2 OR date > $3) LIMIT 1`,
                [id, value.starts_on, value.ends_on]
            );
            if (outside.rowCount) throw fail(400, 'Спочатку відв’яжіть афішні заходи поза новими датами акції');
        }
        const args = [value.title, value.description, value.color_key, value.starts_on, value.ends_on, value.is_active];
        const result = previous
            ? await client.query(`UPDATE timeline_promotions SET title=$1, description=$2, color_key=$3,
                starts_on=$4, ends_on=$5, is_active=$6, version=version+1, updated_at=NOW()
                WHERE id=$7 AND business_context=$8 RETURNING ${projection}`, [...args, id, context])
            : await client.query(`INSERT INTO timeline_promotions
                (title, description, color_key, starts_on, ends_on, is_active, business_context, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${projection}`, [...args, context, actor]);
        const item = result.rows[0];
        await insertHistory(client, { businessContext: context, action: previous ? 'timeline_promotion_edit' : 'timeline_promotion_create',
            username: actor, data: { id: item.id, version: item.version, starts_on: item.starts_on, ends_on: item.ends_on, is_active: item.is_active } });
        await client.query('COMMIT');
        return item;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { validatePromotion, listPromotions, savePromotion };
