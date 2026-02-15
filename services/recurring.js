/**
 * services/recurring.js — Recurring bookings business logic
 *
 * Core generation engine: resolves templates to concrete bookings,
 * handles conflict detection, skip logging, and linked (2-animator) programs.
 *
 * Called by:
 *   - Scheduler (daily at 00:07 Kyiv) for automatic generation
 *   - API (POST /api/recurring/:id/generate) for manual generation
 *   - API (POST /api/recurring) for eager-generate on template creation
 */
const { pool, generateBookingNumber } = require('../db');
const { checkServerConflicts, checkRoomConflict, ensureDefaultLines, getKyivDateStr } = require('./booking');
const { processBookingAutomation } = require('./bookingAutomation');
const { createLogger } = require('../utils/logger');

const log = createLogger('Recurring');

// --- Recurrence pattern matching ---

/**
 * Check if a date falls on the correct week interval from the start date.
 * Used for biweekly (interval=2) and custom interval patterns.
 */
function isCorrectWeekInterval(startDateStr, checkDateStr, intervalWeeks) {
    if (!startDateStr || !intervalWeeks || intervalWeeks <= 1) return true;
    const start = new Date(startDateStr + 'T12:00:00');
    const check = new Date(checkDateStr + 'T12:00:00');
    const diffMs = check.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    return diffWeeks >= 0 && diffWeeks % intervalWeeks === 0;
}

/**
 * Check if a date matches a monthly rule like '1st_6' (1st Saturday).
 * Format: '{ordinal}_{dayOfWeek}' where dayOfWeek: 1=Mon...7=Sun
 */
function matchesMonthlyRule(rule, dateObj) {
    if (!rule) return false;
    const [ordinal, dayStr] = rule.split('_');
    const targetDay = parseInt(dayStr);
    if (isNaN(targetDay)) return false;
    const currentDay = dateObj.getDay() || 7; // convert 0(Sun) to 7
    if (currentDay !== targetDay) return false;

    const dayOfMonth = dateObj.getDate();
    const weekNum = Math.ceil(dayOfMonth / 7);

    if (ordinal === 'last') {
        const nextWeek = new Date(dateObj);
        nextWeek.setDate(dayOfMonth + 7);
        return nextWeek.getMonth() !== dateObj.getMonth();
    }

    const ordinalMap = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
    return weekNum === ordinalMap[ordinal];
}

/**
 * Determine if a recurring template should generate a booking on a given date.
 * Handles all pattern types: weekly, biweekly, monthly, custom, weekdays, weekends.
 *
 * @param {Object} template - recurring_templates row
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {Date} dateObj - Date object for the target date
 * @returns {boolean}
 */
function shouldRunOnDate(template, dateStr, dateObj) {
    // Respect date bounds
    const startDate = template.start_date instanceof Date
        ? template.start_date.toISOString().split('T')[0]
        : String(template.start_date);
    if (startDate && dateStr < startDate) return false;
    if (template.end_date) {
        const endDate = template.end_date instanceof Date
            ? template.end_date.toISOString().split('T')[0]
            : String(template.end_date);
        if (dateStr > endDate) return false;
    }

    const dayOfWeek = dateObj.getDay() || 7; // 1=Mon...7=Sun

    // Parse days_of_week array (Postgres returns as JS array)
    const daysArray = Array.isArray(template.days_of_week) ? template.days_of_week : [];

    switch (template.pattern) {
        case 'weekly':
            if (daysArray.length > 0 && !daysArray.includes(dayOfWeek)) return false;
            if (template.interval_weeks && template.interval_weeks > 1) {
                return isCorrectWeekInterval(startDate, dateStr, template.interval_weeks);
            }
            return true;

        case 'biweekly':
            if (daysArray.length > 0 && !daysArray.includes(dayOfWeek)) return false;
            return isCorrectWeekInterval(startDate, dateStr, 2);

        case 'monthly':
            return matchesMonthlyRule(template.monthly_rule, dateObj);

        case 'custom':
            if (daysArray.length === 0) return false;
            return daysArray.includes(dayOfWeek);

        case 'weekdays':
            return dayOfWeek >= 1 && dayOfWeek <= 5;

        case 'weekends':
            return dayOfWeek >= 6;

        default:
            return false;
    }
}

// --- Line resolution ---

/**
 * Resolve an animator line name to a date-specific line_id.
 * Strategy: exact match -> ensure defaults -> retry -> fallback to first line.
 *
 * @param {string} lineName - e.g. 'Аніматор 1'
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {string|null} line_id or null if no lines exist
 */
async function resolveLineByName(lineName, date) {
    if (!lineName) return null;

    // Try exact match
    const result = await pool.query(
        'SELECT line_id FROM lines_by_date WHERE date = $1 AND name = $2',
        [date, lineName]
    );
    if (result.rows.length > 0) return result.rows[0].line_id;

    // Ensure default lines exist, then retry
    await ensureDefaultLines(date);
    const retry = await pool.query(
        'SELECT line_id FROM lines_by_date WHERE date = $1 AND name = $2',
        [date, lineName]
    );
    if (retry.rows.length > 0) return retry.rows[0].line_id;

    // Fallback: first available line
    const anyLine = await pool.query(
        'SELECT line_id FROM lines_by_date WHERE date = $1 ORDER BY line_id LIMIT 1',
        [date]
    );
    return anyLine.rows[0]?.line_id || null;
}

/**
 * Get the first available line for a date (when no preferred line is specified).
 */
async function getFirstLineForDate(date) {
    await ensureDefaultLines(date);
    const result = await pool.query(
        'SELECT line_id FROM lines_by_date WHERE date = $1 ORDER BY line_id LIMIT 1',
        [date]
    );
    return result.rows[0]?.line_id || null;
}

// --- Skip logging ---

/**
 * Log a skipped recurring booking instance.
 */
async function logSkip(templateId, date, reason, details) {
    try {
        await pool.query(
            `INSERT INTO recurring_booking_skips (template_id, date, reason, details)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (template_id, date) DO UPDATE SET reason = $3, details = $4`,
            [templateId, date, reason, details]
        );
    } catch (err) {
        log.error(`Failed to log skip for template ${templateId} date ${date}: ${err.message}`);
    }
}

// --- Core generation ---

/**
 * Format time from DB TIME type to 'HH:MM' string.
 * Handles both string ('14:00:00' or '14:00') and Date objects.
 */
function formatTime(timeValue) {
    if (!timeValue) return '00:00';
    const str = String(timeValue);
    // Handle 'HH:MM:SS' -> 'HH:MM'
    return str.substring(0, 5);
}

/**
 * Generate booking instances for a single template across a date range.
 *
 * @param {Object} template - recurring_templates row
 * @param {string} fromDate - start date 'YYYY-MM-DD'
 * @param {string} toDate - end date 'YYYY-MM-DD'
 * @returns {{ created: number, skipped: number, conflicts: Array }}
 */
async function generateBookingsForTemplate(template, fromDate, toDate) {
    const result = { created: 0, skipped: 0, conflicts: [] };
    const timeStart = formatTime(template.time_start);
    const duration = template.duration || 0;

    // Iterate each date in range
    const current = new Date(fromDate + 'T12:00:00');
    const end = new Date(toDate + 'T12:00:00');

    while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const dateObj = new Date(dateStr + 'T12:00:00');

        // Check if template applies to this date
        if (!shouldRunOnDate(template, dateStr, dateObj)) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        // Dedup: check if booking already exists for this template + date
        const existing = await pool.query(
            'SELECT id FROM bookings WHERE recurring_template_id = $1 AND date = $2 AND status != $3',
            [template.id, dateStr, 'cancelled']
        );
        if (existing.rows.length > 0) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        // Check if already manually skipped
        const skipped = await pool.query(
            'SELECT id FROM recurring_booking_skips WHERE template_id = $1 AND date = $2',
            [template.id, dateStr]
        );
        if (skipped.rows.length > 0) {
            current.setDate(current.getDate() + 1);
            continue;
        }

        // Resolve primary line
        await ensureDefaultLines(dateStr);
        const primaryLineId = template.preferred_line_name
            ? await resolveLineByName(template.preferred_line_name, dateStr)
            : await getFirstLineForDate(dateStr);

        if (!primaryLineId) {
            await logSkip(template.id, dateStr, 'no_line', 'No animator line available');
            result.skipped++;
            result.conflicts.push({ date: dateStr, reason: 'no_line', details: 'No animator line available' });
            current.setDate(current.getDate() + 1);
            continue;
        }

        // Check staff availability (if staff_schedule exists)
        if (template.preferred_line_name) {
            try {
                const staffCheck = await pool.query(
                    `SELECT ss.status FROM staff s
                     JOIN staff_schedule ss ON s.id = ss.staff_id
                     WHERE s.name = $1 AND ss.date = $2`,
                    [template.preferred_line_name, dateStr]
                );
                if (staffCheck.rows.length > 0 && !['working'].includes(staffCheck.rows[0].status)) {
                    await logSkip(template.id, dateStr, 'animator_unavailable',
                        `${template.preferred_line_name}: ${staffCheck.rows[0].status}`);
                    result.skipped++;
                    result.conflicts.push({
                        date: dateStr,
                        reason: 'animator_unavailable',
                        details: `${template.preferred_line_name}: ${staffCheck.rows[0].status}`
                    });
                    current.setDate(current.getDate() + 1);
                    continue;
                }
            } catch (err) {
                // staff/staff_schedule table may not exist — non-blocking
            }
        }

        // Begin transaction for this instance
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check line conflict
            const lineConflict = await checkServerConflicts(client, dateStr, primaryLineId, timeStart, duration);
            if (lineConflict.overlap) {
                await client.query('ROLLBACK');
                const details = `Line conflict: ${lineConflict.conflictWith?.label || lineConflict.conflictWith?.program_code || '?'} at ${lineConflict.conflictWith?.time || '?'}`;
                await logSkip(template.id, dateStr, 'line_conflict', details);
                result.skipped++;
                result.conflicts.push({ date: dateStr, reason: 'line_conflict', details });
                current.setDate(current.getDate() + 1);
                continue;
            }

            // Check room conflict
            const roomConflict = await checkRoomConflict(client, dateStr, template.room, timeStart, duration);
            if (roomConflict) {
                await client.query('ROLLBACK');
                const details = `Room "${template.room}" occupied: ${roomConflict.label || roomConflict.program_code || '?'} at ${roomConflict.time || '?'}`;
                await logSkip(template.id, dateStr, 'room_conflict', details);
                result.skipped++;
                result.conflicts.push({ date: dateStr, reason: 'room_conflict', details });
                current.setDate(current.getDate() + 1);
                continue;
            }

            // Generate main booking
            const mainId = await generateBookingNumber(client);
            const bookingStatus = template.status || 'preliminary';

            await client.query(
                `INSERT INTO bookings
                 (id, date, time, line_id, program_id, program_code, label, program_name, category,
                  duration, price, hosts, second_animator, pinata_filler, costume, room, notes,
                  created_by, linked_to, status, kids_count, group_name, extra_data, recurring_template_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
                [mainId, dateStr, timeStart, primaryLineId,
                 template.product_id, template.product_code, template.product_label, template.product_name,
                 template.category, duration, template.price, template.hosts || 1,
                 template.second_animator_name, template.pinata_filler, template.costume || null,
                 template.room, template.notes, template.created_by || 'system',
                 null, bookingStatus, template.kids_count || null, template.group_name || null,
                 template.extra_data ? JSON.stringify(template.extra_data) : null,
                 template.id]
            );

            // Handle 2-animator programs (hosts > 1)
            if ((template.hosts || 1) > 1 && template.second_animator_name) {
                const secondLineId = await resolveLineByName(template.second_animator_name, dateStr);
                if (secondLineId) {
                    // Check second animator conflict
                    const secondConflict = await checkServerConflicts(client, dateStr, secondLineId, timeStart, duration);
                    if (secondConflict.overlap) {
                        await client.query('ROLLBACK');
                        const details = `Second animator conflict: ${secondConflict.conflictWith?.label || '?'} at ${secondConflict.conflictWith?.time || '?'}`;
                        await logSkip(template.id, dateStr, 'second_animator_conflict', details);
                        result.skipped++;
                        result.conflicts.push({ date: dateStr, reason: 'second_animator_conflict', details });
                        current.setDate(current.getDate() + 1);
                        continue;
                    }

                    // Create linked booking for second animator
                    const linkedId = await generateBookingNumber(client);
                    await client.query(
                        `INSERT INTO bookings
                         (id, date, time, line_id, program_id, program_code, label, program_name, category,
                          duration, price, hosts, second_animator, pinata_filler, costume, room, notes,
                          created_by, linked_to, status, kids_count, group_name, extra_data, recurring_template_id)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
                        [linkedId, dateStr, timeStart, secondLineId,
                         template.product_id, template.product_code, template.product_label, template.product_name,
                         template.category, duration, template.price, template.hosts || 1,
                         template.second_animator_name, template.pinata_filler, template.costume || null,
                         template.room, template.notes, template.created_by || 'system',
                         mainId, bookingStatus, template.kids_count || null, template.group_name || null,
                         template.extra_data ? JSON.stringify(template.extra_data) : null,
                         template.id]
                    );
                }
            }

            // Log to history
            await client.query(
                'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
                ['recurring_create', template.created_by || 'system', JSON.stringify({
                    bookingId: mainId, templateId: template.id, date: dateStr,
                    program: template.product_label || template.product_name
                })]
            );

            await client.query('COMMIT');
            result.created++;

            // Fire-and-forget: automation rules for the generated booking
            const bookingData = {
                id: mainId, date: dateStr, time: timeStart, lineId: primaryLineId,
                programId: template.product_id, programCode: template.product_code,
                label: template.product_label, programName: template.product_name,
                category: template.category, duration, price: template.price,
                hosts: template.hosts, secondAnimator: template.second_animator_name,
                pinataFiller: template.pinata_filler, room: template.room,
                notes: template.notes, createdBy: template.created_by || 'system',
                status: bookingStatus, kidsCount: template.kids_count,
                groupName: template.group_name, extraData: template.extra_data,
                recurringTemplateId: template.id
            };
            processBookingAutomation(bookingData)
                .catch(err => log.error(`Automation failed for recurring ${mainId}: ${err.message}`));

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            log.error(`Error generating booking for template ${template.id} date ${dateStr}: ${err.message}`);
            result.skipped++;
            result.conflicts.push({ date: dateStr, reason: 'error', details: err.message });
        } finally {
            client.release();
        }

        current.setDate(current.getDate() + 1);
    }

    return result;
}

/**
 * Generate recurring bookings for all active templates.
 * Called by scheduler daily and optionally by API.
 *
 * @param {number} [horizonDays=14] - number of days ahead to generate
 * @returns {{ totalCreated: number, totalSkipped: number, templateResults: Array }}
 */
async function generateAllRecurringBookings(horizonDays) {
    // Determine horizon from settings or default
    if (!horizonDays) {
        try {
            const setting = await pool.query("SELECT value FROM settings WHERE key = 'recurring_booking_horizon'");
            horizonDays = setting.rows[0] ? parseInt(setting.rows[0].value) : 14;
        } catch {
            horizonDays = 14;
        }
    }

    const todayStr = getKyivDateStr();
    const endDate = new Date(todayStr + 'T12:00:00');
    endDate.setDate(endDate.getDate() + horizonDays);
    const endDateStr = endDate.toISOString().split('T')[0];

    let templates;
    try {
        templates = await pool.query('SELECT * FROM recurring_templates WHERE is_active = true');
    } catch (err) {
        if (err.message.includes('does not exist')) {
            log.warn('recurring_templates table does not exist yet');
            return { totalCreated: 0, totalSkipped: 0, templateResults: [] };
        }
        throw err;
    }

    const summary = { totalCreated: 0, totalSkipped: 0, templateResults: [] };

    for (const template of templates.rows) {
        const templateResult = await generateBookingsForTemplate(template, todayStr, endDateStr);
        summary.totalCreated += templateResult.created;
        summary.totalSkipped += templateResult.skipped;
        summary.templateResults.push({
            templateId: template.id,
            productName: template.product_name || template.product_label,
            ...templateResult
        });
    }

    if (summary.totalCreated > 0 || summary.totalSkipped > 0) {
        log.info(`Recurring generation: created=${summary.totalCreated}, skipped=${summary.totalSkipped} (${todayStr} to ${endDateStr})`);
    }

    return summary;
}

/**
 * Map a recurring_templates DB row to camelCase API response.
 */
function mapTemplateRow(row) {
    return {
        id: row.id,
        pattern: row.pattern,
        daysOfWeek: row.days_of_week,
        intervalWeeks: row.interval_weeks,
        monthlyRule: row.monthly_rule,
        startDate: row.start_date instanceof Date ? row.start_date.toISOString().split('T')[0] : row.start_date,
        endDate: row.end_date instanceof Date ? row.end_date.toISOString().split('T')[0] : (row.end_date || null),
        timeStart: formatTime(row.time_start),
        timeEnd: formatTime(row.time_end),
        lineId: row.line_id,
        preferredLineName: row.preferred_line_name,
        room: row.room,
        productId: row.product_id,
        productCode: row.product_code,
        productLabel: row.product_label,
        productName: row.product_name,
        category: row.category,
        duration: row.duration,
        price: row.price,
        hosts: row.hosts,
        secondAnimatorName: row.second_animator_name,
        secondAnimatorLineId: row.second_animator_line_id,
        pinataFiller: row.pinata_filler,
        costume: row.costume,
        kidsCount: row.kids_count,
        groupName: row.group_name,
        notes: row.notes,
        extraData: row.extra_data,
        status: row.status,
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Map a recurring_booking_skips DB row to camelCase API response.
 */
function mapSkipRow(row) {
    return {
        id: row.id,
        templateId: row.template_id,
        date: row.date,
        reason: row.reason,
        details: row.details,
        notified: row.notified,
        createdAt: row.created_at
    };
}

module.exports = {
    shouldRunOnDate,
    isCorrectWeekInterval,
    matchesMonthlyRule,
    resolveLineByName,
    generateBookingsForTemplate,
    generateAllRecurringBookings,
    mapTemplateRow,
    mapSkipRow,
    logSkip,
    formatTime
};
