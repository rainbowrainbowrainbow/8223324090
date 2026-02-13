/**
 * routes/certificates.js — Certificate CRUD + status management
 * v8.4: Certificate registry with Telegram alerts
 */
const router = require('express').Router();
const { pool, generateCertCode } = require('../db');
const { requireRole } = require('../middleware/auth');
const { mapCertificateRow, calculateValidUntil, validateCertificateInput, VALID_STATUSES } = require('../services/certificates');
const { sendTelegramMessage, getConfiguredChatId, getBotUsername } = require('../services/telegram');
const { formatCertificateNotification } = require('../services/templates');
const { createLogger } = require('../utils/logger');
const QRCode = require('qrcode');

const log = createLogger('Certificates');

// GET /api/certificates — List with filters
router.get('/', async (req, res) => {
    try {
        const { status, search, limit, offset } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(`(display_value ILIKE $${idx} OR cert_code ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 100, 500);
        const off = parseInt(offset) || 0;

        const countResult = await pool.query(`SELECT COUNT(*) FROM certificates ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT * FROM certificates ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, lim, off]
        );

        res.json({
            items: result.rows.map(mapCertificateRow),
            total
        });
    } catch (err) {
        log.error('List error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/certificates/qr/:code — Generate QR code for certificate deep link
router.get('/qr/:code', async (req, res) => {
    try {
        const certCode = req.params.code.trim().toUpperCase();
        const result = await pool.query('SELECT * FROM certificates WHERE cert_code = $1', [certCode]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        const botUsername = await getBotUsername();
        if (!botUsername) {
            return res.status(500).json({ error: 'Bot username not available' });
        }

        const deepLink = `https://t.me/${botUsername}?start=cert_${certCode}`;
        const dataUrl = await QRCode.toDataURL(deepLink, {
            width: 200,
            margin: 1,
            color: { dark: '#0D47A1', light: '#FFFFFF' }
        });

        res.json({ dataUrl, deepLink, certCode });
    } catch (err) {
        log.error('QR generation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/certificates/code/:code — Find by cert_code
router.get('/code/:code', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM certificates WHERE cert_code = $1', [req.params.code.trim().toUpperCase()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }
        res.json(mapCertificateRow(result.rows[0]));
    } catch (err) {
        log.error('Get by code error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/certificates/:id — Single certificate
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM certificates WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }
        res.json(mapCertificateRow(result.rows[0]));
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/certificates — Create new certificate
router.post('/', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const errors = validateCertificateInput(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { displayMode, displayValue, typeText, validUntil, notes } = req.body;

        await client.query('BEGIN');

        const certCode = await generateCertCode(client);

        // Calculate valid_until: use provided or default +45 days
        let defaultDays = 45;
        try {
            const settingResult = await client.query("SELECT value FROM settings WHERE key = 'cert_default_days'");
            if (settingResult.rows.length > 0 && settingResult.rows[0].value) {
                defaultDays = parseInt(settingResult.rows[0].value) || 45;
            }
        } catch (e) { /* use default */ }

        const finalValidUntil = validUntil || calculateValidUntil(new Date(), defaultDays);

        const result = await client.query(
            `INSERT INTO certificates (cert_code, display_mode, display_value, type_text, valid_until, issued_by_user_id, issued_by_name, notes, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
             RETURNING *`,
            [
                certCode,
                displayMode || 'fio',
                displayValue.trim(),
                typeText || 'на одноразовий вхід',
                finalValidUntil,
                req.user.id || null,
                req.user.name || req.user.username,
                notes || null
            ]
        );

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['certificate_create', req.user.username, JSON.stringify({
                certCode,
                displayMode: displayMode || 'fio',
                displayValue: displayValue.trim(),
                typeText: typeText || 'на одноразовий вхід'
            })]
        );

        await client.query('COMMIT');

        const cert = result.rows[0];
        const mapped = mapCertificateRow(cert);

        // Fire-and-forget Telegram alert
        (async () => {
            try {
                const text = formatCertificateNotification('certificate_issued', cert, { username: req.user.name || req.user.username });
                if (!text) return;

                // Try director chat_id first, fallback to general
                let chatId;
                try {
                    const dirResult = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
                    if (dirResult.rows.length > 0 && dirResult.rows[0].value) {
                        chatId = dirResult.rows[0].value;
                    }
                } catch (e) { /* fallback */ }
                if (!chatId) chatId = await getConfiguredChatId();
                if (!chatId) return;

                const sendResult = await sendTelegramMessage(chatId, text);
                if (sendResult && sendResult.ok) {
                    await pool.query('UPDATE certificates SET telegram_alert_sent = TRUE WHERE id = $1', [cert.id]);
                }
            } catch (err) {
                log.error(`Telegram certificate alert failed: ${err.message}`);
            }
        })();

        log.info(`Certificate created: ${certCode} by ${req.user.username}`);
        res.status(201).json(mapped);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PATCH /api/certificates/:id/status — Change status
router.patch('/:id/status', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { status, reason } = req.body;

        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        const existing = await client.query('SELECT * FROM certificates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        const cert = existing.rows[0];

        // One-time use check
        if (status === 'used' && cert.status === 'used') {
            return res.status(400).json({ error: 'Сертифікат вже використаний' });
        }
        if (cert.status === 'expired') {
            return res.status(400).json({ error: 'Сертифікат прострочений' });
        }

        await client.query('BEGIN');

        const updates = ['status = $1', 'updated_at = NOW()'];
        const params = [status];
        let idx = 2;

        if (status === 'used') {
            updates.push(`used_at = NOW()`);
        }
        if (status === 'revoked' || status === 'blocked') {
            updates.push(`invalidated_at = NOW()`);
            if (reason) {
                updates.push(`invalid_reason = $${idx++}`);
                params.push(reason);
            }
        }

        params.push(id);
        await client.query(
            `UPDATE certificates SET ${updates.join(', ')} WHERE id = $${idx}`,
            params
        );

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [`certificate_${status}`, req.user.username, JSON.stringify({
                certCode: cert.cert_code,
                oldStatus: cert.status,
                newStatus: status,
                reason: reason || null
            })]
        );

        await client.query('COMMIT');

        const updated = await pool.query('SELECT * FROM certificates WHERE id = $1', [id]);
        const mapped = mapCertificateRow(updated.rows[0]);

        // Telegram alert for status change
        (async () => {
            try {
                const text = formatCertificateNotification(`certificate_${status}`, updated.rows[0], { username: req.user.name || req.user.username });
                if (!text) return;
                let chatId;
                try {
                    const dirResult = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
                    if (dirResult.rows.length > 0 && dirResult.rows[0].value) chatId = dirResult.rows[0].value;
                } catch (e) { /* fallback */ }
                if (!chatId) chatId = await getConfiguredChatId();
                if (chatId) await sendTelegramMessage(chatId, text);
            } catch (err) {
                log.error(`Telegram status alert failed: ${err.message}`);
            }
        })();

        log.info(`Certificate ${cert.cert_code} status: ${cert.status} → ${status} by ${req.user.username}`);
        res.json(mapped);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Status update error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/certificates/:id — Update certificate details
router.put('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { displayValue, typeText, validUntil, notes } = req.body;

        const existing = await pool.query('SELECT * FROM certificates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        const cert = existing.rows[0];

        await pool.query(
            `UPDATE certificates SET display_value = $1, type_text = $2, valid_until = $3, notes = $4, updated_at = NOW() WHERE id = $5`,
            [
                displayValue || cert.display_value,
                typeText || cert.type_text,
                validUntil || cert.valid_until,
                notes !== undefined ? notes : cert.notes,
                id
            ]
        );

        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['certificate_edit', req.user.username, JSON.stringify({ certCode: cert.cert_code })]
        );

        const updated = await pool.query('SELECT * FROM certificates WHERE id = $1', [id]);
        res.json(mapCertificateRow(updated.rows[0]));
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/certificates/:id — Delete certificate
router.delete('/:id', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        const existing = await client.query('SELECT * FROM certificates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        await client.query('BEGIN');

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['certificate_delete', req.user.username, JSON.stringify(mapCertificateRow(existing.rows[0]))]
        );

        await client.query('DELETE FROM certificates WHERE id = $1', [id]);
        await client.query('COMMIT');

        log.info(`Certificate ${existing.rows[0].cert_code} deleted by ${req.user.username}`);
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
