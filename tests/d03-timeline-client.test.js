'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../js/timeline-context.js'), 'utf8');

function fixture(t, key, url = '/', mode = 'membership') {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://fixture.test' + url, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const entry = { key, accessMode: mode, label: 'Fresh business brand', shortLabel: 'Fresh',
        timelineRoute: key === 'event_genix' ? '/' : `/?businessContext=${key}`,
        timeline: { mode: key === 'event_genix' ? 'park' : 'simple', timelineEnabled: true } };
    const profile = { membershipMode: mode, activeBusinessId: key, accessContext: { status: 'ready' } };
    dom.window.CrmBusinessContext = { current: () => key, profile: () => profile,
        profileFor: context => context === key ? entry : null,
        state: () => ({ activeBusinessId: key, source: 'server_business_profile' }) };
    dom.window.eval(source);
    return { api: dom.window.TimelineBusinessContext, entry, profile };
}

test('implicit root and explicit custom URL retain the fresh membership context for API reads and writes', t => {
    for (const url of ['/', '/?businessContext=fixture_studio']) {
        const { api } = fixture(t, 'fixture_studio', url);
        assert.equal(api.current().key, 'fixture_studio');
        assert.match(api.appendApiContext('/api/bookings'), /businessContext=fixture_studio/);
        assert.equal(api.withApiContext({}).businessContext, 'fixture_studio');
        assert.equal(api.current().brandName, 'Fresh business brand');
        assert.equal(api.current().pageAccessPath, '/');
    }
});

test('membership Park uses updated registry branding while keeping its protected navigation/capability path', t => {
    const { api } = fixture(t, 'event_genix');
    assert.equal(api.current().brandName, 'Fresh business brand');
    assert.equal(api.current().pageAccessPath, '/');
    assert.equal(api.current().storagePrefix, 'pzp');
});

test('historical compatibility root does not inherit a hidden CRM custom business selection', t => {
    const { api } = fixture(t, 'fixture_studio', '/', 'compatibility');
    assert.equal(api.current().key, 'event_genix');
});
