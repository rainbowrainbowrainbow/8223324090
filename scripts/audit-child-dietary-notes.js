#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

const CATEGORY_RULES = Object.freeze([
    {
        key: 'allergy',
        label: 'Allergy / food safety',
        patterns: [
            /алерг/i,
            /аллерг/i,
            /\ballerg/i,
            /анафіла/i,
            /анафила/i,
            /горіх/i,
            /орех/i,
            /арахіс/i,
            /арахис/i,
            /\bnut/i,
            /peanut/i
        ]
    },
    {
        key: 'dietary_restriction',
        label: 'Dietary restriction',
        patterns: [
            /не можна/i,
            /нельзя/i,
            /(^|\s)без(\s|$)/i,
            /лактоз/i,
            /lactose/i,
            /глютен/i,
            /gluten/i,
            /молок/i,
            /milk/i,
            /яйц/i,
            /\begg/i,
            /цукор/i,
            /сахар/i,
            /sugar/i
        ]
    },
    {
        key: 'preference',
        label: 'Preference',
        patterns: [
            /любить/i,
            /не любить/i,
            /подоба/i,
            /нрав/i,
            /улюб/i,
            /любим/i,
            /favorite/i,
            /prefer/i
        ]
    },
    {
        key: 'behavior_or_ops',
        label: 'Behavior / operational',
        patterns: [
            /посад/i,
            /поруч/i,
            /мам/i,
            /тат/i,
            /пап/i,
            /бої/i,
            /боит/i,
            /плач/i,
            /сором/i,
            /стесня/i,
            /говор/i,
            /мова/i,
            /язык/i,
            /актив/i,
            /уваг/i,
            /вниман/i
        ]
    }
]);

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--') && !arg.includes('=')));

function argValue(name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function boolFlag(name) {
    return flags.has(name);
}

function positiveInt(value, fallback, max = 5000) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function cleanNote(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function noteValue(row) {
    if (row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'note')) {
        return row.note;
    }
    return row;
}

function classifyChildNote(note) {
    const text = cleanNote(note);
    const categories = [];
    const matchedTerms = [];
    for (const rule of CATEGORY_RULES) {
        const matches = rule.patterns
            .filter(pattern => pattern.test(text))
            .map(pattern => pattern.source);
        if (!matches.length) continue;
        categories.push(rule.key);
        matchedTerms.push(...matches);
    }
    if (!categories.length) categories.push('unclear');
    return {
        categories,
        primaryCategory: categories[0],
        foodSafety: categories.includes('allergy') || categories.includes('dietary_restriction'),
        matchedTerms
    };
}

function redactNoteSample(note, maxLength = 180) {
    return cleanNote(note)
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/@[A-Za-z0-9_.]{2,}/g, '[handle]')
        .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, '[date]')
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date]')
        .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
        .slice(0, maxLength);
}

function emptyCategoryCounts() {
    return {
        allergy: 0,
        dietary_restriction: 0,
        preference: 0,
        behavior_or_ops: 0,
        unclear: 0
    };
}

function buildDietaryNotesReport(rows = [], options = {}) {
    const includeSamples = Boolean(options.includeSamples);
    const sampleLimit = positiveInt(options.sampleLimit, 3, 25);
    const byCategory = emptyCategoryCounts();
    const samples = Object.fromEntries(Object.keys(byCategory).map(key => [key, []]));
    let foodSafety = 0;
    let multiCategory = 0;

    for (const row of rows) {
        const note = cleanNote(noteValue(row));
        if (!note) continue;
        const classification = classifyChildNote(note);
        if (classification.foodSafety) foodSafety += 1;
        if (classification.categories.length > 1) multiCategory += 1;
        for (const category of classification.categories) {
            byCategory[category] += 1;
            if (includeSamples && samples[category].length < sampleLimit) {
                samples[category].push(redactNoteSample(note));
            }
        }
    }

    const total = rows.filter(row => cleanNote(noteValue(row))).length;
    return {
        scannedNotes: total,
        foodSafetyNotes: foodSafety,
        multiCategoryNotes: multiCategory,
        byCategory,
        samples: includeSamples ? samples : undefined,
        recommendation: foodSafety > 0
            ? 'Keep free-text display for now; consider structured dietary tags only after reviewing redacted examples with operators.'
            : 'No food-safety notes found in this sample; keep free-text display and rerun with a broader sample before schema work.'
    };
}

async function fetchChildNotes(pool, options = {}) {
    const businessContext = cleanNote(options.businessContext);
    const limit = positiveInt(options.limit, 500, 5000);
    const params = [];
    const filters = ["NULLIF(BTRIM(COALESCE(note, '')), '') IS NOT NULL"];
    if (businessContext) {
        params.push(businessContext);
        filters.push(`business_context = $${params.length}`);
    }
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const total = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM customer_children
             WHERE ${filters.join(' AND ')}`,
            params.slice(0, -1)
        );
        const notes = await client.query(
            `SELECT note
             FROM customer_children
             WHERE ${filters.join(' AND ')}
             ORDER BY updated_at DESC NULLS LAST, id DESC
             LIMIT ${limitPlaceholder}`,
            params
        );
        await client.query('COMMIT');
        return {
            totalNotesInScope: total.rows[0]?.count || 0,
            sampledRows: notes.rows,
            limit,
            businessContext: businessContext || null
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function printTextReport(report) {
    console.log('Child dietary notes discovery');
    if (report.businessContext) console.log(`Business context: ${report.businessContext}`);
    console.log(`Total notes in scope: ${report.totalNotesInScope}`);
    console.log(`Scanned notes: ${report.scannedNotes}`);
    console.log(`Food-safety notes: ${report.foodSafetyNotes}`);
    console.log(`Multi-category notes: ${report.multiCategoryNotes}`);
    for (const [category, count] of Object.entries(report.byCategory)) {
        console.log(`${category}: ${count}`);
    }
    console.log(`Recommendation: ${report.recommendation}`);
    if (!report.samples) {
        console.log('Samples: hidden by default; rerun with --samples for redacted snippets only.');
        return;
    }
    console.log('Redacted samples:');
    for (const [category, values] of Object.entries(report.samples)) {
        console.log(`  ${category}:`);
        if (!values.length) {
            console.log('    -');
            continue;
        }
        values.forEach(value => console.log(`    - ${value}`));
    }
}

function safeErrorMessage(error) {
    const message = String(error?.message || '').trim();
    if (message) return message;
    const parts = [
        error?.name ? `name=${error.name}` : '',
        error?.code ? `code=${error.code}` : ''
    ].filter(Boolean);
    if (Array.isArray(error?.errors) && error.errors.length) {
        const nested = error.errors
            .slice(0, 3)
            .map(item => [item?.name, item?.code, item?.message].filter(Boolean).join('/'))
            .filter(Boolean)
            .join('; ');
        if (nested) parts.push(`nested=${nested}`);
    }
    return parts.join(' ') || 'unknown error';
}

async function main() {
    loadEnvFile();
    const { pool } = require('../db');
    const fetched = await fetchChildNotes(pool, {
        businessContext: argValue('--business-context') || argValue('--context'),
        limit: argValue('--limit')
    });
    const report = {
        ...fetched,
        ...buildDietaryNotesReport(fetched.sampledRows, {
            includeSamples: boolFlag('--samples'),
            sampleLimit: argValue('--sample-limit')
        })
    };
    delete report.sampledRows;

    const format = String(argValue('--format', boolFlag('--json') ? 'json' : 'text')).toLowerCase();
    if (format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Child dietary notes discovery failed: ${safeErrorMessage(error)}`);
        process.exitCode = 1;
    }).finally(async () => {
        try {
            const { pool } = require('../db');
            await pool.end().catch(() => {});
        } catch {}
    });
}

module.exports = {
    buildDietaryNotesReport,
    classifyChildNote,
    redactNoteSample
};
