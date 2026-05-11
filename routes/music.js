/**
 * routes/music.js — Music Center API v33.15.0
 * Announcements CRUD, real delivery, TTS, scheduling, playlists.
 */
const router = require('express').Router();
const { pool } = require('../db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createLogger } = require('../utils/logger');
const { deliverAnnouncement } = require('../services/music-delivery');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
    uploadAudioFromUrl,
    uploadAudioBufferWithMetadata,
    removeAudioObject,
    makeAudioFilename
} = require('../services/audioStorage');
const log = createLogger('Music');

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
        if (stored.provider === 'supabase' && stored.storageKey) {
            await removeAudioObject(stored.storageKey, stored.storageBucket);
        } else if (stored.provider === 'local' && stored.localPath && fs.existsSync(stored.localPath)) {
            fs.unlinkSync(stored.localPath);
        }
    } catch (err) {
        log.warn('Sound upload cleanup failed', err.message);
    }
}

// All music routes require authentication
router.use(authenticateToken);

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
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, zone_id } = req.body;
        if (!title?.trim() || !text_content?.trim()) return res.status(400).json({ error: 'Назва і текст обов\'язкові' });
        const initStatus = scheduled_at ? 'scheduled' : 'draft';
        const r = await pool.query(
            `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, zone_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [title.trim(), text_content.trim(), announcement_type || 'promo', schedule_type || 'once',
             scheduled_at || null, repeat_cron || null, duration_seconds || 30, priority || 0,
             zone_id || null, initStatus, req.user?.username || 'system']
        );
        res.json({ success: true, announcement: r.rows[0] });
    } catch (err) { log.error('Create announcement', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/announcements/:id', async (req, res) => {
    try {
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, status, zone_id } = req.body;
        const r = await pool.query(
            `UPDATE announcements SET title=$1, text_content=$2, announcement_type=$3, schedule_type=$4,
             scheduled_at=$5, repeat_cron=$6, duration_seconds=$7, priority=$8, status=$9, zone_id=$10, updated_at=NOW()
             WHERE id=$11 AND deleted_at IS NULL RETURNING *`,
            [title, text_content, announcement_type, schedule_type, scheduled_at || null, repeat_cron || null,
             duration_seconds || 30, priority || 0, status || 'draft', zone_id || null, req.params.id]
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
// TTS Generation via Kie.ai
// ============================================

router.post('/announcements/:id/generate-tts', requireRole('admin', 'director', 'art_director'), async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const ann = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
        if (!ann.rows.length) return res.status(404).json({ error: 'Не знайдено' });
        const KIE_KEY = process.env.KIE_API_KEY;
        if (!KIE_KEY) return res.status(501).json({ error: 'KIE_API_KEY не налаштовано' });

        const payload = JSON.stringify({
            model: 'elevenlabs/text-to-speech-multilingual-v2',
            input: {
                text: ann.rows[0].text_content,
                voice: 'Rachel', language: 'uk'
            }
        });
        const kieRes = await new Promise((resolve, reject) => {
            const r = require('https').request({
                hostname: 'api.kie.ai', path: '/api/v1/jobs/createTask', method: 'POST',
                headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); } }); });
            r.on('error', reject); r.write(payload); r.end();
        });

        const taskId = kieRes.data?.taskId || kieRes.taskId;
        if (!taskId && !kieRes.url && !kieRes.data?.url)
            return res.status(502).json({ error: 'TTS failed', detail: kieRes });

        if (kieRes.url) {
            await pool.query(
                'UPDATE announcements SET voice_url=$1, voice_provider=$2, tts_generated=true WHERE id=$3',
                [kieRes.url, 'elevenlabs', id]
            );
            return res.json({ ok: true, voiceUrl: kieRes.url, status: 'ready' });
        }
        res.json({ ok: true, taskId: kieRes.taskId, status: 'generating' });
    } catch (err) {
        log.error('POST /generate-tts error', err);
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
                provider: 'supabase',
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
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $8 = 'supabase' THEN NOW() ELSE NULL END)
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
        if (sound.storage_provider === 'supabase' && sound.storage_key) {
            await removeAudioObject(sound.storage_key, sound.storage_bucket);
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
// v39.8: TTS Creation (ElevenLabs via Kie.ai) + Supabase storage
// ============================================

router.post('/library/generate-tts', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    const { text, name, category, voice, language } = req.body;
    if (!text) return res.status(400).json({ error: 'Потрібен text' });
    try {
        const KIE_KEY = process.env.KIE_API_KEY;
        if (!KIE_KEY) return res.status(501).json({ error: 'KIE_API_KEY не налаштовано' });

        const payload = JSON.stringify({
            model: 'elevenlabs/text-to-speech-multilingual-v2',
            input: {
                text: text.substring(0, 5000),
                voice: voice || 'Rachel',
                language: language || 'uk'
            }
        });

        const kieRes = await new Promise((resolve, reject) => {
            const r = require('https').request({
                hostname: 'api.kie.ai', path: '/api/v1/jobs/createTask', method: 'POST',
                headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } }); });
            r.on('error', reject); r.write(payload); r.end();
        });

        const taskId = kieRes.data?.taskId || kieRes.taskId;
        if (taskId) {
            return res.json({ success: true, taskId, status: 'generating', name: name || `TTS: ${text.substring(0, 50)}`, category: category || 'effects' });
        }

        if (kieRes.url || kieRes.data?.url) {
            const audioUrl = kieRes.url || kieRes.data.url;
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
        if (kieRes.taskId || kieRes.data?.taskId) {
            return res.json({ success: true, taskId: kieRes.taskId || kieRes.data.taskId, status: 'generating' });
        }
        res.status(502).json({ error: 'TTS не вдалось', detail: kieRes });
    } catch (err) {
        log.error('generate-tts error', err);
        res.status(500).json({ error: 'Internal server error' });
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

// v39.8: Poll generation status + save to Supabase
router.get('/library/generate-status/:taskId', async (req, res) => {
    try {
        const KIE_KEY = process.env.KIE_API_KEY;
        if (!KIE_KEY) return res.status(501).json({ error: 'KIE_API_KEY not configured' });

        const kieRes = await new Promise((resolve, reject) => {
            require('https').get(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${req.params.taskId}`, {
                headers: { 'Authorization': `Bearer ${KIE_KEY}` }
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

// v39.8: Apply generated audio — save to Supabase + DB
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
