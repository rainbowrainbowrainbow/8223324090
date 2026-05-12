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
    SERVER_LEVEL_API_ROUTES,
    SERVER_LEVEL_API_MOUNTS
};
