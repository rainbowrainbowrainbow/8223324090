/**
 * routes/bookings.js — Booking CRUD endpoints
 */
const router = require('express').Router();
const { pool, generateBookingNumber } = require('../db');
const { validateDate, validateTime, validateId, mapBookingRow, checkServerConflicts, checkServerDuplicate, checkRoomConflict, timeToMinutes } = require('../services/booking');
const { notifyTelegram } = require('../services/telegram');
const { processBookingAutomation } = require('../services/bookingAutomation');
const { broadcast } = require('../services/websocket');
const { createLogger } = require('../utils/logger');

const log = createLogger('Bookings');

// Resolve animator line name for notifications
async function getLineName(lineId, date) {
    try {
        const result = await pool.query(
            'SELECT name FROM lines_by_date WHERE line_id = $1 AND date = $2', [lineId, date]
        );
        return result.rows[0]?.name || null;
    } catch (err) {
        log.error(`Failed to get line name: ${err.message}`);
        return null;
    }
}

// Get bookings for a date
router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const result = await pool.query(
            "SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time",
            [date]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        log.error('Error fetching bookings', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create booking
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const b = req.body;
        if (!b.date || !b.time || !b.lineId) {
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0);
            if (conflict.overlap) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                });
            }

            const duplicate = await checkServerDuplicate(client, b.date, b.programId, b.time, b.duration || 0);
            if (duplicate) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
            }

            const roomConflict = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0);
            if (roomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }
        }

        if (!b.id || !/^BK-\d{4}-\d{4,}$/.test(b.id)) {
            b.id = await generateBookingNumber(client);
        }

        const insertResult = await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
             RETURNING *`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, b.skipNotification || false]
        );

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', b.createdBy || req.user?.username, JSON.stringify(b)]
        );

        await client.query('COMMIT');

        // v12.6: skip_notification flag — suppress all notifications
        if (!b.linkedTo && b.status !== 'preliminary' && !b.skipNotification) {
            getLineName(b.lineId, b.date).then(lineName => notifyTelegram('create', {
                ...b, label: b.label, program_code: b.programCode,
                program_name: b.programName, kids_count: b.kidsCount,
                created_by: b.createdBy
            }, { username: b.createdBy || req.user?.username, lineName }))
                .catch(err => log.error(`Telegram notify failed (create): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        if (!b.linkedTo) {
            processBookingAutomation(b)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        const booking = insertResult.rows[0] ? mapBookingRow(insertResult.rows[0]) : { id: b.id };

        // WebSocket: notify other clients
        broadcast('booking:created', booking, req.user?.id?.toString(), b.date);

        res.json({ success: true, booking });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create)', rbErr));
        log.error('Error creating booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Create booking with linked bookings in one transaction
router.post('/full', async (req, res) => {
    const client = await pool.connect();
    try {
        const { main, linked } = req.body;
        if (!main || !main.date || !main.time || !main.lineId) {
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        if (!validateDate(main.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(main.time)) { return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        const conflict = await checkServerConflicts(client, main.date, main.lineId, main.time, main.duration || 0);
        if (conflict.overlap) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
            });
        }

        const duplicate = await checkServerDuplicate(client, main.date, main.programId, main.time, main.duration || 0);
        if (duplicate) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
        }

        const roomConflict = await checkRoomConflict(client, main.date, main.room, main.time, main.duration || 0);
        if (roomConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Кімната "${main.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
            });
        }

        if (!main.id || !/^BK-\d{4}-\d{4,}$/.test(main.id)) {
            main.id = await generateBookingNumber(client);
        }

        const mainInsert = await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
             RETURNING *`,
            [main.id, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null, main.groupName || null, main.extraData ? JSON.stringify(main.extraData) : null, main.skipNotification || false]
        );

        const linkedRows = [];
        if (Array.isArray(linked)) {
            for (const lb of linked) {
                const lConflict = await checkServerConflicts(client, lb.date, lb.lineId, lb.time, lb.duration || 0);
                if (lConflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий у пов'язаного аніматора: ${lConflict.conflictWith.label || lConflict.conflictWith.program_code}`
                    });
                }

                const lbId = await generateBookingNumber(client);
                const lbInsert = await client.query(
                    `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                     RETURNING *`,
                    [lbId, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status || main.status || 'confirmed', lb.kidsCount || null, lb.groupName || main.groupName || null, lb.extraData ? JSON.stringify(lb.extraData) : (main.extraData ? JSON.stringify(main.extraData) : null)]
                );
                if (lbInsert.rows[0]) linkedRows.push(lbInsert.rows[0]);
            }
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', main.createdBy || req.user?.username, JSON.stringify(main)]
        );

        await client.query('COMMIT');

        // v12.6: skip_notification flag — suppress all notifications
        if (main.status !== 'preliminary' && !main.skipNotification) {
            getLineName(main.lineId, main.date).then(lineName => notifyTelegram('create', {
                ...main, program_code: main.programCode, program_name: main.programName,
                kids_count: main.kidsCount, created_by: main.createdBy
            }, { username: main.createdBy || req.user?.username, lineName }))
                .catch(err => log.error(`Telegram notify failed (create/full): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        processBookingAutomation(main)
            .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));

        const mainBooking = mainInsert.rows[0] ? mapBookingRow(mainInsert.rows[0]) : { id: main.id };
        const linkedBookings = linkedRows.map(mapBookingRow);

        // WebSocket: notify other clients
        broadcast('booking:created', mainBooking, req.user?.id?.toString(), main.date);

        res.json({ success: true, mainBooking, linkedBookings });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create/full)', rbErr));
        log.error('Error creating full booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Soft delete or permanent delete
router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const permanent = req.query.permanent === 'true';
        if (!validateId(id)) { return res.status(400).json({ error: 'Invalid booking ID' }); }

        await client.query('BEGIN');

        const bookingResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        const booking = bookingResult.rows[0];
        if (!booking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Бронювання не знайдено' });
        }

        const action = permanent ? 'permanent_delete' : 'delete';
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [action, req.user?.username, JSON.stringify(mapBookingRow(booking))]
        );

        if (permanent) {
            await client.query('DELETE FROM bookings WHERE id = $1 OR linked_to = $1', [id]);
        } else {
            await client.query(
                "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 OR linked_to = $1",
                [id]
            );
        }

        await client.query('COMMIT');

        getLineName(booking.line_id, booking.date).then(lineName =>
            notifyTelegram('delete', booking, { username: req.user?.username, lineName }))
            .catch(err => log.error(`Telegram notify failed (delete): ${err.message}`));

        // WebSocket: notify other clients
        broadcast('booking:deleted', { id, date: booking.date, permanent }, req.user?.id?.toString(), booking.date);

        res.json({ success: true, permanent });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (delete)', rbErr));
        log.error('Error deleting booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Update booking
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const b = req.body;
        const clientUpdatedAt = b.updatedAt || null; // optimistic locking
        if (!validateId(id)) { return res.status(400).json({ error: 'Invalid booking ID' }); }
        if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        const oldResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (oldResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        const oldBooking = oldResult.rows[0];

        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, id);
            if (conflict.overlap) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                });
            }

            // v12.6: Exclude linked bookings of this booking from room conflict check
            // (they will be deleted/recreated in the same transaction)
            const linkedIds = await client.query('SELECT id FROM bookings WHERE linked_to = $1', [id]);
            const excludeIds = [id, ...linkedIds.rows.map(r => r.id)];
            let roomConflict = null;
            const roomResult = await client.query(
                "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND status != 'cancelled' AND id != ALL($3::text[])",
                [b.date, b.room, excludeIds]
            );
            if (b.room && b.room !== 'Інше') {
                const newStart = timeToMinutes(b.time);
                const newEnd = newStart + (b.duration || 0);
                for (const rc of roomResult.rows) {
                    const rcStart = timeToMinutes(rc.time);
                    const rcEnd = rcStart + (rc.duration || 0);
                    if (newStart < rcEnd && newEnd > rcStart) {
                        roomConflict = rc;
                        break;
                    }
                }
            }
            if (roomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }
        }

        const newStatus = b.status || 'confirmed';

        let updateResult;
        if (clientUpdatedAt) {
            // Optimistic locking: check updated_at matches client's version
            // Use date_trunc('milliseconds', ...) because JS Date has only ms precision
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22
                 WHERE id=$23 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $24::timestamp)
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null,
                 id, clientUpdatedAt]
            );
        } else {
            // Legacy: no optimistic locking (backward compatibility)
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22
                 WHERE id=$23
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, id]
            );
        }

        // Optimistic locking: conflict detected (0 rows updated)
        if (updateResult.rowCount === 0) {
            const currentResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
            await client.query('ROLLBACK');

            if (currentResult.rows.length === 0) {
                return res.status(404).json({ error: 'Бронювання не знайдено' });
            }

            const currentBooking = mapBookingRow(currentResult.rows[0]);
            return res.status(409).json({
                success: false,
                error: 'Бронювання було змінено іншим користувачем',
                conflict: true,
                currentData: currentBooking
            });
        }

        const savedBooking = mapBookingRow(updateResult.rows[0]);

        // v8.7: Sync linked bookings when secondAnimator changes
        if (!b.linkedTo) {
            const linkedResult = await client.query('SELECT id, line_id FROM bookings WHERE linked_to = $1', [id]);
            const oldSecond = oldBooking.second_animator;
            const newSecond = b.secondAnimator;
            const secondChanged = (oldSecond || '') !== (newSecond || '');

            if (secondChanged && linkedResult.rows.length > 0) {
                // Delete old linked bookings — secondAnimator changed or was cleared
                for (const linked of linkedResult.rows) {
                    await client.query('DELETE FROM bookings WHERE id = $1', [linked.id]);
                }
                // Create new linked booking if secondAnimator is set
                if (newSecond) {
                    const lineRes = await client.query(
                        'SELECT line_id FROM lines_by_date WHERE name = $1 AND date = $2',
                        [newSecond, b.date]
                    );
                    if (lineRes.rows.length > 0) {
                        const newLinkedId = await generateBookingNumber(client);
                        await client.query(
                            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
                            [newLinkedId, b.date, b.time, lineRes.rows[0].line_id, b.programId, b.programCode,
                             b.label, b.programName, b.category, b.duration, b.price, b.hosts,
                             b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes,
                             b.createdBy, id, newStatus, b.kidsCount || null, b.groupName || null,
                             b.extraData ? JSON.stringify(b.extraData) : null]
                        );
                    } else {
                        log.warn(`Second animator line not found: "${newSecond}" on ${b.date}`);
                    }
                }
            } else if (!secondChanged) {
                // No change in secondAnimator — cascade basic fields to existing linked
                for (const linked of linkedResult.rows) {
                    await client.query(
                        `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, room=$5, updated_at=NOW() WHERE id=$6`,
                        [b.date, b.time, b.duration, newStatus, b.room, linked.id]
                    );
                }
            } else if (secondChanged && newSecond && linkedResult.rows.length === 0) {
                // Was missing linked booking (old bug) — create it now
                const lineRes = await client.query(
                    'SELECT line_id FROM lines_by_date WHERE name = $1 AND date = $2',
                    [newSecond, b.date]
                );
                if (lineRes.rows.length > 0) {
                    const newLinkedId = await generateBookingNumber(client);
                    await client.query(
                        `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
                        [newLinkedId, b.date, b.time, lineRes.rows[0].line_id, b.programId, b.programCode,
                         b.label, b.programName, b.category, b.duration, b.price, b.hosts,
                         b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes,
                         b.createdBy, id, newStatus, b.kidsCount || null, b.groupName || null,
                         b.extraData ? JSON.stringify(b.extraData) : null]
                    );
                } else {
                    log.warn(`Second animator line not found: "${newSecond}" on ${b.date}`);
                }
            }
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['edit', req.user?.username, JSON.stringify(b)]
        );

        await client.query('COMMIT');

        const username = req.user?.username;
        const bookingForNotify = {
            ...b, id, label: b.label, program_code: b.programCode,
            program_name: b.programName, kids_count: b.kidsCount,
            status: newStatus
        };

        const statusChanged = oldBooking.status !== newStatus;
        const notifyCatch = err => log.error(`Telegram notify failed (update): ${err.message}`);
        getLineName(b.lineId, b.date).then(lineName => {
            if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
                notifyTelegram('create', bookingForNotify, { username, bookingId: id, lineName }).catch(notifyCatch);
            } else if (statusChanged) {
                notifyTelegram('status_change', bookingForNotify, { username, bookingId: id, lineName }).catch(notifyCatch);
            } else if (!b.linkedTo && newStatus !== 'preliminary') {
                notifyTelegram('edit', bookingForNotify, { username, bookingId: id, lineName }).catch(notifyCatch);
            }
        }).catch(notifyCatch);
        if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
            // v8.3.2: Fetch fresh row from DB for automation (req.body may lack extra_data)
            pool.query('SELECT * FROM bookings WHERE id = $1', [id])
                .then(r => r.rows[0] ? processBookingAutomation({ ...mapBookingRow(r.rows[0]), _event: 'confirm' }) : null)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        // WebSocket: notify other clients
        broadcast('booking:updated', savedBooking, req.user?.id?.toString(), b.date);

        res.json({ success: true, booking: savedBooking });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (update)', rbErr));
        log.error('Error updating booking', err);
        res.status(500).json({ error: 'Failed to update booking' });
    } finally {
        client.release();
    }
});

module.exports = router;
