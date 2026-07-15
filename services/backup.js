/**
 * services/backup.js — Database backup generation & Telegram upload
 */
const https = require('https');
const { types: pgTypes } = require('pg');
const { pool } = require('../db');
const { TELEGRAM_BOT_TOKEN, getConfiguredChatId, getConfiguredThreadId } = require('./telegram');
const { getKyivDateStr } = require('./booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('Backup');

// node-postgres normally converts these PostgreSQL values to JavaScript Date objects.
// DATE and TIMESTAMP WITHOUT TIME ZONE are then shifted when Date#toISOString() runs
// outside UTC, while every Date conversion also truncates PostgreSQL microseconds.
// Keep their wire text only for backup SELECTs so the generated SQL round-trips the
// database value exactly without changing the application's global pg parsers.
const RAW_BACKUP_TEMPORAL_OIDS = new Set([1082, 1114, 1184]);
const BACKUP_QUERY_TYPES = {
    getTypeParser(oid, format) {
        if (format === 'text' && RAW_BACKUP_TEMPORAL_OIDS.has(Number(oid))) {
            return value => value;
        }
        return pgTypes.getTypeParser(oid, format);
    }
};

// Order matters for restore: parents before children (FK dependencies).
// DELETE runs in reverse order (children first), INSERT in forward order (parents first).
// Excluded: scheduled_deletions (transient), schema_migrations (deploy state only).
// Full backup inventory. Keep parents before children for FK-safe restore order.
const BACKUP_TABLES = [
    // === Independent tables (no FK dependencies) ===
    'users',
    'settings',
    'booking_counter',
    'certificate_counter',
    'lines_by_date',
    'history',
    'pending_animators',
    'telegram_known_chats',
    'telegram_known_threads',
    'afisha_templates',
    'products',
    'task_templates',
    'automation_rules',
    'user_action_log',
    'user_achievements',
    'user_streaks',
    'kleshnya_messages',
    'user_points',
    'point_transactions',
    'recurring_templates',
    'hr_shift_templates',
    'worker_roles',
    // === Parent tables (referenced by FK) ===
    'customers',
    'staff',
    // Direct staff child; adjacent placement makes its restore dependency explicit.
    'staff_checkins',
    'warehouse_stock',
    'finance_categories',
    'design_collections',
    'contractors',
    'chat_sessions',
    // === Tables with FK to parents ===
    'bookings',
    'certificates',
    'afisha',
    'tasks',
    'kleshnya_chat',
    'hr_shifts',
    'hr_shift_segments',
    'hr_shift_segment_roles',
    'hr_time_records',
    'hr_audit_log',
    'recurring_booking_skips',
    'warehouse_history',
    'finance_transactions',
    'budget_plans',
    'procurement_lists',
    'staff_schedule',
    'contractor_notifications',
    'designs',
    'kleshnya_media',
    // === Deep children (FK to child tables) ===
    'task_logs',
    'design_tags',
    'procurement_items',
];

async function generateBackupSQL() {
    const lines = [];
    lines.push(`-- Backup: Park Booking System`);
    lines.push(`-- Date: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${BACKUP_TABLES.join(', ')}\n`);

    // Fetch all data from one MVCC snapshot so parent/child rows cannot come
    // from different full-replacement commits.
    const tableData = {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        for (const table of BACKUP_TABLES) {
            await client.query('SAVEPOINT backup_table_read');
            try {
                const text = `SELECT * FROM ${table}`;
                const result = await client.query({
                    text,
                    types: BACKUP_QUERY_TYPES
                });
                tableData[table] = result.rows;
                await client.query('RELEASE SAVEPOINT backup_table_read');
            } catch (err) {
                await client.query('ROLLBACK TO SAVEPOINT backup_table_read');
                await client.query('RELEASE SAVEPOINT backup_table_read');
                lines.push(`-- ERROR reading ${table}: ${String(err.message || err).replace(/[\r\n]+/g, ' ')}`);
                tableData[table] = null;
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
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

    lines.push('-- === PHASE 3: SEQUENCE SYNC ===');
    for (const table of [
        'hr_shift_segments',
        'hr_shift_segment_roles',
        'staff_checkins',
        'hr_time_records'
    ]) {
        if (tableData[table] === null) continue;
        lines.push(
            `SELECT setval(pg_get_serial_sequence('${table}', 'id'), `
            + `COALESCE((SELECT MAX(id) FROM ${table}), 1), `
            + `EXISTS (SELECT 1 FROM ${table}));`
        );
    }
    lines.push('');

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

module.exports = { generateBackupSQL, sendBackupToTelegram, BACKUP_TABLES };
