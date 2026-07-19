#!/usr/bin/env node
'use strict';

const { pool } = require('../db');
const recovery = require('./banquet-production-recovery');

const READY_MARKER = 'timeline-smoke-cleanup-ready';

function parseExpectedCapability(argv = process.argv.slice(2)) {
    const inline = argv.find(value => String(value).startsWith('--expected-capability='));
    if (inline) return String(inline).slice('--expected-capability='.length).trim();
    const index = argv.indexOf('--expected-capability');
    return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function assertCleanupCapability(expectedCapability) {
    if (!expectedCapability) throw new Error('expected cleanup capability is required');
    if (typeof recovery.runQaCleanupDryRun !== 'function') {
        throw new Error('qa cleanup operator unavailable');
    }
    if (recovery.QA_CLEANUP_CAPABILITY !== expectedCapability) {
        throw new Error('qa cleanup operator capability mismatch');
    }
}

async function runPreflight({
    expectedCapability = parseExpectedCapability(),
    dbPool = pool
} = {}) {
    assertCleanupCapability(expectedCapability);
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        await client.query('SELECT 1');
        await client.query('ROLLBACK');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the primary preflight failure.
        }
        throw error;
    } finally {
        client.release();
    }
    return READY_MARKER;
}

async function main() {
    const marker = await runPreflight();
    await pool.end();
    process.stdout.write(marker);
}

if (require.main === module) {
    main().catch(async error => {
        try {
            await pool.end();
        } catch {
            // Keep the preflight error as the only reported failure.
        }
        console.error(`Timeline smoke cleanup preflight failed: ${error.message}`);
        process.exitCode = 2;
    });
}

module.exports = {
    READY_MARKER,
    assertCleanupCapability,
    parseExpectedCapability,
    runPreflight
};
