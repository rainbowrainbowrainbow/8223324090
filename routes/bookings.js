/**
 * routes/bookings.js — Booking CRUD endpoints
 *
 * v5.25: Uses asyncHandler + custom errors instead of manual try/catch.
 * Validation runs BEFORE pool.connect() to avoid wasting DB connections.
 * Transaction errors: catch → ROLLBACK → re-throw → errorHandler responds.
 */

const express = require('express');
const { pool } = require('../db');
const {
    validateDate, validateTime, validateId,
    checkServerConflicts, checkServerDuplicate, checkRoomConflict,
    generateBookingNumber, mapBookingRow
} = require('../services/booking');
const { notifyTelegram } = require('../services/telegram');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError, NotFoundError, ConflictError } = require('../middleware/errors');

const router = express.Router();

// --- Helpers ---

function validateBookingInput(b) {
    if (!b.date || !b.time || !b.lineId) throw new ValidationError('Missing required fields: date, time, lineId');
    if (!validateDate(b.date)) throw new ValidationError('Invalid date format');
    if (!validateTime(b.time)) throw new ValidationError('Invalid time format');
}

function conflictMessage(conflict) {
    return `Час зайнятий: ${conflict.label || conflict.program_code} о ${conflict.time}`;
}

function roomConflictMessage(room, conflict) {
    return `Кімната "${room}" зайнята: ${conflict.label || conflict.program_code} о ${conflict.time}`;
}

async function checkAllConflicts(client, date, lineId, time, duration, room, excludeId) {
    const conflict = await checkServerConflicts(client, date, lineId, time, duration, excludeId);
    if (conflict.overlap) {
        throw new ConflictError(conflictMessage(conflict.conflictWith));
    }

    if (!excludeId) {
        const duplicate = await checkServerDuplicate(client, date, null, time, duration);
        if (duplicate) {
            throw new ConflictError('Ця програма вже є в цей час');
        }
    }

    const roomConf = await checkRoomConflict(client, date, room, time, duration, excludeId);
    if (roomConf) {
        throw new ConflictError(roomConflictMessage(room, roomConf));
    }
}

// --- Routes ---

// Get bookings for a date
router.get('/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    if (!validateDate(date)) throw new ValidationError('Invalid date format');
    const result = await pool.query(
        'SELECT * FROM bookings WHERE date = $1 AND status != \'cancelled\' ORDER BY time',
        [date]
    );
    res.json(result.rows.map(mapBookingRow));
}));

// Create booking
router.post('/', asyncHandler(async (req, res) => {
    const b = req.body;
    validateBookingInput(b);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!b.linkedTo) {
            await checkAllConflicts(client, b.date, b.lineId, b.time, b.duration || 0, b.room);
        }

        if (!b.id || !/^BK-\d{4}-\d{4,}$/.test(b.id)) {
            b.id = await generateBookingNumber(client);
        }

        await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null]
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
            }, { username: b.createdBy || req.user?.username });
        }

        res.json({ success: true, id: b.id });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}));

// Create booking with linked bookings
router.post('/full', asyncHandler(async (req, res) => {
    const { main, linked } = req.body;
    if (!main) throw new ValidationError('Missing main booking');
    validateBookingInput(main);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await checkAllConflicts(client, main.date, main.lineId, main.time, main.duration || 0, main.room);

        if (!main.id || !/^BK-\d{4}-\d{4,}$/.test(main.id)) {
            main.id = await generateBookingNumber(client);
        }

        await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
            [main.id, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null]
        );

        const linkedIds = [];
        if (Array.isArray(linked)) {
            for (const lb of linked) {
                const lConflict = await checkServerConflicts(client, lb.date, lb.lineId, lb.time, lb.duration || 0);
                if (lConflict.overlap) {
                    throw new ConflictError(`Час зайнятий у пов'язаного аніматора: ${lConflict.conflictWith.label || lConflict.conflictWith.program_code}`);
                }

                const lbId = await generateBookingNumber(client);
                await client.query(
                    `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
                    [lbId, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status || main.status || 'confirmed', lb.kidsCount || null]
                );
                linkedIds.push(lbId);
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
            }, { username: main.createdBy || req.user?.username });
        }

        res.json({ success: true, id: main.id, linkedIds });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}));

// Delete booking (soft or permanent)
router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const permanent = req.query.permanent === 'true';
    if (!validateId(id)) throw new ValidationError('Invalid booking ID');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const bookingResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        const booking = bookingResult.rows[0];
        if (!booking) throw new NotFoundError('Бронювання не знайдено');

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
        notifyTelegram('delete', booking, { username: req.user?.username });
        res.json({ success: true, permanent });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}));

// Update booking
router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const b = req.body;
    if (!validateId(id)) throw new ValidationError('Invalid booking ID');
    validateBookingInput(b);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const oldResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (oldResult.rows.length === 0) throw new NotFoundError('Бронювання не знайдено');
        const oldBooking = oldResult.rows[0];

        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, id);
            if (conflict.overlap) {
                throw new ConflictError(conflictMessage(conflict.conflictWith));
            }

            const roomConf = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0, id);
            if (roomConf) {
                throw new ConflictError(roomConflictMessage(b.room, roomConf));
            }
        }

        const newStatus = b.status || 'confirmed';

        await client.query(
            `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
             label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
             second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
             linked_to=$18, status=$19, kids_count=$20, group_name=$21, updated_at=NOW()
             WHERE id=$22`,
            [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
             b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
             b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
             b.kidsCount || null, b.groupName || null, id]
        );

        // Auto-sync linked bookings
        if (!b.linkedTo) {
            const linkedResult = await client.query('SELECT id FROM bookings WHERE linked_to = $1', [id]);
            for (const linked of linkedResult.rows) {
                await client.query(
                    `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, updated_at=NOW() WHERE id=$5`,
                    [b.date, b.time, b.duration, newStatus, linked.id]
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
        if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
            notifyTelegram('create', bookingForNotify, { username, bookingId: id });
        } else if (statusChanged) {
            notifyTelegram('status_change', bookingForNotify, { username, bookingId: id });
        } else if (!b.linkedTo && newStatus !== 'preliminary') {
            notifyTelegram('edit', bookingForNotify, { username, bookingId: id });
        }

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}));

module.exports = router;
