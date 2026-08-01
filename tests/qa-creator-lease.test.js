'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    MAX_QA_CREATOR_LEASE_SECONDS,
    MIN_QA_CREATOR_LEASE_SECONDS,
    applyQaCreatorLease,
    normalizeLeaseId,
    normalizeQaCreatorLeaseDuration,
    resolveActiveQaCreatorLease
} = require('../services/qaCreatorLease');

const ROOT = path.resolve(__dirname, '..');

test('QA creator lease validates a narrow, bounded duration and lease identifier', () => {
    assert.equal(normalizeQaCreatorLeaseDuration(MIN_QA_CREATOR_LEASE_SECONDS), MIN_QA_CREATOR_LEASE_SECONDS);
    assert.equal(normalizeQaCreatorLeaseDuration(MAX_QA_CREATOR_LEASE_SECONDS), MAX_QA_CREATOR_LEASE_SECONDS);
    assert.throws(() => normalizeQaCreatorLeaseDuration(MIN_QA_CREATOR_LEASE_SECONDS - 1), { code: 'QA_CREATOR_LEASE_DURATION_INVALID' });
    assert.throws(() => normalizeQaCreatorLeaseDuration(MAX_QA_CREATOR_LEASE_SECONDS + 1), { code: 'QA_CREATOR_LEASE_DURATION_INVALID' });
    assert.equal(normalizeLeaseId('01234567-89ab-4cde-8fab-0123456789ab'), '01234567-89ab-4cde-8fab-0123456789ab');
    assert.equal(normalizeLeaseId('not-a-lease'), null);
});

test('active lease overlays creator access without changing the base account data', async () => {
    const baseUser = { id: 42, username: 'dedicated-qa', role: 'senior_manager' };
    const db = {
        async query(sql, params) {
            assert.match(sql, /qa_creator_lease_expires_at > NOW\(\)/);
            assert.deepEqual(params, [42, '01234567-89ab-4cde-8fab-0123456789ab']);
            return {
                rows: [{
                    qa_creator_lease_id: '01234567-89ab-4cde-8fab-0123456789ab',
                    qa_creator_lease_expires_at: '2026-08-01T12:15:00.000Z'
                }]
            };
        }
    };

    const effective = await resolveActiveQaCreatorLease(baseUser, db, {
        expectedLeaseId: '01234567-89ab-4cde-8fab-0123456789ab'
    });

    assert.equal(baseUser.role, 'senior_manager');
    assert.equal(effective.role, 'creator');
    assert.equal(effective.qaCreatorLeaseId, '01234567-89ab-4cde-8fab-0123456789ab');
});

test('expired, revoked, or replaced lease fails closed to the stored base role', async () => {
    const baseUser = { id: 42, username: 'dedicated-qa', role: 'senior_manager' };
    const db = { async query() { return { rows: [] }; } };
    const effective = await resolveActiveQaCreatorLease(baseUser, db, {
        expectedLeaseId: '01234567-89ab-4cde-8fab-0123456789ab'
    });

    assert.equal(effective, baseUser);
    assert.equal(effective.role, 'senior_manager');
    assert.equal(applyQaCreatorLease(baseUser, null), baseUser);
});

test('lease endpoints and auth lifecycle keep automatic expiry server-side', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '310_qa_creator_role_lease.sql'), 'utf8');
    const usersRoute = fs.readFileSync(path.join(ROOT, 'routes', 'users.js'), 'utf8');
    const authMiddleware = fs.readFileSync(path.join(ROOT, 'middleware', 'auth.js'), 'utf8');
    const authRoute = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');

    assert.match(migration, /MIGRATION_KIND: schema/);
    assert.match(migration, /qa_creator_lease_id UUID/);
    assert.match(usersRoute, /router\.post\('\/:id\/qa-creator-lease'/);
    assert.match(usersRoute, /router\.delete\('\/:id\/qa-creator-lease'/);
    assert.match(usersRoute, /assertPermanentCreatorForQaLease/);
    assert.match(usersRoute, /QA_CREATOR_LEASE_TARGET_NOT_ISOLATED/);
    assert.match(authMiddleware, /resolveActiveQaCreatorLease\(freshUser, pool, \{ expectedLeaseId: user\.qaCreatorLeaseId \}\)/);
    assert.match(authMiddleware, /const user = await resolveActiveQaCreatorLease\(userResult\.rows\[0\], pool\)/);
    assert.match(authRoute, /user = await resolveActiveQaCreatorLease\(user, pool\)/);
    assert.match(authRoute, /role: req\.user\.role/);
});
