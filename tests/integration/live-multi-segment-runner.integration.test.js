'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const enabled = process.env.RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION === 'true';
const repoRoot = path.resolve(__dirname, '..', '..');

function addDays(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function futureMonday() {
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const seed = addDays(today, 120);
    const date = new Date(`${seed}T00:00:00Z`);
    return addDays(seed, (8 - date.getUTCDay()) % 7);
}

function runLiveQaScript() {
    const runId = `isolated_runner_${process.pid}_${Date.now()}`;
    const env = {
        ...process.env,
        LIVE_MULTI_SEGMENT_QA_CONFIRM: 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA',
        LIVE_MULTI_SEGMENT_QA_RUN_ID: runId,
        LIVE_MULTI_SEGMENT_QA_USER: process.env.TEST_USER,
        LIVE_MULTI_SEGMENT_QA_PASS: process.env.TEST_PASS,
        LIVE_MULTI_SEGMENT_QA_SOURCE_MONDAY: futureMonday(),
        LIVE_MULTI_SEGMENT_QA_TIMEOUT_MS: '30000',
        LIVE_MULTI_SEGMENT_QA_CLEANUP_TIMEOUT_MS: '60000',
        LIVE_MULTI_SEGMENT_QA_OVERALL_TIMEOUT_MS: '180000'
    };
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/live-multi-segment-qa.js', process.env.TEST_URL], {
            cwd: repoRoot,
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', reject);
        child.once('exit', code => resolve({ code, stdout, stderr, runId }));
    });
}

test('full live multi-segment runner passes and confirms cleanup on isolated PostgreSQL', { skip: !enabled, timeout: 180000 }, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const result = await runLiveQaScript();
    assert.equal(result.code, 0, `runner failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /Live multi-segment QA assertions passed:/);
    assert.match(result.stdout, /Cleanup report:/);
    assert.match(result.stdout, /"confirmedClean":true/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(process.env.TEST_PASS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(result.stdout + result.stderr, /Bearer\s+[A-Za-z0-9._-]+/i);
});
