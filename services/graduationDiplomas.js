const crypto = require('crypto');

const VALID_GENDERS = new Set(['boy', 'girl', 'neutral', 'unspecified']);
const VALID_GENDER_SOURCES = new Set(['manual', 'suggested', 'imported', 'unknown']);
const VALID_DIPLOMA_STATUSES = new Set(['draft', 'generated', 'printed', 'exported']);

const DEFAULT_DIPLOMA_TEMPLATE = {
    code: 'classic-graduation-2026',
    name: 'Комікс-диплом випускника',
    titleText: 'ДИПЛОМ ВИПУСКНИКА',
    subtitleText: 'за успішне завершення навчання,\nстаранність, допитливість\nта яскраві досягнення',
    footerText: '',
    principalName: '',
    principalRole: '',
    palette: {
        paper: '#dfff1f',
        ink: '#1554ff',
        muted: '#2c76ff',
        gold: '#fff200',
        goldSoft: '#f2ff58',
        accent: '#ff3b14'
    },
    layout: {
        format: 'a4-portrait',
        backgroundImageUrl: '/images/graduation/diploma-comic-template.png',
        sealLogoUrl: '/images/park-logo.png',
        officialFooter: '',
        style: 'comic-template-overlay'
    },
    artworkImageUrl: null
};

const COMMON_GIRL_NAMES = new Set([
    'анна', 'аня', 'анастасія', 'настя', 'софія', 'софія', 'марія', 'маша', 'вікторія', 'віка',
    'поліна', 'олена', 'аліна', 'аріна', 'дарина', 'діана', 'катерина', 'каріна', 'єва', 'вероніка',
    'валерія', 'варвара', 'злата', 'юлія', 'яна', 'ксенія', 'мія', 'мілана', 'соломія', 'емілія'
]);

const COMMON_BOY_NAMES = new Set([
    'артем', 'максим', 'олександр', 'саша', 'данило', 'дмитро', 'матвій', 'михайло', 'богдан',
    'іван', 'кіріл', 'кирил', 'лев', 'марко', 'тимофій', 'тимур', 'єгор', 'захар', 'роман',
    'денис', 'андрій', 'назар', 'павло', 'владислав', 'ілья', 'микита', 'олексій', 'ярослав'
]);

const WISH_POOLS = {
    girl: [
        'Нехай кожен новий день відкриває для тебе цікаві ідеї, добрих друзів і сміливі мрії.',
        'Бажаємо тобі впевнено йти вперед, берегти свою усмішку і завжди вірити у власні сили.',
        'Нехай у новій школярській пригоді буде багато радості, відкриттів і красивих перемог.',
        'Бажаємо тобі сяяти знаннями, добротою і талантом у кожній справі, за яку берешся.',
        'Нехай поруч завжди будуть люди, які підтримують, надихають і радіють твоїм успіхам.',
        'Бажаємо легких стартів, великих мрій і серця, яке сміливо обирає добро.',
        'Нехай твої плани ростуть разом із тобою, а кожна перемога додає впевненості.',
        'Бажаємо тобі творчості, натхнення і щасливих моментів, які хочеться пам’ятати.'
    ],
    boy: [
        'Нехай кожен новий крок приносить тобі цікаві відкриття, друзів і чесні перемоги.',
        'Бажаємо тобі сміливо ставити цілі, вірити у себе і знаходити рішення навіть у складних задачах.',
        'Нехай попереду буде багато пригод, знань і моментів, якими можна пишатися.',
        'Бажаємо сили характеру, допитливості і радості від кожного нового досягнення.',
        'Нехай твої мрії стають планами, а плани - впевненими діями.',
        'Бажаємо тобі добрих друзів, ясних думок і сміливості пробувати нове.',
        'Нехай навчання буде цікавим, перемоги - заслуженими, а настрій - світлим.',
        'Бажаємо рости сильним, уважним і відкритим до великих можливостей.'
    ],
    neutral: [
        'Нехай попереду буде багато відкриттів, добрих людей і щасливих приводів усміхатися.',
        'Бажаємо впевненості, цікавості і радості від кожного нового кроку.',
        'Нехай цей випускний стане красивим стартом для наступних перемог і мрій.',
        'Бажаємо легкого навчання, щирих друзів і натхнення на добрі справи.',
        'Нехай кожен день додає знань, сміливості і світлих спогадів.',
        'Бажаємо бачити можливості, не боятися нового і пишатися своїми досягненнями.',
        'Нехай поруч завжди буде підтримка, а попереду - цікава дорога.',
        'Бажаємо радості, здоров’я, дружби і красивих мрій, які поступово здійснюються.'
    ]
};

function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseJsonField(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toCamelTemplate(row) {
    if (!row) return { ...DEFAULT_DIPLOMA_TEMPLATE };
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        isDefault: row.is_default,
        titleText: row.title_text,
        subtitleText: row.subtitle_text,
        footerText: row.footer_text,
        principalName: row.principal_name,
        principalRole: row.principal_role,
        palette: parseJsonField(row.palette_json, DEFAULT_DIPLOMA_TEMPLATE.palette),
        layout: parseJsonField(row.layout_json, DEFAULT_DIPLOMA_TEMPLATE.layout),
        artworkImageUrl: row.artwork_image_url,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function splitName(fullName) {
    const clean = String(fullName || '').replace(/\s+/g, ' ').trim();
    const parts = clean.split(' ').filter(Boolean);
    return {
        fullName: clean,
        firstName: parts[0] || '',
        lastName: parts.length > 1 ? parts[parts.length - 1] : ''
    };
}

function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (['boy', 'male', 'm', 'х', 'хлопчик', 'хлопець'].includes(raw)) return 'boy';
    if (['girl', 'female', 'f', 'ж', 'дівчинка', 'дівчина'].includes(raw)) return 'girl';
    if (['neutral', 'нейтрально', 'н'].includes(raw)) return 'neutral';
    if (['unspecified', 'unknown', ''].includes(raw)) return 'unspecified';
    return VALID_GENDERS.has(raw) ? raw : 'unspecified';
}

function suggestGenderFromName(name) {
    const first = splitName(name).firstName.toLowerCase();
    if (!first) return { gender: 'neutral', source: 'unknown', confidence: 'low' };
    if (COMMON_GIRL_NAMES.has(first)) return { gender: 'girl', source: 'suggested', confidence: 'high' };
    if (COMMON_BOY_NAMES.has(first)) return { gender: 'boy', source: 'suggested', confidence: 'high' };
    if (first.endsWith('а') || first.endsWith('я')) return { gender: 'girl', source: 'suggested', confidence: 'low' };
    if (first.endsWith('о') || first.endsWith('р') || first.endsWith('н') || first.endsWith('й')) {
        return { gender: 'boy', source: 'suggested', confidence: 'low' };
    }
    return { gender: 'neutral', source: 'unknown', confidence: 'low' };
}

function normalizeChildInput(input = {}, { importMode = false } = {}) {
    const names = splitName(input.fullName || input.full_name || input.name);
    if (!names.fullName) {
        const err = new Error('fullName is required');
        err.statusCode = 400;
        throw err;
    }

    const providedGender = normalizeGender(input.gender);
    let gender = providedGender;
    let genderSource = input.genderSource || input.gender_source;
    let genderConfidence = input.genderConfidence || input.gender_confidence || null;
    if (!genderSource || !VALID_GENDER_SOURCES.has(String(genderSource))) {
        if (providedGender && providedGender !== 'unspecified') {
            genderSource = importMode ? 'imported' : 'manual';
        } else {
            const suggestion = suggestGenderFromName(names.firstName || names.fullName);
            gender = suggestion.gender;
            genderSource = suggestion.source;
            genderConfidence = suggestion.confidence;
        }
    }

    const customWish = String(input.customWish ?? input.custom_wish ?? '').trim();
    const autoWish = String(input.autoWish ?? input.auto_wish ?? '').trim();
    const finalWish = customWish || String(input.finalWish ?? input.final_wish ?? '').trim() || autoWish;

    return {
        fullName: names.fullName,
        firstName: String(input.firstName || input.first_name || names.firstName || '').trim(),
        lastName: String(input.lastName || input.last_name || names.lastName || '').trim(),
        gender,
        genderSource,
        genderConfidence,
        classLabel: String(input.classLabel || input.class_label || '').trim(),
        customWish,
        autoWish,
        finalWish,
        diplomaTitleOverride: String(input.diplomaTitleOverride || input.diploma_title_override || '').trim(),
        diplomaStatus: VALID_DIPLOMA_STATUSES.has(input.diplomaStatus || input.diploma_status)
            ? (input.diplomaStatus || input.diploma_status)
            : 'draft'
    };
}

function mapChildRow(row) {
    return {
        id: row.id,
        graduationQuoteId: row.graduation_quote_id,
        bookingId: row.booking_id,
        fullName: row.full_name,
        firstName: row.first_name,
        lastName: row.last_name,
        gender: row.gender,
        genderSource: row.gender_source,
        genderConfidence: row.gender_confidence,
        classLabel: row.class_label,
        customWish: row.custom_wish,
        autoWish: row.auto_wish,
        finalWish: row.final_wish,
        diplomaTitleOverride: row.diploma_title_override,
        diplomaStatus: row.diploma_status,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function hashIndex(seed, length) {
    if (!length) return 0;
    const hash = crypto.createHash('sha1').update(String(seed || '')).digest();
    return hash[0] % length;
}

function pickWish(child, used = new Set(), index = 0) {
    const gender = child.gender === 'girl' || child.gender === 'boy' ? child.gender : 'neutral';
    const pool = WISH_POOLS[gender] || WISH_POOLS.neutral;
    const start = hashIndex(`${child.fullName}:${child.id || index}:${gender}`, pool.length);
    for (let offset = 0; offset < pool.length; offset += 1) {
        const wish = pool[(start + offset + index) % pool.length];
        if (!used.has(wish)) {
            used.add(wish);
            return wish;
        }
    }
    return pool[start];
}

function parseRosterImport(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines.map((line) => {
        const parts = line.split(';').map(part => part.trim());
        return normalizeChildInput({
            fullName: parts[0],
            gender: parts[1] || '',
            classLabel: parts[2] || '',
            customWish: parts[3] || ''
        }, { importMode: true });
    });
}

function buildDiplomaPage(child, template = DEFAULT_DIPLOMA_TEMPLATE, quote = {}) {
    template = template || DEFAULT_DIPLOMA_TEMPLATE;
    const palette = { ...DEFAULT_DIPLOMA_TEMPLATE.palette, ...(template.palette || {}) };
    const layout = { ...DEFAULT_DIPLOMA_TEMPLATE.layout, ...(template.layout || {}) };
    const title = child.diplomaTitleOverride || template.titleText || DEFAULT_DIPLOMA_TEMPLATE.titleText;
    const wish = child.customWish || child.finalWish || child.autoWish || pickWish(child);
    const classLine = child.classLabel ? `<div class="diploma-text diploma-school">${escHtml(child.classLabel)}</div>` : '';
    const displayName = escHtml(child.fullName).replace(/-/g, '&#8209;');
    const nameLength = String(child.fullName || '').length;
    const nameClass = nameLength > 44 ? ' is-very-long' : (nameLength > 30 ? ' is-long' : '');
    const sealLogoUrl = layout.sealLogoUrl || DEFAULT_DIPLOMA_TEMPLATE.layout.sealLogoUrl;
    const backgroundImageUrl = layout.backgroundImageUrl || DEFAULT_DIPLOMA_TEMPLATE.layout.backgroundImageUrl;
    const issueDate = new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kyiv' });
    const signature = String(template.principalRole || '').trim();
    return `
<section class="diploma-page" style="--paper:${palette.paper};--ink:${palette.ink};--muted:${palette.muted};--gold:${palette.gold};--gold-soft:${palette.goldSoft};--accent:${palette.accent};">
    <img class="diploma-template-bg" src="${escHtml(backgroundImageUrl)}" alt="" aria-hidden="true">
    <div class="diploma-content">
        <h1 class="diploma-text diploma-title">${escHtml(title)}</h1>
        <div class="diploma-text diploma-awarded">Нагороджується</div>
        <div class="diploma-text diploma-name${nameClass}">${displayName}</div>
        <div class="diploma-text diploma-description">${escHtml(template.subtitleText || DEFAULT_DIPLOMA_TEMPLATE.subtitleText)}</div>
        <div class="diploma-text diploma-wish">${escHtml(wish)}</div>
        <div class="diploma-text diploma-date">${escHtml(issueDate)}</div>
        ${signature ? `<div class="diploma-text diploma-signature">${escHtml(signature)}</div>` : ''}
        ${classLine}
        <img class="diploma-park-logo" src="${escHtml(sealLogoUrl)}" alt="Парк Закревського періоду">
    </div>
</section>`;
}

function buildDiplomaDocument(children, template, quote = {}, { autoPrint = false, title = 'Дипломи випускників' } = {}) {
    const childList = Array.isArray(children) ? children : [];
    const pages = childList.map((child) => buildDiplomaPage(child, template, quote)).join('\n');
    return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@500;700&family=Montserrat+Alternates:wght@600;700;800&family=Nunito:wght@500;700;900&display=swap');
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #b7f000; color: #123b8f; font-family: "Nunito", "Montserrat Alternates", "Trebuchet MS", system-ui, sans-serif; }
.diploma-toolbar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 18px; background: #15120d; color: #fff; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.diploma-toolbar strong { font-size: 15px; }
.diploma-toolbar button { border: 0; border-radius: 10px; padding: 10px 14px; background: #b8860b; color: #fff; font-weight: 800; cursor: pointer; }
.diploma-page { width: 210mm; height: 297mm; margin: 14px auto; position: relative; overflow: hidden; background: var(--paper); color: var(--ink); page-break-after: always; break-after: page; box-shadow: 0 22px 70px rgba(21,84,255,0.24); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.diploma-template-bg { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: fill; pointer-events: none; user-select: none; }
.diploma-content { position: relative; z-index: 2; width: 100%; height: 100%; }
.diploma-text { position: absolute; transform: translateX(-50%); text-align: center; overflow: hidden; white-space: pre-line; overflow-wrap: break-word; text-wrap: balance; }
.diploma-title { left: 50%; top: 16.9%; width: 74%; color: #ffe600; font-family: "Montserrat Alternates", "Comfortaa", "Arial Rounded MT Bold", "Arial Black", sans-serif; font-size: 42px; line-height: 1.04; font-weight: 800; letter-spacing: 0; text-transform: uppercase; white-space: nowrap; -webkit-text-stroke: 1.6px #f05a24; text-shadow: 0 3px 0 #f05a24, 0 7px 12px rgba(91,120,0,0.18); max-height: 58px; }
.diploma-awarded { left: 50%; top: 25.1%; width: 63.48%; color: #d85a1b; font-family: "Comfortaa", "Montserrat Alternates", "Trebuchet MS", sans-serif; font-size: 32px; line-height: 1.18; font-weight: 700; max-height: 54px; text-shadow: 0 2px 0 rgba(255,255,255,0.72); }
.diploma-name { left: 50%; top: 30.6%; width: 68.36%; color: #2459a8; font-family: "Montserrat Alternates", "Comfortaa", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif; font-size: 48px; line-height: 1.12; font-weight: 800; max-height: 118px; text-shadow: 0 2px 0 rgba(255,255,255,0.95), 0 5px 12px rgba(47,100,184,0.14); }
.diploma-name.is-long { font-size: 40px; line-height: 1.08; }
.diploma-name.is-very-long { font-size: 34px; line-height: 1.06; }
.diploma-description { left: 50%; top: 42%; width: 66.4%; color: #3c67b1; font-family: "Nunito", "Montserrat Alternates", "Trebuchet MS", sans-serif; font-size: 30px; line-height: 1.22; font-weight: 700; max-height: 148px; text-shadow: 0 1px 0 rgba(255,255,255,0.74); }
.diploma-wish { left: 50%; top: 54.69%; width: 67.38%; color: #e75a1c; font-family: "Comfortaa", "Montserrat Alternates", "Trebuchet MS", sans-serif; font-size: 31px; line-height: 1.24; font-weight: 700; max-height: 118px; text-shadow: 0 2px 0 rgba(255,255,255,0.68); }
.diploma-date { left: 29.3%; top: 70.31%; width: 27.34%; color: #2f64b8; font-family: "Montserrat Alternates", "Nunito", "Trebuchet MS", sans-serif; font-size: 26px; line-height: 1.12; font-weight: 800; max-height: 48px; text-shadow: 0 1px 0 rgba(255,255,255,0.76); }
.diploma-signature { left: 70.31%; top: 70.31%; width: 29.3%; color: #2f64b8; font-family: "Comfortaa", "Trebuchet MS", sans-serif; font-size: 25px; line-height: 1.15; font-weight: 700; max-height: 62px; }
.diploma-school { left: 50%; top: 75.52%; width: 60.55%; color: #2f64b8; font-family: "Montserrat Alternates", "Nunito", "Trebuchet MS", sans-serif; font-size: 28px; line-height: 1.18; font-weight: 800; max-height: 78px; text-shadow: 0 1px 0 rgba(255,255,255,0.7); }
.diploma-park-logo { position: absolute; z-index: 3; left: 50%; top: 82.1%; transform: translateX(-50%); width: 11.8%; height: auto; max-height: 10%; object-fit: contain; border-radius: 50%; filter: drop-shadow(0 4px 0 rgba(47,100,184,0.14)); }
@page { size: A4 portrait; margin: 0; }
@media print {
    html, body { background: #fff !important; }
    .diploma-toolbar { display: none !important; }
    .diploma-page { margin: 0 !important; box-shadow: none !important; page-break-after: always; break-after: page; }
}
@media (max-width: 900px) {
    .diploma-toolbar { position: static; flex-direction: column; align-items: stretch; }
    .diploma-page { width: min(100vw - 20px, 210mm); height: auto; aspect-ratio: 210 / 297; }
    .diploma-title { font-size: clamp(28px, 5.5vw, 42px); -webkit-text-stroke: 1.2px #f05a24; }
    .diploma-awarded { font-size: clamp(19px, 4.4vw, 34px); }
    .diploma-name { font-size: clamp(26px, 6.2vw, 48px); }
    .diploma-name.is-long { font-size: clamp(21px, 5vw, 40px); }
    .diploma-name.is-very-long { font-size: clamp(18px, 4.4vw, 34px); }
    .diploma-description, .diploma-wish { font-size: clamp(17px, 3.9vw, 31px); }
    .diploma-date, .diploma-school, .diploma-signature { font-size: clamp(15px, 3.4vw, 28px); }
}
</style>
</head>
<body>
<div class="diploma-toolbar">
    <div><strong>${escHtml(title)}</strong><div>${childList.length} дипломів, A4 portrait</div></div>
    <button type="button" onclick="window.print()">Друк / зберегти PDF</button>
</div>
${pages || '<div class="diploma-toolbar"><strong>Немає дітей у списку дипломів</strong></div>'}
${autoPrint ? '<script>setTimeout(function(){ window.print(); }, 450);</script>' : ''}
</body>
</html>`;
}

function buildRosterPrintSheet(children, quote = {}, { autoPrint = false } = {}) {
    const rows = (children || []).map((child, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td>${escHtml(child.fullName)}</td>
            <td>${escHtml(child.gender)}</td>
            <td>${escHtml(child.genderSource)}</td>
            <td>${escHtml(child.classLabel || '')}</td>
            <td>${escHtml(child.finalWish || child.autoWish || child.customWish || '')}</td>
            <td>${escHtml(child.diplomaStatus || 'draft')}</td>
        </tr>`).join('');
    return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<title>Список дітей на дипломи</title>
<style>
body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8fafc; }
.toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; }
button { border:0; border-radius:10px; padding:10px 14px; background:#0f766e; color:#fff; font-weight:800; cursor:pointer; }
h1 { margin: 0; font-size: 24px; }
.meta { color:#64748b; font-size:13px; margin-top:4px; }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #cbd5e1; }
th, td { border:1px solid #cbd5e1; padding:8px 10px; text-align:left; vertical-align:top; font-size:12px; }
th { background:#e2e8f0; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
td:nth-child(6) { max-width: 340px; }
@media print { body { background:#fff; padding:10mm; } .toolbar button { display:none; } }
</style>
</head>
<body>
<div class="toolbar">
    <div>
        <h1>Список дітей на дипломи</h1>
        <div class="meta">${escHtml(quote.quote_number || quote.quoteNumber || '')} - ${children.length} дітей</div>
    </div>
    <button type="button" onclick="window.print()">Друк</button>
</div>
<table>
    <thead><tr><th>#</th><th>ПІБ</th><th>Стать</th><th>Джерело</th><th>Клас / група</th><th>Побажання</th><th>Статус</th></tr></thead>
    <tbody>${rows}</tbody>
</table>
${autoPrint ? '<script>setTimeout(function(){ window.print(); }, 350);</script>' : ''}
</body>
</html>`;
}

function csvEscape(value) {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
}

function buildRosterCsv(children) {
    const header = ['ID', 'ПІБ', 'Ім’я', 'Прізвище', 'Стать', 'Джерело статі', 'Клас / група', 'Власне побажання', 'Автопобажання', 'Фінальне побажання', 'Статус'];
    const rows = (children || []).map(child => [
        child.id,
        child.fullName,
        child.firstName,
        child.lastName,
        child.gender,
        child.genderSource,
        child.classLabel || '',
        child.customWish || '',
        child.autoWish || '',
        child.finalWish || '',
        child.diplomaStatus || 'draft'
    ].map(csvEscape).join(';'));
    return '\uFEFF' + header.map(csvEscape).join(';') + '\n' + rows.join('\n');
}

module.exports = {
    DEFAULT_DIPLOMA_TEMPLATE,
    WISH_POOLS,
    VALID_GENDERS,
    VALID_GENDER_SOURCES,
    VALID_DIPLOMA_STATUSES,
    escHtml,
    toCamelTemplate,
    splitName,
    normalizeGender,
    suggestGenderFromName,
    normalizeChildInput,
    mapChildRow,
    pickWish,
    parseRosterImport,
    buildDiplomaPage,
    buildDiplomaDocument,
    buildRosterPrintSheet,
    buildRosterCsv
};
