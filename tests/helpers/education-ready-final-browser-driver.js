'use strict';
// Observe the real browser without changing requests, responses or UI actions.
const fs = require('node:fs');
const path = require('node:path');
const playwright = require(process.env.EDU_FINAL_PLAYWRIGHT_MODULE);
const directory = path.resolve(process.env.EDU_READY_RUN_ROOT || 'output/education-ready/08', 'network');
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, `${process.env.EDU_READY_SUITE || 'live'}-${process.env.EDU_MOBILE_ENGINE || 'chromium'}-${process.pid}-${Date.now()}.json`);
const evidence = { startedAt: new Date().toISOString(), suite: process.env.EDU_READY_SUITE || 'live', responses: [], failedRequests: [] };
function flush() { fs.writeFileSync(file, JSON.stringify(evidence, null, 2)); }
for (const name of ['chromium', 'webkit']) {
    const launch = playwright[name].launch.bind(playwright[name]);
    playwright[name].launch = async (...args) => {
        const browser = await launch(...args), newContext = browser.newContext.bind(browser);
        browser.newContext = async (...options) => {
            const context = await newContext(...options), pending = new Set(); let role = 'before-auth';
            context.on('page', page => {
                page.on('response', response => {
                    const task = (async () => {
                        const request = response.request(), url = new URL(response.url());
                        if (url.pathname === '/api/auth/login' && response.ok()) {
                            const auth = await response.json().catch(() => ({})); role = auth.user?.role || 'authenticated-role-unavailable';
                        }
                        if (url.pathname.startsWith('/api/') && response.status() >= 400) {
                            let business = url.searchParams.get('businessContext');
                            if (!business) { try { business = new URL(page.url()).searchParams.get('businessContext'); } catch {} }
                            evidence.responses.push({ method: request.method(), path: url.pathname, status: response.status(), role, business: business || 'default-runtime', observedAt: new Date().toISOString() }); flush();
                        }
                    })(); pending.add(task); task.finally(() => pending.delete(task));
                });
                page.on('requestfailed', request => {
                    const url = new URL(request.url());
                    if (url.pathname.startsWith('/api/')) {
                        evidence.failedRequests.push({ method: request.method(), path: url.pathname, role, failure: request.failure()?.errorText }); flush();
                    }
                });
            });
            const close = context.close.bind(context);
            context.close = async (...args) => { await Promise.allSettled([...pending]); try { return await close(...args); } finally { evidence.finishedAt = new Date().toISOString(); flush(); } };
            return context;
        };
        return browser;
    };
}
flush();
module.exports = playwright;
