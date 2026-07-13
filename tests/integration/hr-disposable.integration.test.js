/**
 * Explicit disposable-fixture HR integration suite.
 *
 * Not part of tests/*.test.js or CI. Run only against an isolated environment:
 *   RUN_HR_DISPOSABLE_INTEGRATION=true
 *   HR_DISPOSABLE_STAFF_ID=<fixture id>
 *   node --test tests/integration/hr-disposable.integration.test.js
 */
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');

const enabled = process.env.RUN_HR_DISPOSABLE_INTEGRATION === 'true';
const fixtureStaffId = Number.parseInt(String(process.env.HR_DISPOSABLE_STAFF_ID || ''), 10);
const createdShiftIds = [];

function requireFixture() {
    assert.equal(enabled, true, 'set RUN_HR_DISPOSABLE_INTEGRATION=true');
    assert.ok(Number.isInteger(fixtureStaffId) && fixtureStaffId > 0, 'set HR_DISPOSABLE_STAFF_ID');
}

describe('HR disposable fixture integration', { skip: !enabled }, () => {
    after(async () => {
        const failures = [];
        for (const shiftId of createdShiftIds.splice(0)) {
            try {
                const response = await authRequest('DELETE', `/api/hr/shifts/${shiftId}`);
                if (response.status !== 200 || response.data?.success !== true) failures.push(`shift #${shiftId}: HTTP ${response.status}`);
            } catch (error) {
                failures.push(`shift #${shiftId}: ${error.message || error}`);
            }
        }
        assert.deepEqual(failures, [], `fixture cleanup failures: ${failures.join('; ')}`);
    });

    it('reads the explicitly named disposable staff fixture', async () => {
        requireFixture();
        const response = await authRequest('GET', `/api/hr/staff/${fixtureStaffId}`);
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assert.equal(Number(response.data?.data?.id), fixtureStaffId);
        assert.match([response.data?.data?.name, response.data?.data?.display_name].filter(Boolean).join(' '), /QA|Test|Smoke|Disposable/i);
    });

    it('creates and deletes one isolated future shift', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts', {
            staff_id: fixtureStaffId,
            shift_date: '2099-01-15',
            planned_start: '09:00',
            planned_end: '10:00',
            shift_type: 'full',
            break_minutes: 0,
            notes: 'Disposable HR integration fixture'
        });
        assert.ok([200, 201].includes(response.status), `unexpected create status ${response.status}`);
        assert.equal(response.data?.success, true);
        const shiftId = Number(response.data?.data?.id);
        assert.ok(Number.isInteger(shiftId) && shiftId > 0, 'created shift id is returned for cleanup');
        createdShiftIds.push(shiftId);
    });
});
