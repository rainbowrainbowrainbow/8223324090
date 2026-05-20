const crypto = require('crypto');

const VALID_GENDERS = new Set(['boy', 'girl', 'neutral', 'unspecified']);
const VALID_GENDER_SOURCES = new Set(['manual', 'suggested', 'imported', 'unknown']);
const VALID_DIPLOMA_STATUSES = new Set(['draft', 'generated', 'printed', 'exported']);

const DEFAULT_DIPLOMA_TEMPLATE = {
    code: 'classic-graduation-2026',
    name: 'Класичний диплом випускника',
    titleText: 'Диплом випускника',
    subtitleText: 'за яскравий випускний, сміливість мріяти та готовність до нових відкриттів',
    footerText: 'Парк Закревського періоду',
    principalName: 'Команда Event Genix',
    principalRole: 'організатори випускного',
    palette: {
        paper: '#fbf2dc',
        ink: '#2f2415',
        muted: '#7b6848',
        gold: '#b8860b',
        goldSoft: '#ecd68a',
        accent: '#7c2d12'
    },
    layout: {
        format: 'a4-landscape',
        signatureLeft: 'Класний керівник',
        signatureRight: 'Організатор свята'
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
    const classLine = child.classLabel ? `<div class="diploma-class">${escHtml(child.classLabel)}</div>` : '';
    const quoteLine = quote?.quote_number || quote?.quoteNumber ? `<span>${escHtml(quote.quote_number || quote.quoteNumber)}</span>` : '';
    return `
<section class="diploma-page" style="--paper:${palette.paper};--ink:${palette.ink};--muted:${palette.muted};--gold:${palette.gold};--gold-soft:${palette.goldSoft};--accent:${palette.accent};">
    <svg class="diploma-frame" viewBox="0 0 1120 790" aria-hidden="true" focusable="false">
        <defs>
            <linearGradient id="gradGold" x1="0" x2="1">
                <stop offset="0" stop-color="${escHtml(palette.goldSoft)}"/>
                <stop offset="0.5" stop-color="${escHtml(palette.gold)}"/>
                <stop offset="1" stop-color="${escHtml(palette.goldSoft)}"/>
            </linearGradient>
            <pattern id="dotPattern" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1.4" fill="${escHtml(palette.gold)}" opacity="0.18"/>
            </pattern>
        </defs>
        <rect x="18" y="18" width="1084" height="754" rx="22" fill="none" stroke="url(#gradGold)" stroke-width="8"/>
        <rect x="38" y="38" width="1044" height="714" rx="16" fill="none" stroke="${escHtml(palette.gold)}" stroke-width="2" opacity="0.8"/>
        <rect x="58" y="58" width="1004" height="674" rx="12" fill="url(#dotPattern)" opacity="0.5"/>
        <path d="M124 145 C70 200 70 306 136 365 M996 145 C1050 200 1050 306 984 365" fill="none" stroke="${escHtml(palette.gold)}" stroke-width="5" stroke-linecap="round" opacity="0.76"/>
        ${Array.from({ length: 9 }).map((_, i) => {
            const y = 166 + i * 23;
            const r = 8 + (i % 2);
            return `<ellipse cx="${118 - i * 3}" cy="${y}" rx="${r}" ry="${r + 5}" fill="${escHtml(palette.gold)}" opacity="0.42" transform="rotate(${-30 + i * 4} ${118 - i * 3} ${y})"/>
                    <ellipse cx="${1002 + i * 3}" cy="${y}" rx="${r}" ry="${r + 5}" fill="${escHtml(palette.gold)}" opacity="0.42" transform="rotate(${30 - i * 4} ${1002 + i * 3} ${y})"/>`;
        }).join('')}
        <circle cx="560" cy="132" r="58" fill="none" stroke="url(#gradGold)" stroke-width="5"/>
        <path d="M527 132 L548 153 L593 106" fill="none" stroke="${escHtml(palette.gold)}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M486 660 Q560 706 634 660" fill="none" stroke="${escHtml(palette.gold)}" stroke-width="3" opacity="0.55"/>
    </svg>
    <div class="diploma-content">
        <div class="diploma-kicker">${escHtml(template.footerText || DEFAULT_DIPLOMA_TEMPLATE.footerText)}</div>
        <h1>${escHtml(title)}</h1>
        <p class="diploma-subtitle">${escHtml(template.subtitleText || DEFAULT_DIPLOMA_TEMPLATE.subtitleText)}</p>
        <div class="diploma-awarded">Нагороджується</div>
        <div class="diploma-name">${escHtml(child.fullName)}</div>
        ${classLine}
        <div class="diploma-wish">${escHtml(wish)}</div>
        <div class="diploma-footer">
            <div class="diploma-signature">
                <span></span>
                <strong>${escHtml(layout.signatureLeft || 'Класний керівник')}</strong>
            </div>
            <div class="diploma-seal">EG</div>
            <div class="diploma-signature">
                <span></span>
                <strong>${escHtml(template.principalName || DEFAULT_DIPLOMA_TEMPLATE.principalName)}</strong>
                <small>${escHtml(template.principalRole || DEFAULT_DIPLOMA_TEMPLATE.principalRole)}</small>
            </div>
        </div>
        <div class="diploma-meta">${quoteLine}<span>${new Date().toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })}</span></div>
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
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #efe7d6; color: #2f2415; font-family: Georgia, "Times New Roman", serif; }
.diploma-toolbar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 18px; background: #15120d; color: #fff; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.diploma-toolbar strong { font-size: 15px; }
.diploma-toolbar button { border: 0; border-radius: 10px; padding: 10px 14px; background: #b8860b; color: #fff; font-weight: 800; cursor: pointer; }
.diploma-page { width: 297mm; height: 210mm; margin: 14px auto; position: relative; overflow: hidden; background: radial-gradient(circle at 50% 24%, rgba(255,255,255,0.72), transparent 30%), linear-gradient(135deg, var(--paper), #f5e6bf); color: var(--ink); page-break-after: always; break-after: page; box-shadow: 0 20px 60px rgba(47,36,21,0.22); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.diploma-frame { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.diploma-content { position: relative; z-index: 2; height: 100%; padding: 26mm 33mm 20mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
.diploma-kicker { font-size: 11pt; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-top: 2mm; }
.diploma-content h1 { margin: 17mm 0 5mm; font-size: 41pt; line-height: 1; color: var(--accent); font-weight: 800; }
.diploma-subtitle { max-width: 190mm; margin: 0 auto 10mm; font-size: 14pt; color: var(--muted); line-height: 1.45; }
.diploma-awarded { font-size: 13pt; color: var(--muted); margin-bottom: 4mm; }
.diploma-name { width: 100%; max-width: 210mm; padding: 3mm 7mm 5mm; border-top: 2px solid rgba(184,134,11,0.45); border-bottom: 2px solid rgba(184,134,11,0.45); font-size: clamp(28pt, 4.8vw, 46pt); line-height: 1.08; color: var(--ink); font-weight: 800; }
.diploma-class { margin-top: 3mm; color: var(--muted); font-size: 12pt; font-weight: 700; }
.diploma-wish { max-width: 205mm; min-height: 23mm; margin: 9mm auto 0; font-size: 16pt; line-height: 1.45; color: var(--ink); }
.diploma-footer { margin-top: auto; width: 100%; display: grid; grid-template-columns: 1fr 30mm 1fr; align-items: end; gap: 12mm; }
.diploma-signature { display: grid; gap: 2mm; font-size: 11pt; color: var(--muted); }
.diploma-signature span { display: block; height: 1px; background: rgba(47,36,21,0.45); }
.diploma-signature strong { color: var(--ink); font-size: 12pt; }
.diploma-signature small { color: var(--muted); font-size: 9pt; }
.diploma-seal { width: 27mm; height: 27mm; border-radius: 50%; display: grid; place-items: center; border: 3px double var(--gold); color: var(--gold); font-size: 18pt; font-weight: 900; margin: 0 auto; background: rgba(255,255,255,0.18); }
.diploma-meta { display: flex; justify-content: center; gap: 10mm; margin-top: 5mm; font-family: system-ui, sans-serif; font-size: 8pt; color: rgba(47,36,21,0.58); }
@page { size: A4 landscape; margin: 0; }
@media print {
    html, body { background: #fff !important; }
    .diploma-toolbar { display: none !important; }
    .diploma-page { margin: 0 !important; box-shadow: none !important; page-break-after: always; break-after: page; }
}
@media (max-width: 900px) {
    .diploma-toolbar { position: static; flex-direction: column; align-items: stretch; }
    .diploma-page { width: min(100vw - 20px, 297mm); height: auto; aspect-ratio: 297 / 210; }
    .diploma-content { padding: 8% 10% 7%; }
    .diploma-content h1 { margin-top: 10%; font-size: clamp(26px, 8vw, 46px); }
    .diploma-subtitle, .diploma-wish { font-size: clamp(12px, 2.9vw, 18px); }
}
</style>
</head>
<body>
<div class="diploma-toolbar">
    <div><strong>${escHtml(title)}</strong><div>${childList.length} дипломів, A4 landscape</div></div>
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
