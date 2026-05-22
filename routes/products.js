/**
 * routes/products.js — Product catalog API (v7.1: full CRUD)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth'); 
const { createLogger } = require('../utils/logger');

const log = createLogger('Products');

const PRODUCT_PRICE_JOIN = `
    SELECT p.*,
           pr.code AS price_rule_code,
           pr.name AS price_rule_name,
           pr.value AS price_rule_value,
           pr.unit AS price_rule_unit,
           pr.category AS price_rule_category,
           pr.updated_at AS price_rule_updated_at,
           pr.updated_by AS price_rule_updated_by
    FROM products p
    LEFT JOIN LATERAL (
        SELECT code, name, value, unit, category, updated_at, updated_by
        FROM price_rules pr
        WHERE pr.product_id = p.id
        ORDER BY pr.updated_at DESC NULLS LAST, pr.id DESC
        LIMIT 1
    ) pr ON true
`;

function buildProductPriceRuleCode(productId) {
    const rawId = String(productId || 'product');
    const slug = rawId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    const hash = crypto.createHash('sha1').update(rawId).digest('hex').slice(0, 8);
    return `prod_${slug.slice(0, 36)}_${hash}`;
}

function getProductPriceUnit(product) {
    if (product.domain === 'kitchen' && product.serving_unit) {
        return `грн/${product.serving_unit}`;
    }
    return product.is_per_child ? 'грн/дитина' : 'грн';
}

const SOURCE_DOCUMENT_KINDS = new Set(['google_doc', 'pdf', 'link']);
const PRODUCT_DOMAINS = new Set(['program', 'kitchen']);
const KITCHEN_TYPES = new Set(['cake', 'menu']);
const PRODUCT_AVAILABILITY_STATUSES = new Set(['active', 'draft', 'seasonal', 'sold_out', 'hidden']);

function pickField(body, camelName, snakeName, fallback = undefined) {
    if (body && Object.prototype.hasOwnProperty.call(body, camelName)) return body[camelName];
    if (body && Object.prototype.hasOwnProperty.call(body, snakeName)) return body[snakeName];
    return fallback;
}

function cleanNullableString(value, maxLength) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function normalizeProductPayload(body = {}) {
    const domainRaw = (cleanNullableString(pickField(body, 'domain', 'domain', 'program'), 30) || 'program').toLowerCase();
    const domain = PRODUCT_DOMAINS.has(domainRaw) ? domainRaw : 'program';
    const kitchenTypeRaw = (cleanNullableString(pickField(body, 'kitchenType', 'kitchen_type', null), 30) || '').toLowerCase();
    const categoryRaw = (cleanNullableString(body.category, 30) || '').toLowerCase();
    const kitchenType = domain === 'kitchen'
        ? (KITCHEN_TYPES.has(kitchenTypeRaw) ? kitchenTypeRaw : (categoryRaw === 'menu' ? 'menu' : 'cake'))
        : null;
    const availabilityRaw = (cleanNullableString(pickField(body, 'availabilityStatus', 'availability_status', 'active'), 30) || 'active').toLowerCase();
    const availabilityStatus = PRODUCT_AVAILABILITY_STATUSES.has(availabilityRaw)
        ? availabilityRaw
        : (body.isActive === false || body.is_active === false ? 'hidden' : 'active');

    return {
        ...body,
        domain,
        kitchenType,
        category: domain === 'kitchen' ? kitchenType : body.category,
        shortDescription: cleanNullableString(pickField(body, 'shortDescription', 'short_description', null), 1200),
        promoDescription: cleanNullableString(pickField(body, 'promoDescription', 'promo_description', null), 3000),
        ingredients: cleanNullableString(pickField(body, 'ingredients', 'ingredients', null), 4000),
        techCard: cleanNullableString(pickField(body, 'techCard', 'tech_card', null), 5000),
        menuSection: domain === 'kitchen' && kitchenType === 'menu'
            ? cleanNullableString(pickField(body, 'menuSection', 'menu_section', null), 120)
            : null,
        servingUnit: domain === 'kitchen'
            ? cleanNullableString(pickField(body, 'servingUnit', 'serving_unit', null), 60)
            : null,
        weightValue: domain === 'kitchen'
            ? cleanNullableString(pickField(body, 'weightValue', 'weight_value', null), 120)
            : null,
        priceVariantNote: domain === 'kitchen'
            ? cleanNullableString(pickField(body, 'priceVariantNote', 'price_variant_note', null), 2000)
            : null,
        availabilityStatus: domain === 'kitchen' ? availabilityStatus : 'active',
        cakeDecoration: domain === 'kitchen' && kitchenType === 'cake'
            ? cleanNullableString(pickField(body, 'cakeDecoration', 'cake_decoration', null), 3000)
            : null
    };
}

function normalizeSourceDocumentPayload(body, existing = {}) {
    const url = cleanNullableString(
        pickField(body, 'sourceDocumentUrl', 'source_document_url', existing.source_document_url),
        2000
    );
    const title = cleanNullableString(
        pickField(body, 'sourceDocumentTitle', 'source_document_title', existing.source_document_title),
        240
    );
    const kind = cleanNullableString(
        pickField(body, 'sourceDocumentKind', 'source_document_kind', existing.source_document_kind),
        30
    );

    if (!url) {
        return {
            fields: {
                url: null,
                title: null,
                kind: null,
                verifiedManual: false,
                cardMatchesDocument: false
            },
            errors: []
        };
    }

    const errors = [];
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('source_document_url must be http(s)');
    } catch {
        errors.push('source_document_url must be a valid URL');
    }

    if (!title) errors.push('source_document_title is required when document URL is set');
    if (!kind || !SOURCE_DOCUMENT_KINDS.has(kind)) {
        errors.push('source_document_kind must be google_doc, pdf, or link');
    }

    return {
        fields: {
            url,
            title,
            kind,
            verifiedManual: Boolean(pickField(body, 'sourceDocumentVerifiedManual', 'source_document_verified_manual', existing.source_document_verified_manual)),
            cardMatchesDocument: Boolean(pickField(body, 'sourceCardMatchesDocument', 'source_card_matches_document', existing.source_card_matches_document))
        },
        errors
    };
}

async function getProductWithPriceRule(client, id) {
    const result = await client.query(`${PRODUCT_PRICE_JOIN} WHERE p.id = $1`, [id]);
    return result.rows[0] || null;
}

async function upsertProductPriceRule(client, product, username) {
    const value = Number.parseInt(product.price, 10);
    const priceValue = Number.isFinite(value) && value >= 0 ? value : 0;
    const existing = await client.query(
        'SELECT code FROM price_rules WHERE product_id = $1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1',
        [product.id]
    );
    const code = existing.rows[0]?.code || buildProductPriceRuleCode(product.id);
    const description = `Центральна ціна для ${product.label || product.name || product.id}`;

    if (existing.rowCount > 0) {
        await client.query(
            `UPDATE price_rules
             SET name = $1,
                 value = $2,
                 unit = $3,
                 category = $4,
                 description = COALESCE(NULLIF(description, ''), $5),
                 updated_at = NOW(),
                 updated_by = $6
             WHERE code = $7`,
            [product.name, priceValue, getProductPriceUnit(product), product.category || 'product', description, username, code]
        );
        return code;
    }

    await client.query(
        `INSERT INTO price_rules (code, name, value, unit, category, description, product_id, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             value = EXCLUDED.value,
             unit = EXCLUDED.unit,
             category = EXCLUDED.category,
             description = COALESCE(NULLIF(price_rules.description, ''), EXCLUDED.description),
             product_id = COALESCE(price_rules.product_id, EXCLUDED.product_id),
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by
         WHERE price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id`,
        [code, product.name, priceValue, getProductPriceUnit(product), product.category || 'product', description, product.id, username]
    );
    return code;
}

// Map DB row to API response (snake_case -> camelCase)
function mapProductRow(row) {
    const hasCenterPrice = row.price_rule_code && row.price_rule_value !== null && row.price_rule_value !== undefined;
    const legacyPrice = row.price === null || row.price === undefined ? null : Number(row.price);
    const centerPrice = hasCenterPrice ? Number(row.price_rule_value) : null;
    return {
        id: row.id,
        code: row.code,
        label: row.label,
        name: row.name,
        icon: row.icon,
        category: row.category,
        duration: row.duration,
        price: hasCenterPrice ? centerPrice : legacyPrice,
        legacyPrice,
        priceSource: hasCenterPrice ? 'price_rules' : 'products',
        priceCode: row.price_rule_code || null,
        priceName: row.price_rule_name || null,
        priceUnit: row.price_rule_unit || null,
        priceCategory: row.price_rule_category || null,
        priceUpdatedAt: row.price_rule_updated_at || row.updated_at,
        priceUpdatedBy: row.price_rule_updated_by || row.updated_by,
        hosts: row.hosts,
        ageRange: row.age_range,
        kidsCapacity: row.kids_capacity,
        description: row.description,
        domain: row.domain || 'program',
        kitchenType: row.kitchen_type || null,
        shortDescription: row.short_description || null,
        promoDescription: row.promo_description || null,
        ingredients: row.ingredients || null,
        techCard: row.tech_card || null,
        menuSection: row.menu_section || null,
        servingUnit: row.serving_unit || null,
        weightValue: row.weight_value || null,
        priceVariantNote: row.price_variant_note || null,
        availabilityStatus: row.availability_status || (row.is_active === false ? 'hidden' : 'active'),
        cakeDecoration: row.cake_decoration || null,
        isPerChild: row.is_per_child,
        hasFiller: row.has_filler,
        isCustom: row.is_custom,
        isActive: row.is_active,
        sortOrder: row.sort_order,
        sourceDocumentUrl: row.source_document_url || null,
        sourceDocumentTitle: row.source_document_title || null,
        sourceDocumentKind: row.source_document_kind || null,
        sourceDocumentVerifiedManual: row.source_document_verified_manual === true,
        sourceCardMatchesDocument: row.source_card_matches_document === true,
        sourceDocumentLinkedAt: row.source_document_linked_at || null,
        sourceDocumentLinkedBy: row.source_document_linked_by || null,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
    };
}

// Validate product fields
function validateProduct(body) {
    const errors = [];
    if (!body.code || typeof body.code !== 'string' || body.code.length > 20) {
        errors.push('code is required (max 20 chars)');
    }
    if (!body.label || typeof body.label !== 'string' || body.label.length > 100) {
        errors.push('label is required (max 100 chars)');
    }
    if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
        errors.push('name is required (max 200 chars)');
    }
    if (!body.category || typeof body.category !== 'string') {
        errors.push('category is required');
    }
    if (body.domain && !PRODUCT_DOMAINS.has(body.domain)) {
        errors.push('domain must be program or kitchen');
    }
    if (body.domain === 'kitchen' && !KITCHEN_TYPES.has(body.kitchenType)) {
        errors.push('kitchenType must be cake or menu for kitchen products');
    }
    if (body.availabilityStatus && !PRODUCT_AVAILABILITY_STATUSES.has(body.availabilityStatus)) {
        errors.push('availabilityStatus must be active, draft, seasonal, sold_out, or hidden');
    }
    if (body.duration === undefined || body.duration === null || typeof body.duration !== 'number' || body.duration < 0) {
        errors.push('duration is required (non-negative number)');
    }
    if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
        errors.push('price must be a non-negative number');
    }
    if (body.hosts !== undefined && (typeof body.hosts !== 'number' || body.hosts < 0)) {
        errors.push('hosts must be a non-negative number');
    }
    return errors;
}

// GET /api/products — List all products (optional ?active=true filter)
// v39.8: Security — require authentication
router.use(authenticateToken);
router.get('/', async (req, res) => {
    try {
        const activeOnly = req.query.active === 'true';
        const domain = PRODUCT_DOMAINS.has(req.query.domain) ? req.query.domain : null;
        const kitchenTypeQuery = req.query.kitchenType || req.query.kitchen_type;
        const kitchenType = KITCHEN_TYPES.has(kitchenTypeQuery) ? kitchenTypeQuery : null;
        const menuSection = cleanNullableString(req.query.menuSection || req.query.menu_section, 120);
        const availabilityStatus = PRODUCT_AVAILABILITY_STATUSES.has(req.query.availabilityStatus || req.query.availability_status)
            ? (req.query.availabilityStatus || req.query.availability_status)
            : null;
        const where = [];
        const params = [];
        if (activeOnly) where.push('p.is_active = true');
        if (domain) {
            params.push(domain);
            where.push(`COALESCE(p.domain, 'program') = $${params.length}`);
        }
        if (kitchenType) {
            params.push(kitchenType);
            where.push(`p.kitchen_type = $${params.length}`);
        }
        if (menuSection) {
            params.push(menuSection);
            where.push(`p.menu_section = $${params.length}`);
        }
        if (availabilityStatus) {
            params.push(availabilityStatus);
            where.push(`COALESCE(p.availability_status, 'active') = $${params.length}`);
        }
        const query = `${PRODUCT_PRICE_JOIN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(p.domain, 'program'), p.category, p.menu_section NULLS LAST, p.sort_order LIMIT 1000`;
        const result = await pool.query(query, params);
        res.json(result.rows.map(mapProductRow));
    } catch (err) {
        log.error('List products error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/catalogs — Product-level catalog entry points backed by the existing catalog engine
router.get('/catalogs', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                cd.id,
                cd.name,
                cd.emoji,
                cd.description,
                COALESCE(cd.status, 'draft') AS status,
                GREATEST(COALESCE(cd.page_count, 0), COUNT(DISTINCT cp.id)::int) AS page_count,
                COUNT(DISTINCT ci.id)::int AS item_count,
                cd.sort_order
            FROM catalog_definitions cd
            LEFT JOIN catalog_pages cp
                ON cp.catalog_id = cd.id
               AND COALESCE(cp.is_active, true) = true
            LEFT JOIN catalog_items ci
                ON ci.catalog_id = cd.id
               AND COALESCE(ci.status, 'active') = 'active'
            WHERE COALESCE(cd.is_active, true) = true
            GROUP BY cd.id, cd.name, cd.emoji, cd.description, cd.status, cd.page_count, cd.sort_order
            ORDER BY
                CASE cd.id
                    WHEN 'graduation' THEN 0
                    WHEN 'pinyata' THEN 1
                    WHEN 'cake' THEN 2
                    WHEN 'menu' THEN 3
                    WHEN 'costume' THEN 4
                    ELSE 20
                END,
                cd.sort_order,
                cd.name
        `);

        const catalogs = result.rows.map(row => ({
            id: row.id,
            title: row.name || row.id,
            emoji: row.emoji || '📂',
            description: row.description || null,
            status: row.status || 'draft',
            pageCount: Number(row.page_count || 0),
            itemCount: Number(row.item_count || 0),
            source: row.id === 'graduation' ? 'graduation_catalog' : 'catalog_pages',
            href: row.id === 'graduation' ? '/designs#catalog-graduation' : `/designs#catalog-${encodeURIComponent(row.id)}`,
            secondaryHref: row.id === 'graduation' ? null : '/designs#catalogs',
            actionLabel: 'Відкрити каталог'
        }));

        if (!catalogs.some(catalog => catalog.id === 'graduation')) {
            const graduationCount = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM graduation_packages
                 WHERE COALESCE(is_active, true) = true`
            ).catch(() => ({ rows: [{ count: 0 }] }));

            catalogs.unshift({
                id: 'graduation',
                title: 'Випускні',
                emoji: '🎓',
                description: 'Конструктор і друкований каталог випускних програм.',
                status: 'ready',
                pageCount: Number(graduationCount.rows[0]?.count || 0),
                itemCount: Number(graduationCount.rows[0]?.count || 0),
                source: 'graduation_catalog',
                href: '/designs#catalog-graduation',
                secondaryHref: null,
                actionLabel: 'Відкрити каталог'
            });
        }

        res.json({ success: true, catalogs });
    } catch (err) {
        log.error('List product catalog entry points error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/products/:id — Get single product
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        const product = await getProductWithPriceRule(pool, id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(mapProductRow(product));
    } catch (err) {
        log.error('Get product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/products/:id/source-document — Link/unlink a manual source document
router.patch('/:id/source-document', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        const existing = await getProductWithPriceRule(pool, id);
        if (!existing) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const { fields, errors } = normalizeSourceDocumentPayload(req.body || {}, existing);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        await pool.query(
            `UPDATE products SET
                source_document_url = $1,
                source_document_title = $2,
                source_document_kind = $3,
                source_document_verified_manual = $4,
                source_card_matches_document = $5,
                source_document_linked_at = CASE
                    WHEN $1::text IS NULL THEN NULL
                    WHEN COALESCE(source_document_url, '') <> $1 THEN NOW()
                    ELSE COALESCE(source_document_linked_at, NOW())
                END,
                source_document_linked_by = CASE
                    WHEN $1::text IS NULL THEN NULL
                    WHEN COALESCE(source_document_url, '') <> $1 THEN $6
                    ELSE COALESCE(source_document_linked_by, $6)
                END,
                updated_at = NOW(),
                updated_by = $6
             WHERE id = $7`,
            [
                fields.url,
                fields.title,
                fields.kind,
                fields.verifiedManual,
                fields.cardMatchesDocument,
                req.user.username,
                id
            ]
        );

        const product = await getProductWithPriceRule(pool, id);
        log.info(`Product source document updated: ${id} by ${req.user.username}`);
        res.json(mapProductRow(product));
    } catch (err) {
        log.error('Update product source document error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products — Create new product (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const payload = normalizeProductPayload(req.body);
        const errors = validateProduct(payload);
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            code, label, name, icon, category, duration,
            price = 0, hosts = 1, ageRange, kidsCapacity,
            description, isPerChild = false, hasFiller = false,
            isCustom = false, sortOrder = 0, domain, kitchenType,
            shortDescription, promoDescription, ingredients, techCard,
            menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus,
            cakeDecoration
        } = payload;

        // Generate ID from code + timestamp
        const id = code.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '') + '_' + Date.now();

        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO products (id, code, label, name, icon, category, duration, price, hosts, age_range, kids_capacity, description, domain, kitchen_type, short_description, promo_description, ingredients, tech_card, menu_section, serving_unit, weight_value, price_variant_note, availability_status, cake_decoration, is_per_child, has_filler, is_custom, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
             RETURNING *`,
            [id, code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, domain, kitchenType, shortDescription, promoDescription, ingredients, techCard, menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus, cakeDecoration, isPerChild, hasFiller, isCustom, sortOrder, req.user.username]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id);
        await client.query('COMMIT');

        log.info(`Product created: ${id} by ${req.user.username}`);
        res.status(201).json(mapProductRow(product));
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Create product error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/products/:id — Update product (admin/manager)
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        await client.query('BEGIN');
        // Check product exists
        const existing = await client.query('SELECT id FROM products WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }

        const payload = normalizeProductPayload(req.body);
        const errors = validateProduct(payload);
        if (errors.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: errors.join('; ') });
        }

        const {
            code, label, name, icon, category, duration,
            price = 0, hosts = 1, ageRange, kidsCapacity,
            description, isPerChild = false, hasFiller = false,
            isCustom = false, isActive = true, sortOrder = 0, domain, kitchenType,
            shortDescription, promoDescription, ingredients, techCard,
            menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus,
            cakeDecoration
        } = payload;

        const result = await client.query(
            `UPDATE products SET
                code=$1, label=$2, name=$3, icon=$4, category=$5, duration=$6,
                price=$7, hosts=$8, age_range=$9, kids_capacity=$10, description=$11,
                domain=$12, kitchen_type=$13, short_description=$14, promo_description=$15,
                ingredients=$16, tech_card=$17, menu_section=$18, serving_unit=$19,
                weight_value=$20, price_variant_note=$21, availability_status=$22,
                cake_decoration=$23, is_per_child=$24, has_filler=$25, is_custom=$26,
                is_active=$27, sort_order=$28, updated_at=NOW(), updated_by=$29
             WHERE id=$30 RETURNING *`,
            [code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, domain, kitchenType, shortDescription, promoDescription, ingredients, techCard, menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus, cakeDecoration, isPerChild, hasFiller, isCustom, isActive, sortOrder, req.user.username, id]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id);
        await client.query('COMMIT');

        log.info(`Product updated: ${id} by ${req.user.username}`);
        res.json(mapProductRow(product));
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Update product error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/products/:id — Soft-delete (deactivate) product (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        const result = await pool.query(
            `UPDATE products SET is_active = false, updated_at = NOW(), updated_by = $1 WHERE id = $2 RETURNING *`,
            [req.user.username, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        log.info(`Product deactivated: ${id} by ${req.user.username}`);
        res.json({ success: true, product: mapProductRow(result.rows[0]) });
    } catch (err) {
        log.error('Delete product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v33.8.0: Product stock requirements (Integration 1)
// ==========================================

// GET /api/products/:id/stock-requirements
router.get('/:id/stock-requirements', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT psr.*, ws.name AS stock_name, ws.quantity AS current_qty, ws.unit
             FROM product_stock_requirements psr
             JOIN warehouse_stock ws ON ws.id = psr.stock_id
             WHERE psr.product_id = $1`,
            [req.params.id]
        );
        res.json({ success: true, requirements: r.rows });
    } catch (err) {
        log.error('Get stock requirements error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/products/:id/stock-requirements
router.post('/:id/stock-requirements', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { stockId, quantity } = req.body;
        if (!stockId || !quantity || quantity < 1)
            return res.status(400).json({ error: 'stockId і quantity (>0) required' });
        const r = await pool.query(
            `INSERT INTO product_stock_requirements (product_id, stock_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id, stock_id) DO UPDATE SET quantity = $3
             RETURNING *`,
            [req.params.id, stockId, quantity]
        );
        res.json({ success: true, requirement: r.rows[0] });
    } catch (err) {
        log.error('Create stock requirement error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/products/:id/stock-requirements/:stockId
router.delete('/:id/stock-requirements/:stockId', requireRole('admin', 'manager'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM product_stock_requirements WHERE product_id = $1 AND stock_id = $2',
            [req.params.id, parseInt(req.params.stockId)]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Delete stock requirement error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
