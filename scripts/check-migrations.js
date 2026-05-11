#!/usr/bin/env node
/**
 * Static migration governance check.
 *
 * This does not connect to PostgreSQL. It protects the repository-level
 * migration contract: numbered files, known legacy gaps/duplicates, and
 * required safety metadata for new migrations.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const GOVERNANCE_START = 162;

const LEGACY_DUPLICATES = new Map([
    [26, ['026_fix_cancel_rule_template.sql', '026_leads_banquet_staff.sql']]
]);

const LEGACY_GAPS = new Set([55, 56, 57, 58, 59, 69, 70, 84, 85]);
const VERBOSE = process.argv.includes('--verbose');

function rel(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function parseMigrationFile(file) {
    const match = file.match(/^(\d{3})_([a-z0-9][a-z0-9_]*)\.sql$/);
    if (!match) return null;
    return { file, number: Number(match[1]), slug: match[2] };
}

function classifySql(sql) {
    const normalized = sql.replace(/\s+/g, ' ');
    const hasSchema = /\bCREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|OR\s+REPLACE\s+FUNCTION|FUNCTION|TRIGGER|VIEW|TYPE)\b/i.test(normalized)
        || /\bALTER\s+TABLE\b/i.test(normalized)
        || /\bDROP\s+(TABLE|INDEX|FUNCTION|TRIGGER|VIEW|TYPE)\b/i.test(normalized);
    const hasInsert = /\bINSERT\s+INTO\b/i.test(normalized);
    const hasUpdate = /\bUPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET\b/i.test(normalized);
    const hasDelete = /\bDELETE\s+FROM\b/i.test(normalized) || /\bTRUNCATE\b/i.test(normalized);
    const hasDrop = /\bDROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER|VIEW|TYPE)\b/i.test(normalized)
        || /\bALTER\s+TABLE\b[^;]*\bDROP\b/i.test(normalized);
    const hasDateScope = /'20\d{2}-\d{2}-\d{2}'|\b20\d{2}-\d{2}-\d{2}\b|\bCURRENT_DATE\b/i.test(normalized);
    const hasDataSpecificHint = /\b(real data|cleanup|test|fake|paper|dismissed|deactivate|staff_id\s*<=)\b/i.test(normalized);
    const touchesUsers = /\b(INSERT\s+INTO|UPDATE)\s+users\b/i.test(normalized);
    const touchesPassword = /\bpassword_hash\b/i.test(normalized);

    let kind = 'unknown';
    if (hasSchema && (hasInsert || hasUpdate || hasDelete)) kind = 'mixed';
    else if (hasSchema) kind = 'schema';
    else if (hasDelete) kind = 'cleanup';
    else if (hasUpdate) kind = 'data-fix';
    else if (hasInsert) kind = 'seed';

    return {
        kind,
        hasSchema,
        hasData: hasInsert || hasUpdate || hasDelete,
        destructive: hasDelete || hasDrop,
        dateScoped: hasDateScope,
        dataSpecific: hasDateScope || hasDataSpecificHint,
        touchesUsers,
        touchesPassword,
        risky: hasDelete || hasDrop || hasDateScope || hasDataSpecificHint || touchesPassword
    };
}

function metadataValue(sql, key) {
    const match = sql.match(new RegExp(`^\\s*--\\s*${key}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : null;
}

function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');
}

function requireNewMigrationMetadata(parsed, sql, info, failures) {
    if (parsed.number < GOVERNANCE_START) return;

    const kind = metadataValue(sql, 'MIGRATION_KIND');
    const safety = metadataValue(sql, 'SAFETY');
    const rollback = metadataValue(sql, 'ROLLBACK');
    const allowedKinds = new Set(['schema', 'seed', 'data-fix', 'cleanup', 'mixed']);

    if (!kind || !allowedKinds.has(kind)) {
        failures.push(`${parsed.file}: new migrations require "-- MIGRATION_KIND: schema|seed|data-fix|cleanup|mixed"`);
    }
    if (!safety) {
        failures.push(`${parsed.file}: new migrations require "-- SAFETY: ..."`);
    }
    if (!rollback) {
        failures.push(`${parsed.file}: new migrations require "-- ROLLBACK: ..."`);
    }
    if (info.destructive && !metadataValue(sql, 'OPERATOR_APPROVAL')) {
        failures.push(`${parsed.file}: destructive migrations require "-- OPERATOR_APPROVAL: required"`);
    }
    if (info.dataSpecific && !metadataValue(sql, 'DATA_SCOPE')) {
        failures.push(`${parsed.file}: data-specific/date-scoped migrations require "-- DATA_SCOPE: ..."`);
    }
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory missing: ${rel(MIGRATIONS_DIR)}`);
    process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();
const parsed = [];
const failures = [];
const warnings = [];
const riskCounts = { risky: 0, destructive: 0, dataSpecific: 0, userOrPassword: 0 };
const riskyFiles = [];

for (const file of files) {
    const migration = parseMigrationFile(file);
    if (!migration) {
        failures.push(`${file}: migration filename must match NNN_lowercase_slug.sql`);
        continue;
    }
    parsed.push(migration);

    const fullPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const info = classifySql(stripSqlComments(sql));
    if (info.risky) {
        riskCounts.risky += 1;
        if (info.destructive) riskCounts.destructive += 1;
        if (info.dataSpecific) riskCounts.dataSpecific += 1;
        if (info.touchesUsers || info.touchesPassword) riskCounts.userOrPassword += 1;
        riskyFiles.push(`${file} (${info.kind})`);
    }
    requireNewMigrationMetadata(migration, sql, info, failures);
}

const byNumber = new Map();
for (const migration of parsed) {
    if (!byNumber.has(migration.number)) byNumber.set(migration.number, []);
    byNumber.get(migration.number).push(migration.file);
}

for (const [number, dupFiles] of byNumber.entries()) {
    if (dupFiles.length <= 1) continue;
    const expected = LEGACY_DUPLICATES.get(number);
    const actual = [...dupFiles].sort();
    if (!expected || expected.join('|') !== actual.join('|')) {
        failures.push(`duplicate migration number ${String(number).padStart(3, '0')}: ${actual.join(', ')}`);
    } else {
        warnings.push(`known legacy duplicate number ${String(number).padStart(3, '0')}: ${actual.join(', ')}`);
    }
}

const numbers = [...byNumber.keys()].sort((a, b) => a - b);
const missing = [];
for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n += 1) {
    if (!byNumber.has(n)) missing.push(n);
}
const unexpectedMissing = missing.filter(n => !LEGACY_GAPS.has(n));
if (unexpectedMissing.length > 0) {
    failures.push(`missing migration numbers must be documented: ${unexpectedMissing.map(n => String(n).padStart(3, '0')).join(', ')}`);
}
const legacyMissing = missing.filter(n => LEGACY_GAPS.has(n));
if (legacyMissing.length > 0) {
    warnings.push(`known legacy gaps: ${legacyMissing.map(n => String(n).padStart(3, '0')).join(', ')}`);
}

console.log(`Migration governance check: ${files.length} SQL files, range ${String(numbers[0]).padStart(3, '0')}-${String(numbers[numbers.length - 1]).padStart(3, '0')}.`);
console.log(`New migration metadata rules apply from ${String(GOVERNANCE_START).padStart(3, '0')}_*.sql onward.`);
console.log(`Risky legacy migrations detected: ${riskCounts.risky} total (${riskCounts.destructive} destructive, ${riskCounts.dataSpecific} data/date-scoped, ${riskCounts.userOrPassword} user/password-related).`);

for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
}

if (VERBOSE && riskyFiles.length > 0) {
    console.log('Risky migration files:');
    for (const file of riskyFiles) console.log(`- ${file}`);
}

if (failures.length > 0) {
    console.error('\nMigration governance check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('Migration governance check passed.');
