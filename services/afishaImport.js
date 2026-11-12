'use strict';

const { validateDate, validateTime } = require('./booking');
const { insertHistory } = require('./historyLog');

const MAX_EVENTS = 300;
const TYPES = new Set(['event', 'birthday', 'greeting', 'regular']);
const DAYS = {
    'щодня': [0, 1, 2, 3, 4, 5, 6],
    'будні': [1, 2, 3, 4, 5],
    'вихідні': [0, 6],
    'пн': [1], 'вт': [2], 'ср': [3], 'чт': [4], 'пт': [5], 'сб': [6], 'нд': [0]
};

function invalid(message, line) {
    return Object.assign(new Error(line ? `Рядок ${line}. ${message}` : message), { statusCode: 400 });
}

function* readRows(text) {
    // Quoted fields also accept semicolons and line breaks from Afisha CSV exports.
    const fieldPattern = / *(?:"((?:""|[^"])*)" *|([^;"\n]*))([;\n]|$)/y;
    let fields = [];
    let line = 1;
    let rowLine = 1;
    for (let offset = 0; offset < text.length;) {
        fieldPattern.lastIndex = offset;
        const match = fieldPattern.exec(text);
        if (!match) throw invalid('Перевірте лапки та роздільники.', rowLine);
        offset = fieldPattern.lastIndex;
        const [, quoted, plain, delimiter] = match;
        fields.push((quoted === undefined ? plain : quoted.replace(/""/g, '"')).trim());
        line += match[0].split('\n').length - 1;
        if (delimiter === ';' && offset < text.length) continue;
        if (delimiter === ';') fields.push('');
        if (fields.some(Boolean)) yield { fields, line: rowLine };
        fields = [];
        rowLine = line;
    }
}

function datesForDay(day, month, line) {
    if (validateDate(day)) return [day];
    if (typeof month !== 'string' || !validateDate(`${month}-01`)) {
        throw invalid('Оберіть місяць для короткого формату.', line);
    }
    if (/^\d{1,2}$/.test(day)) {
        const date = `${month}-${day.padStart(2, '0')}`;
        if (!validateDate(date)) throw invalid('Такого дня немає в обраному місяці.', line);
        return [date];
    }
    const weekdays = Object.hasOwn(DAYS, day.toLowerCase()) ? DAYS[day.toLowerCase()] : null;
    if (!weekdays) throw invalid('Вкажіть число місяця або правило повторення.', line);
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const dates = [];
    for (let dayNumber = 1; dayNumber <= lastDay; dayNumber++) {
        if (weekdays.includes(new Date(Date.UTC(year, monthNumber - 1, dayNumber)).getUTCDay())) {
            dates.push(`${month}-${String(dayNumber).padStart(2, '0')}`);
        }
    }
    return dates;
}

function parseAfishaImport({ text, month, date: defaultDate } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw invalid('Вставте розклад для імпорту.');
    if (text.length > 32000 || text.includes('\0')) throw invalid('Перевірте текст. Максимум 32 000 символів.');
    const events = new Map();
    let repeated = 0;
    for (const { fields, line } of readRows(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))) {
        if (line === 1 && fields.join(';').toLowerCase() === 'date;time;duration;title;description;type') continue;
        const timeFirst = /^\d{1,2}:/.test(fields[0]);
        if (timeFirst && !validateDate(defaultDate)) throw invalid('Оберіть дату для рядків без дня місяця.', line);
        const [day, time, ...details] = timeFirst ? [defaultDate, ...fields] : fields;
        const csv = /^\d{4}-/.test(day);
        const legacyCsv = csv && !timeFirst;
        if (details.length < (legacyCsv ? 2 : 1) || details.length > (legacyCsv ? 4 : 2)) {
            throw invalid('Перевірте кількість полів і розділіть їх крапкою з комою.', line);
        }
        const [title, minutes, description = '', typeValue = ''] = legacyCsv
            ? [details[1], details[0], details[2], details[3]]
            : details;
        const type = typeValue || 'event';
        if (!TYPES.has(type)) throw invalid('Невідомий тип події.', line);
        if (!validateTime(time)) throw invalid('Вкажіть час у форматі ГГ:ХХ.', line);
        if (!title || title.length > 200) throw invalid('Назва має містити від 1 до 200 символів.', line);
        const duration = type === 'birthday' || type === 'greeting' ? 15 : Number(minutes || 60);
        if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
            throw invalid('Тривалість має бути цілим числом від 1 до 1440 хвилин.', line);
        }
        if (csv && !validateDate(day)) throw invalid('Перевірте дату у форматі РРРР-ММ-ДД.', line);
        for (const date of datesForDay(day, month, line)) {
            const key = JSON.stringify([date, time, title, type]);
            if (events.has(key)) {
                repeated++;
            } else {
                events.set(key, { date, time, title, duration, type, description });
            }
            if (events.size + repeated > MAX_EVENTS) throw invalid(`За один раз можна підготувати до ${MAX_EVENTS} подій.`, line);
        }
    }
    if (!events.size) throw invalid('У розкладі немає подій для імпорту.');
    const items = [...events.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    return { items, repeated };
}

async function importAfishaEvents(pool, { items, repeated }, username) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serialize imports so that a retry checks for rows committed by the first request.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('afisha_schedule_import'))");
        const { rows } = await client.query(
            `INSERT INTO afisha (date, time, title, duration, type, description, original_time)
             SELECT item.date, item.time, item.title, item.duration, item.type, NULLIF(item.description, ''), item.time
             FROM jsonb_to_recordset($1::jsonb) AS item(date text, time text, title text, duration int, type text, description text)
             WHERE NOT EXISTS (
                 SELECT 1 FROM afisha a WHERE a.date = item.date AND a.time = item.time
                     AND btrim(a.title) = item.title AND COALESCE(a.type, 'event') = item.type
             )
             RETURNING id, date, time, title, duration, type`,
            [JSON.stringify(items)]
        );
        for (const item of rows) {
            await insertHistory(client, { action: 'afisha_create', username, data: item });
        }
        await client.query('COMMIT');
        return { created: rows.length, skipped: items.length - rows.length + repeated };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { parseAfishaImport, importAfishaEvents };
