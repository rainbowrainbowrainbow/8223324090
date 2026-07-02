const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
    assertExternalDraftPayloadFields,
    buildMenuImageContext,
    createExternalMenuImageDraft,
    MAX_EXTERNAL_IMAGE_BASE64_LENGTH,
    MAX_EXTERNAL_IMAGE_URL_LENGTH,
    normalizeExternalImageSource,
    persistMenuImageDraft
} = require('../services/menuImageDrafts');

function startImageServer(buffer, options = {}) {
    const server = http.createServer((req, res) => {
        res.writeHead(options.statusCode || 200, { 'Content-Type': options.contentType || 'image/png' });
        res.end(buffer);
    });
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/image.png`,
                close: () => new Promise(done => server.close(done))
            });
        });
        server.on('error', reject);
    });
}

describe('menu image draft shared service', () => {
    const tempDirs = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('builds safe menu image context from product facts and draft state', () => {
        const context = buildMenuImageContext({
            id: 'menu_2026_001_item',
            code: 'MENU-001',
            name: 'Kids burger',
            business_context: 'event_genix',
            icon_url: '/uploads/catalog-images/items/current.png',
            menu_section: 'Burgers',
            short_description: 'Soft bun and chicken cutlet',
            ingredients: 'bun, chicken, cheese',
            tech_card: 'Internal kitchen notes',
            weight_value: '220 g',
            serving_unit: 'portion',
            price: 260,
            allergens: [{ key: 'gluten', label: 'Gluten' }],
            ai_card_draft: {
                imageStudio: {
                    status: 'ready',
                    imageUrl: '/uploads/catalog-images/items/draft.png',
                    size: '1024x1024',
                    style: 'catalog'
                }
            }
        });

        assert.equal(context.product.id, 'menu_2026_001_item');
        assert.equal(context.product.currentImageUrl, '/uploads/catalog-images/items/current.png');
        assert.equal(context.product.draftImageUrl, '/uploads/catalog-images/items/draft.png');
        assert.equal(context.product.menuSection, 'Burgers');
        assert.equal(context.product.price, 260);
        assert.deepEqual(context.product.allergens, [{ key: 'gluten', label: 'Gluten' }]);
        assert.equal(context.imageRules.targetUsage, 'booking_menu_catalog');
        assert.ok(context.imageRules.allowedSizes.includes('1536x1024'));
        assert.ok(context.imageRules.allowedStyles.includes('catalog'));
        assert.match(context.imageRules.negativePrompt, /No text/);
    });

    it('creates a ready external draft from imageBase64 without changing active image data', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-menu-image-drafts-'));
        tempDirs.push(tempDir);
        const product = {
            id: 'dish-1',
            code: 'MENU-001',
            name: 'Kids burger',
            icon_url: '/uploads/catalog-images/items/current.png',
            ai_card_draft: {
                blocks: {
                    nameDescription: {
                        status: 'approved',
                        proposal: { name: 'Kids burger' }
                    }
                }
            }
        };

        const result = await createExternalMenuImageDraft({
            product,
            payload: {
                imageBase64: Buffer.from('png').toString('base64'),
                prompt: 'Hermes final prompt',
                provider: 'hermes',
                model: 'hermes-image-model',
                size: '1024x1024',
                style: 'catalog',
                source: 'hermes'
            },
            actor: { username: 'hermes.actor', source: 'hermes' },
            uploadOptions: { localDir: tempDir },
            now: new Date('2026-07-02T08:00:00.000Z')
        });

        assert.equal(product.icon_url, '/uploads/catalog-images/items/current.png');
        assert.equal(result.imageStudio.status, 'ready');
        assert.equal(result.imageStudio.source, 'hermes');
        assert.equal(result.imageStudio.provider, 'hermes');
        assert.equal(result.imageStudio.model, 'hermes-image-model');
        assert.equal(result.imageStudio.size, '1024x1024');
        assert.equal(result.imageStudio.previousImageUrl, '/uploads/catalog-images/items/current.png');
        assert.equal(result.imageStudio.generatedAt, '2026-07-02T08:00:00.000Z');
        assert.equal(result.draft.imageStudio.imageUrl, result.imageUrl);
        assert.equal(result.draft.blocks.nameDescription.status, 'approved');
        assert.match(result.imageUrl, /^\/uploads\/catalog-images\/items\/menu-menu-001-\d+\.png$/);

        const writtenFile = path.join(tempDir, path.basename(decodeURIComponent(result.imageUrl)));
        assert.equal(fs.existsSync(writtenFile), true);
        assert.equal(JSON.stringify(result).includes(Buffer.from('png').toString('base64')), false);
    });

    it('creates a ready external draft from imageUrl and stores it on the catalog upload surface', async () => {
        const image = Buffer.from('url-png');
        const server = await startImageServer(image);
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-menu-image-drafts-url-'));
        tempDirs.push(tempDir);
        try {
            const result = await createExternalMenuImageDraft({
                product: {
                    id: 'dish-2',
                    code: 'MENU-URL',
                    name: 'Menu URL dish',
                    icon_url: '/uploads/catalog-images/items/current-url.png'
                },
                payload: {
                    imageUrl: server.url,
                    prompt: 'Hermes image URL prompt',
                    provider: 'hermes',
                    model: 'hermes-url-model',
                    size: '1536x1024',
                    style: 'catalog',
                    source: 'hermes'
                },
                actor: { username: 'hermes.actor', source: 'hermes' },
                uploadOptions: { localDir: tempDir, allowPrivateNetwork: true },
                now: new Date('2026-07-02T09:00:00.000Z')
            });

            assert.equal(result.imageStudio.status, 'ready');
            assert.equal(result.imageStudio.imageUrl, result.imageUrl);
            assert.equal(result.imageStudio.previousImageUrl, '/uploads/catalog-images/items/current-url.png');
            assert.match(result.imageUrl, /^\/uploads\/catalog-images\/items\/menu-menu-url-\d+\.png$/);

            const writtenFile = path.join(tempDir, path.basename(decodeURIComponent(result.imageUrl)));
            assert.equal(fs.existsSync(writtenFile), true);
            assert.deepEqual(await fsp.readFile(writtenFile), image);
        } finally {
            await server.close();
        }
    });

    it('rejects missing or conflicting external image sources without echoing payload data', () => {
        assert.throws(
            () => normalizeExternalImageSource({}),
            err => err.code === 'menu_image_source_required' && err.status === 400
        );

        const base64 = Buffer.from('secret-image-payload').toString('base64');
        assert.throws(
            () => normalizeExternalImageSource({ imageUrl: 'https://example.test/image.png', imageBase64: base64 }),
            err => {
                assert.equal(err.code, 'menu_image_source_conflict');
                assert.equal(err.status, 400);
                assert.equal(err.message.includes(base64), false);
                return true;
            }
        );

        assert.throws(
            () => assertExternalDraftPayloadFields({
                imageBase64: base64,
                unexpectedSecretField: 'do-not-accept'
            }),
            err => {
                assert.equal(err.code, 'menu_image_payload_unsupported_field');
                assert.equal(err.status, 400);
                assert.equal(err.message.includes(base64), false);
                return true;
            }
        );

        assert.throws(
            () => normalizeExternalImageSource({ imageUrl: 'http://127.0.0.1/image.png' }),
            err => err.code === 'menu_image_source_forbidden' && err.status === 400
        );
    });

    it('rejects unsafe external image payload formats before storage', () => {
        const base64 = Buffer.from('secret-image-payload').toString('base64');
        assert.throws(
            () => normalizeExternalImageSource({ imageUrl: `data:image/png;base64,${base64}` }),
            err => {
                assert.equal(err.code, 'menu_image_source_invalid');
                assert.equal(err.status, 400);
                assert.equal(err.message.includes(base64), false);
                return true;
            }
        );

        assert.throws(
            () => normalizeExternalImageSource({ imageUrl: `https://example.test/${'a'.repeat(MAX_EXTERNAL_IMAGE_URL_LENGTH)}.png` }),
            err => err.code === 'menu_image_url_too_long' && err.status === 400
        );

        assert.throws(
            () => normalizeExternalImageSource({ imageUrl: 'https://example.test/image.svg' }),
            err => err.code === 'menu_image_source_invalid' && err.status === 400
        );

        assert.throws(
            () => normalizeExternalImageSource({ imageBase64: `data:image/gif;base64,${base64}` }),
            err => err.code === 'menu_image_source_invalid' && err.status === 400
        );

        assert.throws(
            () => normalizeExternalImageSource({ imageBase64: 'A'.repeat(MAX_EXTERNAL_IMAGE_BASE64_LENGTH + 1) }),
            err => {
                assert.equal(err.code, 'menu_image_source_too_large');
                assert.equal(err.status, 413);
                assert.equal(err.message.includes('AAAA'), false);
                return true;
            }
        );
    });

    it('returns a controlled upload failure when an external image URL cannot be stored', async () => {
        const server = await startImageServer(Buffer.from('nope'), { statusCode: 500 });
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-menu-image-drafts-failed-url-'));
        tempDirs.push(tempDir);
        try {
            await assert.rejects(
                () => createExternalMenuImageDraft({
                    product: { id: 'dish-3', code: 'MENU-FAIL', name: 'Failing dish' },
                    payload: {
                        imageUrl: server.url,
                        prompt: 'Hermes prompt',
                        source: 'hermes'
                    },
                    uploadOptions: { localDir: tempDir, allowPrivateNetwork: true }
                }),
                err => {
                    assert.equal(err.code, 'menu_image_upload_failed');
                    assert.equal(err.status, 502);
                    assert.equal(err.message.includes(server.url), false);
                    return true;
                }
            );
        } finally {
            await server.close();
        }
    });

    it('does not write files when remote image MIME or size validation fails', async () => {
        const textServer = await startImageServer(Buffer.from('not-image'), { contentType: 'text/plain' });
        const largeServer = await startImageServer(Buffer.from('too-large-png'), { contentType: 'image/png' });
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-menu-image-drafts-invalid-remote-'));
        tempDirs.push(tempDir);
        try {
            await assert.rejects(
                () => createExternalMenuImageDraft({
                    product: { id: 'dish-4', code: 'MENU-MIME', name: 'Wrong MIME dish' },
                    payload: {
                        imageUrl: textServer.url,
                        prompt: 'Hermes prompt',
                        source: 'hermes'
                    },
                    uploadOptions: { localDir: tempDir, allowPrivateNetwork: true }
                }),
                err => err.code === 'menu_image_upload_failed' && err.status === 502
            );
            await assert.rejects(
                () => createExternalMenuImageDraft({
                    product: { id: 'dish-5', code: 'MENU-SIZE', name: 'Large image dish' },
                    payload: {
                        imageUrl: largeServer.url,
                        prompt: 'Hermes prompt',
                        source: 'hermes'
                    },
                    uploadOptions: { localDir: tempDir, allowPrivateNetwork: true, maxBytes: 4 }
                }),
                err => err.code === 'menu_image_upload_failed' && err.status === 502
            );

            assert.deepEqual(await fsp.readdir(tempDir), []);
        } finally {
            await textServer.close();
            await largeServer.close();
        }
    });

    it('persists only ai_card_draft and leaves icon_url out of the update', async () => {
        const calls = [];
        const fakeDb = {
            async query(sql, params) {
                calls.push({ sql, params });
                return {
                    rows: [{
                        id: 'dish-1',
                        business_context: 'event_genix',
                        ai_card_draft: JSON.parse(params[0]),
                        icon_url: '/uploads/catalog-images/items/current.png'
                    }]
                };
            }
        };
        const draft = {
            imageStudio: {
                status: 'ready',
                imageUrl: '/uploads/catalog-images/items/draft.png'
            }
        };

        const row = await persistMenuImageDraft(fakeDb, {
            productId: 'dish-1',
            businessContext: 'event_genix',
            username: 'hermes.actor',
            draft
        });

        assert.equal(row.ai_card_draft.imageStudio.status, 'ready');
        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, /SET ai_card_draft = \$1::jsonb/);
        assert.doesNotMatch(calls[0].sql, /icon_url/);
        assert.deepEqual(calls[0].params.slice(1, 4), ['hermes.actor', 'dish-1', 'event_genix']);
    });
});
