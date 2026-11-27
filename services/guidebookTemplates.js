'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const images = path.join(__dirname, '..', 'images');
const templateDirectory = path.join(images, 'brand', 'guidebook', 'templates');
const templatePhotos = {
    'event-genix-cover-template.svg': 'event-card-workshop.png',
    'event-genix-post-template.svg': 'event-card-family-event.png',
    'event-genix-stories-template.svg': 'event-card-private-party.png'
};

function embedImage(svg, reference, image) {
    const href = `href="${reference}"`;
    if (!svg.includes(href)) throw new Error(`Missing guidebook template image: ${reference}`);
    return svg.replace(href, () => `href="data:image/png;base64,${image.toString('base64')}"`);
}

async function prepareTemplate(directory, name, photo) {
    const [svg, photoBytes, logoBytes] = await Promise.all([
        fs.promises.readFile(path.join(templateDirectory, name), 'utf8'),
        fs.promises.readFile(path.join(images, 'event-cards', photo)),
        fs.promises.readFile(path.join(images, 'brand', 'event-genix-logo.png'))
    ]);
    const withPhoto = embedImage(svg, '../../../event-cards/' + photo, photoBytes);
    const result = embedImage(withPhoto, '../../event-genix-logo.png', logoBytes);
    const output = path.join(directory, name);
    await fs.promises.writeFile(output, result);
    // The validator includes the canonical image bytes as well as the SVG markup.
    return { output, etag: `W/"${createHash('sha256').update(result).digest('hex')}"` };
}

function mountGuidebookTemplates(app) {
    let directory;
    for (const [name, photo] of Object.entries(templatePhotos)) {
        let ready;
        app.get('/images/brand/guidebook/templates/' + name, async (_req, res, next) => {
            try {
                if (!directory) {
                    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-guidebook-'));
                    process.once('exit', () => {
                        try {
                            for (const file of Object.keys(templatePhotos)) {
                                fs.rmSync(path.join(directory, file), { force: true });
                            }
                            fs.rmdirSync(directory);
                        } catch {
                            // The OS temp directory also owns cleanup after abrupt shutdown.
                        }
                    });
                }
                // Concurrent reads share generation; publish only a completed file.
                if (!ready) ready = prepareTemplate(directory, name, photo).catch(error => {
                    ready = null;
                    throw error;
                });
                const { output, etag } = await ready;
                res.set('ETag', etag).sendFile(output);
            } catch (error) {
                next(error);
            }
        });
    }
}

module.exports = { mountGuidebookTemplates };
