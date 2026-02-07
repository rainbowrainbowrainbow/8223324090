/**
 * routes/backup.js — Database backup & restore endpoints
 */
const router = require('express').Router();
const { pool } = require('../db');
const { generateBackupSQL, sendBackupToTelegram } = require('../services/backup');
const { getKyivDateStr } = require('../services/booking');

router.post('/create', async (req, res) => {
    try {
        const result = await sendBackupToTelegram();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

router.post('/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sql } = req.body;
        if (!sql || typeof sql !== 'string') {
            client.release();
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
            client.release();
            return res.status(400).json({ error: 'Only INSERT and DELETE statements allowed', statement: forbidden.substring(0, 100) });
        }

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
        console.error('[Restore] Error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
