'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../services/staffSubstitutionContract');

const input = (patch = {}) => c.normalizeInput({ sourceType: 'standalone', sourceId: 'work-1', workDate: '2099-01-13',
    staffId: 2, originalStaffId: 1, professionKey: 'reception', payUnit: 'hour', payMode: 'additional',
    originalTreatment: 'retain', startsAt: '2099-01-13T09:00:00+02:00', endsAt: '2099-01-13T13:30:00+02:00',
    breakMinutes: 30, workload: 'Cover reception', reason: 'Synthetic coverage', rateMode: 'individual',
    rate: '200', rateReason: 'One-off agreed rate', ...patch });

test('hourly quote retains planned and actual quantities separately', () => {
    const value = input();
    assert.equal(value.plannedMinutes, 240);
    assert.equal(c.amountFor(value, value.rateMinor), 80000);
    assert.equal(c.amountFor(value, value.rateMinor, 180), 60000);
    assert.equal(c.amountFor(value, value.rateMinor, 0), 0);
    assert.equal(value.plannedMinutes, 240);
});

test('base replacement requires a timed scope before agreement for every pay unit',()=>{
    for(const payUnit of ['fixed','shift']) {
        assert.throws(()=>input({payUnit,shiftUnits:'1',payMode:'replace_base',startsAt:null,endsAt:null,breakMinutes:0}),{code:'SUBSTITUTION_TIME_REQUIRED'});
        assert.equal(input({payUnit,shiftUnits:'1',payMode:'additional',startsAt:null,endsAt:null,breakMinutes:0}).plannedMinutes,null);
    }
});

test('shift fractions and fixed scope use exact money with one final rounding', () => {
    assert.equal(c.amountFor(input({ payUnit: 'shift', shiftUnits: '0.5' }), 120000), 60000);
    assert.equal(c.amountFor(input({ payUnit: 'fixed' }), 75000, 300), 75000);
    assert.equal(c.amountFor(input(), 1, 30), 1);
    assert.equal(c.amountFor(input(), 1, 29), 0);
    assert.equal(c.decimalUnits('123.45', 2, 'money'), 12345);
});

test('pay mode and original effect are explicit independent decisions', () => {
    for (const payMode of ['additional', 'replace_base']) {
        for (const originalTreatment of ['retain', 'transfer_unworked_scope']) {
            const result = c.preview(input({ payMode, originalTreatment }), { evidence: {} });
            assert.equal(result.input.payMode, payMode);
            assert.equal(result.input.originalTreatment, originalTreatment);
            assert.ok(result.effects.replacement);
            assert.ok(result.effects.original);
        }
    }
    assert.throws(() => input({ payMode: undefined }), { code: 'SUBSTITUTION_INVALID' });
    assert.throws(() => input({ originalTreatment: undefined }), { code: 'SUBSTITUTION_INVALID' });
    assert.equal(input({ originalStaffId: null }).originalTreatment, 'not_applicable');
});

test('rejects malformed IDs, dates, ambiguous local times, wrong offsets and monetary coercions', () => {
    for (const staffId of [true, 0, -1, 1.2, '1e2', {}, '']) assert.throws(() => input({ staffId }));
    for (const rate of [true, null, '', -1, '1e2', '1.001', 'Infinity', 0]) assert.throws(() => input({ rate }));
    assert.throws(() => input({ staffId: 1 }), { code: 'SUBSTITUTION_SAME_STAFF' });
    assert.throws(() => input({ workDate: '2099-02-29' }));
    assert.throws(() => input({ startsAt: '2099-01-13T09:00:00' }));
    assert.throws(() => input({ startsAt: '2099-01-13T09:00:00+03:00' }));
    assert.throws(() => input({ breakMinutes: 270 }));
});

test('supports explicit DST offsets and overnight work without host timezone assumptions', () => {
    const overnight = input({ endsAt: '2099-01-14T01:00:00+02:00' });
    assert.equal(overnight.plannedMinutes, 930);
    assert.throws(() => input({ workDate: '2026-03-29', startsAt: '2026-03-29T03:30:00+02:00', endsAt: '2026-03-29T05:00:00+03:00' }));
    const dst = input({ workDate: '2026-10-25', startsAt: '2026-10-25T03:00:00+03:00', endsAt: '2026-10-25T03:00:00+02:00', breakMinutes: 0 });
    assert.equal(dst.plannedMinutes, 60);
});

test('stored UTC instants round-trip for revision across the Kyiv date boundary', () => {
    const original = input({
        startsAt: '2099-01-13T00:30:00+02:00',
        endsAt: '2099-01-13T02:45:00+02:00'
    });
    assert.equal(original.startsAt, '2099-01-12T22:30:00.000Z');
    assert.deepEqual(input({ startsAt: original.startsAt, endsAt: original.endsAt }), original);
    const revised = input({ startsAt: original.startsAt, endsAt: original.endsAt, rate: '225' });
    assert.equal(revised.startsAt, original.startsAt);
    assert.equal(revised.plannedMinutes, original.plannedMinutes);
    assert.equal(revised.rateMinor, 22500);
    assert.throws(() => input({ startsAt: '2099-01-12T24:00:00.000Z' }), { code: 'SUBSTITUTION_TIME_INVALID' });
    assert.throws(() => input({ startsAt: '2099-01-12T22:30:00.001Z' }), { code: 'SUBSTITUTION_TIME_INVALID' });
});

test('adjacency is free, overlaps block and explicit permitted concurrency warns', () => {
    const value = input();
    assert.equal(c.overlap(value, { startsAt: value.endsAt, endsAt: '2099-01-13T16:00:00Z' }), false);
    const context = { evidence: {}, commitments: [{ ...value, id: 3, source: 'schedule' }] };
    assert.equal(c.preview(value, context).available, false);
    assert.equal(c.preview(input({ allowConcurrent: true, concurrentReason: 'Same site' }), context).available, false);
    context.commitments[0].simultaneousAllowed = true;
    const permitted = c.preview(input({ allowConcurrent: true, concurrentReason: 'Same site' }), context);
    assert.equal(permitted.available, true);
    assert.equal(permitted.warnings.length, 1);
});

test('date-only work warns and standard rate cannot silently inherit another unit', () => {
    const value = input({ payUnit: 'fixed', startsAt: null, endsAt: null, breakMinutes: 0 });
    assert.equal(c.preview(value, { evidence: {} }).warnings[0].code, 'SUBSTITUTION_UNTIMED');
    const standard = input({ rateMode: 'standard' });
    assert.equal(c.preview(standard, { evidence: {}, standardRate: null }).available, false);
    assert.equal(c.preview(standard, { evidence: {}, standardRate: { rateMinor: 15000, payUnit: 'shift' } }).available, false);
});

test('quote fingerprint is stable and binds rate, source revision and all decisions', () => {
    assert.equal(c.fingerprint({ a: 1, b: 2 }), c.fingerprint({ b: 2, a: 1 }));
    const first = c.preview(input(), { evidence: { sourceVersion: 1 } });
    const second = c.preview(input(), { evidence: { sourceVersion: 2 } });
    assert.notEqual(first.fingerprint, second.fingerprint);
    assert.notEqual(first.fingerprint, c.preview(input({ rate: '201' }), { evidence: { sourceVersion: 1 } }).fingerprint);
});
