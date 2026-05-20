const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    WISH_POOLS,
    normalizeChildInput,
    suggestGenderFromName,
    pickWish,
    parseRosterImport,
    buildDiplomaDocument,
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
        assert.match(html, /<svg class="diploma-frame"/);
        assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
        assert.match(html, /width: 210mm; height: 297mm/);
        assert.match(html, /\/images\/park-logo\.png/);
        assert.doesNotMatch(html, /Класний керівник/);
        assert.doesNotMatch(html, /A4 landscape/);
        assert.match(html, /&lt;Марія&gt;/);
        assert.doesNotMatch(html, /<script>alert/);
        const csv = buildRosterCsv([child]);
        assert.match(csv, /Фінальне побажання/);
        assert.match(csv, /Марія/);
    });
});
