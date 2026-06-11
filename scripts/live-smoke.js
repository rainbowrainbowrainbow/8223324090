#!/usr/bin/env node
'use strict';

/**
 * Post-deploy smoke for a live/local CRM URL.
 *
 * Usage:
 *   npm run smoke:live -- https://example.up.railway.app
 *   LIVE_SMOKE_URL=https://example.up.railway.app LIVE_SMOKE_USER=... LIVE_SMOKE_PASS=... npm run smoke:live
 *   LIVE_SMOKE_TOKEN=<jwt> npm run smoke:live -- https://example.up.railway.app
 */

const pkg = require('../package.json');

const args = process.argv.slice(2);
const target = args.find(arg => !arg.startsWith('--'))
    || process.env.LIVE_SMOKE_URL
    || process.env.VERSION_SMOKE_URL
    || process.env.TEST_URL;
const publicOnly = args.includes('--public-only') || process.env.LIVE_SMOKE_PUBLIC_ONLY === 'true';
const expectedVersion = pkg.version;
const expectedLabel = String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
const smokeDate = process.env.LIVE_SMOKE_DATE || new Date().toISOString().slice(0, 10);
const businessContext = process.env.LIVE_SMOKE_BUSINESS_CONTEXT || 'event_genix';

function fail(message) {
    console.error(`Live smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function authHeaders(token = null) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readResponse(res) {
    const text = await res.text();
    let body = text;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {}
    return { text, body };
}

async function fetchJson(base, path, options = {}) {
    const res = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const { body, text } = await readResponse(res);
    if (!res.ok) {
        const detail = body?.error || body?.message || text || `HTTP ${res.status}`;
        throw new Error(`${path} returned HTTP ${res.status}: ${detail}`);
    }
    if (!body || typeof body !== 'object') {
        throw new Error(`${path} did not return JSON`);
    }
    return body;
}

async function login(base) {
    if (process.env.LIVE_SMOKE_TOKEN) return process.env.LIVE_SMOKE_TOKEN;
    const username = process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) return null;
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    if (!body.token) throw new Error('/api/auth/login did not return token');
    return body.token;
}

function assertArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`${label} expected an array`);
}

async function main() {
    if (!target) fail('provide URL as argument or LIVE_SMOKE_URL/VERSION_SMOKE_URL/TEST_URL');
    const base = normalizeBase(target);
    const report = [];

    const version = await fetchJson(base, '/api/version');
    if (version.version !== expectedVersion) {
        throw new Error(`/api/version is ${version.version}, expected ${expectedVersion}`);
    }
    if (expectedLabel && version.releaseLabel !== expectedLabel) {
        throw new Error(`/api/version releaseLabel is "${version.releaseLabel}", expected "${expectedLabel}"`);
    }
    report.push(`/api/version v${version.version}`);

    const health = await fetchJson(base, '/api/health');
    if (health.database !== 'connected') throw new Error(`/api/health database=${health.database}`);
    if (health.status !== 'ok') throw new Error(`/api/health status=${health.status}`);
    report.push('/api/health ok');

    const ready = await fetchJson(base, '/api/ready');
    if (ready.status !== 'ok') throw new Error(`/api/ready status=${ready.status}`);
    if (ready.schema?.status !== 'ok') {
        throw new Error(`/api/ready schema=${ready.schema?.status || 'missing'} missing=${(ready.schema?.missing || []).join(', ')}`);
    }
    report.push('/api/ready schema ok');

    const deep = await fetchJson(base, '/api/health/deep');
    if (deep.schema?.status !== 'ok') {
        throw new Error(`/api/health/deep schema=${deep.schema?.status || 'missing'} missing=${(deep.schema?.missing || []).join(', ')}`);
    }
    report.push('/api/health/deep schema ok');

    if (publicOnly) {
        console.log(`Live smoke OK (public only): ${base}`);
        for (const line of report) console.log(`  OK ${line}`);
        return;
    }

    const token = await login(base);
    if (!token) {
        throw new Error('protected smoke needs LIVE_SMOKE_TOKEN or LIVE_SMOKE_USER/LIVE_SMOKE_PASS; set LIVE_SMOKE_PUBLIC_ONLY=true to run public checks only');
    }

    const contextParam = `businessContext=${encodeURIComponent(businessContext)}`;
    const bookings = await fetchJson(base, `/api/bookings/${encodeURIComponent(smokeDate)}?${contextParam}`, { token });
    assertArray(bookings, '/api/bookings/:date');
    report.push(`/api/bookings/${smokeDate} array(${bookings.length})`);

    const lines = await fetchJson(base, `/api/lines/${encodeURIComponent(smokeDate)}?${contextParam}`, { token });
    assertArray(lines, '/api/lines/:date');
    report.push(`/api/lines/${smokeDate} array(${lines.length})`);

    const leads = await fetchJson(base, `/api/leads?order=kanban&limit=1&${contextParam}`, { token });
    if (leads.success !== true || !Array.isArray(leads.leads)) {
        throw new Error('/api/leads?order=kanban did not return { success: true, leads: [] }');
    }
    report.push(`/api/leads?order=kanban array(${leads.leads.length})`);

    console.log(`Live smoke OK: ${base} -> v${expectedVersion}${expectedLabel ? ` — ${expectedLabel}` : ''}`);
    for (const line of report) console.log(`  OK ${line}`);
}

main().catch(err => fail(err.message || String(err)));
