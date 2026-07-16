'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DB_MODULE = require.resolve('../db');
const LINKING_MODULE = require.resolve('../services/accountLinking');
const SECURITY_MODULE = require.resolve('../services/accountSecurity');

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function loadAccountLinking(query) {
    const previousDb = require.cache[DB_MODULE];
    const previousLinking = require.cache[LINKING_MODULE];
    const previousSecurity = require.cache[SECURITY_MODULE];

    delete require.cache[LINKING_MODULE];
    delete require.cache[SECURITY_MODULE];
    require.cache[DB_MODULE] = {
        id: DB_MODULE,
        filename: DB_MODULE,
        loaded: true,
        exports: { pool: { query } }
    };

    const service = require('../services/accountLinking');
    return {
        service,
        restore() {
            delete require.cache[LINKING_MODULE];
            delete require.cache[SECURITY_MODULE];
            if (previousLinking) require.cache[LINKING_MODULE] = previousLinking;
            if (previousSecurity) require.cache[SECURITY_MODULE] = previousSecurity;
            if (previousDb) require.cache[DB_MODULE] = previousDb;
            else delete require.cache[DB_MODULE];
        }
    };
}

test('account-link conflicts do not classify inactive linked profiles as unlinked', async () => {
    const queries = [];
    const harness = loadAccountLinking(async sql => {
        queries.push(normalizeSql(sql));
        return { rows: [] };
    });

    try {
        const result = await harness.service.getAccountLinkConflicts({ limit: 25 });
        assert.deepEqual(result.counts, {
            unlinkedUsers: 0,
            unlinkedStaff: 0,
            inactiveProfileConflicts: 0,
            duplicateTelegramIdentities: 0,
            ambiguousProfiles: 0
        });

        const unlinkedUsersSql = queries.find(sql => sql.startsWith('SELECT u.id, u.username, u.name, u.role, u.is_active'));
        assert.ok(unlinkedUsersSql, 'unlinked users query must run');
        assert.match(
            unlinkedUsersSql,
            /NOT EXISTS \( SELECT 1 FROM employee_profiles ep WHERE ep\.user_id = u\.id \)/
        );
        assert.doesNotMatch(unlinkedUsersSql, /ep\.is_active/);

        const unlinkedStaffSql = queries.find(sql => sql.startsWith('SELECT s.id, s.name, s.department, s.position'));
        assert.ok(unlinkedStaffSql, 'unlinked staff query must run');
        assert.match(
            unlinkedStaffSql,
            /NOT EXISTS \( SELECT 1 FROM employee_profiles ep WHERE ep\.staff_id = s\.id AND ep\.user_id IS NOT NULL \)/
        );
        assert.doesNotMatch(unlinkedStaffSql, /ep\.is_active/);
    } finally {
        harness.restore();
    }
});
