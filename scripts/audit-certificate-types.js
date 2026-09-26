#!/usr/bin/env node
'use strict';

// Read-only, aggregate-only inventory. Never select certificate codes or recipients.
const { Client } = require('pg');

const CATEGORIES = [
    'proven_one_time',
    'subscription_exact',
    'subscription_variant',
    'empty_label',
    'other_unmapped'
];

async function main() {
    const connectionString = process.env.PRODUCTION_READONLY_DATABASE_URL;
    if (!connectionString) throw new Error('PRODUCTION_READONLY_DATABASE_URL is required');
    const client = new Client({
        connectionString,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
    });
    let connected = false;
    try {
        await client.connect();
        connected = true;
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '5s'");
        const mode = await client.query('SHOW transaction_read_only');
        if (mode.rows[0]?.transaction_read_only !== 'on') throw new Error('Read-only transaction was not established');
        const result = await client.query(`
            SELECT category, COUNT(*)::int AS count
            FROM (
                SELECT CASE
                    WHEN LOWER(BTRIM(type_text)) = 'на одноразовий вхід' THEN 'proven_one_time'
                    WHEN LOWER(BTRIM(type_text)) = 'абонемент' THEN 'subscription_exact'
                    WHEN LOWER(BTRIM(type_text)) LIKE '%абонемент%' THEN 'subscription_variant'
                    WHEN BTRIM(type_text) = '' THEN 'empty_label'
                    ELSE 'other_unmapped'
                END AS category
                FROM certificates
            ) classified
            GROUP BY category
        `);
        const counts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
        for (const row of result.rows) counts[row.category] = row.count;
        const hasTypeCode = (await client.query(`SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'certificates' AND column_name = 'type_code'
        ) AS present`)).rows[0].present;
        let priorVersionRollback = null;
        if (hasTypeCode) {
            const rollback = await client.query(`SELECT
                COUNT(*) FILTER (WHERE type_code <> 'one_time_admission'
                    AND LOWER(BTRIM(type_text)) = 'на одноразовий вхід')::int AS unsafe_grants,
                COUNT(*) FILTER (WHERE type_code = 'one_time_admission'
                    AND LOWER(BTRIM(type_text)) <> 'на одноразовий вхід')::int AS safe_denials
                FROM certificates`);
            priorVersionRollback = {
                unsafeGrants: rollback.rows[0].unsafe_grants,
                safeDenials: rollback.rows[0].safe_denials
            };
        }
        console.log(JSON.stringify({
            auditedAt: new Date().toISOString(),
            total: Object.values(counts).reduce((sum, count) => sum + count, 0),
            categories: counts,
            priorVersionRollback
        }, null, 2));
    } finally {
        if (connected) {
            await client.query('ROLLBACK').catch(() => {});
            await client.end().catch(() => {});
        }
    }
}

main().catch(error => {
    console.error(`Certificate type audit failed: ${error.code || 'read_only_audit_failed'}`);
    process.exitCode = 1;
});
