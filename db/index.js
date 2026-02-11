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

pool.on('error', (err) => {
    log.error('Unexpected database pool error', err);
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

        // v7.4: Event type (event/birthday/regular)
        await pool.query(`ALTER TABLE afisha ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'event'`);

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

        // v7.0: Products catalog table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id VARCHAR(50) PRIMARY KEY,
                code VARCHAR(20) NOT NULL,
                label VARCHAR(100) NOT NULL,
                name VARCHAR(200) NOT NULL,
                icon VARCHAR(10),
                category VARCHAR(50) NOT NULL,
                duration INTEGER NOT NULL,
                price INTEGER NOT NULL DEFAULT 0,
                hosts INTEGER NOT NULL DEFAULT 1,
                age_range VARCHAR(30),
                kids_capacity VARCHAR(30),
                description TEXT,
                is_per_child BOOLEAN DEFAULT FALSE,
                has_filler BOOLEAN DEFAULT FALSE,
                is_custom BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                updated_by VARCHAR(50)
            )
        `);

        // v7.0: Seed products from PROGRAMS if table is empty
        const productCount = await pool.query('SELECT COUNT(*) FROM products');
        if (parseInt(productCount.rows[0].count) === 0) {
            await seedProducts();
            log.info('Products catalog seeded (40 products)');
        }

        await pool.query('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active)');

        // v7.5: Tasks table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                date VARCHAR(20),
                status VARCHAR(20) DEFAULT 'todo',
                priority VARCHAR(20) DEFAULT 'normal',
                assigned_to VARCHAR(50),
                created_by VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date)');

        // v7.6: Link tasks to afisha events
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS afisha_id INTEGER`);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_afisha_id ON tasks(afisha_id)');

        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(date, status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_line_date ON bookings(line_id, date)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_linked_to ON bookings(linked_to)');
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

// v7.0: Seed products catalog from hardcoded PROGRAMS data
async function seedProducts() {
    const products = [
        // Квести
        { id: 'kv1', code: 'КВ1', label: 'КВ1(60)', name: 'Легендарний тренд', icon: '🎭', category: 'quest', duration: 60, price: 2200, hosts: 1, age_range: '5-10р', kids_capacity: '4-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 1 },
        { id: 'kv4', code: 'КВ4', label: 'КВ4(60)', name: 'Шпигунська історія', icon: '🕵️', category: 'quest', duration: 60, price: 2800, hosts: 2, age_range: '5-12р', kids_capacity: '4-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 2 },
        { id: 'kv5', code: 'КВ5', label: 'КВ5(60)', name: 'Щенячий патруль', icon: '🐕', category: 'quest', duration: 60, price: 2700, hosts: 2, age_range: '3-7р', kids_capacity: '3-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 3 },
        { id: 'kv6', code: 'КВ6', label: 'КВ6(90)', name: 'Лісова Академія', icon: '🌲', category: 'quest', duration: 90, price: 2100, hosts: 1, age_range: '4-10р', kids_capacity: '4-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 4 },
        { id: 'kv7', code: 'КВ7', label: 'КВ7(60)', name: 'Гра в Кальмара', icon: '🦑', category: 'quest', duration: 60, price: 3300, hosts: 2, age_range: '5-12р', kids_capacity: '5-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 5 },
        { id: 'kv8', code: 'КВ8', label: 'КВ8(60)', name: 'MineCraft 2', icon: '⛏️', category: 'quest', duration: 60, price: 2900, hosts: 2, age_range: '6-12р', kids_capacity: '5-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 6 },
        { id: 'kv9', code: 'КВ9', label: 'КВ9(60)', name: 'Ліга Світла', icon: '🦇', category: 'quest', duration: 60, price: 2500, hosts: 2, age_range: '4-10р', kids_capacity: '3-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 7 },
        { id: 'kv10', code: 'КВ10', label: 'КВ10(60)', name: 'Бібліотека Чарів', icon: '📚', category: 'quest', duration: 60, price: 3000, hosts: 2, age_range: '5-16р', kids_capacity: '3-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 8 },
        { id: 'kv11', code: 'КВ11', label: 'КВ11(60)', name: 'Секретна скарбів', icon: '💎', category: 'quest', duration: 60, price: 2500, hosts: 2, age_range: '5-12р', kids_capacity: '4-10', is_per_child: false, has_filler: false, is_custom: false, sort_order: 9 },
        // Анімація
        { id: 'anim60', code: 'АН', label: 'АН(60)', name: 'Анімація 60хв', icon: '🎪', category: 'animation', duration: 60, price: 1500, hosts: 1, age_range: '3-9р', kids_capacity: '2-8', is_per_child: false, has_filler: false, is_custom: false, sort_order: 1 },
        { id: 'anim120', code: 'АН', label: 'АН(120)', name: 'Анімація 120хв', icon: '🎠', category: 'animation', duration: 120, price: 2500, hosts: 1, age_range: '3-9р', kids_capacity: '2-8', is_per_child: false, has_filler: false, is_custom: false, sort_order: 2 },
        // Шоу
        { id: 'bubble', code: 'Бульб', label: 'Бульб(30)', name: 'Бульбашкове шоу', icon: '🔵', category: 'show', duration: 30, price: 2400, hosts: 1, age_range: '2-6р', kids_capacity: '2-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 1 },
        { id: 'neon_bubble', code: 'Неон', label: 'Неон(30)', name: 'Шоу неон-бульбашок', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1, age_range: '2-8р', kids_capacity: '2-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 2 },
        { id: 'paper', code: 'Папір', label: 'Папір(30)', name: 'Паперове Неон-шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2, age_range: '4-12р', kids_capacity: '4-14', is_per_child: false, has_filler: false, is_custom: false, sort_order: 3 },
        { id: 'dry_ice', code: 'Лід', label: 'Лід(40)', name: 'Шоу з сухим льодом', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1, age_range: '4-10р', kids_capacity: '2-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 4 },
        { id: 'football', code: 'Футб', label: 'Футб(90)', name: 'Футбольне шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1, age_range: '5-12р', kids_capacity: '2-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 5 },
        { id: 'mafia', code: 'Мафія', label: 'Мафія(90)', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1, age_range: '4-10р', kids_capacity: '2-16', is_per_child: false, has_filler: false, is_custom: false, sort_order: 6 },
        // Фото
        { id: 'photo60', code: 'Фото', label: 'Фото(60)', name: 'Фотосесія 60хв', icon: '📸', category: 'photo', duration: 60, price: 1600, hosts: 1, age_range: null, kids_capacity: null, is_per_child: false, has_filler: false, is_custom: false, sort_order: 1 },
        { id: 'photo_magnets', code: 'Фото+', label: 'Фото+(60)', name: 'Фотосесія + магніти', icon: '📸🧲', category: 'photo', duration: 60, price: 2600, hosts: 1, age_range: null, kids_capacity: null, is_per_child: false, has_filler: false, is_custom: false, sort_order: 2 },
        { id: 'photo_magnet_extra', code: 'Магн', label: 'Магн', name: 'Додатковий магніт', icon: '🧲', category: 'photo', duration: 0, price: 290, hosts: 0, age_range: null, kids_capacity: null, is_per_child: true, has_filler: false, is_custom: false, sort_order: 3 },
        { id: 'video', code: 'Відео', label: 'Відео', name: 'Аніматорська відеозйомка', icon: '🎥', category: 'photo', duration: 0, price: 6000, hosts: 0, age_range: null, kids_capacity: null, is_per_child: false, has_filler: false, is_custom: false, sort_order: 4 },
        // Майстер-класи
        { id: 'mk_candy', code: 'МК', label: 'Цукерки(90)', name: 'МК Цукерки', icon: '🍬', category: 'masterclass', duration: 90, price: 370, hosts: 1, age_range: 'від 7р', kids_capacity: '5-25', is_per_child: true, has_filler: false, is_custom: false, sort_order: 1 },
        { id: 'mk_thermomosaic', code: 'МК', label: 'Термо(45)', name: 'МК Термомозаїка', icon: '🔲', category: 'masterclass', duration: 45, price: 390, hosts: 1, age_range: 'від 5р', kids_capacity: '5-50', is_per_child: true, has_filler: false, is_custom: false, sort_order: 2 },
        { id: 'mk_slime', code: 'МК', label: 'Слайм(45)', name: 'МК Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 390, hosts: 1, age_range: 'від 4р', kids_capacity: '5-50', is_per_child: true, has_filler: false, is_custom: false, sort_order: 3 },
        { id: 'mk_tshirt', code: 'МК', label: 'Футб(90)', name: 'МК Розпис футболок', icon: '👕', category: 'masterclass', duration: 90, price: 450, hosts: 1, age_range: 'від 6р', kids_capacity: '5-25', is_per_child: true, has_filler: false, is_custom: false, sort_order: 4 },
        { id: 'mk_cookie', code: 'МК', label: 'Прян(60)', name: 'МК Розпис пряників', icon: '🍪', category: 'masterclass', duration: 60, price: 300, hosts: 1, age_range: 'від 5р', kids_capacity: '5-50', is_per_child: true, has_filler: false, is_custom: false, sort_order: 5 },
        { id: 'mk_ecobag', code: 'МК', label: 'Сумки(75)', name: 'МК Розпис еко-сумок', icon: '👜', category: 'masterclass', duration: 75, price: 390, hosts: 1, age_range: 'від 4р', kids_capacity: '5-50', is_per_child: true, has_filler: false, is_custom: false, sort_order: 6 },
        { id: 'mk_pizza_classic', code: 'МК', label: 'Піца(45)', name: 'МК Класична піца', icon: '🍕', category: 'masterclass', duration: 45, price: 290, hosts: 1, age_range: 'від 4р', kids_capacity: '5-20', is_per_child: true, has_filler: false, is_custom: false, sort_order: 7 },
        { id: 'mk_pizza_custom', code: 'МК', label: 'ПіцаК(45)', name: 'МК Кастомна піца', icon: '🍕‍🔥', category: 'masterclass', duration: 45, price: 430, hosts: 1, age_range: 'від 4р', kids_capacity: '5-29', is_per_child: true, has_filler: false, is_custom: false, sort_order: 8 },
        { id: 'mk_cakepops', code: 'МК', label: 'Кейки(90)', name: 'МК Кейк-попси', icon: '🍡', category: 'masterclass', duration: 90, price: 330, hosts: 1, age_range: 'від 6р', kids_capacity: '5-50', is_per_child: true, has_filler: false, is_custom: false, sort_order: 9 },
        { id: 'mk_cupcake', code: 'МК', label: 'Капк(120)', name: 'МК Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 450, hosts: 1, age_range: 'від 4р', kids_capacity: '5-20', is_per_child: true, has_filler: false, is_custom: false, sort_order: 10 },
        { id: 'mk_soap', code: 'МК', label: 'Мило(90)', name: 'МК Миловаріння', icon: '🧼', category: 'masterclass', duration: 90, price: 450, hosts: 1, age_range: 'від 6р', kids_capacity: '5-20', is_per_child: true, has_filler: false, is_custom: false, sort_order: 11 },
        // Піньяти
        { id: 'pinata', code: 'Пін', label: 'Пін(15)', name: 'Піньята', icon: '🪅', category: 'pinata', duration: 15, price: 700, hosts: 1, age_range: '2-99р', kids_capacity: 'до 15', is_per_child: false, has_filler: true, is_custom: false, sort_order: 1 },
        { id: 'pinata_custom', code: 'ПінН', label: 'ПінН(15)', name: 'Піньята PRO', icon: '🪅⭐', category: 'pinata', duration: 15, price: 1000, hosts: 1, age_range: '2-99р', kids_capacity: 'до 15', is_per_child: false, has_filler: true, is_custom: false, sort_order: 2 },
        // Кастом
        { id: 'custom', code: 'Інше', label: 'Інше', name: 'Інше (вкажіть)', icon: '✏️', category: 'custom', duration: 30, price: 0, hosts: 1, age_range: null, kids_capacity: null, is_per_child: false, has_filler: false, is_custom: true, sort_order: 1 }
    ];

    for (const p of products) {
        await pool.query(
            `INSERT INTO products (id, code, label, name, icon, category, duration, price, hosts, age_range, kids_capacity, is_per_child, has_filler, is_custom, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'system')
             ON CONFLICT (id) DO NOTHING`,
            [p.id, p.code, p.label, p.name, p.icon, p.category, p.duration, p.price, p.hosts, p.age_range, p.kids_capacity, p.is_per_child, p.has_filler, p.is_custom, p.sort_order]
        );
    }
}

module.exports = { pool, initDatabase, generateBookingNumber };
