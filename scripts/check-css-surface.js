#!/usr/bin/env node
/**
 * CSS surface ownership guard.
 *
 * This keeps CSS files, references, docs, and the Service Worker app-shell
 * CSS precache explicit before broad frontend consolidation work.
 */

const fs = require('fs');
const path = require('path');
const {
    CSS_APP_SHELL_PRECACHE,
    CSS_SURFACE,
    CSS_SURFACE_DOC
} = require('../config/cssSurface');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, CSS_SURFACE_DOC);
const failures = [];

const ALLOWED_CATEGORIES = new Set([
    'shared',
    'shared-large',
    'shell',
    'shell-large',
    'feature-shared',
    'page-scoped',
    'page-scoped-large',
    'landing-scoped-large'
]);
const ALLOWED_STATUSES = new Set(['active', 'active-large']);

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

function normalizeSlashes(value) {
    return String(value || '').replace(/\\/g, '/');
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

function docIncludes(doc, value) {
    return doc.includes(`\`${value}\``) || doc.includes(value);
}

function ensureDocMentions(doc, value, label) {
    if (!docIncludes(doc, value)) fail(`${label}: ${value} missing from ${CSS_SURFACE_DOC}`);
}

function listFilesRecursive(dir, predicate) {
    const root = repoPath(dir);
    if (!fs.existsSync(root)) return [];
    const out = [];
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && predicate(full)) {
                out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
            }
        }
    }
    return out;
}

function collectCssFiles() {
    return [
        ...listFilesRecursive('css', file => file.endsWith('.css')),
        ...listFilesRecursive('landing', file => file.endsWith('.css'))
    ];
}

function collectSourceFiles() {
    const files = [];
    for (const file of fs.readdirSync(ROOT)) {
        if (file.endsWith('.html')) files.push(file);
    }
    for (const file of ['server.js', 'sw.js']) {
        if (exists(file)) files.push(file);
    }
    for (const dir of ['js', 'landing', 'tests']) {
        files.push(...listFilesRecursive(dir, file => /\.(html|js)$/.test(file)));
    }
    return [...new Set(files)];
}

function normalizeCssRef(rawRef, sourceFile) {
    if (!rawRef) return null;
    const withoutQuery = rawRef.split('?')[0].trim();
    if (/^https?:\/\//i.test(withoutQuery) || withoutQuery.startsWith('data:')) return null;

    let ref = withoutQuery.replace(/^\/+/, '').replace(/^\.\//, '');
    if (ref.startsWith('css/')) return ref;
    if (ref.startsWith('landing/') && ref.endsWith('.css')) return ref;

    const sourceDir = path.posix.dirname(normalizeSlashes(sourceFile));
    if (ref === 'style.css' && sourceDir === 'landing') return 'landing/style.css';
    if (ref.endsWith('.css') && sourceDir !== '.') {
        return path.posix.normalize(path.posix.join(sourceDir, ref));
    }
    return null;
}

function collectCssReferences() {
    const refs = new Map();
    const patterns = [
        /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?/g,
        /\b(?:href|src)\s*=\s*["']([^"']+\.css(?:\?[^"']*)?)["']/g,
        /["'`]([^"'`]*\/?css\/[^"'`]+\.css(?:\?[^"'`]*)?)["'`]/g,
        /["'`](style\.css(?:\?[^"'`]*)?)["'`]/g
    ];

    for (const file of [...collectSourceFiles(), ...collectCssFiles()]) {
        const content = read(file);
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const ref = normalizeCssRef(match[1], file);
                if (!ref) continue;
                if (!refs.has(ref)) refs.set(ref, new Set());
                refs.get(ref).add(file);
            }
        }
    }
    return refs;
}

function collectSwCssPrecache() {
    if (!exists('sw.js')) return [];
    const sw = read('sw.js');
    const refs = new Set();
    const pattern = /["']\/(css\/[^"']+\.css)["']/g;
    let match;
    while ((match = pattern.exec(sw)) !== null) refs.add(match[1]);
    return [...refs];
}

const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
const packageJson = JSON.parse(read('package.json'));

if (!doc) fail(`${CSS_SURFACE_DOC} is required`);
if (!packageJson.scripts['check:css-surface']) fail('package.json must define check:css-surface');
if (!packageJson.scripts.verify.includes('check:css-surface')) {
    fail('package.json verify script must include check:css-surface');
}

ensureDocMentions(doc, 'config/cssSurface.js', 'CSS docs');
ensureDocMentions(doc, 'scripts/check-css-surface.js', 'CSS docs');
ensureDocMentions(doc, 'npm run check:css-surface', 'CSS docs');
ensureDocMentions(doc, 'npm run test:ui', 'CSS docs');

const manifestFiles = CSS_SURFACE.map(entry => entry.file);
compareSets('CSS file manifest', collectCssFiles(), manifestFiles);
compareSets('Service Worker CSS precache manifest', collectSwCssPrecache(), CSS_APP_SHELL_PRECACHE);

const seen = new Set();
for (const entry of CSS_SURFACE) {
    const label = `CSS surface ${entry.file}`;
    if (seen.has(entry.file)) fail(`${label}: duplicate manifest entry`);
    seen.add(entry.file);
    if (!entry.file || !entry.file.endsWith('.css')) fail(`${label}: file must end with .css`);
    if (!entry.owner) fail(`${label}: missing owner`);
    if (!entry.reason) fail(`${label}: missing reason`);
    if (!ALLOWED_CATEGORIES.has(entry.category)) fail(`${label}: invalid category ${entry.category}`);
    if (!ALLOWED_STATUSES.has(entry.status)) fail(`${label}: invalid status ${entry.status}`);
    if (!exists(entry.file)) fail(`${label}: file does not exist`);
    ensureDocMentions(doc, entry.file, label);
    ensureDocMentions(doc, entry.owner, label);
    ensureDocMentions(doc, entry.category, label);
}

const refs = collectCssReferences();
for (const [ref, sourceFiles] of refs.entries()) {
    if (!exists(ref)) fail(`CSS reference ${ref}: target file does not exist`);
    if (!seen.has(ref)) fail(`CSS reference ${ref}: missing from config/cssSurface.js; referenced by ${[...sourceFiles].sort().join(', ')}`);
}

for (const entry of CSS_SURFACE) {
    if (!refs.has(entry.file)) {
        fail(`${entry.file}: no HTML/JS/server/sw/test reference found`);
    }
}

for (const file of CSS_APP_SHELL_PRECACHE) {
    ensureDocMentions(doc, file, `Service Worker CSS precache ${file}`);
    if (!seen.has(file)) fail(`Service Worker CSS precache ${file}: missing from CSS_SURFACE`);
}

if (failures.length) {
    console.error('CSS surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`CSS surface check passed: ${CSS_SURFACE.length} CSS files, ${refs.size} referenced files, ${CSS_APP_SHELL_PRECACHE.length} Service Worker precache entries.`);
