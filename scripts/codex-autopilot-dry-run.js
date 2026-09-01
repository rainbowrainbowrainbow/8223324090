#!/usr/bin/env node
'use strict';

const { decideSupervisorAction } = require('./codex-autopilot-policy');

const SCENARIOS = Object.freeze({
    green: {
        goalStatus: 'active', taskRunning: false, scope: {}, evidence: {}, writeLease: { writerCount: 1 }
    },
    idle: {
        goalStatus: 'active', taskRunning: false, scope: { ui: true }, evidence: { finalCode: true }, writeLease: { writerCount: 1 }
    },
    yellow: {
        goalStatus: 'active', taskRunning: false, scope: { production: true }, evidence: {},
        yellow: { required: true, prepared: true, authorized: false, valid: true }, writeLease: { writerCount: 1 }
    },
    red: {
        goalStatus: 'active', taskRunning: false, scope: { production: true }, evidence: {},
        redBlocker: 'production secrets mutation requires separate approval', writeLease: { writerCount: 1 }
    },
    complete: {
        goalStatus: 'complete', taskRunning: false, scope: {},
        evidence: { finalCode: true, requiredTests: true, remainingRisks: true }, writeLease: { writerCount: 1 }
    }
});

function main(argv = process.argv.slice(2)) {
    const name = String(argv[0] || 'green').toLowerCase();
    if (!Object.hasOwn(SCENARIOS, name)) throw new Error(`Unknown dry-run scenario: ${name}`);
    const result = { dryRun: true, scenario: name, decision: decideSupervisorAction(SCENARIOS[name]) };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ dryRun: true, success: false, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { SCENARIOS, main };
