/**
 * routes/certificates.js — Certificate CRUD + status management
 * v8.4: Certificate registry with Telegram alerts
 */
const router = require('express').Router();
const { pool, generateCertCode } = require('../db');
const { requireRole } = require('../middleware/auth');
const { mapCertificateRow, calculateValidUntil, validateCertificateInput, getCurrentSeason, VALID_STATUSES, VALID_SEASONS } = require('../services/certificates');
const { sendTelegramMessage, sendTelegramPhoto, getConfiguredChatId, getBotUsername } = require('../services/telegram');
const { formatCertificateNotification, formatBatchCertificateNotification } = require('../services/templates');
const { publish: publishEvent } = require('../services/eventBus');
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

// v33.8.0: Validate certificate (must be before /:id to avoid route conflict)
router.get('/validate/', (req, res) => res.json({ valid: false, error: 'Код не вказано' }));
router.get('/validate/:code', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, cert_code, display_value, type_text, valid_until, status
             FROM certificates WHERE cert_code = $1`,
            [req.params.code.toUpperCase()]
        );
        if (!r.rowCount) return res.json({ valid: false, error: 'Сертифікат не знайдено' });
        const c = r.rows[0];
        const isExpired = c.valid_until && new Date(c.valid_until) < new Date();
        res.json({
            valid: c.status === 'active' && !isExpired,
            certificate: c,
            reason: c.status !== 'active' ? c.status : (isExpired ? 'expired' : null)
        });
    } catch (err) {
        log.error('Certificate validate error', err);
        res.status(500).json({ success: false, error: err.message });
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
router.post('/', requireRole('admin', 'user'), async (req, res) => {
    const client = await pool.connect();
    try {
        const errors = validateCertificateInput(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const { displayMode, displayValue, typeText, validUntil, notes, season } = req.body;

        // Validate season
        const finalSeason = VALID_SEASONS.includes(season) ? season : getCurrentSeason();

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
            `INSERT INTO certificates (cert_code, display_mode, display_value, type_text, valid_until, issued_by_user_id, issued_by_name, notes, season, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
             RETURNING *`,
            [
                certCode,
                displayMode || 'fio',
                (displayValue || '').trim(),
                typeText || 'на одноразовий вхід',
                finalValidUntil,
                req.user.id || null,
                req.user.name || req.user.username,
                notes || null,
                finalSeason
            ]
        );

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['certificate_create', req.user.username, JSON.stringify({
                certCode,
                displayMode: displayMode || 'fio',
                displayValue: (displayValue || '').trim(),
                typeText: typeText || 'на одноразовий вхід'
            })]
        );

        await client.query('COMMIT');

        const cert = result.rows[0];
        const mapped = mapCertificateRow(cert);

        // Telegram alert is now sent from frontend via POST /:id/send-image (with certificate image)

        // v19.1: Publish to event queue (triggers auto-print, logging rules)
        publishEvent('certificate.created', {
            cert_id: cert.id, cert_code: certCode,
            display_mode: displayMode || 'fio',
            display_value: (displayValue || '').trim(),
            type_text: typeText || 'на одноразовий вхід',
            valid_until: finalValidUntil,
            issued_by: req.user.username, season: finalSeason
        }, `cert_created_${certCode}`);

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

// POST /api/certificates/batch — Generate N blank certificates at once
router.post('/batch', requireRole('admin', 'user'), async (req, res) => {
    const client = await pool.connect();
    try {
        const quantity = parseInt(req.body.quantity);
        if (![5, 10, 15, 20].includes(quantity)) {
            return res.status(400).json({ error: 'Кількість має бути 5, 10, 15 або 20' });
        }

        const typeText = req.body.typeText || 'на одноразовий вхід';
        const validUntil = req.body.validUntil;
        const season = VALID_SEASONS.includes(req.body.season) ? req.body.season : getCurrentSeason();

        let defaultDays = 45;
        try {
            const settingResult = await client.query("SELECT value FROM settings WHERE key = 'cert_default_days'");
            if (settingResult.rows.length > 0 && settingResult.rows[0].value) {
                defaultDays = parseInt(settingResult.rows[0].value) || 45;
            }
        } catch (e) { /* use default */ }

        const finalValidUntil = validUntil || calculateValidUntil(new Date(), defaultDays);

        await client.query('BEGIN');

        const created = [];
        for (let i = 0; i < quantity; i++) {
            const certCode = await generateCertCode(client);
            const result = await client.query(
                `INSERT INTO certificates (cert_code, display_mode, display_value, type_text, valid_until, issued_by_user_id, issued_by_name, notes, season, status)
                 VALUES ($1, 'fio', '', $2, $3, $4, $5, $6, $7, 'active')
                 RETURNING *`,
                [
                    certCode,
                    typeText,
                    finalValidUntil,
                    req.user.id || null,
                    req.user.name || req.user.username,
                    `Пакетна генерація (${quantity} шт.)`,
                    season
                ]
            );
            created.push(mapCertificateRow(result.rows[0]));
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['certificate_batch', req.user.username, JSON.stringify({
                quantity,
                typeText,
                codes: created.map(c => c.certCode)
            })]
        );

        await client.query('COMMIT');
        log.info(`Batch certificates created: ${quantity} by ${req.user.username}`);

        // Telegram notification — fire-and-forget after commit
        const codes = created.map(c => c.certCode);
        (async () => {
            try {
                const text = formatBatchCertificateNotification(codes, {
                    username: req.user.name || req.user.username,
                    quantity,
                    typeText,
                    validUntil: finalValidUntil,
                    season
                });
                let chatId;
                try {
                    const dirResult = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
                    if (dirResult.rows.length > 0 && dirResult.rows[0].value) chatId = dirResult.rows[0].value;
                } catch (e) { /* fallback */ }
                if (!chatId) chatId = await getConfiguredChatId();
                if (chatId) await sendTelegramMessage(chatId, text);
            } catch (err) {
                log.error(`Telegram batch alert failed: ${err.message}`);
            }
        })();

        res.status(201).json({ success: true, certificates: created });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Batch create error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PATCH /api/certificates/:id/status — Change status
router.patch('/:id/status', requireRole('admin', 'user'), async (req, res) => {
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

        // v19.1: Publish status change event
        publishEvent(`certificate.${status}`, {
            cert_id: cert.id, cert_code: cert.cert_code,
            old_status: cert.status, new_status: status,
            reason: reason || null, changed_by: req.user.username
        }, `cert_${status}_${cert.cert_code}_${Date.now()}`);

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
router.put('/:id', requireRole('admin', 'user'), async (req, res) => {
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
router.delete('/:id', requireRole('admin', 'user'), async (req, res) => {
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

// POST /api/certificates/:id/send-image — Send certificate image to Telegram
router.post('/:id/send-image', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { id } = req.params;
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: 'imageBase64 is required' });
        }

        const existing = await pool.query('SELECT * FROM certificates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        const cert = existing.rows[0];
        const photoBuffer = Buffer.from(imageBase64, 'base64');

        // Build caption
        const mode = cert.display_mode === 'fio' ? 'ПІБ' : 'Номер';
        const validDate = cert.valid_until ? new Date(cert.valid_until).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '—';
        const caption = `📄 <b>Видано сертифікат</b>\n\n` +
            `🔑 <code>${cert.cert_code}</code>\n` +
            (cert.display_value ? `${mode}: ${cert.display_value}\n` : '') +
            `🏷 ${cert.type_text || 'на одноразовий вхід'}\n` +
            `⏰ Дійсний до: ${validDate}\n` +
            `👤 Видав: ${req.user.name || req.user.username}`;

        // Determine chat_id
        let chatId;
        try {
            const dirResult = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
            if (dirResult.rows.length > 0 && dirResult.rows[0].value) {
                chatId = dirResult.rows[0].value;
            }
        } catch (e) { /* fallback */ }
        if (!chatId) chatId = await getConfiguredChatId();
        if (!chatId) {
            return res.status(400).json({ error: 'Telegram chat not configured' });
        }

        const result = await sendTelegramPhoto(chatId, photoBuffer, caption);
        if (result && result.ok) {
            await pool.query('UPDATE certificates SET telegram_alert_sent = TRUE WHERE id = $1', [cert.id]);
            log.info(`Certificate ${cert.cert_code} image sent to Telegram by ${req.user.username}`);
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Telegram send failed' });
        }
    } catch (err) {
        log.error('Send image error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
