const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// v5.13: JWT_SECRET — warn if not set in env (random value resets on restart = all sessions lost)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
    console.warn('[Security] JWT_SECRET not set in environment! Sessions will be lost on restart. Set JWT_SECRET env variable.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// v3.9: Webhook secret для верифікації Telegram запитів
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

// Middleware
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origin.includes(process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost')) }));
app.use(express.json());

// Cache control: prevent browser from caching HTML/JS/CSS
app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});
app.use(express.static(path.join(__dirname)));

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ==========================================
// TELEGRAM BOT
// ==========================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8068946683:AAGdGn4cwNyRotIY1zzkuad0rHfB-ud-2Fg';
const TELEGRAM_DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID || '-1001805304620';

function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        };
        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(result)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (body) req.write(data);
        req.end();
    });
}

async function sendTelegramMessage(chatId, text, options = {}) {
    const retries = options.retries || 3;
    // v5.17: Auto-include thread ID for forum topics
    const threadId = await getConfiguredThreadId();
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const payload = {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_notification: options.silent !== false // default silent, pass silent:false for sound
            };
            if (threadId) payload.message_thread_id = threadId;
            const result = await telegramRequest('sendMessage', payload);
            if (result && result.ok) {
                console.log(`[Telegram] Message sent to ${chatId}${threadId ? ' thread=' + threadId : ''} (attempt ${attempt})`);
            } else {
                console.warn(`[Telegram] API returned error on attempt ${attempt}:`, JSON.stringify(result));
            }
            return result;
        } catch (err) {
            console.error(`[Telegram] Send error (attempt ${attempt}/${retries}):`, err.message);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    console.error(`[Telegram] All ${retries} attempts failed for chat ${chatId}`);
    return null;
}

async function getConfiguredChatId() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            return result.rows[0].value;
        }
    } catch (e) { /* use default */ }
    return TELEGRAM_DEFAULT_CHAT_ID;
}

// v5.17: Get configured thread/topic ID for forum groups
async function getConfiguredThreadId() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'telegram_thread_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            return parseInt(result.rows[0].value) || null;
        }
    } catch (e) { /* no thread */ }
    return null;
}

let webhookSet = false;

// Ensure at least 2 default lines exist in DB for any date (B1: hard rule — every normal day has >= 2 lines)
async function ensureDefaultLines(date) {
    const existing = await pool.query('SELECT COUNT(*) FROM lines_by_date WHERE date = $1', [date]);
    const count = parseInt(existing.rows[0].count);
    if (count < 2) {
        const defaults = [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
        for (const line of defaults) {
            await pool.query(
                'INSERT INTO lines_by_date (date, line_id, name, color) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [date, line.id, line.name, line.color]
            );
        }
    }
}

async function ensureWebhook(appUrl) {
    if (webhookSet) return;
    try {
        const webhookUrl = `${appUrl}/api/telegram/webhook`;
        const result = await telegramRequest('setWebhook', { url: webhookUrl, secret_token: WEBHOOK_SECRET });
        if (result && result.ok) {
            webhookSet = true;
            console.log('Telegram webhook set:', webhookUrl);
        }
    } catch (err) {
        console.error('Webhook setup error:', err);
    }
}

async function getTelegramChatId() {
    const chatMap = new Map();

    // 1. Check DB for previously known chats (from webhook)
    try {
        const dbResult = await pool.query('SELECT chat_id, title, type FROM telegram_known_chats ORDER BY updated_at DESC');
        for (const row of dbResult.rows) {
            chatMap.set(String(row.chat_id), { id: row.chat_id, title: row.title, type: row.type });
        }
    } catch (e) {
        console.error('[Telegram] DB known chats error:', e.message);
    }

    // 2. Try getUpdates (temporarily remove webhook if needed)
    try {
        if (webhookSet) {
            await telegramRequest('deleteWebhook');
            console.log('[Telegram] Webhook temporarily removed for getUpdates');
        }

        const result = await telegramRequest('getUpdates');

        // Re-set webhook immediately
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            const webhookUrl = `${appUrl}/api/telegram/webhook`;
            await telegramRequest('setWebhook', { url: webhookUrl, secret_token: WEBHOOK_SECRET });
            webhookSet = true;
            console.log('[Telegram] Webhook restored after getUpdates');
        }

        if (result.ok && result.result.length > 0) {
            for (const update of result.result) {
                const chat = update.message?.chat || update.my_chat_member?.chat;
                if (chat && !chatMap.has(String(chat.id))) {
                    chatMap.set(String(chat.id), { id: chat.id, title: chat.title || chat.first_name, type: chat.type });
                }
            }
        }
    } catch (err) {
        console.error('[Telegram] getUpdates error:', err.message);
    }

    return Array.from(chatMap.values());
}

// v3.9: Input validation helpers
function validateDate(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}
function validateTime(str) {
    return typeof str === 'string' && /^\d{2}:\d{2}$/.test(str);
}
function validateId(str) {
    return typeof str === 'string' && str.length > 0 && str.length <= 100;
}
function validateSettingKey(str) {
    return typeof str === 'string' && /^[a-z_]{1,100}$/.test(str);
}

// ==========================================
// v5.7: SERVER-SIDE HELPERS
// ==========================================

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

const MIN_PAUSE = 15;

// v5.18.1: Check room conflicts — prevent same room at same time
async function checkRoomConflict(client, date, room, time, duration, excludeId = null) {
    if (!room || room === 'Інше') return null;
    const params = excludeId ? [date, room, excludeId] : [date, room];
    const result = await client.query(
        "SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND room = $2 AND status != 'cancelled'" +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;
    for (const b of result.rows) {
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + (b.duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            return b;
        }
    }
    return null;
}

// v5.18: Check afisha blocking layer — blocks all lines for this time range (visual only, not used for blocking)
async function checkAfishaConflicts(client, date, time, duration) {
    const result = await client.query('SELECT * FROM afisha WHERE date = $1', [date]);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;
    for (const ev of result.rows) {
        const evStart = timeToMinutes(ev.time);
        const evEnd = evStart + (ev.duration || 60);
        if (newStart < evEnd && newEnd > evStart) {
            return { blocked: true, event: ev };
        }
    }
    return { blocked: false };
}

async function checkServerConflicts(client, date, lineId, time, duration, excludeId = null) {
    const params = excludeId ? [date, lineId, excludeId] : [date, lineId];
    const result = await client.query(
        'SELECT id, time, duration, label, program_code FROM bookings WHERE date = $1 AND line_id = $2 AND status != \'cancelled\'' +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart < end && newEnd > start) {
            return { overlap: true, noPause: false, conflictWith: b };
        }
    }

    let noPause = false;
    for (const b of result.rows) {
        const start = timeToMinutes(b.time);
        const end = start + (b.duration || 0);
        if (newStart === end || newEnd === start) noPause = true;
        if (newStart > end && newStart < end + MIN_PAUSE) noPause = true;
        if (newEnd > start - MIN_PAUSE && newEnd <= start) noPause = true;
    }

    return { overlap: false, noPause, conflictWith: null };
}

async function checkServerDuplicate(client, date, programId, time, duration, excludeId = null) {
    if (!programId) return null;
    const params = excludeId ? [date, programId, excludeId] : [date, programId];
    const result = await client.query(
        'SELECT id, category FROM bookings WHERE date = $1 AND program_id = $2 AND status != \'cancelled\'' +
        (excludeId ? ' AND id != $3' : ''),
        params
    );
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    for (const b of result.rows) {
        if (b.category === 'animation') continue;
        const bResult = await client.query('SELECT time, duration FROM bookings WHERE id = $1', [b.id]);
        if (bResult.rows.length === 0) continue;
        const bStart = timeToMinutes(bResult.rows[0].time);
        const bEnd = bStart + (bResult.rows[0].duration || 0);
        if (newStart < bEnd && newEnd > bStart) {
            return b;
        }
    }
    return null;
}

// v5.12: Notification template system
const notificationTemplates = {
    create(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        const statusIcon = booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене';
        let text = `📌 <b>Нове бронювання</b>\n\n`;
        text += `${statusIcon}\n`;
        text += `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${booking.room}\n`;
        // v5.18: Include second animator (host2) in notification
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${booking.second_animator || booking.secondAnimator}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.notes) text += `📝 ${booking.notes}\n`;
        text += `\n👤 Створив: ${extra.username || booking.created_by}`;
        return text;
    },

    edit(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        let text = `✏️ <b>Бронювання змінено</b>\n\n`;
        text += `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${booking.room}\n`;
        // v5.18: Include second animator (host2) in notification
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${booking.second_animator || booking.secondAnimator}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.notes) text += `📝 ${booking.notes}\n`;
        text += `\n👤 Змінив: ${extra.username || '?'}`;
        return text;
    },

    delete(booking, extra) {
        return `🗑 <b>Видалено бронювання</b>\n\n` +
            `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n` +
            `🕐 ${booking.date} | ${booking.time}\n` +
            `🏠 ${booking.room}\n` +
            `\n👤 Видалив: ${extra.username || '?'}`;
    },

    status_change(booking, extra) {
        const statusText = booking.status === 'confirmed' ? '✅ Підтверджене' : '⏳ Попереднє';
        return `⚡ <b>Статус змінено</b>\n\n` +
            `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n` +
            `🕐 ${booking.date} | ${booking.time}\n` +
            `📊 ${statusText}\n` +
            `\n👤 Змінив: ${extra.username || '?'}`;
    }
};

function formatBookingNotification(type, booking, extra = {}) {
    const template = notificationTemplates[type];
    if (!template) return '';
    return template(booking, extra);
}

async function editTelegramMessage(chatId, messageId, text) {
    try {
        const threadId = await getConfiguredThreadId();
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
        if (threadId) payload.message_thread_id = threadId;
        const result = await telegramRequest('editMessageText', payload);
        if (result && result.ok) {
            console.log(`[Telegram] Message ${messageId} edited in ${chatId}`);
            return result;
        }
        console.warn('[Telegram] Edit failed:', JSON.stringify(result));
        return null;
    } catch (err) {
        console.error('[Telegram] Edit error:', err.message);
        return null;
    }
}

async function deleteTelegramMessage(chatId, messageId) {
    try {
        const result = await telegramRequest('deleteMessage', { chat_id: chatId, message_id: messageId });
        if (result && result.ok) {
            console.log(`[Telegram] Message ${messageId} deleted from ${chatId}`);
        }
        return result;
    } catch (err) {
        console.error('[Telegram] Delete error:', err.message);
        return null;
    }
}

async function notifyTelegram(type, booking, extra = {}) {
    try {
        const text = formatBookingNotification(type, booking, extra);
        if (!text) return;
        const chatId = await getConfiguredChatId();
        if (!chatId) return;
        const bookingId = booking.id || extra.bookingId;

        // v5.18.1: Edit existing message if possible, otherwise send new
        if ((type === 'edit' || type === 'status_change') && bookingId) {
            // Try to find existing telegram_message_id
            const existing = await pool.query('SELECT telegram_message_id FROM bookings WHERE id = $1', [bookingId]);
            const existingMsgId = existing.rows[0]?.telegram_message_id;

            if (existingMsgId) {
                // Try to edit
                const edited = await editTelegramMessage(chatId, existingMsgId, text);
                if (edited && edited.ok) return;
                // Edit failed (e.g. message too old) — delete old and send new
                await deleteTelegramMessage(chatId, existingMsgId);
            }
        }

        if (type === 'delete' && bookingId) {
            // Delete the old Telegram message instead of sending "deleted" notification
            const existing = await pool.query('SELECT telegram_message_id FROM bookings WHERE id = $1', [bookingId]);
            const existingMsgId = existing.rows[0]?.telegram_message_id;
            if (existingMsgId) {
                await deleteTelegramMessage(chatId, existingMsgId);
            }
            // Still send the deletion notification
            await sendTelegramMessage(chatId, text);
            return;
        }

        // Send new message and store ID
        const result = await sendTelegramMessage(chatId, text);
        if (result && result.ok && result.result && bookingId) {
            await pool.query('UPDATE bookings SET telegram_message_id = $1 WHERE id = $2', [result.result.message_id, bookingId]);
        }
    } catch (err) {
        console.error('[Telegram Notify] Error:', err.message);
    }
}

// v5.7: Rate limiter (in-memory per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 120;

function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
        entry = { start: now, count: 1 };
        rateLimitMap.set(ip, entry);
    } else {
        entry.count++;
    }
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Забагато запитів, спробуйте пізніше' });
    }
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.start > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip);
    }
}, 300000);

// Shared booking row mapper (snake_case → camelCase)
function mapBookingRow(row) {
    return {
        id: row.id,
        date: row.date,
        time: row.time,
        lineId: row.line_id,
        programId: row.program_id,
        programCode: row.program_code,
        label: row.label,
        programName: row.program_name,
        category: row.category,
        duration: row.duration,
        price: row.price,
        hosts: row.hosts,
        secondAnimator: row.second_animator,
        pinataFiller: row.pinata_filler,
        costume: row.costume,
        room: row.room,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        linkedTo: row.linked_to,
        status: row.status || 'confirmed',
        kidsCount: row.kids_count,
        updatedAt: row.updated_at,
        groupName: row.group_name || null
    };
}

// Initialize database tables
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bookings (
                id VARCHAR(50) PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                time VARCHAR(10) NOT NULL,
                line_id VARCHAR(100) NOT NULL,
                program_id VARCHAR(50),
                program_code VARCHAR(20),
                label VARCHAR(100),
                program_name VARCHAR(100),
                category VARCHAR(50),
                duration INTEGER,
                price INTEGER,
                hosts INTEGER,
                second_animator VARCHAR(100),
                pinata_filler VARCHAR(50),
                room VARCHAR(100),
                notes TEXT,
                created_by VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW(),
                linked_to VARCHAR(50)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS lines_by_date (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                line_id VARCHAR(100) NOT NULL,
                name VARCHAR(100) NOT NULL,
                color VARCHAR(20),
                from_sheet BOOLEAN DEFAULT FALSE,
                UNIQUE(date, line_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                action VARCHAR(20) NOT NULL,
                username VARCHAR(50),
                data JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // v3.2: Add new columns if they don't exist
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'confirmed'`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS kids_count INTEGER`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS costume VARCHAR(100)`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
        // v5.10: Banquet grouping
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_name VARCHAR(100)`);
        // v5.18.1: Store Telegram message ID for edit/delete capability
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS telegram_message_id INTEGER`);

        // v3.3: Settings table for Telegram etc
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT
            )
        `);

        // v3.8: Pending animator requests
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_animators (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                note TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // v5.3: Afisha / Events table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS afisha (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                time VARCHAR(10) NOT NULL,
                title VARCHAR(200) NOT NULL,
                duration INTEGER DEFAULT 60,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_afisha_date ON afisha(date)');

        // v5.3: Known Telegram chats (populated from webhook)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_known_chats (
                chat_id BIGINT PRIMARY KEY,
                title VARCHAR(200),
                type VARCHAR(50),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // v5.17: Known Telegram threads/topics (populated from webhook)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_known_threads (
                thread_id INTEGER NOT NULL,
                chat_id BIGINT NOT NULL,
                title VARCHAR(200),
                updated_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (chat_id, thread_id)
            )
        `);

        // v5.0: Users table for server-side authentication
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'user',
                name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Seed default users if table is empty
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count) === 0) {
            const defaultUsers = [
                { username: 'Vitalina', password: 'Vitalina109', role: 'user', name: 'Віталіна' },
                { username: 'Dasha', password: 'Dasha743', role: 'user', name: 'Даша' },
                { username: 'Natalia', password: 'Natalia875', role: 'admin', name: 'Наталія' },
                { username: 'Sergey', password: 'Sergey232', role: 'admin', name: 'Сергій' },
                { username: 'Animator', password: 'Animator612', role: 'viewer', name: 'Аніматор' }
            ];
            for (const u of defaultUsers) {
                const hash = await bcrypt.hash(u.password, 10);
                await pool.query(
                    'INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
                    [u.username, hash, u.role, u.name]
                );
            }
            console.log('Default users seeded');
        }

        // v5.4: Booking number counter (atomic, per-year)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS booking_counter (
                year INTEGER PRIMARY KEY,
                counter INTEGER NOT NULL DEFAULT 0
            )
        `);

        // v5.0: Add indexes for performance
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_lines_by_date_date ON lines_by_date(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)');

        console.log('Database initialized');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// ==========================================
// BOOKING NUMBER GENERATOR (v5.4: BK-YYYY-NNNN)
// ==========================================

async function generateBookingNumber(client) {
    const db = client || pool;
    const year = new Date().getFullYear();
    const result = await db.query(
        `INSERT INTO booking_counter (year, counter) VALUES ($1, 1)
         ON CONFLICT (year) DO UPDATE SET counter = booking_counter.counter + 1
         RETURNING counter`,
        [year]
    );
    const num = result.rows[0].counter;
    return `BK-${year}-${String(num).padStart(4, '0')}`;
}

// ==========================================
// AUTH MIDDLEWARE & ENDPOINTS (v5.0)
// ==========================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ token, user: { username: user.username, role: user.role, name: user.name } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify token endpoint
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ user: { username: req.user.username, role: req.user.role, name: req.user.name } });
});

// ==========================================
// API ENDPOINTS (all protected by auth)
// ==========================================

// v5.7: Rate limiter
app.use('/api', rateLimiter);

// v5.0: Protect all API endpoints except auth and health
app.use('/api', (req, res, next) => {
    // Public endpoints that don't require auth
    if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/telegram/webhook')) {
        return next();
    }
    authenticateToken(req, res, next);
});

// --- BOOKINGS ---

// Get bookings for a date (v3.9: validation)
app.get('/api/bookings/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND status != \'cancelled\' ORDER BY time',
            [date]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create booking (v5.7: transaction + conflict check + auto-history + auto-Telegram)
app.post('/api/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        const b = req.body;
        if (!b.date || !b.time || !b.lineId) {
            client.release();
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        if (!validateDate(b.date)) { client.release(); return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(b.time)) { client.release(); return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        // v5.7: Server-side conflict check (skip for linked bookings — checked in /bookings/full)
        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0);
            if (conflict.overlap) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                });
            }

            const duplicate = await checkServerDuplicate(client, b.date, b.programId, b.time, b.duration || 0);
            if (duplicate) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
            }

            // v5.18.1: Room conflict check — prevent same room at same time
            const roomConflict = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0);
            if (roomConflict) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }
        }

        if (!b.id || !/^BK-\d{4}-\d{4,}$/.test(b.id)) {
            b.id = await generateBookingNumber(client);
        }

        await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count, group_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null]
        );

        // Auto-history in transaction
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', b.createdBy || req.user?.username, JSON.stringify(b)]
        );

        await client.query('COMMIT');

        // Auto Telegram notify (fire-and-forget, after commit)
        // v5.18: Skip notification for preliminary bookings
        if (!b.linkedTo && b.status !== 'preliminary') {
            notifyTelegram('create', {
                ...b, label: b.label, program_code: b.programCode,
                program_name: b.programName, kids_count: b.kidsCount,
                created_by: b.createdBy
            }, { username: b.createdBy || req.user?.username });
        }

        // v5.27: Return full booking object for API contract consistency
        const createdRow = await client.query('SELECT * FROM bookings WHERE id = $1', [b.id]);
        const booking = createdRow.rows[0] ? mapBookingRow(createdRow.rows[0]) : { id: b.id };

        res.json({ success: true, booking });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// v5.7: Create booking with linked bookings in one transaction
app.post('/api/bookings/full', async (req, res) => {
    const client = await pool.connect();
    try {
        const { main, linked } = req.body;
        if (!main || !main.date || !main.time || !main.lineId) {
            client.release();
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        if (!validateDate(main.date)) { client.release(); return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(main.time)) { client.release(); return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        // Conflict check for main booking
        const conflict = await checkServerConflicts(client, main.date, main.lineId, main.time, main.duration || 0);
        if (conflict.overlap) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(409).json({
                success: false,
                error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
            });
        }

        const duplicate = await checkServerDuplicate(client, main.date, main.programId, main.time, main.duration || 0);
        if (duplicate) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
        }

        // v5.18.1: Room conflict check
        const roomConflict = await checkRoomConflict(client, main.date, main.room, main.time, main.duration || 0);
        if (roomConflict) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(409).json({
                success: false,
                error: `Кімната "${main.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
            });
        }

        // Generate main ID
        if (!main.id || !/^BK-\d{4}-\d{4,}$/.test(main.id)) {
            main.id = await generateBookingNumber(client);
        }

        // Insert main booking
        await client.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
            [main.id, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null]
        );

        // Insert linked bookings
        const linkedIds = [];
        if (Array.isArray(linked)) {
            for (const lb of linked) {
                // Conflict check for linked booking's line
                const lConflict = await checkServerConflicts(client, lb.date, lb.lineId, lb.time, lb.duration || 0);
                if (lConflict.overlap) {
                    await client.query('ROLLBACK');
                    client.release();
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий у пов'язаного аніматора: ${lConflict.conflictWith.label || lConflict.conflictWith.program_code}`
                    });
                }

                const lbId = await generateBookingNumber(client);
                await client.query(
                    `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, costume, room, notes, created_by, linked_to, status, kids_count)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
                    [lbId, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status || main.status || 'confirmed', lb.kidsCount || null]
                );
                linkedIds.push(lbId);
            }
        }

        // History in same transaction
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', main.createdBy || req.user?.username, JSON.stringify(main)]
        );

        await client.query('COMMIT');

        // Auto Telegram notify
        // v5.18: Skip notification for preliminary bookings
        if (main.status !== 'preliminary') {
            notifyTelegram('create', {
                ...main, program_code: main.programCode, program_name: main.programName,
                kids_count: main.kidsCount, created_by: main.createdBy
            }, { username: main.createdBy || req.user?.username });
        }

        // v5.27: Return full booking objects for API contract consistency
        const mainRow = await client.query('SELECT * FROM bookings WHERE id = $1', [main.id]);
        const mainBooking = mainRow.rows[0] ? mapBookingRow(mainRow.rows[0]) : { id: main.id };

        const linkedBookings = [];
        for (const lid of linkedIds) {
            const lRow = await client.query('SELECT * FROM bookings WHERE id = $1', [lid]);
            if (lRow.rows[0]) linkedBookings.push(mapBookingRow(lRow.rows[0]));
        }

        res.json({ success: true, mainBooking, linkedBookings });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error creating full booking:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// v5.14: Soft delete (status=cancelled) or permanent delete (?permanent=true)
app.delete('/api/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const permanent = req.query.permanent === 'true';
        if (!validateId(id)) { client.release(); return res.status(400).json({ error: 'Invalid booking ID' }); }

        await client.query('BEGIN');

        const bookingResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        const booking = bookingResult.rows[0];
        if (!booking) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, error: 'Бронювання не знайдено' });
        }

        const action = permanent ? 'permanent_delete' : 'delete';
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [action, req.user?.username, JSON.stringify(mapBookingRow(booking))]
        );

        if (permanent) {
            // Hard delete — removes from DB completely
            await client.query('DELETE FROM bookings WHERE id = $1 OR linked_to = $1', [id]);
        } else {
            // Soft delete — set status to cancelled
            await client.query(
                "UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 OR linked_to = $1",
                [id]
            );
        }

        await client.query('COMMIT');

        notifyTelegram('delete', booking, { username: req.user?.username });

        res.json({ success: true, permanent });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Update booking (v5.12: transaction + conflict check + history + Telegram notify)
app.put('/api/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const b = req.body;
        if (!validateId(id)) { client.release(); return res.status(400).json({ error: 'Invalid booking ID' }); }
        if (!validateDate(b.date)) { client.release(); return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(b.time)) { client.release(); return res.status(400).json({ error: 'Invalid time format' }); }

        await client.query('BEGIN');

        // Get old booking for comparison (status change detection)
        const oldResult = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (oldResult.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        const oldBooking = oldResult.rows[0];

        // v5.7: Server-side conflict check (exclude self, skip linked bookings)
        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, id);
            if (conflict.overlap) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                });
            }

            // v5.18.1: Room conflict check (exclude self)
            const roomConflict = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0, id);
            if (roomConflict) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }
        }

        const newStatus = b.status || 'confirmed';

        await client.query(
            `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
             label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
             second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
             linked_to=$18, status=$19, kids_count=$20, group_name=$21, updated_at=NOW()
             WHERE id=$22`,
            [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
             b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
             b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
             b.kidsCount || null, b.groupName || null, id]
        );

        // v5.19: Auto-sync linked bookings when main is edited (time, date, status, duration)
        if (!b.linkedTo) {
            const linkedResult = await client.query('SELECT id FROM bookings WHERE linked_to = $1', [id]);
            for (const linked of linkedResult.rows) {
                await client.query(
                    `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, updated_at=NOW() WHERE id=$5`,
                    [b.date, b.time, b.duration, newStatus, linked.id]
                );
            }
        }

        // v5.12: Auto-history in transaction
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['edit', req.user?.username, JSON.stringify(b)]
        );

        await client.query('COMMIT');

        // v5.12: Telegram notifications (fire-and-forget, after commit)
        const username = req.user?.username;
        const bookingForNotify = {
            ...b, id, label: b.label, program_code: b.programCode,
            program_name: b.programName, kids_count: b.kidsCount,
            status: newStatus
        };

        // v5.19: Smart Telegram notifications
        const statusChanged = oldBooking.status !== newStatus;
        if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
            // prelim→confirmed: send as NEW booking (first time in Telegram)
            notifyTelegram('create', bookingForNotify, { username, bookingId: id });
        } else if (statusChanged) {
            notifyTelegram('status_change', bookingForNotify, { username, bookingId: id });
        } else if (!b.linkedTo && newStatus !== 'preliminary') {
            notifyTelegram('edit', bookingForNotify, { username, bookingId: id });
        }

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error updating booking:', err);
        res.status(500).json({ error: 'Failed to update booking' });
    } finally {
        client.release();
    }
});

// --- LINES ---

// Get lines for a date (B1: always ensure >= 2 lines for normal days)
app.get('/api/lines/:date', async (req, res) => {
    try {
        const { date } = req.params;
        // Always ensure at least 2 lines exist
        await ensureDefaultLines(date);
        const result = await pool.query(
            'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id',
            [date]
        );
        const lines = result.rows.map(row => ({
            id: row.line_id,
            name: row.name,
            color: row.color,
            fromSheet: row.from_sheet
        }));
        res.json(lines);
    } catch (err) {
        console.error('Error fetching lines:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Save lines for a date (v3.9: transaction)
app.post('/api/lines/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const lines = req.body;

        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!Array.isArray(lines)) return res.status(400).json({ error: 'Lines must be an array' });

        await client.query('BEGIN');
        await client.query('DELETE FROM lines_by_date WHERE date = $1', [date]);

        for (const line of lines) {
            await client.query(
                'INSERT INTO lines_by_date (date, line_id, name, color, from_sheet) VALUES ($1, $2, $3, $4, $5)',
                [date, line.id, line.name, line.color, line.fromSheet || false]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error saving lines:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// --- HISTORY ---

// Get history (v5.16: with filters)
app.get('/api/history', async (req, res) => {
    try {
        const { action, user, from, to, limit, offset, search } = req.query;
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (action) {
            conditions.push(`action = $${paramIdx++}`);
            params.push(action);
        }
        if (user) {
            conditions.push(`username = $${paramIdx++}`);
            params.push(user);
        }
        if (from) {
            conditions.push(`created_at >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            conditions.push(`created_at < ($${paramIdx++})::date + 1`);
            params.push(to);
        }
        if (search) {
            conditions.push(`(data::text ILIKE $${paramIdx++} OR username ILIKE $${paramIdx++})`);
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const lim = Math.min(parseInt(limit) || 200, 500);
        const off = parseInt(offset) || 0;

        const countResult = await pool.query(`SELECT COUNT(*) FROM history ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT * FROM history ${where} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`,
            params
        );
        const history = result.rows.map(row => ({
            id: row.id,
            action: row.action,
            user: row.username,
            data: row.data,
            timestamp: row.created_at
        }));
        res.json({ items: history, total, limit: lim, offset: off });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add history entry
app.post('/api/history', async (req, res) => {
    try {
        const { action, user, data } = req.body;
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [action, user, JSON.stringify(data)]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- SETTINGS ---

// --- STATS (v3.4) ---

app.get('/api/stats/:dateFrom/:dateTo', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.params;
        if (!validateDate(dateFrom) || !validateDate(dateTo)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != \'cancelled\' ORDER BY date, time',
            [dateFrom, dateTo]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- SETTINGS ---

app.get('/api/settings/:key', async (req, res) => {
    try {
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
        res.json({ value: result.rows.length > 0 ? result.rows[0].value : null });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key || !validateSettingKey(key)) {
            return res.status(400).json({ error: 'Invalid setting key' });
        }
        if (typeof value !== 'string' || value.length > 1000) {
            return res.status(400).json({ error: 'Invalid setting value' });
        }
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- TELEGRAM ---

// Get chat ID from bot updates (admin helper)
app.get('/api/telegram/chats', async (req, res) => {
    try {
        const chats = await getTelegramChatId();
        res.json({ chats });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v5.17: Get known threads/topics for a chat
app.get('/api/telegram/threads', async (req, res) => {
    try {
        const chatId = req.query.chat_id || await getConfiguredChatId();
        const result = await pool.query(
            'SELECT thread_id, title FROM telegram_known_threads WHERE chat_id = $1 ORDER BY thread_id',
            [chatId]
        );
        res.json({ threads: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send notification to Telegram
app.post('/api/telegram/notify', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            console.warn('[Telegram Notify] Empty text received');
            return res.json({ success: false, reason: 'no_text' });
        }
        const chatId = await getConfiguredChatId();
        if (!chatId) {
            console.warn('[Telegram Notify] No chat ID configured — cannot send');
            return res.json({ success: false, reason: 'no_chat_id' });
        }
        if (!TELEGRAM_BOT_TOKEN) {
            console.warn('[Telegram Notify] No bot token configured');
            return res.json({ success: false, reason: 'no_bot_token' });
        }
        console.log(`[Telegram Notify] Sending to chat ${chatId}, text length=${text.length}`);
        const result = await sendTelegramMessage(chatId, text);
        const ok = result?.ok || false;
        if (!ok) {
            console.warn('[Telegram Notify] Send failed:', JSON.stringify(result));
        }
        res.json({ success: ok, reason: ok ? undefined : 'send_failed', details: ok ? undefined : result });
    } catch (err) {
        console.error('[Telegram Notify] Error:', err);
        res.status(500).json({ success: false, reason: 'server_error', error: err.message });
    }
});

// Daily digest — shared logic (used by API and auto-scheduler)
async function buildAndSendDigest(date) {
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        console.warn('[Digest] No chat ID configured');
        return { success: false, reason: 'no_chat_id' };
    }

    const bookingsResult = await pool.query('SELECT * FROM bookings WHERE date = $1 AND status != \'cancelled\' ORDER BY time', [date]);
    const bookings = bookingsResult.rows;

    if (bookings.length === 0) {
        const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
        const result = await sendTelegramMessage(chatId, text);
        return { success: result?.ok || false, count: 0 };
    }

    await ensureDefaultLines(date);
    const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]);
    const lines = linesResult.rows;

    let text = `📅 <b>Розклад на ${date}</b>\n`;
    text += `Всього бронювань: ${bookings.filter(b => !b.linked_to).length}\n\n`;

    for (const line of lines) {
        const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
        if (lineBookings.length === 0) continue;

        text += `👤 <b>${line.name}</b>\n`;
        for (const b of lineBookings) {
            const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
            const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
            const endM = String(endMin % 60).padStart(2, '0');
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
            text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
            if (b.kids_count) text += ` [${b.kids_count} діт]`;
            text += '\n';
        }
        text += '\n';
    }

    const result = await sendTelegramMessage(chatId, text, { silent: false });
    console.log(`[Digest] Sent for ${date}: ${result?.ok ? 'OK' : 'FAIL'}`);

    // v5.11: Schedule auto-delete if enabled
    if (result?.ok && result.result?.message_id) {
        await scheduleAutoDelete(chatId, result.result.message_id);
    }

    return { success: result?.ok || false, count: bookings.length };
}

// Daily digest endpoint (protected by auth middleware)
app.get('/api/telegram/digest/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await buildAndSendDigest(date);
        res.json(result);
    } catch (err) {
        console.error('Digest error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v5.11: Test tomorrow reminder endpoint
app.get('/api/telegram/reminder/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await sendTomorrowReminder(date);
        res.json(result);
    } catch (err) {
        console.error('Reminder error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ask animator (inline keyboard) — v3.8
app.post('/api/telegram/ask-animator', async (req, res) => {
    try {
        const { date, note } = req.body;
        const chatId = await getConfiguredChatId();

        // Setup webhook if not done
        const appUrl = `${req.protocol === 'http' && req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
        await ensureWebhook(appUrl);

        // Ensure default lines are in DB
        await ensureDefaultLines(date);

        // Create pending record
        const pendingResult = await pool.query(
            'INSERT INTO pending_animators (date, note) VALUES ($1, $2) RETURNING id',
            [date, note || null]
        );
        const requestId = pendingResult.rows[0].id;

        // Get current animators on shift (now always from DB)
        const linesResult = await pool.query(
            'SELECT name FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]
        );
        const animatorNames = linesResult.rows.map(r => r.name);

        // Format date DD.MM.YYYY
        const parts = date.split('-');
        const dateFormatted = `${parts[2]}.${parts[1]}.${parts[0]}`;

        let text = `🎭 <b>Запит на додавання аніматора</b>\n\n`;
        text += `📅 Дата: <b>${dateFormatted}</b>\n`;
        text += `👥 Зараз на зміні:\n`;
        if (animatorNames.length > 0) {
            animatorNames.forEach(name => { text += `  • ${name}\n`; });
        } else {
            text += `  — нікого\n`;
        }
        if (note) {
            text += `\n📝 Примітка: ${note}\n`;
        }
        text += `\nДодати ще одного аніматора?`;

        // v5.17: Sound enabled (no disable_notification) + thread support
        const threadId = await getConfiguredThreadId();
        const askPayload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Так', callback_data: `add_anim:${requestId}` },
                    { text: '❌ Ні', callback_data: `no_anim:${requestId}` }
                ]]
            }
        };
        if (threadId) askPayload.message_thread_id = threadId;
        const result = await telegramRequest('sendMessage', askPayload);

        res.json({ success: result?.ok || false, requestId });
    } catch (err) {
        console.error('Ask animator error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check pending animator status (polling)
app.get('/api/telegram/animator-status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT status FROM pending_animators WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.json({ status: 'not_found' });
        }
        res.json({ status: result.rows[0].status });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Telegram webhook handler (callback queries) — v3.8 (v3.9: secret verification)
app.post('/api/telegram/webhook', async (req, res) => {
    // v3.9: Verify Telegram secret token
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (secretHeader !== WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }

    try {
        const update = req.body;

        // Save chat info from any incoming update for chat discovery
        const incomingChat = update.message?.chat || update.callback_query?.message?.chat || update.my_chat_member?.chat;
        if (incomingChat && incomingChat.id) {
            pool.query(
                `INSERT INTO telegram_known_chats (chat_id, title, type, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id) DO UPDATE SET title = $2, type = $3, updated_at = NOW()`,
                [incomingChat.id, incomingChat.title || incomingChat.first_name || 'Chat', incomingChat.type || 'unknown']
            ).catch(e => console.error('[Telegram] Failed to save chat info:', e.message));
        }

        // v5.17: Save thread/topic info from forum messages
        const msg = update.message || update.callback_query?.message;
        if (msg && msg.message_thread_id && msg.chat?.id) {
            const threadTitle = msg.reply_to_message?.forum_topic_created?.name
                || msg.forum_topic_created?.name
                || null;
            pool.query(
                `INSERT INTO telegram_known_threads (thread_id, chat_id, title, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id, thread_id) DO UPDATE SET title = COALESCE(NULLIF($3, ''), telegram_known_threads.title), updated_at = NOW()`,
                [msg.message_thread_id, msg.chat.id, threadTitle]
            ).catch(e => console.error('[Telegram] Failed to save thread info:', e.message));
        }

        if (update.callback_query) {
            const { id, data, message } = update.callback_query;
            const chatId = message.chat.id;

            if (data.startsWith('add_anim:')) {
                const requestId = parseInt(data.split(':')[1]);

                // v3.9: Atomic UPDATE — prevents double-click race condition
                const pending = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['approved', requestId, 'pending']
                );
                if (pending.rows.length === 0) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                const date = pending.rows[0].date;

                // Ensure default lines exist in DB
                await ensureDefaultLines(date);

                // Get current lines for this date
                const linesResult = await pool.query(
                    'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]
                );
                // v5.9: Find next available number (handles gaps from deletions)
                const existingNumbers = linesResult.rows
                    .map(row => { const m = row.name.match(/^Аніматор (\d+)$/); return m ? parseInt(m[1]) : 0; })
                    .filter(n => n > 0);
                let nextNum = 1;
                while (existingNumbers.includes(nextNum)) nextNum++;

                const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
                const newLineId = `line${Date.now()}_${date}`;
                const newName = `Аніматор ${nextNum}`;

                // Add line to DB
                await pool.query(
                    'INSERT INTO lines_by_date (date, line_id, name, color) VALUES ($1, $2, $3, $4)',
                    [date, newLineId, newName, colors[linesResult.rows.length % colors.length]]
                );

                // Answer callback
                await telegramRequest('answerCallbackQuery', {
                    callback_query_id: id,
                    text: 'Аніматора додано!'
                });

                // Edit original message
                await telegramRequest('editMessageText', {
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: message.text + `\n\n✅ <b>Додано: ${newName}</b>`,
                    parse_mode: 'HTML'
                });

            } else if (data.startsWith('no_anim:')) {
                const requestId = parseInt(data.split(':')[1]);

                // v3.9: Atomic UPDATE — prevents double-click
                const rejected = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['rejected', requestId, 'pending']
                );
                if (rejected.rows.length === 0) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                await telegramRequest('answerCallbackQuery', {
                    callback_query_id: id,
                    text: 'Відхилено'
                });

                await telegramRequest('editMessageText', {
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: message.text + '\n\n❌ <b>Відхилено</b>',
                    parse_mode: 'HTML'
                });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Webhook error:', err);
        res.sendStatus(200); // Always respond 200 to Telegram
    }
});

// --- AFISHA (Events) ---

app.get('/api/afisha', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM afisha ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        console.error('Afisha get error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/afisha/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        const result = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
        res.json(result.rows);
    } catch (err) {
        console.error('Afisha get by date error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/afisha', async (req, res) => {
    try {
        const { date, time, title, duration } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration) VALUES ($1, $2, $3, $4) RETURNING *',
            [date, time, title, duration || 60]
        );
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Afisha create error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/afisha/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, time, title, duration } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        await pool.query(
            'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4 WHERE id=$5',
            [date, time, title, duration || 60, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Afisha update error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/afisha/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Afisha delete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v5.14: DATABASE BACKUP (Telegram)
// ==========================================

const BACKUP_TABLES = ['bookings', 'lines_by_date', 'users', 'history', 'settings', 'afisha', 'pending_animators', 'telegram_known_chats', 'telegram_known_threads', 'booking_counter'];

async function generateBackupSQL() {
    const lines = [];
    lines.push(`-- Backup: Park Booking System`);
    lines.push(`-- Date: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${BACKUP_TABLES.join(', ')}\n`);

    for (const table of BACKUP_TABLES) {
        try {
            const result = await pool.query(`SELECT * FROM ${table}`);
            if (result.rows.length === 0) continue;

            lines.push(`-- ${table}: ${result.rows.length} rows`);
            lines.push(`DELETE FROM ${table};`);

            const columns = Object.keys(result.rows[0]);
            for (const row of result.rows) {
                const values = columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                    if (val instanceof Date) return `'${val.toISOString()}'`;
                    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                    return `'${String(val).replace(/'/g, "''")}'`;
                });
                lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
            }
            lines.push('');
        } catch (err) {
            lines.push(`-- ERROR backing up ${table}: ${err.message}\n`);
        }
    }

    return lines.join('\n');
}

async function sendBackupToTelegram() {
    try {
        // Use backup-specific chat or fall back to configured chat
        const backupChatResult = await pool.query("SELECT value FROM settings WHERE key = 'backup_chat_id'");
        const chatId = backupChatResult.rows[0]?.value || await getConfiguredChatId();
        if (!chatId || !TELEGRAM_BOT_TOKEN) {
            console.warn('[Backup] No chat ID or bot token — skipping');
            return { success: false, reason: 'no_config' };
        }

        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();
        const fileName = `backup_${dateStr}.sql`;
        // v5.17: Thread support for backup messages
        const threadId = await getConfiguredThreadId();

        // Telegram sendDocument via multipart/form-data
        const boundary = '----BackupBoundary' + Date.now();
        let body = '';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="caption"\r\n\r\n📦 Бекап БД — ${dateStr}\r\n`;
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="disable_notification"\r\n\r\ntrue\r\n`;
        if (threadId) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}\r\n`;
        }
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="document"; filename="${fileName}"\r\n`;
        body += `Content-Type: application/sql\r\n\r\n`;
        body += sql;
        body += `\r\n--${boundary}--\r\n`;

        const bodyBuffer = Buffer.from(body, 'utf-8');

        const result = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': bodyBuffer.length
                }
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(bodyBuffer);
            req.end();
        });

        console.log(`[Backup] Sent to chat ${chatId}: ${result?.ok ? 'OK' : 'FAIL'}`);
        return { success: result?.ok || false, size: sql.length };
    } catch (err) {
        console.error('[Backup] Error:', err.message);
        return { success: false, error: err.message };
    }
}

// Manual backup trigger (admin)
app.post('/api/backup/create', async (req, res) => {
    try {
        const result = await sendBackupToTelegram();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Download backup as SQL (for manual restore)
app.get('/api/backup/download', async (req, res) => {
    try {
        const sql = await generateBackupSQL();
        const dateStr = getKyivDateStr();
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${dateStr}.sql"`);
        res.send(sql);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore from SQL (admin) — executes SQL statements from uploaded text
app.post('/api/backup/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sql } = req.body;
        if (!sql || typeof sql !== 'string') {
            client.release();
            return res.status(400).json({ error: 'SQL body required' });
        }

        // Only allow INSERT and DELETE statements (safety)
        const statements = sql.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        const forbidden = statements.find(s =>
            !s.toUpperCase().startsWith('INSERT') &&
            !s.toUpperCase().startsWith('DELETE')
        );
        if (forbidden) {
            client.release();
            return res.status(400).json({ error: 'Only INSERT and DELETE statements allowed', statement: forbidden.substring(0, 100) });
        }

        await client.query('BEGIN');
        let executed = 0;
        for (const stmt of statements) {
            await client.query(stmt);
            executed++;
        }
        await client.query('COMMIT');

        console.log(`[Restore] Executed ${executed} statements by ${req.user?.username}`);
        res.json({ success: true, executed });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Restore] Error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Auto-backup scheduler check (daily at configured time, default 03:00 Kyiv)
let backupSentToday = null;
async function checkAutoBackup() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'backup_time'");
        const backupTime = result.rows[0]?.value || '03:00';
        if (!/^\d{2}:\d{2}$/.test(backupTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === backupTime && backupSentToday !== todayStr) {
            backupSentToday = todayStr;
            console.log(`[AutoBackup] Running daily backup at ${backupTime}`);
            await sendBackupToTelegram();
        }
    } catch (err) {
        console.error('[AutoBackup] Error:', err);
    }
}

// v5.18: Free rooms API — returns rooms not occupied at given date+time+duration
app.get('/api/rooms/free/:date/:time/:duration', async (req, res) => {
    try {
        const { date, time, duration } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const dur = parseInt(duration) || 60;

        const ALL_ROOMS = [
            'Marvel', 'Ninja', 'Minecraft', 'Monster High', 'Elsa',
            'Растішка', 'Rock', 'Minion', 'Food Court', 'Жовтий стіл',
            'Диван 1', 'Диван 2', 'Диван 3', 'Диван 4'
        ];

        const bookings = await pool.query(
            "SELECT room, time, duration FROM bookings WHERE date = $1 AND status != 'cancelled'",
            [date]
        );

        const reqStart = timeToMinutes(time);
        const reqEnd = reqStart + dur;

        const occupiedRooms = new Set();
        for (const b of bookings.rows) {
            if (!b.room) continue;
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + (b.duration || 0);
            if (reqStart < bEnd && reqEnd > bStart) {
                occupiedRooms.add(b.room);
            }
        }

        const free = ALL_ROOMS.filter(r => !occupiedRooms.has(r));
        res.json({ free, occupied: Array.from(occupiedRooms), total: ALL_ROOMS.length });
    } catch (err) {
        console.error('Free rooms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- HEALTH CHECK ---
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.json({ status: 'ok', database: 'not connected' });
    }
});

// Invite page
app.get('/invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'invite.html'));
});

// SPA fallback (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// AUTO-DIGEST & REMINDER SCHEDULER (v5.11: independent schedules + auto-delete)
// ==========================================

let digestSentToday = null;  // tracks which date digest was sent for
let reminderSentToday = null; // tracks which date reminder was sent for

function getKyivDate() {
    const now = new Date();
    const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    return kyiv;
}

function getKyivDateStr() {
    const k = getKyivDate();
    return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
}

function getKyivTimeStr() {
    const k = getKyivDate();
    return `${String(k.getHours()).padStart(2, '0')}:${String(k.getMinutes()).padStart(2, '0')}`;
}

// v5.11: Schedule auto-delete for a sent message
async function scheduleAutoDelete(chatId, messageId) {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('auto_delete_enabled', 'auto_delete_hours')");
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });
        if (settings.auto_delete_enabled !== 'true') return;

        const hours = parseInt(settings.auto_delete_hours) || 10;
        const deleteAfterMs = hours * 60 * 60 * 1000;

        console.log(`[AutoDelete] Scheduled message ${messageId} for deletion in ${hours}h`);
        setTimeout(async () => {
            try {
                await telegramRequest('deleteMessage', {
                    chat_id: chatId,
                    message_id: messageId
                });
                console.log(`[AutoDelete] Deleted message ${messageId}`);
            } catch (err) {
                console.error(`[AutoDelete] Failed to delete message ${messageId}:`, err.message);
            }
        }, deleteAfterMs);
    } catch (err) {
        console.error('[AutoDelete] Schedule error:', err.message);
    }
}

// v5.11: Check today's digest (separate weekday/weekend times)
async function checkAutoDigest() {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('digest_time', 'digest_time_weekday', 'digest_time_weekend')");
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });

        const kyiv = getKyivDate();
        const isWeekend = kyiv.getDay() === 0 || kyiv.getDay() === 6;

        const digestTime = isWeekend
            ? (settings.digest_time_weekend || settings.digest_time)
            : (settings.digest_time_weekday || settings.digest_time);

        if (!digestTime || !/^\d{2}:\d{2}$/.test(digestTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === digestTime && digestSentToday !== todayStr) {
            digestSentToday = todayStr;
            console.log(`[AutoDigest] Sending daily digest for ${todayStr} at ${digestTime} (${isWeekend ? 'weekend' : 'weekday'})`);
            await buildAndSendDigest(todayStr);
        }
    } catch (err) {
        console.error('[AutoDigest] Error:', err);
    }
}

// v5.11: Check tomorrow reminder (independent schedule, fixed time)
async function checkAutoReminder() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'reminder_time'");
        const reminderTime = result.rows[0]?.value;
        if (!reminderTime || !/^\d{2}:\d{2}$/.test(reminderTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === reminderTime && reminderSentToday !== todayStr) {
            reminderSentToday = todayStr;
            console.log(`[AutoReminder] Sending tomorrow reminder at ${reminderTime}`);
            await sendTomorrowReminder(todayStr);
        }
    } catch (err) {
        console.error('[AutoReminder] Error:', err);
    }
}

// v5.7: Tomorrow reminder (v5.11: returns result for API, supports auto-delete)
async function sendTomorrowReminder(todayStr) {
    try {
        const [y, m, d] = todayStr.split('-').map(Number);
        const tomorrow = new Date(y, m - 1, d + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        const bookingsResult = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND linked_to IS NULL AND status != \'cancelled\' ORDER BY time',
            [tomorrowStr]
        );
        if (bookingsResult.rows.length === 0) {
            return { success: true, count: 0, reason: 'no_bookings_tomorrow' };
        }

        const chatId = await getConfiguredChatId();
        if (!chatId) return { success: false, reason: 'no_chat_id' };

        await ensureDefaultLines(tomorrowStr);
        const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [tomorrowStr]);

        let text = `⏰ <b>Нагадування: завтра ${tomorrowStr}</b>\n`;
        text += `📋 ${bookingsResult.rows.length} бронювань\n\n`;

        for (const line of linesResult.rows) {
            const lineBookings = bookingsResult.rows.filter(b => b.line_id === line.line_id);
            if (lineBookings.length === 0) continue;

            text += `👤 <b>${line.name}</b>\n`;
            for (const b of lineBookings) {
                const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
            text += '\n';
        }

        const sendResult = await sendTelegramMessage(chatId, text, { silent: false });
        console.log(`[Reminder] Tomorrow reminder sent for ${tomorrowStr}`);

        // v5.11: Schedule auto-delete if enabled
        if (sendResult?.ok && sendResult.result?.message_id) {
            await scheduleAutoDelete(chatId, sendResult.result.message_id);
        }

        return { success: sendResult?.ok || false, count: bookingsResult.rows.length };
    } catch (err) {
        console.error('[Reminder] Error:', err.message);
        return { success: false, error: err.message };
    }
}

// Start server
initDatabase().then(() => {
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`[Telegram Config] Bot token: ${TELEGRAM_BOT_TOKEN ? 'SET (' + TELEGRAM_BOT_TOKEN.slice(0,8) + '...)' : 'NOT SET'}`);
        console.log(`[Telegram Config] Default chat ID: ${TELEGRAM_DEFAULT_CHAT_ID || 'NOT SET'}`);
        try {
            const dbChatId = await getConfiguredChatId();
            console.log(`[Telegram Config] Effective chat ID: ${dbChatId || 'NONE'}`);
        } catch (e) { /* ignore */ }

        // v3.9: Setup Telegram webhook on start
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            ensureWebhook(appUrl).catch(err => console.error('Webhook auto-setup error:', err));
        }

        // v5.11: Independent schedulers for digest and reminder (every 60s)
        setInterval(checkAutoDigest, 60000);
        setInterval(checkAutoReminder, 60000);
        // v5.14: Auto-backup scheduler
        setInterval(checkAutoBackup, 60000);
        console.log('[Scheduler] Digest + Reminder + Backup schedulers started (checks every 60s)');
    });
});
