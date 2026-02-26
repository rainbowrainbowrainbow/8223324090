/**
 * services/training.js — Staff Trainer service (v20.4.0)
 * Weekly Telegram prompts + summary to director
 */
const { pool } = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Training');

const DIRECTOR_TELEGRAM_ID = 674972415;

// ISO week number
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Send weekly training prompt to all active staff with telegram_id
async function sendWeeklyTrainingPrompts() {
    const now = new Date();
    const week = getISOWeek(now);
    const year = now.getFullYear();

    const staffResult = await pool.query(
        `SELECT id, name, telegram_id FROM staff
         WHERE is_active = true AND telegram_id IS NOT NULL AND telegram_id != ''
         AND training_enabled = true`
    );

    let sent = 0;
    for (const s of staffResult.rows) {
        // Check if already sent this week
        const exists = await pool.query(
            `SELECT id FROM training_prompts_sent
             WHERE staff_id = $1 AND week_number = $2 AND year = $3`,
            [s.id, week, year]
        );
        if (exists.rows.length > 0) continue;

        try {
            const message = `📚 <b>Навчання тижня #${week}</b>\n\nПривіт, ${s.name}! 👋\n\nНавчи мене чомусь новому про свою роботу. Поділись лайфхаком, правилом або порадою, яка допомагає тобі працювати краще.\n\n<i>Просто напиши відповідь у цей чат.</i>`;

            await sendTelegramMessage(s.telegram_id, message);

            await pool.query(
                `INSERT INTO training_prompts_sent (staff_id, telegram_id, week_number, year)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [s.id, s.telegram_id, week, year]
            );
            sent++;
        } catch (err) {
            log.error(`Failed to send training prompt to ${s.name}`, err);
        }
    }

    log.info(`Weekly training prompts sent: ${sent}/${staffResult.rows.length}`);
    return sent;
}

// Send weekly summary to director (Friday)
async function sendWeeklySummaryToDirector() {
    const now = new Date();
    const week = getISOWeek(now);
    const year = now.getFullYear();

    const pendingResult = await pool.query(
        `SELECT i.id, i.staff_name, i.content, i.created_at
         FROM staff_training_inputs i
         WHERE i.week_number = $1 AND i.year = $2 AND i.status = 'pending'
         ORDER BY i.created_at ASC`,
        [week, year]
    );

    if (pendingResult.rows.length === 0) {
        await sendTelegramMessage(
            DIRECTOR_TELEGRAM_ID,
            `📚 <b>Навчання тижня #${week}</b>\n\nНемає нових відповідей від персоналу цього тижня.`
        );
        return;
    }

    // Stats
    const statsResult = await pool.query(
        `SELECT COUNT(*) as total_sent FROM training_prompts_sent
         WHERE week_number = $1 AND year = $2`,
        [week, year]
    );
    const respondedResult = await pool.query(
        `SELECT COUNT(*) as responded FROM training_prompts_sent
         WHERE week_number = $1 AND year = $2 AND responded = true`,
        [week, year]
    );

    const totalSent = parseInt(statsResult.rows[0].total_sent);
    const responded = parseInt(respondedResult.rows[0].responded);

    let summary = `📚 <b>Навчання тижня #${week}</b>\n`;
    summary += `📊 Відповіли: ${responded}/${totalSent}\n`;
    summary += `📝 Нових відповідей: ${pendingResult.rows.length}\n\n`;

    for (const input of pendingResult.rows) {
        const preview = input.content.length > 150
            ? input.content.substring(0, 150) + '...'
            : input.content;
        summary += `👤 <b>${input.staff_name}</b>\n`;
        summary += `${preview}\n\n`;
    }

    summary += `\nПерегляд та рішення: /training на сайті`;

    try {
        await sendTelegramMessage(DIRECTOR_TELEGRAM_ID, summary);
        log.info(`Weekly summary sent to director: ${pendingResult.rows.length} pending inputs`);
    } catch (err) {
        log.error('Failed to send weekly summary', err);
    }
}

// Handle incoming message from staff (called from webhook)
async function handleTrainingResponse(telegramId, text) {
    // Find staff by telegram_id
    const staffResult = await pool.query(
        'SELECT id, name FROM staff WHERE telegram_id = $1 AND is_active = true',
        [String(telegramId)]
    );
    if (staffResult.rows.length === 0) return false;

    const staff = staffResult.rows[0];
    const now = new Date();
    const week = getISOWeek(now);
    const year = now.getFullYear();

    // Check if there's an active prompt for this staff
    const promptResult = await pool.query(
        `SELECT id FROM training_prompts_sent
         WHERE staff_id = $1 AND week_number = $2 AND year = $3 AND responded = false`,
        [staff.id, week, year]
    );
    if (promptResult.rows.length === 0) return false;

    // Save the training input
    await pool.query(
        `INSERT INTO staff_training_inputs (staff_id, staff_name, telegram_id, content, week_number, year)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [staff.id, staff.name, telegramId, text, week, year]
    );

    // Mark prompt as responded
    await pool.query(
        `UPDATE training_prompts_sent SET responded = true, responded_at = NOW()
         WHERE staff_id = $1 AND week_number = $2 AND year = $3`,
        [staff.id, week, year]
    );

    log.info(`Training response from ${staff.name} (week ${week})`);
    return true;
}

// Auto-categorize content
function categorizeContent(text) {
    const lower = (text || '').toLowerCase();
    if (/квест|анімат|гр[аиу]|свято|програм/.test(lower)) return 'Аніматори';
    if (/оплат|кас[аиу]|чек|рахун/.test(lower)) return 'Адміністрація';
    if (/безпек|пожеж|евакуац|травм/.test(lower)) return 'Безпека';
    if (/клієнт|батьк|сервіс|обслугов/.test(lower)) return 'Сервіс';
    if (/продаж|дзвін|скрипт|апсейл/.test(lower)) return 'Продажі';
    return 'Загальне';
}

module.exports = {
    sendWeeklyTrainingPrompts,
    sendWeeklySummaryToDirector,
    handleTrainingResponse,
    categorizeContent,
    getISOWeek
};
