const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');

function sourceSection(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `Missing source section: ${start}`);
    return source.slice(first, last);
}

function menuProduct(id = 'dish-1', businessContext = 'event_genix', studio = {}) {
    return {
        id,
        name: 'Тестова страва',
        kitchenType: 'menu',
        businessContext,
        iconUrl: '/uploads/current-photo.jpg',
        aiCardDraft: { imageStudio: studio }
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function createPageHarness() {
    const dom = new JSDOM('<!doctype html><main id="products"></main>');
    const notifications = [];
    const timers = new Map();
    let now = Date.parse('2026-09-28T12:00:00Z');
    let nextTimerId = 1;
    class ClockDate extends Date {
        static now() { return now; }
    }
    const context = vm.createContext({
        window: dom.window,
        document: dom.window.document,
        Date: ClockDate,
        setTimeout(callback, delay) {
            const id = nextTimerId++;
            timers.set(id, { callback, at: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        activeBusinessContext: 'event_genix',
        allProducts: [menuProduct()],
        MENU_IMAGE_SIZE_OPTIONS: [{ value: '1536x1024', label: 'wide' }],
        MENU_IMAGE_STYLE_OPTIONS: [{ value: 'catalog', label: 'Каталог' }],
        MENU_IMAGE_GENERATOR_OPTIONS: [
            { value: 'kie/nano-banana-2', label: 'Kie · Nano Banana 2' },
            { value: 'kie/nano-banana-pro', label: 'Kie · Nano Banana Pro' },
            { value: 'openai', label: 'OpenAI · GPT Image' }
        ],
        MENU_IMAGE_MANUAL_ALLOWED_TYPES: new Set(['image/png']),
        MENU_IMAGE_MANUAL_MAX_FILE_BYTES: 12 * 1024 * 1024,
        escapeHtml(value) {
            return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
        escapeJsString: value => String(value || '').replace(/'/g, "\\'"),
        getKitchenType: product => product.kitchenType,
        productMenuTitle: product => product.name,
        productMenuImageUrl: product => product.iconUrl || '',
        getProductAllergenLabels: () => [],
        guardProductWrite: () => true,
        showNotification(message, type) { notifications.push({ message, type }); }
    });
    context.getProductApiBusinessContext = value => value || context.activeBusinessContext;
    context.updateProductInState = product => {
        const index = context.allProducts.findIndex(item => item.id === product.id);
        if (index >= 0) context.allProducts[index] = product;
    };
    context.renderProducts = () => {
        const product = context.allProducts[0];
        dom.window.document.getElementById('products').innerHTML = context.renderKitchenMenuImageStudio(product, true);
    };

    vm.runInContext('const menuImageGenerationState = new Map();', context);
    vm.runInContext('const menuImageGeneratorSelection = new Map();', context);
    vm.runInContext('const burgerMenuImageBlueprints = new Map();', context);
    vm.runInContext([
        sourceSection(pageSource, 'function getMenuImageStudioDraft(', 'function menuAiFeedbackForMode('),
        sourceSection(pageSource, 'function setKitchenMenuImageStudioBusy(', 'function renderProgramProducts(')
    ].join('\n'), context, { filename: 'js/programs-page.js#menu-image' });
    context.renderProducts();

    return {
        context,
        notifications,
        panel: () => dom.window.document.querySelector('.kitchen-menu-image-studio'),
        button: () => dom.window.document.querySelector('[data-menu-image-action="generate"]'),
        message: () => dom.window.document.querySelector('[data-menu-image-generation-status]').textContent,
        advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        }
    };
}

test('a burger card saves one shared blueprint without applying a product draft', async () => {
    const page = createPageHarness();
    const product = menuProduct();
    product.name = 'Курячий бургер';
    product.iconUrl = '/uploads/catalog-images/items/current-burger.png';
    page.context.allProducts = [product];
    let calls = 0;
    page.context.apiSaveBurgerMenuImageBlueprint = async payload => {
        calls++;
        assert.equal(payload.productId, product.id);
        assert.equal(payload.source, 'current');
        return { success: true, blueprint: {
            imageUrl: product.iconUrl, instructions: payload.instructions
        } };
    };
    page.context.renderProducts();
    const button = page.panel().querySelector('.kitchen-menu-image-blueprint button');
    assert.ok(button);
    await page.context.saveBurgerMenuImageBlueprint(product.id, button);
    assert.equal(calls, 1);
    assert.equal(product.iconUrl, '/uploads/catalog-images/items/current-burger.png');
    assert.match(page.panel().textContent, /Еталон для всіх бургерів цього бізнесу · задано/);
});

test('generation API preserves the structured IMG-02 failure without replaying the request', async () => {
    let calls = 0;
    const context = vm.createContext({
        API_BASE: '/api',
        guardCrmBusinessWrite: () => true,
        getAuthHeaders: () => ({ Authorization: 'synthetic-test-token' }),
        handleAuthError: () => false,
        apiNetworkFetch: async () => {
            calls++;
            return new Response(JSON.stringify({
                success: false,
                error: 'Provider credits or account limits prevent menu image generation',
                code: 'menu_image_generation_quota_exceeded',
                retryable: false,
                retryAfterSeconds: null,
                requestId: 'req_safe_123',
                product: { id: 'dish-1' }
            }), { status: 429 });
        },
        console
    });
    vm.runInContext(sourceSection(apiSource, 'async function apiGenerateProductMenuImage(', 'async function apiCreateProductMenuExternalDraft('), context);
    const result = await context.apiGenerateProductMenuImage('dish-1', { businessContext: 'event_genix' });

    assert.equal(calls, 1);
    assert.equal(result.code, 'menu_image_generation_quota_exceeded');
    assert.equal(result.status, 429);
    assert.equal(result.retryable, false);
    assert.equal(result.retryAfterSeconds, null);
    assert.equal(result.requestId, 'req_safe_123');
    assert.equal(result.product.id, 'dish-1');
});

test('rerender and repeated clicks keep one in-flight request and server cooldown', async () => {
    const app = createPageHarness();
    const pending = deferred();
    let calls = 0;
    app.context.apiGenerateProductMenuImage = async () => { calls++; return pending.promise; };

    const first = app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(calls, 1);
    assert.equal(app.panel().getAttribute('aria-busy'), 'true');
    app.context.renderProducts();
    assert.equal(app.button().disabled, true);
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(calls, 1);

    pending.resolve({
        success: false,
        code: 'menu_image_generation_rate_limited',
        retryable: true,
        retryAfterSeconds: 17,
        product: menuProduct('dish-1', 'event_genix', { status: 'failed', prompt: 'test prompt' })
    });
    await first;
    assert.equal(app.button().disabled, true);
    assert.match(app.message(), /Повторіть вручну після/);
    assert.equal(app.panel().querySelector('[data-menu-image-file]').disabled, false);
    assert.equal(app.panel().querySelector('[data-menu-image-action="reject"]').disabled, false);
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(calls, 1);

    app.context.renderProducts();
    assert.equal(app.button().disabled, true);
    app.advance(17010);
    assert.equal(app.button().disabled, false);
    assert.match(app.message(), /Можете повторити генерацію вручну/);
    assert.equal(calls, 1, 'cooldown expiry must not generate automatically');
    app.context.apiGenerateProductMenuImage = async () => { calls++; return { success: false, code: 'menu_image_generation_provider_rejected' }; };
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(calls, 2);
});

test('Kie selection creates one task and status polling survives a card rerender', async () => {
    const app = createPageHarness();
    const selector = app.panel().querySelector('[data-menu-image-generator]');
    assert.equal(selector.value, 'kie/nano-banana-2');
    selector.value = 'kie/nano-banana-pro';
    let generationCalls = 0;
    let statusCalls = 0;
    app.context.apiGenerateProductMenuImage = async (id, payload) => {
        generationCalls++;
        assert.equal(payload.generator, 'kie/nano-banana-pro');
        return { success: true, status: 'generating', product: menuProduct(id, 'event_genix', {
            status: 'generating', provider: 'kie', model: 'nano-banana-pro', taskId: 'task_123'
        }) };
    };
    app.context.apiGetProductMenuImageStatus = async id => {
        statusCalls++;
        return statusCalls === 1
            ? { success: true, status: 'generating', product: menuProduct(id, 'event_genix', {
                status: 'generating', provider: 'kie', model: 'nano-banana-pro', taskId: 'task_123'
            }) }
            : {
                success: true, status: 'ready',
                draft: { imageStudio: { provider: 'kie' } },
                product: menuProduct(id, 'event_genix', {
                    status: 'ready', provider: 'kie', model: 'nano-banana-pro', imageUrl: '/uploads/kie-draft.png'
                })
            };
    };
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(generationCalls, 1);
    app.context.renderProducts();
    assert.equal(app.button().disabled, true);
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.equal(generationCalls, 1);
    app.advance(3000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(statusCalls, 1);
    assert.equal(app.button().disabled, true);
    app.advance(4000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(statusCalls, 2);
    assert.equal(app.button().disabled, false);
    assert.equal(app.panel().querySelectorAll('.kitchen-menu-image-preview img')[0].getAttribute('src'), '/uploads/current-photo.jpg');
    assert.equal(app.panel().querySelectorAll('.kitchen-menu-image-preview img')[1].getAttribute('src'), '/uploads/kie-draft.png');
    assert.equal(app.panel().querySelector('[data-menu-image-action="apply"]').disabled, false);
    assert.equal(generationCalls, 1);
});

test('quota and unknown failures explain the next action without disabling manual upload', async () => {
    for (const [code, expected] of [
        ['menu_image_generation_quota_exceeded', /Зверніться до адміністратора/],
        ['menu_image_generation_provider_rejected', /Причина не підтверджена/],
        ['menu_image_generation_failed', /Причина невідома/]
    ]) {
        const app = createPageHarness();
        app.context.apiGenerateProductMenuImage = async () => ({ success: false, code, retryable: false });
        await app.context.generateKitchenMenuImage('dish-1', app.button());
        assert.match(app.message(), expected, code);
        assert.equal(app.button().disabled, false, code);
        assert.equal(app.panel().querySelector('[data-menu-image-file]').disabled, false, code);
        assert.equal(app.panel().querySelector('[data-menu-image-action="external-draft"]').disabled, false, code);
        assert.equal(app.message().includes('temporarily rate limited'), false, code);
    }
});

test('failed Kie polling shows the safe task ID without triggering another generation', async () => {
    const app = createPageHarness();
    let generationCalls = 0;
    app.context.apiGenerateProductMenuImage = async id => {
        generationCalls++;
        return { success: true, status: 'generating', product: menuProduct(id, 'event_genix', {
            status: 'generating', provider: 'kie', model: 'nano-banana-2', taskId: 'task_failed_123'
        }) };
    };
    app.context.apiGetProductMenuImageStatus = async id => ({
        success: false, status: 'failed', code: 'menu_image_generation_failed',
        providerCode: 'INPUT_IMAGE_FAILED', providerTaskId: 'task_failed_123',
        product: menuProduct(id, 'event_genix', { status: 'failed', provider: 'kie' })
    });
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    app.advance(3000);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(app.message(), /INPUT_IMAGE_FAILED/);
    assert.match(app.message(), /task_failed_123/);
    assert.equal(app.panel().querySelector('[data-menu-image-file]').disabled, false);
    assert.equal(generationCalls, 1);
});

test('failed Kie draft keeps its support ID visible after catalog rerender', () => {
    const app = createPageHarness();
    app.context.allProducts = [menuProduct('dish-1', 'event_genix', {
        status: 'failed', provider: 'kie', providerCode: 'INPUT_IMAGE_FAILED',
        taskId: 'task_failed_123', prompt: 'test prompt'
    })];
    app.context.renderProducts();
    assert.match(app.message(), /INPUT_IMAGE_FAILED/);
    assert.match(app.message(), /task_failed_123/);
    assert.equal(app.button().disabled, false);
    assert.equal(app.panel().querySelector('[data-menu-image-file]').disabled, false);
});

test('a quota failure still allows a manual draft and clears the AI error after saving it', async () => {
    const app = createPageHarness();
    app.context.apiGenerateProductMenuImage = async () => ({
        success: false, code: 'menu_image_generation_quota_exceeded', retryable: false
    });
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    app.panel().querySelector('[data-menu-image-url]').value = 'https://example.test/manual.jpg';
    let manualCalls = 0;
    app.context.apiCreateProductMenuExternalDraft = async (id, payload) => {
        manualCalls++;
        assert.equal(payload.imageUrl, 'https://example.test/manual.jpg');
        return { success: true, product: menuProduct(id, 'event_genix', {
            status: 'ready', imageUrl: '/uploads/manual-draft.jpg'
        }) };
    };
    await app.context.createKitchenMenuExternalDraft('dish-1', app.panel().querySelector('[data-menu-image-action="external-draft"]'));
    assert.equal(manualCalls, 1);
    assert.equal(app.message(), '');
    assert.equal(app.panel().querySelectorAll('.kitchen-menu-image-preview img')[0].getAttribute('src'), '/uploads/current-photo.jpg');
    assert.equal(app.panel().querySelectorAll('.kitchen-menu-image-preview img')[1].getAttribute('src'), '/uploads/manual-draft.jpg');
});

test('a failed regeneration does not block review of an existing ready draft', async () => {
    const app = createPageHarness();
    app.context.allProducts = [menuProduct('dish-1', 'event_genix', {
        status: 'ready', imageUrl: '/uploads/previous-draft.jpg', prompt: 'previous prompt'
    })];
    app.context.renderProducts();
    app.context.apiGenerateProductMenuImage = async () => ({
        success: false, code: 'menu_image_generation_quota_exceeded', retryable: false
    });
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.match(app.message(), /Зверніться до адміністратора/);
    assert.equal(app.panel().querySelector('[data-menu-image-action="apply"]').disabled, false);
    assert.equal(app.panel().querySelector('[data-menu-image-action="reject"]').disabled, false);
});

test('generation returns a reviewable draft while the current photo remains unchanged', async () => {
    const app = createPageHarness();
    app.context.apiGenerateProductMenuImage = async () => ({
        success: true,
        product: menuProduct('dish-1', 'event_genix', {
            status: 'ready', imageUrl: '/uploads/new-draft.jpg', prompt: 'test prompt'
        })
    });
    await app.context.generateKitchenMenuImage('dish-1', app.button());
    const previews = app.panel().querySelectorAll('.kitchen-menu-image-preview img');
    assert.equal(previews[0].getAttribute('src'), '/uploads/current-photo.jpg');
    assert.equal(previews[1].getAttribute('src'), '/uploads/new-draft.jpg');
    assert.equal(app.panel().querySelector('[data-menu-image-action="apply"]').disabled, false);
    assert.match(app.notifications.at(-1).message, /Поточне фото не змінено/);

    let applyCalls = 0;
    app.context.apiApplyProductMenuImage = async () => {
        applyCalls++;
        return { success: true, product: {
            ...menuProduct('dish-1', 'event_genix', { status: 'applied', imageUrl: '/uploads/new-draft.jpg' }),
            iconUrl: '/uploads/new-draft.jpg'
        } };
    };
    await app.context.applyKitchenMenuImageDraft('dish-1', app.panel().querySelector('[data-menu-image-action="apply"]'));
    assert.equal(applyCalls, 1);
    assert.equal(app.panel().querySelector('.kitchen-menu-image-preview img').getAttribute('src'), '/uploads/new-draft.jpg');
});

test('in-flight state is scoped by business context and late responses cannot replace another catalog', async () => {
    const app = createPageHarness();
    const firstResponse = deferred();
    const secondResponse = deferred();
    const calls = [];
    app.context.apiGenerateProductMenuImage = async (id, payload) => {
        calls.push(payload.businessContext);
        return payload.businessContext === 'event_genix' ? firstResponse.promise : secondResponse.promise;
    };
    const first = app.context.generateKitchenMenuImage('dish-1', app.button());
    app.context.activeBusinessContext = 'other_business';
    app.context.allProducts = [menuProduct('dish-1', 'other_business')];
    app.context.renderProducts();
    assert.equal(app.button().disabled, false);
    const second = app.context.generateKitchenMenuImage('dish-1', app.button());
    assert.deepEqual(calls, ['event_genix', 'other_business']);

    secondResponse.resolve({ success: true, product: menuProduct('dish-1', 'other_business', {
        status: 'ready', imageUrl: '/uploads/other-draft.jpg'
    }) });
    await second;
    firstResponse.resolve({ success: false, code: 'menu_image_generation_quota_exceeded', retryable: false });
    await first;
    assert.equal(app.panel().querySelectorAll('.kitchen-menu-image-preview img')[1]?.getAttribute('src'), '/uploads/other-draft.jpg');
    assert.equal(app.message(), '');
});
