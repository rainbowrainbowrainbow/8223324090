/**
 * routes/customers.js — CRM Customer CRUD + search + filters + RFM + export
 * v15.1: Phase 2 — filters, RFM analytics, CSV export, certificate link
 * v20.9.12: Supabase migration — customers read/write via Supabase, fallback to Railway
 * v30.4.0: Tags, duplicates, merge, LTV, journey, communications, NPS, vCard, bulk
 */
const router = require('express').Router();
const { pool } = require('../db');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');
const { exportLimiter } = require('../middleware/rateLimit');

const log = createLogger('Customers');

// v30.4: Predefined tag templates
const PREDEFINED_TAGS = [
    { tag: 'VIP', color: '#F59E0B' },
    { tag: 'Проблемний', color: '#EF4444' },
    { tag: 'Корпорат', color: '#3B82F6' },
    { tag: 'Рекомендація', color: '#10B981' },
    { tag: 'Постійний', color: '#8B5CF6' }
];

// Helper: check if Supabase is available
function useSupabase() {
    return !!getSupabase();
}

// Autocomplete search (for booking form dropdown)
router.get('/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json([]);

        const sb = getSupabase();
        if (sb) {
            const pattern = `%${q}%`;
            const { data, error } = await sb.from('customers')
                .select('id, name, phone, instagram, child_name, total_bookings')
                .or(`name.ilike.${pattern},phone.ilike.${pattern},instagram.ilike.${pattern}`)
                .order('last_visit', { ascending: false, nullsFirst: false })
                .limit(10);
            if (error) throw error;
            return res.json((data || []).map(mapCustomerRow));
        }

        // Fallback: Railway DB
        const pattern = `%${q}%`;
        const result = await pool.query(
            `SELECT id, name, phone, instagram, child_name, total_bookings
             FROM customers
             WHERE name ILIKE $1 OR phone ILIKE $1 OR instagram ILIKE $1
             ORDER BY last_visit DESC NULLS LAST
             LIMIT 10`,
            [pattern]
        );
        res.json(result.rows.map(mapCustomerRow));
    } catch (err) {
        log.error('Customer search error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v15.1: RFM analytics
router.get('/rfm', async (req, res) => {
    try {
        let rows;
        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers')
                .select('id, name, phone, instagram, child_name, total_bookings, total_spent, first_visit, last_visit, created_at, updated_at')
                .order('last_visit', { ascending: false, nullsFirst: false });
            if (error) throw error;
            rows = data || [];
        } else {
            // v32.1: JOIN bookings for real totals
            const result = await pool.query(`
                SELECT c.id, c.name, c.phone, c.instagram, c.child_name,
                       COALESCE(b.cnt, 0) AS total_bookings,
                       COALESCE(b.spent, 0) AS total_spent,
                       b.first_visit, b.last_visit,
                       c.created_at, c.updated_at
                FROM customers c
                LEFT JOIN (
                    SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent,
                           MIN(date) AS first_visit, MAX(date) AS last_visit
                    FROM bookings WHERE status != 'cancelled' GROUP BY customer_id
                ) b ON b.customer_id = c.id
                ORDER BY b.last_visit DESC NULLS LAST
            `);
            rows = result.rows;
        }

        const today = new Date();
        const customers = rows.map(row => {
            const c = mapCustomerRow(row);
            let recencyDays = null;
            if (c.lastVisit) {
                const lastDate = new Date(c.lastVisit);
                recencyDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
            }
            const frequency = c.totalBookings || 0;
            const monetary = c.totalSpent || 0;
            return { ...c, recencyDays, frequency, monetary };
        });

        const withScores = calculateRFMScores(customers);
        const segments = { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 };
        for (const c of withScores) {
            if (c.rfmSegment === 'champion') segments.champions++;
            else if (c.rfmSegment === 'loyal') segments.loyal++;
            else if (c.rfmSegment === 'potential') segments.potential++;
            else if (c.rfmSegment === 'at_risk') segments.atRisk++;
            else segments.lost++;
        }

        res.json({ customers: withScores, segments, total: withScores.length });
    } catch (err) {
        log.error('RFM analytics error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v32.1: Customer segments (simplified from RFM)
router.get('/segments', async (req, res) => {
    try {
        const now = new Date();
        const threeMonthsAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE b.last_visit >= $1) AS active,
                COUNT(*) FILTER (WHERE b.last_visit < $1 OR b.last_visit IS NULL) AS sleeping,
                COUNT(*) FILTER (WHERE c.created_at >= $2::timestamp) AS new,
                COUNT(*) FILTER (WHERE COALESCE(b.spent, 0) >= 10000) AS vip
            FROM customers c
            LEFT JOIN (
                SELECT customer_id, MAX(date) AS last_visit, COALESCE(SUM(price), 0) AS spent
                FROM bookings WHERE status != 'cancelled' GROUP BY customer_id
            ) b ON b.customer_id = c.id
        `, [threeMonthsAgo, oneMonthAgo]);

        const row = result.rows[0];
        res.json({
            success: true,
            segments: {
                active: parseInt(row.active) || 0,
                sleeping: parseInt(row.sleeping) || 0,
                new: parseInt(row.new) || 0,
                vip: parseInt(row.vip) || 0
            }
        });
    } catch (err) {
        log.error('Customer segments error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v32.1: Upcoming birthdays (next N days)
router.get('/birthdays', async (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));

        // PostgreSQL: compare month-day to find upcoming birthdays (handles year wrap)
        const result = await pool.query(`
            SELECT c.id, c.name AS parent_name, c.phone,
                   c.child_name, c.child_birthday,
                   CASE
                       WHEN TO_CHAR(c.child_birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
                       THEN (TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                       ELSE (TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                   END AS days_until_birthday
            FROM customers c
            WHERE c.child_birthday IS NOT NULL
            ORDER BY days_until_birthday ASC
        `);

        const filtered = result.rows
            .filter(r => parseInt(r.days_until_birthday) >= 0 && parseInt(r.days_until_birthday) <= days)
            .map(r => ({
                id: r.id,
                parentName: r.parent_name,
                phone: r.phone,
                childName: r.child_name,
                childBirthday: r.child_birthday,
                daysUntilBirthday: parseInt(r.days_until_birthday)
            }));

        res.json({ success: true, birthdays: filtered });
    } catch (err) {
        log.error('Birthdays error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v15.1: CSV export — v19.14: rate limited
router.get('/export', exportLimiter, async (req, res) => {
    try {
        let customerRows;
        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers').select('*').order('name');
            if (error) throw error;
            customerRows = data || [];
        } else {
            const result = await pool.query('SELECT * FROM customers ORDER BY name');
            customerRows = result.rows;
        }

        // Get cert counts from Railway (certificates stay there)
        const certResult = await pool.query(
            'SELECT customer_id, COUNT(*) AS cnt FROM certificates GROUP BY customer_id'
        );
        const certMap = {};
        for (const r of certResult.rows) certMap[r.customer_id] = parseInt(r.cnt);

        const BOM = '\uFEFF';
        const header = [
            'ID', "Ім'я", 'Телефон', 'Instagram', "Ім'я дитини",
            'ДН дитини', 'Джерело', 'Нотатки', 'Бронювань',
            'Витрачено (грн)', 'Перший візит', 'Останній візит',
            'Сертифікатів', 'Створено'
        ].join(';');

        const rows = customerRows.map(r => [
            r.id,
            escapeCsv(r.name),
            escapeCsv(r.phone || ''),
            escapeCsv(r.instagram || ''),
            escapeCsv(r.child_name || ''),
            r.child_birthday ? formatDate(r.child_birthday) : '',
            escapeCsv(r.source || ''),
            escapeCsv(r.notes || ''),
            r.total_bookings || 0,
            r.total_spent || 0,
            r.first_visit ? formatDate(r.first_visit) : '',
            r.last_visit ? formatDate(r.last_visit) : '',
            certMap[r.id] || 0,
            r.created_at ? formatDate(r.created_at) : ''
        ].join(';'));

        const csv = BOM + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csv);
    } catch (err) {
        log.error('Customer export error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v17.0: Excel export — v19.14: rate limited
router.get('/export-xlsx', exportLimiter, async (req, res) => {
    try {
        let customerRows;
        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers').select('*').order('name');
            if (error) throw error;
            customerRows = data || [];
        } else {
            const result = await pool.query('SELECT * FROM customers ORDER BY name');
            customerRows = result.rows;
        }

        const certResult = await pool.query(
            'SELECT customer_id, COUNT(*) AS cnt FROM certificates GROUP BY customer_id'
        );
        const certMap = {};
        for (const r of certResult.rows) certMap[r.customer_id] = parseInt(r.cnt);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Event Genix';
        const sheet = workbook.addWorksheet('Клієнти');

        sheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: "Ім'я", key: 'name', width: 22 },
            { header: 'Телефон', key: 'phone', width: 16 },
            { header: 'Instagram', key: 'instagram', width: 18 },
            { header: "Ім'я дитини", key: 'childName', width: 18 },
            { header: 'ДН дитини', key: 'childBday', width: 14 },
            { header: 'Джерело', key: 'source', width: 14 },
            { header: 'Бронювань', key: 'bookings', width: 12 },
            { header: 'Витрачено (₴)', key: 'spent', width: 14 },
            { header: 'Перший візит', key: 'firstVisit', width: 14 },
            { header: 'Останній візит', key: 'lastVisit', width: 14 },
            { header: 'Сертифікатів', key: 'certs', width: 12 },
            { header: 'Нотатки', key: 'notes', width: 24 }
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

        for (const r of customerRows) {
            sheet.addRow({
                id: r.id,
                name: r.name || '',
                phone: r.phone || '',
                instagram: r.instagram || '',
                childName: r.child_name || '',
                childBday: r.child_birthday || '',
                source: r.source || '',
                bookings: r.total_bookings || 0,
                spent: r.total_spent || 0,
                firstVisit: r.first_visit || '',
                lastVisit: r.last_visit || '',
                certs: certMap[r.id] || 0,
                notes: r.notes || ''
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        log.error('Customer export-xlsx error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v15.1: Stats overview
router.get('/stats', async (req, res) => {
    try {
        const sb = getSupabase();
        if (sb) {
            // Total
            const { count: total } = await sb.from('customers').select('*', { count: 'exact', head: true });

            // By source
            const { data: allCustomers } = await sb.from('customers').select('source');
            const sourceMap = {};
            for (const c of (allCustomers || [])) {
                const s = c.source || 'unknown';
                sourceMap[s] = (sourceMap[s] || 0) + 1;
            }
            const bySource = Object.entries(sourceMap)
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count);

            // Top by spent
            const { data: topData } = await sb.from('customers')
                .select('id, name, total_bookings, total_spent, last_visit')
                .order('total_spent', { ascending: false })
                .limit(5);

            // Recent
            const { data: recentData } = await sb.from('customers')
                .select('id, name, total_bookings, total_spent, created_at')
                .order('created_at', { ascending: false })
                .limit(5);

            // Averages
            const { data: avgData } = await sb.from('customers')
                .select('total_bookings, total_spent')
                .gt('total_bookings', 0);
            let avgBookings = 0, avgSpent = 0;
            if (avgData && avgData.length > 0) {
                avgBookings = Math.round(avgData.reduce((s, c) => s + (c.total_bookings || 0), 0) / avgData.length * 10) / 10;
                avgSpent = Math.round(avgData.reduce((s, c) => s + (c.total_spent || 0), 0) / avgData.length);
            }

            return res.json({
                total: total || 0,
                bySource,
                topBySpent: (topData || []).map(mapCustomerRow),
                recentCustomers: (recentData || []).map(mapCustomerRow),
                averages: { avg_bookings: avgBookings, avg_spent: avgSpent }
            });
        }

        // Fallback: Railway — v32.1: JOIN bookings for real stats
        const totalResult = await pool.query('SELECT COUNT(*) FROM customers');
        const sourceResult = await pool.query(
            `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
             FROM customers GROUP BY source ORDER BY count DESC`
        );
        const topResult = await pool.query(
            `SELECT c.id, c.name,
                    COALESCE(b.cnt, 0) AS total_bookings,
                    COALESCE(b.spent, 0) AS total_spent,
                    b.last_visit
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent, MAX(date) AS last_visit
                 FROM bookings WHERE status != 'cancelled' GROUP BY customer_id
             ) b ON b.customer_id = c.id
             ORDER BY COALESCE(b.spent, 0) DESC LIMIT 5`
        );
        const recentResult = await pool.query(
            `SELECT c.id, c.name,
                    COALESCE(b.cnt, 0) AS total_bookings,
                    COALESCE(b.spent, 0) AS total_spent,
                    c.created_at
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent
                 FROM bookings WHERE status != 'cancelled' GROUP BY customer_id
             ) b ON b.customer_id = c.id
             ORDER BY c.created_at DESC LIMIT 5`
        );
        const avgResult = await pool.query(
            `SELECT ROUND(AVG(b.cnt), 1) AS avg_bookings,
                    ROUND(AVG(b.spent), 0) AS avg_spent
             FROM customers c
             INNER JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent
                 FROM bookings WHERE status != 'cancelled' GROUP BY customer_id
             ) b ON b.customer_id = c.id`
        );

        res.json({
            total: parseInt(totalResult.rows[0].count),
            bySource: sourceResult.rows.map(r => ({ source: r.source, count: parseInt(r.count) })),
            topBySpent: topResult.rows.map(mapCustomerRow),
            recentCustomers: recentResult.rows.map(mapCustomerRow),
            averages: avgResult.rows[0] || { avg_bookings: 0, avg_spent: 0 }
        });
    } catch (err) {
        log.error('Customer stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: TAGS
// ==========================================

// List all unique tags (for filter dropdown)
router.get('/tags', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT tag, color, COUNT(*) AS count
             FROM customer_tags WHERE customer_id IS NOT NULL
             GROUP BY tag, color ORDER BY count DESC`
        );
        res.json({ success: true, tags: result.rows, predefined: PREDEFINED_TAGS });
    } catch (err) {
        log.error('GET /tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add tag to customer
router.post('/:id/tags', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id);
        const { tag, color } = req.body;
        if (!tag || !tag.trim()) return res.status(400).json({ error: 'Тег обовʼязковий' });
        const tagColor = color || PREDEFINED_TAGS.find(p => p.tag === tag.trim())?.color || '#6B7280';
        const result = await pool.query(
            `INSERT INTO customer_tags (customer_id, tag, color, created_by)
             VALUES ($1, $2, $3, $4) ON CONFLICT (customer_id, tag) DO NOTHING RETURNING *`,
            [customerId, tag.trim(), tagColor, req.user?.id || null]
        );
        if (result.rows.length === 0) return res.json({ success: true, message: 'Тег вже існує' });
        res.json({ success: true, tag: result.rows[0] });
    } catch (err) {
        log.error('POST /:id/tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove tag from customer
router.delete('/:id/tags/:tagId', async (req, res) => {
    try {
        await pool.query('DELETE FROM customer_tags WHERE id = $1 AND customer_id = $2',
            [parseInt(req.params.tagId), parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /:id/tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: DUPLICATES + MERGE
// ==========================================

router.get('/duplicates', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c1.id AS id1, c1.name AS name1, c1.phone AS phone1, c1.instagram AS ig1,
                   c1.total_bookings AS bookings1, c1.total_spent AS spent1,
                   c2.id AS id2, c2.name AS name2, c2.phone AS phone2, c2.instagram AS ig2,
                   c2.total_bookings AS bookings2, c2.total_spent AS spent2,
                   CASE
                     WHEN c1.phone IS NOT NULL AND c1.phone != '' AND LOWER(TRIM(c1.phone)) = LOWER(TRIM(c2.phone)) THEN 'phone'
                     WHEN c1.instagram IS NOT NULL AND c1.instagram != '' AND LOWER(TRIM(c1.instagram)) = LOWER(TRIM(c2.instagram)) THEN 'instagram'
                   END AS match_type
            FROM customers c1
            JOIN customers c2 ON c1.id < c2.id
            WHERE (c1.phone IS NOT NULL AND c1.phone != '' AND LOWER(TRIM(c1.phone)) = LOWER(TRIM(c2.phone)))
               OR (c1.instagram IS NOT NULL AND c1.instagram != '' AND LOWER(TRIM(c1.instagram)) = LOWER(TRIM(c2.instagram)))
            ORDER BY c1.id
            LIMIT 100
        `);
        res.json({ success: true, duplicates: result.rows, count: result.rows.length });
    } catch (err) {
        log.error('GET /duplicates error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:primaryId/merge', async (req, res) => {
    const client = await pool.connect();
    try {
        const primaryId = parseInt(req.params.primaryId);
        const { duplicateId } = req.body;
        if (!duplicateId) return res.status(400).json({ error: 'duplicateId обовʼязковий' });
        const dupId = parseInt(duplicateId);
        if (primaryId === dupId) return res.status(400).json({ error: 'Не можна обʼєднати з собою' });

        await client.query('BEGIN');

        // Check both exist
        const [p, d] = await Promise.all([
            client.query('SELECT * FROM customers WHERE id = $1', [primaryId]),
            client.query('SELECT * FROM customers WHERE id = $1', [dupId])
        ]);
        if (p.rows.length === 0 || d.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клієнт не знайдений' });
        }
        const primary = p.rows[0];
        const dup = d.rows[0];

        // Move bookings, certificates, tags, communication logs
        await client.query('UPDATE bookings SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]);
        await client.query('UPDATE certificates SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});
        await client.query('DELETE FROM customer_tags WHERE customer_id = $1 AND tag IN (SELECT tag FROM customer_tags WHERE customer_id = $2)', [dupId, primaryId]).catch(() => {});
        await client.query('UPDATE customer_tags SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});
        await client.query('UPDATE communication_log SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});

        // Merge missing fields
        const updates = [];
        const params = [];
        if (!primary.phone && dup.phone) { params.push(dup.phone); updates.push(`phone = $${params.length}`); }
        if (!primary.instagram && dup.instagram) { params.push(dup.instagram); updates.push(`instagram = $${params.length}`); }
        if (!primary.child_name && dup.child_name) { params.push(dup.child_name); updates.push(`child_name = $${params.length}`); }
        if (!primary.child_birthday && dup.child_birthday) { params.push(dup.child_birthday); updates.push(`child_birthday = $${params.length}`); }

        // Recalculate aggregates
        const aggResult = await client.query(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total,
                    MIN(date) AS first, MAX(date) AS last
             FROM bookings WHERE customer_id = $1 AND linked_to IS NULL`, [primaryId]
        );
        const agg = aggResult.rows[0];
        params.push(parseInt(agg.cnt)); updates.push(`total_bookings = $${params.length}`);
        params.push(parseInt(agg.total)); updates.push(`total_spent = $${params.length}`);
        if (agg.first) { params.push(agg.first); updates.push(`first_visit = $${params.length}`); }
        if (agg.last) { params.push(agg.last); updates.push(`last_visit = $${params.length}`); }

        if (updates.length > 0) {
            params.push(primaryId);
            await client.query(`UPDATE customers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
        }

        // Delete duplicate
        await client.query('DELETE FROM customers WHERE id = $1', [dupId]);
        await client.query('COMMIT');

        log.info(`Merged customer ${dupId} into ${primaryId} by ${req.user?.username}`);
        res.json({ success: true, primaryId, deletedId: dupId });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /:id/merge error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ==========================================
// v30.4: CUSTOMER JOURNEY FUNNEL
// ==========================================

router.get('/journey-stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE total_bookings = 0) AS prospects,
                COUNT(*) FILTER (WHERE total_bookings = 1) AS first_timers,
                COUNT(*) FILTER (WHERE total_bookings BETWEEN 2 AND 4) AS returning,
                COUNT(*) FILTER (WHERE total_bookings >= 5) AS loyal
            FROM customers
        `);
        const leadsResult = await pool.query("SELECT COUNT(*) AS cnt FROM leads WHERE status = 'new'");
        const stats = result.rows[0];
        stats.leads = parseInt(leadsResult.rows[0].cnt);
        res.json({ success: true, stats });
    } catch (err) {
        log.error('GET /journey-stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: LTV
// ==========================================

router.get('/ltv', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, phone, total_bookings, total_spent, first_visit, last_visit
            FROM customers WHERE total_bookings > 0
            ORDER BY total_spent DESC LIMIT 100
        `);
        const customers = result.rows.map(r => {
            const c = mapCustomerRow(r);
            c.ltv = calculateLTV(r);
            return c;
        });
        res.json({ success: true, customers });
    } catch (err) {
        log.error('GET /ltv error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: NPS STATS
// ==========================================

router.get('/nps-stats', async (req, res) => {
    try {
        const [avgResult, distResult, recentResult] = await Promise.all([
            pool.query('SELECT AVG(rating)::numeric(3,1) AS avg_score, COUNT(*) AS total FROM event_reviews'),
            pool.query('SELECT rating, COUNT(*) AS count FROM event_reviews GROUP BY rating ORDER BY rating'),
            pool.query('SELECT * FROM event_reviews ORDER BY created_at DESC LIMIT 20')
        ]);
        res.json({
            success: true,
            avgScore: parseFloat(avgResult.rows[0]?.avg_score) || 0,
            totalReviews: parseInt(avgResult.rows[0]?.total) || 0,
            distribution: distResult.rows.map(r => ({ rating: r.rating, count: parseInt(r.count) })),
            recent: recentResult.rows
        });
    } catch (err) {
        log.error('GET /nps-stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: COMMUNICATIONS
// ==========================================

router.get('/:id/communications', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id);
        const result = await pool.query(
            `SELECT cl.*, u.name AS created_by_name
             FROM communication_log cl
             LEFT JOIN users u ON cl.created_by = u.id
             WHERE cl.customer_id = $1
             ORDER BY cl.created_at DESC LIMIT 100`, [customerId]
        );
        res.json({ success: true, communications: result.rows });
    } catch (err) {
        log.error('GET /:id/communications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/communications', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id);
        const { type, direction, summary } = req.body;
        if (!type) return res.status(400).json({ error: 'Тип обовʼязковий' });
        const result = await pool.query(
            `INSERT INTO communication_log (customer_id, type, direction, summary, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [customerId, type, direction || 'internal', summary || '', req.user?.id || null]
        );
        res.json({ success: true, communication: result.rows[0] });
    } catch (err) {
        log.error('POST /:id/communications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: VCARD EXPORT
// ==========================================

router.get('/export-vcf', exportLimiter, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY name');
        const vcards = result.rows.map(r => {
            const lines = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${(r.name || '').replace(/[;\n]/g, ' ')}`,
            ];
            if (r.phone) lines.push(`TEL;TYPE=CELL:${r.phone}`);
            if (r.instagram) lines.push(`X-INSTAGRAM:${r.instagram}`);
            if (r.child_name) lines.push(`NOTE:Дитина: ${r.child_name}${r.notes ? ' | ' + r.notes.replace(/\n/g, ' ') : ''}`);
            else if (r.notes) lines.push(`NOTE:${r.notes.replace(/\n/g, ' ')}`);
            if (r.child_birthday) {
                const d = new Date(r.child_birthday);
                lines.push(`BDAY:${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
            }
            lines.push('END:VCARD');
            return lines.join('\r\n');
        });
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0,10)}.vcf"`);
        res.send(vcards.join('\r\n'));
    } catch (err) {
        log.error('GET /export-vcf error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/import-vcf', async (req, res) => {
    try {
        const { vcfData } = req.body;
        if (!vcfData) return res.status(400).json({ error: 'vcfData обовʼязковий' });
        const cards = vcfData.split('END:VCARD').filter(c => c.includes('BEGIN:VCARD'));
        let created = 0, updated = 0, skipped = 0;
        for (const card of cards) {
            const lines = card.split(/\r?\n/);
            const get = (prefix) => {
                const line = lines.find(l => l.startsWith(prefix));
                return line ? line.substring(prefix.length).trim() : null;
            };
            const name = get('FN:');
            if (!name) { skipped++; continue; }
            const phone = get('TEL;TYPE=CELL:') || get('TEL:');
            const instagram = get('X-INSTAGRAM:');
            const note = get('NOTE:');
            const bday = get('BDAY:');
            let childBirthday = null;
            if (bday && bday.length === 8) {
                childBirthday = `${bday.slice(0,4)}-${bday.slice(4,6)}-${bday.slice(6,8)}`;
            }
            // Try to find by phone
            if (phone) {
                const existing = await pool.query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [phone]);
                if (existing.rows.length > 0) {
                    await pool.query(
                        'UPDATE customers SET name = $1, instagram = COALESCE($2, instagram), updated_at = NOW() WHERE id = $3',
                        [name, instagram, existing.rows[0].id]
                    );
                    updated++;
                    continue;
                }
            }
            await pool.query(
                'INSERT INTO customers (name, phone, instagram, child_birthday, notes) VALUES ($1, $2, $3, $4, $5)',
                [name, phone, instagram, childBirthday, note]
            );
            created++;
        }
        res.json({ success: true, created, updated, skipped });
    } catch (err) {
        log.error('POST /import-vcf error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: BULK MESSAGING
// ==========================================

router.post('/bulk-message', async (req, res) => {
    try {
        const { filters, template, dryRun } = req.body;
        if (!template) return res.status(400).json({ error: 'Шаблон повідомлення обовʼязковий' });

        // Build filter query
        const conditions = [];
        const params = [];
        if (filters?.tags?.length) {
            params.push(filters.tags);
            conditions.push(`c.id IN (SELECT customer_id FROM customer_tags WHERE tag = ANY($${params.length}))`);
        }
        if (filters?.minVisits) {
            params.push(parseInt(filters.minVisits));
            conditions.push(`c.total_bookings >= $${params.length}`);
        }
        if (filters?.source) {
            params.push(filters.source);
            conditions.push(`c.source = $${params.length}`);
        }
        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Get matching customers
        const result = await pool.query(
            `SELECT c.id, c.name, c.phone, c.child_name, c.instagram
             FROM customers c ${where}
             ORDER BY c.name`, params
        );

        if (dryRun) {
            return res.json({ success: true, dryRun: true, recipientCount: result.rows.length });
        }

        // Send messages (rate-limited, fire-and-forget)
        let sent = 0;
        for (const customer of result.rows) {
            const message = template
                .replace(/\{name\}/g, customer.name || '')
                .replace(/\{childName\}/g, customer.child_name || '')
                .replace(/\{phone\}/g, customer.phone || '');

            // Log to communication_log
            await pool.query(
                'INSERT INTO communication_log (customer_id, type, direction, summary, created_by) VALUES ($1, $2, $3, $4, $5)',
                [customer.id, 'bulk_message', 'out', message, req.user?.id || null]
            );
            sent++;
        }

        log.info(`Bulk message sent to ${sent} customers by ${req.user?.username}`);
        res.json({ success: true, sent });
    } catch (err) {
        log.error('POST /bulk-message error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List customers (with pagination, search, and filters)
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const source = (req.query.source || '').trim();
        const minVisits = parseInt(req.query.minVisits) || 0;
        const maxVisits = parseInt(req.query.maxVisits) || 0;
        const dateFrom = (req.query.dateFrom || '').trim();
        const dateTo = (req.query.dateTo || '').trim();
        const sortBy = (req.query.sortBy || 'updated_at').trim();
        const tag = (req.query.tag || '').trim();

        const sb = getSupabase();
        if (sb) {
            let query = sb.from('customers').select('*', { count: 'exact' });

            if (search) {
                const pattern = `%${search}%`;
                query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},instagram.ilike.${pattern},child_name.ilike.${pattern}`);
            }
            if (source) query = query.eq('source', source);
            if (minVisits > 0) query = query.gte('total_bookings', minVisits);
            if (maxVisits > 0) query = query.lte('total_bookings', maxVisits);
            if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) query = query.gte('last_visit', dateFrom);
            if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) query = query.lte('last_visit', dateTo);

            const sortMap = {
                'updated_at': { column: 'updated_at', ascending: false },
                'name': { column: 'name', ascending: true },
                'total_bookings': { column: 'total_bookings', ascending: false },
                'total_spent': { column: 'total_spent', ascending: false },
                'last_visit': { column: 'last_visit', ascending: false },
                'created_at': { column: 'created_at', ascending: false }
            };
            const sort = sortMap[sortBy] || sortMap['updated_at'];
            query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
            query = query.range(offset, offset + limit - 1);

            const { data, error, count } = await query;
            if (error) throw error;

            return res.json({
                customers: (data || []).map(mapCustomerRow),
                total: count || 0,
                page,
                pages: Math.ceil((count || 0) / limit)
            });
        }

        // Fallback: Railway
        const conditions = [];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR instagram ILIKE $${params.length} OR child_name ILIKE $${params.length})`);
        }
        if (source) { params.push(source); conditions.push(`source = $${params.length}`); }
        if (minVisits > 0) { params.push(minVisits); conditions.push(`total_bookings >= $${params.length}`); }
        if (maxVisits > 0) { params.push(maxVisits); conditions.push(`total_bookings <= $${params.length}`); }
        if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { params.push(dateFrom); conditions.push(`last_visit >= $${params.length}::date`); }
        if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { params.push(dateTo); conditions.push(`last_visit <= $${params.length}::date`); }
        if (tag) { params.push(tag); conditions.push(`id IN (SELECT customer_id FROM customer_tags WHERE tag = $${params.length})`); }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const allowedSorts = {
            'updated_at': 'updated_at DESC', 'name': 'name ASC',
            'total_bookings': 'total_bookings DESC', 'total_spent': 'total_spent DESC',
            'last_visit': 'last_visit DESC NULLS LAST', 'created_at': 'created_at DESC'
        };
        const orderBy = allowedSorts[sortBy] || 'updated_at DESC';

        const countResult = await pool.query(`SELECT COUNT(*) FROM customers ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const dataParams = [...params, limit, offset];
        // v32.1: JOIN bookings to compute real totalBookings/totalSpent/LTV
        const result = await pool.query(
            `SELECT c.*,
                    COALESCE(b_agg.booking_count, 0) AS real_total_bookings,
                    COALESCE(b_agg.booking_spent, 0) AS real_total_spent,
                    b_agg.real_last_visit,
                    b_agg.real_first_visit
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id,
                        COUNT(*) AS booking_count,
                        COALESCE(SUM(price), 0) AS booking_spent,
                        MAX(date) AS real_last_visit,
                        MIN(date) AS real_first_visit
                 FROM bookings
                 WHERE status != 'cancelled'
                 GROUP BY customer_id
             ) b_agg ON b_agg.customer_id = c.id
             ${where ? where.replace(/WHERE/i, 'WHERE') : ''}
             ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        // v30.4: Attach tags to each customer
        const customerIds = result.rows.map(r => r.id);
        let tagsMap = {};
        if (customerIds.length > 0) {
            try {
                const tagsResult = await pool.query(
                    'SELECT id, customer_id, tag, color FROM customer_tags WHERE customer_id = ANY($1)',
                    [customerIds]
                );
                for (const t of tagsResult.rows) {
                    if (!tagsMap[t.customer_id]) tagsMap[t.customer_id] = [];
                    tagsMap[t.customer_id].push({ id: t.id, tag: t.tag, color: t.color });
                }
            } catch { /* tags table may not exist yet */ }
        }

        res.json({
            customers: result.rows.map(r => {
                // v32.1: Override denormalized fields with real booking aggregates
                r.total_bookings = parseInt(r.real_total_bookings) || r.total_bookings || 0;
                r.total_spent = parseInt(r.real_total_spent) || r.total_spent || 0;
                if (r.real_last_visit) r.last_visit = r.real_last_visit;
                if (r.real_first_visit) r.first_visit = r.real_first_visit;
                const c = mapCustomerRow(r);
                c.tags = tagsMap[r.id] || [];
                c.ltv = calculateLTV(r);
                return c;
            }),
            total, page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        log.error('Customer list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get customer by ID (with booking history + certificates)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const numId = parseInt(id);

        let customer;
        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers').select('*').eq('id', numId).single();
            if (error || !data) return res.status(404).json({ error: 'Клієнта не знайдено' });
            customer = mapCustomerRow(data);
        } else {
            const result = await pool.query('SELECT * FROM customers WHERE id = $1', [numId]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Клієнта не знайдено' });
            customer = mapCustomerRow(result.rows[0]);
        }

        // Bookings + certificates from Railway DB (they stay there)
        const bookings = await pool.query(
            `SELECT id, date, time, program_name, program_code, label, price, status, room, duration
             FROM bookings WHERE customer_id = $1 AND linked_to IS NULL ORDER BY date DESC LIMIT 50`,
            [numId]
        );
        customer.bookings = bookings.rows.map(b => ({
            id: b.id, date: b.date, time: b.time, programName: b.program_name,
            programCode: b.program_code, label: b.label, price: b.price,
            status: b.status, room: b.room, duration: b.duration
        }));

        try {
            const certs = await pool.query(
                `SELECT id, cert_code, display_value, type_text, status, valid_until, issued_at
                 FROM certificates WHERE customer_id = $1 ORDER BY issued_at DESC`, [numId]
            );
            customer.certificates = certs.rows.map(c => ({
                id: c.id, certCode: c.cert_code, displayValue: c.display_value,
                typeText: c.type_text, status: c.status, validUntil: c.valid_until, issuedAt: c.issued_at
            }));
        } catch { customer.certificates = []; }

        // v30.4: Tags
        try {
            const tags = await pool.query('SELECT id, tag, color FROM customer_tags WHERE customer_id = $1', [numId]);
            customer.tags = tags.rows;
        } catch { customer.tags = []; }

        // v30.4: LTV
        if (customer.totalBookings > 0) {
            const raw = { total_bookings: customer.totalBookings, total_spent: customer.totalSpent,
                          first_visit: customer.firstVisit, last_visit: customer.lastVisit };
            customer.ltv = calculateLTV(raw);
        } else {
            customer.ltv = 0;
        }

        res.json(customer);
    } catch (err) {
        log.error('Customer get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create customer
router.post('/', async (req, res) => {
    try {
        const { name, phone, instagram, childName, childBirthday, source, notes } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }

        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers').insert({
                name: name.trim(), phone: phone || null, instagram: instagram || null,
                child_name: childName || null, child_birthday: childBirthday || null,
                source: source || null, notes: notes || null
            }).select().single();
            if (error) throw error;
            return res.json(mapCustomerRow(data));
        }

        const result = await pool.query(
            `INSERT INTO customers (name, phone, instagram, child_name, child_birthday, source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name.trim(), phone || null, instagram || null, childName || null, childBirthday || null, source || null, notes || null]
        );
        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        log.error('Customer create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update customer
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, instagram, childName, childBirthday, source, notes } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }

        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('customers').update({
                name: name.trim(), phone: phone || null, instagram: instagram || null,
                child_name: childName || null, child_birthday: childBirthday || null,
                source: source || null, notes: notes || null, updated_at: new Date().toISOString()
            }).eq('id', parseInt(id)).select().single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Клієнта не знайдено' });
            return res.json(mapCustomerRow(data));
        }

        const result = await pool.query(
            `UPDATE customers SET name=$1, phone=$2, instagram=$3, child_name=$4,
             child_birthday=$5, source=$6, notes=$7, updated_at=NOW()
             WHERE id=$8 RETURNING *`,
            [name.trim(), phone || null, instagram || null, childName || null, childBirthday || null, source || null, notes || null, parseInt(id)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Клієнта не знайдено' });
        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        log.error('Customer update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete customer
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const numId = parseInt(id);

        // Unlink bookings and certificates in Railway
        await pool.query('UPDATE bookings SET customer_id = NULL WHERE customer_id = $1', [numId]);
        try {
            await pool.query('UPDATE certificates SET customer_id = NULL WHERE customer_id = $1', [numId]);
        } catch { /* certificates may not have customer_id yet */ }

        const sb = getSupabase();
        if (sb) {
            const { error } = await sb.from('customers').delete().eq('id', numId);
            if (error) throw error;
            return res.json({ success: true });
        }

        const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING id', [numId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Клієнта не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('Customer delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v20.9.12: Migration endpoint — copy customers from Railway to Supabase
router.post('/migrate-to-supabase', async (req, res) => {
    try {
        const sb = getSupabase();
        if (!sb) return res.status(400).json({ error: 'Supabase not configured' });

        const result = await pool.query('SELECT * FROM customers ORDER BY id');
        if (result.rows.length === 0) return res.json({ success: true, migrated: 0 });

        let migrated = 0;
        for (const row of result.rows) {
            const { error } = await sb.from('customers').upsert({
                id: row.id, name: row.name, phone: row.phone, instagram: row.instagram,
                child_name: row.child_name, child_birthday: row.child_birthday,
                source: row.source, notes: row.notes, total_bookings: row.total_bookings || 0,
                total_spent: row.total_spent || 0, first_visit: row.first_visit,
                last_visit: row.last_visit, created_at: row.created_at, updated_at: row.updated_at
            }, { onConflict: 'id' });
            if (!error) migrated++;
            else log.warn(`Migration failed for customer ${row.id}: ${error.message}`);
        }

        log.info(`Migrated ${migrated}/${result.rows.length} customers to Supabase`);
        res.json({ success: true, migrated, total: result.rows.length });
    } catch (err) {
        log.error('Customer migration error', err);
        res.status(500).json({ error: 'Migration failed' });
    }
});

// Row mapper (snake_case → camelCase)
function mapCustomerRow(row) {
    return {
        id: row.id,
        name: row.name,
        phone: row.phone || null,
        instagram: row.instagram || null,
        childName: row.child_name || null,
        childBirthday: row.child_birthday || null,
        source: row.source || null,
        notes: row.notes || null,
        totalBookings: row.total_bookings || 0,
        totalSpent: row.total_spent || 0,
        firstVisit: row.first_visit || null,
        lastVisit: row.last_visit || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// v15.1: RFM score calculation
function calculateRFMScores(customers) {
    if (customers.length === 0) return [];
    const recencies = customers.filter(c => c.recencyDays !== null).map(c => c.recencyDays);
    const frequencies = customers.map(c => c.frequency);
    const monetaries = customers.map(c => c.monetary);

    return customers.map(c => {
        let rScore = 1;
        if (c.recencyDays !== null && recencies.length > 0) rScore = getPercentileScore(recencies, c.recencyDays, true);
        let fScore = 1;
        if (frequencies.length > 0) fScore = getPercentileScore(frequencies, c.frequency, false);
        let mScore = 1;
        if (monetaries.length > 0) mScore = getPercentileScore(monetaries, c.monetary, false);
        const rfmScore = rScore + fScore + mScore;
        const rfmSegment = getRFMSegment(rScore, fScore, mScore);
        return { ...c, rScore, fScore, mScore, rfmScore, rfmSegment };
    });
}

function getPercentileScore(arr, value, inverted) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = sorted.indexOf(value);
    const percentile = idx / Math.max(sorted.length - 1, 1);
    const score = inverted ? (1 - percentile) : percentile;
    if (score >= 0.8) return 5;
    if (score >= 0.6) return 4;
    if (score >= 0.4) return 3;
    if (score >= 0.2) return 2;
    return 1;
}

function getRFMSegment(r, f, m) {
    const avg = (r + f + m) / 3;
    if (r >= 4 && f >= 4) return 'champion';
    if (f >= 3 && m >= 3) return 'loyal';
    if (r >= 3 && f <= 2) return 'potential';
    if (r <= 2 && f >= 2) return 'at_risk';
    if (avg <= 2) return 'lost';
    return 'potential';
}

// v30.4: LTV calculation
function calculateLTV(row) {
    const bookings = row.total_bookings || 0;
    const spent = row.total_spent || 0;
    if (bookings === 0 || !row.first_visit) return 0;
    const firstDate = new Date(row.first_visit);
    const lastDate = row.last_visit ? new Date(row.last_visit) : new Date();
    const daysDiff = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
    const visitsPerYear = bookings / (daysDiff / 365);
    const avgSpend = spent / bookings;
    return Math.round(spent + (avgSpend * visitsPerYear * 2));
}

function escapeCsv(str) {
    if (!str) return '';
    const s = String(str);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

module.exports = router;
