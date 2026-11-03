'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('PDF services do not load PDFKit until a document is generated', () => {
    const root = path.resolve(__dirname, '..');
    const script = `
        const pdfkit = require.resolve('pdfkit');
        require('./services/banquetSummaryPdf');
        require('./services/graduationDiplomas');
        require('./services/hrAttendanceDocumentsPdf');
        if (require.cache[pdfkit]) process.exit(1);
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('diploma generation loads PDFKit on demand and supports concurrent requests', async () => {
    const script = `
        const assert = require('node:assert/strict');
        const { buildDiplomaPdfBuffer, normalizeChildInput } = require('./services/graduationDiplomas');
        const pdfkit = require.resolve('pdfkit');
        assert.throws(() => buildDiplomaPdfBuffer([], null), /No diploma children/);
        assert.equal(Boolean(require.cache[pdfkit]), false);
        const child = normalizeChildInput({ fullName: 'Тестова Дитина', gender: 'girl', classLabel: '4-А' });
        child.id = 1; child.finalWish = 'Тестове побажання';
        Promise.all(Array.from({length: 3}, () => buildDiplomaPdfBuffer([child], null, {quote_number:'TEST'})))
          .then(buffers => { assert.equal(Boolean(require.cache[pdfkit]), true); for (const b of buffers) { assert.equal(b.subarray(0, 5).toString(), '%PDF-'); assert.match(b.toString('latin1'), /\\/Count 1/); } })
          .catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('all three PDF generators support repeated and concurrent synthetic documents', async () => {
    const root = path.resolve(__dirname, '..');
    const fixture = require('./fixtures/booking-summary-layout-compact.fixture.json');
    const { referenceSnapshot } = require('./fixtures/hrAttendanceDocumentsV27');
    const { buildBanquetSummaryPdfBuffer } = require('../services/banquetSummaryPdf');
    const { buildDiplomaPdfBuffer, normalizeChildInput } = require('../services/graduationDiplomas');
    const { buildHrAttendanceDocumentPdfBuffer } = require('../services/hrAttendanceDocumentsPdf');
    const child = normalizeChildInput({ fullName: 'Тестова Дитина', gender: 'girl', classLabel: '4-А' });
    child.id = 1; child.finalWish = 'Тестове побажання';
    const jobs = [
        () => buildBanquetSummaryPdfBuffer(fixture.summary, {mode:'client'}),
        () => buildDiplomaPdfBuffer([child], null, {quote_number:'TEST'}),
        () => buildHrAttendanceDocumentPdfBuffer(referenceSnapshot('arrival_inout'))
    ];
    for (const make of jobs) {
        const first = await make();
        const results = await Promise.all([make(), make()]);
        for (const b of [first, ...results]) {
            assert.equal(b.subarray(0, 5).toString(), '%PDF-');
            assert.match(b.toString('latin1'), /\/Type\s*\/Page\b/);
        }
    }
    await assert.rejects(buildBanquetSummaryPdfBuffer({}, {mode:'client'}));
    await assert.rejects(buildHrAttendanceDocumentPdfBuffer(null));
});
