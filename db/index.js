/**
 * db/index.js — Database pool + initialization
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { createLogger } = require('../utils/logger');

const log = createLogger('DB');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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

        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'confirmed'`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS kids_count INTEGER`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS costume VARCHAR(100)`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_name VARCHAR(100)`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS telegram_message_id INTEGER`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_animators (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                note TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_known_chats (
                chat_id BIGINT PRIMARY KEY,
                title VARCHAR(200),
                type VARCHAR(50),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_known_threads (
                thread_id INTEGER NOT NULL,
                chat_id BIGINT NOT NULL,
                title VARCHAR(200),
                updated_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (chat_id, thread_id)
            )
        `);

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
            log.info('Default users seeded');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS booking_counter (
                year INTEGER PRIMARY KEY,
                counter INTEGER NOT NULL DEFAULT 0
            )
        `);

        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_lines_by_date_date ON lines_by_date(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)');

        log.info('Database initialized');
    } catch (err) {
        log.error('Database init error', err);
    }
}

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

module.exports = { pool, initDatabase, generateBookingNumber };
