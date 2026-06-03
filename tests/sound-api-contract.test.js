'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { SOUND_API_SURFACE } = require('../config/soundApiSurface');

const rootDir = path.resolve(__dirname, '..');

test('Sound API surface keeps music primary and sound-library legacy-only', () => {
    assert.equal(SOUND_API_SURFACE.primary.mount, '/api/music');
    assert.equal(SOUND_API_SURFACE.primary.routeFile, 'routes/music.js');
    assert.equal(SOUND_API_SURFACE.primary.compatibilityOnly, false);

    assert.equal(SOUND_API_SURFACE.legacy.mount, '/api/sound-library');
    assert.equal(SOUND_API_SURFACE.legacy.routeFile, 'routes/sound-library.js');
    assert.equal(SOUND_API_SURFACE.legacy.compatibilityOnly, true);

    const legacyRoute = fs.readFileSync(path.join(rootDir, SOUND_API_SURFACE.legacy.routeFile), 'utf8');
    assert.match(legacyRoute, /Legacy compatibility CRUD only/);
    assert.match(legacyRoute, /New Sound behavior must use \/api\/music/);

    const assistantContext = fs.readFileSync(path.join(rootDir, 'docs/ai-context/pages/sound.md'), 'utf8');
    assert.match(assistantContext, /Prefer `\/api\/music` behavior/);
    assert.match(assistantContext, /Treat `\/api\/sound-library` as legacy compatibility/);
});
