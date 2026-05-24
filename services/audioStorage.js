/**
 * services/audioStorage.js — Store audio on the CRM upload surface.
 * v0.63.18: Remote storage removed; audio is stored under /uploads/sounds.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('AudioStorage');
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'sounds');
const PUBLIC_PREFIX = '/uploads/sounds';
const DEFAULT_FOLDER = 'sounds';
const AUDIO_CONTENT_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    webm: 'audio/webm'
};

const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};

function transliterate(text) {
    return (text || '').toLowerCase().split('').map(c => _tr[c] || c).join('');
}

function makeAudioFilename(category, name, ext = 'mp3') {
    const slug = transliterate(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const safeCat = (category || 'general').replace(/[^a-z0-9-]+/gi, '');
    return `${safeCat}-${slug}-${Date.now()}.${ext}`;
}

function _contentTypeFor(filename, fallback) {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    return fallback || AUDIO_CONTENT_TYPES[ext] || 'audio/mpeg';
}

function _safeFolder(folder) {
    return (folder || DEFAULT_FOLDER)
        .split('/')
        .map(part => part.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, ''))
        .filter(Boolean)
        .join('/') || DEFAULT_FOLDER;
}

function _safeFilename(filename) {
    const safe = (filename || makeAudioFilename('general', 'audio'))
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '');
    return safe || makeAudioFilename('general', 'audio');
}

async function _uploadAudioBufferToStorage(buffer, filename, options = {}) {
    if (!buffer || buffer.length === 0) {
        log.error('Empty audio buffer');
        return null;
    }

    const safeFilename = _safeFilename(filename);
    const folder = _safeFolder(options.folder);
    const storagePath = `${folder}/${safeFilename}`;
    const contentType = _contentTypeFor(safeFilename, options.contentType);

    try {
        const localRoot = options.localDir || DEFAULT_LOCAL_DIR;
        const localDir = path.join(localRoot, folder);
        await fsp.mkdir(localDir, { recursive: true });
        const fullPath = path.join(localDir, safeFilename);
        if (options.upsert === false && fs.existsSync(fullPath)) {
            log.error(`Audio file already exists: ${fullPath}`);
            return null;
        }
        await fsp.writeFile(fullPath, buffer);

        const publicUrl = `${PUBLIC_PREFIX}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
        log.info(`Audio stored: ${safeFilename} → ${publicUrl}`);
        return {
            provider: 'local',
            bucket: null,
            path: storagePath,
            key: storagePath,
            publicUrl,
            filename: safeFilename,
            contentType,
            localPath: fullPath
        };
    } catch (err) {
        log.error('uploadAudioBufferToStorage error:', err.message);
        return null;
    }
}

async function uploadAudioFromUrl(sourceUrl, filename) {
    try {
        const buffer = await _download(sourceUrl);
        if (!buffer || buffer.length === 0) { log.error('Empty audio download'); return null; }
        log.info(`Downloaded audio: ${Math.round(buffer.length / 1024)}KB`);

        const uploaded = await _uploadAudioBufferToStorage(buffer, filename);
        return uploaded?.publicUrl || null;
    } catch (err) { log.error('uploadAudioFromUrl error:', err.message); return null; }
}

async function uploadAudioBuffer(buffer, filename) {
    const uploaded = await _uploadAudioBufferToStorage(buffer, filename);
    return uploaded?.publicUrl || null;
}

async function uploadAudioBufferWithMetadata(buffer, filename, options = {}) {
    return _uploadAudioBufferToStorage(buffer, filename, options);
}

async function removeAudioObject(storageKey) {
    if (!storageKey) return false;
    try {
        const relative = String(storageKey).replace(/^\/+/, '').replace(/^uploads\/sounds\//, '');
        const fullPath = path.join(DEFAULT_LOCAL_DIR, relative);
        if (!fullPath.startsWith(DEFAULT_LOCAL_DIR)) return false;
        if (!fs.existsSync(fullPath)) return false;
        await fsp.unlink(fullPath);
        return true;
    } catch (err) {
        log.warn(`Audio delete error for ${storageKey}: ${err.message}`);
        return false;
    }
}

function _download(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { timeout: 60000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return _download(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

module.exports = {
    uploadAudioFromUrl,
    uploadAudioBuffer,
    uploadAudioBufferWithMetadata,
    removeAudioObject,
    makeAudioFilename,
    transliterate
};
