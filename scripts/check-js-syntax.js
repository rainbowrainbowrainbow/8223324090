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
const SKIP_DIRS = new Set(['.git', 'node_modules', 'uploads', 'sounds', 'tmp', '.codex-temp', 'test-results', 'playwright-report', 'coverage']);
const files = [];

function relativePath(file) {
    return path.relative(ROOT, file).split(path.sep).join('/');
}

function walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        if (['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) {
            console.warn(`WARN skip unreadable directory ${relativePath(dir)}: ${error.code}`);
            return;
        }
        throw error;
    }
    for (const entry of entries) {
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
    const rel = relativePath(file);
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || result.error?.message || '').trim();
        failures.push({ rel, output });
        console.error(`FAIL ${rel}`);
        if (output) {
            console.error(output);
        }
    }
}

if (failures.length > 0) {
    console.error(`\nJavaScript syntax check failed: ${failures.length}/${files.length} files failed.`);
    process.exit(1);
}

console.log(`JavaScript syntax check passed: ${files.length} files.`);
