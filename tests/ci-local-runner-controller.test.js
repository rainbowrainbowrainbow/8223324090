'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertRun, assertDiskSpace, assertWindow, labelForJob } = require('../scripts/ci-local-runner-controller.cjs');

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
  const run = { head_sha: sha, head_branch: 'codex/ci-local-runner-20261027', event: 'push', path: '.github/workflows/ci.yml', repository: { full_name: 'rainbowrainbowrainbow/8223324090' } };
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
