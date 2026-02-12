/**
 * routes/bookings.js — Booking CRUD endpoints
 */
const router = require('express').Router();
const { pool, generateBookingNumber } = require('../db');
const { validateDate, validateTime, validateId, mapBookingRow, checkServerConflicts, checkServerDuplicate, checkRoomConflict } = require('../services/booking');
const { notifyTelegram } = require('../services/telegram');
const { processBookingAutomation } = require('../services/bookingAutomation');
const { createLogger } = require('../utils/logger');

const log = createLogger('Bookings');

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
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
             RETURNING *`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null]
        );

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', b.createdBy || req.user?.username, JSON.stringify(b)]
        );

        await client.query('COMMIT');

        if (!b.linkedTo && b.status !== 'preliminary') {
            notifyTelegram('create', {
                ...b, label: b.label, program_code: b.programCode,
                program_name: b.programName, kids_count: b.kidsCount,
                created_by: b.createdBy
            }, { username: b.createdBy || req.user?.username })
                .catch(err => log.error(`Telegram notify failed (create): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        if (!b.linkedTo) {
            processBookingAutomation(b)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        const booking = insertResult.rows[0] ? mapBookingRow(insertResult.rows[0]) : { id: b.id };

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
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
             RETURNING *`,
            [main.id, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null, main.groupName || null, main.extraData ? JSON.stringify(main.extraData) : null]
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
                    `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
                     RETURNING *`,
                    [lbId, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status || main.status || 'confirmed', lb.kidsCount || null, lb.groupName || main.groupName || null]
                );
                if (lbInsert.rows[0]) linkedRows.push(lbInsert.rows[0]);
            }
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', main.createdBy || req.user?.username, JSON.stringify(main)]
        );

        await client.query('COMMIT');

        if (main.status !== 'preliminary') {
            notifyTelegram('create', {
                ...main, program_code: main.programCode, program_name: main.programName,
                kids_count: main.kidsCount, created_by: main.createdBy
            }, { username: main.createdBy || req.user?.username })
                .catch(err => log.error(`Telegram notify failed (create/full): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        processBookingAutomation(main)
            .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));

        const mainBooking = mainInsert.rows[0] ? mapBookingRow(mainInsert.rows[0]) : { id: main.id };
        const linkedBookings = linkedRows.map(mapBookingRow);

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

        notifyTelegram('delete', booking, { username: req.user?.username })
            .catch(err => log.error(`Telegram notify failed (delete): ${err.message}`));

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

            const roomConflict = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0, id);
            if (roomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }
        }

        const newStatus = b.status || 'confirmed';

        await client.query(
            `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
             label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
             second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
             linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, updated_at=NOW()
             WHERE id=$23`,
            [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
             b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
             b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
             b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, id]
        );

        if (!b.linkedTo) {
            const linkedResult = await client.query('SELECT id FROM bookings WHERE linked_to = $1', [id]);
            for (const linked of linkedResult.rows) {
                // v7.9.3: Also cascade room (was missing — linked kept old room on edit)
                await client.query(
                    `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, room=$5, updated_at=NOW() WHERE id=$6`,
                    [b.date, b.time, b.duration, newStatus, b.room, linked.id]
                );
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
        if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
            notifyTelegram('create', bookingForNotify, { username, bookingId: id }).catch(notifyCatch);
            // v8.3.2: Fetch fresh row from DB for automation (req.body may lack extra_data)
            pool.query('SELECT * FROM bookings WHERE id = $1', [id])
                .then(r => r.rows[0] ? processBookingAutomation({ ...mapBookingRow(r.rows[0]), _event: 'confirm' }) : null)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        } else if (statusChanged) {
            notifyTelegram('status_change', bookingForNotify, { username, bookingId: id }).catch(notifyCatch);
        } else if (!b.linkedTo && newStatus !== 'preliminary') {
            notifyTelegram('edit', bookingForNotify, { username, bookingId: id }).catch(notifyCatch);
        }

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (update)', rbErr));
        log.error('Error updating booking', err);
        res.status(500).json({ error: 'Failed to update booking' });
    } finally {
        client.release();
    }
});

module.exports = router;
