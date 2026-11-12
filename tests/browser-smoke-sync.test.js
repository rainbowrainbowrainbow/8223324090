'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { trackRequests } = require('./helpers/browser-smoke-sync');
const origin = 'http://127.0.0.1:12345';
const request = path => ({ url: () => origin + path, method: () => 'GET', resourceType: () => 'fetch' });

test('a request beginning during an empty interval prevents premature navigation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    let ready = false;
    const idle = tracker.idle({ quietMs: 100, timeoutMs: 1000 }).then(() => { ready = true; });
    t.mock.timers.tick(50);
    const r = request('/api/lines/2030-01-01?businessContext=dar'); context.emit('request', r);
    t.mock.timers.tick(150); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', r); t.mock.timers.tick(99); await Promise.resolve(); assert.equal(ready, false);
    t.mock.timers.tick(1); await idle; assert.equal(ready, true); tracker.dispose();
});
test('failed requests drain, foreign requests do not block, listeners are released', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const r = request('/api/my-day/timer'); context.emit('request', r);
    context.emit('request', { url: () => 'https://example.invalid/font' });
    const idle = tracker.idle({ quietMs: 10 }); context.emit('requestfailed', r);
    t.mock.timers.tick(10); await idle; tracker.dispose();
    for (const event of ['request', 'requestfinished', 'requestfailed']) assert.equal(context.listenerCount(event), 0);
});
test('a stuck request fails closed with redacted route diagnostics, then a retry can settle', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const r = request('/api/staff/98765?token=secret'); context.emit('request', r);
    const idle = tracker.idle({ quietMs: 10, timeoutMs: 50 });
    const rejected = assert.rejects(idle, error => error.message.includes('/api/staff/:id') && !error.message.includes('secret') && !error.message.includes('98765'));
    t.mock.timers.tick(50); await rejected;
    context.emit('requestfinished', r); const retry = tracker.idle({ quietMs: 10 }); t.mock.timers.tick(10); await retry; tracker.dispose();
});

test('committed navigation retires only old-document reads, keeping writes and current reads strict', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const frame = {}, page = new EventEmitter(); page.mainFrame = () => frame; context.emit('page', page);
    const old = { ...request('/api/lines/123'), frame: () => frame };
    const write = { ...request('/api/tasks/123'), frame: () => frame, method: () => 'POST' };
    context.emit('request', old); context.emit('request', write); page.emit('framenavigated', frame);
    assert.deepEqual(tracker.retiredReads(), [{ method: 'GET', path: '/api/lines/:id', reason: 'previous_document_navigation' }]);
    const current = { ...request('/api/education/groups'), frame: () => frame }; context.emit('request', current);
    let ready = false; const idle = tracker.idle({ quietMs: 10 }).then(() => { ready = true; });
    t.mock.timers.tick(20); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', write); t.mock.timers.tick(20); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', current); t.mock.timers.tick(10); await idle;
    tracker.dispose(); assert.equal(page.listenerCount('framenavigated'), 0); assert.equal(context.listenerCount('page'), 0);
});

function mirrorBootstrapBash() {
    if (process.platform !== 'win32') return '/bin/bash';
    if (process.env.GIT_BASH_PATH) return process.env.GIT_BASH_PATH;
    const { spawnSync } = require('node:child_process');
    const { existsSync } = require('node:fs');
    const path = require('node:path');
    const git = spawnSync('git.exe', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
    const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
        .filter(Boolean).map(dir => path.join(dir, 'Git'));
    if (git.status === 0 && git.stdout.trim()) roots.unshift(path.resolve(git.stdout.trim(), '../../..'));
    const bash = roots.flatMap(dir => [path.join(dir, 'bin', 'bash.exe'), path.join(dir, 'usr', 'bin', 'bash.exe')])
        .find(existsSync);
    assert.ok(bash, 'Git Bash was not found. Set GIT_BASH_PATH to bash.exe from Git for Windows.');
    return bash;
}

function mirrorBootstrapFixture(t, source, mirrorlist) {
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg webkit mirror-'));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const apt = path.join(root, 'etc', 'apt'), sources = path.join(apt, 'sources.list.d', 'ubuntu.sources');
    fs.mkdirSync(path.dirname(sources), { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin', 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
    if (process.platform === 'darwin') {
        // Translate the fixture's GNU sed in-place option for the host BSD sed.
        fs.writeFileSync(path.join(root, 'bin', 'sed'), '#!/bin/sh\nif [ "$1" = -i ]; then shift; exec /usr/bin/sed -i "" "$@"; fi\nexec /usr/bin/sed "$@"\n', { mode: 0o755 });
    }
    if (source != null) fs.writeFileSync(sources, source);
    const mirror = path.join(apt, 'apt-mirrors.txt');
    if (mirrorlist != null) fs.writeFileSync(mirror, mirrorlist);
    const vendor = path.join(apt, 'sources.list.d', 'vendor.list');
    fs.writeFileSync(vendor, 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n');
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const block = workflow.match(/- name: Use Ubuntu archive mirror for (?:WebKit|browser) dependencies[\s\S]*?run: \|\r?\n((?: {10}[^\n]*(?:\n|$))+)/);
    assert.ok(block, 'Read the actual workflow bootstrap, not a copied implementation');
    const shellPath = value => value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
    const quotePath = value => "'" + shellPath(value).replaceAll("'", "'\"'\"'") + "'";
    const body = block[1].split('\n').map(line => line.slice(10)).join('\n').replaceAll('/etc/apt', () => quotePath(apt));
    const bash = mirrorBootstrapBash();
    const run = () => {
        const command = `PATH=${quotePath(path.join(root, 'bin'))}:"$PATH"\n${body}`;
        const result = spawnSync(bash, ['-c', command], { encoding: 'utf8' });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        return result;
    };
    return { run, readSources: () => fs.readFileSync(sources, 'utf8'), readMirror: () => fs.readFileSync(mirror, 'utf8'), readVendor: () => fs.readFileSync(vendor, 'utf8') };
}

test('WebKit bootstrap rewrites direct Ubuntu URIs without changing signatures or third-party sources', t => {
    const fixture = mirrorBootstrapFixture(t, 'URIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n');
    assert.equal(fixture.run().status, 0);
    assert.match(fixture.readSources(), /URIs: https:\/\/archive\.ubuntu\.com\/ubuntu/);
    assert.match(fixture.readSources(), /Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/);
    assert.equal(fixture.readVendor(), 'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n');
});

test('WebKit bootstrap normalizes the runner mirrorlist and is idempotent', t => {
    const source = 'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-security\n';
    const fixture = mirrorBootstrapFixture(t, source, 'http://azure.archive.ubuntu.com/ubuntu\nhttps://azure.archive.ubuntu.com/ubuntu\nhttp://archive.ubuntu.com/ubuntu\n');
    assert.equal(fixture.run().status, 0);
    assert.equal(fixture.readSources(), source);
    assert.doesNotMatch(fixture.readMirror(), /azure\.archive/);
    assert.equal(fixture.readMirror(), 'http://archive.ubuntu.com/ubuntu\nhttps://archive.ubuntu.com/ubuntu\nhttp://archive.ubuntu.com/ubuntu\n');
    const before = fixture.readMirror();
    assert.equal(fixture.run().status, 0);
    assert.equal(fixture.readMirror(), before);
});

test('WebKit bootstrap fails closed when the expected Ubuntu source file is absent', t => {
    const fixture = mirrorBootstrapFixture(t, null, 'http://azure.archive.ubuntu.com/ubuntu\n');
    assert.equal(fixture.run().status, 1);
    assert.equal(fixture.readMirror(), 'http://azure.archive.ubuntu.com/ubuntu\n');
});
