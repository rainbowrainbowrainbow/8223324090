'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCatalog, parseLegacyArchive } = require('../services/changelog-page');
const { TAG_PREFIX, releaseBody } = require('../services/release-changelog');
const { publishReleaseNotes } = require('../scripts/publish-release-notes');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const entry = {
    version: '0.90.1',
    sha: 'a'.repeat(40),
    label: 'Зміни <CRM>',
    notes: [{ title: 'Архів', text: 'Доступний <script>опис</script>.' }]
};
const branch = 'codex/eventgenix-production';
const release = {
    tag_name: TAG_PREFIX + entry.version, target_commitish: entry.sha, published_at: '2026-11-16T10:00:00Z',
    body: releaseBody(entry), html_url: 'https://example.test/releases/changelog'
};
const live = { version: entry.version, commitSha: entry.sha, sourceBranch: branch, deploymentMetadata: { complete: true } };

test('the login shell omits archived markup and retains historical notes in the archive source', () => {
    const index = read('index.html');
    const source = read('changelog-history.fragment');
    const archive = parseLegacyArchive(source);
    assert.match(index, /id="changelogEntries"[^>]*><\/div>/);
    assert.doesNotMatch(index, /<h4>v\d+\.\d+\./);
    const expected = new Set([...source.matchAll(/<h4>v(\d+\.\d+(?:\.\d+)?)(?=\s|<)/g)].map(match => match[1]));
    for (const version of ['0.83.85', '0.83.83', '0.83.80', '0.83.78', '0.83.76']) expected.delete(version);
    assert.deepEqual(new Set(archive.map(item => item.version)), expected);
    assert(archive.length > 2100);
    for (const version of ['0.83.87', '0.83.86', '0.83.84', '0.83.82', '0.83.81', '0.78.101', '0.78.98', '0.61.0', '0.60.0', '2.9']) {
        assert(archive.some(item => item.version === version), version);
    }
    for (const version of ['0.83.83', '0.83.80', '0.83.78', '0.83.76']) {
        assert(source.includes('<h4>v' + version + ' '), version);
        assert(!archive.some(item => item.version === version), version);
    }
});

test('only published exact-release entries are visible, and pagination keeps the archive complete', async () => {
    let calls = 0;
    const fake = [
        release, { ...release, tag_name: TAG_PREFIX + '0.90.2', draft: true },
        { ...release, target_commitish: 'b'.repeat(40) }
    ];
    const catalog = createCatalog({ fetchImpl: async () => {
        calls += 1;
        return Response.json(fake);
    } });
    const [page, same] = await Promise.all([catalog(), catalog()]);
    assert.equal(calls, 1);
    assert.deepEqual(same, page);
    assert.match(page.html, /v0\.90\.1 — Зміни &lt;CRM&gt;/);
    assert.doesNotMatch(page.html, /<script>/);
    assert.equal((page.html.match(/<h4>/g) || []).length, 10);
    const older = await catalog({ after: page.next });
    assert(!older.html.includes('v' + page.next + ' —'));
    assert(older.next);
    assert.equal(calls, 1);
    const direct = await catalog({ version: '2.9', archive: true });
    assert.match(direct.html, /Нові функції/);
    assert.equal(direct.next, null);
    const archiveYear = await catalog({ year: '2026', archive: true });
    assert(archiveYear.years.includes('2026'));
    assert.match(archiveYear.html, /v0\.90\.1/);
    assert.match(await catalog({ format: 'markdown' }), /## v0\.90\.1/);
    assert.equal(await catalog({ after: '9.9.9' }), null);
});

test('a provider outage keeps the last known catalog and a cold outage keeps the legacy archive', async () => {
    let time = 0;
    let offline = false;
    const fetchImpl = async () => {
        if (offline) throw new Error('unavailable');
        return Response.json([release]);
    };
    const catalog = createCatalog({ fetchImpl, now: () => time });
    assert.match((await catalog()).html, /v0\.90\.1/);
    offline = true;
    time += 300001;
    assert.match((await catalog()).html, /v0\.90\.1/);
    const cold = createCatalog({ fetchImpl });
    assert.match((await cold()).html, /v0\.83\.84/);
});

test('publication checks live identity, creates one receipt and refuses a conflicting tag', async () => {
    let current;
    let writes = 0;
    const tag = { object: { type: 'commit', sha: entry.sha } };
    const request = async (endpoint, payload) => {
        if (endpoint === '/releases') {
            writes += 1;
            assert.equal(payload.target_commitish, entry.sha);
            assert.equal(payload.draft, false);
            current = release;
            return current;
        }
        return endpoint.startsWith('/git/') ? (current ? tag : null) : current;
    };
    await assert.rejects(publishReleaseNotes({ entry, live: { ...live, commitSha: 'b'.repeat(40) }, sourceBranch: branch, request }), /exact verified/);
    assert.equal(writes, 0);
    await publishReleaseNotes({ entry, live, sourceBranch: branch, request });
    await publishReleaseNotes({ entry, live, sourceBranch: branch, request });
    assert.equal(writes, 1);
    await assert.rejects(publishReleaseNotes({ entry: { ...entry, label: 'Інший опис' }, live, sourceBranch: branch, request }), /different content/);
    assert.equal(writes, 1);
});
