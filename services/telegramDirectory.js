'use strict';

const ROUTES = Object.freeze({
    approval: 'telegram_directory_approval',
    digest: 'telegram_directory_digest',
    reminder: 'telegram_directory_reminder'
});

function parseTelegramAddress(value) {
    const data = typeof value === 'string' && /^(-[1-9]\d{0,15}):([1-9]\d{0,15})?$/.exec(value);
    if (!data || !Number.isSafeInteger(Number(data[1])) || (data[2] && !Number.isSafeInteger(Number(data[2])))) return null;
    return { chatId: data[1], threadId: data[2] ? Number(data[2]) : null };
}

function telegramAddressKey(chatId, threadId) {
    return String(chatId) + ':' + (threadId ?? '');
}

async function getTelegramRoute(db, feature) {
    if (!Object.hasOwn(ROUTES, feature)) throw Error('Unknown Telegram route');
    const { rows: [row] } = await db.query('SELECT value FROM settings WHERE key = $1', [ROUTES[feature]]);
    const target = parseTelegramAddress(row?.value);
    return target ? { ...target, source: 'telegram_directory' } : null;
}

async function listTelegramDirectory(db) {
    const { rows } = await db.query(`SELECT c.chat_id::text AS "chatId", c.title AS "chatTitle",
        t.thread_id::text AS "threadId", t.title AS "threadTitle"
        FROM telegram_known_chats c LEFT JOIN LATERAL (
            SELECT NULL::bigint AS thread_id, NULL::text AS title
            UNION ALL SELECT tt.thread_id, tt.title FROM telegram_known_threads tt WHERE tt.chat_id = c.chat_id
        ) t ON true
        WHERE c.type IN ('group', 'supergroup') ORDER BY c.title, c.chat_id, t.thread_id NULLS FIRST`);
    return rows.map(row => ({ ...row, key: telegramAddressKey(row.chatId, row.threadId) }));
}

async function setTelegramRoute(db, feature, value) {
    if (!Object.hasOwn(ROUTES, feature)) throw Object.assign(Error('Невідома функція Telegram'), { statusCode: 400 });
    if (value === null) {
        await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [ROUTES[feature], '']);
        return null;
    }
    const target = parseTelegramAddress(value);
    if (!target || !(await listTelegramDirectory(db)).some(item => item.key === value)) {
        throw Object.assign(Error('Оберіть групу та тему зі списку Telegram'), { statusCode: 400 });
    }
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [ROUTES[feature], value]);
    return { ...target, source: 'telegram_directory' };
}

module.exports = { listTelegramDirectory, getTelegramRoute, setTelegramRoute, telegramAddressKey };
