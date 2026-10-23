'use strict';

// Observe actual geometry and finite CSS transitions; never disable motion or
// accept overflow as a substitute for waiting for the measured layout.
async function waitForStableLayout(page, selectors = ['.main-content', '#sidebarNav', '#sidebarIdentityRole', '.omni-workspace-shell', '.omni-chat', '#quickAdd']) {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForFunction(({ selectors, stableMs }) => {
        const nodes = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
        const moving = nodes.some(node => node.getAnimations().some(animation =>
            ['running', 'pending'].includes(animation.playState)
            && Number.isFinite(animation.effect?.getComputedTiming().endTime)));
        const values = [innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth,
            ...nodes.flatMap(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10)); })];
        const signature = JSON.stringify(values), now = performance.now();
        const state = window.__smokeLayoutObservation;
        if (moving || !state || state.signature !== signature) {
            window.__smokeLayoutObservation = { signature, since: now };
            return false;
        }
        if (now - state.since < stableMs) return false;
        delete window.__smokeLayoutObservation;
        return true;
    }, { selectors, stableMs: 200 }, { timeout: 10000, polling: 'raf' });
}

// A momentarily empty request set is not a navigation boundary: a dependent
// request may start on the next turn. Keep listening throughout a quiet window.
function trackRequests(context, origin) {
    const pending = new Set();
    const changed = new Set();
    const pageListeners = new Map();
    const retired = [];
    const notify = () => { for (const listener of changed) listener(); };
    const started = request => { if (new URL(request.url()).origin === origin) { pending.add(request); notify(); } };
    const finished = request => { if (pending.delete(request)) notify(); };
    const watchPage = page => {
        const navigated = frame => {
            if (frame !== page.mainFrame()) return;
            // Chromium/WebKit can leave a cancelled old-document read without a
            // matching requestfinished event. It cannot block the new document.
            for (const request of pending) {
                let owner;
                try { owner = request.frame?.(); } catch { continue; }
                if (owner !== frame || request.isNavigationRequest?.()
                    || !['GET', 'HEAD'].includes(request.method())) continue;
                pending.delete(request);
                retired.push({ method: request.method(), path: new URL(request.url()).pathname.replace(/\d+/g, ':id'), reason: 'previous_document_navigation' });
            }
            notify();
        };
        page.on('framenavigated', navigated);
        pageListeners.set(page, navigated);
    };
    context.on('page', watchPage);
    for (const page of context.pages?.() || []) watchPage(page);
    context.on('request', started);
    context.on('requestfinished', finished);
    context.on('requestfailed', finished);
    return {
        async idle({ quietMs = 500, timeoutMs = 15000 } = {}) {
            await new Promise((resolve, reject) => {
                let quiet;
                const cleanup = () => { clearTimeout(quiet); clearTimeout(deadline); changed.delete(update); };
                const update = () => {
                    clearTimeout(quiet);
                    if (!pending.size) quiet = setTimeout(() => { cleanup(); resolve(); }, quietMs);
                };
                const deadline = setTimeout(() => {
                    const details = [...pending].map(request => ({ method: request.method(), path: new URL(request.url()).pathname.replace(/\d+/g, ':id'), type: request.resourceType() }));
                    cleanup();
                    reject(new Error('Requests did not settle before navigation: ' + JSON.stringify(details)));
                }, timeoutMs);
                changed.add(update);
                update();
            });
        },
        retiredReads() { return retired.slice(); },
        dispose() {
            context.off('page', watchPage);
            for (const [page, listener] of pageListeners) page.off('framenavigated', listener);
            pageListeners.clear();
            context.off('request', started);
            context.off('requestfinished', finished);
            context.off('requestfailed', finished);
        }
    };
}
module.exports = { waitForStableLayout, trackRequests };
