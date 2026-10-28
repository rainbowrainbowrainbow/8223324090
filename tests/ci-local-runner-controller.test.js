'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertRun, assertAcceptsJobs, assertDiskSpace, assertWindow, labelForJob, findRegisteredJob, retryRead } = require('../scripts/ci-local-runner-controller.cjs');

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
  const sha = 'a'.repeat(40), config = { sha, attempt: 1 };
  const run = { head_sha: sha, head_branch: 'codex/hr-tenant-ownership-20261023', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: 'rainbowrainbowrainbow/8223324090' }, run_attempt: 1, status: 'queued', conclusion: null };
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
  const run = { head_sha: sha, head_branch: 'codex/hr-tenant-ownership-20261023', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: 'rainbowrainbowrainbow/8223324090' } };
  assert.doesNotThrow(() => assertRun(run, { sha }));
  for (const changed of [
    { head_sha: 'b'.repeat(40) }, { head_branch: 'codex/eventgenix-production' },
    { event: 'pull_request' }, { event: 'workflow_dispatch' },
    { path: '.github/workflows/unreviewed.yml' }, { repository: { full_name: 'someone/fork' } }
  ]) assert.throws(() => assertRun({ ...run, ...changed }, { sha }), /identity mismatch/);
});

test('controller routing covers every existing named CI job and rejects unknown jobs', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const names = [...workflow.matchAll(/^    name: (.+)\r?$/gm)].map(match => match[1].trim());
  assert.equal(names.length, 9);
  for (const name of names.filter(value => !value.includes('matrix.'))) {
    const label = labelForJob(name);
    assert.ok(workflow.includes(`"eventgenix-ci","${label}"]`));
  }
  assert.equal(labelForJob('Education hrLink (webkit)'), 'education-regressions');
  assert.equal(labelForJob('Education acceptance (chromium)'), 'education-regressions');
  assert.throws(() => labelForJob('unreviewed workflow'), /Unrecognized/);
});
