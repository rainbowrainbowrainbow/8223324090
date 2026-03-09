/**
 * routes/backup.js — Database backup & restore endpoints
 * v17.9.0: Added /verify endpoint for backup integrity testing.
 * v19.10: Hardened restore — whitelist validation, selective restore, encryption.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { generateBackupSQL, sendBackupToTelegram, BACKUP_TABLES } = require('../services/backup');
const { getKyivDateStr } = require('../services/booking');
const { createLogger } = require('../utils/logger');
const crypto = require('crypto');

const { logAdminAction } = require('../services/adminAudit');
const log = createLogger('Backup');

// Whitelist of allowed table names for restore statements
const ALLOWED_TABLES = new Set(BACKUP_TABLES);

router.post('/create', async (req, res) => {
    try {
        const result = await sendBackupToTelegram();
        logAdminAction('backup_create', 'backup', {
            username: req.user?.username, ip: req.ip,
            requestId: req.headers['x-request-id'],
            details: { success: result.success, size: result.size }
        });
        res.json(result);
    } catch (err) {
        log.error('Backup create error', err);
        res.status(500).json({ error: 'Backup creation failed' });
    }
});

router.get('/download', async (req, res) => {
    try {
        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${dateStr}.sql"`);
        res.send(sql);
    } catch (err) {
        log.error('Backup download error', err);
        res.status(500).json({ error: 'Backup download failed' });
    }
});

/**
 * Validate a SQL statement: must be INSERT INTO <table> or DELETE FROM <table>
 * where <table> is in the ALLOWED_TABLES whitelist.
 * Returns { ok, type, table } or { ok: false, reason }.
 */
function validateRestoreStatement(stmt) {
    const upper = stmt.toUpperCase().replace(/\s+/g, ' ').trim();

    // Match INSERT INTO <table>
    const insertMatch = upper.match(/^INSERT\s+INTO\s+(\w+)/);
    if (insertMatch) {
        const table = insertMatch[1].toLowerCase();
        if (!ALLOWED_TABLES.has(table)) {
            return { ok: false, reason: `Table "${table}" not in allowed list` };
        }
        return { ok: true, type: 'INSERT', table };
    }

    // Match DELETE FROM <table>
    const deleteMatch = upper.match(/^DELETE\s+FROM\s+(\w+)/);
    if (deleteMatch) {
        const table = deleteMatch[1].toLowerCase();
        if (!ALLOWED_TABLES.has(table)) {
            return { ok: false, reason: `Table "${table}" not in allowed list` };
        }
        return { ok: true, type: 'DELETE', table };
    }

    return { ok: false, reason: `Statement must be INSERT INTO or DELETE FROM, got: ${upper.slice(0, 50)}` };
}

router.post('/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sql, tables: targetTables } = req.body;
        if (!sql || typeof sql !== 'string') {
            return res.status(400).json({ error: 'SQL body required' });
        }

        const statements = sql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        // Validate every statement against whitelist
        const rejected = [];
        const validated = [];
        for (const stmt of statements) {
            const result = validateRestoreStatement(stmt);
            if (!result.ok) {
                rejected.push(result.reason);
            } else {
                // Selective restore: skip tables not in targetTables (if specified)
                if (Array.isArray(targetTables) && targetTables.length > 0) {
                    if (!targetTables.includes(result.table)) continue;
                }
                validated.push(stmt);
            }
        }

        if (rejected.length > 0) {
            return res.status(400).json({
                error: 'Invalid statements detected',
                rejected: rejected.slice(0, 10)
            });
        }

        await client.query('BEGIN');

        // Reset sequence counters after restore for tables with serial PKs
        const tablesWithData = new Set();
        let executed = 0;
        for (const stmt of validated) {
            await client.query(stmt);
            executed++;
            const m = stmt.toUpperCase().match(/^INSERT\s+INTO\s+(\w+)/);
            if (m) tablesWithData.add(m[1].toLowerCase());
        }

        // Fix serial counters for restored tables (use SAVEPOINT to avoid aborting transaction)
        for (const table of tablesWithData) {
            try {
                await client.query('SAVEPOINT seq_fix');
                await client.query(
                    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
                );
                await client.query('RELEASE SAVEPOINT seq_fix');
            } catch {
                await client.query('ROLLBACK TO SAVEPOINT seq_fix');
            }
        }

        await client.query('COMMIT');

        // Audit log
        log.info(`Restore: executed ${executed} statements by ${req.user?.username}${targetTables ? ` (tables: ${targetTables.join(',')})` : ''}`);

        res.json({ success: true, executed, tablesRestored: [...tablesWithData] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error(`Restore error: ${err.message}`);
        res.status(500).json({ error: 'Restore failed', requestId: req.headers['x-request-id'] });
    } finally {
        client.release();
    }
});

// v17.9.0: Backup integrity verification — generates real backup and validates structure
// Does NOT modify any data. Returns table stats and validation result.
router.get('/verify', async (req, res) => {
    try {
        const startMs = Date.now();
        const sql = await generateBackupSQL();

        // Parse generated SQL to extract table stats
        const tableStats = {};
        const lines = sql.split('\n');
        for (const line of lines) {
            const m = line.match(/^-- (\w+): (\d+) rows/);
            if (m) tableStats[m[1]] = parseInt(m[2]);
        }

        // Count statements
        const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
        const inserts = stmts.filter(s => /^INSERT/i.test(s)).length;
        const deletes = stmts.filter(s => /^DELETE/i.test(s)).length;
        const errors = lines.filter(l => l.startsWith('-- ERROR')).map(l => l.replace('-- ERROR ', ''));

        // Verify DB connection is healthy
        const dbPing = await pool.query('SELECT NOW() as now');

        const elapsedMs = Date.now() - startMs;
        log.info(`Backup verify: ${Object.keys(tableStats).length} tables, ${inserts} inserts, ${Math.round(sql.length / 1024)}KB, ${elapsedMs}ms`);

        res.json({
            ok: errors.length === 0,
            generated_at: dbPing.rows[0].now,
            elapsed_ms: elapsedMs,
            sql_size_kb: Math.round(sql.length / 1024),
            tables_backed_up: Object.keys(tableStats).length,
            total_rows: Object.values(tableStats).reduce((a, b) => a + b, 0),
            inserts,
            deletes,
            errors,
            table_stats: tableStats,
        });
    } catch (err) {
        log.error(`Backup verify error: ${err.message}`);
        res.status(500).json({ ok: false, error: 'Помилка перевірки бекапу' });
    }
});

// v19.10: Download encrypted backup
router.get('/download-encrypted', async (req, res) => {
    try {
        const passphrase = req.query.key || process.env.BACKUP_ENCRYPTION_KEY;
        if (!passphrase) {
            return res.status(400).json({ error: 'Encryption key required (query param "key" or BACKUP_ENCRYPTION_KEY env)' });
        }

        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();

        // AES-256-CBC encryption
        const key = crypto.scryptSync(passphrase, 'park-booking-salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        const encrypted = Buffer.concat([cipher.update(sql, 'utf8'), cipher.final()]);

        // Prepend IV to encrypted data
        const output = Buffer.concat([iv, encrypted]);

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${dateStr}.enc"`);
        res.send(output);
    } catch (err) {
        log.error('Encrypted backup download error', err);
        res.status(500).json({ error: 'Encrypted backup failed' });
    }
});

// v19.10: Restore from encrypted backup
router.post('/restore-encrypted', async (req, res) => {
    try {
        const passphrase = req.body.key || process.env.BACKUP_ENCRYPTION_KEY;
        if (!passphrase || !req.body.data) {
            return res.status(400).json({ error: 'Encryption key and data required' });
        }

        // Decrypt
        const key = crypto.scryptSync(passphrase, 'park-booking-salt', 32);
        const inputBuffer = Buffer.from(req.body.data, 'base64');
        const iv = inputBuffer.subarray(0, 16);
        const encrypted = inputBuffer.subarray(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const sql = decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');

        // Forward to the regular restore handler logic
        req.body.sql = sql;
        // Re-run through the same pipeline (redirect internally)
        const statements = sql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const stmt of statements) {
            const v = validateRestoreStatement(stmt);
            if (!v.ok) {
                return res.status(400).json({ error: 'Decrypted backup contains invalid statement', reason: v.reason });
            }
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
            log.info(`Encrypted restore: executed ${executed} statements by ${req.user?.username}`);
            res.json({ success: true, executed });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        log.error(`Encrypted restore error: ${err.message}`);
        res.status(500).json({ error: 'Encrypted restore failed' });
    }
});

// v19.10: List available tables for selective restore
router.get('/tables', (req, res) => {
    res.json({ tables: BACKUP_TABLES });
});

module.exports = router;
