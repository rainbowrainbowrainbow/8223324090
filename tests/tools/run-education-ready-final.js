'use strict';
// Compatibility dispatcher. Every supported suite uses exact-attempt v2 validation.
const { spawnSync } = require('node:child_process');
const contracts = require('../helpers/education-close-contracts.json');
const requested = process.argv.slice(2);
if (!requested.length) { console.error('Specify education suites; use run-education-close-ci.js'); process.exitCode = 1; }
for (const request of requested) {
    const suite = request.replace(/^mobile-chromium$|^mobile-webkit$/, 'responsive').replace(/-webkit$/, '');
    if (!contracts[suite]) { console.error('Unsupported historical suite: ' + request + '; no execution evidence claimed'); process.exitCode = 1; break; }
    const engine = request.endsWith('webkit') ? 'webkit' : 'chromium';
    const result = spawnSync(process.execPath, ['tests/integration/run-education-close-ci.js', suite, engine], { stdio: 'inherit', env: process.env, windowsHide: true });
    if (result.status !== 0) { process.exitCode = 1; break; }
}
