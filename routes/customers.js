/**
 * routes/customers.js — CRM Customer CRUD + search + filters + RFM + export
 * v15.1: Phase 2 — filters, RFM analytics, CSV export, certificate link
 * v20.9.12: Supabase migration — customers read/write via Supabase, fallback to Railway
 */
const router = require('express').Router();
const { pool } = require('../db');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');
const { exportLimiter } = require('../middleware/rateLimit');

const log = createLogger('Customers');

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
            const result = await pool.query(`
                SELECT id, name, phone, instagram, child_name,
                       total_bookings, total_spent, first_visit, last_visit,
                       created_at, updated_at
                FROM customers
                ORDER BY last_visit DESC NULLS LAST
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

        // Fallback: Railway
        const totalResult = await pool.query('SELECT COUNT(*) FROM customers');
        const sourceResult = await pool.query(
            `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
             FROM customers GROUP BY source ORDER BY count DESC`
        );
        const topResult = await pool.query(
            `SELECT id, name, total_bookings, total_spent, last_visit
             FROM customers ORDER BY total_spent DESC LIMIT 5`
        );
        const recentResult = await pool.query(
            `SELECT id, name, total_bookings, total_spent, created_at
             FROM customers ORDER BY created_at DESC LIMIT 5`
        );
        const avgResult = await pool.query(
            `SELECT ROUND(AVG(total_bookings), 1) AS avg_bookings,
                    ROUND(AVG(total_spent), 0) AS avg_spent
             FROM customers WHERE total_bookings > 0`
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
        const result = await pool.query(
            `SELECT * FROM customers ${where} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        res.json({
            customers: result.rows.map(mapCustomerRow),
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
