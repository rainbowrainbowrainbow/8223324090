const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

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

// --- HEALTH CHECK ---
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.json({ status: 'ok', database: 'not connected' });
    }
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
