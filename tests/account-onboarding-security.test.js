'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DB_MODULE = require.resolve('../db');
const SECURITY_MODULE = require.resolve('../services/accountSecurity');

function loadAccountSecurity(query) {
    const previousDb = require.cache[DB_MODULE];
    const previousSecurity = require.cache[SECURITY_MODULE];
    delete require.cache[SECURITY_MODULE];
    require.cache[DB_MODULE] = {
        id: DB_MODULE,
        filename: DB_MODULE,
        loaded: true,
        exports: { pool: { query } }
    };

    const service = require('../services/accountSecurity');
    return {
        service,
        restore() {
            delete require.cache[SECURITY_MODULE];
            if (previousSecurity) require.cache[SECURITY_MODULE] = previousSecurity;
            if (previousDb) require.cache[DB_MODULE] = previousDb;
            else delete require.cache[DB_MODULE];
        }
    };
}

test('account security audit strips every supported credential field', async () => {
    let auditDetails = null;
    const harness = loadAccountSecurity(async (sql, params) => {
        assert.match(sql, /INSERT INTO account_security_events/);
        auditDetails = JSON.parse(params[6]);
        return { rows: [], rowCount: 1 };
    });

    try {
        await harness.service.recordAccountSecurityEvent({
            actor: { id: 1, username: 'creator' },
            target: { id: 2, username: 'new.user' },
            eventType: 'account_onboarding_completed',
            details: {
                password: 'NeverPersistPassword',
                newPassword: 'NeverPersistNewPassword',
                manualPassword: 'NeverPersistManualPassword',
                currentPassword: 'NeverPersistCurrentPassword',
                token: 'NeverPersistToken',
                refreshToken: 'NeverPersistRefreshToken',
                setup: {
                    credential: { username: 'new.user', password: 'NeverPersistNestedPassword' },
                    authorization: 'Bearer NeverPersistNestedToken'
                },
                role: 'admin',
                staffId: 42
            }
        });

        assert.deepEqual(auditDetails, { role: 'admin', staffId: 42 });
        assert.doesNotMatch(JSON.stringify(auditDetails), /NeverPersist/);
    } finally {
        harness.restore();
    }
});

test('strict account security audit failure is observable by transaction owners', async () => {
    const auditFailure = new Error('account_security_events unavailable');
    const harness = loadAccountSecurity(async () => {
        throw auditFailure;
    });

    try {
        await assert.rejects(
            harness.service.recordAccountSecurityEvent({
                actor: { id: 1, username: 'creator' },
                target: { id: 2, username: 'new.user' },
                eventType: 'account_onboarding_completed',
                strict: true
            }),
            error => error === auditFailure
        );
    } finally {
        harness.restore();
    }
});
