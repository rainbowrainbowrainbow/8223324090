#!/usr/bin/env node
/**
 * DB startup surface ownership guard.
 *
 * Prevents new schema or startup data responsibilities from quietly being
 * added to db/index.js instead of explicit SQL migrations.
 */

const fs = require('fs');
const path = require('path');
const {
    INIT_DATABASE_FLOW,
    STARTUP_SCHEMA_TABLES,
    STARTUP_SCHEMA_COLUMNS,
    STARTUP_SCHEMA_INDEXES,
    STARTUP_SCHEMA_FUNCTIONS,
    STARTUP_SCHEMA_TRIGGERS,
    STARTUP_DATA_BOOTSTRAPS,
    STARTUP_DATA_BOOTSTRAP_MODES,
    DB_STARTUP_SURFACE_DOC
} = require('../config/dbStartupSurface');

const ROOT = path.resolve(__dirname, '..');
const DB_INDEX = path.join(ROOT, 'db', 'index.js');
const SERVER = path.join(ROOT, 'server.js');
const PACKAGE = path.join(ROOT, 'package.json');
const GOVERNANCE = path.join(ROOT, 'DB_MIGRATION_GOVERNANCE.md');
const failures = [];

function fail(message) {
    failures.push(message);
}

function sortedUnique(values) {
    return [...new Set(values)].sort();
}

function compareSets(label, actual, expected) {
    const actualSorted = sortedUnique(actual);
    const expectedSorted = sortedUnique(expected);
    const missing = expectedSorted.filter(item => !actualSorted.includes(item));
    const extra = actualSorted.filter(item => !expectedSorted.includes(item));
    if (missing.length || extra.length) {
        fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`);
    }
}

function read(relativePath) {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
        fail(`${relativePath}: file missing`);
        return '';
    }
    return fs.readFileSync(fullPath, 'utf8');
}

function assertDocMentions(doc, value, label) {
    if (!doc.includes(`\`${value}\``)) {
        fail(`${DB_STARTUP_SURFACE_DOC}: missing ${label} ${value}`);
    }
}

function assertDocMentionsMode(doc, value, label) {
    if (!doc.includes(`\`${value}\``) && !doc.includes(`| ${value} |`)) {
        fail(`${DB_STARTUP_SURFACE_DOC}: missing ${label} ${value}`);
    }
}

function extractInitDatabaseBody(code) {
    const start = code.indexOf('async function initDatabase()');
    if (start === -1) {
        fail('db/index.js: async function initDatabase() missing');
        return '';
    }
    const seedStart = code.indexOf('async function seedProducts()', start);
    if (seedStart === -1) {
        fail('db/index.js: async function seedProducts() missing after initDatabase()');
        return code.slice(start);
    }
    return code.slice(start, seedStart);
}

function extractMatches(code, regex, mapper) {
    return [...code.matchAll(regex)].map(mapper);
}

function checkStartupFlow(serverCode) {
    const flowSliceStart = serverCode.indexOf('async function initializeDatabaseWithSchemaFence()');
    if (flowSliceStart === -1) {
        fail('server.js: schema-fenced two-phase initDatabase startup flow missing');
        return;
    }
    const flowSlice = serverCode.slice(flowSliceStart, flowSliceStart + 900);
    const positions = [
        flowSlice.indexOf('lockSchemaMigrations(guardClient)'),
        flowSlice.indexOf('await initDatabase()'),
        flowSlice.indexOf('runMigrations(pool, { schemaLockAlreadyHeld: true })'),
        flowSlice.lastIndexOf('await initDatabase()'),
        flowSlice.indexOf('unlockSchemaMigrations(guardClient)')
    ];
    if (positions.some(pos => pos === -1)
        || !(positions[0] < positions[1]
            && positions[1] < positions[2]
            && positions[2] < positions[3]
            && positions[3] < positions[4])) {
        fail('server.js: expected schema lock -> initDatabase -> runMigrations -> initDatabase -> unlock flow');
    }
    if (!INIT_DATABASE_FLOW.reason) {
        fail('INIT_DATABASE_FLOW requires a reason');
    }
}

const dbIndex = fs.readFileSync(DB_INDEX, 'utf8');
const initBody = extractInitDatabaseBody(dbIndex);
const server = fs.readFileSync(SERVER, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
const docPath = path.join(ROOT, DB_STARTUP_SURFACE_DOC);
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
const governance = fs.existsSync(GOVERNANCE) ? fs.readFileSync(GOVERNANCE, 'utf8') : '';

if (!doc) fail(`${DB_STARTUP_SURFACE_DOC} is required`);
if (!packageJson.scripts?.['check:db-startup-surface']) {
    fail('package.json scripts.check:db-startup-surface is required');
}
if (!packageJson.scripts?.verify?.includes('check:db-startup-surface')) {
    fail('package.json verify must include check:db-startup-surface');
}

checkStartupFlow(server);

const tables = extractMatches(
    initBody,
    /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    match => match[1]
);
const columns = extractMatches(
    initBody,
    /ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD COLUMN IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    match => `${match[1]}.${match[2]}`
);
const indexes = extractMatches(
    initBody,
    /CREATE INDEX IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    match => match[1]
);
const functions = extractMatches(
    initBody,
    /CREATE OR REPLACE FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    match => match[1]
);
const triggers = extractMatches(
    initBody,
    /CREATE TRIGGER\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    match => match[1]
);

compareSets('initDatabase CREATE TABLE surface', tables, STARTUP_SCHEMA_TABLES);
compareSets('initDatabase ADD COLUMN surface', columns, STARTUP_SCHEMA_COLUMNS);
compareSets('initDatabase CREATE INDEX surface', indexes, STARTUP_SCHEMA_INDEXES);
compareSets('initDatabase function surface', functions, STARTUP_SCHEMA_FUNCTIONS);
compareSets('initDatabase trigger surface', triggers, STARTUP_SCHEMA_TRIGGERS);

if (!initBody.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
    fail('initDatabase must keep schema_migrations bootstrap while two-phase startup remains');
}
if (!read('db/migrate.js').includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
    fail('db/migrate.js must keep schema_migrations bootstrap');
}

for (const table of STARTUP_SCHEMA_TABLES) assertDocMentions(doc, table, 'startup table');
for (const column of STARTUP_SCHEMA_COLUMNS) assertDocMentions(doc, column, 'startup column');
for (const fn of STARTUP_SCHEMA_FUNCTIONS) assertDocMentions(doc, fn, 'startup function');
for (const trigger of STARTUP_SCHEMA_TRIGGERS) assertDocMentions(doc, trigger, 'startup trigger');

for (const entry of STARTUP_DATA_BOOTSTRAPS) {
    if (!entry.name || !entry.sourceFile || !entry.marker || !entry.owner || !entry.mode) {
        fail(`startup data bootstrap entry is incomplete: ${JSON.stringify(entry)}`);
        continue;
    }
    if (!STARTUP_DATA_BOOTSTRAP_MODES.includes(entry.mode)) {
        fail(`${entry.name}: unsupported startup data bootstrap mode "${entry.mode}"`);
    }
    const source = read(entry.sourceFile);
    if (!source.includes(entry.marker)) {
        fail(`${entry.name}: marker not found in ${entry.sourceFile}`);
    }
    if (entry.mode === 'startup-data-delete' && !/delete/i.test(entry.marker)) {
        fail(`${entry.name}: startup-data-delete hooks must expose a DELETE marker`);
    }
    assertDocMentions(doc, entry.name, 'startup data bootstrap');
    assertDocMentions(doc, entry.sourceFile, 'startup data source');
    assertDocMentionsMode(doc, entry.mode, 'startup data mode');
}

for (const mode of STARTUP_DATA_BOOTSTRAP_MODES) {
    assertDocMentionsMode(doc, mode, 'startup data mode registry');
}

[
    'db/index.js',
    'db/migrate.js',
    'db/migrations/',
    'DB_MIGRATION_GOVERNANCE.md',
    'npm run check:migrations'
].forEach(value => assertDocMentions(doc, value, 'source reference'));

if (!governance.includes('initDatabase() -> runMigrations(pool) -> initDatabase()')) {
    fail('DB_MIGRATION_GOVERNANCE.md must document the two-phase startup flow');
}
if (!governance.includes('New durable schema changes belong in `db/migrations/`')) {
    fail('DB_MIGRATION_GOVERNANCE.md must keep the migration ownership rule');
}

if (!dbIndex.includes('getBootstrapCreator') || !dbIndex.includes('getDevSeedUser')) {
    fail('db/index.js must keep first-user bootstrap routed through userSeedPolicy helpers');
}
if (dbIndex.includes('ALLOW_LEGACY_USER_PASSWORD_RESET') && !dbIndex.includes('legacyPasswordResetAllowed')) {
    fail('legacy password reset policy must stay centralized in db/userSeedPolicy.js');
}

if (failures.length) {
    console.error('DB startup surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`DB startup surface check passed: ${tables.length} tables, ${columns.length} columns, ${indexes.length} indexes, ${STARTUP_DATA_BOOTSTRAPS.length} startup data hooks.`);
