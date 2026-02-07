/**
 * db/index.js — Database connection pool + initialization
 *
 * SRP: цей модуль відповідає ТІЛЬКИ за підключення до БД та створення таблиць.
 * Він не знає про Express, Telegram чи бізнес-логіку.
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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

        // Super-admin Sergey
        const sergeyExists = await pool.query("SELECT id FROM users WHERE username = 'Sergey'");
        if (sergeyExists.rows.length === 0) {
            const hash = await bcrypt.hash('28uUdusas', 10);
            await pool.query(
                'INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
                ['Sergey', hash, 'admin', 'Сергій']
            );
            console.log('[Seed] Super-admin Sergey created');
        }

        // Seed users from env
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count) <= 1) {
            const seedUsersEnv = process.env.SEED_USERS;
            if (seedUsersEnv) {
                try {
                    const defaultUsers = JSON.parse(seedUsersEnv);
                    for (const u of defaultUsers) {
                        if (!u.username || !u.password || !u.role || !u.name) continue;
                        if (u.username === 'Sergey') continue;
                        const hash = await bcrypt.hash(u.password, 10);
                        await pool.query(
                            'INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
                            [u.username, hash, u.role, u.name]
                        );
                    }
                    console.log('[Seed] Additional users seeded from SEED_USERS env');
                } catch (parseErr) {
                    console.error('[Seed] Failed to parse SEED_USERS env:', parseErr.message);
                }
            }
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS booking_counter (
                year INTEGER PRIMARY KEY,
                counter INTEGER NOT NULL DEFAULT 0
            )
        `);

        // Indexes
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_lines_by_date_date ON lines_by_date(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(date, status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date_line_id ON bookings(date, line_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date_room ON bookings(date, room)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date_program_id ON bookings(date, program_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_history_action ON history(action)');

        console.log('Database initialized');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

module.exports = { pool, initDatabase };
