const API_CACHE_ALLOWLIST = [
    {
        type: 'exact',
        path: '/api/version',
        owner: 'settings',
        reason: 'Public version metadata is non-user-specific and safe for offline smoke reads.'
    },
    {
        type: 'exact',
        path: '/api/status/public',
        owner: 'status',
        reason: 'Public status metadata is intentionally unauthenticated and non-user-specific.'
    }
];

const SENSITIVE_API_PATH_PREFIXES = [
    '/api/auth',
    '/api/backup',
    '/api/telegram',
    '/api/report-bot',
    '/api/finance',
    '/api/chat',
    '/api/hr',
    '/api/customers',
    '/api/reports',
    '/api/report-agent',
    '/api/dashboard',
    '/api/analytics',
    '/api/leads',
    '/api/staff',
    '/api/tasks',
    '/api/bookings',
    '/api/warehouse',
    '/api/designs',
    '/api/sound',
    '/api/profile',
    '/api/users',
    '/api/settings',
    '/api/search',
    '/api/notifications',
    '/api/push',
    '/api/kleshnya',
    '/api/copilot',
    '/api/omni'
];

const MUTATION_QUEUE_ALLOWLIST = [];

const STATIC_RUNTIME_CACHE_ALLOWLIST = [
    {
        type: 'exact',
        path: '/manifest.json',
        owner: 'frontend-shell',
        reason: 'The public web app manifest is non-user-specific.'
    },
    {
        type: 'prefix',
        path: '/css',
        owner: 'frontend-shell',
        reason: 'Versioned application styles are public static assets.'
    },
    {
        type: 'prefix',
        path: '/js',
        owner: 'frontend-shell',
        reason: 'Versioned frontend modules are public static assets.'
    },
    {
        type: 'prefix',
        path: '/images',
        owner: 'frontend-shell',
        reason: 'Repository-owned application images are public static assets.'
    },
    {
        type: 'prefix',
        path: '/assets',
        owner: 'frontend-shell',
        reason: 'Repository-owned application assets are public and non-user-specific.'
    },
    {
        type: 'prefix',
        path: '/landing',
        owner: 'marketing',
        reason: 'Landing-page resources are public and non-user-specific.'
    }
];

const PRIVATE_RUNTIME_PATH_PREFIXES = ['/uploads'];

const APP_SHELL_POLICY = {
    installAssets: [
        '/index.html',
        '/manifest.json',
        '/css/base.css',
        '/css/auth.css',
        '/css/layout.css',
        '/css/dark-mode.css',
        '/css/responsive.css'
    ],
    offlineFallbackUrl: '/index.html',
    navigationStrategy: 'network-first',
    staticRuntimeStrategy: 'explicit-public-allowlist',
    reason: 'Keep install small while caching only reviewed public assets; uploads and unknown runtime paths remain network-only.'
};

const SERVICE_WORKER_POLICY = {
    file: 'sw.js',
    doc: 'docs/SERVICE_WORKER_CACHE_POLICY.md',
    testFile: 'tests/service-worker-policy.test.js',
    runtimeCacheNames: ['CACHE_NAME', 'API_CACHE_NAME'],
    privateCacheClearMessage: 'CLEAR_PRIVATE_CACHES',
    invalidationMessage: 'INVALIDATE_CACHE',
    offlineDatabaseName: 'park-offline',
    apiPolicy: 'default-deny',
    mutationReplayPolicy: 'disabled-until-reviewed',
    staticRuntimePolicy: 'default-deny',
    appShellPolicy: APP_SHELL_POLICY,
    reason: 'Authenticated CRM data must stay network-only unless a public endpoint is explicitly reviewed.'
};

function runtimeApiAllowlist() {
    return API_CACHE_ALLOWLIST.map(({ type, path }) => ({ type, path }));
}

function runtimeStaticAllowlist() {
    return STATIC_RUNTIME_CACHE_ALLOWLIST.map(({ type, path }) => ({ type, path }));
}

module.exports = {
    API_CACHE_ALLOWLIST,
    APP_SHELL_POLICY,
    MUTATION_QUEUE_ALLOWLIST,
    PRIVATE_RUNTIME_PATH_PREFIXES,
    SENSITIVE_API_PATH_PREFIXES,
    SERVICE_WORKER_POLICY,
    STATIC_RUNTIME_CACHE_ALLOWLIST,
    runtimeApiAllowlist,
    runtimeStaticAllowlist
};
