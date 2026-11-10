'use strict';

const { randomUUID } = require('node:crypto');

const WRITES = [
    ['POST', /^\/api\/staff$/],
    ['PUT', /^\/api\/hr\/staff\/[1-9]\d*$/],
    ['POST', /^\/api\/users\/onboarding$/],
    ['POST', /^\/api\/staff\/[1-9]\d*\/link$/],
    ['PUT', /^\/api\/organizations\/[1-9]\d*\/members\/[1-9]\d*$/],
    ['DELETE', /^\/api\/organizations\/[1-9]\d*\/members\/[1-9]\d*\/[1-9]\d*$/]
];

async function installHrFixtureQaBrowserGuard(context, baseUrl, token) {
    const origin = new URL(baseUrl).origin;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new Error('Invalid HR QA token');
    await context.routeWebSocket('**/*', ws => ws.close());
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        const method = request.method();
        if (['GET', 'HEAD'].includes(method)) return route.continue();
        if (!WRITES.some(([verb, path]) => verb === method && path.test(url.pathname))) return route.abort();
        const headers = await request.allHeaders();
        const response = await route.fetch({
            headers: { ...headers, 'x-qa-run-token': token, 'x-qa-run-request-id': randomUUID() },
            maxRedirects: 0
        });
        if (response.status() >= 300 && response.status() < 400) return route.abort();
        return route.fulfill({ response });
    });
}

module.exports = { installHrFixtureQaBrowserGuard };
