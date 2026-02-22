/**
 * services/booking.js — Booking business logic: validators, time helpers, conflict checks, mappers
 */
const { pool } = require('../db');

// --- Validators ---

function validateDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function validateTime(str) {
    if (typeof str !== 'string' || !/^\d{2}:\d{2}$/.test(str)) return false;
    const [h, m] = str.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function validateId(str) {
    return typeof str === 'string' && str.length > 0 && str.length <= 100;
}

function validateSettingKey(str) {
    return typeof str === 'string' && /^[a-z_]{1,100}$/.test(str);
}

// --- Time helpers ---

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

const MIN_PAUSE = 15;

const ALL_ROOMS = [
    'Marvel', 'Ninja', 'Minecraft', 'Monster High', 'Elsa',
    'Растішка', 'Rock', 'Minion', 'Food Court', 'Жовтий стіл',
    'Диван 1', 'Диван 2', 'Диван 3', 'Диван 4'
];

// --- Conflict checks ---

async function checkRoomConflict(client, date, room, time, duration, excludeId = null) {
    if (!room || room === 'Інше') return null;
    const params = excludeId ? [date, room, excludeId] : [date, room];
    const result = await client.query(
        "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND status != 'cancelled'" +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;
    for (const b of result.rows) {
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + (b.duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            return b;
        }
    }
    return null;
}

async function checkServerConflicts(client, date, lineId, time, duration, excludeId = null) {
    const params = excludeId ? [date, lineId, excludeId] : [date, lineId];
    const result = await client.query(
        "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND line_id = $2 AND status != 'cancelled'" +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart < end && newEnd > start) {
            return { overlap: true, noPause: false, conflictWith: b };
        }
    }

    let noPause = false;
    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart === end || newEnd === start) noPause = true;
        if (newStart > end && newStart < end + MIN_PAUSE) noPause = true;
        if (newEnd > start - MIN_PAUSE && newEnd <= start) noPause = true;
    }

    return { overlap: false, noPause, conflictWith: null };
}

async function checkServerDuplicate(client, date, programId, time, duration, excludeId = null) {
    if (!programId) return null;
    const params = excludeId ? [date, programId, excludeId] : [date, programId];
    const result = await client.query(
        "SELECT id, category FROM bookings WHERE date = $1 AND program_id = $2 AND status != 'cancelled'" +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        if (b.category === 'animation') continue;
        const bResult = await client.query('SELECT time, duration FROM bookings WHERE id = $1', [b.id]);
        if (bResult.rows.length === 0) continue;
        const bStart = timeToMinutes(bResult.rows[0].time);
        const bEnd = bStart + (bResult.rows[0].duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            return b;
        }
    }
    return null;
}

// --- Row mapper (snake_case → camelCase) ---

function mapBookingRow(row) {
    return {
        id: row.id,
        date: row.date,
        time: row.time,
        lineId: row.line_id,
        programId: row.program_id,
        programCode: row.program_code,
        label: row.label,
        programName: row.program_name,
        category: row.category,
        duration: row.duration,
        price: row.price,
        hosts: row.hosts,
        secondAnimator: row.second_animator,
        pinataFiller: row.pinata_filler,
        costume: row.costume,
        room: row.room,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        linkedTo: row.linked_to,
        status: row.status || 'confirmed',
        kidsCount: row.kids_count,
        updatedAt: row.updated_at,
        groupName: row.group_name || null,
        extraData: row.extra_data || null,
        skipNotification: row.skip_notification || false,
        customerId: row.customer_id || null
    };
}

// --- Default lines ---

async function ensureDefaultLines(date) {
    const existing = await pool.query('SELECT COUNT(*) FROM lines_by_date WHERE date = $1', [date]);
    const count = parseInt(existing.rows[0].count);
    // v12.6: Only create defaults when NO lines exist (count === 0)
    // Previously count < 2 caused phantom "Аніматор 1/2" to reappear after user deleted a line
    if (count === 0) {
        const defaults = [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
        for (const line of defaults) {
            await pool.query(
                'INSERT INTO lines_by_date (date, line_id, name, color) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [date, line.id, line.name, line.color]
            );
        }
    }
}

// --- Kyiv timezone helpers ---

function getKyivDate() {
    const now = new Date();
    const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    return kyiv;
}

function getKyivDateStr() {
    const k = getKyivDate();
    return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
}

function getKyivTimeStr() {
    const k = getKyivDate();
    return `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
    validateDate, validateTime, validateId, validateSettingKey,
    timeToMinutes, minutesToTime, MIN_PAUSE, ALL_ROOMS,
    checkRoomConflict, checkServerConflicts, checkServerDuplicate,
    mapBookingRow, ensureDefaultLines,
    getKyivDate, getKyivDateStr, getKyivTimeStr
};
