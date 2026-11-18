'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isProfessionOnlyRoleAssignmentBody } = require('../services/staffProfessionAssignments');

test('profession-only classifier rejects unknown and financial input, including null', () => {
    const body = { primary_role: 'host', assignments: [{ profession_key: 'host', is_primary: true }] };
    assert.equal(isProfessionOnlyRoleAssignmentBody(body), true);
    for (const key of ['hourly_rate', 'hourlyRate', 'payroll_scheme_id', 'payrollSchemeId', 'notes', 'unknown']) {
        assert.equal(isProfessionOnlyRoleAssignmentBody({ ...body, assignments: [{ ...body.assignments[0], [key]: null }] }), false);
        assert.equal(isProfessionOnlyRoleAssignmentBody({ ...body, [key]: null }), false);
    }
    for (const assignments of [[], [null], ['host'], {}, Array(101).fill({ profession_key: 'host' })]) {
        assert.equal(isProfessionOnlyRoleAssignmentBody({ assignments }), false);
    }
});

test('roles save sends only metadata, updates revision, and preserves dirty work drafts', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/hr-page.js'), 'utf8');
    const start = source.indexOf('async function saveStaffRoleAssignments(');
    const end = source.indexOf('\n}', start) + 2;
    const writes = [];
    const cleaned = [];
    const submitted = { editRoleType: 'host', editSecondaryProfessions: '["animator"]' };
    const context = { staffProfileRevision: '1',
        document: { getElementById: id => id === 'staffEditModal' ? { dataset: { catalogState: 'ready' } } : { value: 'host' } },
        runStaffProfileAction: (_button, _labels, fn) => fn(), activeEditStaffId: () => 9701,
        readStaffRoleAssignmentRows: () => [{ profession_key: 'host', is_primary: true, hourly_rate: 999 }],
        captureStaffProfileScopeFields: () => submitted,
        hrFetch: async (_url, options) => { writes.push(options.body); return { success: true, profile_revision: '2' }; },
        loadStaffRoleAssignments: async () => {}, markStaffProfileScopeFieldsClean: (scope, fields) => cleaned.push([scope, fields]),
        markStaffProfileScopesClean: () => {}, showNotification: () => {}
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    assert.equal((await context.saveStaffRoleAssignments()).success, true);
    assert.equal(isProfessionOnlyRoleAssignmentBody(writes[0]), true);
    assert.equal(context.staffProfileRevision, '2');
    assert.equal(cleaned[0][1], submitted);
});
