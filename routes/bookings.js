/**
 * routes/bookings.js — Booking CRUD endpoints
 */
const router = require('express').Router();
const { pool, generateBookingNumber } = require('../db');
const { validateDate, validateTime, validateId, mapBookingRow, checkServerConflicts, checkServerDuplicate, checkRoomConflict, timeToMinutes } = require('../services/booking');
const { notifyTelegram } = require('../services/telegram');
const { processBookingAutomation } = require('../services/bookingAutomation');
const { broadcast } = require('../services/websocket');
const { publish: publishEvent } = require('../services/eventBus');
let _triggerAlertBroadcast;
try { _triggerAlertBroadcast = require('./dashboard').triggerAlertBroadcast; } catch {}
function _alertPush() { if (_triggerAlertBroadcast) _triggerAlertBroadcast(); }
const { createLogger } = require('../utils/logger');

const { requireAction, authenticateToken } = require('../middleware/auth');
const log = createLogger('Bookings');

// v39.8: Security — require authentication for all booking endpoints
router.use(authenticateToken);

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

// v33.3: GET /api/bookings/occupancy — Line occupancy stats
router.get('/occupancy', async (req, res) => {
    try {
        const from = req.query.from || new Date().toISOString().slice(0, 10);
        const to = req.query.to || from;
        const workdayHours = 10;

        const result = await pool.query(`
            SELECT line_id, COUNT(*)::int AS bookings_count,
                   COALESCE(SUM(duration), 0)::int AS total_minutes
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND status != 'cancelled' AND linked_to IS NULL
            GROUP BY line_id
        `, [from, to]);

        const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
        const maxMinutes = workdayHours * 60 * days;

        const lines = result.rows.map(r => ({
            lineId: r.line_id,
            bookingsCount: r.bookings_count,
            totalMinutes: r.total_minutes,
            occupancyPercent: Math.min(100, Math.round((r.total_minutes / maxMinutes) * 100))
        }));

        res.json({ from, to, days, lines });
    } catch (err) {
        log.error('GET /bookings/occupancy error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get bookings for a date
router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        // v19.13: Explicit column list instead of SELECT *
        const result = await pool.query(
            `SELECT id, date, time, line_id, program_id, program_code, label, program_name,
                    category, duration, price, hosts, second_animator, pinata_filler, costume,
                    room, notes, created_by, created_at, linked_to, status, kids_count,
                    updated_at, group_name, extra_data, skip_notification, customer_id, payment_method, certificate_id
             FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time`,
            [date]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        log.error('Error fetching bookings', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create booking — requires create_booking action permission
router.post('/', requireAction('create_booking'), async (req, res) => {
    // v39.9: Validate BEFORE pool.connect() to prevent connection leaks on early returns
    const b = req.body;
    if (!b.date || !b.time || !b.lineId) {
        return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
    }
    if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
    if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }
    if (b.notes && b.notes.length > 2000) { return res.status(400).json({ error: 'Нотатки: макс. 2000 символів' }); }
    if (b.label && b.label.length > 200) { return res.status(400).json({ error: 'Назва: макс. 200 символів' }); }
    if (b.room && b.room.length > 100) { return res.status(400).json({ error: 'Кімната: макс. 100 символів' }); }
    if (b.groupName && b.groupName.length > 200) { return res.status(400).json({ error: 'Група: макс. 200 символів' }); }
    const dur = parseInt(b.duration) || 0;
    if (dur < 0 || dur > 1440) { return res.status(400).json({ error: 'Тривалість: 0-1440 хвилин' }); }
    if (b.time && dur > 0) {
        const [_hh, _mm] = b.time.split(':').map(Number);
        if (_hh * 60 + _mm + dur > 1440) {
            return res.status(400).json({ error: `Бронювання не може перевищувати опівніч. Макс: ${1440 - _hh * 60 - _mm} хв` });
        }
    }
    if (!b.linkedTo) {
        const bookingDateTime = new Date(`${b.date}T${b.time}:00`);
        if (bookingDateTime < new Date()) {
            return res.status(400).json({ success: false, error: 'Неможливо створити бронювання в минулому.' });
        }
    }

    const client = await pool.connect();
    try {
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

        // Validate price (prevent negative/NaN amounts)
        if (b.price != null) {
            b.price = parseFloat(b.price);
            if (!Number.isFinite(b.price) || b.price < 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Ціна не може бути від\'ємною або некоректною' });
            }
        }

        // CRM: resolve or create customer (v30.4: auto-link by phone)
        let customerId = b.customerId ? parseInt(b.customerId) : null;
        if (b.customer && b.customer.name && !customerId) {
            const c = b.customer;
            // v30.4: Try to find existing customer by phone first
            if (c.phone && c.phone.trim()) {
                const existing = await client.query(
                    'SELECT id FROM customers WHERE phone = $1 LIMIT 1',
                    [c.phone.trim()]
                );
                if (existing.rows.length > 0) {
                    customerId = existing.rows[0].id;
                }
            }
            // Create new customer only if not found
            if (!customerId) {
                const custResult = await client.query(
                    `INSERT INTO customers (name, phone, instagram, child_name, child_birthday, source)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, c.source || null]
                );
                customerId = custResult.rows[0].id;
            }
        }

        if (!b.id || !/^BK-\d{4}-\d{4,}$/.test(b.id)) {
            b.id = await generateBookingNumber(client);
        }

        // v33.8.0 Integration 6: Certificate validation (INSIDE transaction)
        let certificateId = null;
        if (b.certificateCode) {
            const certRow = await client.query(
                `SELECT id, status, display_value FROM certificates WHERE cert_code = $1 FOR UPDATE`,
                [String(b.certificateCode).toUpperCase()]
            );
            if (!certRow.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Сертифікат не знайдено' });
            }
            const cert = certRow.rows[0];
            if (cert.status !== 'active') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Сертифікат недійсний (статус: ${cert.status})` });
            }
            certificateId = cert.id;
            await client.query(`UPDATE certificates SET status = 'used', used_at = NOW() WHERE id = $1`, [certificateId]);
        }

        const insertResult = await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, certificate_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
             RETURNING *`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, b.skipNotification || false, customerId, b.paymentMethod || null, certificateId]
        );

        // v19.10: CRM aggregates now handled by DB trigger (trg_booking_customer_aggregates)
        // Update first_visit which is not covered by the trigger
        if (customerId) {
            await client.query(
                `UPDATE customers SET
                    first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
                    updated_at = NOW()
                 WHERE id = $2`,
                [b.date, customerId]
            );
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', b.createdBy || req.user?.username, JSON.stringify(b)]
        );

        // v19.10: Finance auto-record INSIDE transaction for consistency
        if (!b.linkedTo && b.price > 0 && b.status !== 'preliminary') {
            try {
                await client.query(
                    `INSERT INTO finance_transactions (type, category_id, amount, description, date, payment_method, booking_id, created_by)
                     VALUES ('income', (SELECT id FROM finance_categories WHERE name = 'Бронювання' AND type = 'income' LIMIT 1),
                             $1, $2, $3, $4, $5, $6)`,
                    [b.price, `${b.programName || b.label || b.programCode} (${b.id})`, b.date, b.paymentMethod || null, b.id, b.createdBy || req.user?.username]
                );
            } catch (finErr) {
                log.warn(`Finance auto-record failed (non-critical): ${finErr.message}`);
            }
        }

        // v33.8.0 Integration 6: Certificate payment finance record
        if (certificateId && b.price > 0) {
            try {
                await client.query(
                    `INSERT INTO finance_transactions (type, category_id, amount, description, date, payment_method, booking_id, certificate_id, created_by)
                     VALUES ('income', (SELECT id FROM finance_categories WHERE name ILIKE '%сертифікат%' LIMIT 1),
                             $1, $2, $3, 'certificate', $4, $5, 'system')`,
                    [b.price, `Оплата сертифікатом для бронювання ${b.id}`, b.date, b.id, certificateId]
                );
            } catch (certFinErr) {
                log.warn(`Certificate finance record failed (non-critical): ${certFinErr.message}`);
            }
        }

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
        _alertPush();

        // v19.1: Publish to event queue
        if (!b.linkedTo) {
            publishEvent('booking.created', {
                booking_id: b.id, date: b.date, time: b.time, room: b.room,
                program_code: b.programCode, program_name: b.programName,
                status: b.status || 'confirmed', price: b.price || 0,
                kids_count: b.kidsCount, created_by: b.createdBy
            }, `booking_created_${b.id}`);
        }

        // ==========================================
        // v33.8.0: Post-commit integrations (all fire-and-forget)
        // ==========================================

        // Integration 1: Warehouse stock deduction
        if (b.programId) {
            setImmediate(async () => {
                try {
                    const reqs = await pool.query(
                        `SELECT psr.stock_id, psr.quantity, ws.name, ws.quantity AS current_qty
                         FROM product_stock_requirements psr
                         JOIN warehouse_stock ws ON ws.id = psr.stock_id
                         WHERE psr.product_id = $1 AND ws.is_active = true`,
                        [b.programId]
                    );
                    for (const req of reqs.rows) {
                        if (req.current_qty < req.quantity) {
                            log.warn(`[StockDeduct] Low stock: ${req.name} (${req.current_qty} < ${req.quantity}) for booking ${insertResult.rows[0].id}`);
                        }
                        await pool.query(
                            `UPDATE warehouse_stock SET quantity = GREATEST(0, quantity - $1), updated_at = NOW(), updated_by = 'booking' WHERE id = $2`,
                            [req.quantity, req.stock_id]
                        );
                        await pool.query(
                            `INSERT INTO warehouse_history (stock_id, change, reason, created_by, created_at) VALUES ($1, $2, $3, 'booking', NOW())`,
                            [req.stock_id, -req.quantity, `Бронювання ${insertResult.rows[0].id}`]
                        );
                    }
                } catch (e) { log.warn('[StockDeduct] Error:', e.message); }
            });
        }

        // Integration 2: HR shift warning (no block)
        // Note: bookings.hosts is INTEGER (animator count). Use second_animator for name matching.
        if (b.secondAnimator && b.date) {
            setImmediate(async () => {
                try {
                    const animName = String(b.secondAnimator).split(',')[0].trim();
                    const staffRow = await pool.query(
                        `SELECT id, name FROM staff WHERE (display_name ILIKE $1 OR name ILIKE $1) AND is_active = true LIMIT 1`,
                        [animName]
                    );
                    if (!staffRow.rowCount) return;
                    const shift = await pool.query(
                        `SELECT id FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2`,
                        [staffRow.rows[0].id, b.date]
                    );
                    if (!shift.rowCount) {
                        const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
                        const chatId = await getConfiguredChatId();
                        if (chatId) {
                            await sendTelegramMessage(chatId,
                                `⚠️ Бронювання ${insertResult.rows[0].id} (${b.date} ${b.time}): ` +
                                `для аніматора "${b.secondAnimator}" не знайдено зміни в HR. Перевірте графік!`
                            );
                        }
                    }
                } catch (e) { /* silent */ }
            });
        }

        // Integration 7: Loyalty tier auto-upgrade
        if (customerId) {
            setImmediate(async () => {
                try {
                    const cust = await pool.query(
                        `SELECT c.id, c.name, c.total_bookings, c.total_spent,
                                c.loyalty_tier_id, lt.name AS current_tier_name
                         FROM customers c
                         LEFT JOIN loyalty_tiers lt ON lt.id = c.loyalty_tier_id
                         WHERE c.id = $1`,
                        [customerId]
                    );
                    if (!cust.rowCount) return;
                    const c = cust.rows[0];
                    const tiers = await pool.query(
                        `SELECT * FROM loyalty_tiers
                         WHERE min_bookings <= $1 AND min_spent <= $2
                         ORDER BY min_bookings DESC, min_spent DESC LIMIT 1`,
                        [c.total_bookings, c.total_spent]
                    );
                    if (!tiers.rowCount) return;
                    const newTier = tiers.rows[0];
                    if (newTier.id !== c.loyalty_tier_id) {
                        await pool.query('UPDATE customers SET loyalty_tier_id = $1 WHERE id = $2', [newTier.id, customerId]);
                        const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
                        const chatId = await getConfiguredChatId();
                        if (chatId) {
                            await sendTelegramMessage(chatId,
                                `🏆 Клієнт <b>${c.name}</b> підвищено до tier <b>${newTier.name}</b>!\n` +
                                `Бронювань: ${c.total_bookings} | Сума: ${c.total_spent} грн`
                            );
                        }
                        log.info(`[Loyalty] Customer ${customerId} upgraded: ${c.current_tier_name || 'none'} → ${newTier.name}`);
                    }
                } catch (e) { log.warn('[Loyalty] Tier update error:', e.message); }
            });
        }

        // Integration 10: Gamification achievements check
        setImmediate(async () => {
            try {
                const { checkAchievements } = require('../services/gamification');
                const hostUsername = b.hosts ? String(b.hosts).split(',')[0].trim() : null;
                if (hostUsername) {
                    const unlocked = await checkAchievements(hostUsername, { context: 'booking' });
                    if (unlocked.length > 0) {
                        log.info(`[Gamification] ${hostUsername} unlocked: ${unlocked.map(a => a.key).join(', ')}`);
                    }
                }
                if (b.createdBy && b.createdBy !== 'system') {
                    await checkAchievements(b.createdBy, { context: 'booking' }).catch(() => {});
                }
            } catch (e) { log.warn('[Gamification] Achievement check error:', e.message); }
        });

        // v33.9.0: Post message to room channel
        if (b.lineId) {
            setImmediate(async () => {
                try {
                    const roomChan = await pool.query(
                        "SELECT id FROM chat_channels WHERE line_id = $1 AND type = 'room' LIMIT 1", [b.lineId]
                    );
                    if (!roomChan.rowCount) return;
                    const sysUser = await pool.query("SELECT id FROM users WHERE username = 'system' LIMIT 1");
                    if (!sysUser.rowCount) return;
                    const seqRes = await pool.query('SELECT next_chat_seq($1) AS seq', [roomChan.rows[0].id]);
                    await pool.query(
                        `INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, created_at)
                         VALUES ($1, $2, $3, $4, true, NOW())`,
                        [roomChan.rows[0].id, sysUser.rows[0].id, seqRes.rows[0].seq,
                         `📅 ${b.date} ${b.time} — ${b.programName || b.label}${b.kidsCount ? ' | 👶' + b.kidsCount : ''}`]
                    );
                } catch (e) { /* silent */ }
            });
        }

        // v33.15.0: Auto birthday announcement
        if ((b.programName || '').toLowerCase().match(/день народж|birthday|дн\b/i) && b.date && b.time) {
            setImmediate(async () => {
                try {
                    const eventTime = new Date(`${b.date}T${b.time}`);
                    const annTime = new Date(eventTime.getTime() - 5 * 60000);
                    if (annTime <= new Date()) return;
                    const childName = (b.label || '').replace(/[^а-яА-ЯіІїЇєЄa-zA-Z\s]/g, '').trim().split(/\s+/)[0] || '';
                    const text = `Шановні відвідувачі! Сьогодні у нас особливий гість${childName ? ' — ' + childName : ''}! Святкування починається о ${b.time.slice(0, 5)}. Бажаємо прекрасного свята! 🎉`;
                    await pool.query(
                        `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, status, priority, created_by)
                         VALUES ($1, $2, 'birthday', 'once', $3, 'scheduled', 5, 'booking_auto')`,
                        [`🎂 ДН: ${childName || b.label}`, text, annTime.toISOString()]
                    );
                } catch (e) { /* silent */ }
            });
        }

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
router.post('/full', requireAction('create_booking'), async (req, res) => {
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

        // CRM: resolve or create customer
        let customerId = main.customerId ? parseInt(main.customerId) : null;
        if (main.customer && main.customer.name && !customerId) {
            const c = main.customer;
            const custResult = await client.query(
                `INSERT INTO customers (name, phone, instagram, child_name, child_birthday, source)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, c.source || null]
            );
            customerId = custResult.rows[0].id;
        }

        if (!main.id || !/^BK-\d{4}-\d{4,}$/.test(main.id)) {
            main.id = await generateBookingNumber(client);
        }

        const mainInsert = await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
             RETURNING *`,
            [main.id, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null, main.groupName || null, main.extraData ? JSON.stringify(main.extraData) : null, main.skipNotification || false, customerId]
        );

        // v19.10: CRM aggregates now handled by DB trigger
        if (customerId) {
            await client.query(
                `UPDATE customers SET
                    first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
                    updated_at = NOW()
                 WHERE id = $2`,
                [main.date, customerId]
            );
        }

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

        // v19.1: Publish to event queue
        publishEvent('booking.created', {
            booking_id: main.id, date: main.date, time: main.time, room: main.room,
            program_code: main.programCode, program_name: main.programName,
            status: main.status || 'confirmed', price: main.price || 0,
            kids_count: main.kidsCount, created_by: main.createdBy,
            linked_count: linkedRows.length
        }, `booking_created_${main.id}`);

        res.json({ success: true, mainBooking, linkedBookings });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create/full)', rbErr));
        log.error('Error creating full booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Soft delete or permanent delete — requires delete_booking permission
router.delete('/:id', requireAction('delete_booking'), async (req, res) => {
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

        // v19.10: CRM aggregates now handled by DB trigger (trg_booking_customer_aggregates)

        // v19.10: Remove auto-recorded finance transaction inside transaction
        if (booking.price > 0 && !booking.linked_to) {
            try {
                await client.query(
                    'DELETE FROM finance_transactions WHERE booking_id = $1',
                    [id]
                );
            } catch (finErr) {
                log.warn(`Finance auto-delete failed (non-critical): ${finErr.message}`);
            }
        }

        // v39.9: Restore certificate INSIDE transaction (was fire-and-forget, could lose certs)
        if (booking.certificate_id) {
            try {
                await client.query("UPDATE certificates SET status = 'active', used_at = NULL WHERE id = $1 AND status = 'used'", [booking.certificate_id]);
                log.info(`[CertRestore] Certificate ${booking.certificate_id} restored in transaction`);
            } catch (e) { log.warn('[CertRestore] Error:', e.message); }
        }

        await client.query('COMMIT');

        // v33.8.0: Restore stock on cancel (fire-and-forget — non-critical)
        if (booking.program_id) {
            setImmediate(async () => {
                try {
                    const reqs = await pool.query(
                        `SELECT psr.stock_id, psr.quantity, ws.name FROM product_stock_requirements psr
                         JOIN warehouse_stock ws ON ws.id = psr.stock_id WHERE psr.product_id = $1`,
                        [booking.program_id]
                    );
                    for (const r of reqs.rows) {
                        await pool.query('UPDATE warehouse_stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [r.quantity, r.stock_id]);
                        await pool.query(
                            'INSERT INTO warehouse_history (stock_id, change, reason, created_by, created_at) VALUES ($1, $2, $3, $4, NOW())',
                            [r.stock_id, r.quantity, `Скасування ${id}`, req.user?.username || 'system']
                        );
                    }
                } catch (e) { log.warn('[StockRestore] Error:', e.message); }
            });
        }
        // v39.9: Certificate restore moved inside transaction (above)

        getLineName(booking.line_id, booking.date).then(lineName =>
            notifyTelegram('delete', booking, { username: req.user?.username, lineName }))
            .catch(err => log.error(`Telegram notify failed (delete): ${err.message}`));

        // WebSocket: notify other clients
        broadcast('booking:deleted', { id, date: booking.date, permanent }, req.user?.id?.toString(), booking.date);
        _alertPush();

        // v19.1: Publish to event queue
        publishEvent('booking.cancelled', {
            booking_id: id,
            booking_number: booking.booking_number || booking.id,
            date: booking.date,
            time: booking.time || '',
            room: booking.room,
            label: booking.label || booking.program_code || '',
            program_code: booking.program_code,
            permanent,
            cancelled_by: req.user?.username
        }, `booking_cancelled_${id}`);

        res.json({ success: true, permanent });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (delete)', rbErr));
        log.error('Error deleting booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Update booking — requires edit_booking action permission
router.put('/:id', requireAction('edit_booking'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const b = req.body;
        const clientUpdatedAt = b.updatedAt || null; // optimistic locking
        if (!validateId(id)) { return res.status(400).json({ error: 'Invalid booking ID' }); }

        // v40: Support partial updates — merge missing fields from existing booking
        const existing = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (!existing.rows.length) { return res.status(404).json({ error: 'Booking not found' }); }
        const old = existing.rows[0];
        if (!b.date) b.date = old.date;
        if (!b.time) b.time = old.time;
        if (b.lineId === undefined) b.lineId = old.line_id;
        if (b.duration === undefined) b.duration = old.duration;
        if (b.room === undefined) b.room = old.room;
        if (b.label === undefined) b.label = old.label;
        if (b.status === undefined) b.status = old.status;
        if (b.price === undefined) b.price = old.price;

        if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }

        // v19.14: Input length validation
        if (b.notes && b.notes.length > 2000) { return res.status(400).json({ error: 'Нотатки: макс. 2000 символів' }); }
        if (b.label && b.label.length > 200) { return res.status(400).json({ error: 'Назва: макс. 200 символів' }); }
        if (b.room && b.room.length > 100) { return res.status(400).json({ error: 'Кімната: макс. 100 символів' }); }
        if (b.groupName && b.groupName.length > 200) { return res.status(400).json({ error: 'Група: макс. 200 символів' }); }
        const dur = parseInt(b.duration) || 0;
        if (dur < 0 || dur > 1440) { return res.status(400).json({ error: 'Тривалість: 0-1440 хвилин' }); }
        // v38.5.0: Prevent bookings spanning midnight
        if (b.time && dur > 0) {
            const [_hh, _mm] = b.time.split(':').map(Number);
            if (_hh * 60 + _mm + dur > 1440) {
                return res.status(400).json({ error: `Бронювання не може перевищувати опівніч. Макс: ${1440 - _hh * 60 - _mm} хв` });
            }
        }

        await client.query('BEGIN');

        const oldResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (oldResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        const oldBooking = oldResult.rows[0];

        if (!b.linkedTo) {
            // v19.13: Skip conflict checks if date/time/line/duration unchanged
            const timeSlotChanged = oldBooking.date !== b.date || oldBooking.time !== b.time
                || oldBooking.line_id !== b.lineId || (oldBooking.duration || 0) !== (b.duration || 0);
            const roomChanged = oldBooking.room !== b.room || timeSlotChanged;

            if (timeSlotChanged) {
                const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, id);
                if (conflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                    });
                }
            }

            if (roomChanged && b.room && b.room !== 'Інше') {
                // v12.6: Exclude linked bookings of this booking from room conflict check
                const linkedIds = await client.query('SELECT id FROM bookings WHERE linked_to = $1', [id]);
                const excludeIds = [id, ...linkedIds.rows.map(r => r.id)];
                let roomConflict = null;
                const roomResult = await client.query(
                    "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND status != 'cancelled' AND id != ALL($3::text[])",
                    [b.date, b.room, excludeIds]
                );
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
                if (roomConflict) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                    });
                }
            }
        }

        // v33.3: Animator conflict detection
        if (b.hosts && !b.linkedTo) {
            const animId = parseInt(b.hosts);
            if (animId) {
                const startMinutes = timeToMinutes(b.time);
                const endMinutes = startMinutes + (parseInt(b.duration) || 0);
                const animConflict = await client.query(`
                    SELECT id, time, duration, label, program_code FROM bookings
                    WHERE (hosts = $1 OR second_animator = $1::text)
                      AND date = $2 AND id != $3
                      AND status != 'cancelled' AND linked_to IS NULL
                `, [animId, b.date, id]);

                for (const ac of animConflict.rows) {
                    const acStart = timeToMinutes(ac.time);
                    const acEnd = acStart + (ac.duration || 0);
                    if (startMinutes < acEnd && endMinutes > acStart) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({
                            success: false,
                            error: `Аніматор вже зайнятий о ${ac.time} (${ac.label || ac.program_code})`,
                            conflictBookingId: ac.id
                        });
                    }
                }
            }
        }

        // v38.5.0: Status whitelist — prevent invalid status values and transitions
        const VALID_STATUSES = ['confirmed', 'preliminary', 'cancelled'];
        const newStatus = VALID_STATUSES.includes(b.status) ? b.status : (oldBooking.status || 'confirmed');
        // Prevent cancelled → confirmed/preliminary (must create new booking)
        if (oldBooking.status === 'cancelled' && newStatus !== 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Скасоване бронювання не можна відновити. Створіть нове.' });
        }

        // CRM: resolve customer_id for update
        const updateCustomerId = b.customerId ? parseInt(b.customerId) : (oldBooking.customer_id || null);

        let updateResult;
        if (clientUpdatedAt) {
            // Optimistic locking: check updated_at matches client's version
            // Use date_trunc('milliseconds', ...) because JS Date has only ms precision
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, customer_id=$25,
                 payment_method=$26
                 WHERE id=$23 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $24::timestamp)
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null,
                 id, clientUpdatedAt, updateCustomerId, b.paymentMethod || null]
            );
        } else {
            // Legacy: no optimistic locking (backward compatibility)
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, customer_id=$24,
                 payment_method=$25
                 WHERE id=$23
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, id, updateCustomerId,
                 b.paymentMethod || null]
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
        _alertPush();

        // v19.1: Publish status change events to event queue
        if (statusChanged) {
            const eventType = newStatus === 'confirmed' ? 'booking.confirmed' : `booking.status_changed`;
            publishEvent(eventType, {
                booking_id: id, date: b.date, time: b.time, room: b.room,
                program_code: b.programCode, old_status: oldBooking.status,
                new_status: newStatus, updated_by: req.user?.username
            }, `booking_status_${id}_${Date.now()}`);
        }

        res.json({ success: true, booking: savedBooking });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (update)', rbErr));
        log.error('Error updating booking', err);
        res.status(500).json({ error: 'Failed to update booking' });
    } finally {
        client.release();
    }
});

// v29.1.0: Checkbox MVP — update payment method
router.patch('/:id/payment', requireAction('edit_booking'), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_method, fiscal_required } = req.body;

        const updates = ['updated_at = NOW()'];
        const params = [];

        if (payment_method !== undefined) {
            params.push(payment_method);
            updates.push(`payment_method = $${params.length}`);
        }
        if (fiscal_required !== undefined) {
            params.push(fiscal_required);
            updates.push(`fiscal_required = $${params.length}`);
        }

        if (params.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(id);
        const result = await pool.query(
            `UPDATE bookings SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, payment_method, fiscal_required`,
            params
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json({ success: true, booking: mapBookingRow(result.rows[0]) });
    } catch (err) {
        log.error('PATCH /bookings/:id/payment error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
