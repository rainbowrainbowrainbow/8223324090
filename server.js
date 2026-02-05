const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
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
const TELEGRAM_DEFAULT_CHAT_ID = '-1001805304620'; // Аніматорська група

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

async function sendTelegramMessage(chatId, text) {
    try {
        return await telegramRequest('sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (err) {
        console.error('Telegram send error:', err);
        return null;
    }
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

async function ensureWebhook(appUrl) {
    if (webhookSet) return;
    try {
        const webhookUrl = `${appUrl}/api/telegram/webhook`;
        const result = await telegramRequest('setWebhook', { url: webhookUrl });
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

        console.log('Database initialized');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// --- BOOKINGS ---

// Get bookings for a date
app.get('/api/bookings/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 ORDER BY time',
            [date]
        );
        // Convert snake_case to camelCase
        const bookings = result.rows.map(row => ({
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
        }));
        res.json(bookings);
    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: err.message });
    }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
    try {
        const b = req.body;
        await pool.query(
            `INSERT INTO bookings (id, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, room, notes, created_by, linked_to, status, kids_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [b.id, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null]
        );
        res.json({ success: true, id: b.id });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete booking
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Delete linked bookings too
        await pool.query('DELETE FROM bookings WHERE id = $1 OR linked_to = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- LINES ---

// Get lines for a date
app.get('/api/lines/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await pool.query(
            'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id',
            [date]
        );

        if (result.rows.length === 0) {
            // Return default lines
            res.json([
                { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
                { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
            ]);
        } else {
            const lines = result.rows.map(row => ({
                id: row.line_id,
                name: row.name,
                color: row.color,
                fromSheet: row.from_sheet
            }));
            res.json(lines);
        }
    } catch (err) {
        console.error('Error fetching lines:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save lines for a date
app.post('/api/lines/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const lines = req.body;

        // Delete existing lines for this date
        await pool.query('DELETE FROM lines_by_date WHERE date = $1', [date]);

        // Insert new lines
        for (const line of lines) {
            await pool.query(
                'INSERT INTO lines_by_date (date, line_id, name, color, from_sheet) VALUES ($1, $2, $3, $4, $5)',
                [date, line.id, line.name, line.color, line.fromSheet || false]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving lines:', err);
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS ---

// --- STATS (v3.4) ---

app.get('/api/stats/:dateFrom/:dateTo', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.params;
        const result = await pool.query(
            'SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL ORDER BY date, time',
            [dateFrom, dateTo]
        );
        const bookings = result.rows.map(row => ({
            id: row.booking_id,
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
            room: row.room,
            status: row.status || 'confirmed',
            kidsCount: row.kids_count
        }));
        res.json(bookings);
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS ---

app.get('/api/settings/:key', async (req, res) => {
    try {
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
        res.json({ value: result.rows.length > 0 ? result.rows[0].value : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- TELEGRAM ---

// Get chat ID from bot updates (admin helper)
app.get('/api/telegram/chats', async (req, res) => {
    try {
        const chats = await getTelegramChatId();
        res.json({ chats });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// Daily digest endpoint
app.get('/api/telegram/digest/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const chatId = await getConfiguredChatId();

        const bookingsResult = await pool.query('SELECT * FROM bookings WHERE date = $1 ORDER BY time', [date]);
        const bookings = bookingsResult.rows;

        if (bookings.length === 0) {
            const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
            await sendTelegramMessage(chatId, text);
            return res.json({ success: true, count: 0 });
        }

        // Group by line
        const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]);
        const lines = linesResult.rows;

        let text = `📅 <b>Розклад на ${date}</b>\n`;
        text += `Всього бронювань: ${bookings.filter(b => !b.linked_to).length}\n\n`;

        for (const line of lines) {
            const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
            if (lineBookings.length === 0) continue;

            text += `👤 <b>${line.name}</b>\n`;
            for (const b of lineBookings) {
                const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + b.duration;
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
            text += '\n';
        }

        await sendTelegramMessage(chatId, text);
        res.json({ success: true, count: bookings.length });
    } catch (err) {
        console.error('Digest error:', err);
        res.status(500).json({ error: err.message });
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

        // Create pending record
        const pendingResult = await pool.query(
            'INSERT INTO pending_animators (date, note) VALUES ($1, $2) RETURNING id',
            [date, note || null]
        );
        const requestId = pendingResult.rows[0].id;

        // Get current animators on shift
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// Telegram webhook handler (callback queries) — v3.8
app.post('/api/telegram/webhook', async (req, res) => {
    try {
        const update = req.body;

        if (update.callback_query) {
            const { id, data, message } = update.callback_query;
            const chatId = message.chat.id;

            if (data.startsWith('add_anim:')) {
                const requestId = parseInt(data.split(':')[1]);

                // Get pending request
                const pending = await pool.query('SELECT * FROM pending_animators WHERE id = $1', [requestId]);
                if (pending.rows.length === 0 || pending.rows[0].status !== 'pending') {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                const date = pending.rows[0].date;

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

                // Update pending status
                await pool.query('UPDATE pending_animators SET status = $1 WHERE id = $2', ['approved', requestId]);

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

                // Update pending status
                await pool.query('UPDATE pending_animators SET status = $1 WHERE id = $2', ['rejected', requestId]);

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

// Start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
