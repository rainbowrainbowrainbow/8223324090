#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCOPES = [
    'services/checkbox',
    'services/payments',
    'routes/payments.js',
    'scripts/checkbox-outbox-recovery.js',
    'scripts/checkbox-readiness-status.js',
    'scripts/checkbox-sandbox-smoke.js',
    'scripts/configure-checkbox-park-pilot.js',
    'docs/integrations/checkbox',
    'tests/checkbox-provider-bridge.test.js',
    'tests/checkbox-sandbox-harness.test.js',
    'tests/checkbox-park-config.test.js',
    'tests/payment-readiness.test.js',
    'tests/payment-fiscal-ledger-foundation.test.js',
    'tests/integration/checkbox-park-cashier-smoke.integration.test.js',
    'tests/integration/checkbox-park-config.integration.test.js',
    'tests/browser/checkbox-cashier-real-routes-browser-smoke.js',
    'cashier-payments.html',
    'js/cashier-payments-page.js'
];

function walk(entry) {
    const absolute = path.join(ROOT, entry);
    if (!fs.existsSync(absolute)) return [];
    const stat = fs.statSync(absolute);
    if (stat.isFile()) return [absolute];
    const files = [];
    for (const child of fs.readdirSync(absolute)) {
        if (child === 'node_modules' || child === '.git') continue;
        files.push(...walk(path.join(entry, child)));
    }
    return files;
}

function relative(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

const files = [...new Set(SCOPES.flatMap(walk))]
    .filter(file => /\.(js|sql|md|html|css)$/.test(file));

const failures = [];
const pinPattern = /\b(?:pin|PIN|ПІН|пін)[^.\n]{0,40}\b1234\b|\b1234\b[^.\n]{0,40}(?:pin|PIN|ПІН|пін)/;
const credentialLiteralPattern = /\b(?:password|license[_-]?key|access[_-]?key|webhook[_-]?secret|token)\s*[:=]\s*['"](?![^'"]*(?:mock|test|example|placeholder|integration|sandbox|redacted|secret|password|license|access|token|qwerty|abc123))[^'"]{8,}['"]/i;
const productionMutationLinePattern = /^\s*(CHECKBOX_INTEGRATION_ENABLED|EVENTGENIX_CASHIER_PRO_ENABLED)\s*=\s*true\b/i;

for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    const rel = relative(file);
    if (pinPattern.test(body)) failures.push(`${rel}: hard-coded 1234 PIN-like value`);
    for (const [index, line] of body.split(/\r?\n/).entries()) {
        const match = line.match(/^\s*(CHECKBOX_[A-Z0-9_<>]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
        if (!match) continue;
        const value = String(match[2] || '').trim();
        if (!value || value.startsWith('<') || /^(false|true|sandbox|test|mock|placeholder|example)$/i.test(value)) continue;
        failures.push(`${rel}:${index + 1}: CHECKBOX_* env template appears to contain a value`);
    }
    if (credentialLiteralPattern.test(body)) failures.push(`${rel}: credential-looking literal is not an approved mock/test placeholder`);
    if (/docs\/integrations\/checkbox\//.test(rel) && body.split(/\r?\n/).some(line => productionMutationLinePattern.test(line))) {
        failures.push(`${rel}: docs must not instruct enabling production fiscal flags in this release gate`);
    }
}

if (failures.length) {
    process.stderr.write(`[checkbox-safety] ${failures.length} issue(s) found:\n`);
    for (const failure of failures) process.stderr.write(`- ${failure}\n`);
    process.exit(1);
}

process.stdout.write('[checkbox-safety] Checkbox source safety scan passed\n');
