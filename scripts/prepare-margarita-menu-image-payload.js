#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_IMAGE_PATH = path.join(os.tmpdir(), 'menu-menu-031-live-after.jpg');
const DEFAULT_PRODUCT_ID = 'menu_2026_031_item';
const DEFAULT_PRODUCT_CODE = 'MENU-031';
const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const DEFAULT_SIZE = '1536x1024';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const DEFAULT_PROMPT = [
    'Realistic menu catalog photo of pizza Margherita.',
    'Keep the whole round pizza visible, appetizing, no text, no logo, no watermark.',
    'Use a clean CRM-friendly background and natural light for a compact booking menu card.'
].join(' ');

function parseArgs(argv) {
    const args = {
        image: DEFAULT_IMAGE_PATH,
        out: null,
        stdout: false,
        baseUrl: '',
        productId: DEFAULT_PRODUCT_ID,
        businessContext: DEFAULT_BUSINESS_CONTEXT
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--image') {
            args.image = requireValue(argv, ++i, arg);
        } else if (arg === '--out') {
            args.out = requireValue(argv, ++i, arg);
        } else if (arg === '--stdout') {
            args.stdout = true;
        } else if (arg === '--base-url') {
            args.baseUrl = requireValue(argv, ++i, arg).replace(/\/+$/, '');
        } else if (arg === '--product-id') {
            args.productId = requireValue(argv, ++i, arg);
        } else if (arg === '--business-context') {
            args.businessContext = requireValue(argv, ++i, arg);
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function requireValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

function printHelp() {
    console.log(`Usage:
  node scripts/prepare-margarita-menu-image-payload.js [options]

Options:
  --image <path>             Source JPG. Default: ${DEFAULT_IMAGE_PATH}
  --out <path>               Write external-draft JSON payload to a file.
  --stdout                   Print external-draft JSON payload to stdout.
  --base-url <url>           Print ready endpoint examples for this CRM base URL.
  --product-id <id>          Product id. Default: ${DEFAULT_PRODUCT_ID}
  --business-context <key>   Business context. Default: ${DEFAULT_BUSINESS_CONTEXT}

The script validates the local image and prepares a payload for the existing
/api/products/:id/menu-image/external-draft endpoint. It does not call the API
and does not apply the draft.`);
}

function detectImage(buffer, sourcePath) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
        return {
            mimeType: 'image/jpeg',
            extension: 'jpg',
            ...readJpegDimensions(buffer)
        };
    }
    if (ext === '.png') {
        return {
            mimeType: 'image/png',
            extension: 'png',
            ...readPngDimensions(buffer)
        };
    }
    if (ext === '.webp') {
        return {
            mimeType: 'image/webp',
            extension: 'webp',
            ...readWebpDimensions(buffer)
        };
    }
    throw new Error(`Unsupported image extension: ${ext || '(none)'}`);
}

function readPngDimensions(buffer) {
    const signature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
        throw new Error('Invalid PNG image');
    }
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
    };
}

function readWebpDimensions(buffer) {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        throw new Error('Invalid WEBP image');
    }
    const type = buffer.toString('ascii', 12, 16);
    if (type === 'VP8X') {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3)
        };
    }
    if (type === 'VP8 ') {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff
        };
    }
    if (type === 'VP8L') {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        return {
            width: 1 + (((b1 & 0x3f) << 8) | b0),
            height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
        };
    }
    throw new Error(`Unsupported WEBP chunk: ${type}`);
}

function readJpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        throw new Error('Invalid JPEG image');
    }

    let offset = 2;
    while (offset + 4 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        while (buffer[offset] === 0xff) offset += 1;
        const marker = buffer[offset];
        offset += 1;

        if (marker === 0xd8 || marker === 0x01) continue;
        if (marker === 0xd9 || marker === 0xda) break;
        if (offset + 2 > buffer.length) break;

        const length = buffer.readUInt16BE(offset);
        if (length < 2 || offset + length > buffer.length) {
            throw new Error('Invalid JPEG segment length');
        }

        if (isSofMarker(marker)) {
            if (length < 7) throw new Error('Invalid JPEG SOF segment');
            return {
                height: buffer.readUInt16BE(offset + 3),
                width: buffer.readUInt16BE(offset + 5)
            };
        }

        offset += length;
    }

    throw new Error('JPEG dimensions were not found');
}

function isSofMarker(marker) {
    return [
        0xc0, 0xc1, 0xc2, 0xc3,
        0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf
    ].includes(marker);
}

function buildPayload(buffer, imageInfo, args) {
    return {
        businessContext: args.businessContext,
        imageBase64: buffer.toString('base64'),
        mimeType: imageInfo.mimeType,
        prompt: DEFAULT_PROMPT,
        provider: 'hermes',
        model: 'hermes-external',
        size: DEFAULT_SIZE,
        style: 'catalog',
        source: 'hermes'
    };
}

function printSummary(args, imageInfo, payloadPath) {
    const externalDraftPath = `/api/products/${encodeURIComponent(args.productId)}/menu-image/external-draft`;
    const applyPath = `/api/products/${encodeURIComponent(args.productId)}/menu-image/apply`;
    const query = `businessContext=${encodeURIComponent(args.businessContext)}`;

    const lines = [
        'Prepared Margarita menu image payload.',
        `Product: ${args.productId} (${DEFAULT_PRODUCT_CODE})`,
        `Business context: ${args.businessContext}`,
        `Image: ${args.image}`,
        `Dimensions: ${imageInfo.width}x${imageInfo.height}`,
        `MIME: ${imageInfo.mimeType}`,
        `Payload file: ${payloadPath || '(not written)'}`
    ];

    if (args.baseUrl) {
        lines.push('');
        lines.push('Use the existing CRM flow with an authenticated creator/director/admin/manager session:');
        lines.push(`POST ${args.baseUrl}${externalDraftPath}?${query}`);
        lines.push(`POST ${args.baseUrl}${applyPath}?${query}`);
        if (payloadPath) {
            lines.push('');
            lines.push('Example request shape:');
            lines.push(`curl -X POST "${args.baseUrl}${externalDraftPath}?${query}" -H "Content-Type: application/json" -H "Authorization: Bearer <token>" --data-binary "@${payloadPath}"`);
            lines.push(`curl -X POST "${args.baseUrl}${applyPath}?${query}" -H "Authorization: Bearer <token>"`);
        }
    } else {
        lines.push('');
        lines.push('Endpoint paths:');
        lines.push(`POST ${externalDraftPath}?${query}`);
        lines.push(`POST ${applyPath}?${query}`);
    }

    console.error(lines.join('\n'));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const imagePath = path.resolve(args.image);
    const stat = await fsp.stat(imagePath).catch(() => null);
    if (!stat || !stat.isFile()) {
        throw new Error(`Image file does not exist: ${imagePath}`);
    }
    if (stat.size > MAX_IMAGE_BYTES) {
        throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes: ${stat.size}`);
    }

    const buffer = await fsp.readFile(imagePath);
    const imageInfo = detectImage(buffer, imagePath);
    if (`${imageInfo.width}x${imageInfo.height}` !== DEFAULT_SIZE) {
        throw new Error(`Expected ${DEFAULT_SIZE}, got ${imageInfo.width}x${imageInfo.height}`);
    }

    const payload = buildPayload(buffer, imageInfo, args);
    let payloadPath = null;

    if (args.out) {
        payloadPath = path.resolve(args.out);
        await fsp.mkdir(path.dirname(payloadPath), { recursive: true });
        await fsp.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
    }

    if (args.stdout) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }

    if (!args.stdout) {
        printSummary({ ...args, image: imagePath }, imageInfo, payloadPath);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`ERROR: ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_IMAGE_PATH,
    DEFAULT_PRODUCT_ID,
    DEFAULT_PRODUCT_CODE,
    DEFAULT_BUSINESS_CONTEXT,
    DEFAULT_SIZE,
    detectImage,
    buildPayload
};
