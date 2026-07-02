/**
 * Shared kitchen menu image context and external draft helpers.
 * This module never applies images to products.icon_url.
 */
const net = require('net');
const { uploadFromUrl, makeFilename } = require('./imageStorage');
const {
    MENU_IMAGE_STUDIO_SIZES,
    MENU_IMAGE_STUDIO_STYLES,
    normalizeMenuImageSize,
    normalizeMenuImageStyle,
    buildMenuImagePrompt
} = require('./menuPhotoGeneration');

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const DEFAULT_TARGET_USAGE = 'booking_menu_catalog';
const DEFAULT_MENU_IMAGE_SIZE = '1536x1024';
const DEFAULT_MENU_IMAGE_STYLE = 'catalog';
const MENU_IMAGE_STATUSES = new Set(['draft', 'generating', 'ready', 'failed', 'approved', 'rejected', 'applied']);
const ALLOWED_EXTERNAL_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const ALLOWED_EXTERNAL_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_EXTERNAL_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_EXTERNAL_IMAGE_BASE64_LENGTH = Math.ceil(MAX_EXTERNAL_IMAGE_BYTES * 4 / 3) + 128;
const MAX_EXTERNAL_IMAGE_URL_LENGTH = 2048;
const EXTERNAL_MENU_IMAGE_DRAFT_FIELDS = new Set([
    'businessContext',
    'business_context',
    'imageUrl',
    'image_url',
    'imageBase64',
    'image_base64',
    'mimeType',
    'mime_type',
    'imageMimeType',
    'image_mime_type',
    'prompt',
    'provider',
    'model',
    'size',
    'style',
    'source'
]);

const DEFAULT_IMAGE_RULES = Object.freeze({
    targetUsage: DEFAULT_TARGET_USAGE,
    defaultSize: DEFAULT_MENU_IMAGE_SIZE,
    styleRules: 'Clean commercial menu catalog photo, appetizing food styling, realistic dish, readable at small card size, no text, no logo, no watermark.',
    backgroundRules: 'Use a clean CRM-friendly food photography background. Keep the dish fully visible with natural light and enough contrast for a compact banquet menu card.',
    negativePrompt: 'No text, letters, logo, watermark, people, hands, packaging, fake labels, extreme shadows, cropped main dish, distorted food.'
});

function menuImageDraftError(status, code, message) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

function cleanNullableString(value, maxLength) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return maxLength ? text.slice(0, maxLength) : text;
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

function pickProductField(product, snakeName, camelName) {
    if (product && product[snakeName] !== undefined && product[snakeName] !== null) return product[snakeName];
    if (product && product[camelName] !== undefined && product[camelName] !== null) return product[camelName];
    return null;
}

function normalizeMenuImageStatus(value, fallback = 'draft') {
    const status = String(value || fallback).trim().toLowerCase();
    return MENU_IMAGE_STATUSES.has(status) ? status : fallback;
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
    if (!imageUrl && !prompt && !preparedAt && !generatedAt && !approvedAt && !appliedAt && !rejectedAt && !error && status === 'draft') {
        return {};
    }
    return {
        version: 1,
        status,
        source: cleanNullableString(raw.source, 40) || 'products-menu',
        imageUrl,
        prompt,
        provider: cleanNullableString(raw.provider, 40),
        model: cleanNullableString(raw.model, 100),
        size: normalizeMenuImageSize(raw.size),
        style: normalizeMenuImageStyle(raw.style),
        preparedAt,
        generatedAt,
        approvedAt,
        approvedBy: cleanNullableString(raw.approvedBy || raw.approved_by, 100),
        appliedAt,
        appliedBy: cleanNullableString(raw.appliedBy || raw.applied_by, 100),
        rejectedAt,
        rejectedBy: cleanNullableString(raw.rejectedBy || raw.rejected_by, 100),
        previousImageUrl: cleanNullableString(raw.previousImageUrl || raw.previous_image_url, 2000),
        storage: safeJsonObject(raw.storage || {}),
        error
    };
}

function currentMenuImageDraft(product = {}) {
    return safeJsonObject(product.ai_card_draft || product.aiCardDraft || {});
}

function buildMenuImageDraft(product = {}, imageStudioPatch = {}, options = {}) {
    const currentDraft = safeJsonObject(options.currentDraft || currentMenuImageDraft(product));
    const currentStudio = normalizeMenuImageStudio(currentDraft.imageStudio || currentDraft.image_studio || {});
    const imageStudio = normalizeMenuImageStudio({
        ...currentStudio,
        ...imageStudioPatch
    });
    return {
        ...currentDraft,
        version: Number(currentDraft.version || 1) || 1,
        status: cleanNullableString(currentDraft.status, 40) || 'draft',
        source: cleanNullableString(currentDraft.source, 40) || 'stored',
        aiAvailable: currentDraft.aiAvailable !== false,
        generatedAt: currentDraft.generatedAt || currentDraft.generated_at || new Date().toISOString(),
        imageStudio
    };
}

function getProductCurrentImageUrl(product = {}) {
    return cleanNullableString(
        pickProductField(product, 'icon_url', 'iconUrl')
        || pickProductField(product, 'image_url', 'imageUrl')
        || null,
        2000
    );
}

function getProductDraftImageUrl(product = {}) {
    const draft = currentMenuImageDraft(product);
    const imageStudio = normalizeMenuImageStudio(draft.imageStudio || draft.image_studio || {});
    return imageStudio.imageUrl || null;
}

function normalizeAllergens(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function buildMenuImageContext(product = {}, options = {}) {
    const allowedSizes = Array.from(MENU_IMAGE_STUDIO_SIZES);
    const allowedStyles = Array.from(MENU_IMAGE_STUDIO_STYLES);
    const defaultSize = normalizeMenuImageSize(options.defaultSize || DEFAULT_IMAGE_RULES.defaultSize);
    const defaultStyle = normalizeMenuImageStyle(options.defaultStyle || DEFAULT_MENU_IMAGE_STYLE);
    const price = Number(
        pickProductField(product, 'price', 'price')
        ?? pickProductField(product, 'legacy_price', 'legacyPrice')
        ?? 0
    );
    return {
        product: {
            id: cleanNullableString(pickProductField(product, 'id', 'id'), 120),
            code: cleanNullableString(pickProductField(product, 'code', 'code'), 120),
            name: cleanNullableString(
                pickProductField(product, 'name', 'name')
                || pickProductField(product, 'label', 'label')
                || pickProductField(product, 'code', 'code')
                || pickProductField(product, 'id', 'id'),
                220
            ),
            menuSection: cleanNullableString(pickProductField(product, 'menu_section', 'menuSection'), 120),
            shortDescription: cleanNullableString(pickProductField(product, 'short_description', 'shortDescription'), 1000),
            description: cleanNullableString(pickProductField(product, 'description', 'description'), 3000),
            ingredients: cleanNullableString(pickProductField(product, 'ingredients', 'ingredients'), 3000),
            techCard: cleanNullableString(pickProductField(product, 'tech_card', 'techCard'), 5000),
            weightValue: cleanNullableString(pickProductField(product, 'weight_value', 'weightValue'), 120),
            servingUnit: cleanNullableString(pickProductField(product, 'serving_unit', 'servingUnit'), 60),
            price: Number.isFinite(price) ? price : 0,
            allergens: normalizeAllergens(pickProductField(product, 'allergens', 'allergens')),
            currentImageUrl: getProductCurrentImageUrl(product),
            draftImageUrl: getProductDraftImageUrl(product)
        },
        imageRules: {
            targetUsage: cleanNullableString(options.targetUsage, 80) || DEFAULT_IMAGE_RULES.targetUsage,
            defaultSize,
            allowedSizes,
            defaultStyle,
            allowedStyles,
            styleRules: cleanNullableString(options.styleRules, 2000) || DEFAULT_IMAGE_RULES.styleRules,
            backgroundRules: cleanNullableString(options.backgroundRules, 2000) || DEFAULT_IMAGE_RULES.backgroundRules,
            negativePrompt: cleanNullableString(options.negativePrompt, 2000) || DEFAULT_IMAGE_RULES.negativePrompt
        }
    };
}

function normalizeImageMime(value) {
    const mime = String(value || 'image/png').trim().toLowerCase();
    return ALLOWED_EXTERNAL_IMAGE_MIMES.has(mime) ? mime : null;
}

function imageExtensionFromMime(mime) {
    if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    return 'png';
}

function imageExtensionFromUrl(url) {
    let pathname = '';
    try {
        pathname = new URL(url).pathname || '';
    } catch {
        return 'png';
    }
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (!match) return 'png';
    const ext = match[1].toLowerCase();
    if (!ALLOWED_EXTERNAL_IMAGE_EXTENSIONS.has(ext)) {
        throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageUrl extension is not supported');
    }
    return ext === 'jpeg' ? 'jpg' : ext;
}

function isBlockedExternalImageHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (/^\d+$/.test(host)) return true;

    const version = net.isIP(host);
    if (version === 4) {
        const parts = host.split('.').map(part => Number(part));
        const [a, b] = parts;
        return a === 0
            || a === 10
            || a === 127
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127)
            || a >= 224;
    }
    if (version === 6) {
        return host === '::'
            || host === '::1'
            || host.startsWith('fc')
            || host.startsWith('fd')
            || host.startsWith('fe80:')
            || host.startsWith('::ffff:127.')
            || host.startsWith('::ffff:10.')
            || host.startsWith('::ffff:192.168.');
    }

    return false;
}

function assertExternalImageUrlAllowed(imageUrl, options = {}) {
    if (options.allowPrivateNetwork) return;
    let parsed;
    try {
        parsed = new URL(imageUrl);
    } catch {
        throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageUrl is invalid');
    }
    if (isBlockedExternalImageHost(parsed.hostname)) {
        throw menuImageDraftError(400, 'menu_image_source_forbidden', 'imageUrl host is not allowed');
    }
}

function assertExternalDraftPayloadFields(payload = {}) {
    const safePayload = safeJsonObject(payload);
    const unsupported = Object.keys(safePayload).filter(key => !EXTERNAL_MENU_IMAGE_DRAFT_FIELDS.has(key));
    if (unsupported.length) {
        throw menuImageDraftError(
            400,
            'menu_image_payload_unsupported_field',
            `Unsupported field: ${unsupported[0]}`
        );
    }
    return safePayload;
}

function normalizeExternalImageSource(payload = {}, options = {}) {
    const imageUrl = cleanNullableString(payload.imageUrl || payload.image_url, null);
    const rawImageBase64 = cleanNullableString(payload.imageBase64 || payload.image_base64, null);
    if (imageUrl && rawImageBase64) {
        throw menuImageDraftError(400, 'menu_image_source_conflict', 'Provide either imageUrl or imageBase64, not both');
    }
    if (!imageUrl && !rawImageBase64) {
        throw menuImageDraftError(400, 'menu_image_source_required', 'imageUrl or imageBase64 is required');
    }

    if (imageUrl) {
        if (imageUrl.length > MAX_EXTERNAL_IMAGE_URL_LENGTH) {
            throw menuImageDraftError(400, 'menu_image_url_too_long', 'imageUrl is too long');
        }
        if (/^data:image\//i.test(imageUrl)) {
            throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageUrl must be http(s); use imageBase64 for image data');
        }
        if (!/^https?:\/\//i.test(imageUrl)) {
            throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageUrl must be http(s)');
        }
        const extension = imageExtensionFromUrl(imageUrl);
        assertExternalImageUrlAllowed(imageUrl, options);
        return {
            sourceUrl: imageUrl,
            sourceKind: 'url',
            extension
        };
    }

    const normalizedBase64 = rawImageBase64.replace(/\s+/g, '');
    if (normalizedBase64.length > MAX_EXTERNAL_IMAGE_BASE64_LENGTH) {
        throw menuImageDraftError(413, 'menu_image_source_too_large', 'imageBase64 is too large');
    }
    const dataUrlMatch = normalizedBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (dataUrlMatch) {
        const mime = normalizeImageMime(dataUrlMatch[1]);
        if (!mime) throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageBase64 MIME type is not supported');
        return {
            sourceUrl: `data:${mime};base64,${dataUrlMatch[2]}`,
            sourceKind: 'base64',
            extension: imageExtensionFromMime(mime)
        };
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) {
        throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageBase64 is invalid');
    }
    const mime = normalizeImageMime(payload.mimeType || payload.mime_type || payload.imageMimeType || payload.image_mime_type || 'image/png');
    if (!mime) throw menuImageDraftError(400, 'menu_image_source_invalid', 'imageBase64 MIME type is not supported');
    return {
        sourceUrl: `data:${mime};base64,${normalizedBase64}`,
        sourceKind: 'base64',
        extension: imageExtensionFromMime(mime)
    };
}

function menuImageFilename(product = {}, extension = 'png') {
    const label = pickProductField(product, 'code', 'code')
        || pickProductField(product, 'name', 'name')
        || pickProductField(product, 'label', 'label')
        || pickProductField(product, 'id', 'id')
        || 'menu-dish';
    return makeFilename('menu', label, extension);
}

function normalizeExternalDraftPayload(product = {}, payload = {}, options = {}) {
    const safePayload = assertExternalDraftPayloadFields(payload);
    const source = normalizeExternalImageSource(safePayload, options);
    const size = normalizeMenuImageSize(safePayload.size || options.defaultSize);
    const style = normalizeMenuImageStyle(safePayload.style || options.defaultStyle);
    const prompt = cleanNullableString(safePayload.prompt, 5000) || buildMenuImagePrompt(product, { size, style });
    const draftSource = cleanNullableString(safePayload.source, 40) || cleanNullableString(options.source, 40) || 'external';
    return {
        ...source,
        source: draftSource,
        prompt,
        provider: cleanNullableString(safePayload.provider, 40) || draftSource,
        model: cleanNullableString(safePayload.model, 100),
        size,
        style
    };
}

async function createExternalMenuImageDraft({ product = {}, payload = {}, actor = {}, uploadOptions = {}, now = new Date(), currentDraft } = {}) {
    const normalized = normalizeExternalDraftPayload(product, payload, {
        source: actor.source,
        allowPrivateNetwork: uploadOptions.allowPrivateNetwork === true
    });
    const securedUploadOptions = {
        ...uploadOptions,
        maxBytes: uploadOptions.maxBytes || uploadOptions.maxImageBytes || MAX_EXTERNAL_IMAGE_BYTES,
        allowedMimeTypes: uploadOptions.allowedMimeTypes || ALLOWED_EXTERNAL_IMAGE_MIMES,
        validateUrl: normalized.sourceKind === 'url'
            ? imageUrl => assertExternalImageUrlAllowed(imageUrl, {
                allowPrivateNetwork: uploadOptions.allowPrivateNetwork === true
            })
            : uploadOptions.validateUrl
    };
    const savedUrl = await uploadFromUrl(
        normalized.sourceUrl,
        menuImageFilename(product, normalized.extension),
        securedUploadOptions
    );
    if (!savedUrl) {
        throw menuImageDraftError(502, 'menu_image_upload_failed', 'External menu image could not be saved to CRM uploads');
    }

    const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const imageStudio = normalizeMenuImageStudio({
        version: 1,
        status: 'ready',
        source: normalized.source,
        imageUrl: savedUrl,
        prompt: normalized.prompt,
        provider: normalized.provider,
        model: normalized.model,
        size: normalized.size,
        style: normalized.style,
        generatedAt,
        previousImageUrl: getProductCurrentImageUrl(product),
        storage: {
            provider: 'local',
            publicUrl: savedUrl
        },
        error: null
    });
    const draft = buildMenuImageDraft(product, imageStudio, { currentDraft });
    return {
        imageUrl: savedUrl,
        imageStudio,
        draft
    };
}

async function persistMenuImageDraft(db, { productId, businessContext, username, draft, defaultBusinessContext = DEFAULT_BUSINESS_CONTEXT } = {}) {
    if (!db || typeof db.query !== 'function') {
        throw menuImageDraftError(500, 'menu_image_db_unavailable', 'Database query interface is required');
    }
    const id = cleanNullableString(productId, 120);
    const context = cleanNullableString(businessContext, 80);
    if (!id) throw menuImageDraftError(400, 'menu_image_product_required', 'productId is required');
    if (!context) throw menuImageDraftError(400, 'menu_image_business_context_required', 'businessContext is required');

    const result = await db.query(
        `UPDATE products
         SET ai_card_draft = $1::jsonb,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3
           AND COALESCE(business_context, $5) = $4
         RETURNING *`,
        [
            JSON.stringify(safeJsonObject(draft)),
            cleanNullableString(username, 100) || 'system',
            id,
            context,
            cleanNullableString(defaultBusinessContext, 80) || DEFAULT_BUSINESS_CONTEXT
        ]
    );
    return result.rows?.[0] || null;
}

async function createAndPersistExternalMenuImageDraft({ db, product = {}, payload = {}, actor = {}, uploadOptions = {}, now, businessContext, defaultBusinessContext } = {}) {
    const result = await createExternalMenuImageDraft({ product, payload, actor, uploadOptions, now });
    const persisted = await persistMenuImageDraft(db, {
        productId: pickProductField(product, 'id', 'id'),
        businessContext: businessContext || pickProductField(product, 'business_context', 'businessContext'),
        username: actor.username || actor.name || 'system',
        draft: result.draft,
        defaultBusinessContext
    });
    return {
        ...result,
        product: persisted
    };
}

module.exports = {
    DEFAULT_IMAGE_RULES,
    DEFAULT_MENU_IMAGE_SIZE,
    DEFAULT_MENU_IMAGE_STYLE,
    DEFAULT_TARGET_USAGE,
    ALLOWED_EXTERNAL_IMAGE_MIMES,
    ALLOWED_EXTERNAL_IMAGE_EXTENSIONS,
    MAX_EXTERNAL_IMAGE_BYTES,
    MAX_EXTERNAL_IMAGE_BASE64_LENGTH,
    MAX_EXTERNAL_IMAGE_URL_LENGTH,
    EXTERNAL_MENU_IMAGE_DRAFT_FIELDS,
    normalizeMenuImageStudio,
    buildMenuImageDraft,
    buildMenuImageContext,
    assertExternalDraftPayloadFields,
    normalizeExternalImageSource,
    normalizeExternalDraftPayload,
    createExternalMenuImageDraft,
    persistMenuImageDraft,
    createAndPersistExternalMenuImageDraft
};
