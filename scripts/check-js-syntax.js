#!/usr/bin/env node
/**
 * Lightweight JavaScript parser check.
 *
 * This is not a linter or typechecker. It only verifies that repository-owned
 * JavaScript files parse under the current Node runtime.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'uploads', 'sounds']);
const files = [];

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(path.join(dir, entry.name));
        }
    }
}

walk(ROOT);
files.sort();

const failures = [];

for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        failures.push({ rel, output: (result.stderr || result.stdout || '').trim() });
        console.error(`FAIL ${rel}`);
        if (result.stderr || result.stdout) {
            console.error((result.stderr || result.stdout).trim());
        }
    }
}

if (failures.length > 0) {
    console.error(`\nJavaScript syntax check failed: ${failures.length}/${files.length} files failed.`);
    process.exit(1);
}

console.log(`JavaScript syntax check passed: ${files.length} files.`);
