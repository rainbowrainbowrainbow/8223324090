const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID || '';

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

async function sendTelegramMessage(chatId, text, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await telegramRequest('sendMessage', {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            });
            if (result && result.ok) {
                console.log(`[Telegram] Message sent to ${chatId} (attempt ${attempt})`);
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
    try {
        const result = await telegramRequest('getUpdates');
        if (result.ok && result.result.length > 0) {
            const chats = new Set();
            const chatList = [];
            for (const update of result.result) {
                const chat = update.message?.chat || update.my_chat_member?.chat;
                if (chat && !chats.has(chat.id)) {
                    chats.add(chat.id);
                    chatList.push({ id: chat.id, title: chat.title || chat.first_name, type: chat.type });
                }
            }
            return chatList;
        }
        return [];
    } catch (err) {
        console.error('Telegram getUpdates error:', err);
        return [];
    }
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
        room: row.room,
        notes: row.notes,
        createdBy: row.created_by,
        createdAt: row.created_at,
        linkedTo: row.linked_to,
        status: row.status || 'confirmed',
        kidsCount: row.kids_count
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
            'SELECT * FROM bookings WHERE date = $1 ORDER BY time',
            [date]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create booking (v3.9: validation)
app.post('/api/bookings', async (req, res) => {
    try {
        const b = req.body;
        if (!b.id || !b.date || !b.time || !b.lineId) {
            return res.status(400).json({ error: 'Missing required fields: id, date, time, lineId' });
        }
        if (!validateDate(b.date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!validateTime(b.time)) return res.status(400).json({ error: 'Invalid time format' });
        await pool.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, room, notes, created_by, linked_to, status, kids_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null]
        );
        res.json({ success: true, id: b.id });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateId(id)) return res.status(400).json({ error: 'Invalid booking ID' });
        // Delete linked bookings too
        await pool.query('DELETE FROM bookings WHERE id = $1 OR linked_to = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update booking (v5.0: proper SQL UPDATE)
app.put('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const b = req.body;
        if (!validateId(id)) return res.status(400).json({ error: 'Invalid booking ID' });
        if (!validateDate(b.date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!validateTime(b.time)) return res.status(400).json({ error: 'Invalid time format' });

        await pool.query(
            `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
             label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
             second_animator=$12, pinata_filler=$13, room=$14, notes=$15, created_by=$16,
             linked_to=$17, status=$18, kids_count=$19
             WHERE id=$20`,
            [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
             b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
             b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed',
             b.kidsCount || null, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating booking:', err);
        res.status(500).json({ error: 'Failed to update booking' });
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

// Get history
app.get('/api/history', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM history ORDER BY created_at DESC LIMIT 100'
        );
        const history = result.rows.map(row => ({
            id: row.id,
            action: row.action,
            user: row.username,
            data: row.data,
            timestamp: row.created_at
        }));
        res.json(history);
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
            'SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL ORDER BY date, time',
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

// Send notification to Telegram
app.post('/api/telegram/notify', async (req, res) => {
    try {
        const { text } = req.body;
        const chatId = await getConfiguredChatId();
        const result = await sendTelegramMessage(chatId, text);
        res.json({ success: result?.ok || false });
    } catch (err) {
        console.error('Telegram notify error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Daily digest — shared logic (used by API and auto-scheduler)
async function buildAndSendDigest(date) {
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        console.warn('[Digest] No chat ID configured');
        return { success: false, reason: 'no_chat_id' };
    }

    const bookingsResult = await pool.query('SELECT * FROM bookings WHERE date = $1 ORDER BY time', [date]);
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

    const result = await sendTelegramMessage(chatId, text);
    console.log(`[Digest] Sent for ${date}: ${result?.ok ? 'OK' : 'FAIL'}`);
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

        const result = await telegramRequest('sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Так', callback_data: `add_anim:${requestId}` },
                    { text: '❌ Ні', callback_data: `no_anim:${requestId}` }
                ]]
            }
        });

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
                const count = linesResult.rows.length;
                const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
                const newLineId = `line${Date.now()}_${date}`;
                const newName = `Аніматор ${count + 1}`;

                // Add line to DB
                await pool.query(
                    'INSERT INTO lines_by_date (date, line_id, name, color) VALUES ($1, $2, $3, $4)',
                    [date, newLineId, newName, colors[count % colors.length]]
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
// AUTO-DIGEST SCHEDULER (A4: daily digest at configured time, Kyiv TZ)
// ==========================================

let digestSentToday = null; // tracks which date we've already sent for

function getKyivDate() {
    const now = new Date();
    const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    return kyiv;
}

function getKyivDateStr() {
    const k = getKyivDate();
    return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`;
}

async function checkAutoDigest() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'digest_time'");
        if (result.rows.length === 0 || !result.rows[0].value) return;
        const digestTime = result.rows[0].value; // "HH:MM"
        if (!/^\d{2}:\d{2}$/.test(digestTime)) return;

        const kyiv = getKyivDate();
        const nowHH = String(kyiv.getHours()).padStart(2, '0');
        const nowMM = String(kyiv.getMinutes()).padStart(2, '0');
        const nowTime = `${nowHH}:${nowMM}`;
        const todayStr = getKyivDateStr();

        if (nowTime === digestTime && digestSentToday !== todayStr) {
            digestSentToday = todayStr;
            console.log(`[AutoDigest] Sending daily digest for ${todayStr} at ${digestTime} Kyiv time`);
            await buildAndSendDigest(todayStr);
        }
    } catch (err) {
        console.error('[AutoDigest] Error:', err);
    }
}

// Start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);

        // v3.9: Setup Telegram webhook on start
        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            ensureWebhook(appUrl).catch(err => console.error('Webhook auto-setup error:', err));
        }

        // A4: Check auto-digest every minute
        setInterval(checkAutoDigest, 60000);
        console.log('[AutoDigest] Scheduler started (checks every 60s)');
    });
});
