'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createTelegramCrmIdentity, failure, telegramId } = require('../services/telegramCrmIdentity');
const { createLogger } = require('../utils/logger');
const log = createLogger('TelegramCRM');

function serviceSecretMatches(header, expected) {
    if (typeof expected !== 'string' || !expected.trim() || typeof header !== 'string') return false;
    const match = /^Bearer ([^\s]+)$/.exec(header);
    if (!match) return false;
    const digest = value => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(match[1]), digest(expected));
}

function requestId(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw failure(400, 'TELEGRAM_REQUEST_INVALID', 'Недійсний номер операції.');
    }
    return value;
}

function endpoint(work, successStatus = 200) {
    return async (req, res) => {
        const diagnosticId = crypto.randomUUID();
        try {
            const result = await work(req);
            return res.status(successStatus).json({ success: true, ...result });
        } catch (error) {
            const safe = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500;
            const disabled = error.code === 'TELEGRAM_CRM_DISABLED';
            if (!safe && !disabled) log.error('Operation failed', { diagnosticId, code: String(error.code || 'internal').slice(0, 80) });
            return res.status(safe || disabled ? error.statusCode : 503).json({
                success: false,
                code: safe || disabled ? error.code : 'TELEGRAM_CRM_UNAVAILABLE',
                error: safe || disabled ? error.message : 'CRM тимчасово недоступна. Повторіть перевірку операції.',
                diagnosticId
            });
        }
    };
}

function createTelegramCrmRouters(options = {}) {
    const pool = options.pool || require('../db').pool;
    const env = options.env || process.env;
    const authenticate = options.authenticate || require('../middleware/auth').authenticateToken;
    const identity = options.identity || createTelegramCrmIdentity({ pool });
    const tasks = options.tasks || require('../services/telegramCrmTasks').createTelegramCrmTasks({ pool, identity });
    const account = express.Router();
    const bot = express.Router();
    const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
    account.use(noStore, authenticate);
    const reauthLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false,
        keyGenerator: req => String(req.user.id),
        message: { success: false, code: 'TELEGRAM_REAUTH_LIMIT', error: 'Забагато спроб. Повторіть через 15 хвилин.' }
    });
    account.get('/', endpoint(req => identity.status(req.user)));
    account.post('/link', reauthLimiter, endpoint(req => identity.begin(req.user, req.body?.password), 201));
    account.post('/link/status', endpoint(req => identity.pending(req.user, requestId(req.body?.requestId), req.body?.browserProof)));
    account.post('/link/confirm', endpoint(req => identity.confirm(req.user, {
        requestId: requestId(req.body?.requestId), browserProof: req.body?.browserProof
    })));
    account.post('/disconnect', reauthLimiter, endpoint(req => identity.disconnect(req.user, req.body?.password)));

    // Dedicated route guard: a CRM JWT or a user-supplied sender ID alone never works.
    // Existing Hermes credentials authenticate the service; they never select a human actor.
    bot.use(noStore, (req, res, next) => {
        if (!serviceSecretMatches(req.headers.authorization, env.HERMES_API_KEY)) {
            return res.status(401).json({ success: false, code: 'TELEGRAM_SERVICE_AUTH_REQUIRED', error: 'Service authentication required' });
        }
        try {
            req.telegramSenderId = telegramId(req.headers['x-telegram-user-id']);
            // Timestamp comes from the trusted update transport, never query/body text.
            const timestamp = req.headers['x-telegram-event-at'];
            if (timestamp !== undefined && (!/^\d{10}$/.test(timestamp) || Number(timestamp) > Date.now() / 1000 + 30)) {
                throw failure(400, 'TELEGRAM_EVENT_INVALID', 'Некоректний час повідомлення.');
            }
            req.telegramEventAt = timestamp === undefined ? null : Number(timestamp);
            if (req.headers['x-telegram-chat-type'] !== 'private'
                || telegramId(req.headers['x-telegram-chat-id']) !== req.telegramSenderId) {
                throw failure(403, 'TELEGRAM_PRIVATE_REQUIRED', 'CRM доступна тільки в особистому чаті.');
            }
            next();
        } catch (error) {
            res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
        }
    });
    bot.use(rateLimit({ windowMs: 60000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false,
        keyGenerator: req => req.telegramSenderId,
        message: { success: false, code: 'TELEGRAM_REQUEST_LIMIT', error: 'Забагато запитів. Повторіть за хвилину.' } }));
    bot.post('/link/claim', endpoint(req => identity.claim({
        token: req.body?.token, senderId: req.telegramSenderId,
        username: req.body?.username, privateChat: true
    })));
    bot.get('/me', endpoint(req => tasks.me(req.telegramSenderId, req.query.businessContext, req.telegramEventAt)));
    bot.get('/tasks', endpoint(req => tasks.list(req.telegramSenderId, { ...req.query, eventAt: req.telegramEventAt })));
    bot.get('/owners', endpoint(req => tasks.owners(req.telegramSenderId, req.query.businessContext, req.telegramEventAt)));
    bot.post('/tasks/preview', endpoint(req => tasks.preview(req.telegramSenderId, { ...req.body, eventAt: req.telegramEventAt }), 201));
    bot.get('/operations/:id', endpoint(req => tasks.operation(req.telegramSenderId, requestId(req.params.id))));
    bot.post('/operations/:id/confirm', endpoint(req => tasks.commit(req.telegramSenderId, requestId(req.params.id), req.body?.confirmed)));
    bot.post('/operations/:id/cancel', endpoint(req => tasks.cancel(req.telegramSenderId, requestId(req.params.id))));

    return { account, bot, identity };
}

let defaultRouters;
function getRouters() {
    if (!defaultRouters) defaultRouters = createTelegramCrmRouters();
    return defaultRouters;
}
module.exports = { createTelegramCrmRouters, endpoint, getRouters, requestId, serviceSecretMatches };
