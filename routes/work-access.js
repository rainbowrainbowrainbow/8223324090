'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { resolveBusinessScope, BUSINESS_SCOPE_SINGLE } = require('../services/businessContext');
const { loadAccountWorkReadiness } = require('../services/accountWorkReadiness');
const { checkAuthenticatedWorkReads } = require('../services/authenticatedWorkReads');
const inFlight = new Set();

router.use(authenticateToken);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

function policySignature(readiness) {
    const { data, ...policy } = readiness.checks;
    return JSON.stringify([readiness.businessContext, policy]);
}

router.post('/check', async (req, res) => {
    const userId = Number(req.user?.id || req.user?.userId);
    const scope = resolveBusinessScope(req);
    if (scope.invalid || scope.mode !== BUSINESS_SCOPE_SINGLE || scope.activeContext !== 'event_genix') {
        return res.status(403).json({ success: false, code: 'work_context_required',
            error: 'Оберіть Парк, щоб перевірити робочий доступ.' });
    }
    if (Object.keys(req.body || {}).length) {
        return res.status(400).json({ success: false, error: 'Перевірка доступна лише для власного акаунта.' });
    }
    if (inFlight.has(userId) || inFlight.size >= 256) {
        return res.status(429).json({ success: false, error: 'Перевірка вже триває. Повторіть пізніше.' });
    }
    inFlight.add(userId);
    try {
        const options = { userId, businessContext: scope.activeContext };
        const before = await loadAccountWorkReadiness(pool, options);
        if (Object.entries(before.checks).some(([key, check]) => key !== 'data' && !check.passed)) {
            return res.json({ success: true, readiness: before, checkedAt: new Date().toISOString() });
        }
        const reads = await checkAuthenticatedWorkReads(req, options);
        const after = await loadAccountWorkReadiness(pool, { ...options, authenticatedReadChecks: reads });
        if (policySignature(before) !== policySignature(after)) {
            const stale = reads.map(read => ({ ...read, passed: false, status: 'context_changed', code: 'work_context_changed' }));
            const current = await loadAccountWorkReadiness(pool, { ...options, authenticatedReadChecks: stale });
            return res.json({ success: true, readiness: current, checkedAt: new Date().toISOString() });
        }
        return res.json({ success: true, readiness: after, checkedAt: new Date().toISOString() });
    } catch {
        return res.status(503).json({ success: false, code: 'work_check_unavailable',
            error: 'Не вдалося завершити перевірку доступу. Повторіть пізніше.' });
    } finally { inFlight.delete(userId); }
});

module.exports = router;
