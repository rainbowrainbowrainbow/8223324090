/**
 * routes/recurring.js — Recurring Booking Templates CRUD + Series Operations
 *
 * Mount in server.js: app.use('/api/recurring', auth, recurringRoutes)
 *
 * Endpoints:
 *   GET    /api/recurring                         — list all templates
 *   POST   /api/recurring                         — create template + eager-generate
 *   PUT    /api/recurring/:id                     — update template
 *   DELETE /api/recurring/:id                     — delete template
 *   POST   /api/recurring/:id/pause               — toggle is_active
 *   POST   /api/recurring/:id/generate            — manually generate next N days
 *   GET    /api/recurring/:id/series              — list all instances of a template
 *   DELETE /api/recurring/:id/series/future        — delete future instances
 *   GET    /api/recurring/:id/skips               — list skips for a template
 *   POST   /api/recurring/:id/skips               — manually skip a date
 *   DELETE /api/recurring/skips/:skipId           — remove skip (allow retry)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate } = require('../services/booking');
const {
    generateBookingsForTemplate,
    generateAllRecurringBookings,
    mapTemplateRow,
    mapSkipRow,
    logSkip
} = require('../services/recurring');
const { mapBookingRow, getKyivDateStr } = require('../services/booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('RecurringAPI');

// Valid patterns for recurrence
const VALID_PATTERNS = ['weekly', 'biweekly', 'monthly', 'custom', 'weekdays', 'weekends'];

// --- Template CRUD ---

/**
 * GET /api/recurring — List all templates with instance counts
 */
router.get('/', async (req, res) => {
    try {
        const templates = await pool.query('SELECT * FROM recurring_templates ORDER BY created_at DESC');
        const result = [];

        for (const tpl of templates.rows) {
            // Count active instances
            const instanceCount = await pool.query(
                "SELECT COUNT(*) FROM bookings WHERE recurring_template_id = $1 AND status != 'cancelled'",
                [tpl.id]
            );
            // Count skips
            const skipCount = await pool.query(
                'SELECT COUNT(*) FROM recurring_booking_skips WHERE template_id = $1',
                [tpl.id]
            );
            // Next upcoming instance
            const todayStr = getKyivDateStr();
            const nextInstance = await pool.query(
                "SELECT date FROM bookings WHERE recurring_template_id = $1 AND date >= $2 AND status != 'cancelled' ORDER BY date LIMIT 1",
                [tpl.id, todayStr]
            );

            result.push({
                ...mapTemplateRow(tpl),
                instanceCount: parseInt(instanceCount.rows[0].count),
                skipCount: parseInt(skipCount.rows[0].count),
                nextDate: nextInstance.rows[0]?.date || null
            });
        }

        res.json(result);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('List templates error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/recurring — Create template + eager-generate for horizon
 */
router.post('/', async (req, res) => {
    try {
        const b = req.body;

        // Validate required fields
        if (!b.pattern || !VALID_PATTERNS.includes(b.pattern)) {
            return res.status(400).json({ error: `Invalid pattern. Must be one of: ${VALID_PATTERNS.join(', ')}` });
        }
        if (!b.startDate || !validateDate(b.startDate)) {
            return res.status(400).json({ error: 'Valid startDate required (YYYY-MM-DD)' });
        }
        if (!b.timeStart) {
            return res.status(400).json({ error: 'timeStart required (HH:MM)' });
        }
        if (!b.productId) {
            return res.status(400).json({ error: 'productId required' });
        }

        // Calculate time_end from time_start + duration
        const duration = b.duration || 60;
        const [h, m] = b.timeStart.split(':').map(Number);
        const endMinutes = h * 60 + m + duration;
        const timeEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

        // Parse days_of_week to Postgres array format
        const daysOfWeek = Array.isArray(b.daysOfWeek) ? b.daysOfWeek : null;

        const result = await pool.query(
            `INSERT INTO recurring_templates
             (pattern, days_of_week, interval_weeks, monthly_rule,
              start_date, end_date, time_start, time_end,
              preferred_line_name, room,
              product_id, product_code, product_label, product_name, category,
              duration, price, hosts,
              second_animator_name,
              pinata_filler, costume, kids_count, group_name, notes, extra_data,
              status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
             RETURNING *`,
            [
                b.pattern,
                daysOfWeek,
                b.intervalWeeks || 1,
                b.monthlyRule || null,
                b.startDate,
                b.endDate || null,
                b.timeStart,
                timeEnd,
                b.preferredLineName || null,
                b.room || null,
                b.productId,
                b.productCode || null,
                b.productLabel || null,
                b.productName || null,
                b.category || null,
                duration,
                b.price || null,
                b.hosts || 1,
                b.secondAnimatorName || null,
                b.pinataFiller || null,
                b.costume || null,
                b.kidsCount || null,
                b.groupName || null,
                b.notes || null,
                b.extraData ? JSON.stringify(b.extraData) : null,
                b.status || 'preliminary',
                req.user?.username || 'system'
            ]
        );

        const template = result.rows[0];

        // Eager-generate: create bookings for the generation horizon
        let generation = { created: 0, skipped: 0, conflicts: [] };
        try {
            let horizonDays = 14;
            try {
                const setting = await pool.query("SELECT value FROM settings WHERE key = 'recurring_booking_horizon'");
                if (setting.rows[0]) horizonDays = parseInt(setting.rows[0].value);
            } catch { /* use default */ }

            const todayStr = getKyivDateStr();
            const endDate = new Date(todayStr + 'T12:00:00');
            endDate.setDate(endDate.getDate() + horizonDays);
            const endDateStr = endDate.toISOString().split('T')[0];

            generation = await generateBookingsForTemplate(template, todayStr, endDateStr);
            log.info(`Template ${template.id} created + generated: ${generation.created} bookings, ${generation.skipped} skipped`);
        } catch (genErr) {
            log.error(`Eager-generate failed for template ${template.id}: ${genErr.message}`);
        }

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['recurring_template_create', req.user?.username || 'system', JSON.stringify({
                templateId: template.id,
                pattern: template.pattern,
                program: b.productLabel || b.productName,
                generated: generation.created
            })]
        ).catch(err => log.error('History log error', err));

        res.json({
            success: true,
            template: mapTemplateRow(template),
            generation
        });
    } catch (err) {
        log.error('Create template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/recurring/:id — Update template
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const b = req.body;

        // Verify template exists
        const existing = await pool.query('SELECT * FROM recurring_templates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        // Calculate time_end
        const duration = b.duration || existing.rows[0].duration || 60;
        let timeEnd = existing.rows[0].time_end;
        if (b.timeStart) {
            const [h, m] = b.timeStart.split(':').map(Number);
            const endMinutes = h * 60 + m + duration;
            timeEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
        }

        const daysOfWeek = b.daysOfWeek !== undefined
            ? (Array.isArray(b.daysOfWeek) ? b.daysOfWeek : null)
            : existing.rows[0].days_of_week;

        await pool.query(
            `UPDATE recurring_templates SET
             pattern = COALESCE($1, pattern),
             days_of_week = $2,
             interval_weeks = COALESCE($3, interval_weeks),
             monthly_rule = $4,
             start_date = COALESCE($5, start_date),
             end_date = $6,
             time_start = COALESCE($7, time_start),
             time_end = $8,
             preferred_line_name = $9,
             room = $10,
             product_id = COALESCE($11, product_id),
             product_code = $12,
             product_label = $13,
             product_name = $14,
             category = $15,
             duration = COALESCE($16, duration),
             price = $17,
             hosts = COALESCE($18, hosts),
             second_animator_name = $19,
             pinata_filler = $20,
             costume = $21,
             kids_count = $22,
             group_name = $23,
             notes = $24,
             extra_data = $25,
             status = COALESCE($26, status),
             updated_at = NOW()
             WHERE id = $27`,
            [
                b.pattern || null,
                daysOfWeek,
                b.intervalWeeks || null,
                b.monthlyRule !== undefined ? b.monthlyRule : existing.rows[0].monthly_rule,
                b.startDate || null,
                b.endDate !== undefined ? b.endDate : existing.rows[0].end_date,
                b.timeStart || null,
                timeEnd,
                b.preferredLineName !== undefined ? b.preferredLineName : existing.rows[0].preferred_line_name,
                b.room !== undefined ? b.room : existing.rows[0].room,
                b.productId || null,
                b.productCode !== undefined ? b.productCode : existing.rows[0].product_code,
                b.productLabel !== undefined ? b.productLabel : existing.rows[0].product_label,
                b.productName !== undefined ? b.productName : existing.rows[0].product_name,
                b.category !== undefined ? b.category : existing.rows[0].category,
                b.duration || null,
                b.price !== undefined ? b.price : existing.rows[0].price,
                b.hosts || null,
                b.secondAnimatorName !== undefined ? b.secondAnimatorName : existing.rows[0].second_animator_name,
                b.pinataFiller !== undefined ? b.pinataFiller : existing.rows[0].pinata_filler,
                b.costume !== undefined ? b.costume : existing.rows[0].costume,
                b.kidsCount !== undefined ? b.kidsCount : existing.rows[0].kids_count,
                b.groupName !== undefined ? b.groupName : existing.rows[0].group_name,
                b.notes !== undefined ? b.notes : existing.rows[0].notes,
                b.extraData !== undefined ? (b.extraData ? JSON.stringify(b.extraData) : null) : existing.rows[0].extra_data,
                b.status || null,
                id
            ]
        );

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['recurring_template_edit', req.user?.username || 'system', JSON.stringify({ templateId: parseInt(id), changes: Object.keys(b) })]
        ).catch(err => log.error('History log error', err));

        // Fetch updated template
        const updated = await pool.query('SELECT * FROM recurring_templates WHERE id = $1', [id]);
        res.json({ success: true, template: mapTemplateRow(updated.rows[0]) });
    } catch (err) {
        log.error('Update template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/recurring/:id — Delete template (soft: deactivate + optionally cancel future bookings)
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteFuture = req.query.deleteFuture === 'true';

        const existing = await pool.query('SELECT * FROM recurring_templates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        // Deactivate template
        await pool.query('UPDATE recurring_templates SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);

        let cancelledCount = 0;
        if (deleteFuture) {
            const todayStr = getKyivDateStr();
            // Cancel all future instances (soft delete)
            const cancelled = await pool.query(
                `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
                 WHERE recurring_template_id = $1 AND date >= $2 AND status != 'cancelled'
                 RETURNING id`,
                [id, todayStr]
            );
            cancelledCount = cancelled.rowCount;
        }

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['recurring_template_delete', req.user?.username || 'system', JSON.stringify({
                templateId: parseInt(id),
                program: existing.rows[0].product_name || existing.rows[0].product_label,
                cancelledFuture: cancelledCount
            })]
        ).catch(err => log.error('History log error', err));

        res.json({ success: true, cancelledBookings: cancelledCount });
    } catch (err) {
        log.error('Delete template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/recurring/:id/pause — Toggle is_active (pause/resume)
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT is_active FROM recurring_templates WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        const newState = !existing.rows[0].is_active;
        await pool.query(
            'UPDATE recurring_templates SET is_active = $1, updated_at = NOW() WHERE id = $2',
            [newState, id]
        );

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [newState ? 'recurring_template_resume' : 'recurring_template_pause',
             req.user?.username || 'system',
             JSON.stringify({ templateId: parseInt(id) })]
        ).catch(err => log.error('History log error', err));

        res.json({ success: true, isActive: newState });
    } catch (err) {
        log.error('Pause template error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/recurring/:id/generate — Manually generate bookings for N days
 */
router.post('/:id/generate', async (req, res) => {
    try {
        const { id } = req.params;
        const horizonDays = parseInt(req.body.horizonDays) || 14;

        const template = await pool.query('SELECT * FROM recurring_templates WHERE id = $1', [id]);
        if (template.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        const todayStr = getKyivDateStr();
        const endDate = new Date(todayStr + 'T12:00:00');
        endDate.setDate(endDate.getDate() + horizonDays);
        const endDateStr = endDate.toISOString().split('T')[0];

        const result = await generateBookingsForTemplate(template.rows[0], todayStr, endDateStr);

        log.info(`Manual generate template ${id}: created=${result.created}, skipped=${result.skipped}`);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Manual generate error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/recurring/generate-all — Manually trigger generation for all templates
 */
router.post('/generate-all', async (req, res) => {
    try {
        const horizonDays = parseInt(req.body.horizonDays) || undefined;
        const result = await generateAllRecurringBookings(horizonDays);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Generate all error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Series Operations ---

/**
 * GET /api/recurring/:id/series — List all booking instances of a template
 */
router.get('/:id/series', async (req, res) => {
    try {
        const { id } = req.params;
        const { from, to } = req.query;

        let query = "SELECT * FROM bookings WHERE recurring_template_id = $1 AND linked_to IS NULL";
        const params = [id];

        if (from && validateDate(from)) {
            params.push(from);
            query += ` AND date >= $${params.length}`;
        }
        if (to && validateDate(to)) {
            params.push(to);
            query += ` AND date <= $${params.length}`;
        }

        query += ' ORDER BY date, time';

        const result = await pool.query(query, params);
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        log.error('List series error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/recurring/:id/series/future — Delete (cancel) all future instances from a date
 */
router.delete('/:id/series/future', async (req, res) => {
    try {
        const { id } = req.params;
        const fromDate = req.query.from || getKyivDateStr();

        if (!validateDate(fromDate)) {
            return res.status(400).json({ error: 'Invalid from date' });
        }

        // Cancel main bookings + their linked bookings
        const mainIds = await pool.query(
            `SELECT id FROM bookings
             WHERE recurring_template_id = $1 AND date >= $2 AND status != 'cancelled' AND linked_to IS NULL`,
            [id, fromDate]
        );

        let cancelledCount = 0;
        for (const row of mainIds.rows) {
            const cancelled = await pool.query(
                "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 OR linked_to = $1 RETURNING id",
                [row.id]
            );
            cancelledCount += cancelled.rowCount;
        }

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['recurring_series_cancel', req.user?.username || 'system', JSON.stringify({
                templateId: parseInt(id), fromDate, cancelledCount
            })]
        ).catch(err => log.error('History log error', err));

        res.json({ success: true, cancelledCount });
    } catch (err) {
        log.error('Cancel future series error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Skip Management ---

/**
 * GET /api/recurring/:id/skips — List skips for a template
 */
router.get('/:id/skips', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM recurring_booking_skips WHERE template_id = $1 ORDER BY date DESC',
            [id]
        );
        res.json(result.rows.map(mapSkipRow));
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('List skips error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/recurring/:id/skips — Manually skip a date
 */
router.post('/:id/skips', async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.body;

        if (!date || !validateDate(date)) {
            return res.status(400).json({ error: 'Valid date required' });
        }

        // Verify template exists
        const tpl = await pool.query('SELECT id FROM recurring_templates WHERE id = $1', [id]);
        if (tpl.rows.length === 0) {
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        await logSkip(parseInt(id), date, 'manual_skip', `Manually skipped by ${req.user?.username || 'system'}`);

        // Also cancel existing booking for this date if it exists
        const cancelled = await pool.query(
            `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
             WHERE recurring_template_id = $1 AND date = $2 AND status != 'cancelled'
             RETURNING id`,
            [id, date]
        );

        res.json({ success: true, cancelledBookings: cancelled.rowCount });
    } catch (err) {
        log.error('Manual skip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/recurring/skips/:skipId — Remove skip (allow retry generation)
 */
router.delete('/skips/:skipId', async (req, res) => {
    try {
        const { skipId } = req.params;
        const result = await pool.query(
            'DELETE FROM recurring_booking_skips WHERE id = $1 RETURNING template_id, date',
            [skipId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Skip not found' });
        }
        res.json({ success: true, removed: result.rows[0] });
    } catch (err) {
        log.error('Remove skip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
