const { pool } = require('../db');

const BURGER_BLUEPRINT_INSTRUCTIONS = 'Keep the same plate, camera angle, burger scale, lighting and framing across this business burger line. Show one burger with a portion of fries and ketchup in a small sauce cup. Change only the burger ingredients described for this product; do not copy the reference burger fillings.';
const CATALOG_IMAGE_PATH = /^\/uploads\/catalog-images\/items\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i;

function isBurgerMenuProduct(product = {}) {
    const facts = [product.name, product.label, product.menu_section, product.menuSection,
        product.kitchen_type, product.kitchenType].filter(Boolean).join(' ').toLowerCase();
    return /бургер|burger/.test(facts);
}

function burgerBlueprintKey(businessContext) {
    return `menu_image_blueprint:${businessContext}:burger`;
}

function normalizeBurgerBlueprint(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const imageUrl = String(value.imageUrl || '').trim();
    if (!CATALOG_IMAGE_PATH.test(imageUrl)) return null;
    return {
        family: 'burger',
        imageUrl,
        instructions: String(value.instructions || BURGER_BLUEPRINT_INSTRUCTIONS).trim().slice(0, 1000),
        sourceProductId: String(value.sourceProductId || '').slice(0, 80),
        updatedAt: value.updatedAt || null
    };
}

async function readBurgerBlueprint(businessContext, query = pool) {
    const result = await query.query('SELECT value FROM settings WHERE key = $1', [burgerBlueprintKey(businessContext)]);
    try { return normalizeBurgerBlueprint(JSON.parse(result.rows[0]?.value || 'null')); }
    catch { return null; }
}

async function saveBurgerBlueprint(businessContext, product, source, instructions, query = pool) {
    if (!isBurgerMenuProduct(product)) {
        throw Object.assign(new Error('Product is not in the burger line'), { status: 400, code: 'menu_image_blueprint_product_invalid' });
    }
    const studio = product.ai_card_draft?.imageStudio || product.aiCardDraft?.imageStudio || {};
    const imageUrl = source === 'draft' && ['ready', 'approved', 'applied'].includes(studio.status)
        ? studio.imageUrl : source === 'current' ? (product.icon_url || product.iconUrl) : null;
    if (!CATALOG_IMAGE_PATH.test(String(imageUrl || ''))) {
        throw Object.assign(new Error('Choose a saved CRM menu photo as the reference'),
            { status: 400, code: 'menu_image_blueprint_image_invalid' });
    }
    const text = String(instructions || '').trim();
    if (!text || text.length > 1000) {
        throw Object.assign(new Error('Blueprint instructions must be 1–1000 characters'),
            { status: 400, code: 'menu_image_blueprint_instructions_invalid' });
    }
    const blueprint = normalizeBurgerBlueprint({
        imageUrl, instructions: text, sourceProductId: product.id,
        updatedAt: new Date().toISOString()
    });
    await query.query(`INSERT INTO settings (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [burgerBlueprintKey(businessContext), JSON.stringify(blueprint)]);
    return blueprint;
}

function publicBurgerBlueprintUrl(blueprint) {
    if (!blueprint?.imageUrl) return null;
    const configured = process.env.PUBLIC_BASE_URL || process.env.CRM_PUBLIC_URL || process.env.APP_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
    let origin;
    try { origin = new URL(configured); }
    catch { origin = null; }
    if (!origin || origin.protocol !== 'https:' || origin.username || origin.password
        || !/^[A-Za-z0-9.-]+$/.test(origin.hostname)) {
        throw Object.assign(new Error('Public CRM URL is unavailable for the image reference'),
            { status: 503, code: 'menu_image_reference_unavailable' });
    }
    return new URL(blueprint.imageUrl, origin.origin).href;
}

module.exports = {
    BURGER_BLUEPRINT_INSTRUCTIONS,
    isBurgerMenuProduct,
    normalizeBurgerBlueprint,
    readBurgerBlueprint,
    saveBurgerBlueprint,
    publicBurgerBlueprintUrl
};
