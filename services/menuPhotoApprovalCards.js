'use strict';

const crypto = require('node:crypto');

const CALLBACK_PREFIX = 'egmp';
const MAX_CALLBACK_DATA_BYTES = 64;
const DEFAULT_TOKEN_BYTES = 9;
const DEFAULT_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const REVIEW_ONLY_SAFETY = Object.freeze({
    dryRun: true,
    liveSideEffects: false,
    wouldSendTelegram: false,
    wouldEditTelegram: false,
    wouldMutateCrm: false,
    wouldApplyCrm: false,
    wouldEnableCron: false,
    wouldRestartGateway: false,
    wouldDeploy: false
});

const STATUS = Object.freeze({
    DRAFT_CREATED: 'DRAFT_CREATED',
    WAITING_OWNER_REVIEW: 'WAITING_OWNER_REVIEW',
    APPROVED_PENDING_APPLY: 'APPROVED_PENDING_APPLY',
    APPLYING_TO_CRM: 'APPLYING_TO_CRM',
    APPLIED_TO_CRM: 'APPLIED_TO_CRM',
    NEEDS_TEXT_FIX: 'NEEDS_TEXT_FIX',
    NEEDS_PHOTO_FIX: 'NEEDS_PHOTO_FIX',
    REGENERATE_REQUESTED: 'REGENERATE_REQUESTED',
    COMMENT_REQUESTED: 'COMMENT_REQUESTED',
    REJECTED: 'REJECTED',
    SUPERSEDED: 'SUPERSEDED',
    EXPIRED: 'EXPIRED',
    FAILED: 'FAILED'
});

const TERMINAL_STATUSES = new Set([
    STATUS.APPLIED_TO_CRM,
    STATUS.REJECTED,
    STATUS.SUPERSEDED,
    STATUS.EXPIRED
]);

const ACTION = Object.freeze({
    APPROVE: 'approve',
    FIX_TEXT: 'fix_text',
    FIX_PHOTO: 'fix_photo',
    REGENERATE: 'regenerate',
    COMMENT: 'comment',
    REJECT: 'reject',
    APPLY_TO_CRM: 'apply_to_crm'
});

const ACTION_BUTTONS = Object.freeze({
    [ACTION.APPROVE]: '✅ Затвердити',
    [ACTION.FIX_TEXT]: '✏️ Виправити текст',
    [ACTION.FIX_PHOTO]: '🖼 Виправити фото',
    [ACTION.REGENERATE]: '🔁 Перегенерувати',
    [ACTION.COMMENT]: '💬 Коментар',
    [ACTION.REJECT]: '❌ Відхилити'
});

const TRANSITIONS = Object.freeze({
    [STATUS.DRAFT_CREATED]: Object.freeze({ send_for_review: STATUS.WAITING_OWNER_REVIEW, fail: STATUS.FAILED }),
    [STATUS.WAITING_OWNER_REVIEW]: Object.freeze({
        [ACTION.APPROVE]: STATUS.APPROVED_PENDING_APPLY,
        [ACTION.FIX_TEXT]: STATUS.NEEDS_TEXT_FIX,
        [ACTION.FIX_PHOTO]: STATUS.NEEDS_PHOTO_FIX,
        [ACTION.REGENERATE]: STATUS.REGENERATE_REQUESTED,
        [ACTION.COMMENT]: STATUS.COMMENT_REQUESTED,
        [ACTION.REJECT]: STATUS.REJECTED,
        expire: STATUS.EXPIRED,
        supersede: STATUS.SUPERSEDED
    }),
    [STATUS.APPROVED_PENDING_APPLY]: Object.freeze({
        [ACTION.APPLY_TO_CRM]: STATUS.APPLYING_TO_CRM,
        [ACTION.COMMENT]: STATUS.COMMENT_REQUESTED,
        supersede: STATUS.SUPERSEDED
    }),
    [STATUS.APPLYING_TO_CRM]: Object.freeze({ apply_success: STATUS.APPLIED_TO_CRM, apply_failed: STATUS.APPROVED_PENDING_APPLY }),
    [STATUS.NEEDS_TEXT_FIX]: Object.freeze({ submit_text_instruction: STATUS.DRAFT_CREATED, [ACTION.REJECT]: STATUS.REJECTED, supersede: STATUS.SUPERSEDED }),
    [STATUS.NEEDS_PHOTO_FIX]: Object.freeze({ submit_photo_instruction: STATUS.DRAFT_CREATED, submit_reference_photo: STATUS.DRAFT_CREATED, [ACTION.REJECT]: STATUS.REJECTED, supersede: STATUS.SUPERSEDED }),
    [STATUS.REGENERATE_REQUESTED]: Object.freeze({ generation_success: STATUS.DRAFT_CREATED, generation_failed: STATUS.FAILED }),
    [STATUS.COMMENT_REQUESTED]: Object.freeze({
        comment_received: STATUS.WAITING_OWNER_REVIEW,
        comment_classified_text_fix: STATUS.NEEDS_TEXT_FIX,
        comment_classified_photo_fix: STATUS.NEEDS_PHOTO_FIX,
        comment_classified_reject: STATUS.REJECTED
    }),
    [STATUS.REJECTED]: Object.freeze({ create_new_revision: STATUS.DRAFT_CREATED }),
    [STATUS.APPLIED_TO_CRM]: Object.freeze({}),
    [STATUS.SUPERSEDED]: Object.freeze({}),
    [STATUS.EXPIRED]: Object.freeze({ create_new_card: STATUS.DRAFT_CREATED }),
    [STATUS.FAILED]: Object.freeze({ retry: STATUS.DRAFT_CREATED })
});

function approvalCardError(statusCode, code, message) {
    const error = new Error(message);
    error.status = statusCode;
    error.code = code;
    return error;
}

function cleanString(value, maxLength = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function normalizeStatus(value, fallback = STATUS.DRAFT_CREATED) {
    const status = cleanString(value, 80);
    return Object.prototype.hasOwnProperty.call(STATUS, status) ? status : fallback;
}

function normalizeAction(value) {
    const action = cleanString(value, 40);
    if (!action || !Object.values(ACTION).includes(action)) {
        throw approvalCardError(400, 'MENU_PHOTO_APPROVAL_ACTION_INVALID', 'Unsupported menu-photo approval action');
    }
    return action;
}

function normalizePositiveInt(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return null;
    return number;
}

function normalizeRevision(value, fallback = 1) {
    return normalizePositiveInt(value) || fallback;
}

function normalizeActorId(value) {
    const text = cleanString(value, 120);
    return text || null;
}

function nowIso(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createToken(bytes = DEFAULT_TOKEN_BYTES) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function buildCallbackData(token) {
    const cleanToken = cleanString(token, 48);
    if (!cleanToken) throw approvalCardError(400, 'MENU_PHOTO_APPROVAL_TOKEN_REQUIRED', 'Callback token is required');
    const data = `${CALLBACK_PREFIX}:${cleanToken}`;
    if (Buffer.byteLength(data, 'utf8') > MAX_CALLBACK_DATA_BYTES) {
        throw approvalCardError(400, 'MENU_PHOTO_APPROVAL_CALLBACK_TOO_LONG', 'Callback data is too long');
    }
    return data;
}

function parseMenuPhotoApprovalCallbackData(callbackData) {
    const text = cleanString(callbackData, MAX_CALLBACK_DATA_BYTES + 20);
    if (!text || !text.startsWith(`${CALLBACK_PREFIX}:`)) {
        return { ok: false, reasonCode: 'CALLBACK_DATA_UNSAFE', token: null };
    }
    const token = text.slice(CALLBACK_PREFIX.length + 1).trim();
    if (!/^[A-Za-z0-9_-]{6,48}$/.test(token)) {
        return { ok: false, reasonCode: 'CALLBACK_TOKEN_UNSAFE', token: null };
    }
    return { ok: true, prefix: CALLBACK_PREFIX, token };
}

function buildIdempotencyKey({ action, dishReviewId, draftId, revision, actorId }) {
    const raw = [action, dishReviewId, draftId, revision, actorId || 'unknown'].map(item => String(item || '')).join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function createMenuPhotoApprovalCard(input = {}, options = {}) {
    const now = nowIso(options.now);
    const productId = cleanString(input.productId ?? input.product_id ?? input.id, 120);
    const productName = cleanString(input.productName ?? input.product_name ?? input.name ?? input.label, 220) || 'Блюдо без назви';
    const revision = normalizeRevision(input.revision ?? input.photoRevision ?? input.photo_revision, 1);
    const textRevision = normalizeRevision(input.textRevision ?? input.text_revision, 1);
    const draftId = cleanString(input.draftId ?? input.draft_id, 120) || `draft_${productId || 'menu'}_v${revision}`;
    const dishReviewId = cleanString(input.dishReviewId ?? input.dish_review_id, 140) || `egmp_${productId || 'menu'}_v${revision}`;
    const cardId = cleanString(input.cardId ?? input.card_id, 140) || `card_${dishReviewId}`;
    const status = normalizeStatus(input.status, STATUS.WAITING_OWNER_REVIEW);
    const expiresAt = input.expiresAt || input.expires_at || new Date(new Date(now).getTime() + DEFAULT_EXPIRES_IN_MS).toISOString();

    return {
        cardId,
        dishReviewId,
        productId,
        productName,
        menuSection: cleanString(input.menuSection ?? input.menu_section, 120),
        weight: cleanString(input.weight ?? input.weightValue ?? input.weight_value, 120),
        price: input.price ?? null,
        currentImageUrl: cleanString(input.currentImageUrl ?? input.current_image_url, 2000),
        draftImageUrl: cleanString(input.draftImageUrl ?? input.draft_image_url ?? input.imageUrl ?? input.image_url, 2000),
        draftId,
        photoRevision: revision,
        textRevision,
        status,
        description: cleanString(input.description ?? input.shortDescription ?? input.short_description, 1200),
        crmUrl: cleanString(input.crmUrl ?? input.crm_url, 2000),
        assignedTo: input.assignedTo ?? input.assigned_to ?? null,
        allowedActorIds: Array.isArray(input.allowedActorIds || input.allowed_actor_ids)
            ? (input.allowedActorIds || input.allowed_actor_ids).map(normalizeActorId).filter(Boolean)
            : [],
        createdAt: input.createdAt || input.created_at || now,
        updatedAt: input.updatedAt || input.updated_at || now,
        expiresAt,
        supersededByCardId: input.supersededByCardId ?? input.superseded_by_card_id ?? null
    };
}

function buildMenuPhotoApprovalTokens(card, options = {}) {
    const actions = options.actions || [
        ACTION.APPROVE,
        ACTION.FIX_TEXT,
        ACTION.FIX_PHOTO,
        ACTION.REGENERATE,
        ACTION.COMMENT,
        ACTION.REJECT
    ];
    const now = nowIso(options.now);
    const actorScope = Array.isArray(options.allowedActorIds)
        ? options.allowedActorIds.map(normalizeActorId).filter(Boolean)
        : (card.allowedActorIds || []);

    return Object.fromEntries(actions.map(action => {
        const token = options.tokens?.[action] || createToken();
        return [action, {
            token,
            callbackData: buildCallbackData(token),
            action,
            cardId: card.cardId,
            dishReviewId: card.dishReviewId,
            productId: card.productId,
            draftId: card.draftId,
            revision: card.photoRevision,
            allowedActorIds: actorScope,
            expiresAt: card.expiresAt,
            createdAt: now,
            idempotencyKey: buildIdempotencyKey({
                action,
                dishReviewId: card.dishReviewId,
                draftId: card.draftId,
                revision: card.photoRevision,
                actorId: actorScope.join(',') || 'any'
            })
        }];
    }));
}

function buildMenuPhotoApprovalKeyboard(tokens = {}, card = {}) {
    const button = action => ({ text: ACTION_BUTTONS[action], callback_data: tokens[action]?.callbackData });
    const inlineKeyboard = [
        [button(ACTION.APPROVE), button(ACTION.FIX_TEXT)],
        [button(ACTION.FIX_PHOTO), button(ACTION.REGENERATE)],
        [button(ACTION.COMMENT), button(ACTION.REJECT)]
    ].map(row => row.filter(item => item.callback_data));

    if (card.crmUrl) {
        inlineKeyboard.push([{ text: '👁 Відкрити в CRM', url: card.crmUrl }]);
    }

    return { inline_keyboard: inlineKeyboard };
}

function renderMenuPhotoApprovalCard(card = {}) {
    const lines = [
        '🖼 Фото меню на затвердження',
        '',
        `Товар: ${card.productName || 'Блюдо без назви'}`
    ];
    if (card.menuSection) lines.push(`Категорія: ${card.menuSection}`);
    if (card.weight) lines.push(`Вага: ${card.weight}`);
    if (card.price !== null && card.price !== undefined && card.price !== '') lines.push(`Ціна: ${card.price}`);
    lines.push('', `Поточне фото: ${card.currentImageUrl ? 'є' : 'немає'}`);
    lines.push(`Нова версія: фото v${card.photoRevision || 1}, текст v${card.textRevision || 1}`);
    lines.push(`Статус: ${card.status || STATUS.WAITING_OWNER_REVIEW}`);
    if (card.description) lines.push('', 'Опис:', card.description);
    return lines.join('\n');
}

function buildMenuPhotoApprovalPreview(input = {}, options = {}) {
    const card = createMenuPhotoApprovalCard(input, options);
    const tokens = buildMenuPhotoApprovalTokens(card, options);
    const replyMarkup = buildMenuPhotoApprovalKeyboard(tokens, card);
    return {
        ok: true,
        mode: 'menu_photo_approval_card_preview',
        dryRun: true,
        liveSideEffects: false,
        safety: { ...REVIEW_ONLY_SAFETY },
        card,
        text: renderMenuPhotoApprovalCard(card),
        photo: card.draftImageUrl ? { imageUrl: card.draftImageUrl, required: true } : { imageUrl: null, required: true, blocker: 'PHOTO_REQUIRED_FOR_FULL_APPROVAL_ARTIFACT' },
        replyMarkup,
        tokens: Object.fromEntries(Object.entries(tokens).map(([action, token]) => [action, {
            callbackData: token.callbackData,
            action: token.action,
            expiresAt: token.expiresAt,
            idempotencyKey: token.idempotencyKey
        }])),
        tokenRecords: tokens
    };
}

function cloneState(state = {}) {
    return {
        cards: { ...(state.cards || {}) },
        tokens: { ...(state.tokens || {}) },
        processedCallbacks: { ...(state.processedCallbacks || {}) },
        events: Array.isArray(state.events) ? [...state.events] : [],
        generationJobs: Array.isArray(state.generationJobs) ? [...state.generationJobs] : [],
        pendingInputs: { ...(state.pendingInputs || {}) },
        crmWrites: Number(state.crmWrites || 0)
    };
}

function tokenExpired(tokenRecord, now = new Date()) {
    if (!tokenRecord?.expiresAt) return false;
    const expires = new Date(tokenRecord.expiresAt).getTime();
    const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
    return Number.isFinite(expires) && Number.isFinite(current) && expires <= current;
}

function responseForBlocked(reasonCode, message, extra = {}) {
    return {
        ok: false,
        handled: false,
        dryRun: true,
        liveSideEffects: false,
        wouldMutateCrm: false,
        reasonCode,
        message,
        ...extra
    };
}

function getTransition(status, action) {
    return TRANSITIONS[status]?.[action] || null;
}

function runMenuPhotoApprovalCallbackDryRun(input = {}, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const state = cloneState(input.state || {});
    const parsed = parseMenuPhotoApprovalCallbackData(input.callbackData ?? input.data);
    if (!parsed.ok) return { ...responseForBlocked(parsed.reasonCode, 'Некоректні дані кнопки.'), state };

    const tokenRecord = state.tokens[parsed.token];
    if (!tokenRecord) return { ...responseForBlocked('TOKEN_NOT_FOUND', 'Ця кнопка вже неактуальна або невідома.'), state };
    if (tokenExpired(tokenRecord, now)) return { ...responseForBlocked('TOKEN_EXPIRED', 'Ця картка прострочена.'), state };

    const actorId = normalizeActorId(input.actorId ?? input.actor_id ?? options.actorId);
    const allowedActorIds = Array.isArray(tokenRecord.allowedActorIds) ? tokenRecord.allowedActorIds.map(normalizeActorId).filter(Boolean) : [];
    if (allowedActorIds.length && !allowedActorIds.includes(actorId)) {
        return { ...responseForBlocked('UNAUTHORIZED_ACTOR', 'У вас немає прав для цієї дії.'), state };
    }

    const card = state.cards[tokenRecord.cardId];
    if (!card) return { ...responseForBlocked('CARD_NOT_FOUND', 'Картку не знайдено.'), state };
    if (card.status === STATUS.SUPERSEDED || card.supersededByCardId) {
        return { ...responseForBlocked('STALE_CARD_BLOCKED', 'Ця картка вже неактуальна. Є новіша версія.'), state };
    }
    if (card.status === STATUS.EXPIRED) return { ...responseForBlocked('EXPIRED_CARD_BLOCKED', 'Ця картка прострочена.'), state };
    if (card.status === STATUS.APPLIED_TO_CRM) return { ...responseForBlocked('ALREADY_APPLIED', 'Це вже застосовано в CRM.'), state };
    if (tokenRecord.draftId !== card.draftId || Number(tokenRecord.revision) !== Number(card.photoRevision)) {
        return { ...responseForBlocked('STALE_CARD_BLOCKED', 'Ця картка вже неактуальна. Є новіша версія.'), state };
    }

    const processedKey = tokenRecord.idempotencyKey || parsed.token;
    if (state.processedCallbacks[processedKey]) {
        return {
            ok: true,
            handled: true,
            alreadyProcessed: true,
            dryRun: true,
            liveSideEffects: false,
            wouldMutateCrm: false,
            reasonCode: 'ALREADY_PROCESSED',
            message: 'Цю дію вже оброблено.',
            event: state.processedCallbacks[processedKey],
            state
        };
    }

    const action = normalizeAction(tokenRecord.action);
    const currentStatus = normalizeStatus(card.status, STATUS.WAITING_OWNER_REVIEW);
    const nextStatus = getTransition(currentStatus, action);
    if (!nextStatus) {
        return { ...responseForBlocked('INVALID_STATUS_TRANSITION', 'Ця дія недоступна для поточного статусу.'), state };
    }

    if (action === ACTION.APPLY_TO_CRM) {
        return { ...responseForBlocked('APPLY_PERMISSION_REQUIRED', 'Для внесення в CRM потрібне окреме підтвердження.'), state };
    }

    const event = {
        eventId: `evt_${state.events.length + 1}`,
        cardId: card.cardId,
        dishReviewId: card.dishReviewId,
        productId: card.productId,
        action,
        actorId,
        oldStatus: currentStatus,
        newStatus: nextStatus,
        idempotencyKey: processedKey,
        createdAt: now.toISOString(),
        liveSideEffects: false,
        crmWrites: 0
    };

    const updatedCard = {
        ...card,
        status: nextStatus,
        updatedAt: now.toISOString()
    };

    if (action === ACTION.APPROVE) {
        updatedCard.approvedBy = actorId;
        updatedCard.approvedAt = now.toISOString();
    }
    if (action === ACTION.REJECT) {
        updatedCard.rejectedBy = actorId;
        updatedCard.rejectedAt = now.toISOString();
    }
    if (action === ACTION.FIX_TEXT || action === ACTION.FIX_PHOTO || action === ACTION.COMMENT) {
        state.pendingInputs[card.cardId] = { action, actorId, createdAt: now.toISOString() };
    }
    if (action === ACTION.REGENERATE) {
        state.generationJobs.push({
            jobId: `regen_${card.dishReviewId}_${card.photoRevision}`,
            cardId: card.cardId,
            productId: card.productId,
            draftId: card.draftId,
            revision: card.photoRevision,
            status: 'REQUESTED',
            createdAt: now.toISOString(),
            liveSideEffects: false
        });
    }

    state.cards[card.cardId] = updatedCard;
    state.events.push(event);
    state.processedCallbacks[processedKey] = event;

    return {
        ok: true,
        handled: true,
        dryRun: true,
        liveSideEffects: false,
        wouldMutateCrm: false,
        message: callbackSuccessMessage(action, updatedCard),
        event,
        card: updatedCard,
        state
    };
}

function callbackSuccessMessage(action, card) {
    switch (action) {
        case ACTION.APPROVE:
            return `✅ Затверджено: ${card.productName}. CRM ще не змінена.`;
        case ACTION.FIX_TEXT:
            return `✏️ Прийнято: очікую правку тексту для ${card.productName}.`;
        case ACTION.FIX_PHOTO:
            return `🖼 Прийнято: очікую правку або референс фото для ${card.productName}.`;
        case ACTION.REGENERATE:
            return `🔁 Запущено dry-run регенерації для ${card.productName}.`;
        case ACTION.COMMENT:
            return `💬 Очікую коментар для ${card.productName}.`;
        case ACTION.REJECT:
            return `❌ Відхилено: ${card.productName}.`;
        default:
            return 'Дію оброблено.';
    }
}

function createMenuPhotoApprovalCardPreviewHandler() {
    return function menuPhotoApprovalCardPreviewHandler(req, res, next) {
        try {
            const preview = buildMenuPhotoApprovalPreview(req.body || {}, { now: req.body?.now });
            return res.json(preview);
        } catch (error) {
            if (typeof next === 'function') return next(error);
            throw error;
        }
    };
}

function createMenuPhotoApprovalCallbackDryRunHandler() {
    return function menuPhotoApprovalCallbackDryRunHandler(req, res, next) {
        try {
            const result = runMenuPhotoApprovalCallbackDryRun(req.body || {}, { actorId: req.user?.id, now: req.body?.now });
            return res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            if (typeof next === 'function') return next(error);
            throw error;
        }
    };
}

module.exports = {
    ACTION,
    ACTION_BUTTONS,
    CALLBACK_PREFIX,
    MAX_CALLBACK_DATA_BYTES,
    REVIEW_ONLY_SAFETY,
    STATUS,
    TERMINAL_STATUSES,
    TRANSITIONS,
    buildCallbackData,
    buildIdempotencyKey,
    buildMenuPhotoApprovalKeyboard,
    buildMenuPhotoApprovalPreview,
    buildMenuPhotoApprovalTokens,
    createMenuPhotoApprovalCallbackDryRunHandler,
    createMenuPhotoApprovalCard,
    createMenuPhotoApprovalCardPreviewHandler,
    parseMenuPhotoApprovalCallbackData,
    renderMenuPhotoApprovalCard,
    runMenuPhotoApprovalCallbackDryRun
};
