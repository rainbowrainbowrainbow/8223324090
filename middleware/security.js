/**
 * middleware/security.js — Cache control for static assets
 */
function cacheControl(req, res, next) {
    if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
}

module.exports = { cacheControl };
