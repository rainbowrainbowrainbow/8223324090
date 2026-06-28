const path = require('path');

const BLOCKED_STATIC_DOC_EXTENSIONS = new Set(['.md', '.txt']);
const BLOCKED_REPO_ROOT_FILES = new Set([
    'package.json',
    'package-lock.json',
    'server.js',
    'swagger.js'
]);
const BLOCKED_REPO_STATIC_PREFIXES = [
    '/.claude',
    '/.dev-intelligence',
    '/.github',
    '/config',
    '/data',
    '/db',
    '/docs',
    '/lib',
    '/middleware',
    '/output',
    '/prompts',
    '/routes',
    '/scripts',
    '/services',
    '/tests',
    '/tmp',
    '/utils'
];

function isRootStaticDocPath(normalizedPath) {
    const withoutLeadingSlash = normalizedPath.replace(/^\/+/, '');
    return Boolean(withoutLeadingSlash) && !withoutLeadingSlash.includes('/');
}

function isArchivedDocPath(normalizedPath) {
    return normalizedPath.startsWith('/docs/archive/');
}

function isBlockedRepoRootFile(normalizedPath) {
    const withoutLeadingSlash = normalizedPath.replace(/^\/+/, '').toLowerCase();
    return BLOCKED_REPO_ROOT_FILES.has(withoutLeadingSlash);
}

function isBlockedRepoStaticPath(normalizedPath) {
    const lowerPath = normalizedPath.toLowerCase();
    return BLOCKED_REPO_STATIC_PREFIXES.some(prefix => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`));
}

function staticDocGuard(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let requestPath = req.path || '';
    try {
        requestPath = decodeURIComponent(requestPath);
    } catch {
        return res.status(404).send('Not found');
    }

    const normalizedPath = requestPath.replace(/\\/g, '/');
    const ext = path.extname(normalizedPath).toLowerCase();

    if (isBlockedRepoRootFile(normalizedPath) || isBlockedRepoStaticPath(normalizedPath)) {
        return res.status(404).send('Not found');
    }

    if (
        BLOCKED_STATIC_DOC_EXTENSIONS.has(ext) &&
        (isRootStaticDocPath(normalizedPath) || isArchivedDocPath(normalizedPath))
    ) {
        return res.status(404).send('Not found');
    }

    next();
}

module.exports = {
    BLOCKED_REPO_ROOT_FILES,
    BLOCKED_REPO_STATIC_PREFIXES,
    BLOCKED_STATIC_DOC_EXTENSIONS,
    isArchivedDocPath,
    isBlockedRepoRootFile,
    isBlockedRepoStaticPath,
    isRootStaticDocPath,
    staticDocGuard
};
