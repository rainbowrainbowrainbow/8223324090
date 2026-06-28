#!/usr/bin/env node
/**
 * Scheduler surface ownership guard.
 *
 * Keeps server.js scheduled background work aligned with an explicit manifest
 * before future cleanup changes remove, merge, or retime side-effect jobs.
 */

const fs = require('fs');
const path = require('path');
const {
    GUARDED_SCHEDULER_JOBS,
    RAW_SCHEDULER_INTERVALS,
    STATIC_ONLY_SCHEDULER_JOBS,
    SCHEDULER_SURFACE_DOC
} = require('../config/schedulerSurface');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'server.js');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const failures = [];
const ALLOWED_DEDUP = new Set(['daily', 'hourly', '5min', null]);

function fail(message) {
    failures.push(message);
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function compareSets(label, actual, expected) {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    const missing = expectedSorted.filter(item => !actualSorted.includes(item));
    const extra = actualSorted.filter(item => !expectedSorted.includes(item));
    if (missing.length || extra.length) {
        fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`);
    }
}

function ensureUnique(label, entries, key) {
    const seen = new Map();
    for (const entry of entries) {
        const value = entry[key];
        if (!value) {
            fail(`${label}: missing ${key}`);
            continue;
        }
        if (seen.has(value)) {
            fail(`${label}: duplicate ${key} "${value}"`);
        }
        seen.set(value, true);
    }
}

function readRequired(relativePath) {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
        fail(`${relativePath}: file missing`);
        return '';
    }
    return fs.readFileSync(fullPath, 'utf8');
}

function parseGuardedJobs(server) {
    const jobs = [];
    const lines = server.split(/\r?\n/);
    const guardRe = /guardScheduler\('([^']+)'\s*,\s*([A-Za-z0-9_]+)\s*(?:,\s*\{\s*dedup:\s*(null|'[^']+')\s*\})?\)/;

    for (const line of lines) {
        const guardMatch = line.match(guardRe);
        if (!guardMatch) continue;

        const intervalMatch = line.match(/\),\s*([^)]*?)\)\);/);
        let dedup = 'daily-default';
        if (guardMatch[3] === 'null') {
            dedup = null;
        } else if (guardMatch[3]) {
            dedup = guardMatch[3].replace(/^'|'$/g, '');
        }

        jobs.push({
            name: guardMatch[1],
            functionName: guardMatch[2],
            dedup,
            interval: normalizeWhitespace(intervalMatch?.[1] || '')
        });
    }

    return jobs;
}

function assertDocMentions(doc, value, label) {
    if (!doc.includes(`\`${value}\``)) {
        fail(`${SCHEDULER_SURFACE_DOC}: missing ${label} ${value}`);
    }
}

function extractDocSection(doc, heading) {
    const start = doc.indexOf(heading);
    if (start === -1) return '';
    const rest = doc.slice(start + heading.length);
    const next = rest.search(/\n## /);
    return next === -1 ? rest : rest.slice(0, next);
}

function assertSourceHasFunction(job) {
    if (job.sourceFile === 'server.js:inline') {
        if (!server.includes(`function ${job.functionName}(`)) {
            fail(`${job.name}: inline function ${job.functionName} not found in server.js`);
        }
        return;
    }

    const source = readRequired(job.sourceFile);
    if (!source.includes(job.functionName)) {
        fail(`${job.name}: ${job.functionName} not referenced in ${job.sourceFile}`);
    }
    if (!source.includes('module.exports') || !source.includes(job.functionName)) {
        fail(`${job.name}: ${job.functionName} must remain exported from ${job.sourceFile}`);
    }
}

const server = fs.readFileSync(SERVER_PATH, 'utf8');
const docPath = path.join(ROOT, SCHEDULER_SURFACE_DOC);
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));

if (!doc) fail(`${SCHEDULER_SURFACE_DOC} is required`);
if (!packageJson.scripts?.['check:scheduler-surface']) {
    fail('package.json scripts.check:scheduler-surface is required');
}
if (!packageJson.scripts?.verify?.includes('check:scheduler-surface')) {
    fail('package.json verify must include check:scheduler-surface');
}

ensureUnique('guarded scheduler jobs', GUARDED_SCHEDULER_JOBS, 'name');
ensureUnique('raw scheduler intervals', RAW_SCHEDULER_INTERVALS, 'name');

const actualGuardedJobs = parseGuardedJobs(server);
const actualByName = new Map(actualGuardedJobs.map(job => [job.name, job]));

compareSets(
    'server.js guardScheduler names',
    actualGuardedJobs.map(job => job.name),
    GUARDED_SCHEDULER_JOBS.map(job => job.name)
);

for (const job of GUARDED_SCHEDULER_JOBS) {
    if (!job.functionName || !job.sourceFile || !job.owner || !job.interval) {
        fail(`${job.name}: guarded manifest entry is incomplete`);
    }
    if (!ALLOWED_DEDUP.has(job.dedup)) {
        fail(`${job.name}: unsupported dedup "${job.dedup}"`);
    }
    if (!Array.isArray(job.sideEffects) || job.sideEffects.length === 0) {
        fail(`${job.name}: sideEffects must be a non-empty array`);
    }

    assertDocMentions(doc, job.name, 'guarded job');
    assertDocMentions(doc, job.sourceFile, 'source file');
    assertSourceHasFunction(job);

    for (const testPath of job.tests || []) {
        if (!fs.existsSync(path.join(ROOT, testPath))) {
            fail(`${job.name}: test anchor ${testPath} does not exist`);
        }
        assertDocMentions(doc, testPath, 'test anchor');
    }

    const actual = actualByName.get(job.name);
    if (!actual) continue;
    if (actual.functionName !== job.functionName) {
        fail(`${job.name}: server function ${actual.functionName} does not match manifest ${job.functionName}`);
    }
    if (actual.dedup !== job.dedup) {
        fail(`${job.name}: server dedup ${actual.dedup} does not match manifest ${job.dedup}`);
    }
    if (normalizeWhitespace(actual.interval) !== normalizeWhitespace(job.interval)) {
        fail(`${job.name}: server interval ${actual.interval} does not match manifest ${job.interval}`);
    }
}

const dailyDefaultJobs = GUARDED_SCHEDULER_JOBS.filter(job => job.dedup === 'daily-default');
if (dailyDefaultJobs.length > 0) {
    fail(`No scheduler job may rely on guardScheduler default daily dedup; make dedup explicit for: ${dailyDefaultJobs.map(job => job.name).join(', ')}`);
}

const rawServerSetIntervals = server.split(/\r?\n/)
    .filter(line => line.includes('setInterval('))
    .filter(line => !line.includes('guardScheduler('))
    .filter(line => !line.trim().startsWith('//'))
    .length;
const expectedRawSetIntervals = RAW_SCHEDULER_INTERVALS.filter(job => job.kind === 'setInterval').length;
if (rawServerSetIntervals !== expectedRawSetIntervals) {
    fail(`raw server setInterval count mismatch: server has ${rawServerSetIntervals}, manifest has ${expectedRawSetIntervals}`);
}

for (const job of RAW_SCHEDULER_INTERVALS) {
    if (!['setInterval', 'setTimeout', 'starter'].includes(job.kind)) {
        fail(`${job.name}: unsupported raw scheduler kind "${job.kind}"`);
    }
    if (!job.functionName || !job.sourceFile || !job.owner || !job.fragment) {
        fail(`${job.name}: raw scheduler entry is incomplete`);
    }
    assertDocMentions(doc, job.name, 'raw interval');
    assertDocMentions(doc, job.sourceFile, 'raw source file');
    if (!server.includes(job.fragment)) {
        fail(`${job.name}: fragment not found in server.js`);
    }
    if (job.interval && !server.includes(job.interval)) {
        fail(`${job.name}: interval ${job.interval} not found in server.js`);
    }
}

const jobsWithoutDirectTests = [
    ...GUARDED_SCHEDULER_JOBS,
    ...RAW_SCHEDULER_INTERVALS
]
    .filter(job => !Array.isArray(job.tests) || job.tests.length === 0)
    .map(job => job.name);
compareSets('static-only scheduler coverage register', STATIC_ONLY_SCHEDULER_JOBS, jobsWithoutDirectTests);

const staticOnlyDoc = extractDocSection(doc, '## Static-Only Coverage Debt');
if (!staticOnlyDoc) {
    fail(`${SCHEDULER_SURFACE_DOC}: missing Static-Only Coverage Debt section`);
}
for (const name of STATIC_ONLY_SCHEDULER_JOBS) {
    if (!staticOnlyDoc.includes(`\`${name}\``)) {
        fail(`${SCHEDULER_SURFACE_DOC}: static-only coverage section missing ${name}`);
    }
}

if (!server.includes('Schedulers started (guarded):')) {
    fail('server.js scheduler startup log marker is missing');
}
if (!doc.includes('Do not remove retry or fallback paths until failure semantics are documented.')) {
    fail(`${SCHEDULER_SURFACE_DOC}: missing side-effect cleanup safety rule`);
}

if (failures.length) {
    console.error('Scheduler surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Scheduler surface check passed: ${GUARDED_SCHEDULER_JOBS.length} guarded jobs, ${RAW_SCHEDULER_INTERVALS.length} raw intervals/starters.`);
