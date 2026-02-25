/**
 * routes/packages.js — Service packages + Feature flags
 * v18.3.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Packages');

// ==========================================
// PACKAGES
// ==========================================

// GET /api/packages — List all packages
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM packages WHERE is_active = true ORDER BY sort_order, id');
        res.json({ success: true, packages: result.rows });
    } catch (err) {
        log.error('GET / error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження пакетів' });
    }
});

// GET /api/packages/:code — Single package
router.get('/:code', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM packages WHERE code = $1', [req.params.code]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Пакет не знайдено' });
        }

        // Get features available for this package
        const flagsResult = await pool.query(
            "SELECT * FROM feature_flags WHERE package_min IS NULL OR package_min = $1 OR package_min IN (SELECT code FROM packages WHERE sort_order <= (SELECT sort_order FROM packages WHERE code = $1)) ORDER BY name",
            [req.params.code]
        );

        res.json({
            success: true,
            package: result.rows[0],
            features: flagsResult.rows
        });
    } catch (err) {
        log.error('GET /:code error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/packages — Create package (admin)
router.post('/', requireRole('admin'), async (req, res) => {
    try {
        const { code, name, description, price_monthly, features, sort_order } = req.body;
        if (!code || !name) {
            return res.status(400).json({ success: false, error: 'code та name обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO packages (code, name, description, price_monthly, features, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [code, name, description || null, price_monthly || 0,
             JSON.stringify(features || {}), sort_order || 0]
        );
        res.json({ success: true, package: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Пакет з таким кодом вже існує' });
        }
        log.error('POST / error', err);
        res.status(500).json({ success: false, error: 'Помилка створення' });
    }
});

// PUT /api/packages/:code — Update package (admin)
router.put('/:code', requireRole('admin'), async (req, res) => {
    try {
        const { name, description, price_monthly, features, is_active, sort_order } = req.body;
        const result = await pool.query(
            `UPDATE packages SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                price_monthly = COALESCE($3, price_monthly),
                features = COALESCE($4, features),
                is_active = COALESCE($5, is_active),
                sort_order = COALESCE($6, sort_order)
             WHERE code = $7 RETURNING *`,
            [name, description, price_monthly,
             features ? JSON.stringify(features) : null,
             is_active, sort_order, req.params.code]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        res.json({ success: true, package: result.rows[0] });
    } catch (err) {
        log.error('PUT /:code error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// ==========================================
// FEATURE FLAGS
// ==========================================

// GET /api/packages/flags/all — List all feature flags
router.get('/flags/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM feature_flags ORDER BY name');
        res.json({ success: true, flags: result.rows });
    } catch (err) {
        log.error('GET /flags/all error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// PUT /api/packages/flags/:code — Toggle feature flag (admin)
router.put('/flags/:code', requireRole('admin'), async (req, res) => {
    try {
        const { is_enabled } = req.body;
        const result = await pool.query(
            'UPDATE feature_flags SET is_enabled = $1, updated_at = NOW() WHERE code = $2 RETURNING *',
            [!!is_enabled, req.params.code]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Флаг не знайдено' });
        }
        log.info(`Feature flag "${req.params.code}" → ${is_enabled ? 'enabled' : 'disabled'}`);
        res.json({ success: true, flag: result.rows[0] });
    } catch (err) {
        log.error('PUT /flags/:code error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/packages/flags — Create feature flag (admin)
router.post('/flags', requireRole('admin'), async (req, res) => {
    try {
        const { code, name, description, is_enabled, package_min } = req.body;
        if (!code || !name) {
            return res.status(400).json({ success: false, error: 'code та name обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO feature_flags (code, name, description, is_enabled, package_min)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [code, name, description || null, !!is_enabled, package_min || null]
        );
        res.json({ success: true, flag: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Флаг з таким кодом вже існує' });
        }
        log.error('POST /flags error', err);
        res.status(500).json({ success: false, error: 'Помилка створення' });
    }
});

// ==========================================
// COMPARE — Package comparison table
// ==========================================
router.get('/compare/all', async (req, res) => {
    try {
        const packagesResult = await pool.query('SELECT * FROM packages WHERE is_active = true ORDER BY sort_order');
        const flagsResult = await pool.query('SELECT * FROM feature_flags ORDER BY name');

        const packages = packagesResult.rows;
        const flags = flagsResult.rows;

        // Build comparison: which flags are available in which packages
        const comparison = flags.map(flag => {
            const row = { code: flag.code, name: flag.name, description: flag.description };
            for (const pkg of packages) {
                if (!flag.package_min) {
                    row[pkg.code] = true; // Available in all packages
                } else {
                    const minPkg = packages.find(p => p.code === flag.package_min);
                    row[pkg.code] = minPkg ? pkg.sort_order >= minPkg.sort_order : false;
                }
            }
            return row;
        });

        res.json({ success: true, packages, flags, comparison });
    } catch (err) {
        log.error('GET /compare/all error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

module.exports = router;
