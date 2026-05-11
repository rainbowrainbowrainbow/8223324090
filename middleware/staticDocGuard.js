const path = require('path');

const BLOCKED_STATIC_DOC_EXTENSIONS = new Set(['.md', '.txt']);

function isRootStaticDocPath(normalizedPath) {
    const withoutLeadingSlash = normalizedPath.replace(/^\/+/, '');
    return Boolean(withoutLeadingSlash) && !withoutLeadingSlash.includes('/');
}

function isArchivedDocPath(normalizedPath) {
    return normalizedPath.startsWith('/docs/archive/');
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

    if (
        BLOCKED_STATIC_DOC_EXTENSIONS.has(ext) &&
        (isRootStaticDocPath(normalizedPath) || isArchivedDocPath(normalizedPath))
    ) {
        return res.status(404).send('Not found');
    }

    next();
}

module.exports = {
    BLOCKED_STATIC_DOC_EXTENSIONS,
    isArchivedDocPath,
    isRootStaticDocPath,
    staticDocGuard
};
