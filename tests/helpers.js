/**
 * tests/helpers.js — Shared test utilities for API smoke tests
 * Uses native fetch (Node 20+)
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const TEST_USER = process.env.TEST_USER || 'admin';
const TEST_PASS = process.env.TEST_PASS || 'admin123';

let cachedToken = null;

async function getToken() {
    if (cachedToken) return cachedToken;
    const res = await request('POST', '/api/auth/login', {
        username: TEST_USER,
        password: TEST_PASS
    });
    if (res.status !== 200 || !res.data.token) {
        throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.data)}`);
    }
    cachedToken = res.data.token;
    return cachedToken;
}

async function request(method, path, body, token) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

async function authRequest(method, path, body) {
    const token = await getToken();
    return request(method, path, body, token);
}

function testDate() {
    // Use a far-future date to avoid conflicts with real data
    return '2099-01-15';
}

function resetToken() {
    cachedToken = null;
}

module.exports = { BASE_URL, TEST_USER, TEST_PASS, getToken, request, authRequest, testDate, resetToken };
