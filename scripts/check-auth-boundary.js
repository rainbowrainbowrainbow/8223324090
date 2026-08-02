#!/usr/bin/env node
/**
 * API auth boundary ownership guard.
 *
 * This check keeps public API exceptions and query-token auth exceptions
 * explicit. Behavior remains covered by tests/auth-boundary.test.js and
 * route-smoke tests.
 */

const fs = require('fs');
const path = require('path');
const {
    INTEGRATION_AUTH_CONTRACTS,
    PUBLIC_API_ROUTES,
    QUERY_TOKEN_AUTH_ROUTES
} = require('../config/authBoundary');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'AUTH_BOUNDARY.md');
const MIDDLEWARE_PATH = path.join(ROOT, 'middleware', 'apiAuthBoundary.js');
const SOURCE_DIRS = ['routes', 'middleware'];
const CLIENT_DIRS = ['js'];
const CLIENT_ROOT_FILES = fs.readdirSync(ROOT).filter(file => file.endsWith('.html'));
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

function entryLabel(entry) {
    if (entry.label) return entry.label;
    if (entry.path) return `${entry.method || 'ANY'} ${entry.path}`;
    if (entry.prefix) return `${entry.method || 'ANY'} ${entry.prefix}*`;
    if (entry.examplePath) return `${entry.method || 'ANY'} ${entry.examplePath}`;
    return JSON.stringify(entry);
}

function ensureDocMentions(doc, value, label) {
    if (!doc.includes(`\`${value}\``) && !doc.includes(value)) {
        fail(`${label}: ${value} missing from docs/AUTH_BOUNDARY.md`);
    }
}

function ensureFile(file, label) {
    if (!file) return;
    if (!exists(file)) fail(`${label}: ${file} does not exist`);
}

function listFiles(dir) {
    const root = repoPath(dir);
    if (!fs.existsSync(root)) return [];
    const out = [];
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile() && ['.js', '.html'].includes(path.extname(entry.name))) out.push(full);
        }
    }
    return out;
}

function collectSourceFiles() {
    return [
        repoPath('server.js'),
        ...SOURCE_DIRS.flatMap(listFiles)
    ].filter(file => fs.existsSync(file));
}

function collectClientFiles() {
    return [
        ...CLIENT_DIRS.flatMap(listFiles),
        ...CLIENT_ROOT_FILES.map(file => repoPath(file))
    ].filter(file => fs.existsSync(file));
}

function routeEntryKey(entry) {
    return entry.path || entry.prefix || entry.label || entry.examplePath || String(entry.regex);
}

function ensureUnique(label, entries) {
    const seen = new Set();
    for (const entry of entries) {
        const key = `${entry.method || 'ANY'} ${routeEntryKey(entry)}`;
        if (seen.has(key)) fail(`${label}: duplicate ${key}`);
        seen.add(key);
    }
}

function validateRouteEntry(entry, label, { queryToken = false } = {}) {
    if (!entry.path && !entry.prefix && !entry.regex) fail(`${label}: missing path, prefix, or regex`);
    if ((entry.path || entry.regex) && !entry.method) fail(`${label}: exact/regex entries must include method`);
    if (entry.method && entry.method !== entry.method.toUpperCase()) fail(`${label}: method must be uppercase`);
    if (!entry.owner) fail(`${label}: missing owner`);
    if (!entry.reason) fail(`${label}: missing reason`);

    if (queryToken) {
        if (entry.method !== 'GET') fail(`${label}: query-token auth is limited to GET window.open routes`);
        if (entry.prefix) fail(`${label}: query-token auth must not use prefix matching`);
        if (!entry.examplePath) fail(`${label}: query-token entries require examplePath`);
        if (!entry.routeFile) fail(`${label}: query-token entries require routeFile`);
        if (!entry.clientFile) fail(`${label}: query-token entries require clientFile`);
        if (!Array.isArray(entry.clientNeedles) || entry.clientNeedles.length === 0) {
            fail(`${label}: query-token entries require clientNeedles`);
        }
        if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
            fail(`${label}: query-token entries require tests`);
        }
    }
}

function validateIntegrationContract(entry, label) {
    if (!entry.integrationContract) return;
    const contract = INTEGRATION_AUTH_CONTRACTS?.[entry.integrationContract];
    if (!contract) {
        fail(`${label}: missing integration contract ${entry.integrationContract}`);
        return;
    }
    if (!contract.owner) {
        fail(`${label}: integration contract requires an explicit owner`);
    } else if (contract.owner !== entry.owner) {
        fail(`${label}: integration contract owner ${contract.owner} does not match route owner ${entry.owner}`);
    }
    if (typeof contract.authentication !== 'string' || !contract.authentication.trim()) {
        fail(`${label}: integration contract requires an authentication mechanism`);
    }

    if (!Array.isArray(contract.guardFiles) || contract.guardFiles.length === 0) {
        fail(`${label}: integration contract requires guardFiles`);
    }
    if (!Array.isArray(contract.testFiles) || contract.testFiles.length === 0) {
        fail(`${label}: integration contract requires focused testFiles`);
    }

    for (const guard of contract.guardFiles || []) {
        if (!guard?.file) {
            fail(`${label}: integration guard is missing file`);
            continue;
        }
        ensureFile(guard.file, label);
        const source = exists(guard.file) ? read(guard.file) : '';
        for (const needle of guard.needles || []) {
            if (!source.includes(needle)) fail(`${label}: ${needle} missing from ${guard.file}`);
        }
        ensureDocMentions(doc, guard.file, label);
    }

    for (const testFile of contract.testFiles || []) {
        ensureFile(testFile, label);
        ensureDocMentions(doc, testFile, label);
    }
}

const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
const middleware = fs.readFileSync(MIDDLEWARE_PATH, 'utf8');

if (!doc) fail('docs/AUTH_BOUNDARY.md is required');
if (!middleware.includes("require('../config/authBoundary')")) {
    fail('middleware/apiAuthBoundary.js must import auth boundary routes from config/authBoundary.js');
}
if (/const\s+PUBLIC_API_ROUTES\s*=\s*\[/.test(middleware) || /const\s+QUERY_TOKEN_AUTH_ROUTES\s*=\s*\[/.test(middleware)) {
    fail('middleware/apiAuthBoundary.js must not keep inline public/query-token route manifests');
}

ensureUnique('public API routes', PUBLIC_API_ROUTES);
ensureUnique('query-token API routes', QUERY_TOKEN_AUTH_ROUTES);

for (const entry of PUBLIC_API_ROUTES) {
    const label = `public API route ${entryLabel(entry)}`;
    validateRouteEntry(entry, label);
    ensureDocMentions(doc, entryLabel(entry), label);
    validateIntegrationContract(entry, label);
}

for (const entry of QUERY_TOKEN_AUTH_ROUTES) {
    const label = `query-token API route ${entryLabel(entry)}`;
    validateRouteEntry(entry, label, { queryToken: true });
    ensureDocMentions(doc, entryLabel(entry), label);
    ensureDocMentions(doc, entry.examplePath, label);
    ensureDocMentions(doc, entry.clientFile, label);

    ensureFile(entry.routeFile, label);
    ensureFile(entry.clientFile, label);
    for (const testFile of entry.tests || []) ensureFile(testFile, label);

    const route = exists(entry.routeFile) ? read(entry.routeFile) : '';
    for (const needle of entry.routeNeedles || []) {
        if (!route.includes(needle)) fail(`${label}: ${needle} missing from ${entry.routeFile}`);
    }

    const client = exists(entry.clientFile) ? read(entry.clientFile) : '';
    for (const needle of entry.clientNeedles || []) {
        if (!client.includes(needle)) fail(`${label}: ${needle} missing from ${entry.clientFile}`);
    }

    for (const testFile of entry.tests || []) {
        if (!exists(testFile)) continue;
        const test = read(testFile);
        const tokenNeedle = entry.path || entry.examplePath;
        if (!test.includes(tokenNeedle)) fail(`${label}: ${testFile} must cover ${tokenNeedle}`);
    }
}

for (const file of collectSourceFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (rel === 'middleware/apiAuthBoundary.js') continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/req\.query(?:\?\.|\.)token\b/.test(content) || /req\.query\[['"]token['"]\]/.test(content)) {
        fail(`${rel}: req.query.token auth handling must live only in middleware/apiAuthBoundary.js`);
    }
}

const allowedClientNeedles = QUERY_TOKEN_AUTH_ROUTES.flatMap(entry => entry.clientNeedles || []);
for (const file of collectClientFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
        if (!line.includes('?token=') || (!line.includes('/api/') && !line.includes('API_BASE'))) return;
        if (!allowedClientNeedles.some(needle => line.includes(needle))) {
            fail(`${rel}:${index + 1}: API ?token= client usage is not listed in QUERY_TOKEN_AUTH_ROUTES`);
        }
    });
}

if (failures.length) {
    console.error('Auth boundary check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Auth boundary check passed: ${PUBLIC_API_ROUTES.length} public API exceptions, ${Object.keys(INTEGRATION_AUTH_CONTRACTS || {}).length} integration contracts, ${QUERY_TOKEN_AUTH_ROUTES.length} query-token exceptions.`);
