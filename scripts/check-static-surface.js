#!/usr/bin/env node
/**
 * Static surface ownership guard.
 *
 * Root HTML files are intentionally broad static content. This check makes
 * every root HTML page explicit before future cleanup or deletion work.
 */

const fs = require('fs');
const path = require('path');
const {
    ROOT_HTML_SURFACE,
    LANDING_SURFACE,
    LEGACY_STATIC_REDIRECTS,
    STATIC_PAGE_EXPOSURE
} = require('../config/staticSurface');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'STATIC_SURFACE.md');
const SERVER_PATH = path.join(ROOT, 'server.js');
const ALLOWED_STATUSES = new Set(['canonical-page', 'root-shell', 'public-page']);
const failures = [];

function fail(message) {
    failures.push(message);
}

function sorted(values) {
    return [...values].sort();
}

function compareSets(label, actual, expected) {
    const actualSorted = sorted(actual);
    const expectedSorted = sorted(expected);
    const missing = expectedSorted.filter(item => !actualSorted.includes(item));
    const extra = actualSorted.filter(item => !expectedSorted.includes(item));

    if (missing.length || extra.length) {
        fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`);
    }
}

function ensureUnique(label, entries, key) {
    const seen = new Map();
    for (const entry of entries) {
        const value = entry[key];
        if (!value) continue;
        if (seen.has(value)) {
            fail(`${label}: duplicate ${key} "${value}" in ${seen.get(value)} and ${entry.file || entry.path}`);
        } else {
            seen.set(value, entry.file || entry.path);
        }
    }
}

function routeExists(server, routePath) {
    if (routePath === '/') return server.includes("app.get('*'") && server.includes("'index.html'");
    return server.includes(`'${routePath}'`) || server.includes(`"${routePath}"`);
}

function htmlFileReferenceExists(server, file) {
    return server.includes(`'${file}'`) || server.includes(`"${file}"`);
}

function docSection(doc, heading) {
    const start = doc.indexOf(heading);
    if (start === -1) return '';
    const rest = doc.slice(start + heading.length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
}

function validateSurfaceEntry(entry, label) {
    if (!entry.file) fail(`${label}: missing file`);
    if (!entry.canonicalPath || !entry.canonicalPath.startsWith('/')) {
        fail(`${label}: canonicalPath must start with /`);
    }
    if (!entry.owner) fail(`${label}: missing owner`);
    if (!entry.purpose) fail(`${label}: missing purpose`);
    if (!ALLOWED_STATUSES.has(entry.status)) {
        fail(`${label}: invalid status "${entry.status}"`);
    }
    if (!Array.isArray(entry.aliases)) fail(`${label}: aliases must be an array`);
}

const rootHtmlFiles = fs.readdirSync(ROOT)
    .filter(name => name.endsWith('.html'));
const rootManifestFiles = ROOT_HTML_SURFACE.map(entry => entry.file);

compareSets('root HTML manifest', rootHtmlFiles, rootManifestFiles);
ensureUnique('root HTML surface', ROOT_HTML_SURFACE, 'file');
ensureUnique('root HTML surface', ROOT_HTML_SURFACE, 'canonicalPath');

const server = fs.readFileSync(SERVER_PATH, 'utf8');
const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
if (!doc) fail('docs/STATIC_SURFACE.md is required');

const rootByFile = new Map(ROOT_HTML_SURFACE.map(entry => [entry.file, entry]));
const landingByFile = new Map(LANDING_SURFACE.map(entry => [entry.file, entry]));
const exposureDoc = docSection(doc, '## Exposure Classification');
if (!exposureDoc) fail('docs/STATIC_SURFACE.md: missing Exposure Classification section');

for (const file of STATIC_PAGE_EXPOSURE.publicRootFiles || []) {
    const entry = rootByFile.get(file);
    if (!entry) {
        fail(`static exposure public root ${file}: missing from ROOT_HTML_SURFACE`);
    } else if (entry.status !== 'public-page') {
        fail(`static exposure public root ${file}: status must be public-page`);
    }
    if (!exposureDoc.includes(`\`${file}\``)) fail(`static exposure public root ${file}: missing from docs/STATIC_SURFACE.md`);
}

for (const file of STATIC_PAGE_EXPOSURE.rootShellFiles || []) {
    const entry = rootByFile.get(file);
    if (!entry) {
        fail(`static exposure root shell ${file}: missing from ROOT_HTML_SURFACE`);
    } else if (entry.status !== 'root-shell') {
        fail(`static exposure root shell ${file}: status must be root-shell`);
    }
    if (!exposureDoc.includes(`\`${file}\``)) fail(`static exposure root shell ${file}: missing from docs/STATIC_SURFACE.md`);
}

for (const file of STATIC_PAGE_EXPOSURE.publicLandingFiles || []) {
    const entry = landingByFile.get(file);
    if (!entry) {
        fail(`static exposure public landing ${file}: missing from LANDING_SURFACE`);
    } else if (entry.status !== 'public-page') {
        fail(`static exposure public landing ${file}: status must be public-page`);
    }
    if (!exposureDoc.includes(`\`${file}\``)) fail(`static exposure public landing ${file}: missing from docs/STATIC_SURFACE.md`);
}

const allAliases = new Set(ROOT_HTML_SURFACE.flatMap(entry => entry.aliases || []));
for (const alias of STATIC_PAGE_EXPOSURE.embeddedAliases || []) {
    if (!allAliases.has(alias)) fail(`static exposure embedded alias ${alias}: missing from ROOT_HTML_SURFACE aliases`);
    if (!exposureDoc.includes(`\`${alias}\``)) fail(`static exposure embedded alias ${alias}: missing from docs/STATIC_SURFACE.md`);
}

for (const entry of ROOT_HTML_SURFACE) {
    const isPublicRoot = (STATIC_PAGE_EXPOSURE.publicRootFiles || []).includes(entry.file);
    const isRootShell = (STATIC_PAGE_EXPOSURE.rootShellFiles || []).includes(entry.file);
    if (!isPublicRoot && !isRootShell && entry.status === 'public-page') {
        fail(`root ${entry.file}: public-page status requires STATIC_PAGE_EXPOSURE.publicRootFiles ownership`);
    }
}

for (const entry of ROOT_HTML_SURFACE) {
    const label = `root ${entry.file}`;
    validateSurfaceEntry(entry, label);

    const fullPath = path.join(ROOT, entry.file);
    if (!fs.existsSync(fullPath)) fail(`${label}: file missing`);
    if (!doc.includes(`\`${entry.file}\``)) fail(`${label}: missing from docs/STATIC_SURFACE.md`);
    if (!doc.includes(`\`${entry.canonicalPath}\``)) fail(`${label}: canonical path missing from docs/STATIC_SURFACE.md`);

    if (!routeExists(server, entry.canonicalPath)) {
        fail(`${label}: canonical route ${entry.canonicalPath} not found in server.js`);
    }
    if (entry.file !== 'index.html' && !htmlFileReferenceExists(server, entry.file)) {
        fail(`${label}: ${entry.file} sendFile/reference not found in server.js`);
    }

    for (const alias of entry.aliases) {
        if (alias === '*') continue;
        if (!routeExists(server, alias)) fail(`${label}: alias route ${alias} not found in server.js`);
    }
}

for (const entry of LANDING_SURFACE) {
    const label = `landing ${entry.file}`;
    validateSurfaceEntry(entry, label);

    if (!fs.existsSync(path.join(ROOT, entry.file))) fail(`${label}: file missing`);
    if (!doc.includes(`\`${entry.file}\``)) fail(`${label}: missing from docs/STATIC_SURFACE.md`);
    if (!routeExists(server, entry.canonicalPath)) fail(`${label}: canonical route ${entry.canonicalPath} not found in server.js`);
    for (const alias of entry.aliases) {
        if (!routeExists(server, alias)) fail(`${label}: alias route ${alias} not found in server.js`);
    }
}

if (!server.includes("app.use('/landing'")) {
    fail('server.js must keep /landing static mount documented in static surface');
}

for (const redirect of LEGACY_STATIC_REDIRECTS) {
    if (!redirect.path || !redirect.target || !redirect.owner) {
        fail(`legacy redirect is incomplete: ${JSON.stringify(redirect)}`);
        continue;
    }
    if (!routeExists(server, redirect.path)) {
        fail(`legacy redirect ${redirect.path}: route not found in server.js`);
    }
    if (!server.includes(`'${redirect.target}'`) && !server.includes(`"${redirect.target}"`)) {
        fail(`legacy redirect ${redirect.path}: target ${redirect.target} not found in server.js`);
    }
    if (!doc.includes(`\`${redirect.path}\``)) {
        fail(`legacy redirect ${redirect.path}: missing from docs/STATIC_SURFACE.md`);
    }
}

if (failures.length) {
    console.error('Static surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Static surface check passed: ${ROOT_HTML_SURFACE.length} root HTML files, ${LANDING_SURFACE.length} landing files, ${LEGACY_STATIC_REDIRECTS.length} legacy redirects.`);
