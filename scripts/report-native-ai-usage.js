#!/usr/bin/env node
'use strict';
const { Pool } = require('pg');
const { nativeAiUsageReport, validateUsageWindow } = require('../services/aiUsageAccounting');

async function main(argv = process.argv.slice(2)) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = { '--business': 'businessContext', '--from': 'from', '--to': 'to' }[argv[i]];
        if (!key || args[key] || !argv[i + 1]) throw new Error('Use --business CONTEXT --from YYYY-MM-DD --to YYYY-MM-DD (exclusive, max31days)');
        args[key] = argv[i + 1];
    }
    validateUsageWindow(args);
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be supplied through the environment, never a command argument');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        max: 1, connectionTimeoutMillis: 5000, statement_timeout: 3000, query_timeout: 5000 });
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL lock_timeout = '300ms'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
        const report = await nativeAiUsageReport(client, args);
        await client.query('COMMIT');
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } finally {
        if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
        await pool.end();
    }
}
if (require.main === module) main().catch(() => {
    // Driver errors may contain connection/user details; never echo them.
    console.error('Native AI usage report failed. Check the date window, connection and schema locally; no provider action was taken.');
    process.exitCode = 1;
});
module.exports = { main };
