'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { encodeInChild } = require('./services/catalogImageThumbnails');
const { buildBanquetSummaryPdfBuffer } = require('./services/banquetSummaryPdf');

const base = 'http://127.0.0.1:3000';
const fixtureDatabase = /^eventgenix_artifact_(before|after)_test$/;
assert.match(process.env.PGDATABASE || '', fixtureDatabase);
assert.match(process.env.PGHOST || '', /^eventgenix-artifact-db-\d+-\d+$/);
assert.equal(process.env.BOOTSTRAP_CREATOR_USERNAME, 'artifact_smoke');
assert.ok(!process.env.DATABASE_URL && !process.env.RAILWAY_PROJECT_ID);

async function read(route, options = {}) {
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `${route} returned HTTP ${response.status}`);
    return response;
}

async function main() {
    const started = performance.now();
    while (true) {
        try {
            const ready = await read('/api/ready');
            if ((await ready.json()).status === 'ok') break;
        } catch (error) {
            if (performance.now() - started > 90000) throw error;
        }
        await delay(250);
    }
    console.log(`Ready after ${Math.round(performance.now() - started)} ms of polling`);
    const health = await read('/api/health');
    assert.equal((await health.json()).status, 'ok');
    const version = await (await read('/api/version')).json();
    assert.equal(version.version, require('./package.json').version);
    if (process.env.EXPECTED_COMMIT) {
        assert.equal(version.commitSha, process.env.EXPECTED_COMMIT);
        assert.equal(version.sourceBranch, process.env.EXPECTED_BRANCH);
        assert.equal(version.deploymentMetadata.status, 'manifest');
    }
    const asset = await read('/css/education-schedule.css');
    assert.match(asset.headers.get('content-type'), /text\/css/);
    assert.ok((await asset.text()).length > 100);

    const login = await read('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'artifact_smoke', password: process.env.BOOTSTRAP_CREATOR_PASSWORD })
    });
    const session = await login.json();
    assert.ok(session.token || session.accessToken);
    const headers = { Authorization: `Bearer ${session.token || session.accessToken}`, 'Content-Type': 'application/json' };
    const name = 'Synthetic Artifact Customer';
    const created = await read('/api/customers?businessContext=event_genix', {
        method: 'POST', headers, body: JSON.stringify({ name })
    });
    const customer = await created.json();
    const list = await read('/api/customers?limit=50&businessContext=event_genix', { headers });
    assert.ok(JSON.stringify(await list.json()).includes(name), 'Synthetic customer appears in the list');
    for (const term of ['Synthetic Artifact Customer', 'Synthetic Artifact']) {
        const search = await read('/api/customers/search?q=' + encodeURIComponent(term) + '&businessContext=event_genix', { headers });
        assert.ok((await search.json()).some(row => row.id === customer.id));
    }
    const workbook = await read('/api/customers/export-xlsx?businessContext=event_genix', { headers });
    assert.equal(Buffer.from(await workbook.arrayBuffer()).subarray(0, 2).toString(), 'PK');

    const fixture = JSON.parse(fs.readFileSync('/tmp/artifact-pdf-fixture.json', 'utf8'));
    const pdf = await buildBanquetSummaryPdfBuffer(fixture.summary || fixture, { mode: 'client' });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const png = await require('sharp')({
        create: { width: 512, height: 64, channels: 3, background: '#ff3300' }
    }).png().toBuffer();
    const thumbnail = await encodeInChild(png, 384);
    assert.equal(thumbnail.subarray(8, 12).toString(), 'WEBP');
    console.log('Health, metadata, static assets, customer API, Excel, PDF and native thumbnail smoke passed.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
