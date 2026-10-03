const GENERIC_API_ROUTE_MOUNTS = [
    {
        mount: '/api',
        routeFile: 'routes/shop.js',
        owner: 'shop',
        reason: 'Legacy gamification aliases: /api/inventory, /api/profile/:id, and /api/profile/equip live in routes/shop.js.'
    },
    {
        mount: '/api',
        routeFile: 'routes/settings.js',
        owner: 'settings',
        reason: 'Settings router intentionally mounts after feature routers because it owns generic /api/version, /api/health, and settings endpoints.'
    }
];

const NESTED_API_ROUTE_MOUNTS = [
    {
        mount: '/api/finance/costing/management',
        routeFile: 'routes/finance-costing-management.js',
        parentRouteFile: 'routes/finance-costing.js',
        owner: 'finance-costing-management',
        reason: 'Performance and economic reconciliation inherit the costing and finance access guards.'
    },
    {
        mount: '/api/finance/costing/actual',
        routeFile: 'routes/finance-costing-actual.js',
        parentRouteFile: 'routes/finance-costing.js',
        owner: 'finance-costing-actual',
        reason: 'Append-only plan/actual evidence inherits the costing and finance access guards.'
    },
    {
        mount: '/api/finance/costing',
        routeFile: 'routes/finance-costing.js',
        parentRouteFile: 'routes/finance.js',
        owner: 'finance-costing',
        reason: 'Versioned service costing inherits the existing finance role and action guards.'
    },
    {
        mount: '/api/hermes',
        routeFile: 'routes/hermes-schedule.js',
        parentRouteFile: 'routes/hermes.js',
        owner: 'hermes-schedule',
        reason: 'Hermes staff and schedule reads are mounted inside routes/hermes.js after Hermes API-key authentication.'
    }
];

const SERVER_LEVEL_API_ROUTES = [
    {
        method: 'GET',
        path: '/api-docs.json',
        owner: 'swagger',
        reason: 'Swagger JSON is served directly from server.js.'
    },
    {
        method: 'GET',
        path: '/api/shifts/daily-digest',
        owner: 'scheduler',
        reason: 'Operational digest trigger remains an inline server route until scheduler routes are split.'
    }
];

const SERVER_LEVEL_API_MOUNTS = [
    {
        method: 'USE',
        path: '/api-docs',
        owner: 'swagger',
        reason: 'Swagger UI middleware is mounted directly in server.js.'
    }
];

module.exports = {
    GENERIC_API_ROUTE_MOUNTS,
    NESTED_API_ROUTE_MOUNTS,
    SERVER_LEVEL_API_ROUTES,
    SERVER_LEVEL_API_MOUNTS
};
