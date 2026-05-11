/**
 * services/audioStorage.js — Upload audio to Supabase Storage
 * v39.8.0: TTS + music files stored permanently in Supabase
 */
const https = require('https');
const http = require('http');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');

const log = createLogger('AudioStorage');
const BUCKET = process.env.SUPABASE_AUDIO_BUCKET || 'audio-library';
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

function _isMissingBucketError(error) {
    const msg = String(error?.message || '').toLowerCase();
    return error?.statusCode === 404 || msg.includes('not found') || msg.includes('bucket');
}

async function _uploadAudioBufferToStorage(buffer, filename, options = {}) {
    const supabase = getSupabase();
    if (!supabase) {
        log.warn('Supabase not configured — keeping local/original audio path');
        return null;
    }
    if (!buffer || buffer.length === 0) {
        log.error('Empty audio buffer');
        return null;
    }

    const safeFilename = _safeFilename(filename);
    const storagePath = `${_safeFolder(options.folder)}/${safeFilename}`;
    const contentType = _contentTypeFor(safeFilename, options.contentType);
    const uploadOptions = {
        contentType,
        upsert: options.upsert !== false
    };

    try {
        const bucket = options.bucket || BUCKET;
        const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, uploadOptions);
        if (error) {
            if (_isMissingBucketError(error)) {
                await supabase.storage.createBucket(bucket, { public: true });
                const retry = await supabase.storage.from(bucket).upload(storagePath, buffer, uploadOptions);
                if (retry.error) {
                    log.error('Retry upload failed:', retry.error.message);
                    return null;
                }
            } else {
                log.error('Upload error:', error.message);
                return null;
            }
        }

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
            log.error('Supabase upload returned no public URL');
            return null;
        }

        log.info(`Audio uploaded: ${safeFilename} → ${publicUrl}`);
        return {
            provider: 'supabase',
            bucket,
            path: storagePath,
            key: storagePath,
            publicUrl,
            filename: safeFilename,
            contentType
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

async function removeAudioObject(storageKey, bucket = BUCKET) {
    if (!storageKey) return false;
    const supabase = getSupabase();
    if (!supabase) return false;
    try {
        const { error } = await supabase.storage.from(bucket || BUCKET).remove([storageKey]);
        if (error) {
            log.warn(`Supabase audio delete failed for ${storageKey}: ${error.message}`);
            return false;
        }
        return true;
    } catch (err) {
        log.warn(`Supabase audio delete error for ${storageKey}: ${err.message}`);
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
