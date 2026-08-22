'use strict';

const officialHosts = new Set(['api.checkbox.ua', 'api.checkbox.in.ua']);
const originalFetch = globalThis.fetch;
const port = Number(process.env.CHECKBOX_BROWSER_MOCK_PORT || 0);
const isolated = process.env.NODE_ENV === 'test'
    && process.env.REQUIRE_ISOLATED_TEST_TARGET === 'true'
    && process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true';

if (!isolated || !Number.isInteger(port) || port <= 0 || port > 65535 || typeof originalFetch !== 'function') {
    throw new Error('Checkbox browser fetch shim is restricted to the isolated test runner');
}

globalThis.fetch = function checkboxBrowserFetch(input, init) {
    const source = input instanceof Request ? input.url : String(input);
    const url = new URL(source);
    if (!officialHosts.has(url.hostname.toLowerCase())) {
        return originalFetch(input, init);
    }

    url.protocol = 'http:';
    url.hostname = '127.0.0.1';
    url.port = String(port);
    const rewritten = input instanceof Request ? new Request(url, input) : url;
    return originalFetch(rewritten, init);
};
