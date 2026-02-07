/**
 * services/booking.js — Booking business logic
 *
 * SRP: конфлікти часу/кімнат, генерація номерів, маппінг рядків БД.
 * Не знає про HTTP чи Express — чиста бізнес-логіка.
 */

const { pool } = require('../db');

// --- Validation helpers ---

function validateDate(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function validateTime(str) {
    return typeof str === 'string' && /^\d{2}:\d{2}$/.test(str);
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

// Two time ranges overlap when: start1 < end2 AND end1 > start2
function hasTimeOverlap(time1, duration1, time2, duration2) {
    const s1 = timeToMinutes(time1);
    const e1 = s1 + (duration1 || 0);
    const s2 = timeToMinutes(time2);
    const e2 = s2 + (duration2 || 0);
    return s1 < e2 && e1 > s2;
}

// --- Conflict checks ---

async function checkRoomConflict(client, date, room, time, duration, excludeId = null) {
    if (!room || room === 'Інше') return null;
    const params = excludeId ? [date, room, excludeId] : [date, room];
    const result = await client.query(
        "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND status != 'cancelled'" +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    for (const b of result.rows) {
        if (hasTimeOverlap(time, duration, b.time, b.duration)) return b;
    }
    return null;
}

async function checkAfishaConflicts(client, date, time, duration) {
    const result = await client.query('SELECT * FROM afisha WHERE date = $1', [date]);
    for (const ev of result.rows) {
        if (hasTimeOverlap(time, duration, ev.time, ev.duration || 60)) {
            return { blocked: true, event: ev };
        }
    }
    return { blocked: false };
}

async function checkServerConflicts(client, date, lineId, time, duration, excludeId = null) {
    const params = excludeId ? [date, lineId, excludeId] : [date, lineId];
    const result = await client.query(
        'SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND line_id = $2 AND status != \'cancelled\'' +
        (excludeId ? ' AND id != $3' : ''),
        params
    );

    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        if (hasTimeOverlap(time, duration, b.time, b.duration)) {
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
        'SELECT id, category, time, duration FROM bookings WHERE date = $1 AND program_id = $2 AND status != \'cancelled\'' +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    for (const b of result.rows) {
        if (b.category === 'animation') continue;
        if (hasTimeOverlap(time, duration, b.time, b.duration)) return b;
    }
    return null;
}

// --- Booking number generator (BK-YYYY-NNNN) ---

async function generateBookingNumber(client) {
    const db = client || pool;
    const year = new Date().getFullYear();
    const result = await db.query(
        `INSERT INTO booking_counter (year, counter) VALUES ($1, 1)
         ON CONFLICT (year) DO UPDATE SET counter = booking_counter.counter + 1
         RETURNING counter`,
        [year]
    );
    const num = result.rows[0].counter;
    return `BK-${year}-${String(num).padStart(4, '0')}`;
}

// --- Row mapper (snake_case DB → camelCase JS) ---

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
        groupName: row.group_name || null
    };
}

// --- Ensure default lines ---

async function ensureDefaultLines(date) {
    const existing = await pool.query('SELECT COUNT(*) FROM lines_by_date WHERE date = $1', [date]);
    const count = parseInt(existing.rows[0].count);
    if (count < 2) {
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

// All rooms list
const ALL_ROOMS = [
    'Marvel', 'Ninja', 'Minecraft', 'Monster High', 'Elsa',
    'Растішка', 'Rock', 'Minion', 'Food Court', 'Жовтий стіл',
    'Диван 1', 'Диван 2', 'Диван 3', 'Диван 4'
];

module.exports = {
    validateDate, validateTime, validateId, validateSettingKey,
    timeToMinutes, minutesToTime,
    hasTimeOverlap,
    checkRoomConflict, checkAfishaConflicts, checkServerConflicts, checkServerDuplicate,
    generateBookingNumber,
    mapBookingRow,
    ensureDefaultLines,
    getKyivDate, getKyivDateStr, getKyivTimeStr,
    ALL_ROOMS
};
