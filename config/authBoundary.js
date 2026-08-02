const INTEGRATION_AUTH_CONTRACTS = Object.freeze({
    telegramWebhook: { owner: 'telegram', authentication: 'webhook secret header', guardFiles: [{ file: 'routes/telegram.js', needles: ["router.post('/webhook'", 'secretHeader !== WEBHOOK_SECRET'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    omniWebhooks: { owner: 'omnichannel', authentication: 'provider secret or signature', guardFiles: [{ file: 'routes/omnichannel.js', needles: ['verifyViberSignature', 'verifyWebhookSecret', 'verifyMetaSignature'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/omni-provider-lifecycle.test.js'] },
    reportBotWebhook: { owner: 'report-bot', authentication: 'webhook secret header', guardFiles: [{ file: 'routes/report-bot.js', needles: ["router.post('/webhook'", 'secretHeader !== expectedSecret'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    reportBotApi: { owner: 'report-bot', authentication: 'bot API key', guardFiles: [{ file: 'routes/report-bot.js', needles: ['async function requireBotApiKey', "router.post('/submit', requireBotApiKey"] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    hermesApi: { owner: 'hermes', authentication: 'API key or bearer secret', guardFiles: [{ file: 'middleware/hermesAuth.js', needles: ['function createHermesAuthMiddleware', 'timingSafeSecretEqual'] }, { file: 'routes/hermes.js', needles: ['router.use(authMiddleware)'] }], testFiles: ['tests/hermes-auth.test.js', 'tests/auth-boundary.test.js'] },
    personalAccountsBot: { owner: 'personal-accounts', authentication: 'bot API key or user JWT', guardFiles: [{ file: 'routes/personal-accounts.js', needles: ['function isBotAuth', 'function optionalJwt', 'function verifyAccess'] }], testFiles: ['tests/personal-accounts-jwt-telegram.test.js', 'tests/route-smoke.test.js'] },
    kleshnyaBridge: { owner: 'kleshnya', authentication: 'integration webhook secret', guardFiles: [{ file: 'routes/kleshnya.js', needles: ['KLESHNYA_WEBHOOK_SECRET', "router.get('/pending-messages'", "router.post('/sync-chat'", "router.post('/webhook'"] }], testFiles: ['tests/kleshnya.test.js', 'tests/route-smoke.test.js'] },
    kieCallback: { owner: 'music', authentication: 'callback secret', guardFiles: [{ file: 'routes/music.js', needles: ["router.post('/library/generate-music/callback'", 'KIE_CALLBACK_SECRET'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    universalLeadWebhook: { owner: 'leads', authentication: 'universal webhook token', guardFiles: [{ file: 'routes/leads.js', needles: ['async function handleUniversalWebhook', 'timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    maysternyaBookingWebhook: { owner: 'leads', authentication: 'universal webhook token', guardFiles: [{ file: 'routes/leads.js', needles: ['async function handleMaysternyaBookingWebhook', 'timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] },
    maysternyaAvailabilityWebhook: { owner: 'leads', authentication: 'universal webhook token', guardFiles: [{ file: 'routes/leads.js', needles: ['async function handleMaysternyaAvailabilityWebhook', 'timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)'] }], testFiles: ['tests/auth-boundary.test.js', 'tests/route-smoke.test.js'] }
});

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
        path: '/ready',
        owner: 'settings',
        reason: 'Public readiness endpoint verifies database and schema compatibility before/after deploy.'
    },
    {
        method: 'GET',
        path: '/health/deep',
        owner: 'settings',
        reason: 'Public deep health endpoint exposes schema diagnostics for release smoke checks.'
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
        integrationContract: 'telegramWebhook',
        reason: 'Telegram webhook is guarded by provider secret validation instead of JWT.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/telegram',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Omni Telegram inbox webhook must accept Telegram provider updates before CRM user JWT exists.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/viber',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Omni Viber webhook is guarded by a required provider HMAC signature before inbox processing.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/sms',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Omni SMS webhook is guarded by a required provider secret before inbox processing.'
    },
    {
        method: 'GET',
        path: '/omni/webhook/meta',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Meta webhook verification requires the configured provider verify token before returning a challenge.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/meta',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Omni Meta webhook is guarded by a required provider HMAC signature before inbox processing.'
    },
    {
        method: 'POST',
        path: '/omni/webhook/binotel',
        owner: 'omnichannel',
        integrationContract: 'omniWebhooks',
        reason: 'Omni Binotel webhook is guarded by a required provider secret before inbox processing.'
    },
    {
        method: 'POST',
        path: '/report-bot/webhook',
        owner: 'report-bot',
        integrationContract: 'reportBotWebhook',
        reason: 'Report-bot webhook is guarded by Telegram webhook secret validation instead of JWT.'
    },
    {
        method: 'POST',
        path: '/report-bot/submit',
        owner: 'report-bot',
        integrationContract: 'reportBotApi',
        reason: 'Report-bot submit is guarded by the bot API key instead of user JWT.'
    },
    {
        method: 'GET',
        path: '/report-bot/on-duty',
        owner: 'report-bot',
        integrationContract: 'reportBotApi',
        reason: 'Report bot read endpoint is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/summary',
        owner: 'report-bot',
        integrationContract: 'reportBotApi',
        reason: 'Report bot read endpoint is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/accounts',
        owner: 'report-bot',
        integrationContract: 'reportBotApi',
        reason: 'Report bot account lookup is guarded inside the route by bot API key policy.'
    },
    {
        method: 'GET',
        path: '/report-bot/submissions',
        owner: 'report-bot',
        integrationContract: 'reportBotApi',
        reason: 'Report bot submission lookup is guarded inside the route by bot API key policy.'
    },
    {
        prefix: '/hermes/',
        owner: 'hermes',
        integrationContract: 'hermesApi',
        reason: 'Hermes integration is custom-secret guarded: the central JWT boundary lets requests reach routes/hermes.js, which validates x-api-key or Bearer secret before any response.'
    },
    {
        method: 'POST',
        path: '/personal-accounts/sync',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot personal-account sync uses bot/API-key authorization inside the route.'
    },
    {
        method: 'GET',
        path: '/personal-accounts/my',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot personal account lookup uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        regex: /^\/personal-accounts\/[^/]+\/grant$/,
        label: 'POST /personal-accounts/:accountId/grant',
        examplePath: '/personal-accounts/1/grant',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot personal-account grant uses bot/API-key authorization inside the route.'
    },
    {
        method: 'DELETE',
        regex: /^\/personal-accounts\/[^/]+\/access\/[^/]+$/,
        label: 'DELETE /personal-accounts/:accountId/access/:userId',
        examplePath: '/personal-accounts/1/access/2',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot personal-account access removal uses bot/API-key authorization inside the route.'
    },
    {
        method: 'GET',
        regex: /^\/personal-accounts\/[^/]+\/transactions$/,
        label: 'GET /personal-accounts/:accountId/transactions',
        examplePath: '/personal-accounts/1/transactions',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot transaction lookup uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        regex: /^\/personal-accounts\/[^/]+\/transactions$/,
        label: 'POST /personal-accounts/:accountId/transactions',
        examplePath: '/personal-accounts/1/transactions',
        owner: 'personal-accounts',
        integrationContract: 'personalAccountsBot',
        reason: 'Report-bot transaction submission uses bot/API-key authorization inside the route.'
    },
    {
        method: 'POST',
        path: '/kleshnya/webhook',
        owner: 'kleshnya',
        integrationContract: 'kleshnyaBridge',
        reason: 'Kleshnya webhook is provider/bridge controlled rather than user JWT controlled.'
    },
    {
        method: 'GET',
        path: '/kleshnya/pending-messages',
        owner: 'kleshnya',
        integrationContract: 'kleshnyaBridge',
        reason: 'Kleshnya bridge polling endpoint is controlled by bridge route policy.'
    },
    {
        method: 'POST',
        path: '/kleshnya/sync-chat',
        owner: 'kleshnya',
        integrationContract: 'kleshnyaBridge',
        reason: 'Kleshnya bridge sync endpoint is controlled by bridge route policy.'
    },
    {
        method: 'POST',
        path: '/music/library/generate-music/callback',
        owner: 'music',
        integrationContract: 'kieCallback',
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
        integrationContract: 'universalLeadWebhook',
        reason: 'External lead capture webhook is guarded by UNIVERSAL_WEBHOOK_TOKEN instead of user JWT.'
    },
    {
        method: 'POST',
        path: '/leads/webhook/maysternya-booking',
        owner: 'leads',
        integrationContract: 'maysternyaBookingWebhook',
        reason: 'Maysternya Doli bot booking webhook is guarded by UNIVERSAL_WEBHOOK_TOKEN and creates scoped timeline bookings without user JWT.'
    },
    {
        method: 'POST',
        path: '/leads/webhook/maysternya-availability',
        owner: 'leads',
        integrationContract: 'maysternyaAvailabilityWebhook',
        reason: 'Maysternya Doli bot availability webhook is guarded by UNIVERSAL_WEBHOOK_TOKEN and exposes scoped booking slots without user JWT.'
    },
    {
        method: 'GET',
        path: '/leads/webhook/status',
        owner: 'leads',
        reason: 'Read-only webhook readiness endpoint exposes configured flags and dry-run instructions without secrets for external delivery smoke checks.'
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
    INTEGRATION_AUTH_CONTRACTS,
    PUBLIC_API_ROUTES,
    QUERY_TOKEN_AUTH_ROUTES
};
