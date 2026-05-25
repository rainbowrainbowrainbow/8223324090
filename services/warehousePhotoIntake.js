/**
 * services/warehousePhotoIntake.js
 *
 * Telegram photo intake for warehouse stock. The service stores an auditable
 * draft first and writes to warehouse_stock only after explicit confirmation.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    downloadTelegramFileById,
    getTelegramBotConfigStatus
} = require('./telegram');

const log = createLogger('WarehousePhotoIntake');

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const VISION_MODEL = process.env.WAREHOUSE_VISION_MODEL || process.env.OPENAI_VISION_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MANUAL_REVIEW_STATUSES = new Set(['needs_review', 'draft', 'failed']);
const CLOSED_STATUSES = new Set(['confirmed', 'cancelled']);

const VALID_CATEGORIES = ['consumable', 'craft', 'props', 'food', 'decor', 'prizes', 'office', 'tech', 'pinata'];
const VALID_UNITS = ['шт', 'рул', 'уп', 'кг', 'л', 'м', 'компл', 'набір'];

const CATEGORY_KEYWORDS = [
    ['food', ['їжа', 'food', 'napkin', 'pizza', 'cake', 'snack', 'drink', 'вода', 'сік', 'цукор']],
    ['craft', ['майстер', 'mk', 'paint', 'фарба', 'клей', 'папір', 'paper', 'craft']],
    ['props', ['реквізит', 'prop', 'костюм', 'іграш', 'маска', 'мʼяч', 'мяч']],
    ['decor', ['декор', 'balloon', 'кульк', 'банер', 'свіч', 'decor']],
    ['prizes', ['приз', 'gift', 'подар', 'стікер', 'наклей']],
    ['office', ['офіс', 'ручк', 'скотч', 'маркер', 'папка']],
    ['tech', ['кабель', 'батар', 'заряд', 'ламп', 'tech']],
    ['pinata', ['пінья', 'pinata', 'пинья']]
];

function publicVisionStatus() {
    const configured = Boolean(process.env.OPENAI_API_KEY);
    return {
        provider: 'openai',
        model: VISION_MODEL,
        configured,
        status: configured ? 'ready' : 'missing_key',
        keyEnv: 'OPENAI_API_KEY'
    };
}

function normalizeText(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeForMatch(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function clampInt(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n);
    return rounded > 0 ? rounded : fallback;
}

function normalizeCategory(value, name = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (VALID_CATEGORIES.includes(raw)) return raw;
    const haystack = normalizeForMatch(`${raw} ${name}`);
    for (const [category, words] of CATEGORY_KEYWORDS) {
        if (words.some(word => haystack.includes(normalizeForMatch(word)))) return category;
    }
    return 'consumable';
}

function normalizeUnit(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (VALID_UNITS.includes(raw)) return raw;
    if (['pcs', 'piece', 'pieces', 'шт.', 'штук', 'штуки', 'од', 'од.'].includes(raw)) return 'шт';
    if (['pack', 'package', 'пак', 'пачка', 'уп.'].includes(raw)) return 'уп';
    if (['kg', 'кг.'].includes(raw)) return 'кг';
    if (['l', 'liter', 'літр', 'л.'].includes(raw)) return 'л';
    return 'шт';
}

function normalizeDraft(input = {}) {
    const name = normalizeText(input.name || input.itemName || input.title);
    const quantity = clampInt(input.quantity, 1);
    const unit = normalizeUnit(input.unit);
    const category = normalizeCategory(input.category, name);
    const confidence = Math.max(0, Math.min(1, Number(input.confidence || 0)));

    return {
        name,
        category,
        quantity,
        unit,
        locationId: input.locationId || input.location_id || null,
        locationName: normalizeText(input.locationName || input.location || ''),
        sku: normalizeText(input.sku || ''),
        notes: normalizeText(input.notes || input.description || ''),
        supplier: normalizeText(input.supplier || ''),
        price: Number.isFinite(Number(input.price)) ? Number(input.price) : null,
        confidence,
        needsManualReview: input.needsManualReview !== false
    };
}

function draftIsActionable(draft) {
    return Boolean(draft?.name && draft.quantity > 0 && VALID_CATEGORIES.includes(draft.category) && VALID_UNITS.includes(draft.unit));
}

function buildCaptionDraft(caption = '') {
    const text = normalizeText(caption);
    if (!text) return normalizeDraft({ notes: '' });
    const qtyMatch = text.match(/(\d{1,5})\s*(шт\.?|штук|уп\.?|кг|л|м|pcs|pack)?/i);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;
    let name = text
        .replace(/#?склад|warehouse|прихід|поповнення|додати/gi, '')
        .replace(/\d{1,5}\s*(шт\.?|штук|уп\.?|кг|л|м|pcs|pack)?/i, '')
        .trim();
    if (name.length > 140) name = name.slice(0, 140);
    return normalizeDraft({
        name,
        quantity,
        unit: qtyMatch?.[2] || 'шт',
        notes: text,
        confidence: name ? 0.35 : 0.1,
        needsManualReview: true
    });
}

function parseJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function extractResponseText(payload) {
    if (payload?.output_text) return payload.output_text;
    const parts = [];
    for (const item of payload?.output || []) {
        for (const content of item?.content || []) {
            if (content?.type === 'output_text' && content.text) parts.push(content.text);
            if (content?.type === 'text' && content.text) parts.push(content.text);
        }
    }
    return parts.join('\n').trim();
}

async function callOpenAIVision(images, caption = '') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        return {
            ok: false,
            reason: 'openai_not_configured',
            draft: buildCaptionDraft(caption)
        };
    }
    if (!images.length) {
        return {
            ok: false,
            reason: 'no_image_buffer',
            draft: buildCaptionDraft(caption)
        };
    }

    const prompt = [
        'You are extracting a warehouse stock intake draft from photos for a Ukrainian CRM.',
        'Return ONLY compact JSON with keys: name, category, quantity, unit, locationName, sku, supplier, price, notes, confidence, needsManualReview.',
        `Allowed category values: ${VALID_CATEGORIES.join(', ')}.`,
        `Allowed unit values: ${VALID_UNITS.join(', ')}.`,
        'If the photo is unreadable or ambiguous, use empty name, confidence below 0.45, and needsManualReview true.',
        'Do not invent quantities, prices, or names that are not visible or strongly implied.',
        caption ? `Telegram caption: ${caption}` : 'Telegram caption: empty'
    ].join('\n');

    const content = [{ type: 'input_text', text: prompt }];
    for (const image of images.slice(0, 4)) {
        if (!image?.buffer || image.buffer.length > MAX_IMAGE_BYTES) continue;
        const mime = image.mimeType || 'image/jpeg';
        content.push({
            type: 'input_image',
            image_url: `data:${mime};base64,${image.buffer.toString('base64')}`
        });
    }
    if (content.length === 1) {
        return {
            ok: false,
            reason: 'image_too_large_or_missing',
            draft: buildCaptionDraft(caption)
        };
    }

    const response = await fetch(`${OPENAI_API_BASE}/responses`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: VISION_MODEL,
            input: [{ role: 'user', content }],
            temperature: 0.1,
            max_output_tokens: 500
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = payload?.error?.message || payload?.error || `openai_http_${response.status}`;
        return {
            ok: false,
            reason: String(message).slice(0, 240),
            draft: buildCaptionDraft(caption)
        };
    }

    const parsed = parseJsonObject(extractResponseText(payload));
    if (!parsed) {
        return {
            ok: false,
            reason: 'vision_unparseable_json',
            draft: buildCaptionDraft(caption)
        };
    }
    return {
        ok: true,
        reason: null,
        draft: normalizeDraft(parsed)
    };
}

function stockMatchScore(draftName, stockName) {
    const a = normalizeForMatch(draftName);
    const b = normalizeForMatch(stockName);
    if (!a || !b) return 0;
    if (a === b) return 0.98;
    if (a.includes(b) || b.includes(a)) return Math.min(0.88, Math.max(a.length, b.length) / Math.min(a.length, b.length) / 10 + 0.72);
    const aWords = new Set(a.split(' ').filter(Boolean));
    const bWords = new Set(b.split(' ').filter(Boolean));
    let shared = 0;
    for (const word of aWords) {
        if (bWords.has(word)) shared += 1;
    }
    return shared ? shared / Math.max(aWords.size, bWords.size) : 0;
}

async function findMatchCandidates(draft = {}) {
    if (!draft.name) return [];
    const result = await pool.query(
        `SELECT id, name, category, quantity, unit, location_id, sku
           FROM warehouse_stock
          WHERE is_active = true
            AND (name ILIKE $1 OR COALESCE(sku, '') ILIKE $1 OR category = $2)
          ORDER BY
            CASE WHEN LOWER(name) = LOWER($3) THEN 0 ELSE 1 END,
            updated_at DESC NULLS LAST,
            name
          LIMIT 30`,
        [`%${draft.name}%`, draft.category || 'consumable', draft.name]
    );
    return result.rows
        .map(row => ({
            stockId: row.id,
            name: row.name,
            category: row.category,
            quantity: Number(row.quantity || 0),
            unit: row.unit,
            locationId: row.location_id || null,
            sku: row.sku || null,
            score: Number(stockMatchScore(draft.name, row.name).toFixed(2))
        }))
        .filter(candidate => candidate.score >= 0.45 || candidate.category === draft.category)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

function deriveStatus(draft, candidates, visionOk) {
    if (!draftIsActionable(draft)) return visionOk ? 'needs_review' : 'failed';
    const strongMatches = candidates.filter(c => c.score >= 0.75);
    if (strongMatches.length > 1) return 'needs_review';
    return 'needs_review';
}

function mapIntakeRow(row) {
    const draft = row.draft && typeof row.draft === 'object' ? row.draft : {};
    const matchCandidates = Array.isArray(row.match_candidates) ? row.match_candidates : [];
    return {
        id: row.id,
        source: row.source,
        status: row.status,
        draft,
        matchCandidates,
        confidence: Number(row.confidence || 0),
        visionProvider: row.vision_provider || null,
        visionModel: row.vision_model || null,
        failureReason: row.failure_reason || null,
        operatorNotes: row.operator_notes || null,
        telegram: {
            chatId: row.telegram_chat_id || null,
            userId: row.telegram_user_id || null,
            username: row.telegram_username || null,
            messageId: row.telegram_message_id || null,
            mediaGroupId: row.telegram_media_group_id || null,
            threadId: row.telegram_thread_id || null
        },
        confirmedStockId: row.confirmed_stock_id || null,
        confirmedHistoryId: row.confirmed_history_id || null,
        confirmedMovementId: row.confirmed_movement_id || null,
        confirmedBy: row.confirmed_by || null,
        confirmedAt: row.confirmed_at || null,
        cancelledBy: row.cancelled_by || null,
        cancelledAt: row.cancelled_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        photoCount: Number(row.photo_count || 0)
    };
}

function getLargestPhoto(message) {
    const photos = Array.isArray(message?.photo) ? message.photo : [];
    return photos.length ? photos[photos.length - 1] : null;
}

function getImageDocument(message) {
    const doc = message?.document;
    if (!doc?.file_id || !String(doc.mime_type || '').startsWith('image/')) return null;
    return {
        file_id: doc.file_id,
        file_unique_id: doc.file_unique_id || null,
        file_size: doc.file_size || null,
        width: null,
        height: null,
        mime_type: doc.mime_type
    };
}

function buildPhotoRefs(message) {
    const refs = [];
    const largest = getLargestPhoto(message);
    if (largest) {
        refs.push({
            fileId: largest.file_id,
            fileUniqueId: largest.file_unique_id || null,
            fileSize: largest.file_size || null,
            width: largest.width || null,
            height: largest.height || null,
            mimeType: 'image/jpeg'
        });
    }
    const doc = getImageDocument(message);
    if (doc) {
        refs.push({
            fileId: doc.file_id,
            fileUniqueId: doc.file_unique_id || null,
            fileSize: doc.file_size || null,
            width: doc.width || null,
            height: doc.height || null,
            mimeType: doc.mime_type || 'image/jpeg'
        });
    }
    return refs;
}

async function downloadVisionImages(photoRefs) {
    const images = [];
    for (const ref of photoRefs.slice(0, 4)) {
        try {
            const downloaded = await downloadTelegramFileById(ref.fileId);
            if (downloaded?.buffer?.length) {
                images.push({
                    ...ref,
                    buffer: downloaded.buffer,
                    mimeType: ref.mimeType || downloaded.mimeType || 'image/jpeg',
                    telegramFilePath: downloaded.filePath || null
                });
            }
        } catch (err) {
            log.warn('Telegram photo download failed', { fileId: ref.fileId, message: err.message });
        }
    }
    return images;
}

async function createTelegramPhotoIntake(message) {
    const photoRefs = buildPhotoRefs(message);
    if (!photoRefs.length) return { ok: false, reason: 'no_photo' };

    const chatId = message.chat?.id ? String(message.chat.id) : null;
    const messageId = message.message_id ? String(message.message_id) : null;
    const mediaGroupId = message.media_group_id ? String(message.media_group_id) : null;
    const dedupeKey = `telegram:${chatId || 'unknown'}:${messageId || mediaGroupId || Date.now()}`;
    const caption = message.caption || '';

    const existing = await pool.query(
        `SELECT i.*, COUNT(p.id)::int AS photo_count
           FROM warehouse_photo_intakes i
           LEFT JOIN warehouse_photo_intake_photos p ON p.intake_id = i.id
          WHERE i.dedupe_key = $1
          GROUP BY i.id`,
        [dedupeKey]
    );
    if (existing.rows.length) {
        return { ok: true, intake: mapIntakeRow(existing.rows[0]), duplicate: true };
    }

    const images = await downloadVisionImages(photoRefs);
    const vision = await callOpenAIVision(images, caption);
    const draft = normalizeDraft(vision.draft);
    const candidates = await findMatchCandidates(draft);
    const status = deriveStatus(draft, candidates, vision.ok);

    const result = await pool.query(
        `INSERT INTO warehouse_photo_intakes (
            source, telegram_chat_id, telegram_user_id, telegram_username,
            telegram_message_id, telegram_media_group_id, telegram_thread_id,
            dedupe_key, status, draft, match_candidates, confidence,
            vision_provider, vision_model, failure_reason, raw_payload
         )
         VALUES (
            'telegram', $1, $2, $3, $4, $5, $6,
            $7, $8, $9::jsonb, $10::jsonb, $11,
            $12, $13, $14, $15::jsonb
         )
         RETURNING *`,
        [
            chatId,
            message.from?.id ? String(message.from.id) : null,
            message.from?.username || null,
            messageId,
            mediaGroupId,
            message.message_thread_id ? String(message.message_thread_id) : null,
            dedupeKey,
            status,
            JSON.stringify(draft),
            JSON.stringify(candidates),
            draft.confidence || 0,
            'openai',
            VISION_MODEL,
            vision.ok ? null : vision.reason,
            JSON.stringify({
                messageId,
                mediaGroupId,
                caption,
                from: message.from || null,
                chat: message.chat ? { id: message.chat.id, type: message.chat.type, title: message.chat.title || null } : null
            })
        ]
    );
    const intake = result.rows[0];

    for (const ref of photoRefs) {
        const matchedImage = images.find(img => img.fileId === ref.fileId);
        await pool.query(
            `INSERT INTO warehouse_photo_intake_photos (
                intake_id, telegram_file_id, telegram_file_unique_id, telegram_file_size,
                width, height, mime_type, telegram_file_path
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (intake_id, telegram_file_id) DO NOTHING`,
            [
                intake.id,
                ref.fileId,
                ref.fileUniqueId,
                ref.fileSize,
                ref.width,
                ref.height,
                ref.mimeType || null,
                matchedImage?.telegramFilePath || null
            ]
        );
    }

    const withCount = await getIntake(intake.id);
    return { ok: true, intake: withCount, duplicate: false };
}

async function getIntake(id) {
    const result = await pool.query(
        `SELECT i.*, COUNT(p.id)::int AS photo_count
           FROM warehouse_photo_intakes i
           LEFT JOIN warehouse_photo_intake_photos p ON p.intake_id = i.id
          WHERE i.id = $1
          GROUP BY i.id`,
        [id]
    );
    return result.rows[0] ? mapIntakeRow(result.rows[0]) : null;
}

async function listIntakes(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const status = normalizeText(options.status || '');
    const params = [];
    let where = '';
    if (status && status !== 'all') {
        params.push(status);
        where = `WHERE i.status = $${params.length}`;
    }
    params.push(limit);
    const result = await pool.query(
        `SELECT i.*, COUNT(p.id)::int AS photo_count
           FROM warehouse_photo_intakes i
           LEFT JOIN warehouse_photo_intake_photos p ON p.intake_id = i.id
           ${where}
          GROUP BY i.id
          ORDER BY i.created_at DESC
          LIMIT $${params.length}`,
        params
    );
    return result.rows.map(mapIntakeRow);
}

async function getIntakeStatus() {
    const [telegram, countsResult, lastResult] = await Promise.all([
        getTelegramBotConfigStatus().catch(err => ({ configured: false, status: 'error', error: err.message })),
        pool.query(
            `SELECT status, COUNT(*)::int AS count
               FROM warehouse_photo_intakes
              GROUP BY status`
        ),
        pool.query(
            `SELECT status, created_at, failure_reason
               FROM warehouse_photo_intakes
              ORDER BY created_at DESC
              LIMIT 1`
        )
    ]);
    const counts = {};
    countsResult.rows.forEach(row => { counts[row.status] = Number(row.count || 0); });
    return {
        telegram,
        vision: publicVisionStatus(),
        counts,
        lastIntake: lastResult.rows[0] || null
    };
}

function mergeDraft(current, overrides = {}) {
    return normalizeDraft({
        ...current,
        ...overrides,
        quantity: overrides.quantity !== undefined ? overrides.quantity : current.quantity,
        locationId: overrides.locationId !== undefined ? overrides.locationId : current.locationId
    });
}

async function confirmIntake(id, options = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query(
            `SELECT * FROM warehouse_photo_intakes WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (!locked.rowCount) {
            await client.query('ROLLBACK');
            return { success: false, status: 404, error: 'intake_not_found' };
        }

        const row = locked.rows[0];
        if (CLOSED_STATUSES.has(row.status)) {
            await client.query('ROLLBACK');
            return { success: false, status: 409, error: 'intake_already_closed' };
        }
        if (!MANUAL_REVIEW_STATUSES.has(row.status)) {
            await client.query('ROLLBACK');
            return { success: false, status: 409, error: 'intake_not_reviewable' };
        }

        const draft = mergeDraft(row.draft || {}, options.draft || {});
        const explicitStockId = options.warehouseStockId || options.stockId || options.draft?.warehouseStockId || null;
        const candidates = Array.isArray(row.match_candidates) ? row.match_candidates : [];
        const strongCandidates = candidates.filter(c => Number(c.score || 0) >= 0.75);
        const targetStockId = explicitStockId || (strongCandidates.length === 1 ? strongCandidates[0].stockId : null);

        if (!draftIsActionable(draft)) {
            await client.query('ROLLBACK');
            return { success: false, status: 400, error: 'draft_requires_name_quantity_unit_category' };
        }
        if (!explicitStockId && strongCandidates.length > 1) {
            await client.query('ROLLBACK');
            return { success: false, status: 409, error: 'ambiguous_match_requires_manual_choice' };
        }

        const actor = normalizeText(options.actor || 'telegram');
        const amount = clampInt(draft.quantity, 1);
        const reason = `Telegram photo intake #${id}${draft.notes ? `: ${draft.notes}` : ''}`.slice(0, 250);
        let stockRow;
        let historyId = null;
        let movementId = null;

        if (targetStockId) {
            const existing = await client.query(
                `SELECT * FROM warehouse_stock WHERE id = $1 AND is_active = true FOR UPDATE`,
                [targetStockId]
            );
            if (!existing.rowCount) {
                await client.query('ROLLBACK');
                return { success: false, status: 404, error: 'target_stock_not_found' };
            }
            const updated = await client.query(
                `UPDATE warehouse_stock
                    SET quantity = quantity + $1,
                        updated_at = NOW(),
                        updated_by = $2
                  WHERE id = $3
                  RETURNING *`,
                [amount, actor, targetStockId]
            );
            stockRow = updated.rows[0];
        } else {
            const created = await client.query(
                `INSERT INTO warehouse_stock (
                    name, category, quantity, min_quantity, unit, notes, updated_by, owner,
                    location_id, sku, purchase_unit_price, is_procured_externally
                 )
                 VALUES ($1,$2,$3,0,$4,$5,$6,'park',$7,$8,$9,false)
                 RETURNING *`,
                [
                    draft.name,
                    draft.category,
                    amount,
                    draft.unit,
                    draft.notes || null,
                    actor,
                    draft.locationId || null,
                    draft.sku || null,
                    Number.isFinite(Number(draft.price)) ? Number(draft.price) : 0
                ]
            );
            stockRow = created.rows[0];
        }

        const history = await client.query(
            `INSERT INTO warehouse_history (stock_id, change, reason, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [stockRow.id, amount, reason, actor]
        );
        historyId = history.rows[0]?.id || null;

        const movement = await client.query(
            `INSERT INTO warehouse_stock_movements (
                warehouse_stock_id, movement_type, from_location_id, to_location_id,
                quantity, reason, created_by
             )
             VALUES ($1, 'manual_adjustment', NULL, $2, $3, $4, $5)
             RETURNING id`,
            [stockRow.id, stockRow.location_id || draft.locationId || null, amount, reason, actor]
        );
        movementId = movement.rows[0]?.id || null;

        const updatedIntake = await client.query(
            `UPDATE warehouse_photo_intakes
                SET status = 'confirmed',
                    draft = $1::jsonb,
                    confirmed_stock_id = $2,
                    confirmed_history_id = $3,
                    confirmed_movement_id = $4,
                    confirmed_by = $5,
                    confirmed_at = NOW(),
                    updated_at = NOW()
              WHERE id = $6
              RETURNING *`,
            [JSON.stringify(draft), stockRow.id, historyId, movementId, actor, id]
        );

        await client.query('COMMIT');
        return {
            success: true,
            intake: mapIntakeRow({ ...updatedIntake.rows[0], photo_count: 0 }),
            stockId: stockRow.id,
            historyId,
            movementId,
            action: targetStockId ? 'restock_existing' : 'create_new'
        };
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Confirm warehouse photo intake error', err);
        return { success: false, status: 500, error: 'server_error' };
    } finally {
        client.release();
    }
}

async function cancelIntake(id, options = {}) {
    const actor = normalizeText(options.actor || 'telegram');
    const result = await pool.query(
        `UPDATE warehouse_photo_intakes
            SET status = 'cancelled',
                cancelled_by = $1,
                cancelled_at = NOW(),
                operator_notes = COALESCE($2, operator_notes),
                updated_at = NOW()
          WHERE id = $3
            AND status NOT IN ('confirmed', 'cancelled')
          RETURNING *`,
        [actor, options.notes || null, id]
    );
    if (!result.rowCount) return { success: false, status: 409, error: 'intake_already_closed_or_missing' };
    return { success: true, intake: mapIntakeRow({ ...result.rows[0], photo_count: 0 }) };
}

function buildTelegramSummary(intake) {
    const draft = intake?.draft || {};
    const statusLine = intake.failureReason
        ? `\nПотрібна перевірка: ${intake.failureReason}`
        : '';
    const candidateLine = intake.matchCandidates?.length
        ? `\nМожливий збіг: ${intake.matchCandidates[0].name} (${Math.round((intake.matchCandidates[0].score || 0) * 100)}%)`
        : '\nЙмовірно нова позиція.';
    return [
        '<b>Склад: фото прийнято</b>',
        '',
        draft.name ? `Знайшов: <b>${escapeHtml(draft.name)}</b>` : 'Назву не вдалося визначити.',
        `Кількість: ${draft.quantity || 1} ${escapeHtml(draft.unit || 'шт')}`,
        `Категорія: ${escapeHtml(draft.category || 'consumable')}`,
        `Впевненість: ${Math.round((Number(intake.confidence || draft.confidence || 0)) * 100)}%`,
        candidateLine,
        statusLine,
        '',
        'Підтвердження запише зміну у склад. Якщо дані сумнівні, відкрийте CRM і відредагуйте чернетку.'
    ].filter(Boolean).join('\n');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = {
    publicVisionStatus,
    normalizeDraft,
    buildCaptionDraft,
    findMatchCandidates,
    createTelegramPhotoIntake,
    getIntake,
    listIntakes,
    getIntakeStatus,
    confirmIntake,
    cancelIntake,
    buildTelegramSummary,
    draftIsActionable
};
