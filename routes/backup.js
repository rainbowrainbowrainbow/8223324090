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
const { lockAttendanceWriteMaintenance } = require('../services/attendanceWriteLock');
const { requireRole } = require('../middleware/auth');
const { safeTableName } = require('../utils/sqlSafe');
const log = createLogger('Backup');

// RBAC: All backup operations restricted to creator/director only
router.use(requireRole('creator', 'director'));

// Whitelist of allowed table names for restore statements
const ALLOWED_TABLES = new Set(BACKUP_TABLES);
const ATTENDANCE_MAINTENANCE_TABLES = new Set([
    'staff',
    'staff_schedule',
    'hr_shifts',
    'hr_time_records',
    'staff_checkins'
]);
// Deleting the staff parent cascades into staff child tables that may not be selected.
// Keep staff restoration full-backup-only until selective dependency closure exists.
const SELECTIVE_RESTORE_BLOCKED_TABLES = new Set(['staff']);

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
 * Validate a SQL statement: must be INSERT INTO <table>, DELETE FROM <table>,
 * or the exact sequence-sync metadata emitted by generateBackupSQL().
 * Every referenced table must be in the ALLOWED_TABLES whitelist.
 * Returns { ok, type, table } or { ok: false, reason }.
 */
function validateRestoreStatement(stmt) {
    const normalized = stmt.replace(/\s+/g, ' ').trim();
    const upper = normalized.toUpperCase();

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

    // This is metadata, not arbitrary SELECT support. The route never executes the
    // supplied statement; it performs its own allowlisted sequence repair instead.
    const sequenceMatch = normalized.match(
        /^SELECT setval\(pg_get_serial_sequence\('(\w+)', 'id'\), COALESCE\(\(SELECT MAX\(id\) FROM \1\), 1\), EXISTS \(SELECT 1 FROM \1\)\)$/i
    );
    if (sequenceMatch) {
        const table = sequenceMatch[1].toLowerCase();
        if (!ALLOWED_TABLES.has(table)) {
            return { ok: false, reason: 'Sequence metadata references an invalid table' };
        }
        return { ok: true, type: 'SEQUENCE_SYNC', table };
    }

    return {
        ok: false,
        reason: `Statement must be an allowlisted INSERT, DELETE, or backup sequence sync, got: ${upper.slice(0, 50)}`
    };
}

/**
 * Split generated restore SQL without treating comments or quoted semicolons as
 * statement boundaries. The backup generator uses standard single-quoted SQL
 * strings and doubles embedded quotes, so no broader SQL grammar is needed here.
 */
function splitRestoreStatements(sql) {
    const statements = [];
    let current = '';
    let inString = false;
    let inLineComment = false;

    for (let index = 0; index < sql.length; index++) {
        const char = sql[index];
        const next = sql[index + 1];

        if (inLineComment) {
            if (char === '\n' || char === '\r') {
                inLineComment = false;
                current += '\n';
            }
            continue;
        }

        if (inString) {
            current += char;
            if (char === "'" && next === "'") {
                current += next;
                index++;
            } else if (char === "'") {
                inString = false;
            }
            continue;
        }

        if (char === "'") {
            inString = true;
            current += char;
        } else if (char === '-' && next === '-') {
            inLineComment = true;
            current += ' ';
            index++;
        } else if (char === ';') {
            const statement = current.trim();
            if (statement) statements.push(statement);
            current = '';
        } else {
            current += char;
        }
    }

    const trailing = current.trim();
    if (trailing) statements.push(trailing);
    return {
        statements,
        error: inString ? 'Unterminated SQL string literal' : null
    };
}

function prepareRestoreStatements(sql, targetTables) {
    const parsed = splitRestoreStatements(sql);
    const rejected = parsed.error ? [parsed.error] : [];
    let selectedTables = null;

    if (targetTables !== undefined) {
        if (!Array.isArray(targetTables) || targetTables.length === 0) {
            rejected.push('Selective restore tables must be a non-empty array');
        } else {
            selectedTables = new Set();
            for (const rawTable of targetTables) {
                const table = String(rawTable || '').trim().toLowerCase();
                if (!ALLOWED_TABLES.has(table)) {
                    rejected.push(`Table "${table || String(rawTable)}" not in allowed list`);
                } else {
                    selectedTables.add(table);
                }
            }
            for (const table of selectedTables) {
                if (SELECTIVE_RESTORE_BLOCKED_TABLES.has(table)) {
                    rejected.push(`Table "${table}" requires a full restore because selective DELETE can cascade`);
                }
            }
        }
    }

    const statements = [];
    const sequenceTables = new Set();
    for (const stmt of parsed.statements) {
        const result = validateRestoreStatement(stmt);
        if (!result.ok) {
            rejected.push(result.reason);
            continue;
        }
        if (selectedTables && !selectedTables.has(result.table)) continue;
        // Sequence sync from a backup is accepted only as canonical metadata.
        // executeRestoreStatements performs the safe server-side query, including
        // for empty generated tables that have no INSERT statement.
        if (result.type === 'SEQUENCE_SYNC') sequenceTables.add(result.table);
        else statements.push(stmt);
    }

    return {
        statements,
        rejected,
        selectedTables: selectedTables ? [...selectedTables] : null,
        sequenceTables
    };
}

function restoreTouchesAttendanceState(statements, sequenceTables = []) {
    if ([...sequenceTables].some(table => ATTENDANCE_MAINTENANCE_TABLES.has(table))) {
        return true;
    }
    return statements.some(stmt => {
        const validated = validateRestoreStatement(stmt);
        return validated.ok && ATTENDANCE_MAINTENANCE_TABLES.has(validated.table);
    });
}

function collectInsertedRestoreTables(statements) {
    const tables = new Set();
    for (const statement of statements) {
        const validated = validateRestoreStatement(statement);
        if (validated.ok && validated.type === 'INSERT') {
            tables.add(validated.table);
        }
    }
    return tables;
}

async function repairRestoredSequences(client, tables) {
    for (const table of tables) {
        const safeName = safeTableName(table, BACKUP_TABLES);
        await client.query('SAVEPOINT seq_fix');
        try {
            await client.query(
                `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${safeName}), 0) + 1, false)`,
                [table]
            );
        } catch {
            // Some allowlisted tables do not have a serial id. Keep their restored data
            // and isolate the unsupported sequence repair from the surrounding restore.
            await client.query('ROLLBACK TO SAVEPOINT seq_fix');
        } finally {
            await client.query('RELEASE SAVEPOINT seq_fix');
        }
    }
}

async function executeRestoreStatements(client, statements, sequenceTables = []) {
    const tablesWithData = collectInsertedRestoreTables(statements);
    const tablesToRepair = new Set([...tablesWithData, ...sequenceTables]);
    for (const statement of statements) {
        await client.query(statement);
    }
    await repairRestoredSequences(client, tablesToRepair);
    return { executed: statements.length, tablesWithData };
}

router.post('/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sql, tables: targetTables } = req.body;
        if (!sql || typeof sql !== 'string') {
            return res.status(400).json({ error: 'SQL body required' });
        }

        const {
            statements: validated,
            rejected,
            selectedTables,
            sequenceTables
        } = prepareRestoreStatements(sql, targetTables);

        if (rejected.length > 0) {
            return res.status(400).json({
                error: 'Invalid statements detected',
                rejected: rejected.slice(0, 10)
            });
        }

        await client.query('BEGIN');
        if (restoreTouchesAttendanceState(validated, sequenceTables)) {
            await lockAttendanceWriteMaintenance(client);
        }

        const { executed, tablesWithData } = await executeRestoreStatements(
            client,
            validated,
            sequenceTables
        );

        await client.query('COMMIT');

        // Audit log
        log.info(
            `Restore: executed ${executed} statements by ${req.user?.username}`
            + `${selectedTables ? ` (tables: ${selectedTables.join(',')})` : ''}`
        );

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
        const parsed = splitRestoreStatements(sql);
        const stmts = parsed.statements.map(statement => ({
            statement,
            validated: validateRestoreStatement(statement)
        }));
        const inserts = stmts.filter(item => item.validated.type === 'INSERT').length;
        const deletes = stmts.filter(item => item.validated.type === 'DELETE').length;
        const errors = lines.filter(l => l.startsWith('-- ERROR')).map(l => l.replace('-- ERROR ', ''));
        if (parsed.error) errors.push(parsed.error);
        errors.push(...stmts
            .filter(item => !item.validated.ok)
            .map(item => item.validated.reason));

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

        const {
            statements,
            rejected,
            selectedTables,
            sequenceTables
        } = prepareRestoreStatements(sql, req.body.tables);
        if (rejected.length > 0) {
            return res.status(400).json({
                error: 'Decrypted backup contains invalid statement',
                reason: rejected[0]
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (restoreTouchesAttendanceState(statements, sequenceTables)) {
                await lockAttendanceWriteMaintenance(client);
            }
            const { executed, tablesWithData } = await executeRestoreStatements(
                client,
                statements,
                sequenceTables
            );
            await client.query('COMMIT');
            const tablesRestored = [...tablesWithData];
            log.info(
                `Encrypted restore: executed ${executed} statements by ${req.user?.username}`
                + `${selectedTables ? ` (tables: ${selectedTables.join(',')})` : ''}`
            );
            res.json({ success: true, executed, tablesRestored });
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
