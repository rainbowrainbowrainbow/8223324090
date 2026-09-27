'use strict';

const assert = require('node:assert/strict');

// The decoder is a declared dev dependency. A missing installation must fail the gate.
const decoderPath = require.resolve('jsqr');

async function installQrDecoder(page) {
    await page.addScriptTag({ path: decoderPath });
    assert.equal(await page.evaluate(() => typeof window.jsQR), 'function',
        'QR decoder must load in the browser');
}

async function decodeQrFromPng(page, pngDataUrl) {
    return page.evaluate(async source => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR(pixels.data, pixels.width, pixels.height);
        return { width: canvas.width, height: canvas.height, url: result?.data || null };
    }, pngDataUrl);
}

module.exports = { installQrDecoder, decodeQrFromPng };
