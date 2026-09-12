#!/usr/bin/env node
'use strict';

const { pool } = require('../db');
const {
    DEFAULT_TARGET,
    ShiftCloseProofRecoveryError,
    recoverShiftCloseProof
} = require('../services/payments/shiftCloseProofRecoveryService');

function parseArgs(argv) {
    const args = {
        execute: false,
        target: { ...DEFAULT_TARGET }
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--execute') {
            args.execute = true;
            continue;
        }
        if (!token.startsWith('--')) {
            throw new Error(`Unexpected argument: ${token}`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${token}`);
        }
        index += 1;
        switch (token) {
            case '--recovery-operation-id':
                args.recoveryOperationId = value;
                break;
            case '--drain-id':
                args.target.drainId = value;
                break;
            case '--shift-id':
                args.target.shiftId = value;
                break;
            case '--profile-id':
                args.target.fiscalProfileId = value;
                break;
            case '--location-id':
                args.target.fiscalLocationId = value;
                break;
            case '--register-id':
                args.target.fiscalRegisterId = value;
                break;
            case '--binding-id':
                args.target.cashierBindingId = value;
                break;
            case '--actor-user-id':
                args.target.actorUserId = value;
                break;
            default:
                throw new Error(`Unsupported argument: ${token}`);
        }
    }
    if (!args.recoveryOperationId) {
        throw new Error('--recovery-operation-id is required');
    }
    return args;
}

function safeError(error) {
    return {
        name: error?.name || 'Error',
        code: error?.code || null,
        status: error?.status || null,
        message: String(error?.message || error || 'unknown').slice(0, 500),
        details: error?.details || null
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const result = await recoverShiftCloseProof({
        dbPool: pool,
        target: args.target,
        recoveryOperationId: args.recoveryOperationId,
        actorUserId: args.target.actorUserId,
        execute: args.execute
    });
    console.log(JSON.stringify({
        mode: args.execute ? 'execute' : 'dry_run',
        result
    }, null, 2));
}

main()
    .catch(error => {
        const status = error instanceof ShiftCloseProofRecoveryError ? 2 : 1;
        console.error(JSON.stringify({
            ok: false,
            error: safeError(error)
        }, null, 2));
        process.exit(status);
    })
    .finally(() => pool.end().catch(() => {}));
