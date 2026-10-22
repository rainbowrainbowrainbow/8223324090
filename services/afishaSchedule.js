'use strict';

const { validateDate, validateTime, timeToMinutes } = require('./booking');
const { insertHistory } = require('./historyLog');
const { assertAfishaLinesFree } = require('./afishaConflicts');

function scheduleError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

function validateSchedule(event, input) {
    if (!validateDate(input.date) || !validateTime(input.time)
        || !validateDate(input.expectedDate) || !validateTime(input.expectedTime)) {
        throw scheduleError(400, 'Некоректна дата або час');
    }
    if (String(event.date).slice(0, 10) !== input.expectedDate || event.time !== input.expectedTime) {
        throw scheduleError(409, 'Подію вже змінено. Оновіть розклад і повторіть дію.');
    }
    if (event.type === 'birthday') throw scheduleError(400, 'Вітання іменинників не можна переносити');
    if (!['event', 'regular'].includes(event.type)) throw scheduleError(400, 'Непідтримуваний тип події');
    if (input.date !== input.expectedDate && (event.template_id || event.type === 'regular')) {
        throw scheduleError(400, 'Регулярну подію можна рухати лише в межах дня');
    }
    const maxDelta = event.template_id ? 90 : 120;
    if (Math.abs(timeToMinutes(input.time) - timeToMinutes(event.original_time || event.time)) > maxDelta) {
        throw scheduleError(400, `Час можна змінити не більше ніж на ${maxDelta} хв від початкового`);
    }
    // Keep an existing off-grid time when moving to another date; new times snap to five minutes.
    if (input.time !== event.time && timeToMinutes(input.time) % 5 !== 0) {
        throw scheduleError(400, 'Оберіть час із кроком 5 хвилин');
    }
}

async function moveAfishaSchedule(pool, id, input, actor, businessContext) {
    if (!/^[1-9]\d*$/.test(String(id))) throw scheduleError(400, 'Некоректний ID події');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query('SELECT * FROM afisha WHERE id = $1 FOR UPDATE', [id]);
        const event = found.rows[0];
        if (!event) throw scheduleError(404, 'Подію не знайдено');
        validateSchedule(event, input);
        if (event.promotion_id != null && input.date !== event.date) {
            const linked = await client.query(
                `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
                    to_char(ends_on, 'YYYY-MM-DD') AS ends_on
                 FROM timeline_promotions WHERE id = $1 FOR SHARE`, [event.promotion_id]
            );
            const promotion = linked.rows[0];
            if (promotion && (input.date < String(promotion.starts_on).slice(0, 10)
                || input.date > String(promotion.ends_on).slice(0, 10))) {
                throw scheduleError(400, 'Спочатку відв’яжіть захід від акції або змініть дати акції');
            }
        }
        if (input.date === event.date && input.time !== event.time) {
            await assertAfishaLinesFree(client, { date: event.date, time: input.time,
                duration: event.duration || 60, lineIds: [event.line_id, event.second_line_id].filter(Boolean),
                excludeId: event.id });
        }
        const result = await client.query(
            `UPDATE afisha SET date = $2::text, time = $3,
                line_id = CASE WHEN date::text <> $2::text THEN NULL ELSE line_id END,
                second_line_id = CASE WHEN date::text <> $2::text THEN NULL ELSE second_line_id END
             WHERE id = $1 RETURNING *`, [id, input.date, input.time]
        );
        await insertHistory(client, { businessContext, action: 'afisha_move', username: actor,
            data: { id: event.id, from: { date: event.date, time: event.time, line_id: event.line_id, second_line_id: event.second_line_id },
                to: { date: input.date, time: input.time, line_id: result.rows[0].line_id, second_line_id: result.rows[0].second_line_id } } });
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { validateSchedule, moveAfishaSchedule };
