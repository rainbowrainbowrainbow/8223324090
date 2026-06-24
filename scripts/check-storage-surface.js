#!/usr/bin/env node
/**
 * Upload storage surface guard.
 *
 * This check keeps local /uploads paths, docs, tests, and ignore rules aligned.
 * It is structural; route behavior remains covered by focused service and route tests.
 */

const fs = require('fs');
const path = require('path');
const {
    LOCAL_UPLOAD_SURFACE,
    REMOTE_STORAGE_SURFACE,
    UPLOAD_STATIC_MOUNTS
} = require('../config/storageSurface');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'STORAGE_SURFACE.md');
const SERVER_PATH = path.join(ROOT, 'server.js');
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');
const failures = [];

const LOCAL_PERSISTENCE = new Set(['local-postgres-metadata', 'local-only-legacy']);
const LOCAL_FALLBACK_POLICIES = new Set([
    'local-filesystem-primary',
    'postgres-blob-primary-local-legacy'
]);
const REMOTE_PROVIDERS = new Set();
const SOURCE_DIRS = ['routes', 'services', 'js', 'css'];
const SOURCE_ROOT_FILES = ['server.js', 'sw.js'];
const SOURCE_EXTENSIONS = new Set(['.js', '.html', '.css']);

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

function localSegment(entry) {
    return normalizeSlashes(entry.localDir).split('/')[1];
}

function docIncludes(doc, value) {
    return doc.includes(`\`${value}\``) || doc.includes(value);
}

function ensureDocMentions(doc, value, label) {
    if (!docIncludes(doc, value)) fail(`${label}: ${value} missing from docs/STORAGE_SURFACE.md`);
}

function ensureFile(file, label) {
    if (!file) return;
    if (!exists(file)) fail(`${label}: ${file} does not exist`);
}

function ensureListedFiles(files, label) {
    for (const file of files || []) ensureFile(file, label);
}

function pathReferenceExists(content, entry) {
    const segment = localSegment(entry);
    const localDir = normalizeSlashes(entry.localDir);
    return content.includes(entry.urlPrefix)
        || normalizeSlashes(content).includes(localDir)
        || content.includes(`'uploads', '${segment}'`)
        || content.includes(`"uploads", "${segment}"`)
        || content.includes(`\`uploads\`, \`${segment}\``);
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
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                out.push(full);
            }
        }
    }
    return out;
}

function collectSourceFiles() {
    const files = SOURCE_DIRS.flatMap(listFiles);
    for (const file of SOURCE_ROOT_FILES) {
        if (exists(file)) files.push(repoPath(file));
    }
    for (const file of fs.readdirSync(ROOT)) {
        if (file.endsWith('.html')) files.push(repoPath(file));
    }
    return [...new Set(files)];
}

function collectUploadSegments() {
    const found = new Set();
    const patterns = [
        /\/uploads\/([A-Za-z0-9_-]+)/g,
        /uploads[\\/]+([A-Za-z0-9_-]+)/g,
        /['"`]uploads['"`]\s*,\s*['"`]([A-Za-z0-9_-]+)['"`]/g
    ];

    for (const file of collectSourceFiles()) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                found.add(match[1]);
            }
        }
    }
    return found;
}

function compareSets(label, actual, expected) {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    const missing = expectedSorted.filter(item => !actualSorted.includes(item));
    const extra = actualSorted.filter(item => !expectedSorted.includes(item));

    if (missing.length || extra.length) {
        fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`);
    }
}

const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
const server = fs.readFileSync(SERVER_PATH, 'utf8');
const gitignore = fs.existsSync(GITIGNORE_PATH) ? fs.readFileSync(GITIGNORE_PATH, 'utf8') : '';

if (!doc) fail('docs/STORAGE_SURFACE.md is required');

for (const mount of UPLOAD_STATIC_MOUNTS) {
    if (!mount.path || !mount.localDir || !mount.owner || !mount.reason) {
        fail(`upload static mount is incomplete: ${JSON.stringify(mount)}`);
        continue;
    }
    if (!server.includes(`app.use('${mount.path}'`) && !server.includes(`app.use("${mount.path}"`)) {
        fail(`${mount.path}: static mount missing from server.js`);
    }
    ensureDocMentions(doc, mount.path, `static mount ${mount.path}`);
    ensureDocMentions(doc, mount.localDir, `static mount ${mount.path}`);
}

const manifestSegments = new Set();
const localPrefixes = new Set();

for (const entry of LOCAL_UPLOAD_SURFACE) {
    const label = `local upload ${entry.urlPrefix || entry.localDir}`;
    if (!entry.urlPrefix || !entry.urlPrefix.startsWith('/uploads/')) fail(`${label}: urlPrefix must start with /uploads/`);
    if (!entry.localDir || !normalizeSlashes(entry.localDir).startsWith('uploads/')) fail(`${label}: localDir must live under uploads/`);
    if (!entry.owner) fail(`${label}: missing owner`);
    if (!LOCAL_PERSISTENCE.has(entry.persistence)) fail(`${label}: invalid persistence ${entry.persistence}`);
    if (!entry.fallbackPolicy || !LOCAL_FALLBACK_POLICIES.has(entry.fallbackPolicy.type)) {
        fail(`${label}: missing or invalid fallbackPolicy.type`);
    } else {
        if (!entry.fallbackPolicy.durableSource) fail(`${label}: fallbackPolicy.durableSource is required`);
        if (entry.fallbackPolicy.reviewBeforeDelete !== true) fail(`${label}: fallbackPolicy.reviewBeforeDelete must be true`);
        ensureDocMentions(doc, entry.fallbackPolicy.type, label);
        ensureDocMentions(doc, entry.fallbackPolicy.durableSource, label);
    }
    ensureFile(entry.routeFile, label);
    ensureFile(entry.serviceFile, label);
    ensureListedFiles(entry.frontendFiles, label);
    ensureListedFiles(entry.tests, label);
    ensureDocMentions(doc, entry.urlPrefix, label);
    ensureDocMentions(doc, entry.localDir, label);

    const segment = localSegment(entry);
    manifestSegments.add(segment);
    localPrefixes.add(entry.urlPrefix);

    const ignoreNeedle = normalizeSlashes(entry.localDir).replace(/\/?$/, '/');
    if (!normalizeSlashes(gitignore).includes(ignoreNeedle)) {
        fail(`${label}: ${ignoreNeedle} must be ignored in .gitignore`);
    }

    const referenceFiles = [entry.routeFile, entry.serviceFile, ...(entry.frontendFiles || [])].filter(Boolean);
    if (!referenceFiles.some(file => exists(file) && pathReferenceExists(read(file), entry))) {
        fail(`${label}: no route/service/frontend reference found for ${entry.urlPrefix} or ${entry.localDir}`);
    }

    if (entry.persistence === 'local-postgres-metadata') {
        if (entry.remoteBucket || entry.envBucket) fail(`${label}: local Postgres metadata entries must not declare remote bucket/env`);
        if (entry.serviceFile && exists(entry.serviceFile)) {
            const service = read(entry.serviceFile);
            if (service.includes('getSupabase') || service.includes('@supabase') || service.includes('.storage.from(')) {
                fail(`${label}: local storage service must not use Supabase runtime APIs`);
            }
            if (!service.includes(entry.urlPrefix)) fail(`${label}: service must expose public URL prefix ${entry.urlPrefix}`);
        }
    }

    if (entry.persistence === 'local-only-legacy' && entry.routeFile && exists(entry.routeFile)) {
        const route = read(entry.routeFile);
        if (!route.includes('multer.diskStorage')) fail(`${label}: local-only legacy uploads must be explicit multer.diskStorage`);
    }
}

compareSets('source /uploads segments', collectUploadSegments(), manifestSegments);

for (const entry of REMOTE_STORAGE_SURFACE) {
    const label = `remote storage ${entry.bucket}`;
    if (!entry.bucket || !entry.owner || !REMOTE_PROVIDERS.has(entry.provider)) {
        fail(`${label}: remote storage entry is incomplete`);
    }
    ensureFile(entry.serviceFile, label);
    ensureListedFiles(entry.routeFiles, label);
    ensureListedFiles(entry.tests, label);
    ensureDocMentions(doc, entry.bucket, label);
    if (entry.envBucket) ensureDocMentions(doc, entry.envBucket, label);
    if (entry.localFallback) {
        if (!localPrefixes.has(entry.localFallback)) fail(`${label}: localFallback ${entry.localFallback} is not a local upload surface`);
        ensureDocMentions(doc, entry.localFallback, label);
    }

    if (entry.serviceFile && exists(entry.serviceFile)) {
        const service = read(entry.serviceFile);
        if (!service.includes('.storage.from(')) fail(`${label}: service must use remote storage API`);
        if (!service.includes('getPublicUrl')) fail(`${label}: service must return or derive a public URL`);
        if (!service.includes(entry.bucket)) fail(`${label}: service must mention bucket ${entry.bucket}`);
    }
}

if (failures.length) {
    console.error('Storage surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Storage surface check passed: ${LOCAL_UPLOAD_SURFACE.length} local upload paths, ${REMOTE_STORAGE_SURFACE.length} remote buckets, ${UPLOAD_STATIC_MOUNTS.length} static mounts.`);
