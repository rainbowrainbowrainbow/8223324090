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
const { normalizePinataFields } = require('../services/pinataMode');
const { insertHistory } = require('../services/historyLog');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const { canonicalizeBookingRoomResource } = require('../services/timelineResources');
const { DEFAULT_TIMELINE_CONTEXT } = require('../services/timelineContext');
const {
    BookingCancellationGuardError,
    assertNoActiveBanquetBookingsInCancellationSet,
    isBookingCancellationConcurrencyError,
    lockBookingCancellationSet
} = require('../services/bookingCancellationGuard');
const {
    hasTicketQuoteInput,
    hasTicketSnapshotFields,
    readAdmissionTicketSnapshot
} = require('../services/admissionTickets');

const log = createLogger('RecurringAPI');

// All recurring routes require authentication
router.use(authenticateToken);

function normalizeRecurringPinataFields(body) {
    const normalized = normalizePinataFields({
        pinataMode: body.pinataMode,
        pinataNumber: body.pinataNumber,
        pinataFillerNumber: body.pinataFillerNumber,
        pinataFiller: body.pinataFiller,
        clientPinataServicePrice: body.clientPinataServicePrice,
        clientPinataServiceNote: body.clientPinataServiceNote,
        programId: body.productId,
        category: body.category
    });
    if (normalized.error) return normalized;

    body.pinataMode = normalized.pinataMode;
    body.pinataNumber = normalized.pinataNumber;
    body.pinataFillerNumber = normalized.pinataFillerNumber;
    body.pinataFiller = normalized.pinataFiller;
    body.clientPinataServicePrice = normalized.clientPinataServicePrice;
    body.clientPinataServiceNote = normalized.clientPinataServiceNote;
    if (normalized.pinataMode === 'client') {
        body.price = normalized.clientPinataServicePrice ?? 0;
    } else if (normalized.pinataMode === 'none'
        && (body.category === 'pinata' || String(body.productId || '').startsWith('pinata'))) {
        body.price = 0;
    }
    return normalized;
}

// Valid patterns for recurrence
const VALID_PATTERNS = ['weekly', 'biweekly', 'monthly', 'custom', 'weekdays', 'weekends'];

function hasRecurringTicketPayload(booking = {}) {
    if (!booking || typeof booking !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(booking, 'ticketQuantities')
        || Object.prototype.hasOwnProperty.call(booking, 'ticket_quantities')
        || hasTicketQuoteInput(booking)
        || hasTicketSnapshotFields(booking)
        || Boolean(readAdmissionTicketSnapshot(booking));
}

function rejectRecurringTicketPayload(res, booking = {}) {
    if (!hasRecurringTicketPayload(booking)) return false;
    res.status(422).json({
        success: false,
        code: 'TICKET_RECURRING_UNSUPPORTED',
        error: 'Ticket snapshots are not supported for recurring bookings; quote each occurrence separately'
    });
    return true;
}

function sendRecurringCancellationError(res, err) {
    if (isBookingCancellationConcurrencyError(err)) {
        res.status(409).json({
            success: false,
            code: 'BOOKING_CANCELLATION_CONCURRENT_UPDATE',
            error: 'Скасування зупинено через одночасну зміну даних. Оновіть сторінку та повторіть дію.'
        });
        return true;
    }
    if (!(err instanceof BookingCancellationGuardError)) return false;
    res.status(err.status).json({
        success: false,
        code: err.code,
        error: err.publicMessage,
        details: err.details
    });
    return true;
}

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
        if (rejectRecurringTicketPayload(res, b)) return;

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
        const pinataFields = normalizeRecurringPinataFields(b);
        if (pinataFields.error) return res.status(400).json({ error: pinataFields.error });
        const roomIdentity = {
            room: b.room || null,
            roomResourceId: b.roomResourceId || b.room_resource_id || null
        };
        if (roomIdentity.room || roomIdentity.roomResourceId) {
            try {
                await canonicalizeBookingRoomResource(pool, DEFAULT_TIMELINE_CONTEXT, roomIdentity);
            } catch (error) {
                if (String(error?.code || '').startsWith('ROOM_RESOURCE_')) {
                    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
                }
                throw error;
            }
        }

        const result = await pool.query(
            `INSERT INTO recurring_templates
             (pattern, days_of_week, interval_weeks, monthly_rule,
              start_date, end_date, time_start, time_end,
              preferred_line_name, room, room_resource_id,
              product_id, product_code, product_label, product_name, category,
              duration, price, hosts,
              second_animator_name,
              pinata_filler, pinata_mode, pinata_number, pinata_filler_number,
              client_pinata_service_price, client_pinata_service_note,
              costume, kids_count, group_name, notes, extra_data,
              status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$33,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
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
                roomIdentity.room || null,
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
                b.pinataMode || 'none',
                b.pinataNumber || null,
                b.pinataFillerNumber || null,
                b.clientPinataServicePrice ?? null,
                b.clientPinataServiceNote || null,
                b.costume || null,
                b.kidsCount || null,
                b.groupName || null,
                b.notes || null,
                b.extraData ? JSON.stringify(b.extraData) : null,
                b.status || 'preliminary',
                req.user?.username || 'system',
                roomIdentity.roomResourceId || null
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
        await insertHistory(pool, {
            action: 'recurring_template_create',
            username: req.user?.username || 'system',
            data: {
                templateId: template.id,
                pattern: template.pattern,
                program: b.productLabel || b.productName,
                generated: generation.created
            }
        }).catch(err => log.error('History log error', err));

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
        if (rejectRecurringTicketPayload(res, b)) return;

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
        const existingRow = existing.rows[0];
        b.productId = b.productId !== undefined ? b.productId : existingRow.product_id;
        b.category = b.category !== undefined ? b.category : existingRow.category;
        b.pinataMode = b.pinataMode !== undefined ? b.pinataMode : existingRow.pinata_mode;
        b.pinataNumber = b.pinataNumber !== undefined ? b.pinataNumber : existingRow.pinata_number;
        b.pinataFillerNumber = b.pinataFillerNumber !== undefined ? b.pinataFillerNumber : existingRow.pinata_filler_number;
        b.pinataFiller = b.pinataFiller !== undefined ? b.pinataFiller : existingRow.pinata_filler;
        b.clientPinataServicePrice = b.clientPinataServicePrice !== undefined
            ? b.clientPinataServicePrice
            : existingRow.client_pinata_service_price;
        b.clientPinataServiceNote = b.clientPinataServiceNote !== undefined
            ? b.clientPinataServiceNote
            : existingRow.client_pinata_service_note;
        const pinataFields = normalizeRecurringPinataFields(b);
        if (pinataFields.error) return res.status(400).json({ error: pinataFields.error });
        const roomIdentity = {
            room: b.room !== undefined ? b.room : existingRow.room,
            roomResourceId: b.roomResourceId !== undefined
                ? b.roomResourceId
                : (b.room_resource_id !== undefined ? b.room_resource_id : existingRow.room_resource_id)
        };
        if (roomIdentity.room || roomIdentity.roomResourceId) {
            try {
                await canonicalizeBookingRoomResource(pool, DEFAULT_TIMELINE_CONTEXT, roomIdentity, {
                    allowInactiveResourceId: existingRow.room_resource_id || null
                });
            } catch (error) {
                if (String(error?.code || '').startsWith('ROOM_RESOURCE_')) {
                    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
                }
                throw error;
            }
        }

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
             room_resource_id = $33,
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
             pinata_mode = $21,
             pinata_number = $22,
             pinata_filler_number = $23,
             client_pinata_service_price = $24,
             client_pinata_service_note = $25,
             costume = $26,
             kids_count = $27,
             group_name = $28,
             notes = $29,
             extra_data = $30,
             status = COALESCE($31, status),
             updated_at = NOW()
             WHERE id = $32`,
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
                roomIdentity.room || null,
                b.productId || null,
                b.productCode !== undefined ? b.productCode : existing.rows[0].product_code,
                b.productLabel !== undefined ? b.productLabel : existing.rows[0].product_label,
                b.productName !== undefined ? b.productName : existing.rows[0].product_name,
                b.category !== undefined ? b.category : existing.rows[0].category,
                b.duration || null,
                b.price !== undefined ? b.price : existing.rows[0].price,
                b.hosts || null,
                b.secondAnimatorName !== undefined ? b.secondAnimatorName : existing.rows[0].second_animator_name,
                b.pinataFiller,
                b.pinataMode,
                b.pinataNumber,
                b.pinataFillerNumber,
                b.clientPinataServicePrice,
                b.clientPinataServiceNote,
                b.costume !== undefined ? b.costume : existing.rows[0].costume,
                b.kidsCount !== undefined ? b.kidsCount : existing.rows[0].kids_count,
                b.groupName !== undefined ? b.groupName : existing.rows[0].group_name,
                b.notes !== undefined ? b.notes : existing.rows[0].notes,
                b.extraData !== undefined ? (b.extraData ? JSON.stringify(b.extraData) : null) : existing.rows[0].extra_data,
                b.status || null,
                id,
                roomIdentity.roomResourceId || null
            ]
        );

        // Log to history
        await insertHistory(pool, {
            action: 'recurring_template_edit',
            username: req.user?.username || 'system',
            data: { templateId: parseInt(id), changes: Object.keys(b) }
        }).catch(err => log.error('History log error', err));

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
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const deleteFuture = req.query.deleteFuture === 'true';

        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const existing = await client.query('SELECT * FROM recurring_templates WHERE id = $1 FOR UPDATE', [id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        let cancelledCount = 0;
        if (deleteFuture) {
            const todayStr = getKyivDateStr();
            const candidates = await client.query(
                `SELECT id FROM bookings
                  WHERE recurring_template_id = $1 AND date >= $2 AND status != 'cancelled'
                  ORDER BY id`,
                [id, todayStr]
            );
            const bookingIds = candidates.rows.map(row => row.id);
            await assertNoActiveBanquetBookingsInCancellationSet(client, {
                bookingIds,
                operation: 'recurring_template_delete_future'
            });
            await lockBookingCancellationSet(client, bookingIds);
            await assertNoActiveBanquetBookingsInCancellationSet(client, {
                bookingIds,
                operation: 'recurring_template_delete_future'
            });
            if (bookingIds.length) {
                const cancelled = await client.query(
                    `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
                      WHERE id = ANY($1::text[]) AND status != 'cancelled'
                      RETURNING id`,
                    [bookingIds]
                );
                cancelledCount = cancelled.rowCount;
            }
        }

        await client.query('UPDATE recurring_templates SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);

        // Log to history
        await insertHistory(client, {
            action: 'recurring_template_delete',
            username: req.user?.username || 'system',
            data: {
                templateId: parseInt(id),
                program: existing.rows[0].product_name || existing.rows[0].product_label,
                cancelledFuture: cancelledCount
            }
        }).catch(err => log.error('History log error', err));

        await client.query('COMMIT');

        res.json({ success: true, cancelledBookings: cancelledCount });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (sendRecurringCancellationError(res, err)) return;
        log.error('Delete template error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
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
        await insertHistory(pool, {
            action: newState ? 'recurring_template_resume' : 'recurring_template_pause',
            username: req.user?.username || 'system',
            data: { templateId: parseInt(id) }
        }).catch(err => log.error('History log error', err));

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
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.publicMessage || 'Internal server error',
            code: err.code || 'internal_error',
            details: err.details || undefined
        });
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
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.publicMessage || 'Internal server error',
            code: err.code || 'internal_error',
            details: err.details || undefined
        });
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
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const fromDate = req.query.from || getKyivDateStr();

        if (!validateDate(fromDate)) {
            return res.status(400).json({ error: 'Invalid from date' });
        }

        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const mainIds = await client.query(
            `SELECT id FROM bookings
             WHERE recurring_template_id = $1 AND date >= $2 AND status != 'cancelled' AND linked_to IS NULL
             ORDER BY id`,
            [id, fromDate]
        );

        const rootIds = mainIds.rows.map(row => row.id);
        const targetRows = rootIds.length
            ? await client.query(
                `SELECT id FROM bookings
                  WHERE id = ANY($1::text[]) OR linked_to = ANY($1::text[])
                  ORDER BY id`,
                [rootIds]
            )
            : { rows: [] };
        const bookingIds = targetRows.rows.map(row => row.id);
        await assertNoActiveBanquetBookingsInCancellationSet(client, {
            bookingIds,
            operation: 'recurring_series_cancel_future'
        });
        await lockBookingCancellationSet(client, bookingIds);
        await assertNoActiveBanquetBookingsInCancellationSet(client, {
            bookingIds,
            operation: 'recurring_series_cancel_future'
        });
        const cancelled = bookingIds.length
            ? await client.query(
                `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
                  WHERE id = ANY($1::text[]) AND status != 'cancelled'
                  RETURNING id`,
                [bookingIds]
            )
            : { rowCount: 0 };
        const cancelledCount = cancelled.rowCount;

        // Log to history
        await insertHistory(client, {
            action: 'recurring_series_cancel',
            username: req.user?.username || 'system',
            data: {
                templateId: parseInt(id), fromDate, cancelledCount
            }
        }).catch(err => log.error('History log error', err));

        await client.query('COMMIT');

        res.json({ success: true, cancelledCount });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (sendRecurringCancellationError(res, err)) return;
        log.error('Cancel future series error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
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
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { date } = req.body;

        if (!date || !validateDate(date)) {
            return res.status(400).json({ error: 'Valid date required' });
        }

        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const tpl = await client.query('SELECT id FROM recurring_templates WHERE id = $1 FOR UPDATE', [id]);
        if (tpl.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Шаблон не знайдено' });
        }

        const candidates = await client.query(
            `SELECT id FROM bookings
              WHERE recurring_template_id = $1 AND date = $2 AND status != 'cancelled'
              ORDER BY id`,
            [id, date]
        );
        const bookingIds = candidates.rows.map(row => row.id);
        await assertNoActiveBanquetBookingsInCancellationSet(client, {
            bookingIds,
            operation: 'recurring_manual_skip'
        });
        await lockBookingCancellationSet(client, bookingIds);
        await assertNoActiveBanquetBookingsInCancellationSet(client, {
            bookingIds,
            operation: 'recurring_manual_skip'
        });

        await logSkip(
            parseInt(id),
            date,
            'manual_skip',
            `Manually skipped by ${req.user?.username || 'system'}`,
            { queryable: client, throwOnError: true }
        );

        // Also cancel existing booking for this date if it exists
        const cancelled = bookingIds.length ? await client.query(
            `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
             WHERE id = ANY($1::text[]) AND status != 'cancelled'
             RETURNING id`,
            [bookingIds]
        ) : { rowCount: 0 };

        await client.query('COMMIT');

        res.json({ success: true, cancelledBookings: cancelled.rowCount });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (sendRecurringCancellationError(res, err)) return;
        log.error('Manual skip error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
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
