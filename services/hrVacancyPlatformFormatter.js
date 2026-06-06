const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.HR_VACANCY_AI_MODEL
    || process.env.OPENAI_ASSISTANT_MODEL
    || 'gpt-4.1-mini';

const VACANCY_PLATFORM_RULES = Object.freeze({
    workua: {
        id: 'workua',
        label: 'Work.ua',
        maxChars: 2200,
        tone: 'структурований, професійний',
        sections: ['Коротко про роль', 'Обовʼязки', 'Вимоги', 'Умови', 'Як відгукнутися'],
        cta: 'Надсилайте резюме або пишіть у Telegram/CRM.'
    },
    robota: {
        id: 'robota',
        label: 'Robota.ua',
        maxChars: 2400,
        tone: 'офіційний, конкретний',
        sections: ['Опис вакансії', 'Що потрібно робити', 'Кого шукаємо', 'Що пропонуємо'],
        cta: 'Відгукніться на вакансію, і HR звʼяжеться з вами.'
    },
    olx: {
        id: 'olx',
        label: 'OLX Робота',
        maxChars: 1300,
        tone: 'короткий, прямий, без зайвої канцелярщини',
        sections: ['Робота', 'Графік і оплата', 'Вимоги', 'Контакти'],
        cta: 'Пишіть або телефонуйте, домовимося про співбесіду.'
    },
    instagram: {
        id: 'instagram',
        label: 'Instagram',
        maxChars: 1100,
        tone: 'живий, дружній, для соцмереж',
        sections: ['Хук', 'Кого шукаємо', 'Умови', 'Заклик'],
        cta: 'Пиши в Direct або залишай відгук за посиланням.',
        hashtags: ['#робота', '#вакансія', '#івенти', '#команда']
    },
    telegram: {
        id: 'telegram',
        label: 'Telegram',
        maxChars: 1400,
        tone: 'лаконічний, сканований, з чіткими пунктами',
        sections: ['Вакансія', 'Умови', 'Що важливо', 'Контакт'],
        cta: 'Відгук: напишіть HR або залиште контакти.'
    },
    facebook: {
        id: 'facebook',
        label: 'Facebook',
        maxChars: 1600,
        tone: 'теплий, репутаційний, з фокусом на команду',
        sections: ['Про роль', 'Що робити', 'Що даємо', 'Як податися'],
        cta: 'Залишайте відгук у повідомленнях або рекомендуйте кандидата.'
    }
});

function compactString(value, limit = 6000) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, limit);
}

function normalizePlatform(value) {
    const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return VACANCY_PLATFORM_RULES[key] ? key : 'workua';
}

function listVacancyPlatformTemplates() {
    return Object.values(VACANCY_PLATFORM_RULES).map(rule => ({
        id: rule.id,
        label: rule.label,
        maxChars: rule.maxChars,
        tone: rule.tone,
        sections: rule.sections,
        cta: rule.cta,
        hashtags: rule.hashtags || []
    }));
}

function normalizeVacancy(input = {}) {
    return {
        title: compactString(input.title || input.name || '', 160),
        roleType: compactString(input.role_type || input.roleType || '', 120),
        department: compactString(input.department || '', 120),
        description: compactString(input.description || '', 2000),
        requirements: compactString(input.requirements || '', 1600),
        schedule: compactString(input.schedule || '', 240),
        workFormat: compactString(input.work_format || input.workFormat || '', 120),
        salaryFrom: input.salary_from ?? input.salaryFrom ?? '',
        salaryTo: input.salary_to ?? input.salaryTo ?? ''
    };
}

function salaryLine(vacancy) {
    const from = vacancy.salaryFrom ? String(vacancy.salaryFrom) : '';
    const to = vacancy.salaryTo ? String(vacancy.salaryTo) : '';
    if (from && to) return `${from}-${to} грн`;
    if (from) return `від ${from} грн`;
    if (to) return `до ${to} грн`;
    return '';
}

function buildVacancySource(vacancy = {}, sourceText = '') {
    const v = normalizeVacancy(vacancy);
    const salary = salaryLine(v);
    const lines = [
        v.title ? `Назва: ${v.title}` : '',
        v.roleType ? `Роль: ${v.roleType}` : '',
        v.department ? `Відділ: ${v.department}` : '',
        v.schedule ? `Графік: ${v.schedule}` : '',
        salary ? `Оплата: ${salary}` : '',
        v.workFormat ? `Формат: ${v.workFormat}` : '',
        v.description ? `Опис: ${v.description}` : '',
        v.requirements ? `Вимоги: ${v.requirements}` : '',
        compactString(sourceText, 4000)
    ].filter(Boolean);
    return lines.join('\n');
}

function buildVacancyPlatformPrompt(input = {}) {
    const platform = normalizePlatform(input.platform);
    const rule = VACANCY_PLATFORM_RULES[platform];
    const source = buildVacancySource(input.vacancy, input.sourceText || input.source_text || '');
    return [
        'Ти HR-копірайтер для української CRM Event Genix.',
        `Потрібно адаптувати текст вакансії для платформи ${rule.label}.`,
        `Тон: ${rule.tone}. Максимум ${rule.maxChars} символів.`,
        `Структура: ${rule.sections.join(' / ')}.`,
        'Не вигадуй фактів, зарплат, графіків чи вимог, яких немає у джерелі.',
        'Пиши українською. Залиш текст готовим до публікації, без пояснень навколо.',
        rule.hashtags?.length ? `Доречні хештеги: ${rule.hashtags.join(' ')}` : '',
        `CTA: ${rule.cta}`,
        '',
        'Джерело вакансії:',
        source || 'Джерело порожнє. Сформуй короткий універсальний шаблон з місцями для уточнення.'
    ].filter(Boolean).join('\n');
}

function deterministicVacancyPlatformFormat(input = {}) {
    const platform = normalizePlatform(input.platform);
    const rule = VACANCY_PLATFORM_RULES[platform];
    const v = normalizeVacancy(input.vacancy);
    const sourceText = compactString(input.sourceText || input.source_text || '', 1600);
    const title = v.title || 'Відкрита вакансія';
    const role = v.roleType || v.department || 'команда';
    const salary = salaryLine(v);
    const intro = platform === 'instagram'
        ? `Шукаємо в команду: ${title}`
        : `${title} (${role})`;
    const body = [
        intro,
        v.description || sourceText || 'Додаємо опис ролі, ключові задачі та очікування до кандидата.',
        v.requirements ? `Вимоги: ${v.requirements}` : '',
        v.schedule ? `Графік: ${v.schedule}` : '',
        salary ? `Оплата: ${salary}` : '',
        rule.cta,
        rule.hashtags?.length ? rule.hashtags.join(' ') : ''
    ].filter(Boolean).join('\n\n');
    return body.slice(0, rule.maxChars);
}

function extractResponseText(payload = {}) {
    if (payload.output_text) return payload.output_text;
    const parts = [];
    for (const item of payload.output || []) {
        for (const content of item.content || []) {
            if ((content.type === 'output_text' || content.type === 'text') && content.text) {
                parts.push(content.text);
            }
        }
    }
    return parts.join('\n').trim();
}

async function callOpenAIFormatter(prompt) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const response = await fetch(`${OPENAI_API_BASE}/responses`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: DEFAULT_MODEL,
            input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
            temperature: 0.2,
            max_output_tokens: 900
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = payload?.error?.message || payload?.error || `openai_http_${response.status}`;
        const err = new Error(String(message).slice(0, 240));
        err.code = 'openai_failed';
        throw err;
    }
    return compactString(extractResponseText(payload), 12000);
}

async function formatVacancyForPlatform(input = {}) {
    const platform = normalizePlatform(input.platform);
    const rule = VACANCY_PLATFORM_RULES[platform];
    const prompt = buildVacancyPlatformPrompt({ ...input, platform });
    let formattedText = '';
    let provider = 'template';
    let aiUsed = false;
    let aiError = null;

    try {
        formattedText = await callOpenAIFormatter(prompt);
        if (formattedText) {
            provider = 'openai';
            aiUsed = true;
        }
    } catch (err) {
        aiError = err.message || 'openai_failed';
    }

    if (!formattedText) {
        formattedText = deterministicVacancyPlatformFormat({ ...input, platform });
    }

    return {
        platform,
        template: {
            id: rule.id,
            label: rule.label,
            maxChars: rule.maxChars,
            tone: rule.tone,
            sections: rule.sections,
            cta: rule.cta,
            hashtags: rule.hashtags || []
        },
        formattedText: formattedText.slice(0, rule.maxChars),
        prompt,
        provider,
        model: provider === 'openai' ? DEFAULT_MODEL : 'deterministic-template',
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        aiUsed,
        aiError
    };
}

module.exports = {
    VACANCY_PLATFORM_RULES,
    listVacancyPlatformTemplates,
    buildVacancyPlatformPrompt,
    deterministicVacancyPlatformFormat,
    formatVacancyForPlatform,
    normalizePlatform
};
