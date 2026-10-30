'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertRun, assertAcceptsJobs, assertDiskSpace, assertWindow, labelForJob, findRegisteredJob, retryRead, commandFailure } = require('../scripts/ci-local-runner-controller.cjs');

test('unknown GitHub read failures retry without leaking CLI output; permanent HTTP failures stop', () => {
  const secret = 'never-log-this-token';
  const unknown = commandFailure('gh', { status: 1, stderr: `unexpected CLI error ${secret}` });
  assert.equal(unknown.code, 'GH_EXIT');
  assert.equal(unknown.transientRead, true);
  assert.equal(unknown.message.includes(secret), false);
  let attempts = 0;
  assert.equal(retryRead(() => { if (++attempts === 1) throw unknown; return 'verified response'; }, () => {}), 'verified response');
  assert.equal(attempts, 2);

  for (const status of [401, 403, 404]) {
    const error = commandFailure('gh', { status: 1, stderr: `gh: denied (HTTP ${status}) ${secret}` });
    assert.equal(error.code, `GH_HTTP_${status}`);
    assert.equal(error.transientRead, false);
    assert.equal(error.message.includes(secret), false);
  }
  for (const status of [408, 429, 500, 503]) {
    const error = commandFailure('gh', { status: 1, stderr: `gh: temporary (HTTP ${status}) ${secret}` });
    assert.equal(error.transientRead, true);
    assert.equal(error.message.includes(secret), false);
  }
  assert.equal(commandFailure('gh', { error: { code: 'ENOENT' } }).transientRead, false);
  assert.equal(commandFailure('ssh.exe', { status: 255, stderr: secret }).message.includes(secret), false);
});

test('transient read failures retry with bounded backoff; permanent failures stop immediately', () => {
  const transient = Object.assign(new Error('temporary connection failure'), { transientRead: true });
  const waits = [];
  let attempts = 0;
  assert.equal(retryRead(() => { if (++attempts < 3) throw transient; return 'verified response'; }, ms => waits.push(ms)), 'verified response');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [2000, 4000]);
  attempts = 0;
  assert.throws(() => retryRead(() => { attempts++; throw transient; }, () => {}), error => error === transient);
  assert.equal(attempts, 4);
  attempts = 0;
  assert.throws(() => retryRead(() => { attempts++; throw new Error('identity or authorization failure'); }, () => assert.fail('Permanent error must not wait')), /identity or authorization/);
  assert.equal(attempts, 1);
});

test('cancelled or superseded workflow attempts cannot register another idle worker', () => {
  const sha = 'a'.repeat(40), config = { sha, branch: 'codex/chat-business-ownership-release', attempt: 1 };
  const run = { head_sha: sha, head_branch: config.branch, event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: 'rainbowrainbowrainbow/8223324090' }, run_attempt: 1, status: 'queued', conclusion: null };
  assert.doesNotThrow(() => assertAcceptsJobs(run, config));
  assert.doesNotThrow(() => assertAcceptsJobs({ ...run, status: 'in_progress' }, config));
  for (const change of [{ status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: 'success' }, { run_attempt: 2 }]) {
    assert.throws(() => assertAcceptsJobs({ ...run, ...change }, config), /no longer accepts/);
  }
});

test('reused matrix runner names cannot substitute an earlier successful registration', () => {
  const name = 'EventGenix-CI-same-matrix-slot';
  const earlier = { id: 101, runner_id: 30, runner_name: name, status: 'completed', conclusion: 'success' };
  const current = { id: 102, runner_id: 31, runner_name: name, status: 'completed', conclusion: 'failure' };
  assert.equal(findRegisteredJob([earlier, current], 31, name), current);
  assert.equal(findRegisteredJob([earlier, { ...current, status: 'in_progress' }], 31, name, 'in_progress').id, 102);
  assert.equal(findRegisteredJob([earlier], 31, name), undefined);
});

test('UTC deadline is enforced after waits and does not gain the local timezone offset', () => {
  const now = Date.parse('2026-10-27T20:01:00Z');
  for (const deadlineUtc of ['2026-10-27T19:55:35Z', '2026-10-27T21:55:35+02:00', 'invalid']) {
    assert.throws(() => assertWindow({ deadlineUtc }, now), /expired/);
  }
  assert.doesNotThrow(() => assertWindow({ deadlineUtc: '2026-10-27T20:02:00Z' }, now));
  assert.throws(() => assertWindow({ deadlineUtc: '2026-10-27T20:01:00Z' }, now), /expired/);
});

test('stops before a new disposable job when host archive storage is insufficient or unknown', () => {
  assert.doesNotThrow(() => assertDiskSpace({ bsize: 4096, bavail: 10 * 1024 ** 3 / 4096 }));
  assert.throws(() => assertDiskSpace({ bsize: 4096, bavail: 1000 }), /10 GiB/);
  assert.throws(() => assertDiskSpace({}), /10 GiB/);
});

test('accepts only exact-SHA pushes from the approved repository, branch and workflow', () => {
  const sha = 'a'.repeat(40);
  const run = { head_sha: sha, head_branch: 'codex/chat-business-ownership-release', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: 'rainbowrainbowrainbow/8223324090' } };
  assert.doesNotThrow(() => assertRun(run, { sha, branch: run.head_branch }));
  assert.doesNotThrow(() => assertRun({ ...run, head_branch: 'codex/eventgenix-production' }, { sha, branch: 'codex/eventgenix-production' }));
  for (const changed of [
    { head_sha: 'b'.repeat(40) }, { head_branch: 'codex/ci-local-runner-20261027' },
    { event: 'pull_request' }, { event: 'workflow_dispatch' },
    { path: '.github/workflows/unreviewed.yml' }, { repository: { full_name: 'someone/fork' } }
  ]) assert.throws(() => assertRun({ ...run, ...changed }, { sha, branch: run.head_branch }), /identity mismatch/);
  assert.throws(() => assertRun(run, { sha, branch: 'codex/unreviewed' }), /identity mismatch/);
});

test('controller routing covers every existing named CI job and rejects unknown jobs', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const names = [...workflow.matchAll(/^    name: (.+)\r?$/gm)].map(match => match[1].trim());
  const routes = [...workflow.matchAll(/^    runs-on: (.+)\r?$/gm)].map(match => match[1].trim());
  assert.equal(names.length, 9);
  assert.equal(routes.length, names.length);
  for (const route of routes) {
    assert.ok(route.includes("github.event_name == 'push'"));
    assert.ok(route.includes("github.ref == 'refs/heads/codex/chat-business-ownership-release'"));
    assert.ok(route.includes("github.ref == 'refs/heads/codex/eventgenix-production'"));
    assert.ok(route.includes("|| 'ubuntu-latest'"));
    assert.equal(route.includes('codex/ci-local-runner-20261027'), false);
  }
  for (const name of names.filter(value => !value.includes('matrix.'))) {
    const label = labelForJob(name);
    assert.ok(workflow.includes(`"eventgenix-ci","${label}"]`));
  }
  assert.equal(labelForJob('Education hrLink (webkit)'), 'education-regressions');
  assert.equal(labelForJob('Education acceptance (chromium)'), 'education-regressions');
  assert.throws(() => labelForJob('unreviewed workflow'), /Unrecognized/);
});
