#!/usr/bin/env node
/**
 * Timeline/booking protected surface guard.
 *
 * The timeline has a small set of source-of-truth contracts where quiet edits
 * can break production booking opening, identity, or DB field mapping. This
 * guard hashes those critical blocks and requires an explicit manifest/docs
 * update before a changed contract can pass CI.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    PROTECTED_TIMELINE_BLOCKS,
    FORBIDDEN_TIMELINE_NEEDLES,
    REQUIRED_REGRESSION_TEST_NEEDLES
} = require('../config/timelineProtectedSurface');

const ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'TIMELINE_PROTECTED_SURFACE.md');
const failures = [];

function fail(message) {
    failures.push(message);
}

function repoPath(file) {
    return path.join(ROOT, file);
}

function read(file) {
    return fs.readFileSync(repoPath(file), 'utf8').replace(/\r\n/g, '\n');
}

function ensureDocMentions(doc, value, label) {
    if (!doc.includes(`\`${value}\``) && !doc.includes(value)) {
        fail(`${label}: missing ${value} in docs/TIMELINE_PROTECTED_SURFACE.md`);
    }
}

function blockContent(entry) {
    if (!fs.existsSync(repoPath(entry.file))) {
        fail(`${entry.id}: ${entry.file} does not exist`);
        return '';
    }
    const source = read(entry.file);
    const startIndex = source.indexOf(entry.start);
    if (startIndex === -1) {
        fail(`${entry.id}: start anchor missing in ${entry.file}: ${entry.start}`);
        return '';
    }
    const endIndex = source.indexOf(entry.end, startIndex + entry.start.length);
    if (endIndex === -1) {
        fail(`${entry.id}: end anchor missing in ${entry.file}: ${entry.end}`);
        return '';
    }
    return `${source.slice(startIndex, endIndex).trimEnd()}\n`;
}

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function validateApproval(entry) {
    const approval = entry.approval || {};
    if (!approval.approvedBy) fail(`${entry.id}: approval.approvedBy is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(approval.approvedOn || ''))) {
        fail(`${entry.id}: approval.approvedOn must be YYYY-MM-DD`);
    }
    if (!approval.reason || String(approval.reason).trim().length < 12) {
        fail(`${entry.id}: approval.reason must explain why this baseline is approved`);
    }
}

const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
if (!doc) fail('docs/TIMELINE_PROTECTED_SURFACE.md is required');

for (const entry of PROTECTED_TIMELINE_BLOCKS) {
    const label = `protected block ${entry.id}`;
    if (!entry.id || !entry.owner || !entry.file || !entry.start || !entry.end || !entry.sha256) {
        fail(`${label}: incomplete manifest entry`);
        continue;
    }
    validateApproval(entry);
    ensureDocMentions(doc, entry.id, label);
    ensureDocMentions(doc, entry.file, label);
    ensureDocMentions(doc, entry.owner, label);

    const content = blockContent(entry);
    if (!content) continue;
    const actual = sha256(content);
    if (actual !== entry.sha256) {
        fail(`${entry.id}: protected block hash changed in ${entry.file}. expected ${entry.sha256}, actual ${actual}. Update config/timelineProtectedSurface.js only with explicit approval.`);
    }
    for (const needle of entry.requiredNeedles || []) {
        if (!content.includes(needle)) fail(`${entry.id}: required contract needle missing in ${entry.file}: ${needle}`);
    }
}

for (const entry of FORBIDDEN_TIMELINE_NEEDLES) {
    if (!fs.existsSync(repoPath(entry.file))) {
        fail(`forbidden needle ${entry.file}: file does not exist`);
        continue;
    }
    const source = read(entry.file);
    if (source.includes(entry.needle)) {
        fail(`${entry.file}: forbidden timeline protected-surface needle found: ${entry.needle} (${entry.reason || 'no reason provided'})`);
    }
}

for (const entry of REQUIRED_REGRESSION_TEST_NEEDLES) {
    if (!fs.existsSync(repoPath(entry.file))) {
        fail(`regression coverage ${entry.file}: file does not exist`);
        continue;
    }
    const source = read(entry.file);
    for (const needle of entry.needles || []) {
        if (!source.includes(needle)) fail(`regression coverage ${entry.file}: missing ${needle}`);
    }
}

if (failures.length) {
    console.error('Timeline protected surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`Timeline protected surface check passed: ${PROTECTED_TIMELINE_BLOCKS.length} protected blocks, ${FORBIDDEN_TIMELINE_NEEDLES.length} forbidden needles, ${REQUIRED_REGRESSION_TEST_NEEDLES.length} regression files.`);
