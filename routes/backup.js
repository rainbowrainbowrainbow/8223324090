/**
 * routes/backup.js — Database backup & restore endpoints
 * v17.9.0: Added /verify endpoint for backup integrity testing.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { generateBackupSQL, sendBackupToTelegram } = require('../services/backup');
const { getKyivDateStr } = require('../services/booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('Backup');

router.post('/create', async (req, res) => {
    try {
        const result = await sendBackupToTelegram();
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

router.post('/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sql } = req.body;
        if (!sql || typeof sql !== 'string') {
            return res.status(400).json({ error: 'SQL body required' });
        }

        const statements = sql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        const forbidden = statements.find(s =>
            !s.toUpperCase().startsWith('INSERT') &&
            !s.toUpperCase().startsWith('DELETE')
        );
        if (forbidden) {
            return res.status(400).json({ error: 'Only INSERT and DELETE statements allowed' });
        }

        await client.query('BEGIN');
        let executed = 0;
        for (const stmt of statements) {
            await client.query(stmt);
            executed++;
        }
        await client.query('COMMIT');

        log.info(`Restore: executed ${executed} statements by ${req.user?.username}`);
        res.json({ success: true, executed });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error(`Restore error: ${err.message}`);
        res.status(500).json({ error: 'Restore failed' });
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
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
