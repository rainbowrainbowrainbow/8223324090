/**
 * routes/backup.js — Database backup & restore
 */

const express = require('express');
const https = require('https');
const { pool } = require('../db');
const { getKyivDateStr } = require('../services/booking');
const telegram = require('../services/telegram');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../middleware/errors');

const router = express.Router();

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
        const chatId = backupChatResult.rows[0]?.value || await telegram.getConfiguredChatId();
        const botToken = await telegram.getActiveBotToken();
        if (!chatId || !botToken) {
            console.warn('[Backup] No chat ID or bot token — skipping');
            return { success: false, reason: 'no_config' };
        }

        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();
        const fileName = `backup_${dateStr}.sql`;
        const threadId = await telegram.getConfiguredThreadId();

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
                path: `/bot${botToken}/sendDocument`,
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

router.post('/create', asyncHandler(async (req, res) => {
    const result = await sendBackupToTelegram();
    res.json(result);
}));

router.get('/download', asyncHandler(async (req, res) => {
    const sql = await generateBackupSQL();
    const dateStr = getKyivDateStr();
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="backup_${dateStr}.sql"`);
    res.send(sql);
}));

router.post('/restore', asyncHandler(async (req, res) => {
    const { sql } = req.body;
    if (!sql || typeof sql !== 'string') {
        throw new ValidationError('SQL body required');
    }

    const statements = sql.split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    const forbidden = statements.find(s =>
        !s.toUpperCase().startsWith('INSERT') &&
        !s.toUpperCase().startsWith('DELETE')
    );
    if (forbidden) {
        throw new ValidationError(`Only INSERT and DELETE statements allowed`);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let executed = 0;
        for (const stmt of statements) {
            await client.query(stmt);
            executed++;
        }
        await client.query('COMMIT');

        console.log(`[Restore] Executed ${executed} statements by ${req.user?.username}`);
        res.json({ success: true, executed });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}));

module.exports = router;
module.exports.sendBackupToTelegram = sendBackupToTelegram;
