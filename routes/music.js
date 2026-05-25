/**
 * routes/music.js — Music Center API v33.15.0
 * Announcements CRUD, real delivery, TTS, scheduling, playlists.
 */
const router = require('express').Router();
const { pool } = require('../db');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const { createLogger } = require('../utils/logger');
const { deliverAnnouncement } = require('../services/music-delivery');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { settingsCache } = require('../services/cache');
const {
    uploadAudioFromUrl,
    uploadAudioBufferWithMetadata,
    removeAudioObject,
    makeAudioFilename
} = require('../services/audioStorage');
const log = createLogger('Music');

const SOUND_TTS_SETTING_KEY = 'sound_tts_config';
const DEFAULT_SOUND_TTS_CONFIG = {
    enabled: true,
    provider: 'kie_ai',
    model: 'elevenlabs/text-to-speech-multilingual-v2',
    voice: 'Rachel',
    language: 'uk',
    timeoutMs: 30000,
    apiKey: ''
};
const SOUND_TTS_PROVIDERS = new Set(['kie_ai']);
const SOUND_TTS_VOICES = new Set(['Rachel', 'Adam', 'Bella', 'Antoni', 'Elli', 'Josh']);
const SOUND_TTS_LANGUAGES = new Set(['uk', 'en', 'pl', 'de', 'fr', 'es']);

// File upload for sound library
const uploadSound = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
        cb(null, /\.(mp3|wav|ogg|m4a|aac)$/i.test(path.extname(file.originalname)))
});

function _safeSoundExt(originalName) {
    const ext = path.extname(originalName || '').replace('.', '').toLowerCase();
    return ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext) ? ext : 'mp3';
}

function _soundBaseName(originalName) {
    return path.basename(originalName || 'sound', path.extname(originalName || ''));
}

function _writeLegacySoundFile(filename, buffer) {
    const dir = path.join(__dirname, '../uploads/sounds');
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, filename);
    fs.writeFileSync(localPath, buffer);
    return {
        provider: 'local',
        filename,
        filePath: `/uploads/sounds/${filename}`,
        localPath
    };
}

async function _cleanupStoredSound(stored) {
    try {
        if (!stored) return;
        if (stored.provider === 'local' && stored.storageKey) {
            await removeAudioObject(stored.storageKey);
        } else if (stored.provider === 'local' && stored.localPath && fs.existsSync(stored.localPath)) {
            fs.unlinkSync(stored.localPath);
        }
    } catch (err) {
        log.warn('Sound upload cleanup failed', err.message);
    }
}

function _safeJson(value, fallback = {}) {
    if (!value || typeof value !== 'string') return { ...fallback };
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : { ...fallback };
    } catch {
        return { ...fallback };
    }
}

function _maskSecret(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 8) return '••••';
    return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function _normalizeTtsConfig(input = {}, current = DEFAULT_SOUND_TTS_CONFIG) {
    const provider = String(input.provider || current.provider || DEFAULT_SOUND_TTS_CONFIG.provider).trim().toLowerCase();
    const model = String(input.model || current.model || DEFAULT_SOUND_TTS_CONFIG.model).trim().slice(0, 160) || DEFAULT_SOUND_TTS_CONFIG.model;
    const voice = String(input.voice || current.voice || DEFAULT_SOUND_TTS_CONFIG.voice).trim();
    const language = String(input.language || current.language || DEFAULT_SOUND_TTS_CONFIG.language).trim().toLowerCase();
    const timeoutMs = Math.max(5000, Math.min(Number(input.timeoutMs || current.timeoutMs || DEFAULT_SOUND_TTS_CONFIG.timeoutMs) || DEFAULT_SOUND_TTS_CONFIG.timeoutMs, 120000));
    const next = {
        enabled: input.enabled !== false,
        provider: SOUND_TTS_PROVIDERS.has(provider) ? provider : DEFAULT_SOUND_TTS_CONFIG.provider,
        model,
        voice: SOUND_TTS_VOICES.has(voice) ? voice : DEFAULT_SOUND_TTS_CONFIG.voice,
        language: SOUND_TTS_LANGUAGES.has(language) ? language : DEFAULT_SOUND_TTS_CONFIG.language,
        timeoutMs,
        apiKey: String(current.apiKey || '').trim()
    };
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.apiKey = input.apiKey.trim();
    if (input.clearApiKey === true) next.apiKey = '';
    return next;
}

async function _readSoundTtsConfig() {
    const cached = settingsCache.get(SOUND_TTS_SETTING_KEY);
    const raw = cached !== null
        ? cached
        : (await pool.query('SELECT value FROM settings WHERE key = $1', [SOUND_TTS_SETTING_KEY])).rows[0]?.value;
    if (cached === null) settingsCache.set(SOUND_TTS_SETTING_KEY, raw || null);
    return _normalizeTtsConfig(_safeJson(raw, DEFAULT_SOUND_TTS_CONFIG), DEFAULT_SOUND_TTS_CONFIG);
}

async function _writeSoundTtsConfig(input) {
    const current = await _readSoundTtsConfig();
    const next = _normalizeTtsConfig(input, current);
    await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [SOUND_TTS_SETTING_KEY, JSON.stringify(next)]
    );
    settingsCache.invalidate(SOUND_TTS_SETTING_KEY);
    return next;
}

function _runtimeSoundTtsConfig(stored) {
    const envKey = process.env.KIE_API_KEY || '';
    const apiKey = envKey || stored.apiKey || '';
    return {
        ...stored,
        apiKey,
        keySource: envKey ? 'env' : (stored.apiKey ? 'settings' : 'missing'),
        keyConfigured: Boolean(apiKey)
    };
}

function _publicSoundTtsConfig(config) {
    return {
        success: true,
        enabled: config.enabled !== false,
        provider: config.provider,
        model: config.model,
        voice: config.voice,
        language: config.language,
        timeoutMs: config.timeoutMs,
        keySource: config.keySource,
        keyConfigured: config.keyConfigured,
        apiKeyMasked: _maskSecret(config.apiKey)
    };
}

async function _getSoundTtsRuntimeConfig() {
    return _runtimeSoundTtsConfig(await _readSoundTtsConfig());
}

function _normalizeAnnouncementType(value) {
    const type = String(value || 'general').trim().toLowerCase();
    return ['general', 'safety', 'event', 'promo', 'info', 'schedule', 'birthday'].includes(type) ? type : 'general';
}

function _normalizeAnnouncementPriority(value) {
    if (Number.isFinite(Number(value))) return Math.max(0, Math.min(Number(value), 10));
    const key = String(value || 'normal').trim().toLowerCase();
    if (key === 'urgent') return 10;
    if (key === 'high') return 7;
    if (key === 'low') return 1;
    return 3;
}

function _announcementPayload(body = {}) {
    return {
        title: String(body.title || '').trim(),
        textContent: String(body.text_content ?? body.text ?? '').trim(),
        announcementType: _normalizeAnnouncementType(body.announcement_type || body.type),
        scheduleType: String(body.schedule_type || 'once').trim() || 'once',
        scheduledAt: body.scheduled_at || null,
        repeatCron: body.repeat_cron || null,
        durationSeconds: Math.max(5, Math.min(Number(body.duration_seconds || 30) || 30, 600)),
        priority: _normalizeAnnouncementPriority(body.priority),
        zoneId: body.zone_id || null
    };
}

function _postJson(hostname, requestPath, payload, headers = {}, timeoutMs = 30000) {
    const body = JSON.stringify(payload || {});
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname,
            path: requestPath,
            method: 'POST',
            timeout: timeoutMs,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                ...headers
            }
        }, resp => {
            let data = '';
            resp.on('data', chunk => { data += chunk; });
            resp.on('end', () => {
                let parsed;
                try { parsed = data ? JSON.parse(data) : {}; }
                catch { parsed = { raw: data }; }
                resolve({ ...parsed, httpStatus: resp.statusCode });
            });
        });
        req.on('timeout', () => req.destroy(new Error('TTS request timeout')));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function _createKieTtsTask(config, input = {}) {
    if (!config.enabled) {
        const err = new Error('TTS вимкнено в налаштуваннях');
        err.statusCode = 409;
        throw err;
    }
    if (!config.keyConfigured) {
        const err = new Error('TTS API key не налаштовано');
        err.statusCode = 501;
        throw err;
    }
    const text = String(input.text || '').trim().slice(0, 5000);
    if (!text) {
        const err = new Error('Потрібен текст для TTS');
        err.statusCode = 400;
        throw err;
    }
    return _postJson('api.kie.ai', '/api/v1/jobs/createTask', {
        model: input.model || config.model,
        input: {
            text,
            voice: input.voice || config.voice,
            language: input.language || config.language
        }
    }, { Authorization: `Bearer ${config.apiKey}` }, config.timeoutMs);
}

function _taskIdFromKieResponse(response = {}) {
    return response.data?.taskId || response.taskId || response.task_id || null;
}

function _audioUrlFromKieResponse(response = {}) {
    return response.url || response.data?.url || response.audioUrl || null;
}

// All music routes require authentication and sound-page-level access.
router.use(authenticateToken);
router.use(requireRole('manager', 'art_director'));

// ============================================
// Announcements — CRUD
// ============================================

router.get('/announcements', async (req, res) => {
    try {
        const { status, type, includeDeleted } = req.query;
        const conds = includeDeleted ? [] : ['deleted_at IS NULL'];
        const params = [];
        if (status) { params.push(status); conds.push(`status = $${params.length}`); }
        if (type)   { params.push(type);   conds.push(`announcement_type = $${params.length}`); }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const r = await pool.query(
            `SELECT * FROM announcements ${where} ORDER BY priority DESC, created_at DESC LIMIT 200`, params
        );
        res.json({ success: true, announcements: r.rows, total: r.rows.length });
    } catch (err) { log.error('List announcements', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/announcements', async (req, res) => {
    try {
        const payload = _announcementPayload(req.body);
        if (!payload.title || !payload.textContent) return res.status(400).json({ error: 'Назва і текст обов\'язкові' });
        const initStatus = payload.scheduledAt ? 'scheduled' : 'draft';
        const r = await pool.query(
            `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, zone_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [payload.title, payload.textContent, payload.announcementType, payload.scheduleType,
             payload.scheduledAt, payload.repeatCron, payload.durationSeconds, payload.priority,
             payload.zoneId, initStatus, req.user?.username || 'system']
        );
        res.json({ success: true, announcement: r.rows[0] });
    } catch (err) { log.error('Create announcement', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/announcements/:id', async (req, res) => {
    try {
        const payload = _announcementPayload(req.body);
        if (!payload.title || !payload.textContent) return res.status(400).json({ error: 'Назва і текст обов\'язкові' });
        const r = await pool.query(
            `UPDATE announcements SET title=$1, text_content=$2, announcement_type=$3, schedule_type=$4,
             scheduled_at=$5, repeat_cron=$6, duration_seconds=$7, priority=$8, status=$9, zone_id=$10, updated_at=NOW()
             WHERE id=$11 AND deleted_at IS NULL RETURNING *`,
            [payload.title, payload.textContent, payload.announcementType, payload.scheduleType,
             payload.scheduledAt, payload.repeatCron, payload.durationSeconds, payload.priority,
             req.body.status || 'draft', payload.zoneId, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, announcement: r.rows[0] });
    } catch (err) { log.error('Update announcement', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/announcements/:id', async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE announcements SET deleted_at=NOW(), status='archived' WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
            [req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) { log.error('Delete announcement', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/announcements/:id/restore', async (req, res) => {
    try {
        await pool.query('UPDATE announcements SET deleted_at=NULL, status=\'draft\' WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// PLAY — real delivery
// ============================================

router.post('/announcements/:id/play', async (req, res) => {
    try {
        const { zone_id } = req.body;
        const annRes = await pool.query('SELECT * FROM announcements WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
        if (!annRes.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        const ann = annRes.rows[0];

        const delivery = await deliverAnnouncement(ann, { triggeredBy: 'manual', zoneId: zone_id || ann.zone_id });

        await pool.query(
            `UPDATE announcements SET played_count=played_count+1, last_played_at=NOW(),
             last_delivery_status=$1, last_delivery_mode=$2, last_delivery_detail=$3, last_delivery_at=NOW()
             WHERE id=$4`,
            [delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail, ann.id]
        );

        await pool.query(
            `INSERT INTO music_log (action, announcement_id, delivery_status, delivery_mode, delivery_detail, triggered_by, details)
             VALUES ('play', $1, $2, $3, $4, 'manual', $5)`,
            [ann.id, delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail,
             JSON.stringify({ played_by: req.user?.username || 'system', zone_id })]
        );

        res.json({ success: delivery.success, delivery, announcement: { id: ann.id, title: ann.title } });
    } catch (err) { log.error('Play announcement', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/announcements/:id/play-in', async (req, res) => {
    try {
        const mins = parseInt(req.body.minutes, 10);
        if (!mins || mins < 1 || mins > 1440) return res.status(400).json({ error: 'minutes: 1-1440' });
        const scheduledAt = new Date(Date.now() + mins * 60000).toISOString();
        const r = await pool.query(
            `UPDATE announcements SET status='scheduled', scheduled_at=$1, updated_at=NOW()
             WHERE id=$2 AND deleted_at IS NULL RETURNING id, title`,
            [scheduledAt, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, scheduledAt, message: `Заплановано через ${mins} хв` });
    } catch (err) { log.error('Play-in', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// Playlists
// ============================================

router.get('/playlists', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM playlists ORDER BY category, name LIMIT 500');
        res.json({ success: true, playlists: r.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/playlists', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Назва обов\'язкова' });
        const r = await pool.query(
            `INSERT INTO playlists (name, description, category, tracks, schedule_start, schedule_end)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [name.trim(), description || null, category || 'background', JSON.stringify(tracks || []),
             schedule_start || null, schedule_end || null]
        );
        res.json({ success: true, playlist: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/playlists/:id', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end, is_active } = req.body;
        const r = await pool.query(
            `UPDATE playlists SET name=$1, description=$2, category=$3, tracks=$4,
             schedule_start=$5, schedule_end=$6, is_active=$7 WHERE id=$8 RETURNING *`,
            [name, description, category, JSON.stringify(tracks || []),
             schedule_start || null, schedule_end || null, is_active !== false, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, playlist: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/playlists/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM playlists WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// Now Playing + Overview + Stats
// ============================================

router.get('/now-playing', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ml.*, a.title, a.text_content, a.duration_seconds, a.announcement_type
             FROM music_log ml LEFT JOIN announcements a ON a.id = ml.announcement_id
             WHERE ml.action = 'play' AND ml.delivery_status = 'success'
             ORDER BY ml.created_at DESC LIMIT 1`
        );
        const scheduled = await pool.query(
            `SELECT id, title, announcement_type, scheduled_at, duration_seconds
             FROM announcements WHERE status='scheduled' AND scheduled_at > NOW() AND deleted_at IS NULL
             ORDER BY scheduled_at ASC LIMIT 5`
        );
        res.json({ success: true, lastPlayed: r.rows[0] || null, upcoming: scheduled.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/overview', async (req, res) => {
    try {
        const [ann, pl, today] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status='active' AND deleted_at IS NULL)::int AS active,
                COUNT(*) FILTER (WHERE status='draft' AND deleted_at IS NULL)::int AS draft,
                COUNT(*) FILTER (WHERE status='scheduled' AND deleted_at IS NULL)::int AS scheduled,
                COALESCE(SUM(played_count) FILTER (WHERE deleted_at IS NULL), 0)::int AS total_plays
             FROM announcements`),
            pool.query(`SELECT COUNT(*) FILTER (WHERE is_active)::int AS active, COUNT(*)::int AS total FROM playlists`),
            pool.query(`SELECT COUNT(*)::int AS plays_today FROM music_log WHERE action='play' AND created_at>CURRENT_DATE`)
        ]);
        res.json({ success: true, announcements: ann.rows[0], playlists: pl.rows[0], today: today.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/log', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '200'), 500);
        const conditions = [];
        const params = [];
        let idx = 1;

        if (req.query.action) {
            conditions.push(`ml.action = $${idx++}`);
            params.push(req.query.action);
        }
        if (req.query.from) {
            conditions.push(`ml.created_at >= $${idx++}::date`);
            params.push(req.query.from);
        }
        if (req.query.to) {
            conditions.push(`ml.created_at < ($${idx++}::date + INTERVAL '1 day')`);
            params.push(req.query.to);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        params.push(limit);

        const r = await pool.query(
            `SELECT ml.*, a.title AS announcement_title, a.announcement_type
             FROM music_log ml LEFT JOIN announcements a ON ml.announcement_id = a.id
             ${where}
             ORDER BY ml.created_at DESC LIMIT $${idx}`, params
        );
        res.json({ success: true, log: r.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// TTS Settings + Generation via Kie.ai
// ============================================

router.get('/tts-config', requireRole('creator', 'director', 'art_director'), async (req, res) => {
    try {
        res.json(_publicSoundTtsConfig(await _getSoundTtsRuntimeConfig()));
    } catch (err) {
        log.error('GET /tts-config error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/tts-config', requireRole('creator', 'director', 'art_director'), async (req, res) => {
    try {
        const stored = await _writeSoundTtsConfig(req.body || {});
        res.json(_publicSoundTtsConfig(_runtimeSoundTtsConfig(stored)));
    } catch (err) {
        log.error('PUT /tts-config error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/tts-config/test', requireRole('creator', 'director', 'art_director'), async (req, res) => {
    try {
        const config = await _getSoundTtsRuntimeConfig();
        if (!config.enabled) return res.status(409).json({ error: 'TTS вимкнено в налаштуваннях' });
        if (!config.keyConfigured) return res.status(501).json({ error: 'TTS API key не налаштовано' });
        res.json({
            ..._publicSoundTtsConfig(config),
            message: `TTS готовий: ${config.provider}, ${config.model}, ключ із ${config.keySource}.`
        });
    } catch (err) {
        log.error('POST /tts-config/test error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/announcements/:id/generate-tts', requireRole('admin', 'director', 'art_director'), async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const ann = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
        if (!ann.rows.length) return res.status(404).json({ error: 'Не знайдено' });
        const config = await _getSoundTtsRuntimeConfig();
        const kieRes = await _createKieTtsTask(config, {
            text: ann.rows[0].text_content,
            voice: req.body?.voice,
            language: req.body?.language
        });

        const taskId = _taskIdFromKieResponse(kieRes);
        const audioUrl = _audioUrlFromKieResponse(kieRes);
        if (!taskId && !audioUrl)
            return res.status(502).json({ error: 'TTS failed', detail: kieRes });

        if (audioUrl) {
            const filename = makeAudioFilename('announcement', ann.rows[0].title || `announcement-${id}`);
            const permanentUrl = await uploadAudioFromUrl(audioUrl, filename);
            const finalUrl = permanentUrl || audioUrl;
            await pool.query(
                'UPDATE announcements SET voice_url=$1, voice_provider=$2, tts_generated=true, tts_generating=false, updated_at=NOW() WHERE id=$3',
                [finalUrl, 'elevenlabs', id]
            );
            await pool.query(`INSERT INTO music_log (action, announcement_id, details) VALUES ('tts', $1, $2)`,
                [id, JSON.stringify({ provider: 'kie_ai', status: 'ready', voice: config.voice })]);
            return res.json({ success: true, voiceUrl: finalUrl, status: 'ready' });
        }
        await pool.query(
            'UPDATE announcements SET voice_provider=$1, tts_generated=false, tts_generating=true, updated_at=NOW() WHERE id=$2',
            ['elevenlabs', id]
        );
        await pool.query(`INSERT INTO music_log (action, announcement_id, details) VALUES ('tts', $1, $2)`,
            [id, JSON.stringify({ provider: 'kie_ai', status: 'generating', taskId })]);
        res.json({ success: true, taskId, status: 'generating' });
    } catch (err) {
        log.error('POST /generate-tts error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    }
});

router.post('/announcements/:id/apply-tts', requireRole('admin', 'director', 'art_director'), async (req, res) => {
    const id = parseInt(req.params.id);
    const { audioUrl } = req.body || {};
    if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' });
    try {
        const ann = await pool.query('SELECT id, title FROM announcements WHERE id=$1 AND deleted_at IS NULL', [id]);
        if (!ann.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        const filename = makeAudioFilename('announcement', ann.rows[0].title || `announcement-${id}`);
        const permanentUrl = await uploadAudioFromUrl(audioUrl, filename);
        const finalUrl = permanentUrl || audioUrl;
        const r = await pool.query(
            `UPDATE announcements
             SET voice_url=$1, voice_provider='elevenlabs', tts_generated=true, tts_generating=false, updated_at=NOW()
             WHERE id=$2 RETURNING *`,
            [finalUrl, id]
        );
        await pool.query(`INSERT INTO music_log (action, announcement_id, details) VALUES ('tts', $1, $2)`,
            [id, JSON.stringify({ provider: 'kie_ai', status: 'ready', source: 'async_apply' })]);
        res.json({ success: true, announcement: r.rows[0], voiceUrl: finalUrl });
    } catch (err) {
        log.error('POST /announcements/:id/apply-tts error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Sound Library CRUD (uses sounds table)
// ============================================

router.get('/library', async (req, res) => {
    try {
        const { category } = req.query;
        const q = category
            ? 'SELECT * FROM sounds WHERE category=$1 ORDER BY created_at DESC'
            : 'SELECT * FROM sounds ORDER BY created_at DESC LIMIT 500';
        const r = await pool.query(q, category ? [category] : []);
        res.json({ sounds: r.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/library/upload', uploadSound.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не обрано' });
    let stored = null;
    try {
        const category = req.body.category || 'general';
        const displayName = (req.body.name || req.file.originalname || 'Sound').trim();
        const filename = makeAudioFilename(category, displayName || _soundBaseName(req.file.originalname), _safeSoundExt(req.file.originalname));
        const remote = await uploadAudioBufferWithMetadata(req.file.buffer, filename, {
            contentType: req.file.mimetype,
            folder: 'sounds/manual'
        });

        if (remote) {
            stored = {
                provider: remote.provider || 'local',
                filename: remote.filename || filename,
                filePath: remote.publicUrl,
                publicUrl: remote.publicUrl,
                storageBucket: remote.bucket,
                storageKey: remote.path
            };
        } else {
            stored = _writeLegacySoundFile(filename, req.file.buffer);
        }

        const r = await pool.query(
            `INSERT INTO sounds (
                name, filename, file_path, url, category, file_size, uploaded_by,
                storage_provider, storage_bucket, storage_key, storage_url, storage_migrated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $8 IN ('local', 'external') THEN NOW() ELSE NULL END)
             RETURNING id`,
            [
                displayName,
                stored.filename,
                stored.filePath,
                stored.publicUrl || null,
                category,
                req.file.size,
                req.user?.username || null,
                stored.provider,
                stored.storageBucket || null,
                stored.storageKey || null,
                stored.publicUrl || null
            ]
        );
        res.json({
            ok: true,
            id: r.rows[0].id,
            filename: stored.filename,
            filePath: stored.filePath,
            storageProvider: stored.provider,
            storageKey: stored.storageKey || null
        });
    } catch (err) {
        await _cleanupStoredSound(stored);
        log.error('Upload sound error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/library/:id', requireRole('admin', 'director'), async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM sounds WHERE id=$1', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'Не знайдено' });
        const sound = r.rows[0];
        if (sound.storage_provider === 'local' && sound.storage_key) {
            await removeAudioObject(sound.storage_key);
        } else if (sound.filename && sound.file_path?.startsWith('/uploads/sounds/')) {
            const fp = path.join(__dirname, '../uploads/sounds', sound.filename);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        await pool.query('DELETE FROM sounds WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { log.error('Delete sound error', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// Sound Projects CRUD
// ============================================

router.get('/projects', async (req, res) => {
    try {
        const projects = await pool.query('SELECT * FROM sound_projects ORDER BY created_at DESC LIMIT 200');
        const result = [];
        for (const p of projects.rows) {
            const tracks = await pool.query(
                `SELECT s.* FROM sounds s JOIN sound_project_tracks t ON t.sound_id = s.id
                 WHERE t.project_id = $1 ORDER BY t.sort_order`, [p.id]);
            result.push({ ...p, tracks: tracks.rows });
        }
        res.json({ projects: result });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/projects', async (req, res) => {
    const { name, type = 'quest', description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Назва обов\'язкова' });
    try {
        const r = await pool.query(
            'INSERT INTO sound_projects (name, type, description) VALUES ($1,$2,$3) RETURNING *',
            [name.trim(), type, description || null]);
        res.json({ ok: true, project: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/projects/:id', requireRole('admin', 'director'), async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM sound_projects WHERE id=$1 RETURNING id', [req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================
// v39.8: TTS Creation (ElevenLabs via Kie.ai) + CRM upload storage
// ============================================

router.post('/library/generate-tts', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    const { text, name, category, voice, language } = req.body;
    if (!text) return res.status(400).json({ error: 'Потрібен text' });
    try {
        const config = await _getSoundTtsRuntimeConfig();
        const kieRes = await _createKieTtsTask(config, {
            text,
            voice,
            language
        });
        const taskId = _taskIdFromKieResponse(kieRes);
        if (taskId) {
            return res.json({ success: true, taskId, status: 'generating', name: name || `TTS: ${text.substring(0, 50)}`, category: category || 'effects' });
        }

        const audioUrl = _audioUrlFromKieResponse(kieRes);
        if (audioUrl) {
            const filename = makeAudioFilename(category || 'tts', name || 'voice');
            const permanentUrl = await uploadAudioFromUrl(audioUrl, filename);
            const finalUrl = permanentUrl || audioUrl;

            const r = await pool.query(
                `INSERT INTO sounds (name, filename, file_path, category, uploaded_by)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [name || `TTS: ${text.substring(0, 50)}`, filename, finalUrl, category || 'effects', req.user?.username]
            );
            await pool.query(`INSERT INTO music_log (action, details) VALUES ('tts', $1)`,
                [JSON.stringify({ sound_id: r.rows[0].id, text: text.substring(0, 200), voice, provider: 'elevenlabs' })]);

            return res.json({ success: true, id: r.rows[0].id, url: finalUrl, status: 'ready' });
        }
        res.status(502).json({ error: 'TTS не вдалось', detail: kieRes });
    } catch (err) {
        log.error('generate-tts error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    }
});

// v40: Music Generation — Suno not available via Kie.ai, use TTS for voice content
router.post('/library/generate-music', requireRole('admin', 'creator', 'director', 'art_director'), async (req, res) => {
    const { prompt, name, category, duration } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Потрібен prompt' });
    // Kie.ai only supports image (nano-banana-2) and TTS (elevenlabs) models
    // v40: Suno not available through Kie.ai — return clear message
    res.status(501).json({
        error: 'Генерація музики через Suno тимчасово недоступна. Kie.ai підтримує тільки TTS (голос). Використовуйте «Створити голос» або завантажте музику вручну.',
        suggestion: 'upload'
    });
});

// v39.8: Poll generation status + save to CRM uploads
router.get('/library/generate-status/:taskId', async (req, res) => {
    try {
        const config = await _getSoundTtsRuntimeConfig();
        if (!config.keyConfigured) return res.status(501).json({ error: 'TTS API key не налаштовано' });

        const kieRes = await new Promise((resolve, reject) => {
            require('https').get(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${req.params.taskId}`, {
                headers: { 'Authorization': `Bearer ${config.apiKey}` }
            }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); }).on('error', reject);
        });

        const data = kieRes.data || {};
        const state = data.state;
        let audioUrl = null;
        if (state === 'success') {
            const result = data.resultJson || data.result;
            if (typeof result === 'string') try { audioUrl = JSON.parse(result).resultUrls?.[0]; } catch { audioUrl = result; }
            else if (result?.resultUrls) audioUrl = result.resultUrls[0];
            else if (result?.url) audioUrl = result.url;
        }
        res.json({ success: true, state, done: state === 'success' && !!audioUrl, audioUrl, error: state === 'failed' ? 'Генерація не вдалась' : null });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// v39.8: Apply generated audio — save to CRM uploads + DB
router.post('/library/apply-generated', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    const { audioUrl, name, category, provider } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' });
    try {
        const filename = makeAudioFilename(category || 'music', name || 'generated');
        const permanentUrl = await uploadAudioFromUrl(audioUrl, filename);
        const finalUrl = permanentUrl || audioUrl;

        const r = await pool.query(
            `INSERT INTO sounds (name, filename, file_path, category, uploaded_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [name || 'AI Generated', filename, finalUrl, category || 'music', req.user?.username]
        );
        await pool.query(`INSERT INTO music_log (action, details) VALUES ('upload', $1)`,
            [JSON.stringify({ sound_id: r.rows[0].id, provider: provider || 'ai', source: audioUrl.substring(0, 100) })]);

        res.json({ success: true, id: r.rows[0].id, url: finalUrl });
    } catch (err) { log.error('apply-generated error', err); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
