/**
 * routes/products.js — Product catalog API (v7.1: full CRUD)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth'); 
const { createWriteRateLimiter } = require('../middleware/rateLimit');
const { createLogger } = require('../utils/logger');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest,
    requireBusinessContext,
    pushBusinessContextCondition,
    pushBusinessScopeCondition,
    resolveBusinessScope,
    requireBusinessScope,
    requireWritableBusinessScope
} = require('../services/businessContext');
const {
    PROGRAM_ICON_SETTINGS_KEY,
    PROGRAM_ICON_PROVIDER,
    PROGRAM_ICON_IMAGE_MODEL,
    PROGRAM_ICON_PROMPT_MODEL,
    PROGRAM_ICON_PROVIDER_OPTIONS,
    PROGRAM_ICON_IMAGE_MODEL_OPTIONS,
    DEFAULT_PROGRAM_ICON_SETTINGS,
    sanitizeProgramIconSettings,
    resolveProgramIconRuntime,
    buildDeterministicProgramIconPrompt,
    startProgramIconGeneration,
    pollProgramIconJob,
    persistProgramIconImage
} = require('../services/programIconGeneration');
const {
    buildProductPriceJoin,
    mapProductPriceFields,
    normalizePriceDate
} = require('../services/productPricing');
const {
    MENU_IMAGE_STUDIO_SIZES,
    MENU_IMAGE_STUDIO_STYLES,
    MENU_IMAGE_STUDIO_LEGACY_SIZE_MAP,
    normalizeMenuImageSize,
    normalizeMenuImageStyle,
    buildMenuImagePrompt,
    generateAndStoreMenuPhotoDraft,
    resolveMenuImageOpenAIModel
} = require('../services/menuPhotoGeneration');
const {
    buildMenuImageContext,
    createExternalMenuImageDraft,
    persistMenuImageDraft
} = require('../services/menuImageDrafts');

const log = createLogger('Products');

const PRODUCT_PRICE_JOIN = buildProductPriceJoin;
const MENU_AI_DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

function getOpenAIApiBase() {
    return String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function resolveMenuAiOpenAIModel() {
    const configured = process.env.OPENAI_MENU_AI_MODEL
        || process.env.OPENAI_ASSISTANT_MODEL
        || MENU_AI_DEFAULT_OPENAI_MODEL;
    return String(configured || MENU_AI_DEFAULT_OPENAI_MODEL).trim().replace(/^openai\//i, '') || MENU_AI_DEFAULT_OPENAI_MODEL;
}

function requireMenuAiOpenAIKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not configured');
    return key;
}

function extractOpenAIResponseText(response) {
    if (response && typeof response.output_text === 'string' && response.output_text.trim()) {
        return response.output_text.trim();
    }

    const chunks = [];
    for (const item of response?.output || []) {
        for (const content of item?.content || []) {
            if (typeof content?.text === 'string') chunks.push(content.text);
            if (typeof content?.output_text === 'string') chunks.push(content.output_text);
        }
    }
    return chunks.join('\n').trim();
}

async function generateMenuAiDraftWithOpenAI(prompt) {
    const apiKey = requireMenuAiOpenAIKey();
    const model = resolveMenuAiOpenAIModel();
    const response = await fetch(`${getOpenAIApiBase()}/responses`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            input: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ],
            temperature: 0.35,
            max_output_tokens: 1800,
            store: false
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const safeDetail = detail ? `: ${detail.slice(0, 300)}` : '';
        throw new Error(`OpenAI menu AI draft failed (${response.status})${safeDetail}`);
    }

    const payload = await response.json();
    const text = extractOpenAIResponseText(payload);
    if (!text) throw new Error('OpenAI menu AI draft returned empty response');
    return { text, model };
}

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
const PRODUCT_TECH_CARD_MODES = new Set(['simple', 'detailed']);
const PRODUCT_MUTATION_ROLES = ['admin', 'manager'];
const productMenuAiRateLimit = createWriteRateLimiter('product-menu-ai-draft', {
    windowMs: 60 * 1000,
    max: 12,
    methods: ['POST']
});
const productMenuImageRateLimit = createWriteRateLimiter('product-menu-image-generation', {
    windowMs: 60 * 1000,
    max: 4,
    methods: ['POST']
});
const productProgramIconRateLimit = createWriteRateLimiter('product-program-icon-generation', {
    windowMs: 60 * 1000,
    max: 6,
    methods: ['POST']
});
const MENU_AI_BLOCK_KEYS = ['nameDescription', 'allergens', 'ingredients', 'priceCost'];
const MENU_AI_BLOCK_KEY_SET = new Set(MENU_AI_BLOCK_KEYS);
const MENU_AI_STATUS_VALUES = new Set(['draft', 'needs_changes', 'approved', 'applied']);
const MENU_IMAGE_STATUS_VALUES = new Set(['draft', 'generating', 'ready', 'failed', 'approved', 'rejected', 'applied']);
const MENU_ALLERGEN_CATALOG = [
    { key: 'gluten', label: 'Глютен', aliases: ['пшениця', 'борошно', 'wheat'] },
    { key: 'milk', label: 'Молоко', aliases: ['молочні', 'лактоза', 'вершки', 'сир'] },
    { key: 'eggs', label: 'Яйця', aliases: ['яйце'] },
    { key: 'fish', label: 'Риба', aliases: ['лосось', 'тунець'] },
    { key: 'crustaceans', label: 'Ракоподібні', aliases: ['креветки', 'краб'] },
    { key: 'molluscs', label: 'Молюски', aliases: ['мідії', 'кальмар'] },
    { key: 'peanuts', label: 'Арахіс', aliases: ['peanut'] },
    { key: 'tree_nuts', label: 'Горіхи', aliases: ['мигдаль', 'фундук', 'волоський горіх'] },
    { key: 'soy', label: 'Соя', aliases: ['соєвий'] },
    { key: 'sesame', label: 'Кунжут', aliases: ['сезам'] },
    { key: 'mustard', label: 'Гірчиця', aliases: ['mustard'] },
    { key: 'celery', label: 'Селера', aliases: ['celery'] },
    { key: 'sulphites', label: 'Сульфіти', aliases: ['сульфіти', 'sulfites'] },
    { key: 'lupin', label: 'Люпин', aliases: ['lupin'] }
];

function requireProductBusinessContext(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    if (scope.mode !== 'single') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            requireWritableBusinessScope(req, res, scope);
        } else {
            res.status(400).json({
                success: false,
                error: 'This endpoint requires one active business context',
                code: 'single_business_required'
            });
        }
        return null;
    }
    const businessContext = businessContextFromRequest(req);
    if (!requireBusinessContext(req, res, businessContext)) return null;
    return businessContext;
}

function requireProductBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function normalizeProductIdentity(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function productDuplicateScope(product, businessContext) {
    return {
        businessContext: businessContext || DEFAULT_BUSINESS_CONTEXT,
        domain: product.domain || 'program',
        category: product.category || '',
        nameKey: normalizeProductIdentity(product.name)
    };
}

function productDuplicateLockKey(scope) {
    return [
        'products.active-name',
        scope.businessContext,
        scope.domain,
        scope.category,
        scope.nameKey
    ].join('|');
}

async function lockProductDuplicateScope(client, scope) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [productDuplicateLockKey(scope)]);
}

async function findActiveProductDuplicate(client, product, businessContext, options = {}) {
    if (product.isActive === false || product.is_active === false) return null;
    const scope = productDuplicateScope(product, businessContext);
    if (!scope.category || !scope.nameKey) return null;

    const params = [scope.businessContext, scope.domain, scope.category, scope.nameKey];
    const where = [
        `COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1`,
        "COALESCE(domain, 'program') = $2",
        'category = $3',
        "LOWER(REGEXP_REPLACE(TRIM(COALESCE(name, '')), '\\s+', ' ', 'g')) = $4",
        'COALESCE(is_active, true) = true'
    ];
    if (options.excludeId) {
        params.push(options.excludeId);
        where.push(`id <> $${params.length}`);
    }

    const result = await client.query(
        `SELECT id, code, name, category, domain
         FROM products
         WHERE ${where.join(' AND ')}
         ORDER BY created_at NULLS LAST, id
         LIMIT 1`,
        params
    );
    return result.rows[0] || null;
}

function duplicateProductError(duplicate) {
    const label = duplicate?.name || 'така назва';
    return `У цій категорії вже є активний продукт "${label}". Відкрийте існуючу картку або деактивуйте дубль перед створенням нового.`;
}

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

function safeJsonObject(value, fallback = {}) {
    if (!value) return { ...fallback };
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...fallback };
        } catch {
            return { ...fallback };
        }
    }
    return { ...fallback };
}

async function loadProgramIconSettings(db = pool) {
    try {
        const result = await db.query(
            'SELECT value FROM product_ai_settings WHERE key = $1 LIMIT 1',
            [PROGRAM_ICON_SETTINGS_KEY]
        );
        const { settings } = sanitizeProgramIconSettings(result.rows[0]?.value || DEFAULT_PROGRAM_ICON_SETTINGS);
        return settings;
    } catch (err) {
        log.warn(`Program icon settings fallback: ${err.message}`);
        return { ...DEFAULT_PROGRAM_ICON_SETTINGS };
    }
}

async function saveProgramIconSettings(settings, username) {
    const { settings: sanitized, errors } = sanitizeProgramIconSettings(settings);
    if (errors.length) return { settings: sanitized, errors };
    await pool.query(
        `INSERT INTO product_ai_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
        [PROGRAM_ICON_SETTINGS_KEY, JSON.stringify(sanitized), username]
    );
    return { settings: sanitized, errors: [] };
}

function requireProgramIconProduct(product) {
    if (!product) return { ok: false, status: 404, error: 'Product not found' };
    if ((product.domain || 'program') !== 'program') {
        return {
            ok: false,
            status: 400,
            error: 'AI icon generation is available only for entertainment programs'
        };
    }
    return { ok: true };
}

function productIconLockKey(businessContext, productId) {
    return ['products.program-icon', businessContext || DEFAULT_BUSINESS_CONTEXT, productId].join('|');
}

async function updateProgramIconFailed(productId, businessContext, username, errorMessage) {
    await pool.query(
        `UPDATE products
         SET icon_generation_status = 'failed',
             icon_last_error = $1,
             icon_job_id = NULL,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3
           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
        [cleanNullableString(errorMessage, 1000), username, productId, businessContext]
    );
}

function parseAIJsonObject(text) {
    const cleaned = String(text || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        return safeJsonObject(JSON.parse(cleaned));
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return {};
        try {
            return safeJsonObject(JSON.parse(match[0]));
        } catch {
            return {};
        }
    }
}

function knownMenuAllergen(value) {
    const identity = normalizeProductIdentity(value);
    if (!identity) return null;
    return MENU_ALLERGEN_CATALOG.find(item => (
        item.key === identity
        || normalizeProductIdentity(item.label) === identity
        || (item.aliases || []).some(alias => normalizeProductIdentity(alias) === identity)
    )) || null;
}

function normalizeAllergenList(value, options = {}) {
    const includeReason = options.includeReason === true;
    const source = options.source || null;
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
    const seen = new Set();
    const normalized = [];

    for (const rawItem of rawItems.slice(0, 40)) {
        const sourceObject = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
        const rawLabel = sourceObject.label || sourceObject.name || sourceObject.value || sourceObject.key || rawItem;
        const label = cleanNullableString(rawLabel, 80);
        if (!label) continue;
        const known = knownMenuAllergen(sourceObject.key || label);
        const identity = normalizeProductIdentity(known?.label || label);
        const key = known?.key || `custom:${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const item = {
            key,
            label: known?.label || label
        };
        const reason = cleanNullableString(sourceObject.reason || sourceObject.note || sourceObject.notes, 220);
        if (includeReason && reason) item.reason = reason;
        if (source) item.source = source;
        normalized.push(item);
        if (normalized.length >= 20) break;
    }

    return normalized;
}

function inferAllergensFromText(text) {
    const value = normalizeProductIdentity(text);
    const inferred = [];
    const rules = [
        ['gluten', /борошн|пшен|хліб|булк|тіст|паста|макарон|паніров/i],
        ['milk', /молок|вершк|сир|масл|йогурт|сметан|моцарел|пармезан/i],
        ['eggs', /яйц|омлет|майонез/i],
        ['fish', /риб|лосос|тунец|оселед/i],
        ['crustaceans', /кревет|краб|рак/i],
        ['peanuts', /арах/i],
        ['tree_nuts', /горіх|мигд|фундук|кешью|волоськ/i],
        ['soy', /соєв|соя|тофу/i],
        ['sesame', /кунжут|сезам/i],
        ['mustard', /гірчиц/i],
        ['celery', /селер/i],
        ['sulphites', /сульфіт|вино|оцет/i]
    ];
    for (const [key, regex] of rules) {
        if (regex.test(value)) {
            const known = MENU_ALLERGEN_CATALOG.find(item => item.key === key);
            if (known) inferred.push({ key: known.key, label: known.label, reason: 'Знайдено за складом/назвою у чернетці' });
        }
    }
    return normalizeAllergenList(inferred, { includeReason: true, source: 'fallback' });
}

function normalizeAiStatus(value, fallback = 'draft') {
    const status = String(value || fallback).trim().toLowerCase();
    return MENU_AI_STATUS_VALUES.has(status) ? status : fallback;
}

function normalizeMenuImageStatus(value, fallback = 'draft') {
    const status = String(value || fallback).trim().toLowerCase();
    return MENU_IMAGE_STATUS_VALUES.has(status) ? status : fallback;
}

function normalizeMenuAiBlock(key, block = {}) {
    const safeBlock = safeJsonObject(block);
    const proposal = safeJsonObject(safeBlock.proposal || safeBlock.data || safeBlock);
    return {
        key,
        status: normalizeAiStatus(safeBlock.status, safeBlock.approved ? 'approved' : 'draft'),
        proposal,
        feedback: cleanNullableString(safeBlock.feedback, 1000),
        approvedAt: safeBlock.approvedAt || safeBlock.approved_at || null,
        approvedBy: cleanNullableString(safeBlock.approvedBy || safeBlock.approved_by, 100),
        regeneratedAt: safeBlock.regeneratedAt || safeBlock.regenerated_at || null
    };
}

function normalizeMenuImageStudio(value = {}) {
    const raw = safeJsonObject(value);
    const imageUrl = cleanNullableString(raw.imageUrl || raw.image_url, 2000);
    const prompt = cleanNullableString(raw.prompt, 5000);
    const preparedAt = raw.preparedAt || raw.prepared_at || null;
    const generatedAt = raw.generatedAt || raw.generated_at || null;
    const approvedAt = raw.approvedAt || raw.approved_at || null;
    const appliedAt = raw.appliedAt || raw.applied_at || null;
    const rejectedAt = raw.rejectedAt || raw.rejected_at || null;
    const error = cleanNullableString(raw.error, 500);
    const status = normalizeMenuImageStatus(raw.status, 'draft');
    if (!imageUrl && !prompt && !preparedAt && !generatedAt && !approvedAt && !appliedAt && !rejectedAt && !error && status === 'draft') return {};
    return {
        version: 1,
        status,
        source: cleanNullableString(raw.source, 40) || 'products-menu',
        size: normalizeMenuImageSize(raw.size),
        style: normalizeMenuImageStyle(raw.style),
        imageUrl,
        prompt,
        preparedAt,
        generatedAt,
        approvedAt,
        approvedBy: cleanNullableString(raw.approvedBy || raw.approved_by, 100),
        appliedAt,
        appliedBy: cleanNullableString(raw.appliedBy || raw.applied_by, 100),
        previousImageUrl: cleanNullableString(raw.previousImageUrl || raw.previous_image_url, 2000),
        rejectedAt,
        rejectedBy: cleanNullableString(raw.rejectedBy || raw.rejected_by, 100),
        provider: cleanNullableString(raw.provider, 40),
        model: cleanNullableString(raw.model, 100),
        storage: safeJsonObject(raw.storage || {}),
        error
    };
}

function normalizeMenuAiDraft(value = {}, options = {}) {
    const raw = safeJsonObject(value);
    const rawBlocks = safeJsonObject(raw.blocks || raw);
    const blocks = {};
    for (const key of MENU_AI_BLOCK_KEYS) {
        blocks[key] = normalizeMenuAiBlock(key, rawBlocks[key] || {});
    }
    return {
        version: 1,
        status: normalizeAiStatus(options.status || raw.status, 'draft'),
        source: cleanNullableString(options.source || raw.source, 40) || 'operator',
        aiAvailable: options.aiAvailable === undefined ? raw.aiAvailable !== false : options.aiAvailable === true,
        generatedAt: options.generatedAt || raw.generatedAt || raw.generated_at || new Date().toISOString(),
        imageStudio: normalizeMenuImageStudio(options.imageStudio || raw.imageStudio || raw.image_studio || {}),
        blocks
    };
}

function normalizeMenuAiApprovedBlocks(value = {}, username = null) {
    const raw = safeJsonObject(value);
    const approved = {};
    for (const key of MENU_AI_BLOCK_KEYS) {
        const block = safeJsonObject(raw[key]);
        if (!Object.keys(block).length) continue;
        approved[key] = {
            key,
            status: 'approved',
            approvedAt: block.approvedAt || block.approved_at || new Date().toISOString(),
            approvedBy: cleanNullableString(block.approvedBy || block.approved_by || username, 100),
            data: safeJsonObject(block.data || block.proposal || block)
        };
    }
    return approved;
}

function scoreWarehouseCandidate(label, item) {
    const needle = normalizeProductIdentity(label);
    const haystack = normalizeProductIdentity(item.name);
    if (!needle || !haystack) return 0;
    if (needle === haystack) return 100;
    if (haystack.includes(needle)) return 88;
    if (needle.includes(haystack)) return 78;
    const tokens = needle.split(/\s+/).filter(token => token.length > 2);
    if (!tokens.length) return 0;
    const overlap = tokens.filter(token => haystack.includes(token)).length;
    return Math.round((overlap / tokens.length) * 70);
}

function mapWarehouseCandidate(item, score = 0) {
    return {
        stockId: item.id,
        id: item.id,
        name: item.name,
        unit: item.unit || null,
        quantity: Number(item.quantity || 0),
        minQuantity: Number(item.min_quantity || 0),
        locationName: item.location_name || null,
        purchaseUnitPrice: Number(item.purchase_unit_price || 0),
        lastOrderPrice: Number(item.last_order_price || 0),
        score
    };
}

function findWarehouseCandidates(label, warehouseItems = []) {
    return warehouseItems
        .map(item => ({ item, score: scoreWarehouseCandidate(label, item) }))
        .filter(entry => entry.score >= 45)
        .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'uk'))
        .slice(0, 5)
        .map(entry => mapWarehouseCandidate(entry.item, entry.score));
}

function normalizeMenuAiIngredient(row = {}, index = 0, warehouseItems = []) {
    const stockId = toOptionalInt(row.stockId || row.stock_id || row.warehouseStockId || row.warehouse_stock_id || row.suggestedStockId);
    const knownStock = stockId ? warehouseItems.find(item => Number(item.id) === stockId) : null;
    const rawLabel = row.label || row.name || row.ingredientLabel || row.ingredient_label || row.possibleWarehouseName || knownStock?.name || '';
    const label = cleanNullableString(rawLabel, 255);
    const quantity = toPositiveInt(row.quantityPerUnit || row.quantity_per_unit || row.quantity || row.grams || row.amount) || 1;
    const unit = cleanNullableString(row.unit || (row.grams ? 'г' : knownStock?.unit), 30) || 'г';
    const notes = cleanNullableString(row.notes || row.note || row.reason, 1000);
    const candidates = findWarehouseCandidates(label || knownStock?.name, warehouseItems);
    const exactCandidate = candidates.find(candidate => candidate.score >= 95);
    return {
        stockId: knownStock ? stockId : (exactCandidate ? exactCandidate.stockId : null),
        label: label || exactCandidate?.name || '',
        quantity,
        unit,
        notes,
        sortOrder: toPositiveInt(row.sortOrder || row.sort_order) || ((index + 1) * 10),
        warehouseCandidates: candidates
    };
}

function estimateMenuCostFromIngredients(ingredients = [], warehouseItems = []) {
    const byId = new Map(warehouseItems.map(item => [Number(item.id), item]));
    let total = 0;
    let covered = 0;
    for (const row of ingredients) {
        const item = byId.get(Number(row.stockId));
        const unitPrice = Number(item?.purchase_unit_price || item?.last_order_price || 0);
        if (!item || !unitPrice || normalizeProductIdentity(item.unit) !== normalizeProductIdentity(row.unit)) continue;
        total += Number(row.quantity || 0) * unitPrice;
        covered += 1;
    }
    return {
        estimatedCost: covered ? Math.round(total) : null,
        confidence: covered && covered === ingredients.length ? 'medium' : (covered ? 'low' : 'unknown'),
        note: covered
            ? 'Оцінка по складських цінах тільки для рядків з однаковими одиницями.'
            : 'Немає достатніх складських цін або збігів одиниць для надійної оцінки.'
    };
}

function buildMenuAiDraftFromRaw(raw = {}, context = {}) {
    const source = context.source || 'ai';
    const currentCard = safeJsonObject(context.currentCard);
    const warehouseItems = context.warehouseItems || [];
    const rawBlocks = safeJsonObject(raw.blocks || raw);
    const nameData = safeJsonObject(rawBlocks.nameDescription || raw.nameDescription);
    const ingredientsRaw = Array.isArray(rawBlocks.ingredients?.ingredients)
        ? rawBlocks.ingredients.ingredients
        : (Array.isArray(raw.ingredients) ? raw.ingredients : []);
    const normalizedIngredients = ingredientsRaw
        .map((row, index) => normalizeMenuAiIngredient(row, index, warehouseItems))
        .filter(row => row.label || row.stockId);
    const costEstimate = estimateMenuCostFromIngredients(normalizedIngredients, warehouseItems);
    const priceCostRaw = safeJsonObject(rawBlocks.priceCost || raw.priceCost);
    const fallbackAllergens = inferAllergensFromText([
        currentCard.name,
        currentCard.description,
        currentCard.shortDescription,
        currentCard.ingredients,
        normalizedIngredients.map(row => row.label).join(', ')
    ].filter(Boolean).join(' '));
    const rawAllergens = rawBlocks.allergens?.allergens || raw.allergens || currentCard.allergens || [];
    const allergenSource = Array.isArray(rawAllergens) && rawAllergens.length ? rawAllergens : fallbackAllergens;
    const proposedAllergens = normalizeAllergenList(
        allergenSource,
        { includeReason: true, source }
    );

    return normalizeMenuAiDraft({
        status: 'draft',
        source,
        aiAvailable: context.aiAvailable !== false,
        generatedAt: new Date().toISOString(),
        blocks: {
            nameDescription: {
                key: 'nameDescription',
                status: 'draft',
                proposal: {
                    name: cleanNullableString(nameData.name || currentCard.name, 200) || '',
                    description: cleanNullableString(nameData.description || currentCard.description, 1200) || '',
                    shortDescription: cleanNullableString(nameData.shortDescription || nameData.short_description || currentCard.shortDescription, 1200) || '',
                    promoDescription: cleanNullableString(nameData.promoDescription || nameData.promo_description || currentCard.promoDescription, 3000) || ''
                }
            },
            allergens: {
                key: 'allergens',
                status: 'draft',
                proposal: { allergens: proposedAllergens }
            },
            ingredients: {
                key: 'ingredients',
                status: 'draft',
                proposal: { ingredients: normalizedIngredients }
            },
            priceCost: {
                key: 'priceCost',
                status: 'draft',
                proposal: {
                    suggestedPrice: toPositiveInt(priceCostRaw.suggestedPrice || priceCostRaw.price || currentCard.price) || null,
                    estimatedCost: Number.isFinite(Number(priceCostRaw.estimatedCost)) ? Math.round(Number(priceCostRaw.estimatedCost)) : costEstimate.estimatedCost,
                    confidence: cleanNullableString(priceCostRaw.confidence, 30) || costEstimate.confidence,
                    priceVariantNote: cleanNullableString(priceCostRaw.priceVariantNote || priceCostRaw.price_variant_note || currentCard.priceVariantNote, 2000) || '',
                    note: cleanNullableString(priceCostRaw.note || costEstimate.note, 600) || costEstimate.note
                }
            }
        }
    }, { source, aiAvailable: context.aiAvailable !== false, status: 'draft' });
}

function buildFallbackMenuAiDraft(currentCard = {}, warehouseItems = []) {
    const existingRows = Array.isArray(currentCard.techCardRows) ? currentCard.techCardRows : [];
    const textRows = String(currentCard.ingredients || '')
        .split(/[,;\n]/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map(label => ({ label, quantity: 1, unit: 'г' }));
    return buildMenuAiDraftFromRaw({
        blocks: {
            nameDescription: currentCard,
            allergens: { allergens: normalizeAllergenList(currentCard.allergens, { includeReason: true }) },
            ingredients: { ingredients: existingRows.length ? existingRows : textRows },
            priceCost: {
                suggestedPrice: currentCard.price,
                priceVariantNote: currentCard.priceVariantNote,
                note: 'Fallback-чернетка з поточної форми, без AI-генерації.'
            }
        }
    }, { source: 'fallback', aiAvailable: false, currentCard, warehouseItems });
}

async function loadMenuAiWarehouseItems(client = pool, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const result = await client.query(
        `SELECT
            ws.id,
            ws.name,
            ws.category,
            ws.quantity,
            ws.min_quantity,
            ws.unit,
            ws.purchase_unit_price,
            c.last_order_price,
            wl.name AS location_name
         FROM warehouse_stock ws
         LEFT JOIN warehouse_locations wl
           ON wl.id = ws.location_id
          AND COALESCE(wl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
         LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
         WHERE ws.is_active = true
           AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
         ORDER BY
            CASE WHEN ws.category IN ('food', 'consumable') THEN 0 ELSE 1 END,
            ws.name
         LIMIT 250`,
        [businessContext]
    );
    return result.rows;
}

function buildMenuAiPrompt(currentCard, warehouseItems, blockKey, feedback) {
    const warehouseBrief = warehouseItems.slice(0, 120).map(item => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        purchaseUnitPrice: Number(item.purchase_unit_price || 0),
        lastOrderPrice: Number(item.last_order_price || 0)
    }));
    return {
        system: `Ти допомагаєш оператору Event Genix CRM заповнювати картку меню. Відповідай тільки валідним JSON без markdown. AI пропонує чернетку, оператор підтверджує вручну. Не вигадуй складські ID: використовуй тільки ID зі списку warehouseItems, якщо назва справді збігається. Якщо не впевнений, залиш stockId null і дай label.`,
        user: JSON.stringify({
            requestedBlock: blockKey,
            operatorFeedback: feedback || '',
            currentCard,
            warehouseItems: warehouseBrief,
            requiredShape: {
                blocks: {
                    nameDescription: {
                        name: 'string',
                        description: 'string',
                        shortDescription: 'string',
                        promoDescription: 'string'
                    },
                    allergens: {
                        allergens: [{ key: 'known_or_custom', label: 'string', reason: 'string' }]
                    },
                    ingredients: {
                        ingredients: [{ label: 'string', stockId: null, quantity: 100, unit: 'г', notes: 'string' }]
                    },
                    priceCost: {
                        suggestedPrice: 0,
                        estimatedCost: null,
                        confidence: 'low|medium|unknown',
                        priceVariantNote: 'string',
                        note: 'string'
                    }
                }
            }
        })
    };
}

function toOptionalInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function toPositiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeTechCardMode(value) {
    const mode = String(value || 'simple').trim().toLowerCase();
    return PRODUCT_TECH_CARD_MODES.has(mode) ? mode : 'simple';
}

function normalizeWastePercent(value) {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 500) return null;
    return Math.round(n * 100) / 100;
}

function mapTechCardIngredientRow(row) {
    const quantity = Number(row.quantity || 0);
    const wastePercent = Number(row.waste_percent || 0);
    const currentQty = row.current_qty === undefined || row.current_qty === null ? null : Number(row.current_qty);
    const minQty = row.min_quantity === undefined || row.min_quantity === null ? null : Number(row.min_quantity);
    return {
        id: row.id,
        productId: row.product_id,
        stockId: row.stock_id || null,
        warehouseStockId: row.stock_id || null,
        label: row.ingredient_label || row.stock_name || null,
        stockName: row.stock_name || null,
        quantityPerUnit: quantity,
        quantity,
        unit: row.unit || row.stock_unit || null,
        stockUnit: row.stock_unit || row.unit || null,
        wastePercent,
        notes: row.notes || null,
        sortOrder: row.sort_order || 100,
        currentQuantity: currentQty,
        minQuantity: minQty,
        locationId: row.location_id || null,
        locationName: row.location_name || null,
        preferredContractorId: row.preferred_contractor_id || null,
        preferredContractorName: row.preferred_contractor_name || null,
        isLinked: Boolean(row.stock_id),
        isActiveStock: row.stock_is_active !== false
    };
}

function buildTechCardProcurementSignals(rows) {
    return rows
        .filter(row => row.stock_id && row.current_qty !== null && row.current_qty !== undefined && Number(row.current_qty) <= Number(row.min_quantity || 0))
        .map(row => ({
            stockId: row.stock_id,
            name: row.stock_name || row.ingredient_label || `stock #${row.stock_id}`,
            currentQuantity: Number(row.current_qty || 0),
            minQuantity: Number(row.min_quantity || 0),
            deficit: Math.max(Number(row.min_quantity || 0) - Number(row.current_qty || 0), 1),
            unit: row.stock_unit || row.unit || null,
            locationId: row.location_id || null,
            locationName: row.location_name || null,
            contractorId: row.preferred_contractor_id || null,
            contractorName: row.preferred_contractor_name || null,
            source: 'kitchen_tech_card'
        }));
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
        techCardMode: normalizeTechCardMode(pickField(body, 'techCardMode', 'tech_card_mode', 'simple')),
        allergens: domain === 'kitchen' && kitchenType === 'menu'
            ? normalizeAllergenList(pickField(body, 'allergens', 'allergens', []))
            : [],
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

async function getProductWithPriceRule(client, id, businessContext = DEFAULT_BUSINESS_CONTEXT, options = {}) {
    const priceDate = normalizePriceDate(options.priceDate);
    const params = [id, businessContext];
    let priceJoin = PRODUCT_PRICE_JOIN();
    if (priceDate) {
        params.push(priceDate);
        priceJoin = PRODUCT_PRICE_JOIN(`$${params.length}`);
    }
    const result = await client.query(
        `${priceJoin} WHERE p.id = $1 AND COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
        params
    );
    return result.rows[0] || null;
}

async function getTechCardIngredientRows(client, productId, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const result = await client.query(
        `SELECT
            psr.id,
            psr.product_id,
            psr.stock_id,
            psr.quantity,
            psr.ingredient_label,
            psr.unit,
            psr.waste_percent,
            psr.notes,
            psr.sort_order,
            ws.name AS stock_name,
            ws.quantity AS current_qty,
            ws.min_quantity,
            ws.unit AS stock_unit,
            ws.is_active AS stock_is_active,
            ws.location_id,
            wl.name AS location_name,
            ws.preferred_contractor_id,
            c.name AS preferred_contractor_name
         FROM product_stock_requirements psr
         LEFT JOIN warehouse_stock ws ON ws.id = psr.stock_id AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
         LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id AND COALESCE(wl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
         LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
         WHERE psr.product_id = $1
         ORDER BY psr.sort_order, psr.id`,
        [productId, businessContext]
    );
    return result.rows;
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
function mapProductRow(row, options = {}) {
    const priceFields = mapProductPriceFields(row, options);
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        code: row.code,
        label: row.label,
        name: row.name,
        icon: row.icon,
        iconUrl: row.icon_url || null,
        iconGenerationStatus: row.icon_generation_status || 'idle',
        iconPromptSourceSnapshot: safeJsonObject(row.icon_prompt_source_snapshot || {}),
        iconLlmPromptOutput: row.icon_llm_prompt_output || null,
        iconFinalImagePrompt: row.icon_final_image_prompt || null,
        iconProvider: row.icon_provider || null,
        iconModel: row.icon_model || null,
        iconLastError: row.icon_last_error || null,
        iconGeneratedAt: row.icon_generated_at || null,
        iconJobId: row.icon_job_id || null,
        category: row.category,
        duration: row.duration,
        price: priceFields.price,
        legacyPrice: priceFields.legacyPrice,
        priceSource: priceFields.priceSource,
        priceCode: priceFields.priceCode,
        priceName: priceFields.priceName,
        priceUnit: priceFields.priceUnit,
        priceCategory: priceFields.priceCategory,
        priceRuleEffectiveFrom: priceFields.priceRuleEffectiveFrom,
        effectivePriceDate: priceFields.effectivePriceDate,
        priceUpdatedAt: priceFields.priceUpdatedAt,
        priceUpdatedBy: priceFields.priceUpdatedBy,
        nextPrice: priceFields.nextPrice,
        nextPriceCode: priceFields.nextPriceCode,
        nextPriceName: priceFields.nextPriceName,
        nextPriceUnit: priceFields.nextPriceUnit,
        nextPriceCategory: priceFields.nextPriceCategory,
        nextPriceFrom: priceFields.nextPriceFrom,
        nextPriceUpdatedAt: priceFields.nextPriceUpdatedAt,
        nextPriceUpdatedBy: priceFields.nextPriceUpdatedBy,
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
        techCardMode: row.tech_card_mode || 'simple',
        allergens: normalizeAllergenList(row.allergens || []),
        aiCardDraft: normalizeMenuAiDraft(row.ai_card_draft || {}, {
            source: row.ai_card_draft?.source || 'stored',
            status: row.ai_card_draft?.status || 'draft',
            aiAvailable: row.ai_card_draft?.aiAvailable !== false
        }),
        aiCardApprovedBlocks: normalizeMenuAiApprovedBlocks(row.ai_card_approved_blocks || {}, row.ai_card_reviewed_by || null),
        aiCardReviewedAt: row.ai_card_reviewed_at || null,
        aiCardReviewedBy: row.ai_card_reviewed_by || null,
        techCardIngredientCount: Number(row.tech_card_ingredient_count || 0),
        techCardLinkedIngredientCount: Number(row.tech_card_linked_ingredient_count || 0),
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
    if (body.techCardMode && !PRODUCT_TECH_CARD_MODES.has(body.techCardMode)) {
        errors.push('techCardMode must be simple or detailed');
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
        const businessScope = requireProductBusinessScope(req, res);
        if (!businessScope) return;
        const activeOnly = req.query.active === 'true';
        const domain = PRODUCT_DOMAINS.has(req.query.domain) ? req.query.domain : null;
        const kitchenTypeQuery = req.query.kitchenType || req.query.kitchen_type;
        const kitchenType = KITCHEN_TYPES.has(kitchenTypeQuery) ? kitchenTypeQuery : null;
        const menuSection = cleanNullableString(req.query.menuSection || req.query.menu_section, 120);
        const availabilityStatus = PRODUCT_AVAILABILITY_STATUSES.has(req.query.availabilityStatus || req.query.availability_status)
            ? (req.query.availabilityStatus || req.query.availability_status)
            : null;
        const rawPriceDate = req.query.priceDate || req.query.price_date || null;
        const priceDate = normalizePriceDate(rawPriceDate);
        if (rawPriceDate && !priceDate) {
            return res.status(400).json({ error: 'Invalid priceDate format' });
        }
        const where = [];
        const params = [];
        let priceDatePlaceholder = null;
        if (priceDate) {
            params.push(priceDate);
            priceDatePlaceholder = `$${params.length}`;
        }
        where.push(pushBusinessScopeCondition(params, businessScope, 'p'));
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
        const query = `${PRODUCT_PRICE_JOIN(priceDatePlaceholder)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(p.domain, 'program'), p.category, p.menu_section NULLS LAST, p.sort_order LIMIT 1000`;
        const result = await pool.query(query, params);
        res.json(result.rows.map(row => mapProductRow(row, { priceDate })));
    } catch (err) {
        log.error('List products error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/catalogs — Product-level catalog entry points backed by the existing catalog engine
router.get('/catalogs', async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        if (businessContext !== DEFAULT_BUSINESS_CONTEXT) {
            return res.json({ success: true, catalogs: [] });
        }
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

router.get('/program-icon-settings', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    try {
        const settings = await loadProgramIconSettings();
        const runtime = resolveProgramIconRuntime(settings);
        res.json({
            success: true,
            settings,
            defaults: DEFAULT_PROGRAM_ICON_SETTINGS,
            provider: runtime.provider,
            requestedProvider: runtime.requestedProvider,
            model: runtime.imageModel,
            promptModel: runtime.promptModel,
            providerReady: runtime.providerReady,
            keyStatus: runtime.keys,
            providerOptions: PROGRAM_ICON_PROVIDER_OPTIONS,
            imageModelOptions: PROGRAM_ICON_IMAGE_MODEL_OPTIONS
        });
    } catch (err) {
        log.error('Get program icon settings error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.put('/program-icon-settings', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    try {
        const result = await saveProgramIconSettings(req.body?.settings || req.body || {}, req.user.username);
        if (result.errors.length) {
            return res.status(400).json({ success: false, errors: result.errors, settings: result.settings });
        }
        res.json({ success: true, settings: result.settings });
    } catch (err) {
        log.error('Save program icon settings error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/products/:id — Get single product
// POST /api/products/menu-ai-draft — AI-assisted menu card draft, never canonical truth
router.post('/menu-ai-draft', productMenuAiRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const currentCard = safeJsonObject(req.body?.currentCard || req.body?.current_card);
        const incomingDraft = normalizeMenuAiDraft(req.body?.draft || {});
        const requestedBlock = req.body?.blockKey || req.body?.block_key || 'all';
        const blockKey = requestedBlock === 'all' || MENU_AI_BLOCK_KEY_SET.has(requestedBlock)
            ? requestedBlock
            : 'all';
        const feedback = cleanNullableString(req.body?.feedback, 1000);
        const warehouseItems = await loadMenuAiWarehouseItems(pool, businessContext);

        let generatedDraft;
        let aiAvailable = true;
        let generationSource = 'ai';
        let generationReason = null;
        let generationModel = null;
        try {
            const prompt = buildMenuAiPrompt(currentCard, warehouseItems, blockKey, feedback);
            const { text: raw, model } = await generateMenuAiDraftWithOpenAI(prompt);
            generationModel = model;
            generatedDraft = buildMenuAiDraftFromRaw(parseAIJsonObject(raw), {
                source: 'ai',
                aiAvailable: true,
                currentCard,
                warehouseItems
            });
        } catch (err) {
            aiAvailable = false;
            generationSource = 'fallback';
            generationReason = err.message || 'AI draft generation unavailable';
            generatedDraft = buildFallbackMenuAiDraft(currentCard, warehouseItems);
        }

        if (blockKey !== 'all') {
            const merged = normalizeMenuAiDraft(incomingDraft, {
                source: incomingDraft.source || generationSource,
                aiAvailable,
                status: 'draft'
            });
            merged.blocks[blockKey] = generatedDraft.blocks[blockKey];
            merged.blocks[blockKey].status = 'draft';
            merged.blocks[blockKey].feedback = feedback;
            merged.blocks[blockKey].regeneratedAt = new Date().toISOString();
            generatedDraft = merged;
        }

        generatedDraft.source = generationSource;
        generatedDraft.aiAvailable = aiAvailable;
        generatedDraft.generatedAt = new Date().toISOString();

        res.json({
            success: true,
            aiAvailable,
            source: generationSource,
            reason: generationReason,
            model: generationModel,
            draft: generatedDraft,
            warehouseCandidates: warehouseItems.slice(0, 120).map(item => mapWarehouseCandidate(item))
        });
    } catch (err) {
        log.error('Generate product menu AI draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

function requireMenuImageProduct(product) {
    if (!product) return { ok: false, status: 404, error: 'Product not found' };
    if (product.domain !== 'kitchen' || product.kitchen_type !== 'menu') {
        return {
            ok: false,
            status: 400,
            error: 'Image generation is available only for kitchen menu items'
        };
    }
    return { ok: true };
}

function currentMenuAiDraftForProduct(product = {}) {
    return normalizeMenuAiDraft(product.ai_card_draft || {}, {
        source: product.ai_card_draft?.source || 'stored',
        status: product.ai_card_draft?.status || 'draft',
        aiAvailable: product.ai_card_draft?.aiAvailable !== false
    });
}

function buildProductMenuImageDraft(product, imageStudioPatch = {}, options = {}) {
    const currentDraft = options.currentDraft || currentMenuAiDraftForProduct(product);
    const imageStudio = normalizeMenuImageStudio({
        ...(currentDraft.imageStudio || {}),
        ...imageStudioPatch
    });
    return normalizeMenuAiDraft({
        ...currentDraft,
        imageStudio
    }, {
        source: currentDraft.source || 'stored',
        status: currentDraft.status || 'draft',
        aiAvailable: currentDraft.aiAvailable !== false,
        generatedAt: currentDraft.generatedAt,
        imageStudio
    });
}

function menuImageDraftLockKey(businessContext, productId) {
    return ['products.menu-image-draft', businessContext || DEFAULT_BUSINESS_CONTEXT, productId].join('|');
}

function menuImagePublicError(err) {
    const message = String(err?.message || '');
    const openAiUnavailable = err?.code === 'openai_not_configured' || /OPENAI_API_KEY is not configured/i.test(message);
    if (openAiUnavailable) {
        return {
            status: 503,
            code: 'openai_not_configured',
            error: 'OPENAI_API_KEY is not configured'
        };
    }
    if (err?.code === 'menu_image_upload_failed') {
        return {
            status: 502,
            code: 'menu_image_upload_failed',
            error: 'Generated image could not be saved to CRM uploads'
        };
    }
    if (err?.status === 429 || err?.code === 'openai_rate_limited') {
        return {
            status: 429,
            code: 'menu_image_generation_rate_limited',
            error: 'Menu image generation is temporarily rate limited'
        };
    }
    return {
        status: 502,
        code: 'menu_image_generation_failed',
        error: 'Menu image generation failed'
    };
}

function menuImageExternalDraftPublicError(err) {
    const code = String(err?.code || '');
    const clientErrorCodes = new Set([
        'menu_image_payload_unsupported_field',
        'menu_image_source_required',
        'menu_image_source_conflict',
        'menu_image_source_invalid',
        'menu_image_source_forbidden',
        'menu_image_source_too_large',
        'menu_image_url_too_long'
    ]);
    if (clientErrorCodes.has(code)) {
        return {
            status: Number(err.status || 400),
            code,
            error: String(err.message || 'Invalid external menu image draft payload')
        };
    }
    if (code === 'menu_image_upload_failed') {
        return {
            status: 502,
            code,
            error: 'External menu image could not be saved to CRM uploads'
        };
    }
    return null;
}

async function persistProductMenuImageDraft(productId, businessContext, username, draft) {
    await pool.query(
        `UPDATE products
         SET ai_card_draft = $1::jsonb,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3
           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
        [JSON.stringify(draft), username, productId, businessContext]
    );
}

async function handleExternalMenuImageDraftRequest(req, res) {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;

        const product = await getProductWithPriceRule(pool, id, businessContext);
        const check = requireMenuImageProduct(product);
        if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });
        if (product.is_active === false || product.availability_status === 'hidden') {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const currentDraft = currentMenuAiDraftForProduct(product);
        const result = await createExternalMenuImageDraft({
            product,
            payload: req.body || {},
            actor: {
                username: req.user?.username,
                source: cleanNullableString(req.body?.source, 40) || 'products-menu-external'
            },
            currentDraft
        });
        await persistMenuImageDraft(pool, {
            productId: id,
            businessContext,
            username: req.user?.username,
            draft: result.draft
        });

        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            status: 'ready',
            provider: result.imageStudio.provider,
            model: result.imageStudio.model,
            imageUrl: result.imageStudio.imageUrl,
            prompt: result.imageStudio.prompt,
            draft: result.draft,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        const publicError = menuImageExternalDraftPublicError(err);
        if (publicError) {
            return res.status(publicError.status).json({
                success: false,
                error: publicError.error,
                code: publicError.code
            });
        }
        log.error('Create external product menu image draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

async function handleMenuImageDraftRequest(req, res) {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;

        const product = await getProductWithPriceRule(pool, id, businessContext);
        const check = requireMenuImageProduct(product);
        if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });

        const currentDraft = currentMenuAiDraftForProduct(product);
        const incomingSettings = safeJsonObject(req.body?.settings || req.body || {});
        const size = normalizeMenuImageSize(incomingSettings.size || currentDraft.imageStudio?.size);
        const style = normalizeMenuImageStyle(incomingSettings.style || currentDraft.imageStudio?.style);
        const prompt = buildMenuImagePrompt(product, { size, style });
        const preparedAt = new Date().toISOString();
        const generatingStudio = normalizeMenuImageStudio({
            ...currentDraft.imageStudio,
            version: 1,
            status: 'generating',
            source: 'openai',
            size,
            style,
            imageUrl: null,
            prompt,
            preparedAt: currentDraft.imageStudio?.preparedAt || preparedAt,
            generatedAt: null,
            provider: 'openai',
            model: resolveMenuImageOpenAIModel(),
            previousImageUrl: product.icon_url || null,
            error: null
        });
        const generatingDraft = buildProductMenuImageDraft(product, generatingStudio, { currentDraft });
        await persistProductMenuImageDraft(id, businessContext, req.user.username, generatingDraft);

        let imageStudio;
        try {
            imageStudio = await generateAndStoreMenuPhotoDraft(product, { size, style, prompt });
        } catch (err) {
            const publicError = menuImagePublicError(err);
            const failedStudio = normalizeMenuImageStudio({
                ...generatingStudio,
                status: 'failed',
                imageUrl: null,
                prompt: err.prompt || prompt,
                size: err.size || size,
                style: err.style || style,
                generatedAt: new Date().toISOString(),
                provider: generatingStudio.provider || 'openai',
                model: generatingStudio.model || resolveMenuImageOpenAIModel(),
                previousImageUrl: product.icon_url || null,
                error: publicError.error
            });
            const failedDraft = buildProductMenuImageDraft(product, failedStudio, { currentDraft });
            await persistProductMenuImageDraft(id, businessContext, req.user.username, failedDraft);
            const fresh = await getProductWithPriceRule(pool, id, businessContext).catch(() => null);
            return res.status(publicError.status).json({
                success: false,
                status: 'failed',
                error: publicError.error,
                code: publicError.code,
                draft: failedDraft,
                product: fresh ? mapProductRow(fresh) : null
            });
        }

        const readyStudio = normalizeMenuImageStudio({
            ...generatingStudio,
            ...imageStudio,
            status: 'ready',
            previousImageUrl: product.icon_url || null,
            error: null
        });
        const readyDraft = buildProductMenuImageDraft(product, readyStudio, { currentDraft });
        await persistProductMenuImageDraft(id, businessContext, req.user.username, readyDraft);

        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            status: 'ready',
            provider: readyStudio.provider,
            model: readyStudio.model,
            imageUrl: readyStudio.imageUrl,
            prompt: readyStudio.prompt,
            draft: readyDraft,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        log.error('Generate product menu image draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

// POST /api/products/:id/menu-image/draft - generate a reviewable menu image draft only
router.post('/:id/menu-image/draft', productMenuImageRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), handleMenuImageDraftRequest);

// POST /api/products/:id/menu-image/generate - compatibility alias; no immediate icon_url overwrite
router.post('/:id/menu-image/generate', productMenuImageRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), handleMenuImageDraftRequest);

// POST /api/products/:id/menu-image/external-draft - accept a ready uploaded image as a reviewable draft only
router.post('/:id/menu-image/external-draft', productMenuImageRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), handleExternalMenuImageDraftRequest);

// GET /api/products/:id/menu-image/context - safe product facts and image rules for external generation
router.get('/:id/menu-image/context', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, id, businessContext);
        const check = requireMenuImageProduct(product);
        if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });
        if (product.is_active === false || product.availability_status === 'hidden') {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const context = buildMenuImageContext(product);
        res.json({
            success: true,
            ...context
        });
    } catch (err) {
        log.error('Get product menu image context error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:id/menu-image/status', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, id, businessContext);
        const check = requireMenuImageProduct(product);
        if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });
        const draft = currentMenuAiDraftForProduct(product);
        res.json({
            success: true,
            status: draft.imageStudio?.status || 'draft',
            imageUrl: draft.imageStudio?.imageUrl || null,
            appliedImageUrl: product.icon_url || null,
            draft,
            product: mapProductRow(product)
        });
    } catch (err) {
        log.error('Get product menu image status error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/:id/menu-image/apply', productMenuImageRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    const businessContext = requireProductBusinessContext(req, res);
    if (!businessContext) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [menuImageDraftLockKey(businessContext, id)]);
        const locked = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [id, businessContext]
        );
        const product = locked.rows[0];
        const check = requireMenuImageProduct(product);
        if (!check.ok) {
            await client.query('ROLLBACK');
            return res.status(check.status).json({ success: false, error: check.error });
        }

        const currentDraft = currentMenuAiDraftForProduct(product);
        const imageStudio = currentDraft.imageStudio || {};
        if (!imageStudio.imageUrl) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'No ready menu image draft to apply',
                code: 'menu_image_draft_missing'
            });
        }
        if (!['ready', 'approved', 'applied'].includes(imageStudio.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Menu image draft is not ready to apply',
                code: 'menu_image_draft_not_ready'
            });
        }

        const now = new Date().toISOString();
        const alreadyApplied = product.icon_url === imageStudio.imageUrl && imageStudio.status === 'applied';
        const appliedStudio = normalizeMenuImageStudio({
            ...imageStudio,
            status: 'applied',
            approvedAt: imageStudio.approvedAt || now,
            approvedBy: imageStudio.approvedBy || req.user.username,
            appliedAt: alreadyApplied ? (imageStudio.appliedAt || now) : now,
            appliedBy: req.user.username,
            previousImageUrl: alreadyApplied ? (imageStudio.previousImageUrl || product.icon_url || null) : (product.icon_url || null),
            error: null
        });
        const draft = buildProductMenuImageDraft(product, appliedStudio, { currentDraft });
        await client.query(
            `UPDATE products
             SET icon_url = $1,
                 ai_card_draft = $2::jsonb,
                 updated_at = NOW(),
                 updated_by = $3
             WHERE id = $4
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5`,
            [appliedStudio.imageUrl, JSON.stringify(draft), req.user.username, id, businessContext]
        );
        await client.query('COMMIT');

        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            status: 'applied',
            imageUrl: appliedStudio.imageUrl,
            draft,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Apply product menu image draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/menu-image/reject', productMenuImageRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });

    const businessContext = requireProductBusinessContext(req, res);
    if (!businessContext) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [menuImageDraftLockKey(businessContext, id)]);
        const locked = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [id, businessContext]
        );
        const product = locked.rows[0];
        const check = requireMenuImageProduct(product);
        if (!check.ok) {
            await client.query('ROLLBACK');
            return res.status(check.status).json({ success: false, error: check.error });
        }

        const currentDraft = currentMenuAiDraftForProduct(product);
        const imageStudio = currentDraft.imageStudio || {};
        if (!Object.keys(imageStudio).length) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'No menu image draft to reject',
                code: 'menu_image_draft_missing'
            });
        }
        if (imageStudio.status === 'applied' && product.icon_url === imageStudio.imageUrl) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Applied menu image cannot be rejected; generate a new draft first',
                code: 'menu_image_already_applied'
            });
        }

        const rejectedStudio = normalizeMenuImageStudio({
            ...imageStudio,
            status: 'rejected',
            rejectedAt: new Date().toISOString(),
            rejectedBy: req.user.username,
            error: cleanNullableString(req.body?.reason, 500)
        });
        const draft = buildProductMenuImageDraft(product, rejectedStudio, { currentDraft });
        await client.query(
            `UPDATE products
             SET ai_card_draft = $1::jsonb,
                 updated_at = NOW(),
                 updated_by = $2
             WHERE id = $3
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
            [JSON.stringify(draft), req.user.username, id, businessContext]
        );
        await client.query('COMMIT');

        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            status: 'rejected',
            draft,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Reject product menu image draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/program-icon/generate', productProgramIconRateLimit, requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });
    let product;
    let startToken = null;
    const businessContext = requireProductBusinessContext(req, res);
    if (!businessContext) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [productIconLockKey(businessContext, id)]);
        const locked = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [id, businessContext]
        );
        product = locked.rows[0];
        const check = requireProgramIconProduct(product);
        if (!check.ok) {
            await client.query('ROLLBACK');
            return res.status(check.status).json({ success: false, error: check.error });
        }
        if (product.icon_generation_status === 'pending' && product.icon_job_id) {
            await client.query('ROLLBACK');
            const fresh = await getProductWithPriceRule(pool, id, businessContext);
            return res.json({
                success: true,
                status: 'pending',
                deduped: true,
                taskId: product.icon_job_id,
                product: mapProductRow(fresh)
            });
        }

        startToken = `starting:${crypto.randomUUID()}`;
        await client.query(
            `UPDATE products
             SET icon_generation_status = 'pending',
                 icon_job_id = $1,
                 icon_last_error = NULL,
                 updated_at = NOW(),
                 updated_by = $2
             WHERE id = $3
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
            [startToken, req.user.username, id, businessContext]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Prepare program icon generation error', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }

    try {
        const settings = await loadProgramIconSettings();
        const generation = await startProgramIconGeneration(product, settings);
        if (generation.done && generation.imageUrl) {
            const savedUrl = await persistProgramIconImage(product, generation.imageUrl);
            if (!savedUrl) {
                await updateProgramIconFailed(id, businessContext, req.user.username, 'Generated image could not be saved to CRM uploads').catch(() => {});
                const fresh = await getProductWithPriceRule(pool, id, businessContext);
                return res.status(502).json({
                    success: false,
                    done: true,
                    status: 'failed',
                    error: 'Generated image could not be saved to CRM uploads',
                    product: fresh ? mapProductRow(fresh) : null
                });
            }
            await pool.query(
                `UPDATE products
                 SET icon_url = $1,
                     icon_generation_status = 'succeeded',
                     icon_job_id = $2,
                     icon_prompt_source_snapshot = $3::jsonb,
                     icon_llm_prompt_output = $4,
                     icon_final_image_prompt = $5,
                     icon_provider = $6,
                     icon_model = $7,
                     icon_last_error = NULL,
                     icon_generated_at = NOW(),
                     updated_at = NOW(),
                     updated_by = $8
                 WHERE id = $9
                   AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $10
                   AND icon_job_id = $11`,
                [
                    savedUrl,
                    generation.taskId,
                    JSON.stringify({
                        ...generation.sourceSnapshot,
                        promptSource: generation.promptSource,
                        promptFallbackReason: generation.promptFallbackReason,
                        promptModel: generation.promptModel,
                        usage: generation.usage || null
                    }),
                    generation.llmPromptOutput,
                    generation.finalPrompt,
                    generation.provider,
                    generation.model,
                    req.user.username,
                    id,
                    businessContext,
                    startToken
                ]
            );
            const fresh = await getProductWithPriceRule(pool, id, businessContext);
            return res.json({
                success: true,
                done: true,
                status: 'succeeded',
                imageUrl: savedUrl,
                taskId: generation.taskId,
                promptSource: generation.promptSource,
                product: mapProductRow(fresh)
            });
        }
        await pool.query(
            `UPDATE products
             SET icon_generation_status = 'pending',
                 icon_job_id = $1,
                 icon_prompt_source_snapshot = $2::jsonb,
                 icon_llm_prompt_output = $3,
                 icon_final_image_prompt = $4,
                 icon_provider = $5,
                 icon_model = $6,
                 icon_last_error = $7,
                 updated_at = NOW(),
                 updated_by = $8
             WHERE id = $9
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $10
               AND icon_job_id = $11`,
            [
                generation.taskId,
                JSON.stringify({
                    ...generation.sourceSnapshot,
                    promptSource: generation.promptSource,
                    promptFallbackReason: generation.promptFallbackReason
                }),
                generation.llmPromptOutput,
                generation.finalPrompt,
                generation.provider,
                generation.model,
                generation.promptFallbackReason,
                req.user.username,
                id,
                businessContext,
                startToken
            ]
        );
        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            status: 'pending',
            taskId: generation.taskId,
            promptSource: generation.promptSource,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        log.error('Start program icon generation error', err);
        const settings = await loadProgramIconSettings();
        await updateProgramIconFailed(id, businessContext, req.user.username, err.message || 'Program icon generation failed').catch(() => {});
        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        const statusCode = err.code === 'provider_not_configured' ? 503 : 502;
        res.status(statusCode).json({
            success: false,
            error: err.message || 'Program icon generation failed',
            code: err.code || 'program_icon_generation_failed',
            fallbackPrompt: buildDeterministicProgramIconPrompt(product, settings),
            product: fresh ? mapProductRow(fresh) : null
        });
    }
});

router.get('/:id/program-icon/status', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const { id } = req.params;
    if (!id || id.length > 80) return res.status(400).json({ success: false, error: 'Invalid product ID' });
    const businessContext = requireProductBusinessContext(req, res);
    if (!businessContext) return;

    try {
        const product = await getProductWithPriceRule(pool, id, businessContext);
        const check = requireProgramIconProduct(product);
        if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });
        const mapped = mapProductRow(product);
        if (product.icon_generation_status !== 'pending' || !product.icon_job_id || String(product.icon_job_id).startsWith('starting:')) {
            return res.json({ success: true, done: product.icon_generation_status === 'succeeded', product: mapped });
        }

        const job = await pollProgramIconJob(product.icon_job_id);
        if (!job.done && !job.failed) {
            return res.json({
                success: true,
                done: false,
                status: 'pending',
                state: job.state,
                product: mapped
            });
        }

        if (job.failed) {
            await updateProgramIconFailed(id, businessContext, req.user.username, job.error || 'Image generation failed');
            const fresh = await getProductWithPriceRule(pool, id, businessContext);
            return res.json({
                success: false,
                done: true,
                status: 'failed',
                error: job.error || 'Image generation failed',
                product: mapProductRow(fresh)
            });
        }

        const savedUrl = await persistProgramIconImage(product, job.imageUrl);
        if (!savedUrl) {
            await updateProgramIconFailed(id, businessContext, req.user.username, 'Generated image could not be saved to CRM uploads');
            const fresh = await getProductWithPriceRule(pool, id, businessContext);
            return res.status(502).json({
                success: false,
                done: true,
                status: 'failed',
                error: 'Generated image could not be saved to CRM uploads',
                product: mapProductRow(fresh)
            });
        }
        const finalUrl = savedUrl;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [productIconLockKey(businessContext, id)]);
            const locked = await client.query(
                `SELECT id, icon_generation_status
                 FROM products
                 WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                 FOR UPDATE`,
                [id, businessContext]
            );
            if (!locked.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Product not found' });
            }
            if (locked.rows[0].icon_generation_status !== 'succeeded') {
                await client.query(
                    `UPDATE products
                     SET icon_url = $1,
                         icon_generation_status = 'succeeded',
                         icon_last_error = NULL,
                         icon_generated_at = NOW(),
                         updated_at = NOW(),
                         updated_by = $2
                     WHERE id = $3
                       AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
                    [finalUrl, req.user.username, id, businessContext]
                );
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
        const fresh = await getProductWithPriceRule(pool, id, businessContext);
        res.json({
            success: true,
            done: true,
            status: 'succeeded',
            imageUrl: finalUrl,
            product: mapProductRow(fresh)
        });
    } catch (err) {
        log.error('Poll program icon generation error', err);
        await updateProgramIconFailed(id, businessContext, req.user.username, err.message || 'Program icon polling failed').catch(() => {});
        const fresh = await getProductWithPriceRule(pool, id, businessContext).catch(() => null);
        res.status(err.code === 'provider_not_configured' ? 503 : 500).json({
            success: false,
            error: err.message || 'Internal server error',
            product: fresh ? mapProductRow(fresh) : null
        });
    }
});

// GET /api/products/:id/ai-card-draft — stored AI review state, separate from approved menu truth
router.get('/:id/ai-card-draft', async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, req.params.id, businessContext);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.json({
            success: true,
            product: mapProductRow(product),
            draft: normalizeMenuAiDraft(product.ai_card_draft || {}),
            approvedBlocks: normalizeMenuAiApprovedBlocks(product.ai_card_approved_blocks || {}, product.ai_card_reviewed_by || null)
        });
    } catch (err) {
        log.error('Get product menu AI draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/products/:id/ai-card-draft — persist human review/audit state only
router.put('/:id/ai-card-draft', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const existing = await getProductWithPriceRule(pool, id, businessContext);
        if (!existing) return res.status(404).json({ error: 'Product not found' });
        if (existing.domain !== 'kitchen' || existing.kitchen_type !== 'menu') {
            return res.status(400).json({ success: false, error: 'AI card review is available only for kitchen menu items' });
        }

        const draft = normalizeMenuAiDraft(req.body?.draft || {}, {
            status: normalizeAiStatus(req.body?.status, 'applied'),
            source: req.body?.source || req.body?.draft?.source || 'stored',
            aiAvailable: req.body?.draft?.aiAvailable !== false
        });
        const approvedBlocks = normalizeMenuAiApprovedBlocks(req.body?.approvedBlocks || req.body?.approved_blocks || {}, req.user.username);
        draft.status = normalizeAiStatus(req.body?.status, 'applied');

        const result = await pool.query(
            `UPDATE products
             SET ai_card_draft = $1::jsonb,
                 ai_card_approved_blocks = $2::jsonb,
                 ai_card_reviewed_at = NOW(),
                 ai_card_reviewed_by = $3,
                 updated_at = NOW(),
                 updated_by = $3
             WHERE id = $4 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
             RETURNING *`,
            [JSON.stringify(draft), JSON.stringify(approvedBlocks), req.user.username, id, businessContext]
        );

        res.json({
            success: true,
            product: mapProductRow(result.rows[0]),
            draft,
            approvedBlocks
        });
    } catch (err) {
        log.error('Save product menu AI draft error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        const rawPriceDate = req.query.priceDate || req.query.price_date || null;
        const priceDate = normalizePriceDate(rawPriceDate);
        if (rawPriceDate && !priceDate) {
            return res.status(400).json({ error: 'Invalid priceDate format' });
        }
        const product = await getProductWithPriceRule(pool, id, businessContext, { priceDate });
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json(mapProductRow(product, { priceDate }));
    } catch (err) {
        log.error('Get product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/products/:id/source-document — Link/unlink a manual source document
router.patch('/:id/source-document', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        const existing = await getProductWithPriceRule(pool, id, businessContext);
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
             WHERE id = $7 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $8`,
            [
                fields.url,
                fields.title,
                fields.kind,
                fields.verifiedManual,
                fields.cardMatchesDocument,
                req.user.username,
                id,
                businessContext
            ]
        );

        const product = await getProductWithPriceRule(pool, id, businessContext);
        log.info(`Product source document updated: ${id} by ${req.user.username}`);
        res.json(mapProductRow(product));
    } catch (err) {
        log.error('Update product source document error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/products — Create new product
router.post('/', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
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
            techCardMode, allergens,
            menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus,
            cakeDecoration
        } = payload;

        // Generate ID from code + timestamp
        const id = code.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '') + '_' + Date.now();

        await client.query('BEGIN');
        const duplicateScope = productDuplicateScope(payload, businessContext);
        await lockProductDuplicateScope(client, duplicateScope);
        const duplicate = await findActiveProductDuplicate(client, payload, businessContext);
        if (duplicate) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'PRODUCT_DUPLICATE_ACTIVE_SCOPE',
                duplicateProductId: duplicate.id,
                error: duplicateProductError(duplicate)
            });
        }

        const result = await client.query(
            `INSERT INTO products (id, business_context, code, label, name, icon, category, duration, price, hosts, age_range, kids_capacity, description, domain, kitchen_type, short_description, promo_description, ingredients, tech_card, tech_card_mode, allergens, menu_section, serving_unit, weight_value, price_variant_note, availability_status, cake_decoration, is_per_child, has_filler, is_custom, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
             RETURNING *`,
            [id, businessContext, code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, domain, kitchenType, shortDescription, promoDescription, ingredients, techCard, techCardMode, JSON.stringify(allergens || []), menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus, cakeDecoration, isPerChild, hasFiller, isCustom, sortOrder, req.user.username]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id, businessContext);
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

// PUT /api/products/:id — Update product
router.put('/:id', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        await client.query('BEGIN');
        // Check product exists
        const existing = await client.query(
            `SELECT id FROM products WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [id, businessContext]
        );
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
            techCardMode, allergens,
            menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus,
            cakeDecoration
        } = payload;

        const duplicateScope = productDuplicateScope(payload, businessContext);
        await lockProductDuplicateScope(client, duplicateScope);
        const duplicate = await findActiveProductDuplicate(client, payload, businessContext, { excludeId: id });
        if (duplicate) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                code: 'PRODUCT_DUPLICATE_ACTIVE_SCOPE',
                duplicateProductId: duplicate.id,
                error: duplicateProductError(duplicate)
            });
        }

        const result = await client.query(
            `UPDATE products SET
                code=$1, label=$2, name=$3, icon=$4, category=$5, duration=$6,
                price=$7, hosts=$8, age_range=$9, kids_capacity=$10, description=$11,
                domain=$12, kitchen_type=$13, short_description=$14, promo_description=$15,
                ingredients=$16, tech_card=$17, tech_card_mode=$18, allergens=$19::jsonb, menu_section=$20, serving_unit=$21,
                weight_value=$22, price_variant_note=$23, availability_status=$24,
                cake_decoration=$25, is_per_child=$26, has_filler=$27, is_custom=$28,
                is_active=$29, sort_order=$30, updated_at=NOW(), updated_by=$31
             WHERE id=$32 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $33 RETURNING *`,
            [code, label, name, icon || '', category, duration, price, hosts, ageRange || null, kidsCapacity || null, description || null, domain, kitchenType, shortDescription, promoDescription, ingredients, techCard, techCardMode, JSON.stringify(allergens || []), menuSection, servingUnit, weightValue, priceVariantNote, availabilityStatus, cakeDecoration, isPerChild, hasFiller, isCustom, isActive, sortOrder, req.user.username, id, businessContext]
        );
        await upsertProductPriceRule(client, result.rows[0], req.user.username);
        const product = await getProductWithPriceRule(client, id, businessContext);
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

// DELETE /api/products/:id — Soft-delete (deactivate) product
router.delete('/:id', requireRole(...PRODUCT_MUTATION_ROLES), async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        if (!id || id.length > 50) {
            return res.status(400).json({ error: 'Invalid product ID' });
        }

        const result = await pool.query(
            `UPDATE products
             SET is_active = false,
                 availability_status = 'hidden',
                 updated_at = NOW(),
                 updated_by = $1
             WHERE id = $2 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3 RETURNING *`,
            [req.user.username, id, businessContext]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        log.info(`Product deactivated: ${id} by ${req.user.username}`);
        res.json({ success: true, action: 'deactivated', product: mapProductRow(result.rows[0]) });
    } catch (err) {
        log.error('Delete product error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/products/:id/tech-card — detailed kitchen tech-card rows
router.get('/:id/tech-card', async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, req.params.id, businessContext);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const rows = await getTechCardIngredientRows(pool, req.params.id, businessContext);
        res.json({
            success: true,
            product: mapProductRow(product),
            techCard: {
                mode: product.tech_card_mode || 'simple',
                ingredients: rows.map(mapTechCardIngredientRow),
                procurementSignals: buildTechCardProcurementSignals(rows)
            }
        });
    } catch (err) {
        log.error('Get product tech card error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/products/:id/tech-card — switch simple/detailed mode and save structured ingredient rows
router.put('/:id/tech-card', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const mode = normalizeTechCardMode(pickField(req.body || {}, 'techCardMode', 'tech_card_mode', 'simple'));
        const hasIngredientPayload = Array.isArray(req.body?.ingredients);

        await client.query('BEGIN');
        const productResult = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [id, businessContext]
        );
        if (!productResult.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = productResult.rows[0];
        if (product.domain !== 'kitchen' || product.kitchen_type !== 'menu') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Detailed tech-card mode is available only for kitchen menu items' });
        }

        let normalizedRows = [];
        if (hasIngredientPayload) {
            const rawRows = req.body.ingredients || [];
            const stockIds = [...new Set(rawRows.map(row => toOptionalInt(row.stockId || row.stock_id || row.warehouseStockId || row.warehouse_stock_id)).filter(Boolean))];
            const stockRows = stockIds.length
                ? await client.query(
                    `SELECT ws.*, wl.name AS location_name, c.name AS preferred_contractor_name
                     FROM warehouse_stock ws
                     LEFT JOIN warehouse_locations wl
                       ON wl.id = ws.location_id
                      AND COALESCE(wl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                     LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
                     WHERE ws.id = ANY($1::int[])
                       AND ws.is_active = true
                       AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
                    [stockIds, businessContext]
                )
                : { rows: [] };
            const stockById = new Map(stockRows.rows.map(row => [Number(row.id), row]));
            const errors = [];

            normalizedRows = rawRows.map((row, index) => {
                const stockId = toOptionalInt(row.stockId || row.stock_id || row.warehouseStockId || row.warehouse_stock_id);
                const stock = stockId ? stockById.get(stockId) : null;
                const quantity = toPositiveInt(row.quantityPerUnit || row.quantity_per_unit || row.quantity);
                const label = cleanNullableString(row.label || row.ingredientLabel || row.ingredient_label, 255);
                const unit = cleanNullableString(row.unit, 30);
                const wastePercent = normalizeWastePercent(row.wastePercent ?? row.waste_percent);
                const notes = cleanNullableString(row.notes, 1000);
                const sortOrder = toPositiveInt(row.sortOrder || row.sort_order) || ((index + 1) * 10);

                if (stockId && !stock) errors.push(`Ingredient row ${index + 1}: linked warehouse item is inactive or missing`);
                if (!stockId && !label) errors.push(`Ingredient row ${index + 1}: warehouse item or fallback label is required`);
                if (!quantity) errors.push(`Ingredient row ${index + 1}: quantity must be a positive integer`);
                if (wastePercent === null) errors.push(`Ingredient row ${index + 1}: wastePercent must be between 0 and 500`);

                return {
                    stockId,
                    ingredientLabel: label || stock?.name || null,
                    quantity,
                    unit: unit || stock?.unit || null,
                    wastePercent: wastePercent === null ? 0 : wastePercent,
                    notes,
                    sortOrder
                };
            }).filter(row => row.stockId || row.ingredientLabel);

            if (mode === 'detailed' && normalizedRows.length === 0) {
                errors.push('Detailed tech-card mode requires at least one ingredient row');
            }
            if (errors.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: errors.join('; ') });
            }
        }

        await client.query(
            `UPDATE products
             SET tech_card_mode = $1,
                 updated_at = NOW(),
                 updated_by = $2
             WHERE id = $3 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4`,
            [mode, req.user.username, id, businessContext]
        );

        if (hasIngredientPayload) {
            await client.query('DELETE FROM product_stock_requirements WHERE product_id = $1', [id]);
            for (const row of normalizedRows) {
                await client.query(
                    `INSERT INTO product_stock_requirements (
                        product_id, stock_id, quantity, ingredient_label, unit,
                        waste_percent, notes, sort_order, updated_by, updated_at
                     )
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
                    [
                        id,
                        row.stockId,
                        row.quantity,
                        row.ingredientLabel,
                        row.unit,
                        row.wastePercent,
                        row.notes,
                        row.sortOrder,
                        req.user.username
                    ]
                );
            }
        }

        const savedRows = await getTechCardIngredientRows(client, id, businessContext);
        const savedProduct = await getProductWithPriceRule(client, id, businessContext);
        await client.query('COMMIT');
        res.json({
            success: true,
            product: mapProductRow(savedProduct),
            techCard: {
                mode,
                ingredients: savedRows.map(mapTechCardIngredientRow),
                procurementSignals: buildTechCardProcurementSignals(savedRows)
            }
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Update product tech card error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/products/:id/tech-card/write-off — explicit kitchen production/sale write-off
router.post('/:id/tech-card/write-off', requireRole('admin', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const units = toPositiveInt(req.body?.units || req.body?.quantity || req.body?.portions);
        const reason = cleanNullableString(req.body?.reason, 240) || 'Kitchen tech-card write-off';
        if (!units) return res.status(400).json({ success: false, error: 'units must be a positive integer' });

        await client.query('BEGIN');
        const productResult = await client.query(
            `SELECT *
             FROM products
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [id, businessContext]
        );
        if (!productResult.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Product not found' });
        }
        const product = productResult.rows[0];
        if (product.domain !== 'kitchen' || product.kitchen_type !== 'menu' || product.tech_card_mode !== 'detailed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Write-off requires a kitchen menu item in detailed tech-card mode' });
        }

        const ingredientRows = await client.query(
            `SELECT
                psr.*,
                ws.name AS stock_name,
                ws.quantity AS current_qty,
                ws.min_quantity,
                ws.unit AS stock_unit,
                ws.location_id,
                ws.is_active AS stock_is_active,
                wl.name AS location_name,
                ws.preferred_contractor_id,
                c.name AS preferred_contractor_name
             FROM product_stock_requirements psr
             LEFT JOIN warehouse_stock ws ON ws.id = psr.stock_id AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id AND COALESCE(wl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
             WHERE psr.product_id = $1
             ORDER BY psr.sort_order, psr.id`,
            [id, businessContext]
        );

        if (!ingredientRows.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Detailed tech-card has no ingredient rows' });
        }

        const incomplete = ingredientRows.rows.filter(row => !row.stock_id || row.stock_is_active !== true);
        if (incomplete.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'All ingredient rows must be linked to active warehouse stock before write-off',
                incomplete: incomplete.map(mapTechCardIngredientRow)
            });
        }

        const stockIds = [...new Set(ingredientRows.rows.map(row => Number(row.stock_id)))];
        await client.query(
            `SELECT id FROM warehouse_stock
             WHERE id = ANY($1::int[])
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [stockIds, businessContext]
        );
        const lockedIngredientRows = await client.query(
            `SELECT
                psr.*,
                ws.name AS stock_name,
                ws.quantity AS current_qty,
                ws.min_quantity,
                ws.unit AS stock_unit,
                ws.location_id,
                ws.is_active AS stock_is_active,
                wl.name AS location_name,
                ws.preferred_contractor_id,
                c.name AS preferred_contractor_name
             FROM product_stock_requirements psr
             JOIN warehouse_stock ws
               ON ws.id = psr.stock_id
              AND ws.is_active = true
              AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             LEFT JOIN warehouse_locations wl
               ON wl.id = ws.location_id
              AND COALESCE(wl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             LEFT JOIN contractors c ON c.id = ws.preferred_contractor_id
             WHERE psr.product_id = $1
             ORDER BY psr.sort_order, psr.id`,
            [id, businessContext]
        );
        if (lockedIngredientRows.rowCount !== ingredientRows.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Ingredient linkage changed before write-off; reload the tech-card and try again' });
        }

        const consumption = lockedIngredientRows.rows.map(row => {
            const baseQty = Number(row.quantity || 0) * units;
            const wasteMultiplier = 1 + (Number(row.waste_percent || 0) / 100);
            const totalQuantity = Math.ceil(baseQty * wasteMultiplier);
            return {
                row,
                stockId: row.stock_id,
                stockName: row.stock_name,
                quantityPerUnit: Number(row.quantity || 0),
                wastePercent: Number(row.waste_percent || 0),
                totalQuantity
            };
        });

        const invalid = consumption.filter(item => !Number.isInteger(item.totalQuantity) || item.totalQuantity <= 0);
        if (invalid.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Calculated ingredient consumption must be positive' });
        }

        const insufficient = consumption.filter(item => Number(item.row.current_qty || 0) < item.totalQuantity);
        if (insufficient.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Not enough warehouse stock for detailed tech-card write-off',
                insufficient: insufficient.map(item => ({
                    stockId: item.stockId,
                    name: item.stockName,
                    required: item.totalQuantity,
                    currentQuantity: Number(item.row.current_qty || 0),
                    unit: item.row.stock_unit || item.row.unit || null
                }))
            });
        }

        const consumed = [];
        for (const item of consumption) {
            const update = await client.query(
                `UPDATE warehouse_stock
                 SET quantity = quantity - $1,
                     updated_at = NOW(),
                     updated_by = $2
                 WHERE id = $3 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4
                 RETURNING id, name, quantity, min_quantity, unit, location_id`,
                [item.totalQuantity, req.user.username, item.stockId, businessContext]
            );
            const updatedStock = update.rows[0];
            const writeOffReason = `${reason}: ${product.name} x${units}`;

            await client.query(
                `INSERT INTO warehouse_history (stock_id, change, reason, created_by, business_context)
                 VALUES ($1, $2, $3, $4, $5)`,
                [item.stockId, -item.totalQuantity, writeOffReason, req.user.username, businessContext]
            );
            await client.query(
                `INSERT INTO warehouse_stock_movements (
                    warehouse_stock_id, movement_type, from_location_id, to_location_id,
                    quantity, reason, created_by, business_context
                 )
                 VALUES ($1, 'issue', $2, NULL, $3, $4, $5, $6)`,
                [item.stockId, item.row.location_id || null, item.totalQuantity, writeOffReason, req.user.username, businessContext]
            );

            consumed.push({
                stockId: item.stockId,
                name: updatedStock.name,
                quantity: item.totalQuantity,
                unit: updatedStock.unit,
                remainingQuantity: Number(updatedStock.quantity || 0),
                minQuantity: Number(updatedStock.min_quantity || 0),
                lowStock: Number(updatedStock.quantity || 0) <= Number(updatedStock.min_quantity || 0)
            });
        }

        const procurementSignals = consumed
            .filter(item => item.lowStock)
            .map(item => ({
                stockId: item.stockId,
                name: item.name,
                currentQuantity: item.remainingQuantity,
                minQuantity: item.minQuantity,
                deficit: Math.max(item.minQuantity - item.remainingQuantity, 1),
                unit: item.unit,
                source: 'kitchen_tech_card'
            }));

        await client.query('COMMIT');
        res.json({
            success: true,
            productId: id,
            productName: product.name,
            units,
            consumed,
            procurementSignals
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Product tech-card write-off error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ==========================================
// v33.8.0: Product stock requirements (Integration 1)
// ==========================================

// GET /api/products/:id/stock-requirements
router.get('/:id/stock-requirements', async (req, res) => {
    try {
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, req.params.id, businessContext);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const r = await pool.query(
            `SELECT
                psr.*,
                ws.name AS stock_name,
                ws.quantity AS current_qty,
                ws.min_quantity,
                ws.unit AS stock_unit,
                COALESCE(psr.unit, ws.unit) AS unit
             FROM product_stock_requirements psr
             LEFT JOIN warehouse_stock ws ON ws.id = psr.stock_id AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             JOIN products p ON p.id = psr.product_id
             WHERE psr.product_id = $1
               AND COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [req.params.id, businessContext]
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
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const { stockId, quantity } = req.body;
        const safeStockId = toOptionalInt(stockId);
        const safeQuantity = toPositiveInt(quantity);
        if (!safeStockId || !safeQuantity)
            return res.status(400).json({ error: 'stockId and quantity (>0) required' });
        const product = await getProductWithPriceRule(pool, req.params.id, businessContext);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const stock = await pool.query(
            `SELECT id, name, unit
             FROM warehouse_stock
             WHERE id = $1
               AND is_active = true
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [safeStockId, businessContext]
        );
        if (!stock.rowCount) return res.status(404).json({ error: 'Warehouse stock item not found' });
        const r = await pool.query(
            `INSERT INTO product_stock_requirements (
                product_id, stock_id, quantity, ingredient_label, unit, sort_order, updated_by, updated_at
             )
             VALUES ($1, $2, $3, $4, $5, 100, $6, NOW())
             ON CONFLICT (product_id, stock_id) DO UPDATE SET
                quantity = EXCLUDED.quantity,
                ingredient_label = EXCLUDED.ingredient_label,
                unit = EXCLUDED.unit,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
             RETURNING *`,
            [req.params.id, safeStockId, safeQuantity, stock.rows[0].name, stock.rows[0].unit, req.user.username]
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
        const businessContext = requireProductBusinessContext(req, res);
        if (!businessContext) return;
        const product = await getProductWithPriceRule(pool, req.params.id, businessContext);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        await pool.query(
            `DELETE FROM product_stock_requirements psr
             USING warehouse_stock ws
             WHERE psr.product_id = $1
               AND psr.stock_id = $2
               AND ws.id = psr.stock_id
               AND COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3`,
            [req.params.id, parseInt(req.params.stockId), businessContext]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Delete stock requirement error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
