const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeDraft,
    buildCaptionDraft,
    draftIsActionable,
    publicVisionStatus
} = require('../services/warehousePhotoIntake');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

describe('warehouse Telegram photo intake contract', () => {
    it('normalizes a vision draft into warehouse-safe fields', () => {
        const draft = normalizeDraft({
            name: '  Paper cups  ',
            quantity: '12',
            unit: 'pcs',
            category: 'unknown',
            notes: '  delivery box  ',
            confidence: 0.7
        });

        assert.equal(draft.name, 'Paper cups');
        assert.equal(draft.quantity, 12);
        assert.equal(draft.unit, 'шт');
        assert.equal(draft.category, 'craft');
        assert.equal(draft.notes, 'delivery box');
        assert.equal(draftIsActionable(draft), true);
    });

    it('keeps caption-only extraction as manual-review draft', () => {
        const draft = buildCaptionDraft('склад 24 уп паперові стакани');

        assert.equal(draft.quantity, 24);
        assert.equal(draft.unit, 'уп');
        assert.match(draft.name, /паперові стакани/i);
        assert.equal(draft.needsManualReview, true);
        assert.ok(draft.confidence < 0.5);
    });

    it('exposes real API, webhook, and warehouse UI integration points', () => {
        const route = readRepoFile('routes', 'warehouse.js');
        const telegramRoute = readRepoFile('routes', 'telegram.js');
        const html = readRepoFile('warehouse.html');
        const frontend = readRepoFile('js', 'warehouse-page.js');

        assert.match(route, /\/photo-intake\/status/);
        assert.match(route, /warehousePhotoIntake\.confirmIntake/);
        assert.match(telegramRoute, /hasWarehousePhotoInput/);
        assert.match(telegramRoute, /wh_intake_confirm:/);
        assert.match(html, /warehouseIntakeTitle/);
        assert.match(frontend, /confirmWarehouseIntake/);
    });

    it('does not expose the OpenAI secret while reporting readiness', () => {
        const status = publicVisionStatus();
        assert.equal(status.provider, 'openai');
        assert.equal(status.keyEnv, 'OPENAI_API_KEY');
        assert.equal(Object.prototype.hasOwnProperty.call(status, 'apiKey'), false);
    });
});
