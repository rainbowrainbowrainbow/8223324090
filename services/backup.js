/**
 * services/backup.js — Database backup generation & Telegram upload
 */
const https = require('https');
const { pool } = require('../db');
const { TELEGRAM_BOT_TOKEN, getConfiguredChatId, getConfiguredThreadId } = require('./telegram');
const { getKyivDateStr } = require('./booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('Backup');

// Order matters for restore: parents before children (FK dependencies).
// DELETE runs in reverse order (children first), INSERT in forward order (parents first).
// The only FK: staff_schedule.staff_id → staff(id) ON DELETE CASCADE.
// Note: scheduled_deletions is excluded (transient Telegram data, stale on restore).
const BACKUP_TABLES = [
    // === Independent tables (no FK dependencies) ===
    'users',
    'settings',
    'booking_counter',
    'certificate_counter',
    'bookings',
    'lines_by_date',
    'history',
    'pending_animators',
    'telegram_known_chats',
    'telegram_known_threads',
    'afisha',
    'afisha_templates',
    'products',
    'tasks',
    'task_templates',
    'automation_rules',
    'certificates',
    // === Parent tables (referenced by FK) ===
    'staff',
    // === Child tables (have FK to parent) ===
    'staff_schedule',
];

async function generateBackupSQL() {
    const lines = [];
    lines.push(`-- Backup: Park Booking System`);
    lines.push(`-- Date: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${BACKUP_TABLES.join(', ')}\n`);

    // Fetch all data first
    const tableData = {};
    for (const table of BACKUP_TABLES) {
        try {
            const result = await pool.query(`SELECT * FROM ${table}`);
            tableData[table] = result.rows;
        } catch (err) {
            lines.push(`-- ERROR reading ${table}: ${err.message}`);
            tableData[table] = null;
        }
    }

    // Phase 1: DELETE in reverse order (children before parents)
    lines.push('-- === PHASE 1: DELETE (reverse FK order) ===');
    for (const table of [...BACKUP_TABLES].reverse()) {
        if (tableData[table] === null) continue;
        lines.push(`DELETE FROM ${table};`);
    }
    lines.push('');

    // Phase 2: INSERT in forward order (parents before children)
    lines.push('-- === PHASE 2: INSERT (forward FK order) ===');
    for (const table of BACKUP_TABLES) {
        const rows = tableData[table];
        if (!rows || rows.length === 0) continue;

        lines.push(`-- ${table}: ${rows.length} rows`);
        const columns = Object.keys(rows[0]);
        for (const row of rows) {
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
    }

    return lines.join('\n');
}

async function sendBackupToTelegram() {
    try {
        const backupChatResult = await pool.query("SELECT value FROM settings WHERE key = 'backup_chat_id'");
        const chatId = backupChatResult.rows[0]?.value || await getConfiguredChatId();
        if (!chatId || !TELEGRAM_BOT_TOKEN) {
            log.warn('No chat ID or bot token — skipping backup');
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

        log.info(`Backup sent to chat ${chatId}: ${result?.ok ? 'OK' : 'FAIL'}`);
        return { success: result?.ok || false, size: sql.length };
    } catch (err) {
        log.error(`Backup error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

module.exports = { generateBackupSQL, sendBackupToTelegram };
