'use strict';

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
    '/api/quests', '/api/streaks'
]);

function moduleUnavailable(_req, res) {
    return res.status(410).json({ error: 'This module is unavailable in the park build', code: 'MODULE_UNAVAILABLE' });
}

function mountParkProfileBoundaries(app) {
    if (PARK_PROFILE_MODULES.gamification !== 'active') app.use(LEGACY_GAME_API, moduleUnavailable);
    app.use('/api/my-day', (req, res, next) => {
        // Keep the read/stop path so an existing session is never left running invisibly.
        const recoveryRead = req.method === 'GET' && req.path === '/timer';
        const recoveryStop = req.method === 'POST' && req.path === '/timer/stop';
        const fullTracking = PARK_PROFILE_MODULES.timeTracking === 'active';
        const legacyPath = /^\/(timer|time-entries)(\/|$)/i.test(req.path);
        if (legacyPath) return fullTracking || recoveryRead || recoveryStop ? next() : moduleUnavailable(req, res);
        if (req.path.startsWith('/habits') && PARK_PROFILE_MODULES.habits === 'active') return next();
        if (PARK_PROFILE_MODULES.impacts === 'active' && PARK_PROFILE_MODULES.contribution === 'active') return next();
        return moduleUnavailable(req, res);
    });
}

module.exports = { PARK_PROFILE_MODULES, mountParkProfileBoundaries };
