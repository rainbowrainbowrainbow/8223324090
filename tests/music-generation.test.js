const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Sound AI generation contract', () => {
    it('uses Kie Suno endpoints instead of the old disabled music stub', () => {
        const route = read('routes/music.js');

        assert.match(route, /router\.post\('\/library\/generate-music'/);
        assert.match(route, /\/api\/v1\/generate/);
        assert.match(route, /\/api\/v1\/generate\/record-info/);
        assert.match(route, /KIE_SUNO_CALLBACK_URL/);
        assert.match(route, /KIE_CALLBACK_SECRET/);
        assert.doesNotMatch(route, /Suno not available/);
        assert.doesNotMatch(route, /suggestion:\s*'upload'/);
    });

    it('keeps generated audio durable through CRM upload metadata', () => {
        const route = read('routes/music.js');
        const storage = read('services/audioStorage.js');

        assert.match(storage, /uploadAudioFromUrlWithMetadata/);
        assert.match(route, /uploadAudioFromUrlWithMetadata/);
        assert.match(route, /storage_provider, storage_bucket, storage_key, storage_url, storage_migrated_at/);
        assert.match(route, /folder:\s*'sounds\/generated'/);
    });

    it('exposes the music modal and polls Suno provider status from the client', () => {
        const html = read('sound.html');
        const client = read('js/sound-page.js');

        assert.match(html, /onclick="_openMusicModal\(\)"/);
        assert.match(html, /Створити музику/);
        assert.doesNotMatch(html, /AI-музика недоступна/);
        assert.doesNotMatch(html, /sound-create-btn music is-disabled/);
        assert.match(client, /\/music\/library\/generate-music/);
        assert.match(client, /\?provider=\$\{encodeURIComponent\(provider\)\}/);
        assert.match(client, /'suno'\)/);
        assert.match(client, /encodeURIComponent\(provider\)/);
    });
});
