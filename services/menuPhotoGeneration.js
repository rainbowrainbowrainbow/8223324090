/**
 * services/menuPhotoGeneration.js - menu/product photo prompt, OpenAI image generation,
 * and local CRM upload persistence.
 */
const { catalogImageStorageDescriptor, uploadFromUrl, makeFilename } = require('./imageStorage');

const MENU_IMAGE_DEFAULT_OPENAI_MODEL = 'gpt-image-1-mini';
const MENU_IMAGE_STUDIO_SIZES = new Set(['1536x1024', '1024x1024', '1024x1536']);
const MENU_IMAGE_STUDIO_LEGACY_SIZE_MAP = {
    '1536x864': '1536x1024',
    '1024x576': '1536x1024'
};
const MENU_IMAGE_STUDIO_STYLES = new Set(['catalog', 'realistic', 'clean-dark']);

function getOpenAIApiBase() {
    return String(process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function resolveMenuImageOpenAIModel() {
    const configured = process.env.OPENAI_MENU_IMAGE_MODEL
        || process.env.OPENAI_IMAGE_MODEL
        || MENU_IMAGE_DEFAULT_OPENAI_MODEL;
    return String(configured || MENU_IMAGE_DEFAULT_OPENAI_MODEL).trim().replace(/^openai\//i, '') || MENU_IMAGE_DEFAULT_OPENAI_MODEL;
}

function requireMenuImageOpenAIKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        const err = new Error('OPENAI_API_KEY is not configured');
        err.code = 'openai_not_configured';
        err.status = 503;
        throw err;
    }
    return key;
}

function cleanNullableString(value, maxLength) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function pickProductField(product, snakeName, camelName) {
    if (product && product[snakeName] !== undefined && product[snakeName] !== null) return product[snakeName];
    if (product && product[camelName] !== undefined && product[camelName] !== null) return product[camelName];
    return null;
}

function normalizeMenuImageSize(value) {
    const raw = String(value || '').trim();
    const mapped = MENU_IMAGE_STUDIO_LEGACY_SIZE_MAP[raw] || raw;
    return MENU_IMAGE_STUDIO_SIZES.has(mapped) ? mapped : '1536x1024';
}

function normalizeMenuImageStyle(value) {
    const raw = String(value || '').trim();
    return MENU_IMAGE_STUDIO_STYLES.has(raw) ? raw : 'catalog';
}

function menuImageStyleInstruction(style) {
    const map = {
        catalog: 'Clean commercial menu catalog photo, appetizing food styling, bright but natural colors, dark neutral CRM-friendly background.',
        realistic: 'Photorealistic restaurant food photography, natural light, real ingredients visible, no exaggerated effects.',
        'clean-dark': 'Premium food photo on a clean dark slate background, high contrast, polished CRM card composition.'
    };
    return map[normalizeMenuImageStyle(style)] || map.catalog;
}

function menuImageAllergenLabels(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => {
                if (item && typeof item === 'object') return item.label || item.name || item.value || item.key || '';
                return item;
            })
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .join(', ');
    }
    return String(value || '').split(/[,;\n]/).map(item => item.trim()).filter(Boolean).join(', ');
}

function buildMenuImagePrompt(product = {}, options = {}) {
    const size = normalizeMenuImageSize(options.size);
    const style = normalizeMenuImageStyle(options.style);
    const allergens = menuImageAllergenLabels(product.allergens || []);
    const price = Number(pickProductField(product, 'price', 'price') || pickProductField(product, 'legacy_price', 'legacyPrice') || 0);
    const lines = [
        `Menu item: ${pickProductField(product, 'name', 'name') || pickProductField(product, 'label', 'label') || pickProductField(product, 'code', 'code') || pickProductField(product, 'id', 'id') || 'Untitled menu item'}`,
        pickProductField(product, 'code', 'code') ? `CRM code: ${pickProductField(product, 'code', 'code')}` : '',
        pickProductField(product, 'kitchen_type', 'kitchenType') ? `Type: ${pickProductField(product, 'kitchen_type', 'kitchenType')}` : '',
        pickProductField(product, 'menu_section', 'menuSection') ? `Menu section: ${pickProductField(product, 'menu_section', 'menuSection')}` : '',
        pickProductField(product, 'serving_unit', 'servingUnit') ? `Serving unit: ${pickProductField(product, 'serving_unit', 'servingUnit')}` : '',
        pickProductField(product, 'weight_value', 'weightValue') ? `Weight/output: ${pickProductField(product, 'weight_value', 'weightValue')}` : '',
        price > 0 ? `Price in CRM: ${price} UAH` : '',
        pickProductField(product, 'ingredients', 'ingredients') ? `Ingredients: ${pickProductField(product, 'ingredients', 'ingredients')}` : '',
        pickProductField(product, 'short_description', 'shortDescription') ? `Short description: ${pickProductField(product, 'short_description', 'shortDescription')}` : '',
        pickProductField(product, 'description', 'description') ? `Description: ${pickProductField(product, 'description', 'description')}` : '',
        allergens ? `Known allergens: ${allergens}` : '',
        pickProductField(product, 'tech_card', 'techCard') ? `Kitchen tech notes: ${pickProductField(product, 'tech_card', 'techCard')}` : '',
        `Target size: ${size}`,
        `Style preset: ${style}`,
        menuImageStyleInstruction(style),
        'Create one product catalog photo for a Ukrainian children entertainment center CRM.',
        'Clean commercial restaurant menu photo, appetizing but realistic, centered dish, useful at small card size.',
        'Horizontal CRM menu card crop, dish fully visible, no text, no logo, no watermark, no people, no hands, no packaging.',
        'Do not invent labels or decorations. If details are unknown, keep presentation generic and realistic.'
    ];
    return lines.filter(Boolean).join('\n');
}

async function generateMenuImageWithOpenAI({ prompt, size, style } = {}) {
    const apiKey = requireMenuImageOpenAIKey();
    const model = resolveMenuImageOpenAIModel();
    const normalizedSize = normalizeMenuImageSize(size);
    const body = {
        model,
        prompt,
        n: 1,
        size: normalizedSize
    };

    if (/^gpt-image-/i.test(model)) {
        body.quality = 'medium';
        body.output_format = 'png';
        body.background = 'opaque';
        body.moderation = 'auto';
    } else {
        body.response_format = 'b64_json';
    }

    const response = await fetch(`${getOpenAIApiBase()}/images/generations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const safeDetail = detail ? `: ${detail.slice(0, 500)}` : '';
        const err = new Error(`OpenAI menu image generation failed (${response.status})${safeDetail}`);
        err.code = response.status === 429 ? 'openai_rate_limited' : 'openai_menu_image_failed';
        err.status = response.status;
        throw err;
    }

    const payload = await response.json();
    const image = payload?.data?.[0] || {};
    const b64 = image.b64_json || image.image_base64 || image.b64;
    const imageUrl = cleanNullableString(image.url, 2000);
    if (!b64 && !imageUrl) {
        const err = new Error('OpenAI menu image generation returned no image data');
        err.code = 'openai_menu_image_empty';
        err.status = 502;
        throw err;
    }
    return {
        model,
        provider: 'openai',
        size: normalizedSize,
        style: normalizeMenuImageStyle(style),
        sourceUrl: b64 ? `data:image/png;base64,${b64}` : imageUrl,
        revisedPrompt: cleanNullableString(image.revised_prompt || image.revisedPrompt, 5000)
    };
}

function buildMenuImageFilename(product = {}) {
    const label = product.code || product.name || product.label || product.id || 'menu-dish';
    return makeFilename('menu', label, 'png');
}

async function generateAndStoreMenuPhotoDraft(product = {}, options = {}) {
    const size = normalizeMenuImageSize(options.size);
    const style = normalizeMenuImageStyle(options.style);
    const prompt = cleanNullableString(options.prompt, 5000) || buildMenuImagePrompt(product, { size, style });
    const uploadOptions = options.uploadOptions || {};

    try {
        const generation = await generateMenuImageWithOpenAI({ prompt, size, style });
        const savedUrl = await uploadFromUrl(generation.sourceUrl, buildMenuImageFilename(product), uploadOptions);
        if (!savedUrl) {
            const err = new Error('Generated image could not be saved to CRM uploads');
            err.code = 'menu_image_upload_failed';
            err.status = 502;
            throw err;
        }

        return {
            version: 1,
            status: 'ready',
            source: 'openai',
            imageUrl: savedUrl,
            prompt: generation.revisedPrompt || prompt,
            provider: generation.provider,
            model: generation.model,
            size: generation.size,
            style: generation.style,
            generatedAt: new Date().toISOString(),
            storage: {
                ...catalogImageStorageDescriptor(uploadOptions, savedUrl)
            },
            error: null
        };
    } catch (err) {
        err.prompt = err.prompt || prompt;
        err.size = err.size || size;
        err.style = err.style || style;
        throw err;
    }
}

module.exports = {
    MENU_IMAGE_STUDIO_SIZES,
    MENU_IMAGE_STUDIO_STYLES,
    MENU_IMAGE_STUDIO_LEGACY_SIZE_MAP,
    MENU_IMAGE_DEFAULT_OPENAI_MODEL,
    normalizeMenuImageSize,
    normalizeMenuImageStyle,
    buildMenuImagePrompt,
    generateMenuImageWithOpenAI,
    generateAndStoreMenuPhotoDraft,
    resolveMenuImageOpenAIModel
};
