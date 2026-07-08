'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createHermesRouter } = require('../routes/hermes');

const {
    ACTION,
    STATUS,
    buildCallbackData,
    buildMenuPhotoApprovalPreview,
    createMenuPhotoApprovalCallbackDryRunHandler,
    parseMenuPhotoApprovalCallbackData,
    runMenuPhotoApprovalCallbackDryRun
} = require('../services/menuPhotoApprovalCards');

const NOW = new Date('2026-07-08T12:00:00.000Z');

function buildPreview(overrides = {}, options = {}) {
    return buildMenuPhotoApprovalPreview({
        productId: 'menu-123',
        productName: 'Паста з мітболами',
        menuSection: 'Основні страви',
        weight: '250 г',
        price: 260,
        currentImageUrl: '/uploads/catalog-images/items/current.png',
        draftImageUrl: '/uploads/catalog-images/items/draft-v3.png',
        draftId: 'draft-menu-123-v3',
        dishReviewId: 'review-menu-123-v3',
        cardId: 'card-menu-123-v3',
        revision: 3,
        textRevision: 2,
        description: 'Ніжна паста з мітболами у томатному соусі.',
        allowedActorIds: ['4'],
        ...overrides
    }, {
        now: NOW,
        tokens: {
            approve: 'tokApprove1',
            fix_text: 'tokFixText1',
            fix_photo: 'tokFixPhoto1',
            regenerate: 'tokRegen1',
            comment: 'tokComment1',
            reject: 'tokReject1',
            ...(options.tokens || {})
        },
        ...options
    });
}

function stateFromPreview(preview) {
    return {
        cards: { [preview.card.cardId]: preview.card },
        tokens: Object.fromEntries(Object.values(preview.tokenRecords).map(record => [record.token, record])),
        processedCallbacks: {},
        events: [],
        generationJobs: [],
        pendingInputs: {},
        crmWrites: 0
    };
}

function click(preview, action, state, actorId = '4') {
    return runMenuPhotoApprovalCallbackDryRun({
        callbackData: preview.tokens[action].callbackData,
        actorId,
        state
    }, { now: NOW });
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function request(baseUrl, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function createDryRunApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/hermes', createHermesRouter({
        rateLimit: false,
        authMiddleware(req, res, next) {
            req.user = { id: 4, username: 'hermes.actor', business_contexts: ['event_genix'], defaultBusinessContext: 'event_genix' };
            return next();
        },
        pool: {
            async query() {
                throw new Error('DB should not be called by menu-photo approval dry-run routes');
            }
        }
    }));
    return app;
}

describe('menu photo approval cards', () => {
    it('renders a dry-run approval card with egmp token callbacks and no live side effects', () => {
        const preview = buildPreview();

        assert.equal(preview.ok, true);
        assert.equal(preview.dryRun, true);
        assert.equal(preview.liveSideEffects, false);
        assert.equal(preview.safety.wouldMutateCrm, false);
        assert.match(preview.text, /Паста з мітболами/);
        assert.equal(preview.replyMarkup.inline_keyboard.length, 3);
        assert.equal(preview.tokens.approve.callbackData, 'egmp:tokApprove1');
        assert.ok(Buffer.byteLength(preview.tokens.approve.callbackData, 'utf8') <= 64);
        assert.deepEqual(parseMenuPhotoApprovalCallbackData('egmp:tokApprove1'), {
            ok: true,
            prefix: 'egmp',
            token: 'tokApprove1'
        });
    });

    it('rejects unsafe callback data before touching state', () => {
        const preview = buildPreview();
        const state = stateFromPreview(preview);
        const result = runMenuPhotoApprovalCallbackDryRun({ callbackData: 'bad:tokApprove1', actorId: '4', state }, { now: NOW });

        assert.equal(result.ok, false);
        assert.equal(result.reasonCode, 'CALLBACK_DATA_UNSAFE');
        assert.equal(result.state.events.length, 0);
        assert.equal(result.state.crmWrites, 0);
    });

    it('approves a waiting card without applying or mutating CRM', () => {
        const preview = buildPreview();
        const state = stateFromPreview(preview);
        const result = click(preview, ACTION.APPROVE, state);

        assert.equal(result.ok, true);
        assert.equal(result.card.status, STATUS.APPROVED_PENDING_APPLY);
        assert.equal(result.liveSideEffects, false);
        assert.equal(result.wouldMutateCrm, false);
        assert.equal(result.state.crmWrites, 0);
        assert.match(result.message, /CRM ще не змінена/);
    });

    it('handles text and photo fix scenarios as pending owner input', () => {
        const textPreview = buildPreview();
        const textResult = click(textPreview, ACTION.FIX_TEXT, stateFromPreview(textPreview));
        assert.equal(textResult.card.status, STATUS.NEEDS_TEXT_FIX);
        assert.equal(textResult.state.pendingInputs[textPreview.card.cardId].action, ACTION.FIX_TEXT);
        assert.equal(textResult.state.crmWrites, 0);

        const photoPreview = buildPreview({}, { tokens: { fix_photo: 'tokFixPhoto2' } });
        const photoResult = click(photoPreview, ACTION.FIX_PHOTO, stateFromPreview(photoPreview));
        assert.equal(photoResult.card.status, STATUS.NEEDS_PHOTO_FIX);
        assert.equal(photoResult.state.pendingInputs[photoPreview.card.cardId].action, ACTION.FIX_PHOTO);
        assert.equal(photoResult.state.crmWrites, 0);
    });

    it('creates a local regeneration job without sending or applying anything', () => {
        const preview = buildPreview();
        const result = click(preview, ACTION.REGENERATE, stateFromPreview(preview));

        assert.equal(result.card.status, STATUS.REGENERATE_REQUESTED);
        assert.equal(result.state.generationJobs.length, 1);
        assert.equal(result.state.generationJobs[0].liveSideEffects, false);
        assert.equal(result.state.crmWrites, 0);
    });

    it('rejects a draft and blocks further apply by status', () => {
        const preview = buildPreview();
        const result = click(preview, ACTION.REJECT, stateFromPreview(preview));

        assert.equal(result.card.status, STATUS.REJECTED);
        assert.equal(result.state.crmWrites, 0);

        const second = runMenuPhotoApprovalCallbackDryRun({
            callbackData: buildCallbackData('applyToken1'),
            actorId: '4',
            state: {
                ...result.state,
                tokens: {
                    ...result.state.tokens,
                    applyToken1: {
                        token: 'applyToken1',
                        action: ACTION.APPLY_TO_CRM,
                        cardId: preview.card.cardId,
                        dishReviewId: preview.card.dishReviewId,
                        productId: preview.card.productId,
                        draftId: preview.card.draftId,
                        revision: preview.card.photoRevision,
                        allowedActorIds: ['4'],
                        expiresAt: '2026-07-09T12:00:00.000Z',
                        idempotencyKey: 'apply-after-reject'
                    }
                }
            }
        }, { now: NOW });

        assert.equal(second.ok, false);
        assert.equal(second.reasonCode, 'INVALID_STATUS_TRANSITION');
        assert.equal(second.state.crmWrites, 0);
    });

    it('blocks stale cards when a newer revision supersedes them', () => {
        const preview = buildPreview({ status: STATUS.SUPERSEDED, supersededByCardId: 'card-menu-123-v4' });
        const result = click(preview, ACTION.APPROVE, stateFromPreview(preview));

        assert.equal(result.ok, false);
        assert.equal(result.reasonCode, 'STALE_CARD_BLOCKED');
        assert.equal(result.state.events.length, 0);
    });

    it('is idempotent for repeated button clicks', () => {
        const preview = buildPreview();
        const state = stateFromPreview(preview);
        const first = click(preview, ACTION.APPROVE, state);
        const second = click(preview, ACTION.APPROVE, first.state);

        assert.equal(first.ok, true);
        assert.equal(second.ok, true);
        assert.equal(second.alreadyProcessed, true);
        assert.equal(second.state.events.length, 1);
        assert.equal(second.state.crmWrites, 0);
    });

    it('blocks unauthorized actors before changing status', () => {
        const preview = buildPreview();
        const result = click(preview, ACTION.APPROVE, stateFromPreview(preview), '13');

        assert.equal(result.ok, false);
        assert.equal(result.reasonCode, 'UNAUTHORIZED_ACTOR');
        assert.equal(result.state.cards[preview.card.cardId].status, STATUS.WAITING_OWNER_REVIEW);
        assert.equal(result.state.events.length, 0);
    });

    it('dry-run handler returns 400 for unknown token and never mutates CRM', async () => {
        const handler = createMenuPhotoApprovalCallbackDryRunHandler();
        const req = {
            user: { id: 4 },
            body: {
                callbackData: 'egmp:unknown1',
                state: { cards: {}, tokens: {}, processedCallbacks: {}, events: [] }
            }
        };
        let statusCode = null;
        let body = null;
        const res = {
            status(code) { statusCode = code; return this; },
            json(value) { body = value; return value; }
        };

        await handler(req, res, err => { throw err; });

        assert.equal(statusCode, 400);
        assert.equal(body.ok, false);
        assert.equal(body.reasonCode, 'TOKEN_NOT_FOUND');
        assert.equal(body.wouldMutateCrm, false);
    });

    it('wires Hermes preview and callback dry-run routes before productId routes', async () => {
        const { server, baseUrl } = await listen(createDryRunApp());
        try {
            const capabilities = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(capabilities.status, 200);
            assert.equal(capabilities.data.endpoints.menuPhotos.approvalPreview, 'POST /api/hermes/menu-photos/approval-card/preview');
            assert.equal(capabilities.data.endpoints.menuPhotos.approvalCallbackData, 'egmp:<token>');
            assert.ok(capabilities.data.supportedActions.includes('menu_photos.approval.preview'));
            assert.ok(capabilities.data.supportedActions.includes('menu_photos.approval.callback_dry_run'));

            const preview = await request(baseUrl, 'POST', '/api/hermes/menu-photos/approval-card/preview', {
                productId: 'menu-123',
                productName: 'Паста з мітболами',
                draftImageUrl: '/uploads/catalog-images/items/draft-v3.png',
                draftId: 'draft-menu-123-v3',
                dishReviewId: 'review-menu-123-v3',
                cardId: 'card-menu-123-v3',
                revision: 3,
                allowedActorIds: ['4']
            });
            assert.equal(preview.status, 200);
            assert.equal(preview.data.mode, 'menu_photo_approval_card_preview');
            assert.equal(preview.data.liveSideEffects, false);
            assert.match(preview.data.tokens.approve.callbackData, /^egmp:/);

            const callback = await request(baseUrl, 'POST', '/api/hermes/menu-photos/approval-card/callback-dry-run', {
                callbackData: preview.data.tokens.approve.callbackData,
                state: {
                    cards: { [preview.data.card.cardId]: preview.data.card },
                    tokens: Object.fromEntries(Object.values(preview.data.tokenRecords).map(record => [record.token, record])),
                    processedCallbacks: {},
                    events: [],
                    generationJobs: [],
                    pendingInputs: {},
                    crmWrites: 0
                }
            });
            assert.equal(callback.status, 200);
            assert.equal(callback.data.card.status, STATUS.APPROVED_PENDING_APPLY);
            assert.equal(callback.data.wouldMutateCrm, false);
        } finally {
            await close(server);
        }
    });
});
