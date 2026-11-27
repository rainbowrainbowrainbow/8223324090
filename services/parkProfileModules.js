'use strict';

const { posix } = require('node:path');

const PARK_PROFILE_MODULES = Object.freeze({
    taskPlanning: 'active',
    results: 'active',
    salary: 'active',
    gamification: 'disabled-for-park',
    habits: 'disabled-for-park',
    contribution: 'disabled-for-park',
    impacts: 'disabled-for-park',
    dependencyEditor: 'disabled-for-park',
    timeTracking: 'disabled-for-park',
    legacyTimerRecovery: 'active'
});

const LEGACY_GAME_API = Object.freeze([
    '/api/gamification', '/api/wallet', '/api/achievements', '/api/shop',
    '/api/inventory', '/api/profile/equip', '/api/profile/unequip', '/api/profile/:id',
    '/api/quests', '/api/streaks', '/api/minigame', '/api/quiz', '/api/room'
]);

const GAMIFICATION_PAGE_PATH = /^\/(?:game|quiz|room|shop)(?:\.html)?\/?$/i;

function mountParkGamificationPageBoundary(app, gamification = PARK_PROFILE_MODULES.gamification) {
    if (gamification === 'active') return;
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let pathname;
        try {
            pathname = posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/'));
        } catch {
            return next();
        }
        if (!GAMIFICATION_PAGE_PATH.test(pathname)) return next();
        return res.set('Cache-Control', 'no-store').redirect(302, '/profile?tab=myday');
    });
}

function moduleUnavailable(_req, res) {
    return res.status(410).json({ error: 'This module is unavailable in the park build', code: 'MODULE_UNAVAILABLE' });
}

function mountParkProfileBoundaries(app) {
    if (PARK_PROFILE_MODULES.gamification !== 'active') app.use(LEGACY_GAME_API, moduleUnavailable);
    app.use('/api/my-day', (req, res, next) => {
        // Preserve read compatibility for older Park clients.
        const recoveryRead = req.method === 'GET' && req.path === '/timer';
        const fullTracking = PARK_PROFILE_MODULES.timeTracking === 'active';
        const legacyPath = /^\/(timer|time-entries)(\/|$)/i.test(req.path);
        if (legacyPath) return fullTracking || recoveryRead ? next() : moduleUnavailable(req, res);
        if (req.path.startsWith('/habits') && PARK_PROFILE_MODULES.habits === 'active') return next();
        if (PARK_PROFILE_MODULES.impacts === 'active' && PARK_PROFILE_MODULES.contribution === 'active') return next();
        return moduleUnavailable(req, res);
    });
}

module.exports = { PARK_PROFILE_MODULES, mountParkGamificationPageBoundary, mountParkProfileBoundaries };
