const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('program icon generation schema persists icon state and prompt/debug trail', () => {
    const migration = read('db/migrations/240_products_program_icon_generation.sql');

    assert.match(migration, /MIGRATION_KIND: schema/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_url TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_generation_status VARCHAR\(20\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_prompt_source_snapshot JSONB/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_llm_prompt_output TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_final_image_prompt TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_provider VARCHAR\(40\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_model VARCHAR\(120\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_last_error TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_generated_at TIMESTAMP/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS icon_job_id VARCHAR\(160\)/);
    assert.match(migration, /products_icon_generation_status_check/);
    assert.match(migration, /product_ai_settings/);
    assert.match(migration, /program_icon_generation/);
});

test('program icon service keeps prompt fallback, Kie media default, OpenRouter prompt rail, and no batch path', () => {
    const service = read('services/programIconGeneration.js');
    const storage = read('services/imageStorage.js');
    const impl = require('../services/programIconGeneration');

    assert.ok(['kie.ai', 'openrouter'].includes(impl.PROGRAM_ICON_PROVIDER));
    assert.ok(impl.PROGRAM_ICON_IMAGE_MODEL);
    assert.match(service, /openai\/gpt-5-image-mini/);
    assert.match(service, /Use Kie\.ai for image media/);
    assert.match(service, /Primary async nano-banana-2 image job provider/);
    assert.match(service, /OPENROUTER_API_KEY not configured/);
    assert.match(service, /modalities:\s*\['image', 'text'\]/);
    assert.match(service, /parseOpenRouterImageUrl/);
    assert.match(service, /resolveProgramIconRuntime/);
    assert.match(service, /openRouterChat/);
    assert.match(service, /buildDeterministicProgramIconPrompt/);
    assert.match(service, /fallbackTemplate/);
    assert.match(service, /KIE_API_KEY not configured/);
    assert.match(service, /\/api\/v1\/jobs\/createTask/);
    assert.match(service, /\/api\/v1\/jobs\/recordInfo\?taskId=/);
    assert.match(storage, /startsWith\('data:image\/'\)/);
    assert.doesNotMatch(service, /batch-generate|bulk-generate|auto-backfill/i);

    const prompt = impl.buildDeterministicProgramIconPrompt({
        id: 'program-1',
        name: 'Quest Mystery',
        category: 'quest',
        duration: 60,
        hosts: 1
    });
    assert.match(prompt, /Quest Mystery/);
    assert.match(prompt, /No text/);
    assert.ok(prompt.length <= 1800);

    const parsed = impl.parseOpenRouterImageUrl({
        choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AAAA' } }] } }]
    });
    assert.equal(parsed, 'data:image/png;base64,AAAA');

    const runtime = impl.resolveProgramIconRuntime({ imageProvider: 'openrouter', imageModel: '', promptModel: 'openai/gpt-5.4-nano' });
    assert.equal(runtime.provider, 'openrouter');
    assert.equal(runtime.imageModel, 'openai/gpt-5-image-mini');

    const originalKieKey = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = 'unit-kie-key';
    try {
        const autoRuntime = impl.resolveProgramIconRuntime({ imageProvider: 'auto', imageModel: '', promptModel: 'openai/gpt-5.4-nano' });
        assert.equal(autoRuntime.provider, 'kie.ai');
        assert.equal(autoRuntime.imageModel, 'nano-banana-2');
    } finally {
        if (originalKieKey === undefined) delete process.env.KIE_API_KEY;
        else process.env.KIE_API_KEY = originalKieKey;
    }

    const { errors } = impl.sanitizeProgramIconSettings({ systemInstructions: '', userTemplate: '', styleRules: '', fallbackTemplate: '' });
    assert.ok(errors.length >= 3);
});

test('products API exposes guarded single-program icon endpoints and persisted row mapping', () => {
    const route = read('routes/products.js');

    assert.match(route, /product-program-icon-generation/);
    assert.match(route, /router\.get\('\/program-icon-settings'/);
    assert.match(route, /router\.put\('\/program-icon-settings'/);
    assert.match(route, /router\.post\('\/:id\/program-icon\/generate'/);
    assert.match(route, /router\.get\('\/:id\/program-icon\/status'/);
    assert.match(route, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    assert.match(route, /icon_generation_status = 'pending'/);
    assert.match(route, /deduped: true/);
    assert.match(route, /persistProgramIconImage/);
    assert.match(route, /status:\s*'succeeded'/);
    assert.match(route, /providerOptions/);
    assert.match(route, /imageModelOptions/);
    assert.match(route, /buildDeterministicProgramIconPrompt/);
    assert.match(route, /iconUrl: row\.icon_url/);
    assert.match(route, /iconGenerationStatus: row\.icon_generation_status/);
    assert.match(route, /iconFinalImagePrompt: row\.icon_final_image_prompt/);
});

test('products UI gives operators explicit generate/status/retry/settings surfaces', () => {
    const html = read('programs.html');
    const page = read('js/programs-page.js');
    const api = read('js/api.js');

    assert.match(html, /id="programIconSettingsBtn"/);
    assert.match(html, /id="programIconGenerationPanel"/);
    assert.match(html, /id="programIconSettingsModal"/);
    assert.match(html, /id="programIconImageProvider"/);
    assert.match(html, /id="programIconImageModel"/);
    assert.match(html, /id="programIconPromptModel"/);
    assert.match(html, /id="programIconSystemInstructions"/);
    assert.match(html, /program-icon-ai-panel/);
    assert.match(page, /productIconGenerationInFlight/);
    assert.match(page, /renderProgramIconVisual/);
    assert.match(page, /renderProgramIconPanel/);
    assert.match(page, /startProductIconGeneration/);
    assert.match(page, /pollProductIconGeneration/);
    assert.match(page, /maxAttempts = 18/);
    assert.match(page, /apiGenerateProductProgramIcon/);
    assert.match(page, /apiGetProductProgramIconStatus/);
    assert.match(page, /apiGetProgramIconSettings/);
    assert.match(page, /apiUpdateProgramIconSettings/);
    assert.match(page, /fillProgramIconModelOptions/);
    assert.match(page, /programIconImageProvider/);
    assert.match(api, /apiGenerateProductProgramIcon/);
    assert.match(api, /apiGetProductProgramIconStatus/);
    assert.match(api, /apiGetProgramIconSettings/);
    assert.match(api, /apiUpdateProgramIconSettings/);
});
