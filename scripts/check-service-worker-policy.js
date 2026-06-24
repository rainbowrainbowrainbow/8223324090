#!/usr/bin/env node
/**
 * Service Worker cache and offline policy guard.
 *
 * This check keeps sw.js runtime policy, docs, and focused tests aligned so
 * authenticated CRM API data remains network-only by default.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
    API_CACHE_ALLOWLIST,
    MUTATION_QUEUE_ALLOWLIST,
    SENSITIVE_API_PATH_PREFIXES,
    SERVICE_WORKER_POLICY,
    runtimeApiAllowlist
} = require('../config/serviceWorkerPolicy');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
    failures.push(message);
}

function repoPath(file) {
    return path.join(ROOT, file);
}

function exists(file) {
    return fs.existsSync(repoPath(file));
}

function read(file) {
    return fs.readFileSync(repoPath(file), 'utf8');
}

function docIncludes(doc, value) {
    return doc.includes(`\`${value}\``) || doc.includes(value);
}

function ensureDocMentions(doc, value, label) {
    if (!docIncludes(doc, value)) fail(`${label}: ${value} missing from ${SERVICE_WORKER_POLICY.doc}`);
}

function ensureFile(file, label) {
    if (!exists(file)) fail(`${label}: ${file} does not exist`);
}

function stripOwners(entries) {
    return entries.map(({ type, path }) => ({ type, path }));
}

function compareJson(label, actual, expected) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        fail(`${label} mismatch; actual ${actualJson}; expected ${expectedJson}`);
    }
}

function loadRuntimePolicy(swSource) {
    const listeners = {};
    const context = {
        console,
        URL,
        Request,
        Response,
        fetch: async () => new Response('{}', { status: 200 }),
        caches: {
            async keys() { return []; },
            async open() {
                return {
                    async addAll() {},
                    async add() {},
                    async put() {},
                    async delete() {},
                    async match() { return null; }
                };
            },
            async match() { return null; },
            async delete() { return true; }
        },
        indexedDB: {
            deleteDatabase() {
                const request = {};
                process.nextTick(() => request.onsuccess && request.onsuccess());
                return request;
            }
        },
        self: {
            location: { origin: 'https://event-genix.test' },
            addEventListener(type, handler) { listeners[type] = handler; },
            skipWaiting() {},
            registration: { showNotification: async () => {} },
            clients: {
                claim: async () => {},
                matchAll: async () => [],
                openWindow: async () => {}
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(`${swSource}
        self.__policy = {
            API_CACHE_ALLOWLIST,
            SENSITIVE_API_PATH_PREFIXES,
            MUTATION_QUEUE_ALLOWLIST,
            CACHE_NAME,
            API_CACHE_NAME,
            OFFLINE_DB_NAME,
            isApiCacheAllowed,
            isMutationQueueAllowed,
            isSensitiveApiPath,
            clearPrivateCaches
        };
    `, context, { filename: SERVICE_WORKER_POLICY.file });

    return context.self.__policy;
}

function get(pathname, headers = {}) {
    return new Request(`https://event-genix.test${pathname}`, { method: 'GET', headers });
}

function post(pathname) {
    return new Request(`https://event-genix.test${pathname}`, { method: 'POST' });
}

ensureFile(SERVICE_WORKER_POLICY.file, 'service worker');
ensureFile(SERVICE_WORKER_POLICY.doc, 'service worker docs');
ensureFile(SERVICE_WORKER_POLICY.testFile, 'service worker tests');

const swSource = exists(SERVICE_WORKER_POLICY.file) ? read(SERVICE_WORKER_POLICY.file) : '';
const doc = exists(SERVICE_WORKER_POLICY.doc) ? read(SERVICE_WORKER_POLICY.doc) : '';
const test = exists(SERVICE_WORKER_POLICY.testFile) ? read(SERVICE_WORKER_POLICY.testFile) : '';
const packageJson = JSON.parse(read('package.json'));
const runtime = swSource ? loadRuntimePolicy(swSource) : null;

if (!packageJson.scripts['check:service-worker-policy']) {
    fail('package.json must define check:service-worker-policy');
}
if (!packageJson.scripts.verify.includes('check:service-worker-policy')) {
    fail('package.json verify script must include check:service-worker-policy');
}

if (!doc) fail(`${SERVICE_WORKER_POLICY.doc} is required`);
ensureDocMentions(doc, 'config/serviceWorkerPolicy.js', 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.file, 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.testFile, 'service worker policy docs');
ensureDocMentions(doc, 'npm run check:service-worker-policy', 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.privateCacheClearMessage, 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.invalidationMessage, 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.offlineDatabaseName, 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.apiPolicy, 'service worker policy docs');
ensureDocMentions(doc, SERVICE_WORKER_POLICY.mutationReplayPolicy, 'service worker policy docs');

for (const entry of API_CACHE_ALLOWLIST) {
    const label = `API cache allowlist ${entry.path}`;
    if (!entry.type || !entry.path || !entry.owner || !entry.reason) fail(`${label}: incomplete manifest entry`);
    if (entry.type !== 'exact') fail(`${label}: only exact API cache entries are currently allowed`);
    if (!entry.path.startsWith('/api/')) fail(`${label}: path must start with /api/`);
    ensureDocMentions(doc, entry.path, label);
}

for (const prefix of SENSITIVE_API_PATH_PREFIXES) {
    if (!prefix.startsWith('/api/')) fail(`sensitive API prefix ${prefix}: must start with /api/`);
    ensureDocMentions(doc, prefix, `sensitive API prefix ${prefix}`);
}

if (MUTATION_QUEUE_ALLOWLIST.length !== 0) {
    fail('MUTATION_QUEUE_ALLOWLIST must remain empty until a reviewed endpoint is documented with conflict handling');
}

if (runtime) {
    compareJson('runtime API cache allowlist', runtime.API_CACHE_ALLOWLIST, runtimeApiAllowlist());
    compareJson('runtime sensitive API prefixes', runtime.SENSITIVE_API_PATH_PREFIXES, SENSITIVE_API_PATH_PREFIXES);
    compareJson('runtime mutation queue allowlist', runtime.MUTATION_QUEUE_ALLOWLIST, MUTATION_QUEUE_ALLOWLIST);

    if (runtime.OFFLINE_DB_NAME !== SERVICE_WORKER_POLICY.offlineDatabaseName) {
        fail(`OFFLINE_DB_NAME mismatch; actual ${runtime.OFFLINE_DB_NAME}; expected ${SERVICE_WORKER_POLICY.offlineDatabaseName}`);
    }

    for (const entry of runtimeApiAllowlist()) {
        if (!runtime.isApiCacheAllowed(get(entry.path))) {
            fail(`${entry.path}: allowlisted public GET is not cache-allowed at runtime`);
        }
        if (runtime.isApiCacheAllowed(get(entry.path, { Authorization: 'Bearer token' }))) {
            fail(`${entry.path}: Authorization header must force network-only runtime behavior`);
        }
    }

    for (const prefix of SENSITIVE_API_PATH_PREFIXES) {
        if (!runtime.isSensitiveApiPath(prefix)) fail(`${prefix}: runtime isSensitiveApiPath returned false`);
        if (runtime.isApiCacheAllowed(get(prefix))) fail(`${prefix}: sensitive API path must be network-only`);
        if (runtime.isMutationQueueAllowed(post(prefix))) fail(`${prefix}: sensitive mutation must not be queued offline`);
    }
}

if (!swSource.includes(SERVICE_WORKER_POLICY.privateCacheClearMessage)) {
    fail(`${SERVICE_WORKER_POLICY.file}: ${SERVICE_WORKER_POLICY.privateCacheClearMessage} message missing`);
}
if (!swSource.includes(SERVICE_WORKER_POLICY.invalidationMessage)) {
    fail(`${SERVICE_WORKER_POLICY.file}: ${SERVICE_WORKER_POLICY.invalidationMessage} message missing`);
}
if (!swSource.includes('requestHasAuthorization')) {
    fail(`${SERVICE_WORKER_POLICY.file}: Authorization cache bypass helper missing`);
}
if (!swSource.includes('clearPrivateCaches')) {
    fail(`${SERVICE_WORKER_POLICY.file}: private cache clear helper missing`);
}
if (!/addEventListener\('message'[\s\S]*CLEAR_PRIVATE_CACHES[\s\S]*event\.waitUntil\(clearPromise\)/.test(swSource)) {
    fail(`${SERVICE_WORKER_POLICY.file}: CLEAR_PRIVATE_CACHES message must wait for clearPrivateCaches`);
}
if (!/clearPrivateCaches[\s\S]*name === API_CACHE_NAME \|\| name\.startsWith\(API_CACHE_PREFIX\)[\s\S]*caches\.delete\(name\)[\s\S]*clearOfflineMutationQueue\(\)/.test(swSource)) {
    fail(`${SERVICE_WORKER_POLICY.file}: private cleanup must delete API cache namespace and clear offline DB`);
}
if (!test.includes('config/serviceWorkerPolicy')) {
    fail(`${SERVICE_WORKER_POLICY.testFile}: focused test must import config/serviceWorkerPolicy`);
}
if (!test.includes('clearPrivateCaches') || !test.includes('SERVICE_WORKER_POLICY.offlineDatabaseName')) {
    fail(`${SERVICE_WORKER_POLICY.testFile}: focused test must exercise private cache cleanup and offline DB deletion`);
}

if (failures.length) {
    console.error('Service Worker policy check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Service Worker policy check passed: ${API_CACHE_ALLOWLIST.length} cacheable API GETs, ${SENSITIVE_API_PATH_PREFIXES.length} sensitive prefixes, ${MUTATION_QUEUE_ALLOWLIST.length} offline mutation endpoints.`);
