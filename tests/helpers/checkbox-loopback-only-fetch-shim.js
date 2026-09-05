'use strict';

const officialHosts = new Set(['api.checkbox.ua', 'api.checkbox.in.ua']);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const originalFetch = globalThis.fetch;
const mockPort = Number(process.env.CHECKBOX_LOCAL_QA_MOCK_PORT || 0);
const isolated = process.env.NODE_ENV === 'test'
    && process.env.REQUIRE_ISOLATED_TEST_TARGET === 'true'
    && process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true';

if (!isolated || !Number.isInteger(mockPort) || mockPort <= 0 || mockPort > 65535 || typeof originalFetch !== 'function') {
    throw new Error('Checkbox loopback fetch shim is restricted to the isolated local QA runner');
}

process.env.CHECKBOX_LOCAL_QA_FETCH_SHIM_ACTIVE = 'true';

globalThis.fetch = function checkboxLoopbackOnlyFetch(input, init) {
    const source = input instanceof Request ? input.url : String(input);
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();

    if (officialHosts.has(hostname)) {
        url.protocol = 'http:';
        url.hostname = '127.0.0.1';
        url.port = String(mockPort);
        const rewritten = input instanceof Request ? new Request(url, input) : url;
        return originalFetch(rewritten, init);
    }

    if (!loopbackHosts.has(hostname) || url.protocol !== 'http:') {
        throw new Error(`external_network_forbidden:${hostname || 'unknown'}`);
    }
    return originalFetch(input, init);
};
