/**
 * services/audioStorage.js — Upload audio to Supabase Storage
 * v39.8.0: TTS + music files stored permanently in Supabase
 */
const https = require('https');
const http = require('http');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');

const log = createLogger('AudioStorage');
const BUCKET = 'audio-library';

const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};

function transliterate(text) {
    return (text || '').toLowerCase().split('').map(c => _tr[c] || c).join('');
}

function makeAudioFilename(category, name, ext = 'mp3') {
    const slug = transliterate(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const safeCat = (category || 'general').replace(/[^a-z0-9-]+/gi, '');
    return `${safeCat}-${slug}-${Date.now()}.${ext}`;
}

async function uploadAudioFromUrl(sourceUrl, filename) {
    const supabase = getSupabase();
    if (!supabase) {
        log.warn('Supabase not configured — keeping original URL');
        return null;
    }
    try {
        const buffer = await _download(sourceUrl);
        if (!buffer || buffer.length === 0) { log.error('Empty audio download'); return null; }
        log.info(`Downloaded audio: ${Math.round(buffer.length / 1024)}KB`);

        const path = `sounds/${filename}`;
        const ext = filename.split('.').pop();
        const contentTypes = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
        const contentType = contentTypes[ext] || 'audio/mpeg';

        const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
        if (error) {
            if (error.message?.includes('not found') || error.statusCode === 404) {
                await supabase.storage.createBucket(BUCKET, { public: true });
                const retry = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
                if (retry.error) { log.error('Retry upload failed:', retry.error.message); return null; }
            } else { log.error('Upload error:', error.message); return null; }
        }

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = urlData?.publicUrl;
        log.info(`Audio uploaded: ${filename} → ${publicUrl}`);
        return publicUrl;
    } catch (err) { log.error('uploadAudioFromUrl error:', err.message); return null; }
}

async function uploadAudioBuffer(buffer, filename) {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
        const path = `sounds/${filename}`;
        const ext = filename.split('.').pop();
        const contentTypes = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };
        const contentType = contentTypes[ext] || 'audio/mpeg';

        const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
        if (error) {
            if (error.message?.includes('not found') || error.statusCode === 404) {
                await supabase.storage.createBucket(BUCKET, { public: true });
                const retry = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
                if (retry.error) return null;
            } else return null;
        }
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        return urlData?.publicUrl || null;
    } catch { return null; }
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

module.exports = { uploadAudioFromUrl, uploadAudioBuffer, makeAudioFilename, transliterate };
