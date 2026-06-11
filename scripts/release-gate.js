#!/usr/bin/env node
'use strict';

/**
 * Local pre-deploy release gate.
 *
 * Usage:
 *   npm run release:gate
 *   npm run release:gate -- https://example.up.railway.app
 *   RELEASE_GATE_LIVE_URL=https://example.up.railway.app npm run release:gate
 */

const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const liveUrl = process.argv[2] || process.env.RELEASE_GATE_LIVE_URL || process.env.LIVE_SMOKE_URL || '';
const npmCmd = 'npm';
const useShell = process.platform === 'win32';

function runStep(label, command, args, options = {}) {
    const start = performance.now();
    console.log(`\n[release:gate] ${label}`);
    console.log(`[release:gate] > ${[command, ...args].join(' ')}`);
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: useShell,
        env: { ...process.env, ...options.env }
    });
    if (result.error) {
        console.error(`\n[release:gate] ERROR: ${result.error.message}`);
    }
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    if (result.status !== 0) {
        console.error(`\n[release:gate] FAILED: ${label} (${seconds}s)`);
        process.exit(result.status || 1);
    }
    console.log(`[release:gate] OK: ${label} (${seconds}s)`);
}

runStep('current version and branch freshness', npmCmd, ['run', 'version:current']);
runStep('full local verification baseline', npmCmd, ['test']);

if (liveUrl) {
    runStep('live operational smoke', npmCmd, ['run', 'smoke:live', '--', liveUrl]);
    runStep('timeline live asset proof', npmCmd, ['run', 'release:timeline-proof', '--', liveUrl]);
} else {
    console.log('\n[release:gate] No live URL provided; skipped live smoke/proof.');
    console.log('[release:gate] After deploy run: npm run smoke:live -- https://<live-crm-host>');
}

console.log('\n[release:gate] Release gate passed.');
