/**
 * services/backup.js — Database backup generation & Telegram upload
 */
const https = require('https');
const { pool } = require('../db');
const { TELEGRAM_BOT_TOKEN, getConfiguredChatId, getConfiguredThreadId } = require('./telegram');
const { getKyivDateStr } = require('./booking');

const BACKUP_TABLES = ['bookings', 'lines_by_date', 'users', 'history', 'settings', 'afisha', 'pending_animators', 'telegram_known_chats', 'telegram_known_threads', 'booking_counter'];

async function generateBackupSQL() {
    const lines = [];
    lines.push(`-- Backup: Park Booking System`);
    lines.push(`-- Date: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${BACKUP_TABLES.join(', ')}\n`);

    for (const table of BACKUP_TABLES) {
        try {
            const result = await pool.query(`SELECT * FROM ${table}`);
            if (result.rows.length === 0) continue;

            lines.push(`-- ${table}: ${result.rows.length} rows`);
            lines.push(`DELETE FROM ${table};`);

            const columns = Object.keys(result.rows[0]);
            for (const row of result.rows) {
                const values = columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                    if (val instanceof Date) return `'${val.toISOString()}'`;
                    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                    return `'${String(val).replace(/'/g, "''")}'`;
                });
                lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
            }
            lines.push('');
        } catch (err) {
            lines.push(`-- ERROR backing up ${table}: ${err.message}\n`);
        }
    }

    return lines.join('\n');
}

async function sendBackupToTelegram() {
    try {
        const backupChatResult = await pool.query("SELECT value FROM settings WHERE key = 'backup_chat_id'");
        const chatId = backupChatResult.rows[0]?.value || await getConfiguredChatId();
        if (!chatId || !TELEGRAM_BOT_TOKEN) {
            console.warn('[Backup] No chat ID or bot token — skipping');
            return { success: false, reason: 'no_config' };
        }

        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();
        const fileName = `backup_${dateStr}.sql`;
        const threadId = await getConfiguredThreadId();

        const boundary = '----BackupBoundary' + Date.now();
        let body = '';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="caption"\r\n\r\n📦 Бекап БД — ${dateStr}\r\n`;
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="disable_notification"\r\n\r\ntrue\r\n`;
        if (threadId) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}\r\n`;
        }
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n`;
        body += `Content-Type: application/sql\r\n\r\n`;
        body += sql;
        body += `\r\n--${boundary}--\r\n`;

        const bodyBuffer = Buffer.from(body, 'utf-8');

        const result = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': bodyBuffer.length
                }
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(bodyBuffer);
            req.end();
        });

        console.log(`[Backup] Sent to chat ${chatId}: ${result?.ok ? 'OK' : 'FAIL'}`);
        return { success: result?.ok || false, size: sql.length };
    } catch (err) {
        console.error('[Backup] Error:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { generateBackupSQL, sendBackupToTelegram };
