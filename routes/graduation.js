/**
 * routes/graduation.js — Graduation Event Builder API (v30.0.0)
 * Конструктор випускного: послуги, пакети, кошики, КП
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Graduation');
function getKleshnya() { return require('../services/kleshnya'); }
function _escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function mapServiceRow(row) {
    return {
        id: row.id,
        sortOrder: row.sort_order,
        name: row.name,
        description: row.description,
        durationMin: row.duration_min,
        pricePark: row.price_park,
        pricePerChild: row.price_per_child,
        priceType: row.price_type,
        costHost: row.cost_host,
        costCostume: row.cost_costume,
        costBalloonsPerKid: row.cost_balloons_per_kid,
        costAquagrimPerKid: row.cost_aquagrim_per_kid,
        costPrintPerKid: row.cost_print_per_kid,
        costDesignPerKid: row.cost_design_per_kid,
        costDelivery: row.cost_delivery,
        costIce: row.cost_ice,
        costOther: row.cost_other,
        costBox: row.cost_box,
        costMarkers: row.cost_markers,
        costSolution: row.cost_solution,
        costCleaning: row.cost_cleaning,
        costDrinksPerKid: row.cost_drinks_per_kid,
        costType: row.cost_type,
        category: row.category,
        minKids: row.min_kids,
        maxKids: row.max_kids,
        entryRule: row.entry_rule,
        isActive: row.is_active,
        catalogDescription: row.catalog_description || null
    };
}

function mapQuoteRow(row) {
    return {
        id: row.id,
        quoteNumber: row.quote_number,
        customerId: row.customer_id,
        kidsCount: row.kids_count,
        discountPercent: row.discount_percent,
        selectedServices: row.selected_services,
        packageId: row.package_id,
        totalPerChild: row.total_per_child,
        totalAll: row.total_all,
        totalCost: row.total_cost,
        totalProfit: row.total_profit,
        profitMargin: row.profit_margin,
        status: row.status,
        bookingId: row.booking_id,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// GET /api/graduation/settings — глобальні параметри
router.get('/settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM graduation_settings ORDER BY key');
        const settings = {};
        for (const row of result.rows) {
            settings[row.key] = { value: row.value, label: row.label };
        }
        res.json(settings);
    } catch (err) {
        log.error('Get settings error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/graduation/settings — оновити параметри (director/creator)
router.put('/settings', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'settings object required' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const [key, value] of Object.entries(settings)) {
                if (typeof value !== 'number' || isNaN(value)) continue;
                await client.query(
                    'UPDATE graduation_settings SET value = $1, updated_at = NOW() WHERE key = $2',
                    [value, key]
                );
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        log.info(`Settings updated by ${req.user.username}`);

        // Catalog auto-task: if coefficient or markup changed, all formula packages affected
        for (const [key, value] of Object.entries(settings)) {
            if (key === 'coefficient' || key === 'markup') {
                try {
                    await onSettingsChanged(key, value, req.user.username);
                } catch (e) {
                    log.error('onSettingsChanged error', e);
                }
            }
        }

        const result = await pool.query('SELECT * FROM graduation_settings ORDER BY key');
        const updated = {};
        for (const row of result.rows) {
            updated[row.key] = { value: row.value, label: row.label };
        }
        res.json(updated);
    } catch (err) {
        log.error('Update settings error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/services — каталог послуг
router.get('/services', async (req, res) => {
    try {
        const activeOnly = req.query.active !== 'false';
        const query = activeOnly
            ? 'SELECT * FROM graduation_services WHERE is_active = true ORDER BY sort_order'
            : 'SELECT * FROM graduation_services ORDER BY sort_order';
        const result = await pool.query(query);
        res.json(result.rows.map(mapServiceRow));
    } catch (err) {
        log.error('List services error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/graduation/services/:id — оновити послугу (director/creator)
router.put('/services/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT id FROM graduation_services WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Service not found' });
        }

        const b = req.body;
        const result = await pool.query(
            `UPDATE graduation_services SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                duration_min = COALESCE($3, duration_min),
                price_park = COALESCE($4, price_park),
                price_per_child = COALESCE($5, price_per_child),
                price_type = COALESCE($6, price_type),
                cost_host = COALESCE($7, cost_host),
                cost_costume = COALESCE($8, cost_costume),
                cost_balloons_per_kid = COALESCE($9, cost_balloons_per_kid),
                cost_aquagrim_per_kid = COALESCE($10, cost_aquagrim_per_kid),
                cost_print_per_kid = COALESCE($11, cost_print_per_kid),
                cost_design_per_kid = COALESCE($12, cost_design_per_kid),
                cost_delivery = COALESCE($13, cost_delivery),
                cost_ice = COALESCE($14, cost_ice),
                cost_other = COALESCE($15, cost_other),
                cost_box = COALESCE($16, cost_box),
                cost_markers = COALESCE($17, cost_markers),
                cost_solution = COALESCE($18, cost_solution),
                cost_cleaning = COALESCE($19, cost_cleaning),
                cost_drinks_per_kid = COALESCE($20, cost_drinks_per_kid),
                cost_type = COALESCE($21, cost_type),
                category = COALESCE($22, category),
                sort_order = COALESCE($23, sort_order),
                is_active = COALESCE($24, is_active),
                updated_at = NOW()
            WHERE id = $25 RETURNING *`,
            [
                b.name, b.description, b.durationMin, b.pricePark, b.pricePerChild,
                b.priceType, b.costHost, b.costCostume, b.costBalloonsPerKid,
                b.costAquagrimPerKid, b.costPrintPerKid, b.costDesignPerKid,
                b.costDelivery, b.costIce, b.costOther, b.costBox, b.costMarkers,
                b.costSolution, b.costCleaning, b.costDrinksPerKid, b.costType,
                b.category, b.sortOrder, b.isActive, id
            ]
        );

        const updated = result.rows[0];
        log.info(`Service ${id} updated by ${req.user.username}`);

        // Catalog auto-task: if price changed, create task for affected packages
        if (b.pricePerChild !== undefined || b.pricePark !== undefined) {
            try {
                await onServicePriceChanged(id, req.user.username);
            } catch (e) {
                log.error('onServicePriceChanged error', e);
            }
        }

        res.json(mapServiceRow(updated));
    } catch (err) {
        log.error('Update service error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/packages — готові пакети (з цінами для каталогу)
router.get('/packages', async (req, res) => {
    try {
        const packages = await pool.query(
            'SELECT * FROM graduation_packages WHERE is_active = true ORDER BY sort_order'
        );
        const items = await pool.query(
            `SELECT pi.package_id, pi.service_id, pi.override_price,
                    s.name as service_name, s.price_per_child, s.duration_min,
                    s.description as service_description, s.category, s.price_type
             FROM graduation_package_items pi
             JOIN graduation_services s ON s.id = pi.service_id
             ORDER BY s.sort_order`
        );

        const itemMap = {};
        for (const item of items.rows) {
            if (!itemMap[item.package_id]) itemMap[item.package_id] = [];
            itemMap[item.package_id].push({
                serviceId: item.service_id,
                serviceName: item.service_name,
                overridePrice: item.override_price,
                pricePerChild: item.override_price || item.price_per_child,
                durationMin: item.duration_min,
                description: item.service_description,
                category: item.category,
                priceType: item.price_type
            });
        }

        const result = packages.rows.map(p => {
            const services = itemMap[p.id] || [];
            const totalPerChild = services.reduce((sum, s) => sum + parseFloat(s.pricePerChild || 0), 0);
            const totalDuration = services.reduce((sum, s) => sum + parseInt(s.durationMin || 0), 0);
            return {
                id: p.id,
                name: p.name,
                slug: p.slug,
                description: p.description || '',
                imageUrl: p.image_url || null,
                sortOrder: p.sort_order,
                minKids: p.min_kids || 7,
                maxKids: p.max_kids || 50,
                services,
                totalPerChild,
                totalDuration
            };
        });

        res.json(result);
    } catch (err) {
        log.error('List packages error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/packages/:slug — пакет з деталями
router.get('/packages/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const pkg = await pool.query('SELECT * FROM graduation_packages WHERE slug = $1', [slug]);
        if (pkg.rows.length === 0) {
            return res.status(404).json({ error: 'Package not found' });
        }

        const items = await pool.query(
            `SELECT s.*, pi.override_price
             FROM graduation_package_items pi
             JOIN graduation_services s ON s.id = pi.service_id
             WHERE pi.package_id = $1
             ORDER BY s.sort_order`,
            [pkg.rows[0].id]
        );

        res.json({
            id: pkg.rows[0].id,
            name: pkg.rows[0].name,
            slug: pkg.rows[0].slug,
            description: pkg.rows[0].description || '',
            imageUrl: pkg.rows[0].image_url || null,
            services: items.rows.map(r => ({
                ...mapServiceRow(r),
                overridePrice: r.override_price
            }))
        });
    } catch (err) {
        log.error('Get package error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/graduation/quotes — створити конфігурацію
router.post('/quotes', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { kidsCount, discountPercent, selectedServices, packageId, totalPerChild,
                totalAll, totalCost, totalProfit, profitMargin, notes, customerId } = req.body;

        if (!kidsCount || kidsCount < 1) {
            return res.status(400).json({ error: 'kidsCount is required (min 1)' });
        }

        // Generate quote number: GRAD-YYYY-NNN
        const year = new Date().getFullYear();
        const countResult = await pool.query(
            "SELECT COUNT(*) FROM graduation_quotes WHERE quote_number LIKE $1",
            [`GRAD-${year}-%`]
        );
        const seq = parseInt(countResult.rows[0].count) + 1;
        const quoteNumber = `GRAD-${year}-${String(seq).padStart(3, '0')}`;

        const result = await pool.query(
            `INSERT INTO graduation_quotes
                (quote_number, customer_id, kids_count, discount_percent, selected_services,
                 package_id, total_per_child, total_all, total_cost, total_profit,
                 profit_margin, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [quoteNumber, customerId || null, kidsCount, discountPercent || 0,
             JSON.stringify(selectedServices || []), packageId || null,
             totalPerChild || 0, totalAll || 0, totalCost || 0, totalProfit || 0,
             profitMargin || 0, notes || null, req.user.username]
        );

        log.info(`Quote ${quoteNumber} created by ${req.user.username}`);
        res.status(201).json(mapQuoteRow(result.rows[0]));
    } catch (err) {
        log.error('Create quote error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/quotes — список збережених конфігурацій
router.get('/quotes', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { status } = req.query;
        let query = 'SELECT * FROM graduation_quotes';
        const params = [];
        if (status) {
            query += ' WHERE status = $1';
            params.push(status);
        }
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows.map(mapQuoteRow));
    } catch (err) {
        log.error('List quotes error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/quotes/:id — деталі конфігурації
router.get('/quotes/:id', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM graduation_quotes WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }
        res.json(mapQuoteRow(result.rows[0]));
    } catch (err) {
        log.error('Get quote error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/graduation/quotes/:id — оновити конфігурацію
router.put('/quotes/:id', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT id FROM graduation_quotes WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const b = req.body;
        const result = await pool.query(
            `UPDATE graduation_quotes SET
                kids_count = COALESCE($1, kids_count),
                discount_percent = COALESCE($2, discount_percent),
                selected_services = COALESCE($3, selected_services),
                package_id = $4,
                total_per_child = COALESCE($5, total_per_child),
                total_all = COALESCE($6, total_all),
                total_cost = COALESCE($7, total_cost),
                total_profit = COALESCE($8, total_profit),
                profit_margin = COALESCE($9, profit_margin),
                notes = COALESCE($10, notes),
                customer_id = $11,
                updated_at = NOW()
            WHERE id = $12 RETURNING *`,
            [
                b.kidsCount, b.discountPercent,
                b.selectedServices ? JSON.stringify(b.selectedServices) : null,
                b.packageId || null, b.totalPerChild, b.totalAll, b.totalCost,
                b.totalProfit, b.profitMargin, b.notes, b.customerId || null, id
            ]
        );

        log.info(`Quote ${id} updated by ${req.user.username}`);
        res.json(mapQuoteRow(result.rows[0]));
    } catch (err) {
        log.error('Update quote error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/graduation/quotes/:id/status — змінити статус
router.patch('/quotes/:id/status', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const validStatuses = ['draft', 'sent', 'approved', 'booked', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const result = await pool.query(
            'UPDATE graduation_quotes SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        log.info(`Quote ${id} status → ${status} by ${req.user.username}`);
        res.json(mapQuoteRow(result.rows[0]));
    } catch (err) {
        log.error('Update quote status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/graduation/quotes/:id/booking — створити бронювання
router.post('/quotes/:id/booking', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const quote = await pool.query('SELECT * FROM graduation_quotes WHERE id = $1', [id]);
        if (quote.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const q = quote.rows[0];
        if (q.booking_id) {
            return res.status(400).json({ error: 'Quote already has a booking' });
        }

        const { date, time, room, lineId } = req.body;
        if (!date || !time) {
            return res.status(400).json({ error: 'date and time are required' });
        }

        // Generate booking ID
        const year = new Date().getFullYear();
        const bkCount = await pool.query(
            "SELECT COUNT(*) FROM bookings WHERE id LIKE $1",
            [`BK-${year}-%`]
        );
        const bkSeq = parseInt(bkCount.rows[0].count) + 1;
        const bookingId = `BK-${year}-${String(bkSeq).padStart(4, '0')}`;

        // Get package name if available
        let programName = 'Індивідуальний випускний';
        if (q.package_id) {
            const pkg = await pool.query('SELECT name FROM graduation_packages WHERE id = $1', [q.package_id]);
            if (pkg.rows.length > 0) programName = `Випускний: ${pkg.rows[0].name}`;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO bookings (id, date, time, line_id, room, program_name, kids_count,
                    price, category, status, extra_data, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'graduation', 'confirmed',
                    $9, $10)`,
                [bookingId, date, time, lineId || 'graduation', room || null, programName, q.kids_count,
                 Math.round(q.total_all), JSON.stringify({
                     quoteId: q.id,
                     quoteNumber: q.quote_number,
                     services: q.selected_services,
                     kidsCount: q.kids_count,
                     packageId: q.package_id
                 }), req.user.username]
            );

            await client.query(
                'UPDATE graduation_quotes SET status = $1, booking_id = $2, updated_at = NOW() WHERE id = $3',
                ['booked', bookingId, id]
            );

            await client.query('COMMIT');

            log.info(`Booking ${bookingId} created from quote ${q.quote_number} by ${req.user.username}`);
            res.status(201).json({ bookingId, quoteNumber: q.quote_number });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (err) {
        log.error('Create booking from quote error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/quotes/:id/proposal — генерація КП (HTML)
// Query-token support for window.open lives in middleware/apiAuthBoundary.js.
router.get('/quotes/:id/proposal', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const quote = await pool.query('SELECT * FROM graduation_quotes WHERE id = $1', [id]);
        if (quote.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const q = quote.rows[0];
        const services = q.selected_services || [];

        // Get service details
        const serviceIds = services.map(s => s.serviceId || s.service_id);
        let serviceDetails = [];
        if (serviceIds.length > 0) {
            const svcResult = await pool.query(
                'SELECT * FROM graduation_services WHERE id = ANY($1) ORDER BY sort_order',
                [serviceIds]
            );
            serviceDetails = svcResult.rows;
        }

        let packageName = 'Індивідуальний випускний';
        if (q.package_id) {
            const pkg = await pool.query('SELECT name FROM graduation_packages WHERE id = $1', [q.package_id]);
            if (pkg.rows.length > 0) packageName = pkg.rows[0].name;
        }

        const totalDuration = serviceDetails.reduce((sum, s) => sum + (s.duration_min || 0), 0);

        const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Комерційна пропозиція — ${packageName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Nunito',sans-serif;background:#0D0D0D;color:#fff;padding:40px 20px}
.proposal{max-width:800px;margin:0 auto;background:linear-gradient(135deg,rgba(30,30,30,0.95),rgba(20,20,20,0.98));border-radius:24px;padding:48px;border:1px solid rgba(201,168,76,0.3)}
h1{font-size:28px;color:#C9A84C;text-align:center;margin-bottom:8px}
.subtitle{text-align:center;color:#999;margin-bottom:32px;font-size:16px}
.info-row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08)}
.info-row:last-child{border-bottom:none}
.info-label{color:#999;font-size:14px}
.info-value{font-weight:700;font-size:14px}
.services-list{margin:24px 0}
.services-list h2{font-size:20px;color:#C9A84C;margin-bottom:16px}
.service-item{background:rgba(255,255,255,0.04);border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.06)}
.service-item h3{font-size:16px;margin-bottom:6px;display:flex;justify-content:space-between}
.service-item h3 span{color:#C9A84C}
.service-item p{color:#aaa;font-size:13px;line-height:1.5}
.total-block{background:linear-gradient(135deg,rgba(201,168,76,0.15),rgba(201,168,76,0.05));border-radius:16px;padding:24px;margin-top:24px;border:1px solid rgba(201,168,76,0.3);text-align:center}
.total-block .price{font-size:36px;font-weight:900;color:#C9A84C}
.total-block .per-child{font-size:18px;color:#fff;margin-top:8px}
.total-block .duration{color:#999;margin-top:8px;font-size:14px}
.footer{text-align:center;margin-top:32px;color:#666;font-size:13px}
.footer a{color:#C9A84C}
@media print{body{background:#fff;color:#333}.proposal{border:none;box-shadow:none}.service-item{border-color:#eee}.total-block{border-color:#C9A84C}}
</style>
</head>
<body>
<div class="proposal">
<h1>Випускний у Парку Закревського</h1>
<p class="subtitle">${packageName} — ${q.kids_count} дітей</p>

<div class="services-list">
<h2>Програма свята</h2>
${serviceDetails.map(s => `
<div class="service-item">
<h3>${_escH(s.name)} <span>${s.duration_min ? s.duration_min + ' хв' : ''}</span></h3>
<p>${_escH(s.description) || ''}</p>
</div>`).join('')}
</div>

<div class="total-block">
<div class="price">${formatUAH(q.total_all)}</div>
<div class="per-child">${formatUAH(q.total_per_child)} за дитину</div>
${q.discount_percent > 0 ? `<div style="color:#4CAF50;margin-top:4px">Знижка: ${q.discount_percent}%</div>` : ''}
<div class="duration">Тривалість: ${totalDuration} хв (${Math.round(totalDuration / 60 * 10) / 10} год)</div>
</div>

<div class="footer">
<p>Парк Закревського Періоду</p>
<p>Пропозиція ${q.quote_number} від ${new Date(q.created_at).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })}</p>
</div>
</div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        log.error('Generate proposal error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/analytics — статистика (#46, #47, #48)
router.get('/analytics', requireRole('creator', 'director'), async (req, res) => {
    try {
        // #46: Service popularity
        const popularityResult = await pool.query(`
            SELECT s.value->>'serviceId' as service_id,
                   s.value->>'name' as service_name,
                   COUNT(*) as usage_count
            FROM graduation_quotes q,
                 jsonb_array_elements(q.selected_services) s
            WHERE q.status != 'cancelled'
            GROUP BY s.value->>'serviceId', s.value->>'name'
            ORDER BY usage_count DESC
        `);

        const totalQuotes = await pool.query(
            "SELECT COUNT(*) FROM graduation_quotes WHERE status != 'cancelled'"
        );
        const total = parseInt(totalQuotes.rows[0].count) || 1;

        const popularity = popularityResult.rows.map(r => ({
            serviceId: parseInt(r.service_id),
            serviceName: r.service_name,
            count: parseInt(r.usage_count),
            percentage: Math.round(parseInt(r.usage_count) / total * 100)
        }));

        // #47: Average check
        const avgResult = await pool.query(`
            SELECT
                COALESCE(AVG(total_per_child), 0) as avg_per_child,
                COALESCE(AVG(total_all), 0) as avg_total,
                COALESCE(AVG(kids_count), 0) as avg_kids,
                COUNT(*) as total_quotes
            FROM graduation_quotes
            WHERE status IN ('approved', 'booked')
        `);
        const avg = avgResult.rows[0];

        // #48: Conversion funnel
        const funnelResult = await pool.query(`
            SELECT status, COUNT(*) as cnt
            FROM graduation_quotes
            GROUP BY status
        `);
        const funnel = {};
        let totalAll = 0;
        for (const r of funnelResult.rows) {
            funnel[r.status] = parseInt(r.cnt);
            totalAll += parseInt(r.cnt);
        }

        res.json({
            popularity,
            averageCheck: {
                perChild: Math.round(parseFloat(avg.avg_per_child)),
                total: Math.round(parseFloat(avg.avg_total)),
                avgKids: Math.round(parseFloat(avg.avg_kids)),
                totalQuotes: parseInt(avg.total_quotes)
            },
            funnel: {
                total: totalAll,
                draft: funnel.draft || 0,
                sent: funnel.sent || 0,
                approved: funnel.approved || 0,
                booked: funnel.booked || 0,
                cancelled: funnel.cancelled || 0,
                conversionRate: totalAll > 0 ? Math.round((funnel.booked || 0) / totalAll * 100) : 0
            }
        });
    } catch (err) {
        log.error('Analytics error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/graduation/customers/search — пошук клієнтів (#26)
router.get('/customers/search', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const result = await pool.query(
            `SELECT id, name, phone, email FROM customers
             WHERE name ILIKE $1 OR phone ILIKE $1
             ORDER BY name LIMIT 10`,
            [`%${q}%`]
        );
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            email: r.email
        })));
    } catch (err) {
        log.error('Customer search error', err);
        res.json([]);
    }
});

function formatUAH(amount) {
    if (!amount) return '0 ₴';
    return Math.round(amount).toLocaleString('uk-UA') + ' ₴';
}

// --- Catalog auto-tasks on price changes ---

async function onServicePriceChanged(serviceId, username) {
    const packages = await pool.query(`
        SELECT DISTINCT gp.name, gp.slug
        FROM graduation_packages gp
        JOIN graduation_package_items gpi ON gpi.package_id = gp.id
        WHERE gpi.service_id = $1 AND gp.is_active = true
    `, [serviceId]);

    for (const pkg of packages.rows) {
        await getKleshnya().createTask({
            title: `Каталог: оновити та надрукувати сторінку "${pkg.name}"`,
            description: `Ціна послуги змінилась. Потрібно оновити каталог та роздрукувати оновлену сторінку пакету "${pkg.name}".`,
            assigned_to: 'sergiy',
            priority: 'high',
            category: 'admin',
            created_by: username,
            source_type: 'graduation_catalog',
            source_id: `service_price:${serviceId}:${pkg.slug || pkg.name}`,
            duplicateMode: 'skip'
        });
        log.info(`Catalog task created for package "${pkg.name}" (price change)`);
    }
}

async function onSettingsChanged(key, newValue, username) {
    const packages = await pool.query(`
        SELECT DISTINCT gp.name, gp.slug
        FROM graduation_packages gp
        JOIN graduation_package_items gpi ON gpi.package_id = gp.id
        JOIN graduation_services gs ON gs.id = gpi.service_id
        WHERE gs.price_type = 'formula' AND gp.is_active = true
    `);

    for (const pkg of packages.rows) {
        await getKleshnya().createTask({
            title: `Каталог: оновити та надрукувати сторінку "${pkg.name}"`,
            description: `Глобальний параметр "${key}" змінився (нове значення: ${newValue}). Формульні ціни перераховані. Потрібно оновити каталог та роздрукувати оновлену сторінку.`,
            assigned_to: 'sergiy',
            priority: 'high',
            category: 'admin',
            created_by: username,
            source_type: 'graduation_catalog',
            source_id: `settings:${key}:${pkg.slug || pkg.name}`,
            duplicateMode: 'skip'
        });
        log.info(`Catalog task created for package "${pkg.name}" (${key} changed)`);
    }
}

// GET /api/graduation/catalog/export — print-ready HTML catalog
// Query-token support for window.open lives in middleware/apiAuthBoundary.js.
router.get('/catalog/export', requireRole('creator', 'director', 'senior_manager', 'manager'), async (req, res) => {
    try {
        const pkgResult = await pool.query(
            'SELECT * FROM graduation_packages WHERE is_active = true ORDER BY sort_order'
        );
        const packageSlug = String(req.query.package || req.query.pkg || '').trim();
        const packageRows = packageSlug
            ? pkgResult.rows.filter(pkg => String(pkg.slug) === packageSlug)
            : pkgResult.rows;
        if (packageSlug && packageRows.length === 0) {
            return res.status(404).send('Package not found');
        }
        const itemsResult = await pool.query(
            `SELECT pi.package_id, pi.service_id, pi.override_price,
                    s.name as service_name, s.price_per_child, s.duration_min,
                    s.description as service_description, s.category, s.price_type, s.price_park
             FROM graduation_package_items pi
             JOIN graduation_services s ON s.id = pi.service_id
             ORDER BY s.sort_order`
        );

        // Get settings for formula prices
        const settingsResult = await pool.query('SELECT * FROM graduation_settings ORDER BY key');
        const gradSettings = {};
        for (const row of settingsResult.rows) {
            gradSettings[row.key] = row.value;
        }
        const coefficient = gradSettings.coefficient || 6;
        const markup = gradSettings.markup || 1.15;

        function calcFormulaPrice(pricePark) {
            if (!pricePark) return 0;
            return Math.ceil(pricePark / coefficient * markup / 10) * 10;
        }

        function getPrice(item) {
            if (item.override_price) return item.override_price;
            if (item.price_type === 'formula' && item.price_park) return calcFormulaPrice(item.price_park);
            return item.price_per_child || 0;
        }

        const itemMap = {};
        for (const item of itemsResult.rows) {
            if (!itemMap[item.package_id]) itemMap[item.package_id] = [];
            itemMap[item.package_id].push(item);
        }

        // Fetch catalog_description for services
        const catalogDescResult = await pool.query(
            'SELECT id, catalog_description FROM graduation_services WHERE catalog_description IS NOT NULL'
        );
        const catalogDescMap = {};
        for (const row of catalogDescResult.rows) catalogDescMap[row.id] = row.catalog_description;
        for (const items of Object.values(itemMap)) {
            for (const item of items) {
                item.catalog_description = catalogDescMap[item.service_id] || null;
            }
        }

        // Package theme colors for premium catalog
        const THEMES = {
            'best-dj': { bg1:'#e8d0f0',bg2:'#d4b8e8',bg3:'#c0a0d8', accent:'#9333ea', accentLight:'rgba(147,51,234,0.15)', heroGrad:'linear-gradient(135deg,#8e24aa,#e040fb)', emoji:'🎧' },
            'super-party': { bg1:'#f0e0c0',bg2:'#e8d4a8',bg3:'#d8c490', accent:'#C9A84C', accentLight:'rgba(201,168,76,0.15)', heroGrad:'linear-gradient(135deg,#C9A84C,#e8c84c)', emoji:'🎉' },
            'science-party': { bg1:'#c8d8f0',bg2:'#b0c8e8',bg3:'#98b8d8', accent:'#3B82F6', accentLight:'rgba(59,130,246,0.15)', heroGrad:'linear-gradient(135deg,#3B82F6,#60a5fa)', emoji:'🧪' },
            'handmade-party': { bg1:'#b8e8d0',bg2:'#a0d8c0',bg3:'#88c8b0', accent:'#10B981', accentLight:'rgba(16,185,129,0.15)', heroGrad:'linear-gradient(135deg,#059669,#34d399)', emoji:'✂️' },
            'pizza-party': { bg1:'#f0e8c0',bg2:'#e8dca0',bg3:'#dcd088', accent:'#f59e0b', accentLight:'rgba(245,158,11,0.15)', heroGrad:'linear-gradient(135deg,#d97706,#fbbf24)', emoji:'🍕' },
            'squid-game': { bg1:'#f0c8c8',bg2:'#e8b0b0',bg3:'#d89898', accent:'#ef4444', accentLight:'rgba(239,68,68,0.15)', heroGrad:'linear-gradient(135deg,#dc2626,#f87171)', emoji:'🦑' },
            'neon-party': { bg1:'#e8c0e0',bg2:'#d8a8d0',bg3:'#c890c0', accent:'#ec4899', accentLight:'rgba(236,72,153,0.15)', heroGrad:'linear-gradient(135deg,#db2777,#f472b6)', emoji:'💜' },
        };

        function fmtDurationHours(totalMin) {
            const hours = totalMin / 60;
            if (hours === Math.floor(hours)) return String(Math.floor(hours));
            return hours.toFixed(1).replace('.0', '');
        }

        function durationUnit(totalMin) {
            if (totalMin >= 120) return 'ГОДИНИ';
            if (totalMin >= 60) return 'ГОДИНА';
            return 'ХВ';
        }

        const packagePages = packageRows.map(p => {
            const items = itemMap[p.id] || [];
            const totalPrice = items.reduce((sum, i) => sum + getPrice(i), 0);
            const totalDuration = items.reduce((sum, i) => sum + (i.duration_min || 0), 0);
            const theme = THEMES[p.slug] || THEMES['super-party'];
            const minKids = p.min_kids || 7;
            const maxKids = p.max_kids || 50;

            const imgPath = p.image_url || `/images/catalogs/graduation/${p.slug}-banner.png`;
            const compactClass = items.length > 8 ? ' is-dense' : '';

            // Service names list
            const servicesListHtml = items.map(i =>
                `<li>${_escH(i.service_name).toUpperCase()}${i.duration_min ? `<span>${Number(i.duration_min)} хв</span>` : ''}</li>`
            ).join('');

            // Service descriptions
            const descsHtml = items
                .filter(i => i.service_description || i.catalog_description)
                .map(i => `<div class="desc-item"><strong>${_escH(i.service_name).toUpperCase()}</strong> — ${_escH(i.catalog_description || i.service_description)}</div>`)
                .join('');

            return `
    <section class="page pkg-page${compactClass}" id="pkg-${_escH(p.slug)}" style="--bg1:${theme.bg1};--bg2:${theme.bg2};--bg3:${theme.bg3};--accent:${theme.accent};--accent-soft:${theme.accentLight}">
        <div class="geo-overlay"></div>
        <div class="page-inner">
            <div class="hero-wrap">
                <img class="hero-img" src="${_escH(imgPath)}" alt="${_escH(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <div class="hero-placeholder" style="background:${theme.heroGrad};display:none"><span class="hero-emoji">${theme.emoji}</span></div>
            </div>
            <div class="info-card">
                <div class="info-label">ВИПУСКНИЙ</div>
                <div class="info-title">${_escH(p.name).toUpperCase()}</div>
                <div class="info-row">
                    <div class="info-item"><span class="info-icon">⏱</span><span class="info-val">${fmtDurationHours(totalDuration)}</span><span class="info-unit">${durationUnit(totalDuration)}</span></div>
                    <div class="info-item"><span class="info-icon">👥</span><span class="info-val">${minKids}-${maxKids}</span><span class="info-unit">ДІТЕЙ</span></div>
                    <div class="info-item"><span class="info-icon">₴</span><span class="info-val">${Math.round(totalPrice)}</span><span class="info-unit">/ДИТИНА</span></div>
                </div>
                <div class="info-disclaimer">* В розважальному парку діти знаходяться увесь день. Це загальна тривалість заходів з нашими ведучими.</div>
            </div>
            <div class="svc-card" style="background:${theme.accentLight};border:2px solid ${theme.accent}40">
                <ul class="svc-list">${servicesListHtml}</ul>
            </div>
            ${descsHtml ? `<div class="desc-card">${descsHtml}</div>` : ''}
            <footer class="page-footer">
                <strong>Event Genix · Парк Закревського</strong>
                <span>Київ, вул. Закревського 61/2 · 0800 75 35 53</span>
            </footer>
        </div>
    </section>`;
        }).join('\n');
        const autoPrint = ['1', 'true', 'yes'].includes(String(req.query.print || '').toLowerCase());
        const pageCountText = packageSlug
            ? `${packageRows[0]?.name || 'Пакет'}`
            : `${packageRows.length} A4 сторінок`;

        const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Випускні 2026 — Парк Закревського</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
@page { margin: 0; size: A4 portrait; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { min-height: 100%; }
body { font-family: 'Nunito', sans-serif; margin: 0; padding: 0; color: #1a1a1a; background: #efe9df; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.print-toolbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    background: rgba(17, 24, 39, 0.92);
    color: #fff;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
}
.print-toolbar strong { display: block; font-size: 16px; }
.print-toolbar span { display: block; color: rgba(255,255,255,0.72); font-size: 12px; margin-top: 2px; }
.print-toolbar button {
    border: 0;
    border-radius: 12px;
    background: #10b981;
    color: #fff;
    font: 900 14px 'Nunito', sans-serif;
    padding: 10px 18px;
    cursor: pointer;
}

.page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    padding: 0;
    position: relative;
    overflow: hidden;
    margin: 18px auto;
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
    background: #fff;
}
.page:last-child { page-break-after: avoid; }

/* Cover */
.cover-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0D0D0D, #1a1a2e);
    color: white;
    text-align: center;
}
.cover-icon { font-size: 80px; margin-bottom: 24px; }
.cover-title { font-size: 48px; font-weight: 900; color: #C9A84C; line-height: 1.2; }
.cover-subtitle { font-size: 22px; color: rgba(255,255,255,0.7); margin-top: 12px; font-weight: 600; }
.cover-divider { width: 80px; height: 3px; background: #C9A84C; margin: 32px auto; border-radius: 2px; }
.cover-info { font-size: 18px; color: rgba(255,255,255,0.5); margin-top: 8px; }
.cover-contact { font-size: 15px; color: rgba(255,255,255,0.4); margin-top: 40px; line-height: 1.8; }

/* Package page — geometric mosaic */
.pkg-page {
    background: linear-gradient(135deg, var(--bg1), var(--bg2), var(--bg3));
    position: relative;
}
.geo-overlay {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
        linear-gradient(30deg, rgba(255,255,255,0.14) 12%, transparent 12.5%, transparent 87%, rgba(255,255,255,0.14) 87.5%),
        linear-gradient(150deg, rgba(255,255,255,0.14) 12%, transparent 12.5%, transparent 87%, rgba(255,255,255,0.14) 87.5%),
        linear-gradient(30deg, rgba(255,255,255,0.09) 12%, transparent 12.5%, transparent 87%, rgba(255,255,255,0.09) 87.5%),
        linear-gradient(150deg, rgba(255,255,255,0.09) 12%, transparent 12.5%, transparent 87%, rgba(255,255,255,0.09) 87.5%),
        linear-gradient(60deg, rgba(255,255,255,0.07) 25%, transparent 25.5%, transparent 75%, rgba(255,255,255,0.07) 75%),
        linear-gradient(60deg, rgba(255,255,255,0.07) 25%, transparent 25.5%, transparent 75%, rgba(255,255,255,0.07) 75%);
    background-size: 40px 70px;
    background-position: 0 0, 0 0, 20px 35px, 20px 35px, 0 0, 20px 35px;
}
.page-inner {
    position: relative;
    z-index: 1;
    height: 100%;
    padding: 10mm;
    display: grid;
    grid-template-rows: 82mm auto auto minmax(0, 1fr) auto;
    gap: 4mm;
}

/* Hero */
.hero-wrap { width: 100%; height: 82mm; border-radius: 8mm; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.15); background: rgba(255,255,255,0.22); }
.hero-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.hero-emoji { font-size: 60px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3)); }

/* Info Card */
.info-card { background: rgba(255,255,255,0.93); border-radius: 6mm; padding: 4mm 5mm; text-align: center; border: 1.2mm solid rgba(255,255,255,0.72); }
.info-label { font-size: 10px; font-weight: 800; letter-spacing: 4px; color: #888; margin-bottom: 2px; }
.info-title { font-size: 23px; font-weight: 900; color: #1a1a1a; line-height: 1.06; margin-bottom: 3mm; text-transform: uppercase; }
.info-row { display: flex; justify-content: center; gap: 10mm; margin-bottom: 2mm; }
.info-item { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.info-icon { font-size: 16px; }
.info-val { font-size: 20px; font-weight: 900; color: #1a1a1a; }
.info-unit { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; }
.info-disclaimer { font-size: 7px; color: #aaa; line-height: 1.3; margin-top: 4px; }

/* Services Card */
.svc-card { border-radius: 5mm; padding: 4mm 5mm; text-align: left; }
.svc-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm 5mm; }
.svc-list li { font-size: 9.5px; font-weight: 800; color: #1a1a1a; text-transform: uppercase; letter-spacing: 0.35px; display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; border-bottom: 0.2mm solid rgba(0,0,0,0.08); padding-bottom: 1.3mm; }
.svc-list span { font-size: 8px; color: #64748b; white-space: nowrap; }

/* Description Card */
.desc-card { min-height: 0; overflow: hidden; background: rgba(255,255,255,0.88); border-radius: 5mm; padding: 3.5mm 4.5mm; border: 0.8mm solid rgba(255,255,255,0.5); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm 4mm; align-content: start; }
.desc-item { font-size: 7.4px; line-height: 1.27; color: #444; text-align: left; }
.desc-item:last-child { margin-bottom: 0; }
.desc-item strong { font-weight: 900; color: #1a1a1a; font-size: 7.8px; }
.page-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6mm;
    padding: 3mm 4mm;
    border-radius: 4mm;
    background: rgba(255,255,255,0.82);
    color: #1f2937;
    font-size: 9px;
}
.page-footer strong { color: var(--accent); font-size: 10px; }
.page-footer span { text-align: right; color: #475569; }
.pkg-page.is-dense .page-inner { grid-template-rows: 74mm auto auto minmax(0, 1fr) auto; gap: 3mm; padding: 8mm; }
.pkg-page.is-dense .hero-wrap { height: 74mm; }
.pkg-page.is-dense .info-card { padding: 3mm 4mm; }
.pkg-page.is-dense .svc-list li { font-size: 8.7px; }
.pkg-page.is-dense .desc-item { font-size: 6.8px; line-height: 1.22; }

@media screen {
    body { padding-bottom: 32px; }
    .page { border-radius: 8mm; }
    .page-anchor-note { display: none; }
}
@media print {
    .print-toolbar { display: none !important; }
    body { background: #fff !important; }
    .page {
        width: 210mm !important;
        height: 297mm !important;
        margin: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        break-after: page;
        page-break-after: always;
    }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .page, .page * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
}
</style>
</head>
<body>
    <div class="print-toolbar">
        <div>
            <strong>Випускні 2026 — A4 export</strong>
            <span>${_escH(pageCountText)} · один пакет = одна A4-сторінка</span>
        </div>
        <button type="button" onclick="window.print()">Друк / PDF</button>
    </div>
    ${packageSlug ? '' : `
    <div class="page cover-page">
        <div class="cover-icon">🎓</div>
        <div class="cover-title">Випускні 2026</div>
        <div class="cover-subtitle">Парк Закревського періоду</div>
        <div class="cover-divider"></div>
        <div class="cover-info">${packageRows.length} пакетних пропозицій для вашого класу</div>
        <div class="cover-contact">
            📞 (050) 344-37-71<br>
            📍 Київ, вул. Закревського 61/2<br>
            💬 @park_zakrevskogo
        </div>
    </div>`}
${packagePages}
${autoPrint ? `<script>
window.addEventListener('load', function() {
    var images = Array.from(document.images || []);
    Promise.all(images.map(function(img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function(resolve) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 1600);
        });
    })).then(function() {
        setTimeout(function() { window.print(); }, 300);
    });
});
</script>` : ''}
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        log.error('Catalog export error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
