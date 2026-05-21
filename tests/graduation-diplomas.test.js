const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    WISH_POOLS,
    normalizeChildInput,
    suggestGenderFromName,
    pickWish,
    parseRosterImport,
    buildDiplomaDocument,
    buildDiplomaPdfBuffer,
    buildRosterCsv
} = require('../services/graduationDiplomas');

describe('Graduation diploma helper', () => {
    it('keeps a large gender-aware wish pool', () => {
        const total = WISH_POOLS.girl.length + WISH_POOLS.boy.length + WISH_POOLS.neutral.length;
        assert.ok(total >= 24);
        assert.ok(WISH_POOLS.girl.length >= 8);
        assert.ok(WISH_POOLS.boy.length >= 8);
        assert.ok(WISH_POOLS.neutral.length >= 8);
    });

    it('suggests gender without locking manual override', () => {
        assert.equal(suggestGenderFromName('Марія').gender, 'girl');
        assert.equal(suggestGenderFromName('Артем').gender, 'boy');
        const manual = normalizeChildInput({ fullName: 'Саша Іваненко', gender: 'neutral' });
        assert.equal(manual.gender, 'neutral');
        assert.equal(manual.genderSource, 'manual');
    });

    it('parses semicolon roster import lines', () => {
        const rows = parseRosterImport('Марія Іваненко;дівчинка;4-А;Світлих перемог\nАртем Петренко;хлопчик;4-А');
        assert.equal(rows.length, 2);
        assert.equal(rows[0].gender, 'girl');
        assert.equal(rows[0].customWish, 'Світлих перемог');
        assert.equal(rows[1].gender, 'boy');
    });

    it('minimizes duplicate wishes inside one batch', () => {
        const used = new Set();
        const children = Array.from({ length: 6 }, (_, idx) => normalizeChildInput({
            fullName: `Дитина ${idx}`,
            gender: idx % 2 ? 'girl' : 'boy'
        }));
        const wishes = children.map((child, idx) => pickWish(child, used, idx));
        assert.equal(new Set(wishes).size, wishes.length);
    });

    it('renders escaped HTML/SVG diploma document and CSV roster', () => {
        const child = normalizeChildInput({ fullName: '<Марія> Іваненко', gender: 'girl', customWish: '<script>alert(1)</script>' });
        child.id = 1;
        const html = buildDiplomaDocument([child], null, { quote_number: 'GRAD-TEST' });
        assert.match(html, /diploma-template-bg/);
        assert.match(html, /\/images\/graduation\/diploma-comic-template\.png/);
        assert.match(html, /@page \{ size: 210mm 297mm; margin: 0mm; \}/);
        assert.match(html, /width: 210mm; height: 297mm/);
        assert.match(html, /\/images\/park-logo\.png/);
        assert.match(html, /diploma-title/);
        assert.match(html, /diploma-park-logo/);
        assert.doesNotMatch(html, /Класний керівник/);
        assert.doesNotMatch(html, /ПАРК ЗАКРЕВСЬКОГО ПЕРІОДУ/);
        assert.doesNotMatch(html, /організатор випускного/);
        assert.doesNotMatch(html, /GRAD-TEST/);
        assert.match(html, /diploma-date/);
        assert.match(html, />\d{4}<\/div>/);
        assert.doesNotMatch(html, /A4 landscape/);
        assert.match(html, /&lt;Марія&gt;/);
        assert.doesNotMatch(html, /<script>alert/);
        const csv = buildRosterCsv([child]);
        assert.match(csv, /Фінальне побажання/);
        assert.match(csv, /Марія/);
    });

    it('uses compact diploma copy classes for long description and wish text', () => {
        const child = normalizeChildInput({
            fullName: 'Long Child Name',
            gender: 'neutral',
            customWish: 'Long warm wish '.repeat(14)
        });
        child.id = 2;
        const html = buildDiplomaDocument([child], {
            subtitleText: 'Long achievement description '.repeat(9)
        });
        assert.match(html, /class="diploma-page is-copy-dense"/);
        assert.match(html, /class="diploma-text diploma-description is-very-long"/);
        assert.match(html, /class="diploma-text diploma-wish is-very-long"/);
    });

    it('builds one multi-page PDF buffer for a diploma batch', async () => {
        const children = ['Марія Іваненко', 'Артем Петренко'].map((fullName, idx) => {
            const child = normalizeChildInput({
                fullName,
                gender: idx ? 'boy' : 'girl',
                classLabel: '4-А'
            });
            child.id = idx + 10;
            child.finalWish = `Побажання ${idx + 1}`;
            return child;
        });
        const pdf = await buildDiplomaPdfBuffer(children, null, { quote_number: 'GRAD-TEST' });
        assert.ok(Buffer.isBuffer(pdf));
        assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
        const pdfSource = pdf.toString('latin1');
        assert.match(pdfSource, /\/Count 2/);
        assert.match(pdfSource, /Nunito-Black/);
        assert.match(pdfSource, /Nunito-Bold/);
    });
});
