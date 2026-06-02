const PUBLIC_API_ROUTES = [
    {
        prefix: '/auth/',
        owner: 'auth',
        reason: 'Authentication endpoints own their own login, refresh, logout, and credential guards.'
    },
    {
        method: 'GET',
        path: '/health',
        owner: 'settings',
        reason: 'Public health endpoint for uptime checks and lightweight operational smoke.'
    },
    {
        method: 'GET',
        path: '/version',
        owner: 'settings',
        reason: 'Public version endpoint used by clients and smoke checks.'
    },
    {
        method: 'POST',
        path: '/telegram/webhook',
        owner: 'telegram',
        reason: 'Telegram webhook is guarded by provider secret validation instead of JWT.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/telegram',
        owner: 'omnichannel',
        reason: 'Omni Telegram inbox webhook must accept Telegram provider updates before CRM user JWT exists.'
    },
    {
        method: 'POST',
        path: '/report-bot/webhook',
        owner: 'report-bot',
        reason: 'Report-bot webhook is guarded by Telegram webhook secret validation instead of JWT.'
    },
    {
        method: 'POST',
        path: '/report-bot/submit',
        owner: 'report-bot',
        reason: 'Report-bot submit is guarded by the bot API key instead of user JWT.'
    },
    {
        method: 'GET',
        path: '/report-bot/on-duty',
        owner: 'report-bot',
        reason: 'Report bot read endpoint is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/summary',
        owner: 'report-bot',
        reason: 'Report bot read endpoint is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/accounts',
        owner: 'report-bot',
        reason: 'Report bot account lookup is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/submissions',
        owner: 'report-bot',
        reason: 'Report bot submission lookup is guarded inside the route by bot API key policy.'
    },
    {
        method: 'POST',
        path: '/personal-accounts/sync',
        owner: 'personal-accounts',
        reason: 'Report-bot personal-account sync uses bot/API-key authorization inside the route.'
    },
    {
        method: 'GET',
        path: '/personal-accounts/my',
        owner: 'personal-accounts',
        reason: 'Report-bot personal account lookup uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        regex: /^\/personal-accounts\/[^/]+\/grant$/,
        label: 'POST /personal-accounts/:accountId/grant',
        examplePath: '/personal-accounts/1/grant',
        owner: 'personal-accounts',
        reason: 'Report-bot personal-account grant uses bot/API-key authorization inside the route.'
    },
    {
        method: 'DELETE',
        regex: /^\/personal-accounts\/[^/]+\/access\/[^/]+$/,
        label: 'DELETE /personal-accounts/:accountId/access/:userId',
        examplePath: '/personal-accounts/1/access/2',
        owner: 'personal-accounts',
        reason: 'Report-bot personal-account access removal uses bot/API-key authorization inside the route.'
    },
    {
        method: 'GET',
        regex: /^\/personal-accounts\/[^/]+\/transactions$/,
        label: 'GET /personal-accounts/:accountId/transactions',
        examplePath: '/personal-accounts/1/transactions',
        owner: 'personal-accounts',
        reason: 'Report-bot transaction lookup uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        regex: /^\/personal-accounts\/[^/]+\/transactions$/,
        label: 'POST /personal-accounts/:accountId/transactions',
        examplePath: '/personal-accounts/1/transactions',
        owner: 'personal-accounts',
        reason: 'Report-bot transaction submission uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        path: '/kleshnya/webhook',
        owner: 'kleshnya',
        reason: 'Kleshnya webhook is provider/bridge controlled rather than user JWT controlled.'
    },
    {
        method: 'GET',
        path: '/kleshnya/pending-messages',
        owner: 'kleshnya',
        reason: 'Kleshnya bridge polling endpoint is controlled by bridge route policy.'
    },
    {
        method: 'POST',
        path: '/kleshnya/sync-chat',
        owner: 'kleshnya',
        reason: 'Kleshnya bridge sync endpoint is controlled by bridge route policy.'
    },
    {
        method: 'POST',
        path: '/music/library/generate-music/callback',
        owner: 'music',
        reason: 'Kie.ai Suno callback is guarded by KIE_CALLBACK_SECRET before any payload is accepted.'
    },
    {
        method: 'POST',
        path: '/demo/login',
        owner: 'demo',
        reason: 'Demo login is intentionally public and issues its own demo session.'
    },
    {
        method: 'GET',
        path: '/demo/scenarios',
        owner: 'demo',
        reason: 'Demo scenarios are public read-only demo metadata.'
    },
    {
        method: 'GET',
        path: '/packages',
        owner: 'packages',
        reason: 'Public landing/package materials need unauthenticated package reads.'
    },
    {
        method: 'GET',
        path: '/status/public',
        owner: 'status',
        reason: 'Public status page uses this read-only endpoint without user JWT.'
    },
    {
        method: 'POST',
        path: '/leads/landing',
        owner: 'leads',
        reason: 'Public landing lead capture endpoint; protected by landing lead limiter.'
    },
    {
        method: 'POST',
        path: '/leads/webhook/universal',
        owner: 'leads',
        reason: 'External lead capture webhook is guarded by UNIVERSAL_WEBHOOK_TOKEN instead of user JWT.'
    },
    {
        method: 'POST',
        path: '/landing/demo-request',
        owner: 'landing',
        reason: 'Public landing demo request endpoint; protected by landing lead limiter.'
    }
];

const QUERY_TOKEN_AUTH_ROUTES = [
    {
        method: 'GET',
        regex: /^\/graduation\/quotes\/[^/]+\/proposal$/,
        label: 'GET /graduation/quotes/:id/proposal',
        examplePath: '/graduation/quotes/123/proposal',
        owner: 'graduation',
        routeFile: 'routes/graduation.js',
        routeNeedles: ["router.get('/quotes/:id/proposal'"],
        clientFile: 'js/graduation.js',
        clientNeedles: ['/graduation/quotes/', '/proposal?token='],
        tests: ['tests/auth-boundary.test.js'],
        reason: 'Proposal HTML is opened with window.open, where the frontend cannot attach an Authorization header.'
    },
    {
        method: 'GET',
        path: '/graduation/catalog/export',
        label: 'GET /graduation/catalog/export',
        examplePath: '/graduation/catalog/export',
        owner: 'graduation',
        routeFile: 'routes/graduation.js',
        routeNeedles: ["router.get('/catalog/export'"],
        clientFile: 'js/graduation.js',
        clientNeedles: ['/api/graduation/catalog/export?token='],
        tests: ['tests/auth-boundary.test.js'],
        reason: 'Print-ready catalog HTML is opened with window.open, where the frontend cannot attach an Authorization header.'
    }
];

module.exports = {
    PUBLIC_API_ROUTES,
    QUERY_TOKEN_AUTH_ROUTES
};
