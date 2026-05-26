/**
 * routes/hr.js — HR module API (v30.7)
 *
 * Endpoints: staff HR data, shifts, clock-in/out, time records, reports, templates
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getKyivDate, getKyivDateStr } = require('../services/booking');
const costumeInventory = require('../services/costumeInventory');
const { requireRole } = require('../middleware/auth');

// RBAC: HR module — management + HR + security + admin + manager
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'security'));
// v40: Validate numeric ID params
router.param('id', (req, res, next, val) => { if (val && !/^[0-9]+$/.test(val)) return res.status(400).json({ error: 'Invalid ID' }); next(); });

const log = createLogger('HR');

const COMPANY_STRUCTURE_SCHEMA_VERSION = 1;
const COMPANY_STRUCTURE_NODE_LIMIT = 60;
const COMPANY_STRUCTURE_ALLOWED_TONES = new Set(['gold', 'blue', 'purple', 'violet']);
const COMPANY_STRUCTURE_ALLOWED_LANES = new Set(['root', 'deputy', 'leadership', 'operations', 'support']);

const RESUME_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const RESUME_UPLOAD_LIMIT_FILES = 3;
const RESUME_TEXT_LIMIT = 50000;
const RESUME_ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.rtf', '.odt']);
const RESUME_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const RESUME_ALLOWED_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/octet-stream'
]);

function resumeFileExt(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function validateResumeUploadFile(file) {
    const ext = resumeFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!RESUME_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Непідтримуваний формат резюме');
        err.statusCode = 400;
        throw err;
    }
    if (mime && !mime.startsWith('text/') && !RESUME_ALLOWED_MIME_TYPES.has(mime)) {
        const err = new Error('Непідтримуваний MIME-тип резюме');
        err.statusCode = 400;
        throw err;
    }
}

const resumeUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: RESUME_UPLOAD_LIMIT_BYTES,
        files: RESUME_UPLOAD_LIMIT_FILES
    },
    fileFilter: (req, file, cb) => {
        try {
            validateResumeUploadFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleResumeUpload(req, res, next) {
    resumeUpload.array('files', RESUME_UPLOAD_LIMIT_FILES)(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        const error = err.code === 'LIMIT_FILE_COUNT'
            ? `Можна додати не більше ${RESUME_UPLOAD_LIMIT_FILES} файлів`
            : (err.message || 'Не вдалося завантажити резюме');
        res.status(status).json({ success: false, error });
    });
}

function normalizeResumeText(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .trim()
        .slice(0, RESUME_TEXT_LIMIT);
}

function extractResumeText(file) {
    const ext = resumeFileExt(file);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (RESUME_TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
        const text = normalizeResumeText(file.buffer.toString('utf8'));
        return {
            text,
            status: text ? 'extracted' : 'failed',
            note: text ? 'Текст імпортовано з файлу' : 'Файл не містить читабельного тексту'
        };
    }
    return {
        text: null,
        status: 'stored_only',
        note: 'Файл збережено як вкладення; для PDF/DOC/DOCX текст можна додати вручну у поле резюме'
    };
}

function resumeFileMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        application_id: row.application_id,
        original_name: row.original_name,
        mime_type: row.mime_type,
        file_ext: row.file_ext,
        file_size: row.file_size,
        extracted_text: row.extracted_text || null,
        extraction_status: row.extraction_status || 'stored_only',
        extraction_note: row.extraction_note || null,
        uploaded_by: row.uploaded_by || null,
        created_at: row.created_at,
        download_url: `/api/hr/applications/${row.application_id}/resume-files/${row.id}/download`
    };
}

function sanitizeCompanyStructureString(value, limit) {
    return String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function normalizeCompanyStructureId(value, fallback, usedIds) {
    const base = String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64) || fallback;
    let id = base;
    const suffixBase = (base || fallback || 'node').slice(0, 58);
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${suffixBase}_${suffix}`.slice(0, 64);
        suffix += 1;
    }
    usedIds.add(id);
    return id;
}

function sanitizeCompanyStructureNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    const usedIds = new Set();
    const normalized = nodes.slice(0, COMPANY_STRUCTURE_NODE_LIMIT).map((node, index) => {
        const source = node && typeof node === 'object' ? node : {};
        const id = normalizeCompanyStructureId(source.id, `node_${index + 1}`, usedIds);
        const tone = COMPANY_STRUCTURE_ALLOWED_TONES.has(source.tone) ? source.tone : 'blue';
        const lane = COMPANY_STRUCTURE_ALLOWED_LANES.has(source.lane) ? source.lane : 'leadership';
        const order = Number.isFinite(Number(source.order)) ? Number(source.order) : index;
        const x = Number.isFinite(Number(source.x)) ? Math.max(0, Math.min(5000, Number(source.x))) : null;
        const y = Number.isFinite(Number(source.y)) ? Math.max(0, Math.min(5000, Number(source.y))) : null;
        return {
            id,
            title: sanitizeCompanyStructureString(source.title, 80) || 'Роль',
            description: sanitizeCompanyStructureString(source.description, 1200),
            tone,
            lane,
            parentId: sanitizeCompanyStructureString(source.parentId, 64) || null,
            stack: sanitizeCompanyStructureString(source.stack, 64) || null,
            order,
            x,
            y,
            meta: sanitizeCompanyStructureString(source.meta, 80) || null
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map(node => {
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId
        };
    });
}

function normalizeCompanyStructurePayload(value) {
    let source = value && typeof value === 'object' ? value : {};
    if (typeof value === 'string') {
        try {
            source = JSON.parse(value);
        } catch {
            source = { instructions: value };
        }
    }
    return {
        schemaVersion: COMPANY_STRUCTURE_SCHEMA_VERSION,
        structure: sanitizeCompanyStructureString(source.structure || source.structure_text, 20000),
        instructions: sanitizeCompanyStructureString(source.instructions || source.instructions_text, 20000),
        nodes: sanitizeCompanyStructureNodes(source.nodes),
        updatedBy: source.updatedBy || null,
        updatedAt: source.updatedAt || null
    };
}

function safeDownloadName(name) {
    return String(name || 'resume')
        .replace(/[\r\n"]/g, '')
        .slice(0, 160) || 'resume';
}

async function loadResumeFilesForApplications(applicationIds) {
    const ids = [...new Set((applicationIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite))];
    if (!ids.length) return new Map();
    const files = await pool.query(
        `SELECT id, application_id, original_name, mime_type, file_ext, file_size,
                extracted_text, extraction_status, extraction_note, uploaded_by, created_at
         FROM job_application_resume_files
         WHERE application_id = ANY($1::int[])
         ORDER BY created_at DESC, id DESC`,
        [ids]
    );
    const grouped = new Map(ids.map(id => [id, []]));
    for (const row of files.rows) {
        const key = parseInt(row.application_id, 10);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(resumeFileMeta(row));
    }
    return grouped;
}

// Helper: get today's date in Kyiv timezone as YYYY-MM-DD
function todayKyiv() {
    return getKyivDateStr();
}

// Helper: get current Kyiv time as Date object
function nowKyiv() {
    return getKyivDate();
}

// Helper: time string "HH:MM" to minutes since midnight
function timeToMin(t) {
    if (!t) return 0;
    const s = typeof t === 'string' ? t : t.toString();
    const parts = s.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// Helper: minutes diff between now (Kyiv) and a TIME value on today
function minutesSincePlannedStart(plannedStart) {
    const now = nowKyiv();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin - timeToMin(plannedStart);
}

// Helper: audit log entry
async function auditLog(action, staffId, performedBy, details, ipAddress) {
    try {
        await pool.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [action, staffId, performedBy, details ? JSON.stringify(details) : null, ipAddress]
        );
    } catch (err) {
        log.error('Audit log error', err);
    }
}

function toDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function staffScheduleStatusForShift(shiftType) {
    return shiftType === 'remote' ? 'remote' : 'working';
}

function buildReplacementNote(shift) {
    if (!shift?.original_staff_id) return shift?.notes || null;
    const reason = shift.replacement_reason ? `: ${shift.replacement_reason}` : '';
    return `Підміна за співробітника #${shift.original_staff_id}${reason}`;
}

async function mirrorHrShiftToStaffSchedule(shift, db = pool) {
    const date = toDateOnly(shift?.shift_date);
    if (!shift?.staff_id || !date) return;
    await db.query(
        `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (staff_id, date)
         DO UPDATE SET shift_start = EXCLUDED.shift_start,
                       shift_end = EXCLUDED.shift_end,
                       status = EXCLUDED.status,
                       note = EXCLUDED.note`,
        [
            shift.staff_id,
            date,
            shift.planned_start || null,
            shift.planned_end || null,
            staffScheduleStatusForShift(shift.shift_type),
            buildReplacementNote(shift)
        ]
    );
}

async function removeMirroredStaffSchedule(staffId, shiftDate, db = pool) {
    const date = toDateOnly(shiftDate);
    if (!staffId || !date) return;
    await db.query(
        `DELETE FROM staff_schedule
         WHERE staff_id = $1
           AND date = $2
           AND status IN ('working', 'remote')`,
        [staffId, date]
    );
}

// ==========================================
// STAFF HR DATA
// ==========================================

// GET /api/hr/staff — list all staff with HR fields (v39.8: filter freelance, add is_freelance)
router.get('/staff', async (req, res) => {
    try {
        const { active, role_type, include_freelance } = req.query;
        let sql = `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, hire_date, birth_date, address, is_active, hourly_rate, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    is_freelance, unique_person_key, hr_pool_status, blacklist_reason, blacklisted_at,
                    (EXISTS(SELECT 1 FROM staff_face_descriptors sfd WHERE sfd.staff_id = staff.id)) AS has_face_descriptor,
                    (EXISTS(SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = staff.id AND ep.is_active = true)) AS has_account
                    FROM staff`;
        const params = [];
        const conds = [];
        if (active !== undefined) {
            params.push(active === 'true');
            conds.push(`is_active = $${params.length}`);
        }
        if (role_type) {
            params.push(role_type);
            conds.push(`role_type = $${params.length}`);
        }
        // v39.8: hide freelance placeholder slots by default
        if (include_freelance !== 'true') {
            conds.push(`(is_freelance = false OR is_freelance IS NULL)`);
        }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY name';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/staff/:id — full profile
router.get('/staff/:id', async (req, res) => {
    try {
        const staff = await pool.query(
            `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, hire_date, birth_date, address, is_active, hourly_rate, photo_url, notes,
                    telegram_id, telegram_username, color, contract_type, skills,
                    hr_pool_status, blacklist_reason, blacklisted_at
             FROM staff WHERE id = $1`, [req.params.id]
        );
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        res.json({ success: true, data: staff.rows[0] });
    } catch (err) {
        log.error('GET /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id — update HR fields
router.put('/staff/:id', async (req, res) => {
    try {
        const { phone, emergency_contact, emergency_phone, role_type, hourly_rate, birth_date, address, notes, telegram_id, telegram_username, contract_type, skills, hr_pool_status, blacklist_reason } = req.body;
        const result = await pool.query(
            `UPDATE staff SET
                phone = COALESCE($1, phone),
                emergency_contact = COALESCE($2, emergency_contact),
                emergency_phone = COALESCE($3, emergency_phone),
                role_type = COALESCE($4, role_type),
                hourly_rate = COALESCE($5, hourly_rate),
                birth_date = COALESCE($6, birth_date),
                notes = COALESCE($7, notes),
                telegram_id = COALESCE($8, telegram_id),
                telegram_username = COALESCE($9, telegram_username),
                contract_type = COALESCE($10, contract_type),
                skills = COALESCE($11, skills),
                address = COALESCE($12, address),
                hr_pool_status = COALESCE($13, hr_pool_status),
                blacklist_reason = CASE
                    WHEN $13::text = 'blacklisted' THEN COALESCE($14, blacklist_reason)
                    WHEN $13::text IS NOT NULL AND $13::text != 'blacklisted' THEN NULL
                    ELSE COALESCE($14, blacklist_reason)
                END,
                blacklisted_at = CASE
                    WHEN $13::text = 'blacklisted' THEN COALESCE(blacklisted_at, NOW())
                    WHEN $13::text IS NOT NULL AND $13::text != 'blacklisted' THEN NULL
                    ELSE blacklisted_at
                END
             WHERE id = $15 RETURNING *`,
            [phone, emergency_contact, emergency_phone, role_type, hourly_rate, birth_date, notes, telegram_id, telegram_username, contract_type, skills ? (Array.isArray(skills) ? skills : [skills]) : null, address, hr_pool_status, blacklist_reason, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('staff_update', parseInt(req.params.id), req.user?.username, req.body, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id/status — activate/deactivate
router.put('/staff/:id/status', async (req, res) => {
    try {
        const { is_active } = req.body;
        const result = await pool.query(
            'UPDATE staff SET is_active = $1 WHERE id = $2 RETURNING *',
            [is_active, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('status_change', parseInt(req.params.id), req.user?.username, { is_active }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/pool — reserve/blacklist operational lists
router.get('/pool', async (req, res) => {
    try {
        const status = req.query.status === 'blacklisted' ? 'blacklisted' : 'reserve';
        const result = await pool.query(
            `SELECT id, name, department, position, phone, role_type, contract_type,
                    is_active, hr_pool_status, blacklist_reason, blacklisted_at, notes
             FROM staff
             WHERE hr_pool_status = $1
             ORDER BY is_active DESC, name`,
            [status]
        );
        res.json({ success: true, status, data: result.rows });
    } catch (err) {
        log.error('GET /hr/pool error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id/pool-status — move staff between core/reserve/blacklist
router.put('/staff/:id/pool-status', async (req, res) => {
    try {
        const { status, reason } = req.body;
        if (!['core', 'reserve', 'blacklisted'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус пулу' });
        }
        const result = await pool.query(
            `UPDATE staff SET
                hr_pool_status = $1,
                blacklist_reason = CASE WHEN $1 = 'blacklisted' THEN COALESCE($2, blacklist_reason) ELSE NULL END,
                blacklisted_at = CASE WHEN $1 = 'blacklisted' THEN COALESCE(blacklisted_at, NOW()) ELSE NULL END
             WHERE id = $3
             RETURNING id, name, department, role_type, hr_pool_status, blacklist_reason, blacklisted_at`,
            [status, reason || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('pool_status_update', parseInt(req.params.id), req.user?.username, { status, reason }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/pool-status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET/PUT /api/hr/company-structure — HR-owned instructions without Control Center refactor
router.get('/company-structure', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'hr_company_structure'");
        const payload = normalizeCompanyStructurePayload(result.rows[0]?.value || {});
        res.json({ success: true, data: payload });
    } catch (err) {
        log.error('GET /hr/company-structure error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/company-structure', async (req, res) => {
    try {
        const payload = {
            ...normalizeCompanyStructurePayload(req.body || {}),
            updatedBy: req.user?.username || null,
            updatedAt: new Date().toISOString()
        };
        await pool.query(
            `INSERT INTO settings (key, value)
             VALUES ('hr_company_structure', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [JSON.stringify(payload)]
        );
        await auditLog('company_structure_update', null, req.user?.username, { updatedAt: payload.updatedAt, nodes: payload.nodes.length }, req.ip);
        res.json({ success: true, data: payload });
    } catch (err) {
        log.error('PUT /hr/company-structure error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SHIFT TEMPLATES
// ==========================================

router.get('/shift-templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hr_shift_templates ORDER BY is_default DESC, name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/shift-templates', async (req, res) => {
    try {
        const { name, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!name || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: name, planned_start, planned_end' });
        }
        const result = await pool.query(
            `INSERT INTO hr_shift_templates (name, planned_start, planned_end, break_minutes, shift_type)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, planned_start, planned_end, break_minutes || 0, shift_type || 'regular']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.delete('/shift-templates/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM hr_shift_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SHIFTS (SCHEDULE)
// ==========================================

// GET /api/hr/shifts — query by week/month/range
router.get('/shifts', async (req, res) => {
    try {
        const { week, month, from, to, staff_id } = req.query;
        let dateFrom, dateTo;

        if (week) {
            const d = new Date(week);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            dateFrom = new Date(d.setDate(diff)).toISOString().split('T')[0];
            dateTo = new Date(new Date(dateFrom).setDate(new Date(dateFrom).getDate() + 6)).toISOString().split('T')[0];
        } else if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current week
            const now = nowKyiv();
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const mon = new Date(now);
            mon.setDate(diff);
            dateFrom = mon.toISOString().split('T')[0];
            dateTo = new Date(mon.setDate(mon.getDate() + 6)).toISOString().split('T')[0];
        }

        let sql = `SELECT hs.*, s.name AS staff_name, s.color AS staff_color, s.role_type
                    FROM hr_shifts hs
                    JOIN staff s ON s.id = hs.staff_id
                    WHERE hs.shift_date >= $1 AND hs.shift_date <= $2`;
        const params = [dateFrom, dateTo];

        if (staff_id) {
            params.push(parseInt(staff_id));
            sql += ` AND hs.staff_id = $${params.length}`;
        }

        sql += ' ORDER BY s.name, hs.shift_date';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts — create single shift
router.post('/shifts', async (req, res) => {
    try {
        const { staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        if (!staff_id || !shift_date || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, shift_date, planned_start, planned_end' });
        }
        const result = await pool.query(
            `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                shift_type = EXCLUDED.shift_type, break_minutes = EXCLUDED.break_minutes,
                notes = EXCLUDED.notes, updated_at = NOW()
             RETURNING *`,
            [staff_id, shift_date, planned_start, planned_end, shift_type || 'regular', break_minutes || 0, notes, req.user?.username]
        );
        await auditLog('shift_create', staff_id, req.user?.username, { shift_date, planned_start, planned_end }, req.ip);
        await mirrorHrShiftToStaffSchedule(result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/shifts/:id — update shift
router.put('/shifts/:id', async (req, res) => {
    try {
        const { planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        const result = await pool.query(
            `UPDATE hr_shifts SET
                planned_start = COALESCE($1, planned_start),
                planned_end = COALESCE($2, planned_end),
                shift_type = COALESCE($3, shift_type),
                break_minutes = COALESCE($4, break_minutes),
                notes = COALESCE($5, notes),
                updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [planned_start, planned_end, shift_type, break_minutes, notes, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('shift_update', result.rows[0].staff_id, req.user?.username, req.body, req.ip);
        await mirrorHrShiftToStaffSchedule(result.rows[0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/shifts/:id
router.delete('/shifts/:id', async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM hr_shifts WHERE id = $1', [req.params.id]);
        if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await pool.query('DELETE FROM hr_shifts WHERE id = $1', [req.params.id]);
        await removeMirroredStaffSchedule(existing.rows[0].staff_id, existing.rows[0].shift_date);
        await auditLog('shift_delete', existing.rows[0].staff_id, req.user?.username,
            { shift_date: existing.rows[0].shift_date }, req.ip);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/:id/replace — move a shift to a replacement staff member
router.post('/shifts/:id/replace', async (req, res) => {
    const client = await pool.connect();
    try {
        const replacementStaffId = parseInt(req.body.replacement_staff_id, 10);
        const reason = String(req.body.reason || '').trim() || null;
        if (!replacementStaffId) {
            return res.status(400).json({ success: false, error: 'Потрібен replacement_staff_id' });
        }

        await client.query('BEGIN');
        const existing = await client.query('SELECT * FROM hr_shifts WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Зміну не знайдено' });
        }
        const oldShift = existing.rows[0];
        if (Number(oldShift.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого співробітника не потрібна' });
        }

        const replacement = await client.query(
            'SELECT id, name FROM staff WHERE id = $1 AND is_active = true',
            [replacementStaffId]
        );
        if (!replacement.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Підмінний співробітник неактивний або не існує' });
        }

        const conflict = await client.query(
            `SELECT id FROM hr_shifts
             WHERE staff_id = $1 AND shift_date = $2 AND id <> $3
             LIMIT 1`,
            [replacementStaffId, oldShift.shift_date, req.params.id]
        );
        if (conflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У підмінного співробітника вже є зміна на цю дату' });
        }

        const updated = await client.query(
            `UPDATE hr_shifts SET
                original_staff_id = COALESCE(original_staff_id, staff_id),
                staff_id = $1,
                replacement_reason = $2,
                replaced_by = $3,
                replaced_at = NOW(),
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [replacementStaffId, reason, req.user?.username || null, req.params.id]
        );

        await removeMirroredStaffSchedule(oldShift.staff_id, oldShift.shift_date, client);
        await mirrorHrShiftToStaffSchedule(updated.rows[0], client);
        await client.query('COMMIT');

        await auditLog('shift_replace', oldShift.staff_id, req.user?.username, {
            shift_id: parseInt(req.params.id),
            replacement_staff_id: replacementStaffId,
            reason
        }, req.ip);

        res.json({ success: true, data: updated.rows[0], replacement: replacement.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /hr/shifts/:id/replace error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/hr/shifts/bulk — mass create from template
router.post('/shifts/bulk', async (req, res) => {
    try {
        const { staff_ids, dates, template_id, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!staff_ids || !dates || (!template_id && !planned_start)) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_ids, dates та template_id або planned_start/planned_end' });
        }

        let start = planned_start, end = planned_end, brk = break_minutes || 0, stype = shift_type || 'regular';
        if (template_id) {
            const tpl = await pool.query('SELECT * FROM hr_shift_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
            start = tpl.rows[0].planned_start;
            end = tpl.rows[0].planned_end;
            brk = tpl.rows[0].break_minutes;
            stype = tpl.rows[0].shift_type;
        }

        let count = 0;
        for (const sid of staff_ids) {
            for (const d of dates) {
                const result = await pool.query(
                    `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                        planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                        break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type, updated_at = NOW()
                     RETURNING *`,
                    [sid, d, start, end, brk, stype, req.user?.username]
                );
                await mirrorHrShiftToStaffSchedule(result.rows[0]);
                count++;
            }
        }
        await auditLog('shift_bulk', null, req.user?.username, { staff_ids, dates, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/bulk error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/copy-week
router.post('/shifts/copy-week', async (req, res) => {
    try {
        const { source_week, target_week } = req.body;
        if (!source_week || !target_week) {
            return res.status(400).json({ success: false, error: 'Потрібні source_week і target_week' });
        }

        const srcMon = new Date(source_week);
        const tgtMon = new Date(target_week);
        const srcDates = [];
        const tgtDates = [];
        for (let i = 0; i < 7; i++) {
            const s = new Date(srcMon); s.setDate(srcMon.getDate() + i);
            const t = new Date(tgtMon); t.setDate(tgtMon.getDate() + i);
            srcDates.push(s.toISOString().split('T')[0]);
            tgtDates.push(t.toISOString().split('T')[0]);
        }

        const source = await pool.query(
            `SELECT hs.* FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id
             WHERE hs.shift_date >= $1 AND hs.shift_date <= $2 AND s.is_active = true`,
            [srcDates[0], srcDates[6]]
        );

        let count = 0;
        for (const row of source.rows) {
            const dayIndex = srcDates.indexOf(row.shift_date instanceof Date ? row.shift_date.toISOString().split('T')[0] : row.shift_date);
            if (dayIndex === -1) continue;
            const copied = await pool.query(
                `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, notes, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                    planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                    break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type, updated_at = NOW()
                 RETURNING *`,
                [row.staff_id, tgtDates[dayIndex], row.planned_start, row.planned_end, row.break_minutes, row.shift_type, row.notes, req.user?.username]
            );
            await mirrorHrShiftToStaffSchedule(copied.rows[0]);
            count++;
        }
        await auditLog('shift_copy_week', null, req.user?.username, { source_week, target_week, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CLOCK IN / CLOCK OUT
// ==========================================

// GET /api/hr/today — dashboard
router.get('/today', async (req, res) => {
    try {
        const today = todayKyiv();
        const staff = await pool.query(
            `SELECT id, name, color, role_type, photo_url FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL) ORDER BY name`
        );

        const shifts = await pool.query(
            'SELECT * FROM hr_shifts WHERE shift_date = $1', [today]
        );
        const shiftMap = {};
        for (const s of shifts.rows) shiftMap[s.staff_id] = s;

        const records = await pool.query(
            'SELECT * FROM hr_time_records WHERE record_date = $1', [today]
        );
        const recordMap = {};
        for (const r of records.rows) recordMap[r.staff_id] = r;

        let present = 0, late = 0, absent = 0, onVacation = 0, sick = 0;
        const data = staff.rows.map(s => {
            const shift = shiftMap[s.id] || null;
            const record = recordMap[s.id] || null;

            if (record) {
                if (record.status === 'late' || record.status === 'present' || record.status === 'clocked_in') present++;
                else if (record.status === 'vacation') onVacation++;
                else if (record.status === 'sick') sick++;
                else if (record.status === 'early_leave' || record.status === 'auto_closed') present++;
                if (record.status === 'late') late++;
            } else if (shift) {
                absent++;
            }

            return {
                staff_id: s.id,
                staff_name: s.name,
                staff_color: s.color,
                role_type: s.role_type,
                photo_url: s.photo_url,
                shift: shift ? { planned_start: shift.planned_start, planned_end: shift.planned_end, shift_type: shift.shift_type } : null,
                record: record ? {
                    id: record.id,
                    clock_in: record.clock_in,
                    clock_out: record.clock_out,
                    status: record.status,
                    late_minutes: record.late_minutes,
                    early_leave_minutes: record.early_leave_minutes,
                    overtime_minutes: record.overtime_minutes,
                    total_worked_minutes: record.total_worked_minutes,
                    auto_closed: record.auto_closed
                } : null
            };
        });

        res.json({
            success: true,
            date: today,
            data,
            summary: { total_staff: staff.rows.length, present, late, absent, on_vacation: onVacation, sick }
        });
    } catch (err) {
        log.error('GET /hr/today error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-in
router.post('/clock-in', async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const now = nowKyiv();

        // Check existing
        const existing = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (existing.rows.length > 0 && existing.rows[0].clock_in) {
            return res.status(409).json({ success: false, error: 'Вже відмічений сьогодні' });
        }

        // Find planned shift
        const shift = await pool.query(
            'SELECT * FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        const hasShift = shift.rows.length > 0;
        let plannedStart = null, plannedEnd = null, lateMin = 0, status = 'unscheduled';

        if (hasShift) {
            plannedStart = shift.rows[0].planned_start;
            plannedEnd = shift.rows[0].planned_end;
            const diff = minutesSincePlannedStart(plannedStart);
            lateMin = Math.max(0, diff);
            status = lateMin > 5 ? 'late' : 'present';
        }

        const clockIn = new Date().toISOString();

        let result;
        if (existing.rows.length > 0) {
            // Update existing absent record
            result = await pool.query(
                `UPDATE hr_time_records SET
                    clock_in = $1, planned_start = $2, planned_end = $3,
                    late_minutes = $4, status = $5, ip_address = $6, user_agent = $7, updated_at = NOW()
                 WHERE id = $8 RETURNING *`,
                [clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent'], existing.rows[0].id]
            );
        } else {
            result = await pool.query(
                `INSERT INTO hr_time_records (staff_id, record_date, clock_in, planned_start, planned_end, late_minutes, status, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [staff_id, today, clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent']]
            );
        }

        await auditLog('clock_in', staff_id, req.user?.username, { clock_in: clockIn, late_minutes: lateMin, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-in error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-out
router.post('/clock-out', async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const record = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (record.rows.length === 0 || !record.rows[0].clock_in) {
            return res.status(400).json({ success: false, error: 'Спочатку відмітьте прихід' });
        }
        if (record.rows[0].clock_out) {
            return res.status(409).json({ success: false, error: 'Вже завершено' });
        }

        const rec = record.rows[0];
        const clockOut = new Date().toISOString();
        const clockInDate = new Date(rec.clock_in);
        const clockOutDate = new Date(clockOut);

        // Get break from shift
        let breakMin = 0;
        const shift = await pool.query(
            'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;

        const totalWorked = Math.round((clockOutDate - clockInDate) / 60000) - breakMin;
        let earlyLeave = 0, overtime = 0;
        let status = rec.status;

        if (rec.planned_end) {
            const now = nowKyiv();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const plannedEndMin = timeToMin(rec.planned_end);
            const diff = plannedEndMin - nowMin;

            if (diff > 15) {
                earlyLeave = diff;
                status = 'early_leave';
            } else if (diff < -15) {
                overtime = Math.abs(diff);
            }
        }

        // Keep 'late' if was late
        if (rec.status === 'late' && status !== 'early_leave') status = 'late';
        if (status === 'present' || status === 'unscheduled' || status === 'clocked_in') status = 'present';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_out = $1, total_worked_minutes = $2, early_leave_minutes = $3,
                overtime_minutes = $4, status = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [clockOut, Math.max(0, totalWorked), earlyLeave, overtime, status, rec.id]
        );

        await auditLog('clock_out', staff_id, req.user?.username,
            { clock_out: clockOut, total_worked_minutes: totalWorked, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-out error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/mark-absent — mark sick/vacation/day_off
router.post('/mark-absent', async (req, res) => {
    try {
        const { staff_id, status, notes } = req.body;
        if (!staff_id || !status) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_id та status' });
        }
        const validStatuses = ['sick', 'vacation', 'day_off'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус' });
        }

        const today = todayKyiv();
        const result = await pool.query(
            `INSERT INTO hr_time_records (staff_id, record_date, status, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (staff_id, record_date) DO UPDATE SET status = $3, notes = $4, updated_at = NOW()
             RETURNING *`,
            [staff_id, today, status, notes]
        );

        await auditLog('mark_absent', staff_id, req.user?.username, { status, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/mark-absent error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CORRECTION (admin only)
// ==========================================

router.put('/records/:id/correct', async (req, res) => {
    try {
        const { clock_in, clock_out, notes } = req.body;
        const rec = await pool.query('SELECT * FROM hr_time_records WHERE id = $1', [req.params.id]);
        if (rec.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const original = rec.rows[0];
        const newClockIn = clock_in ? new Date(clock_in).toISOString() : original.clock_in;
        const newClockOut = clock_out ? new Date(clock_out).toISOString() : original.clock_out;

        // Recalculate
        let totalWorked = 0, lateMin = 0, earlyLeave = 0, overtime = 0;
        if (newClockIn && newClockOut) {
            let breakMin = 0;
            const shift = await pool.query(
                'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
                [original.staff_id, original.record_date]
            );
            if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;
            totalWorked = Math.max(0, Math.round((new Date(newClockOut) - new Date(newClockIn)) / 60000) - breakMin);
        }

        if (original.planned_start && newClockIn) {
            const ciDate = new Date(newClockIn);
            const ciMin = ciDate.getHours() * 60 + ciDate.getMinutes();
            lateMin = Math.max(0, ciMin - timeToMin(original.planned_start));
        }

        if (original.planned_end && newClockOut) {
            const coDate = new Date(newClockOut);
            const coMin = coDate.getHours() * 60 + coDate.getMinutes();
            const plannedEndMin = timeToMin(original.planned_end);
            if (plannedEndMin - coMin > 15) earlyLeave = plannedEndMin - coMin;
            if (coMin - plannedEndMin > 15) overtime = coMin - plannedEndMin;
        }

        let status = lateMin > 5 ? 'late' : 'present';
        if (earlyLeave > 0) status = 'early_leave';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_in = $1, clock_out = $2,
                total_worked_minutes = $3, late_minutes = $4, early_leave_minutes = $5, overtime_minutes = $6,
                status = $7,
                original_clock_in = COALESCE(original_clock_in, $8),
                original_clock_out = COALESCE(original_clock_out, $9),
                corrected_by = $10, corrected_at = NOW(), correction_reason = $11,
                updated_at = NOW()
             WHERE id = $12 RETURNING *`,
            [newClockIn, newClockOut, totalWorked, lateMin, earlyLeave, overtime, status,
             original.clock_in, original.clock_out, req.user?.username, notes, req.params.id]
        );

        await auditLog('correction', original.staff_id, req.user?.username,
            { old_clock_in: original.clock_in, old_clock_out: original.clock_out, new_clock_in: newClockIn, new_clock_out: newClockOut, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/records/:id/correct error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// REPORTS
// ==========================================

// GET /api/hr/report/monthly
router.get('/report/monthly', async (req, res) => {
    try {
        const { month, from, to } = req.query;
        let dateFrom, dateTo;

        if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current month
            const now = nowKyiv();
            const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
            dateFrom = `${y}-${m}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        }

        const staffList = await pool.query(
            'SELECT id, name, role_type, hourly_rate FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL) ORDER BY name'
        );

        const shifts = await pool.query(
            'SELECT staff_id, COUNT(*) AS cnt FROM hr_shifts WHERE shift_date >= $1 AND shift_date <= $2 GROUP BY staff_id',
            [dateFrom, dateTo]
        );
        const shiftCounts = {};
        for (const r of shifts.rows) shiftCounts[r.staff_id] = parseInt(r.cnt);

        const records = await pool.query(
            `SELECT staff_id, status, late_minutes, early_leave_minutes, overtime_minutes, total_worked_minutes
             FROM hr_time_records WHERE record_date >= $1 AND record_date <= $2`,
            [dateFrom, dateTo]
        );

        const taskKpiRows = await pool.query(
            `SELECT ep.staff_id,
                    COUNT(t.id)::int AS tasks_assigned,
                    COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') = 'done')::int AS tasks_done,
                    COUNT(t.id) FILTER (
                        WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
                          AND t.deadline IS NOT NULL
                          AND t.deadline < NOW()
                    )::int AS tasks_overdue
             FROM tasks t
             JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active = true
             WHERE t.owner_user_id IS NOT NULL
               AND (
                    t.created_at::date BETWEEN $1::date AND $2::date
                    OR t.completed_at::date BETWEEN $1::date AND $2::date
               )
             GROUP BY ep.staff_id`,
            [dateFrom, dateTo]
        ).catch(err => {
            log.warn('Task KPI query failed:', err.message);
            return { rows: [] };
        });

        const taskKpiMap = {};
        for (const r of taskKpiRows.rows) {
            taskKpiMap[r.staff_id] = {
                tasks_assigned: parseInt(r.tasks_assigned) || 0,
                tasks_done: parseInt(r.tasks_done) || 0,
                tasks_overdue: parseInt(r.tasks_overdue) || 0
            };
        }

        const statsMap = {};
        for (const r of records.rows) {
            if (!statsMap[r.staff_id]) {
                statsMap[r.staff_id] = {
                    days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                    days_sick: 0, days_vacation: 0,
                    total_worked_minutes: 0, total_overtime_minutes: 0,
                    late_count: 0, total_late_minutes: 0
                };
            }
            const s = statsMap[r.staff_id];
            if (['present', 'late', 'early_leave', 'auto_closed', 'unscheduled'].includes(r.status)) {
                s.days_worked++;
                s.total_worked_minutes += r.total_worked_minutes || 0;
                s.total_overtime_minutes += r.overtime_minutes || 0;
            }
            if (r.status === 'late') { s.days_late++; s.late_count++; s.total_late_minutes += r.late_minutes || 0; }
            if (r.status === 'early_leave') s.days_early_leave++;
            if (r.status === 'absent' || r.status === 'no_show') s.days_absent++;
            if (r.status === 'sick') s.days_sick++;
            if (r.status === 'vacation') s.days_vacation++;
        }

        const data = staffList.rows.map(st => {
            const s = statsMap[st.id] || {
                days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                days_sick: 0, days_vacation: 0, total_worked_minutes: 0, total_overtime_minutes: 0,
                late_count: 0, total_late_minutes: 0
            };
            const daysScheduled = shiftCounts[st.id] || 0;
            const totalWorkedHours = Math.round(s.total_worked_minutes / 60 * 10) / 10;
            const totalOvertimeHours = Math.round(s.total_overtime_minutes / 60 * 10) / 10;
            const rate = parseFloat(st.hourly_rate) || 0;
            const taskKpi = taskKpiMap[st.id] || { tasks_assigned: 0, tasks_done: 0, tasks_overdue: 0 };

            return {
                staff_id: st.id,
                staff_name: st.name,
                role_type: st.role_type,
                hourly_rate: rate,
                days_scheduled: daysScheduled,
                days_worked: s.days_worked,
                days_late: s.days_late,
                days_early_leave: s.days_early_leave,
                days_absent: s.days_absent,
                days_sick: s.days_sick,
                days_vacation: s.days_vacation,
                total_worked_hours: totalWorkedHours,
                total_overtime_hours: totalOvertimeHours,
                estimated_salary: Math.round(totalWorkedHours * rate),
                late_count: s.late_count,
                avg_late_minutes: s.late_count > 0 ? Math.round(s.total_late_minutes / s.late_count) : 0,
                attendance_rate: daysScheduled > 0 ? Math.round(s.days_worked / daysScheduled * 100) : 0,
                task_kpi: taskKpi,
                task_completion_rate: taskKpi.tasks_assigned > 0 ? Math.round(taskKpi.tasks_done / taskKpi.tasks_assigned * 100) : 0
            };
        });

        res.json({ success: true, data, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/report/monthly error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/daily
router.get('/report/daily', async (req, res) => {
    try {
        const date = req.query.date || todayKyiv();
        const result = await pool.query(
            `SELECT tr.*, s.name AS staff_name, s.role_type, s.color,
                    hs.planned_start AS shift_start, hs.planned_end AS shift_end
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date = $1 ORDER BY s.name`, [date]
        );
        res.json({ success: true, data: result.rows, date });
    } catch (err) {
        log.error('GET /hr/report/daily error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/export — CSV export
router.get('/report/export', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ success: false, error: 'Потрібні from та to' });

        const result = await pool.query(
            `SELECT s.name, tr.record_date, tr.clock_in, tr.clock_out,
                    tr.planned_start, tr.planned_end,
                    tr.total_worked_minutes, tr.late_minutes, tr.early_leave_minutes, tr.overtime_minutes,
                    s.hourly_rate
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             WHERE tr.record_date >= $1 AND tr.record_date <= $2
             ORDER BY s.name, tr.record_date`,
            [from, to]
        );

        const header = 'ПІБ;Дата;Прихід;Відхід;Заплановано початок;Заплановано кінець;Відпрацьовано хв;Запізнення хв;Рано пішов хв;Переробка хв;Ставка;Сума\n';
        const rows = result.rows.map(r => {
            const ci = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const co = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const workedH = ((r.total_worked_minutes || 0) / 60).toFixed(1);
            const rate = parseFloat(r.hourly_rate) || 0;
            const salary = (parseFloat(workedH) * rate).toFixed(0);
            return `${r.name};${r.record_date};${ci};${co};${r.planned_start || ''};${r.planned_end || ''};${r.total_worked_minutes || 0};${r.late_minutes || 0};${r.early_leave_minutes || 0};${r.overtime_minutes || 0};${rate};${salary}`;
        }).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="hr_report_${from}_${to}.csv"`);
        res.send('\uFEFF' + header + rows);
    } catch (err) {
        log.error('GET /hr/report/export error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// LEAVE REQUESTS (#2)
// ==========================================

// GET /api/hr/leave-requests
router.get('/leave-requests', async (req, res) => {
    try {
        const { status, staff_id } = req.query;
        let sql = `SELECT lr.*, s.name AS staff_name, s.department,
                    u.username AS reviewer_name
                   FROM leave_requests lr
                   JOIN staff s ON s.id = lr.staff_id
                   LEFT JOIN users u ON u.id = lr.reviewed_by`;
        const params = [];
        const conds = [];
        if (status) { params.push(status); conds.push(`lr.status = $${params.length}`); }
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`lr.staff_id = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY lr.created_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/leave-requests error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/leave-requests — submit new request
router.post('/leave-requests', async (req, res) => {
    try {
        const { staff_id, type, date_from, date_to, reason } = req.body;
        if (!staff_id || !type || !date_from || !date_to) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, type, date_from, date_to' });
        }
        const days = Math.ceil((new Date(date_to) - new Date(date_from)) / 86400000) + 1;
        const result = await pool.query(
            `INSERT INTO leave_requests (staff_id, type, date_from, date_to, days, reason)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [staff_id, type, date_from, date_to, days, reason]
        );
        await auditLog('leave_request_create', staff_id, req.user?.username, { type, date_from, date_to }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/leave-requests error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/leave-requests/:id/review — approve/reject
router.put('/leave-requests/:id/review', async (req, res) => {
    try {
        const { status, comment } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Статус: approved або rejected' });
        }
        const result = await pool.query(
            `UPDATE leave_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_comment = $3
             WHERE id = $4 RETURNING *`,
            [status, req.user?.id, comment, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const lr = result.rows[0];
        // If approved, mark days as vacation/sick/day_off in time records
        if (status === 'approved') {
            const d = new Date(lr.date_from);
            const end = new Date(lr.date_to);
            while (d <= end) {
                const dateStr = d.toISOString().split('T')[0];
                await pool.query(
                    `INSERT INTO hr_time_records (staff_id, record_date, status, notes)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (staff_id, record_date) DO UPDATE SET status = $3, notes = $4`,
                    [lr.staff_id, dateStr, lr.type === 'vacation' ? 'vacation' : lr.type === 'sick' ? 'sick' : 'day_off', `Заявка #${lr.id}`]
                );
                d.setDate(d.getDate() + 1);
            }
        }
        await auditLog('leave_request_review', lr.staff_id, req.user?.username, { status, comment }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/leave-requests/:id/review error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/leave-requests/:id — cancel
router.delete('/leave-requests/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено або вже оброблено' });
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/leave-requests/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// STAFF RATINGS (#3)
// ==========================================

// GET /api/hr/ratings — staff leaderboard
router.get('/ratings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.name, s.department, s.role_type, s.color, s.photo_url,
                   COALESCE(s.avg_rating, 0) AS avg_rating,
                   COALESCE(s.total_ratings, 0) AS total_ratings,
                   COUNT(DISTINCT b.id) AS total_events,
                   COUNT(DISTINCT b.id) FILTER (WHERE b.date::date >= CURRENT_DATE - INTERVAL '30 days') AS events_30d
            FROM staff s
            LEFT JOIN bookings b ON (
                b.line_id = s.id::text
                OR b.second_animator = s.id::text
                OR LOWER(BTRIM(COALESCE(b.second_animator, ''))) = LOWER(BTRIM(s.name))
            )
                AND b.status IN ('completed', 'confirmed')
            WHERE s.is_active = true AND s.role_type IN ('animator', 'host')
            GROUP BY s.id
            ORDER BY COALESCE(s.avg_rating, 0) DESC, COUNT(DISTINCT b.id) DESC
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/ratings error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/ratings/:staffId — add rating
router.post('/ratings/:staffId', async (req, res) => {
    try {
        const { score, comment } = req.body;
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ success: false, error: 'Оцінка від 1 до 5' });
        }
        const staffId = parseInt(req.params.staffId);
        // Update staff avg_rating
        const staff = await pool.query('SELECT avg_rating, total_ratings FROM staff WHERE id = $1', [staffId]);
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const oldAvg = parseFloat(staff.rows[0].avg_rating) || 0;
        const oldCount = parseInt(staff.rows[0].total_ratings) || 0;
        const newCount = oldCount + 1;
        const newAvg = ((oldAvg * oldCount) + score) / newCount;

        await pool.query(
            'UPDATE staff SET avg_rating = $1, total_ratings = $2 WHERE id = $3',
            [Math.round(newAvg * 100) / 100, newCount, staffId]
        );
        await auditLog('rating_add', staffId, req.user?.username, { score, comment }, req.ip);
        res.json({ success: true, avg_rating: Math.round(newAvg * 100) / 100, total_ratings: newCount });
    } catch (err) {
        log.error('POST /hr/ratings/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// AUTO-ASSIGNMENT (#4)
// ==========================================

// POST /api/hr/auto-assign — find best animator for a booking
router.post('/auto-assign', async (req, res) => {
    try {
        const { date, time_start, time_end, required_skills, exclude_ids } = req.body;
        if (!date || !time_start) {
            return res.status(400).json({ success: false, error: 'Потрібні date та time_start' });
        }

        // 1. Find available animators (have shift, not on leave)
        const available = await pool.query(`
            SELECT s.id, s.name, s.skills, s.avg_rating, s.total_events, s.color
            FROM staff s
            JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1
            WHERE s.is_active = true
              AND s.role_type IN ('animator', 'host')
              AND NOT EXISTS (
                SELECT 1 FROM leave_requests lr
                WHERE lr.staff_id = s.id AND lr.status = 'approved'
                  AND $1::date BETWEEN lr.date_from AND lr.date_to
              )
              AND NOT EXISTS (
                SELECT 1 FROM hr_time_records tr
                WHERE tr.staff_id = s.id AND tr.record_date = $1
                  AND tr.status IN ('sick', 'vacation', 'day_off')
              )
            ORDER BY s.avg_rating DESC, s.total_events ASC
        `, [date]);

        let candidates = available.rows;

        // 2. Exclude already assigned
        if (exclude_ids && exclude_ids.length) {
            candidates = candidates.filter(c => !exclude_ids.includes(c.id));
        }

        // 3. Filter by skills
        if (required_skills && required_skills.length) {
            candidates = candidates.filter(c => {
                const skills = c.skills || [];
                return required_skills.some(s => skills.includes(s));
            });
        }

        // 4. Check booking conflicts — find busy animators by line/second animator id.
        const booked = await pool.query(`
            SELECT DISTINCT line_id::int AS staff_id FROM bookings
            WHERE date = $1 AND status IN ('confirmed', 'pending')
              AND time < $2 AND line_id ~ '^[0-9]+$'
            UNION
            SELECT DISTINCT second_animator::int AS staff_id FROM bookings
            WHERE date = $1 AND status IN ('confirmed', 'pending')
              AND time < $2 AND second_animator IS NOT NULL AND second_animator != ''
              AND second_animator ~ '^[0-9]+$'
        `, [date, time_end || '23:59']);

        const busyIds = booked.rows.map(r => r.staff_id);
        candidates = candidates.filter(c => !busyIds.includes(c.id));

        // 5. Score and rank
        const scored = candidates.map(c => ({
            ...c,
            score: (parseFloat(c.avg_rating) || 0) * 20 + Math.min(parseInt(c.total_events) || 0, 50)
        }));
        scored.sort((a, b) => b.score - a.score);

        res.json({ success: true, data: scored.slice(0, 5), total_available: scored.length });
    } catch (err) {
        log.error('POST /hr/auto-assign error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// ONBOARDING (#5)
// ==========================================

// GET /api/hr/onboarding/templates
router.get('/onboarding/templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM onboarding_templates ORDER BY name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/onboarding/templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/onboarding/templates
router.post('/onboarding/templates', async (req, res) => {
    try {
        const { name, department, items } = req.body;
        if (!name || !items) return res.status(400).json({ success: false, error: 'Потрібні name та items' });
        const result = await pool.query(
            'INSERT INTO onboarding_templates (name, department, items) VALUES ($1, $2, $3) RETURNING *',
            [name, department, JSON.stringify(items)]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/onboarding/templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/onboarding/start — start onboarding for staff
router.post('/onboarding/start', async (req, res) => {
    try {
        const { staff_id, template_id } = req.body;
        if (!staff_id || !template_id) return res.status(400).json({ success: false, error: 'Потрібні staff_id та template_id' });

        const tpl = await pool.query('SELECT * FROM onboarding_templates WHERE id = $1', [template_id]);
        if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });

        const items = (tpl.rows[0].items || []).map((it, i) => ({ ...it, id: i + 1, done: false, done_at: null }));
        const result = await pool.query(
            `INSERT INTO onboarding_progress (staff_id, template_id, items, total_items)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [staff_id, template_id, JSON.stringify(items), items.length]
        );
        await auditLog('onboarding_start', staff_id, req.user?.username, { template_id }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/onboarding/start error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/onboarding — list all progress
router.get('/onboarding', async (req, res) => {
    try {
        const { staff_id, status } = req.query;
        let sql = `SELECT op.*, s.name AS staff_name, s.department, ot.name AS template_name
                   FROM onboarding_progress op
                   JOIN staff s ON s.id = op.staff_id
                   LEFT JOIN onboarding_templates ot ON ot.id = op.template_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`op.staff_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`op.status = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY op.started_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/onboarding error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/onboarding/:id/check — toggle item completion
router.put('/onboarding/:id/check', async (req, res) => {
    try {
        const { item_id, done } = req.body;
        const prog = await pool.query('SELECT * FROM onboarding_progress WHERE id = $1', [req.params.id]);
        if (prog.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const items = prog.rows[0].items || [];
        const item = items.find(i => i.id === item_id);
        if (!item) return res.status(404).json({ success: false, error: 'Пункт не знайдено' });

        item.done = done;
        item.done_at = done ? new Date().toISOString() : null;
        const completedItems = items.filter(i => i.done).length;
        const isComplete = completedItems === items.length;

        const result = await pool.query(
            `UPDATE onboarding_progress SET items = $1, completed_items = $2,
             status = $3, completed_at = $4 WHERE id = $5 RETURNING *`,
            [JSON.stringify(items), completedItems, isComplete ? 'completed' : 'in_progress',
             isComplete ? new Date().toISOString() : null, req.params.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/onboarding/:id/check error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CERTIFICATIONS (#6)
// ==========================================

// GET /api/hr/certifications
router.get('/certifications', async (req, res) => {
    try {
        const { staff_id, status } = req.query;
        let sql = `SELECT sc.*, s.name AS staff_name, s.department
                   FROM staff_certifications sc
                   JOIN staff s ON s.id = sc.staff_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`sc.staff_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`sc.status = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sc.expires_at ASC NULLS LAST';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/certifications error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/certifications
router.post('/certifications', async (req, res) => {
    try {
        const { staff_id, name, category, issued_at, expires_at, training_id, notes } = req.body;
        if (!staff_id || !name) return res.status(400).json({ success: false, error: 'Потрібні staff_id та name' });
        const result = await pool.query(
            `INSERT INTO staff_certifications (staff_id, name, category, issued_at, expires_at, training_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [staff_id, name, category || 'general', issued_at, expires_at, training_id, notes]
        );
        await auditLog('certification_add', staff_id, req.user?.username, { name, category }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/certifications error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/certifications/:id
router.delete('/certifications/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM staff_certifications WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/certifications/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SALARY REPORT (#7)
// ==========================================

// GET /api/hr/salary — full salary calculation
router.get('/salary', async (req, res) => {
    try {
        const month = req.query.month || (() => {
            const now = nowKyiv();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        })();
        const dateFrom = `${month}-01`;
        const d = new Date(dateFrom);
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
        const dateTo = d.toISOString().split('T')[0];

        // Get staff with hours — v32.1: safe fallback if tables don't exist
        let staffList;
        try {
            staffList = await pool.query(
                'SELECT id, name, role_type, hourly_rate, department FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL) ORDER BY name'
            );
        } catch (staffErr) {
            log.warn('staff query failed:', staffErr.message);
            return res.json({ success: true, data: [], totals: { total_base: 0, total_overtime: 0, total_bonuses: 0, total_deductions: 0, total_salary: 0 }, month });
        }

        const recordMap = {};
        try {
            const records = await pool.query(
                `SELECT staff_id, SUM(total_worked_minutes) AS total_minutes,
                        SUM(overtime_minutes) AS overtime_minutes,
                        COUNT(*) FILTER (WHERE status IN ('present', 'late', 'early_leave', 'auto_closed')) AS days_worked
                 FROM hr_time_records
                 WHERE record_date >= $1 AND record_date <= $2
                 GROUP BY staff_id`,
                [dateFrom, dateTo]
            );
            for (const r of records.rows) recordMap[r.staff_id] = r;
        } catch (recErr) {
            log.warn('hr_time_records query failed:', recErr.message);
        }

        // Get adjustments — v32.1: safe fallback if table doesn't exist yet
        const adjMap = {};
        try {
            const adjustments = await pool.query(
                `SELECT staff_id, type, SUM(amount) AS total
                 FROM salary_adjustments WHERE month = $1 GROUP BY staff_id, type`,
                [month]
            );
            for (const a of adjustments.rows) {
                if (!adjMap[a.staff_id]) adjMap[a.staff_id] = { bonus: 0, deduction: 0, penalty: 0, tip: 0 };
                adjMap[a.staff_id][a.type] = parseInt(a.total);
            }
        } catch (adjErr) {
            log.warn('salary_adjustments query failed (table may not exist):', adjErr.message);
        }

        const data = staffList.rows.map(st => {
            const rec = recordMap[st.id] || { total_minutes: 0, overtime_minutes: 0, days_worked: 0 };
            const adj = adjMap[st.id] || { bonus: 0, deduction: 0, penalty: 0, tip: 0 };
            const rate = parseFloat(st.hourly_rate) || 0;
            const hours = Math.round((parseInt(rec.total_minutes) || 0) / 60 * 10) / 10;
            const overtimeHours = Math.round((parseInt(rec.overtime_minutes) || 0) / 60 * 10) / 10;
            const baseSalary = Math.round(hours * rate);
            const overtimePay = Math.round(overtimeHours * rate * 1.5);
            const totalBonuses = adj.bonus + adj.tip;
            const totalDeductions = adj.deduction + adj.penalty;
            const totalSalary = baseSalary + overtimePay + totalBonuses - totalDeductions;

            return {
                staff_id: st.id,
                staff_name: st.name,
                role_type: st.role_type,
                department: st.department,
                hourly_rate: rate,
                days_worked: parseInt(rec.days_worked) || 0,
                hours_worked: hours,
                overtime_hours: overtimeHours,
                base_salary: baseSalary,
                overtime_pay: overtimePay,
                bonuses: adj.bonus,
                tips: adj.tip,
                deductions: adj.deduction,
                penalties: adj.penalty,
                total_salary: totalSalary
            };
        });

        const totals = data.reduce((acc, d) => ({
            total_base: acc.total_base + d.base_salary,
            total_overtime: acc.total_overtime + d.overtime_pay,
            total_bonuses: acc.total_bonuses + d.bonuses + d.tips,
            total_deductions: acc.total_deductions + d.deductions + d.penalties,
            total_salary: acc.total_salary + d.total_salary
        }), { total_base: 0, total_overtime: 0, total_bonuses: 0, total_deductions: 0, total_salary: 0 });

        res.json({ success: true, data, totals, month });
    } catch (err) {
        log.error('GET /hr/salary error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/salary/adjustment — add bonus/deduction/depremium
router.post('/salary/adjustment', async (req, res) => {
    try {
        const { staff_id, month, type, amount, reason, template_id, violation_date, evidence_note, evidence_url } = req.body;
        if (!staff_id || !month || !type || amount === undefined) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, month, type, amount' });
        }

        let finalReason = reason;
        let finalAmount = Number(amount);
        let ruleCode = null, disciplineCategory = null, severity = null;
        let repeatIndex = 0, decisionMode = 'custom', needsReview = false;
        let tplId = template_id || null;

        // Template-based depremium flow
        if ((type === 'penalty' || type === 'deduction') && tplId) {
            const tplRes = await pool.query('SELECT * FROM depremium_templates WHERE id = $1 AND active = true', [tplId]);
            if (!tplRes.rows.length) return res.status(400).json({ success: false, error: 'Шаблон не знайдено' });
            const tpl = tplRes.rows[0];

            finalReason = tpl.official_reason;
            ruleCode = tpl.code;
            disciplineCategory = tpl.discipline_category;
            severity = tpl.severity;
            decisionMode = 'template';
            needsReview = !!tpl.requires_manual_review;

            if (!amount && tpl.amount) finalAmount = Number(tpl.amount);
            if (!tpl.can_be_edited && amount && Number(amount) !== Number(tpl.amount || 0)) {
                return res.status(400).json({ success: false, error: 'Суму критичного порушення не можна змінювати' });
            }

            // Repeat detection
            const repeatRes = await pool.query(
                `SELECT COUNT(*)::int AS c FROM salary_adjustments
                 WHERE staff_id = $1 AND type IN ('penalty','deduction')
                 AND (template_id = $2 OR rule_code = $3 OR discipline_category = $4)`,
                [staff_id, tpl.id, tpl.code, tpl.discipline_category]
            );
            repeatIndex = (repeatRes.rows[0]?.c || 0) + 1;
            if (tpl.is_repeat_offense || repeatIndex > 1 || severity === 'critical') needsReview = true;
        }

        const status = needsReview ? 'pending_review' : 'applied';
        const result = await pool.query(
            `INSERT INTO salary_adjustments (staff_id, month, type, amount, reason, created_by,
             template_id, rule_code, discipline_category, severity, repeat_index, decision_mode, status,
             violation_date, evidence_note, evidence_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [staff_id, month, type, finalAmount, finalReason, req.user?.username,
             tplId, ruleCode, disciplineCategory, severity, repeatIndex, decisionMode, status,
             violation_date || null, evidence_note || null, evidence_url || null]
        );
        const adj = result.rows[0];

        // Audit log
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [adj.id, staff_id, 'create', req.user?.username, req.user?.role, tplId,
             JSON.stringify({ amount: finalAmount, reason: finalReason, severity, repeatIndex, needsReview })]
        ).catch(e => log.warn('Discipline log failed:', e.message));

        await auditLog('salary_adjustment', staff_id, req.user?.username, { type, amount: finalAmount, reason: finalReason, template_id: tplId }, req.ip);

        // Dry notification to staff (fire-and-forget, no word "штраф")
        if ((type === 'penalty' || type === 'deduction') && status === 'applied') {
            setImmediate(async () => {
                try {
                    const staffRow = await pool.query('SELECT telegram_id FROM staff WHERE id = $1', [staff_id]);
                    const tgId = staffRow.rows[0]?.telegram_id;
                    if (tgId) {
                        const msg = [
                            `📋 Депреміювання${finalAmount ? ` -${Number(finalAmount).toFixed(0)}₴` : ''}`,
                            `Причина: ${finalReason}`,
                            repeatIndex > 1 ? `Повторність: ${repeatIndex}-й зафіксований випадок` : null
                        ].filter(Boolean).join('\n');
                        await sendTelegramMessage(tgId, msg);
                    }
                } catch (e) { log.warn('Depremium TG notify failed:', e.message); }
            });
        }

        res.json({ success: true, data: adj, needsReview });
    } catch (err) {
        log.error('POST /hr/salary/adjustment error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/salary/adjustments — list adjustments
router.get('/salary/adjustments', async (req, res) => {
    try {
        const { staff_id, month } = req.query;
        let sql = `SELECT sa.*, s.name AS staff_name FROM salary_adjustments sa
                   JOIN staff s ON s.id = sa.staff_id`;
        const params = [];
        const conds = [];
        if (staff_id) { params.push(parseInt(staff_id)); conds.push(`sa.staff_id = $${params.length}`); }
        if (month) { params.push(month); conds.push(`sa.month = $${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sa.created_at DESC';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/salary/adjustments error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// COSTUMES (#8)
// ==========================================

// GET /api/hr/costumes
router.get('/costumes', async (req, res) => {
    try {
        const data = await costumeInventory.listCostumes();
        res.json({ success: true, data });
    } catch (err) {
        log.error('GET /hr/costumes error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/costumes
router.post('/costumes', async (req, res) => {
    try {
        const data = await costumeInventory.createCostume(req.body);
        res.json({ success: true, data });
    } catch (err) {
        log.error('POST /hr/costumes error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

// PUT /api/hr/costumes/:id
router.put('/costumes/:id', async (req, res) => {
    try {
        const data = await costumeInventory.updateCostume(req.params.id, req.body);
        res.json({ success: true, data });
    } catch (err) {
        log.error('PUT /hr/costumes/:id error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    }
});

// DELETE /api/hr/costumes/:id
router.delete('/costumes/:id', async (req, res) => {
    try {
        await costumeInventory.deleteCostume(req.params.id);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/costumes/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// AVAILABILITY (#10)
// ==========================================

// GET /api/hr/availability — real-time staff status
router.get('/availability', async (req, res) => {
    try {
        const today = todayKyiv();
        const result = await pool.query(`
            SELECT s.id, s.name, s.role_type, s.color, s.photo_url,
                   COALESCE(s.availability_status, 'offline') AS availability_status,
                   s.availability_updated_at, s.current_booking_id,
                   hs.planned_start, hs.planned_end,
                   tr.clock_in, tr.clock_out, tr.status AS time_status
            FROM staff s
            LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id AND tr.record_date = $1
            WHERE s.is_active = true
            ORDER BY
                CASE COALESCE(s.availability_status, 'offline')
                    WHEN 'busy' THEN 1 WHEN 'online' THEN 2 WHEN 'break' THEN 3 ELSE 4
                END,
                s.name
        `, [today]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/availability error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/availability/:staffId — update status
router.put('/availability/:staffId', async (req, res) => {
    try {
        const { status, booking_id } = req.body;
        const validStatuses = ['online', 'busy', 'break', 'offline'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус' });
        }
        await pool.query(
            `UPDATE staff SET availability_status = $1, availability_updated_at = NOW(),
             current_booking_id = $2 WHERE id = $3`,
            [status, booking_id || null, req.params.staffId]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /hr/availability/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ─── Staff Shifts by display_name (v33.5) ────────────────────
// GET /api/hr/staff/:id/shifts?month=2026-03
router.get('/staff/:id/shifts', async (req, res) => {
    try {
        const staffRow = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.id]);
        if (!staffRow.rowCount) return res.status(404).json({ error: 'Staff not found' });
        const s           = staffRow.rows[0];
        const displayName = s.display_name || s.name;
        if (!displayName?.trim()) return res.json({ success: true, shifts: [], total: 0, displayName: null });
        const month    = req.query.month || new Date().toISOString().slice(0, 7);
        const [yr, mo] = month.split('-').map(Number);
        const dateFrom = `${month}-01`;
        const dateTo   = new Date(yr, mo, 0).toISOString().slice(0, 10);
        const result = await pool.query(
            `SELECT id, date, time, program_name, label,
                    CASE
                        WHEN hosts ILIKE '%' || $1 || '%' THEN 'host'
                        WHEN second_animator ILIKE '%' || $1 || '%' THEN 'second'
                    END AS role
             FROM bookings
             WHERE (hosts ILIKE '%' || $1 || '%' OR second_animator ILIKE '%' || $1 || '%')
               AND date >= $2 AND date <= $3
               AND status != 'cancelled'
             ORDER BY date, time`,
            [displayName.trim(), dateFrom, dateTo]
        );
        res.json({
            success: true,
            shifts: result.rows,
            total:    result.rowCount,
            asHost:   result.rows.filter(r => r.role === 'host').length,
            asSecond: result.rows.filter(r => r.role === 'second').length,
            displayName,
            period: { from: dateFrom, to: dateTo }
        });
    } catch (err) {
        log.error('GET /staff/:id/shifts', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/hr/shifts-summary?month=2026-03
router.get('/shifts-summary', async (req, res) => {
    try {
        const month    = req.query.month || new Date().toISOString().slice(0, 7);
        const [yr, mo] = month.split('-').map(Number);
        const dateFrom = `${month}-01`;
        const dateTo   = new Date(yr, mo, 0).toISOString().slice(0, 10);
        const staffList = await pool.query(
            `SELECT id, name, display_name FROM staff
             WHERE display_name IS NOT NULL AND display_name != '' AND is_active = true`
        );
        if (!staffList.rowCount) return res.json({ success: true, summary: [], period: { from: dateFrom, to: dateTo } });
        const summary = [];
        for (const s of staffList.rows) {
            const dn = s.display_name.trim();
            const r  = await pool.query(
                `SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN hosts ILIKE '%'||$1||'%' THEN 1 ELSE 0 END) AS as_host,
                    SUM(CASE WHEN second_animator ILIKE '%'||$1||'%' THEN 1 ELSE 0 END) AS as_second
                 FROM bookings
                 WHERE (hosts ILIKE '%'||$1||'%' OR second_animator ILIKE '%'||$1||'%')
                   AND date >= $2 AND date <= $3
                   AND status != 'cancelled'`,
                [dn, dateFrom, dateTo]
            );
            summary.push({
                id: s.id, name: s.name, displayName: dn,
                total: parseInt(r.rows[0].total),
                asHost: parseInt(r.rows[0].as_host),
                asSecond: parseInt(r.rows[0].as_second)
            });
        }
        res.json({
            success: true,
            summary: summary.sort((a, b) => b.total - a.total),
            period: { from: dateFrom, to: dateTo }
        });
    } catch (err) {
        log.error('GET /shifts-summary', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// v33.8.0 Integration 9: Salary commit to finance
// ==========================================

// POST /api/hr/salary/commit — record calculated salaries as finance transactions
router.post('/salary/commit', requireRole('admin', 'director', 'senior_manager'), async (req, res) => {
    try {
        const { month } = req.body;
        if (!month || !/^\d{4}-\d{2}$/.test(month))
            return res.status(400).json({ error: 'month required (YYYY-MM)' });

        // Check if already committed
        const already = await pool.query(
            `SELECT COUNT(*)::int AS c FROM finance_transactions
             WHERE payment_method = 'salary' AND date LIKE $1`,
            [`${month}%`]
        );
        if (parseInt(already.rows[0].c) > 0) {
            return res.status(409).json({ error: `Зарплати за ${month} вже нараховано (${already.rows[0].c} транзакцій)` });
        }

        // Calculate salaries based on time records
        const salaryResp = await pool.query(
            `SELECT
                s.id AS staff_id, s.name, s.hourly_rate,
                COALESCE(SUM(tr.total_worked_minutes), 0)::int AS total_minutes
             FROM staff s
             LEFT JOIN hr_time_records tr ON tr.staff_id = s.id
                AND tr.record_date >= $1::date AND tr.record_date <= ($1::date + INTERVAL '1 month - 1 day')
             WHERE s.is_active = true AND s.hourly_rate > 0
             GROUP BY s.id, s.name, s.hourly_rate
             HAVING COALESCE(SUM(tr.total_worked_minutes), 0) > 0`,
            [`${month}-01`]
        );

        // Find salary expense category
        const salCat = await pool.query(
            `SELECT id FROM finance_categories WHERE name ILIKE '%зарплат%' AND type = 'expense' LIMIT 1`
        );
        const catId = salCat.rows[0]?.id || null;

        const inserted = [];
        for (const s of salaryResp.rows) {
            const workedH = s.total_minutes / 60;
            const baseSal = Math.round(workedH * parseFloat(s.hourly_rate));

            // Bonuses/deductions from salary_adjustments
            let bonuses = 0, deductions = 0;
            try {
                const adj = await pool.query(
                    `SELECT type, SUM(amount)::int AS total
                     FROM salary_adjustments WHERE staff_id = $1 AND month = $2 GROUP BY type`,
                    [s.staff_id, month]
                );
                bonuses = adj.rows.filter(a => a.type === 'bonus').reduce((sum, a) => sum + a.total, 0);
                deductions = adj.rows.filter(a => ['deduction', 'penalty'].includes(a.type)).reduce((sum, a) => sum + a.total, 0);
            } catch { /* salary_adjustments may not have data */ }

            const totalSal = baseSal + bonuses - deductions;
            if (totalSal <= 0) continue;

            const r = await pool.query(
                `INSERT INTO finance_transactions
                    (type, category_id, amount, description, date, payment_method, staff_id, created_by)
                 VALUES ('expense', $1, $2, $3, $4, 'salary', $5, $6)
                 RETURNING id`,
                [catId, totalSal,
                 `Зарплата ${s.name} за ${month} (${Math.round(workedH)}г * ${s.hourly_rate} грн/г)`,
                 new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).toISOString().slice(0, 10), s.staff_id, req.user.username]
            );
            inserted.push({ staffId: s.staff_id, name: s.name, amount: totalSal, transactionId: r.rows[0].id });
        }

        log.info(`[SalaryCommit] Committed ${inserted.length} salaries for ${month}`);
        res.json({ success: true, committed: inserted.length, transactions: inserted });
    } catch (err) {
        log.error('[SalaryCommit] Error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ══════════════════════════════════════════════════════
// ВАКАНСІЇ — CRUD
// ══════════════════════════════════════════════════════

router.get('/vacancies', async (req, res) => {
    try {
        const { status = 'open', role_type } = req.query;
        let q = `SELECT v.*, (SELECT COUNT(*) FROM job_applications a WHERE a.vacancy_id=v.id AND a.status!='rejected') as active_candidates FROM job_vacancies v`;
        const conds = [], params = [];
        if (status !== 'all') { conds.push(`v.status=$${params.length+1}`); params.push(status); }
        if (role_type)        { conds.push(`v.role_type=$${params.length+1}`); params.push(role_type); }
        if (conds.length) q += ' WHERE ' + conds.join(' AND ');
        q += ` ORDER BY CASE v.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, v.created_at DESC`;
        const r = await pool.query(q, params);
        res.json({ success: true, vacancies: r.rows });
    } catch (err) { log.error('GET /vacancies', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/vacancies', async (req, res) => {
    const { title, role_type, department = 'animators', description, requirements,
            salary_from, salary_to, schedule, work_format = 'office',
            status = 'open', priority = 'normal' } = req.body;
    if (!title?.trim() || !role_type) return res.status(400).json({ error: 'title і role_type обов\'язкові' });
    try {
        const r = await pool.query(
            `INSERT INTO job_vacancies (title,role_type,department,description,requirements,salary_from,salary_to,schedule,work_format,status,priority,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [title.trim(), role_type, department, description||null, requirements||null,
             salary_from||null, salary_to||null, schedule||null, work_format, status, priority, req.user?.username||null]);
        res.json({ success: true, vacancy: r.rows[0] });
    } catch (err) { log.error('POST /vacancies', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/vacancies/:id', async (req, res) => {
    const { status, priority, description, requirements, salary_from, salary_to, schedule, title } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (title !== undefined)       { sets.push(`title=$${i++}`);       vals.push(title); }
    if (status)                    { sets.push(`status=$${i++}`);      vals.push(status); }
    if (priority)                  { sets.push(`priority=$${i++}`);    vals.push(priority); }
    if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
    if (requirements !== undefined){ sets.push(`requirements=$${i++}`); vals.push(requirements); }
    if (salary_from !== undefined) { sets.push(`salary_from=$${i++}`); vals.push(salary_from); }
    if (salary_to !== undefined)   { sets.push(`salary_to=$${i++}`);   vals.push(salary_to); }
    if (schedule !== undefined)    { sets.push(`schedule=$${i++}`);    vals.push(schedule); }
    if (['filled','closed'].includes(status)) sets.push('closed_at=NOW()');
    if (!sets.length) return res.status(400).json({ error: 'Нічого оновлювати' });
    vals.push(parseInt(req.params.id));
    try {
        await pool.query(`UPDATE job_vacancies SET ${sets.join(',')} WHERE id=$${i}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/vacancies/:id', async (req, res) => {
    try {
        await pool.query(`UPDATE job_vacancies SET status='closed', closed_at=NOW() WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════
// КАНДИДАТИ — CRUD
// ══════════════════════════════════════════════════════

router.get('/vacancies/:id/applications', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM job_applications WHERE vacancy_id=$1 ORDER BY created_at DESC', [req.params.id]);
        const filesByApplication = await loadResumeFilesForApplications(r.rows.map(row => row.id));
        const applications = r.rows.map(row => ({
            ...row,
            resume_files: filesByApplication.get(parseInt(row.id, 10)) || []
        }));
        res.json({ success: true, applications });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/vacancies/:id/applications', async (req, res) => {
    const {
        name, phone, telegram_username, telegram_id, source = 'manual', notes, salary_expectation, cv_url,
        birth_date, address, availability, experience, interview_notes, raw_application_text, parsed_payload
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name обов\'язковий' });
    try {
        const r = await pool.query(
            `INSERT INTO job_applications
                (vacancy_id,name,phone,telegram_username,telegram_id,source,notes,salary_expectation,cv_url,added_by,
                 birth_date,address,availability,experience,interview_notes,raw_application_text,parsed_payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [parseInt(req.params.id), name.trim(), phone||null, telegram_username||null, telegram_id||null,
             source, notes||null, salary_expectation||null, cv_url||null, req.user?.username||null,
             birth_date || null, address || null, availability || null, experience || null, interview_notes || null,
             raw_application_text || null, parsed_payload ? JSON.stringify(parsed_payload) : null]);
        res.json({ success: true, application: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/applications/:id/resume-files', async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const app = await pool.query('SELECT id FROM job_applications WHERE id=$1 LIMIT 1', [appId]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });
        const filesByApplication = await loadResumeFilesForApplications([appId]);
        res.json({ success: true, files: filesByApplication.get(appId) || [] });
    } catch (err) {
        log.error('GET /applications/:id/resume-files', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/applications/:id/resume-files', handleResumeUpload, async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) return res.status(400).json({ success: false, error: 'Додайте хоча б один файл резюме' });

        const app = await pool.query('SELECT id, raw_application_text, cv_url FROM job_applications WHERE id=$1 LIMIT 1', [appId]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });

        const inserted = [];
        for (const file of files) {
            const ext = resumeFileExt(file);
            const extraction = extractResumeText(file);
            const row = await pool.query(
                `INSERT INTO job_application_resume_files
                    (application_id, original_name, mime_type, file_ext, file_size, file_data,
                     extracted_text, extraction_status, extraction_note, uploaded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 RETURNING id, application_id, original_name, mime_type, file_ext, file_size,
                           extracted_text, extraction_status, extraction_note, uploaded_by, created_at`,
                [
                    appId,
                    file.originalname || 'resume',
                    file.mimetype || null,
                    ext || null,
                    file.size || file.buffer.length,
                    file.buffer,
                    extraction.text,
                    extraction.status,
                    extraction.note,
                    req.user?.username || null
                ]
            );
            inserted.push(resumeFileMeta(row.rows[0]));
        }

        const extractedBlocks = inserted
            .filter(file => file.extracted_text)
            .map(file => `Імпортовано з файлу ${file.original_name}:\n${file.extracted_text}`);
        const appendedText = extractedBlocks.length ? extractedBlocks.join('\n\n') : null;
        const firstDownloadUrl = inserted[0]?.download_url || null;
        await pool.query(
            `UPDATE job_applications
             SET raw_application_text = CASE
                    WHEN $2::text IS NULL THEN raw_application_text
                    WHEN NULLIF(BTRIM(COALESCE(raw_application_text, '')), '') IS NULL THEN $2::text
                    ELSE raw_application_text || E'\n\n' || $2::text
                 END,
                 cv_url = COALESCE(cv_url, $3),
                 updated_at = NOW()
             WHERE id=$1`,
            [appId, appendedText, firstDownloadUrl]
        );

        res.json({
            success: true,
            files: inserted,
            extracted_text_appended: Boolean(appendedText)
        });
    } catch (err) {
        log.error('POST /applications/:id/resume-files', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/applications/:id/resume-files/:fileId/download', async (req, res) => {
    try {
        const appId = parseInt(req.params.id, 10);
        const fileId = parseInt(req.params.fileId, 10);
        if (!Number.isFinite(fileId)) return res.status(400).json({ error: 'Invalid file id' });
        const r = await pool.query(
            `SELECT id, application_id, original_name, mime_type, file_size, file_data
             FROM job_application_resume_files
             WHERE id=$1 AND application_id=$2`,
            [fileId, appId]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
        const file = r.rows[0];
        const filename = safeDownloadName(file.original_name);
        const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', file.file_size || file.file_data.length);
        res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(file.file_data);
    } catch (err) {
        log.error('GET /applications/:id/resume-files/:fileId/download', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/applications/:id', async (req, res) => {
    const { status, notes, interview_date, salary_expectation, address, birth_date, availability, experience, interview_notes, raw_application_text, parsed_payload } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (status)              { sets.push(`status=$${i++}`); vals.push(status); }
    if (notes !== undefined) { sets.push(`notes=$${i++}`);  vals.push(notes); }
    if (interview_date)      { sets.push(`interview_date=$${i++}`); vals.push(interview_date); }
    if (salary_expectation)  { sets.push(`salary_expectation=$${i++}`); vals.push(salary_expectation); }
    if (address !== undefined) { sets.push(`address=$${i++}`); vals.push(address); }
    if (birth_date !== undefined) { sets.push(`birth_date=$${i++}`); vals.push(birth_date || null); }
    if (availability !== undefined) { sets.push(`availability=$${i++}`); vals.push(availability); }
    if (experience !== undefined) { sets.push(`experience=$${i++}`); vals.push(experience); }
    if (interview_notes !== undefined) { sets.push(`interview_notes=$${i++}`); vals.push(interview_notes); }
    if (raw_application_text !== undefined) { sets.push(`raw_application_text=$${i++}`); vals.push(raw_application_text); }
    if (parsed_payload !== undefined) { sets.push(`parsed_payload=$${i++}`); vals.push(parsed_payload ? JSON.stringify(parsed_payload) : null); }
    sets.push('updated_at=NOW()');
    vals.push(parseInt(req.params.id));
    try {
        await pool.query(`UPDATE job_applications SET ${sets.join(',')} WHERE id=$${i}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/applications/:id/hire', async (req, res) => {
    try {
        const app = await pool.query(
            `SELECT a.*, v.role_type, v.title as vac_title FROM job_applications a
             JOIN job_vacancies v ON v.id=a.vacancy_id WHERE a.id=$1`, [req.params.id]);
        if (!app.rows.length) return res.status(404).json({ error: 'Not found' });
        const a = app.rows[0];
        await pool.query("UPDATE job_applications SET status='hired', updated_at=NOW() WHERE id=$1", [req.params.id]);
        await pool.query("UPDATE job_vacancies SET status='filled', closed_at=NOW() WHERE id=$1", [a.vacancy_id]);
        const { department = 'animators', salary } = req.body;
        const staffResult = await pool.query(
            `INSERT INTO staff (name, department, position, phone, role_type, hire_date, telegram_username, telegram_id, hourly_rate, address, is_active)
             VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7,$8,$9,true) RETURNING id`,
            [a.name, department, a.vac_title, a.phone||null, a.role_type,
             a.telegram_username||null, a.telegram_id||null, salary||0, a.address || null]);
        res.json({ success: true, staff_id: staffResult.rows[0].id, message: `${a.name} найнятий як ${a.role_type}` });
    } catch (err) { log.error('POST /applications/:id/hire', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ==========================================
// v43.0: DEPREMIUM COMPLIANCE SYSTEM
// ==========================================

// GET /api/hr/depremium-templates — catalog of official rules
router.get('/depremium-templates', async (req, res) => {
    try {
        const { q, category, severity, active = 'true' } = req.query;
        const params = []; const conds = [];
        if (active !== 'all') { params.push(active === 'true'); conds.push(`active = $${params.length}`); }
        if (category) { params.push(category); conds.push(`discipline_category = $${params.length}`); }
        if (severity) { params.push(severity); conds.push(`severity = $${params.length}`); }
        if (q) { params.push(`%${q}%`); conds.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length} OR official_reason ILIKE $${params.length})`); }
        let sql = 'SELECT * FROM depremium_templates';
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sort_order, id';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /depremium-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/depremium-templates/:id/staff-history/:staffId — repeat detection
router.get('/depremium-templates/:templateId/staff-history/:staffId', async (req, res) => {
    try {
        const { templateId, staffId } = req.params;
        const result = await pool.query(
            `SELECT sa.id, sa.created_at, sa.amount, sa.reason, sa.status, sa.rule_code, sa.repeat_index
             FROM salary_adjustments sa
             WHERE sa.staff_id = $1 AND sa.type IN ('penalty','deduction')
             AND (sa.template_id = $2 OR sa.template_id IN (SELECT id FROM depremium_templates WHERE repeat_of_template_id = $2))
             ORDER BY sa.created_at DESC LIMIT 20`,
            [staffId, templateId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /depremium-templates/:id/staff-history/:staffId error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/depremium-summary — analytics for period
router.get('/depremium-summary', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const { month } = req.query;
        if (!month) return res.status(400).json({ success: false, error: 'month обовʼязковий (YYYY-MM)' });
        const topReasons = await pool.query(
            `SELECT COALESCE(rule_code,'CUSTOM') AS rule_code, COUNT(*)::int AS count, SUM(COALESCE(amount,0))::int AS total
             FROM salary_adjustments WHERE type IN ('penalty','deduction') AND month = $1
             GROUP BY COALESCE(rule_code,'CUSTOM') ORDER BY count DESC LIMIT 10`, [month]);
        const repeatStaff = await pool.query(
            `SELECT sa.staff_id, s.name AS staff_name, COUNT(*)::int AS cnt
             FROM salary_adjustments sa JOIN staff s ON s.id = sa.staff_id
             WHERE sa.type IN ('penalty','deduction') AND sa.month = $1
             GROUP BY sa.staff_id, s.name HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 10`, [month]);
        const criticalCount = await pool.query(
            `SELECT COUNT(*)::int AS c FROM salary_adjustments
             WHERE type IN ('penalty','deduction') AND month = $1 AND severity = 'critical'`, [month]);
        const totalCount = await pool.query(
            `SELECT COUNT(*)::int AS c, SUM(COALESCE(amount,0))::int AS total
             FROM salary_adjustments WHERE type IN ('penalty','deduction') AND month = $1`, [month]);
        res.json({
            success: true,
            data: {
                total: totalCount.rows[0]?.c || 0,
                totalAmount: totalCount.rows[0]?.total || 0,
                critical: criticalCount.rows[0]?.c || 0,
                topReasons: topReasons.rows,
                repeatStaff: repeatStaff.rows
            }
        });
    } catch (err) {
        log.error('GET /depremium-summary error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/salary/adjustment/:id/approve — approve pending review
router.put('/salary/adjustment/:id/approve', requireRole('creator', 'director', 'vice_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE salary_adjustments SET status = 'applied', approved_by = $1, approved_at = NOW()
             WHERE id = $2 AND status = 'pending_review' RETURNING *`,
            [req.user?.username, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не знайдено або вже затверджено' });
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,'approve',$3,$4,$5,'{}')`,
            [result.rows[0].id, result.rows[0].staff_id, req.user?.username, req.user?.role, result.rows[0].template_id]
        ).catch(e => log.warn('Discipline approve log failed:', e.message));
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /salary/adjustment/:id/approve error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/salary/adjustment/:id/reject — reject pending review
router.put('/salary/adjustment/:id/reject', requireRole('creator', 'director', 'vice_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE salary_adjustments SET status = 'rejected', approved_by = $1, approved_at = NOW()
             WHERE id = $2 AND status = 'pending_review' RETURNING *`,
            [req.user?.username, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не знайдено або вже оброблено' });
        await pool.query(
            `INSERT INTO discipline_actions_log (adjustment_id, staff_id, action_type, actor_username, actor_role, template_id, payload)
             VALUES ($1,$2,'reject',$3,$4,$5,$6)`,
            [result.rows[0].id, result.rows[0].staff_id, req.user?.username, req.user?.role, result.rows[0].template_id, JSON.stringify({ reason: req.body.reason || '' })]
        ).catch(e => log.warn('Discipline reject log failed:', e.message));
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /salary/adjustment/:id/reject error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/discipline-log — audit trail
router.get('/discipline-log', requireRole('creator', 'director', 'vice_director', 'hr'), async (req, res) => {
    try {
        const { staff_id, limit = 50 } = req.query;
        const params = [parseInt(limit)];
        let where = '';
        if (staff_id) { params.push(staff_id); where = `WHERE dal.staff_id = $${params.length}`; }
        const result = await pool.query(
            `SELECT dal.*, s.name AS staff_name, dt.code AS template_code, dt.title AS template_title
             FROM discipline_actions_log dal
             LEFT JOIN staff s ON s.id = dal.staff_id
             LEFT JOIN depremium_templates dt ON dt.id = dal.template_id
             ${where} ORDER BY dal.created_at DESC LIMIT $1`, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /discipline-log error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

module.exports = router;
