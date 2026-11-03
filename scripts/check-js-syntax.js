#!/usr/bin/env node
/**
 * Lightweight JavaScript parser check.
 *
 * This is not a linter or typechecker. It only verifies that repository-owned
 * JavaScript files parse under the current Node runtime.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

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
            // Root output contains generated QA evidence and historical source copies.
            if (dir === ROOT && entry.name === 'output') continue;
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

// Keep Node's own --check semantics for every file. A small bound speeds up
// process startup without starting an unbounded number of child processes.
const concurrency = Math.min(4, Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length));

function check(file) {
    return new Promise(resolve => {
        let child;
        try { child = spawn(process.execPath, ['--check', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (error) { resolve({ status: null, output: error.message }); return; }
        let stdout = '', stderr = '', error;
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', err => { error = err; });
        child.on('close', status => resolve({ status, output: (stderr || stdout || error?.message || '').trim() }));
    });
}

async function main() {
    const results = new Array(files.length);
    let next = 0;
    async function worker() {
        while (next < files.length) {
            const index = next++;
            results[index] = await check(files[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
    const failures = [];
    for (let index = 0; index < files.length; index++) {
        if (results[index].status === 0) continue;
        const rel = relativePath(files[index]);
        const output = results[index].output;
        failures.push({ rel, output });
        console.error(`FAIL ${rel}`);
        if (output) console.error(output);
    }
    if (failures.length) {
        console.error(`\nJavaScript syntax check failed: ${failures.length}/${files.length} files failed.`);
        process.exitCode = 1;
        return;
    }
    console.log(`JavaScript syntax check passed: ${files.length} files.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
