/**
 * middleware/security.js — Security headers + cache control
 */
function securityHeaders(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('X-XSS-Protection', '1; mode=block');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // v19.14: Content-Security-Policy
    res.set('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://tempfile.aiquickdraw.com https://*.aiquickdraw.com https://*.kie.ai https://*.supabase.co",
        "connect-src 'self' ws: wss: https://*.up.railway.app https://docs.google.com",
        "frame-src 'self'",
        "frame-ancestors 'self'"
    ].join('; '));
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
        res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}

function cacheControl(req, res, next) {
    const p = req.path;
    if (p.endsWith('.html') || p === '/') {
        // HTML: always revalidate
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    } else if (p.startsWith('/landing/') && (p.endsWith('.js') || p.endsWith('.css'))) {
        // Landing scripts change often — short cache with revalidation
        res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    } else if (p.endsWith('.js') || p.endsWith('.css')) {
        // v19.16: JS/CSS have ?v= cache busters — cache for 7 days
        res.set('Cache-Control', 'public, max-age=604800, immutable');
    } else if (p.startsWith('/images/') || p.endsWith('.svg') || p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.webp')) {
        // v19.16: Static images — cache for 30 days
        res.set('Cache-Control', 'public, max-age=2592000, immutable');
    } else if (p.endsWith('.woff2') || p.endsWith('.woff') || p.endsWith('.ttf')) {
        // v19.16: Fonts — cache for 1 year
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    next();
}

module.exports = { cacheControl, securityHeaders };
