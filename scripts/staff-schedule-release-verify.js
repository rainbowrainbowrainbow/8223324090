#!/usr/bin/env node
'use strict';

/**
 * Mandatory standalone Staff Schedule release verification.
 *
 * This command is intentionally not wired into CI or the shared release gate.
 * It requires a deployed target because both live checks are mandatory.
 *
 * Usage:
 *   npm run release:staff-schedule:verify -- https://example.up.railway.app
 *   STAFF_SCHEDULE_RELEASE_URL=https://example.up.railway.app npm run release:staff-schedule:verify
 */

const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function fail(message) {
    console.error(`[staff-schedule-release] ERROR: ${message}`);
    process.exit(1);
}

function normalizeLiveUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        return url.origin;
    } catch {
        fail('provide a valid http(s) URL argument or STAFF_SCHEDULE_RELEASE_URL/LIVE_STAFF_SCHEDULE_URL/LIVE_SMOKE_URL/TEST_URL');
    }
}

const liveUrl = normalizeLiveUrl(
    process.argv.find(arg => /^https?:\/\//i.test(arg))
        || process.env.STAFF_SCHEDULE_RELEASE_URL
        || process.env.LIVE_STAFF_SCHEDULE_URL
        || process.env.LIVE_SMOKE_URL
        || process.env.TEST_URL
);
const npmCommand = 'npm';
const useShell = process.platform === 'win32';

function runStep(label, args) {
    const startedAt = performance.now();
    console.log(`\n[staff-schedule-release] ${label}`);
    const result = spawnSync(npmCommand, args, {
        stdio: 'inherit',
        shell: useShell,
        env: process.env
    });
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    if (result.error) fail(`${label}: ${result.error.message}`);
    if (result.status !== 0) {
        console.error(`[staff-schedule-release] FAILED: ${label} (${seconds}s)`);
        process.exit(result.status || 1);
    }
    console.log(`[staff-schedule-release] OK: ${label} (${seconds}s)`);
}

runStep('runtime baseline', ['run', 'check:runtime']);
runStep('focused deterministic contracts', ['run', 'test:staff-schedule']);
runStep('full fast CI-equivalent baseline', ['test']);
runStep('local Playwright regression smoke', ['run', 'test:browser:staff-schedule']);
runStep('deployed read-only Staff Schedule smoke', ['run', 'smoke:staff-schedule', '--', liveUrl]);
runStep('deployed version contract', ['run', 'version:smoke', '--', liveUrl]);

console.log('\n[staff-schedule-release] Staff Schedule release verification passed.');
