'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewAttendanceDocument, matchAttendanceRows, recognizeAttendanceSheet } = require('../services/crmAttendanceOcr');
const file = { mimetype: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') };
const day = '2026-09-29';
const row = overrides => ({ sourceRowOrdinal: 1, ocrName: 'Synthetic A', arrivalTime: '10:50', departureTime: '20:15', confidence: 0.99, issues: [], ...overrides });
const document = rows => ({ documentType: 'attendance_sheet', documentDate: day, dateConfidence: 0.99, pageNumber: 2, pageCount: 3, rows });

test('arrival/departure staging preserves both columns, unknown blanks and partial-page scope', () => {
    const result = reviewAttendanceDocument(document([row({ staffId: 999 }), row({ sourceRowOrdinal: 2, arrivalTime: null, departureTime: null })]), day);
    assert.equal(result.rows[0].arrivalTime, '10:50'); assert.equal(result.rows[0].departureTime, '20:15');
    assert.equal(result.rows[0].staffId, undefined); assert.equal(result.rows[1].classification, 'empty_unknown');
    assert.equal(result.applyAllowed, false); assert.equal(result.wholeDayComplete, false);
    assert.throws(() => { result.rows[0].arrivalTime = '09:00'; }, TypeError);
    assert.throws(() => result.rows.push(row()), TypeError);
});

test('empty, incomplete, invalid, uncertain and overnight rows never become actionable candidates', () => {
    const variations = [
        [{ arrivalTime: null, departureTime: null }, 'empty_unknown'], [{ departureTime: null }, 'incomplete_pair'],
        [{ arrivalTime: '25:00' }, 'invalid_time'], [{ confidence: 0.5 }, 'uncertain'],
        [{ confidence: '0.99' }, 'uncertain'], [{ issues: ['illegible'] }, 'uncertain'], [{ issues: null }, 'uncertain'],
        [{ departureTime: '09:00' }, 'overnight_or_interval_requires_review']
    ];
    for (const [changes, expected] of variations) assert.equal(reviewAttendanceDocument(document([row(changes)]), day).rows[0].classification, expected);
});

test('wrong document/date, impossible dates and duplicated source rows reject staging', () => {
    for (const data of [{ ...document([row()]), documentType: 'planned_schedule' }, { ...document([row()]), documentDate: '2026-09-30' },
        { ...document([row()]), documentDate: '2026-02-30' }, document([row(), row()])]) assert.throws(() => reviewAttendanceDocument(data, day));
    const lowDate = reviewAttendanceDocument({ ...document([row()]), dateConfidence: 0.2 }, day);
    assert.equal(lowDate.rows[0].classification, 'document_date_requires_review');
});

test('staff matching reuses canonical exact-name rules and cannot authorize a write or duplicate target', () => {
    const review = reviewAttendanceDocument(document([row(), row({ sourceRowOrdinal: 2 }), row({ sourceRowOrdinal: 3, ocrName: 'Missing' })]), day);
    const result = matchAttendanceRows(review, [{ id: 12, name: 'Synthetic A' }]);
    assert.equal(result[0].matchedStaffId, 12); assert.equal(result[0].classification, 'requires_current_state_preview');
    assert.equal(result[1].classification, 'duplicate_target'); assert.equal(result[2].classification, 'staff_not_found');
    const ambiguous = matchAttendanceRows(review, [{ id: 12, name: 'Synthetic A' }, { id: 13, name: 'Synthetic A' }]);
    assert.equal(ambiguous[0].classification, 'ambiguous_staff');
});

test('native KIE attendance recognition uses bounded inline media and its own instructions with no OpenAI key', async () => {
    let calls = 0, receipt;
    const result = await recognizeAttendanceSheet({ file, documentDate: day,
        env: { NODE_ENV: 'test', CRM_ATTENDANCE_OCR_ENABLED: 'true', CRM_ATTENDANCE_OCR_MODEL: 'gemini-3-8-flash-openai', KIE_API_KEY: 'synthetic-key' },
        onReceipt: value => { receipt = value; }, fetchImpl: async (url, options) => {
            calls++; assert.equal(url, 'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions');
            const body = JSON.parse(options.body); assert.match(body.messages[0].content, /ACTUAL staff arrival\/departure/);
            assert.match(body.messages[0].content, /Blank cells are unknown, not absence/);
            assert.match(body.messages[1].content[0].text, /arrival\/departure/);
            assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
            assert.equal(body.max_tokens, 6000); assert.equal(options.redirect, 'error');
            return Response.json({ credits_consumed: 0.1, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document([row()])) } }] });
        } });
    assert.equal(calls, 1); assert.equal(result.rows[0].departureTime, '20:15'); assert.equal(receipt.creditsConsumed, 0.1);
});

test('attendance feature defaults off and test mode cannot call a real provider', async () => {
    await assert.rejects(recognizeAttendanceSheet({ file, documentDate: day, env: {} }), { code: 'CRM_EXECUTION_DISABLED' });
    await assert.rejects(recognizeAttendanceSheet({ file, documentDate: day,
        env: { NODE_ENV: 'test', CRM_ATTENDANCE_OCR_ENABLED: 'true', CRM_ATTENDANCE_OCR_MODEL: 'gemini-3-8-flash-openai', KIE_API_KEY: 'synthetic-key' } }), { code: 'CRM_OCR_PROVIDER_BLOCKED_IN_TESTS' });
});
