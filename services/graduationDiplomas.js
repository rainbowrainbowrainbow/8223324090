const crypto = require('crypto');

const VALID_GENDERS = new Set(['boy', 'girl', 'neutral', 'unspecified']);
const VALID_GENDER_SOURCES = new Set(['manual', 'suggested', 'imported', 'unknown']);
const VALID_DIPLOMA_STATUSES = new Set(['draft', 'generated', 'printed', 'exported']);

const DEFAULT_DIPLOMA_TEMPLATE = {
    code: 'classic-graduation-2026',
    name: 'Комікс-диплом випускника',
    titleText: 'Диплом',
    subtitleText: 'Нагороджується за сміливість, доброту, знання та готовність до нових пригод',
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
        sealLogoUrl: '/images/park-logo.png',
        characterTopUrl: '/images/mr-zak-spring.png',
        characterBottomUrl: '/images/mr-zak-summer.png',
        officialFooter: '',
        style: 'comic-hero'
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
    const nameLength = String(child.fullName || '').length;
    const nameClass = nameLength > 44 ? ' is-very-long' : (nameLength > 30 ? ' is-long' : '');
    const sealLogoUrl = layout.sealLogoUrl || DEFAULT_DIPLOMA_TEMPLATE.layout.sealLogoUrl;
    const characterTopUrl = layout.characterTopUrl || DEFAULT_DIPLOMA_TEMPLATE.layout.characterTopUrl;
    const characterBottomUrl = layout.characterBottomUrl || DEFAULT_DIPLOMA_TEMPLATE.layout.characterBottomUrl;
    const issueDate = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' });
    return `
<section class="diploma-page" style="--paper:${palette.paper};--ink:${palette.ink};--muted:${palette.muted};--gold:${palette.gold};--gold-soft:${palette.goldSoft};--accent:${palette.accent};">
    <svg class="diploma-frame" viewBox="0 0 790 1120" aria-hidden="true" focusable="false">
        <defs>
            <linearGradient id="comicLime" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stop-color="#b4f400"/>
                <stop offset="0.45" stop-color="${escHtml(palette.paper)}"/>
                <stop offset="1" stop-color="#7ed400"/>
            </linearGradient>
            <radialGradient id="comicGlow" cx="50%" cy="52%" r="58%">
                <stop offset="0" stop-color="#ffffff" stop-opacity="0.88"/>
                <stop offset="0.55" stop-color="#f7ffd4" stop-opacity="0.7"/>
                <stop offset="1" stop-color="#b5ed00" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="diplomaGold" x1="0" x2="1">
                <stop offset="0" stop-color="${escHtml(palette.goldSoft)}"/>
                <stop offset="0.5" stop-color="${escHtml(palette.gold)}"/>
                <stop offset="1" stop-color="${escHtml(palette.goldSoft)}"/>
            </linearGradient>
            <pattern id="comicDots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="8" cy="8" r="6" fill="#6fb300" opacity="0.32"/>
            </pattern>
            <path id="comicStar" d="M0,-18 L5,-6 L18,-6 L8,2 L12,15 L0,8 L-12,15 L-8,2 L-18,-6 L-5,-6 Z"/>
        </defs>
        <rect x="0" y="0" width="790" height="1120" fill="url(#comicLime)"/>
        <path d="M395 560 L-90 128 L92 -90 Z M395 560 L260 -120 L470 -100 Z M395 560 L882 -70 L918 168 Z M395 560 L908 612 L850 760 Z M395 560 L640 1210 L500 1218 Z M395 560 L90 1210 L-50 1090 Z M395 560 L-80 670 L-64 450 Z" fill="#9bf000" opacity="0.58"/>
        <path d="M395 560 L50 260 L80 980 Z M395 560 L710 240 L700 980 Z" fill="#caff27" opacity="0.44"/>
        <rect x="0" y="0" width="790" height="1120" fill="url(#comicDots)" opacity="0.72"/>
        <ellipse cx="395" cy="560" rx="324" ry="410" fill="url(#comicGlow)" opacity="0.95"/>
        <path d="M118 300 C208 245 546 236 670 306 C720 336 724 372 697 408 C666 450 668 850 706 897 C735 934 717 982 662 1000 C520 1048 246 1042 118 994 C70 976 53 931 82 892 C124 834 118 448 78 402 C44 362 64 330 118 300 Z" fill="#fffbea" opacity="0.88"/>
        <path d="M118 300 C208 245 546 236 670 306 C720 336 724 372 697 408 C666 450 668 850 706 897 C735 934 717 982 662 1000 C520 1048 246 1042 118 994 C70 976 53 931 82 892 C124 834 118 448 78 402 C44 362 64 330 118 300 Z" fill="none" stroke="#ffffff" stroke-width="12" opacity="0.42"/>
        <rect x="18" y="18" width="754" height="1084" rx="10" fill="none" stroke="#71c900" stroke-width="10"/>
        <rect x="38" y="38" width="714" height="1044" rx="7" fill="none" stroke="${escHtml(palette.gold)}" stroke-width="4" opacity="0.95"/>
        <rect x="54" y="54" width="682" height="1012" rx="5" fill="none" stroke="${escHtml(palette.accent)}" stroke-width="2.5" opacity="0.72"/>
        <g fill="${escHtml(palette.gold)}" opacity="0.98">
            <use href="#comicStar" x="592" y="146" transform="scale(2.4) rotate(9 592 146)"/>
            <use href="#comicStar" x="708" y="228" transform="scale(1.45) rotate(-8 708 228)"/>
            <use href="#comicStar" x="668" y="348" transform="scale(1.85) rotate(14 668 348)"/>
            <use href="#comicStar" x="114" y="972" transform="scale(1.55) rotate(-11 114 972)"/>
            <use href="#comicStar" x="265" y="1012" transform="scale(2.2) rotate(8 265 1012)"/>
        </g>
        <g fill="${escHtml(palette.gold)}" opacity="0.82">
            ${Array.from({ length: 18 }).map((_, i) => {
                const x = i % 2 ? 716 - (i % 5) * 26 : 62 + (i % 5) * 28;
                const y = 222 + i * 42;
                const scale = (0.34 + (i % 4) * 0.12).toFixed(2);
                return `<use href="#comicStar" x="${x}" y="${y}" transform="scale(${scale}) rotate(${i * 17} ${x} ${y})"/>`;
            }).join('')}
        </g>
        <g transform="translate(592 500) scale(1.06)">
            <path d="M70 58 C82 34 120 30 126 62 C132 94 102 112 72 107 C38 101 22 76 36 50 C43 37 59 42 70 58 Z" fill="#ff3b14"/>
            <path d="M80 72 C91 42 107 46 110 70 C112 93 96 104 76 101 C56 98 48 80 58 63 C64 53 72 61 80 72 Z" fill="#ff8f16"/>
            <path d="M87 82 C94 64 102 67 103 82 C104 96 94 101 83 98 C72 96 68 85 74 75 C78 70 83 76 87 82 Z" fill="#ffe600"/>
            <path d="M22 130 C60 98 105 98 146 130" fill="none" stroke="#43280f" stroke-width="9" stroke-linecap="round"/>
            <path d="M18 150 C64 122 107 122 150 150" fill="none" stroke="#7b4b1f" stroke-width="9" stroke-linecap="round"/>
        </g>
    </svg>
    <img class="diploma-character diploma-character-top" src="${escHtml(characterTopUrl)}" alt="" aria-hidden="true">
    <img class="diploma-character diploma-character-bottom" src="${escHtml(characterBottomUrl)}" alt="" aria-hidden="true">
    <div class="diploma-content">
        <h1>${escHtml(title)}</h1>
        <div class="diploma-paper-card">
            <p class="diploma-subtitle">${escHtml(template.subtitleText || DEFAULT_DIPLOMA_TEMPLATE.subtitleText)}</p>
            <div class="diploma-awarded">Нагороджується</div>
            <div class="diploma-name${nameClass}">${escHtml(child.fullName)}</div>
            ${classLine}
            <div class="diploma-wish">${escHtml(wish)}</div>
        </div>
        <div class="diploma-official-zone">
            <div class="diploma-park-seal" aria-label="Логотип Парку Закревського періоду">
                <img src="${escHtml(sealLogoUrl)}" alt="Парк Закревського періоду">
            </div>
            <div class="diploma-date">${escHtml(issueDate)}</div>
        </div>
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
html, body { margin: 0; padding: 0; background: #b7f000; color: #123b8f; font-family: "Trebuchet MS", "Comic Sans MS", system-ui, sans-serif; }
.diploma-toolbar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 18px; background: #15120d; color: #fff; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.diploma-toolbar strong { font-size: 15px; }
.diploma-toolbar button { border: 0; border-radius: 10px; padding: 10px 14px; background: #b8860b; color: #fff; font-weight: 800; cursor: pointer; }
.diploma-page { width: 210mm; height: 297mm; margin: 14px auto; position: relative; overflow: hidden; background: var(--paper); color: var(--ink); page-break-after: always; break-after: page; box-shadow: 0 22px 70px rgba(21,84,255,0.24); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.diploma-frame { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.diploma-character { position: absolute; z-index: 3; object-fit: contain; filter: drop-shadow(0 7px 10px rgba(23,59,99,0.26)); pointer-events: none; }
.diploma-character-top { left: 9mm; top: 11mm; width: 46mm; height: 46mm; transform: rotate(-6deg); }
.diploma-character-bottom { right: 16mm; bottom: 28mm; width: 48mm; height: 48mm; transform: rotate(4deg); }
.diploma-content { position: relative; z-index: 4; height: 100%; padding: 18mm 19mm 19mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
.diploma-content h1 { align-self: flex-end; width: 138mm; margin: 0 5mm 17mm 0; font-size: 47pt; line-height: 0.95; color: #ffe800; font-family: Impact, "Arial Black", "Trebuchet MS", sans-serif; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; -webkit-text-stroke: 2.5px var(--accent); text-shadow: 4px 5px 0 rgba(255,59,20,0.16); }
.diploma-paper-card { width: 164mm; min-height: 154mm; margin-top: 6mm; padding: 13mm 15mm 16mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; transform: rotate(-2.2deg); background: rgba(255,255,238,0.84); border-radius: 22px; box-shadow: 0 8px 0 rgba(255,255,255,0.38), 0 18px 34px rgba(50,116,0,0.14); }
.diploma-subtitle { max-width: 128mm; margin: 0 auto 6mm; font-size: 19pt; color: var(--accent); line-height: 1.25; font-family: "Comic Sans MS", "Trebuchet MS", system-ui, sans-serif; font-weight: 800; }
.diploma-awarded { width: 100%; padding-top: 4mm; border-top: 1.8px solid rgba(255,59,20,0.72); font-size: 13pt; letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); margin-bottom: 5mm; font-weight: 900; }
.diploma-name { width: 100%; max-width: 138mm; padding: 4mm 5mm 5mm; border: 3px solid #2c76ff; border-radius: 14px; background: rgba(255,255,255,0.5); font-size: 34pt; line-height: 1.05; color: var(--ink); font-family: "Trebuchet MS", "Comic Sans MS", system-ui, sans-serif; font-weight: 900; text-wrap: balance; box-shadow: 5px 5px 0 rgba(44,118,255,0.16); }
.diploma-name.is-long { font-size: 28pt; line-height: 1.08; }
.diploma-name.is-very-long { font-size: 23pt; line-height: 1.12; }
.diploma-class { margin-top: 4mm; color: var(--muted); font-size: 12pt; font-weight: 900; }
.diploma-wish { max-width: 132mm; min-height: 35mm; margin: 8mm auto 0; font-size: 14.5pt; line-height: 1.42; color: var(--ink); display: flex; align-items: center; justify-content: center; font-weight: 800; }
.diploma-official-zone { margin-top: auto; width: 100%; padding: 0 33mm 0 42mm; display: flex; align-items: center; justify-content: center; gap: 8mm; }
.diploma-park-seal { width: 28mm; height: 28mm; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center; padding: 1.8mm; border: 2.5px solid #2c76ff; background: rgba(255,255,255,0.72); box-shadow: 0 0 0 1.4mm rgba(255,242,0,0.48), 0 5px 0 rgba(21,84,255,0.18); overflow: hidden; }
.diploma-park-seal img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; display: block; }
.diploma-date { max-width: 65mm; padding: 3mm 7mm; border: 3px solid #2c76ff; border-radius: 14px; color: #1554ff; font-family: "Trebuchet MS", system-ui, sans-serif; font-size: 12pt; font-weight: 900; letter-spacing: 0.02em; background: rgba(255,255,255,0.86); box-shadow: 4px 4px 0 rgba(44,118,255,0.16); }
@page { size: A4 portrait; margin: 0; }
@media print {
    html, body { background: #fff !important; }
    .diploma-toolbar { display: none !important; }
    .diploma-page { margin: 0 !important; box-shadow: none !important; page-break-after: always; break-after: page; }
}
@media (max-width: 900px) {
    .diploma-toolbar { position: static; flex-direction: column; align-items: stretch; }
    .diploma-page { width: min(100vw - 20px, 210mm); height: auto; aspect-ratio: 210 / 297; }
    .diploma-content { padding: 9% 9% 9%; }
    .diploma-character-top { width: 22%; height: auto; }
    .diploma-character-bottom { width: 24%; height: auto; }
    .diploma-content h1 { width: 70%; margin-right: 2%; margin-bottom: 10%; font-size: clamp(34px, 12vw, 58px); -webkit-text-stroke: 1.5px var(--accent); }
    .diploma-paper-card { width: 87%; min-height: 50%; padding: 7% 8% 8%; }
    .diploma-name { font-size: clamp(28px, 8vw, 44px); }
    .diploma-name.is-long { font-size: clamp(23px, 6.8vw, 36px); }
    .diploma-name.is-very-long { font-size: clamp(20px, 5.8vw, 30px); }
    .diploma-subtitle, .diploma-wish { font-size: clamp(12px, 3.2vw, 17px); }
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
