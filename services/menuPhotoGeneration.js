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
const MENU_IMAGE_PROVIDER_QUOTA_CODES = new Set([
    'insufficient_quota',
    'credit_balance_exhausted',
    'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
    'billing_hard_limit_reached'
]);
const MENU_IMAGE_PROVIDER_RATE_CODES = new Set(['rate_limit_exceeded', 'slow_down']);
const MENU_IMAGE_PROVIDER_ACCESS_CODES = new Set([
    'invalid_api_key',
    'invalid_api_key_provided',
    'insufficient_permissions',
    'permission_denied',
    'model_not_found',
    'model_access_denied',
    'organization_not_found',
    'project_not_found'
]);
const MENU_IMAGE_PROVIDER_CODES = new Set([
    ...MENU_IMAGE_PROVIDER_QUOTA_CODES,
    ...MENU_IMAGE_PROVIDER_RATE_CODES,
    ...MENU_IMAGE_PROVIDER_ACCESS_CODES,
    'server_is_overloaded',
    'moderation_blocked'
]);
const MENU_IMAGE_PROVIDER_TYPES = new Set([
    'insufficient_quota',
    'rate_limit_error',
    'authentication_error',
    'permission_error',
    'invalid_request_error',
    'service_unavailable_error',
    'image_generation_user_error',
    'server_error'
]);

function allowedProviderValue(value, allowed) {
    return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeMenuImageRequestId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function menuImageRetryAfterSeconds(value) {
    if (typeof value !== 'string' || !value || value.length > 128) return null;
    let seconds;
    if (/^\d{1,6}(?:\.\d{1,3})?$/.test(value)) {
        seconds = Math.ceil(Number(value));
    } else {
        const retryAt = Date.parse(value);
        if (!Number.isFinite(retryAt)) return null;
        seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    }
    return Number.isInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : null;
}

function classifyMenuImageProviderFailure(status, providerCode, providerType, hasProviderCode) {
    // Billing/usage codes take precedence: those 429s cannot recover by waiting.
    if (MENU_IMAGE_PROVIDER_QUOTA_CODES.has(providerCode) || providerType === 'insufficient_quota') {
        return 'openai_quota_exceeded';
    }
    if (status === 401 || status === 403 || MENU_IMAGE_PROVIDER_ACCESS_CODES.has(providerCode)) {
        return 'openai_access_unavailable';
    }
    if (status === 429) {
        return MENU_IMAGE_PROVIDER_RATE_CODES.has(providerCode)
            || (!hasProviderCode && providerType === 'rate_limit_error')
            ? 'openai_rate_limited'
            : 'openai_unknown_rate_limit';
    }
    if (status === 503 && providerCode === 'server_is_overloaded') {
        return 'openai_temporarily_unavailable';
    }
    return 'openai_menu_image_failed';
}

function menuImagePublicError(err) {
    const code = err?.code;
    const providerStatus = Number.isInteger(err?.providerStatus) ? err.providerStatus : err?.status;
    const requestId = safeMenuImageRequestId(err?.requestId);
    const base = { retryable: false, retryAfterSeconds: null, requestId };
    if (code === 'openai_not_configured') {
        return { ...base, status: 503, code, error: 'OPENAI_API_KEY is not configured' };
    }
    if (code === 'menu_image_upload_failed') {
        return { ...base, status: 502, code, error: 'Generated image could not be saved to CRM uploads' };
    }
    if (code === 'openai_quota_exceeded'
        || MENU_IMAGE_PROVIDER_QUOTA_CODES.has(err?.providerCode)
        || err?.providerType === 'insufficient_quota') {
        return { ...base, status: 429, code: 'menu_image_generation_quota_exceeded', error: 'Provider credits or account limits prevent menu image generation' };
    }
    if (code === 'openai_access_unavailable' || providerStatus === 401 || providerStatus === 403) {
        return { ...base, status: 503, code: 'menu_image_generation_unavailable', error: 'Menu image generation provider access is unavailable' };
    }
    if (code === 'openai_rate_limited') {
        return {
            ...base,
            status: 429,
            code: 'menu_image_generation_rate_limited',
            error: 'Menu image generation is temporarily rate limited',
            retryable: true,
            retryAfterSeconds: menuImageRetryAfterSeconds(String(err?.retryAfterSeconds ?? ''))
        };
    }
    if (code === 'openai_temporarily_unavailable') {
        return {
            ...base,
            status: 503,
            code: 'menu_image_generation_temporarily_unavailable',
            error: 'Menu image generation provider is temporarily unavailable',
            retryable: true,
            retryAfterSeconds: menuImageRetryAfterSeconds(String(err?.retryAfterSeconds ?? ''))
        };
    }
    if (code === 'openai_unknown_rate_limit' || providerStatus === 429) {
        return { ...base, status: 429, code: 'menu_image_generation_provider_rejected', error: 'Menu image generation was rejected by the provider' };
    }
    return { ...base, status: 502, code: 'menu_image_generation_failed', error: 'Menu image generation failed' };
}

function menuImageFailureDiagnostic(err) {
    const publicError = menuImagePublicError(err);
    return {
        providerStatus: Number.isInteger(err?.providerStatus) && err.providerStatus >= 100 && err.providerStatus <= 599
            ? err.providerStatus : null,
        providerCode: allowedProviderValue(err?.providerCode, MENU_IMAGE_PROVIDER_CODES),
        providerType: allowedProviderValue(err?.providerType, MENU_IMAGE_PROVIDER_TYPES),
        requestId: publicError.requestId,
        retryAfterSeconds: publicError.retryAfterSeconds,
        publicCode: publicError.code,
        retryable: publicError.retryable
    };
}

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
        const payload = await response.json().catch(() => null);
        const providerError = payload && typeof payload.error === 'object' && payload.error !== null
            ? payload.error : {};
        const hasProviderCode = typeof providerError.code === 'string' && providerError.code.length > 0;
        const providerCode = allowedProviderValue(providerError.code, MENU_IMAGE_PROVIDER_CODES);
        const providerType = allowedProviderValue(providerError.type, MENU_IMAGE_PROVIDER_TYPES);
        const code = classifyMenuImageProviderFailure(response.status, providerCode, providerType, hasProviderCode);
        const err = new Error(`OpenAI menu image generation failed (${response.status})`);
        err.code = code;
        err.status = response.status;
        err.providerStatus = response.status;
        err.providerCode = providerCode;
        err.providerType = providerType;
        err.requestId = safeMenuImageRequestId(response.headers?.get?.('x-request-id'));
        err.retryAfterSeconds = code === 'openai_rate_limited' || code === 'openai_temporarily_unavailable'
            ? menuImageRetryAfterSeconds(response.headers?.get?.('retry-after'))
            : null;
        throw err;
    }

    const payload = await response.json().catch(() => {
        const err = new Error('OpenAI menu image generation returned invalid JSON');
        err.code = 'openai_menu_image_invalid';
        err.status = 502;
        throw err;
    });
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
    resolveMenuImageOpenAIModel,
    menuImagePublicError,
    menuImageFailureDiagnostic
};
