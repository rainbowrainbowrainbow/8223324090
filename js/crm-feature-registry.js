/**
 * crm-feature-registry.js
 * Shared map for "where can I find this function in CRM?" questions.
 *
 * Keep this file framework-free: it is loaded by browser search and required by
 * the server-side assistant. Add feature aliases here when new CRM surfaces ship.
 */
(function initCrmFeatureRegistry(root, factory) {
    const registry = factory();
    if (typeof module === 'object' && module.exports) module.exports = registry;
    root.CrmFeatureRegistry = registry;
})(typeof globalThis !== 'undefined' ? globalThis : window, function buildRegistry() {
    const STOP_WORDS = new Set([
        'а', 'або', 'в', 'у', 'на', 'по', 'та', 'і', 'й', 'чи', 'це', 'цей',
        'де', 'куди', 'як', 'мені', 'можна', 'можливість', 'системі',
        'підкажи', 'покажи', 'знайти', 'знайду', 'відкрити', 'відкрий',
        'перейти', 'перейди', 'будь', 'ласка', 'для', 'через', 'crm',
        'where', 'find', 'open', 'go', 'to', 'the', 'a', 'an', 'please'
    ]);

    const FEATURES = [
        {
            id: 'certificates.issue-single',
            title: 'Видати сертифікат або грамоту',
            href: '/certificates/new',
            icon: '🎫',
            access: 'certificates',
            group: 'product',
            breadcrumb: 'Сертифікати -> Видати сертифікат',
            summary: 'Окрема сторінка для видачі одного сертифіката або грамоти.',
            primaryAction: 'Відкрити видачу',
            aliases: [
                'видати сертифікат',
                'створити сертифікат',
                'новий сертифікат',
                'видати грамоту',
                'створити грамоту',
                'грамота',
                'грамоту',
                'диплом сертифікат',
                'certificate issue',
                'new certificate'
            ]
        },
        {
            id: 'certificates.issue-batch',
            title: 'Пакет сертифікатів на одноразовий вхід',
            href: '/certificates/batch',
            icon: '📦',
            access: 'certificates',
            group: 'product',
            breadcrumb: 'Сертифікати -> Пакет сертифікатів на одноразовий вхід',
            summary: 'Пакетна видача кількох одноразових сертифікатів за один сценарій.',
            primaryAction: 'Відкрити пакет',
            aliases: [
                'пакет сертифікатів',
                'пакетна видача',
                'видати багато сертифікатів',
                'batch certificates',
                'bulk certificates'
            ]
        },
        {
            id: 'certificates.registry',
            title: 'Реєстр сертифікатів',
            href: '/certificates',
            icon: '🎫',
            access: 'certificates',
            group: 'product',
            breadcrumb: 'Сертифікати',
            summary: 'Список, пошук, статуси і деталі вже виданих сертифікатів.',
            primaryAction: 'Відкрити реєстр',
            aliases: ['сертифікати', 'реєстр сертифікатів', 'перевірити сертифікат', 'сертифікат']
        },
        {
            id: 'afisha.events',
            title: 'Афіша подій',
            href: '/afisha',
            icon: '🎭',
            access: 'afisha',
            group: 'product',
            breadcrumb: 'Продукт -> Афіша',
            summary: 'Окрема сторінка для подій афіші, імпорту, шаблонів і задач.',
            primaryAction: 'Відкрити афішу',
            aliases: [
                'афіша',
                'створити афішу',
                'додати афішу',
                'події афіші',
                'подія афіші',
                'додати подію',
                'розклад подій',
                'afisha',
                'event schedule'
            ]
        },
        {
            id: 'tasks.list',
            title: 'Задачі',
            href: '/tasks',
            icon: '✅',
            access: 'tasks',
            group: 'today',
            breadcrumb: 'Задачі',
            summary: 'Список задач, фільтри, quick add і робочі статуси.',
            primaryAction: 'Відкрити задачі',
            aliases: ['задачі', 'таски', 'мої задачі', 'поставлені мною задачі', 'завдання', 'task']
        },
        {
            id: 'tasks.kanban',
            title: 'Kanban задач',
            href: '/tasks?view=kanban',
            icon: '▦',
            access: 'tasks',
            group: 'today',
            breadcrumb: 'Задачі -> Kanban',
            summary: 'Kanban-режим для руху задач між статусами.',
            primaryAction: 'Відкрити Kanban',
            aliases: ['канбан задач', 'kanban задач', 'дошка задач', 'статуси задач']
        },
        {
            id: 'timeline.main',
            title: 'Таймлайн',
            href: '/',
            icon: '◴',
            access: 'timeline',
            group: 'today',
            breadcrumb: 'Таймлайн',
            summary: 'Основний scheduler для бронювань, лінійок і подій дня.',
            primaryAction: 'Відкрити Таймлайн',
            aliases: ['таймлайн парк', 'таймлайн парку', 'парк таймлайн', 'таймлайн', 'календар', 'розклад', 'бронювання', 'лінійки', 'timeline']
        },
        {
            id: 'timeline.maysternya_doli',
            title: 'Таймлайн МД',
            href: '/maysternya-doli',
            icon: '◇',
            access: 'maysternya_doli',
            group: 'today',
            breadcrumb: 'Таймлайн МД',
            summary: 'Окремий таймлайн записів Майстерні Долі без афіші парку.',
            primaryAction: 'Відкрити Таймлайн МД',
            aliases: ['таймлайн мд', 'мд таймлайн', 'майстерня долі', 'майстерня', 'записи психолога']
        },
        {
            id: 'graduation.diplomas',
            title: 'Дипломи випускного',
            href: '/graduation#diplomas',
            icon: '🎓',
            access: 'graduation',
            group: 'product',
            breadcrumb: 'Випускний -> Дипломи',
            summary: 'Список дітей, побажання, preview, print/PDF і export дипломів.',
            primaryAction: 'Відкрити дипломи',
            aliases: ['дипломи', 'диплом випускника', 'випускні дипломи', 'список дітей на дипломи']
        },
        {
            id: 'finance.control',
            title: 'Фінанси та аналітика',
            href: '/finance',
            icon: '📈',
            access: 'finance',
            group: 'sales',
            breadcrumb: 'Фінанси та аналітика',
            summary: 'Control page для грошей, KPI, боргів, P&L і insights.',
            primaryAction: 'Відкрити фінанси',
            aliases: ['фінанси', 'аналітика', 'гроші', 'каса', 'борги', 'p&l', 'finance', 'analytics']
        },
        {
            id: 'leads.sales',
            title: 'Ліди та продажі',
            href: '/sales-funnel',
            icon: '◇',
            access: 'leads',
            group: 'sales',
            breadcrumb: 'Продажі -> Ліди',
            summary: 'Воронка продажів, статуси лідів і наступні контакти.',
            primaryAction: 'Відкрити ліди',
            aliases: ['ліди', 'воронка', 'продажі', 'гарячі ліди', 'leads', 'sales funnel']
        },
        {
            id: 'chat.team',
            title: 'Чат команди',
            href: '/chat',
            icon: '💬',
            access: 'chat',
            group: 'today',
            breadcrumb: 'Чат',
            summary: 'Командні діалоги, канали і помічник у chat surface.',
            primaryAction: 'Відкрити чат',
            aliases: ['чат', 'повідомлення', 'діалоги', 'командний чат', 'chat']
        },
        {
            id: 'warehouse.stock',
            title: 'Склад',
            href: '/warehouse',
            icon: '▣',
            access: 'warehouse',
            group: 'system',
            breadcrumb: 'Система -> Склад',
            summary: 'Залишки, інвентар і рух товарів.',
            primaryAction: 'Відкрити склад',
            aliases: ['склад', 'залишки', 'інвентар', 'warehouse']
        },
        {
            id: 'profile.cabinet',
            title: 'Особистий кабінет',
            href: '/profile',
            icon: '●',
            access: 'all',
            group: 'system',
            breadcrumb: 'Профіль',
            summary: 'Особистий кабінет, avatar, задачі, алерти і швидкий стан.',
            primaryAction: 'Відкрити профіль',
            aliases: ['профіль', 'кабінет', 'мій профіль', 'акаунт', 'profile']
        }
    ];

    function normalizeFeatureText(value = '') {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[«»“”"'.:;!?()[\]{}|/\\,_+=~`*-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function featureTokens(value = '') {
        return normalizeFeatureText(value)
            .split(' ')
            .map(token => token.trim())
            .filter(token => token.length > 1 && !STOP_WORDS.has(token));
    }

    function featureHaystack(feature = {}) {
        return [
            feature.title,
            feature.href,
            feature.breadcrumb,
            feature.summary,
            ...(feature.aliases || [])
        ].filter(Boolean);
    }

    function scoreFeature(feature, query) {
        const q = normalizeFeatureText(query);
        if (!q) return 0;
        const tokens = featureTokens(q);
        const texts = featureHaystack(feature).map(normalizeFeatureText).filter(Boolean);
        let score = 0;

        for (const text of texts) {
            if (text === q) score = Math.max(score, 160);
            else if (q.includes(text) && text.length > 3) score = Math.max(score, 132);
            else if (text.includes(q)) score = Math.max(score, 118);
        }

        for (const alias of feature.aliases || []) {
            const normalizedAlias = normalizeFeatureText(alias);
            if (normalizedAlias && q.includes(normalizedAlias)) score = Math.max(score, 150);
        }

        if (tokens.length) {
            const matchedTokens = tokens.filter(token => texts.some(text => text.includes(token)));
            if (matchedTokens.length === tokens.length) score = Math.max(score, 95 + Math.min(tokens.length * 6, 30));
            else if (matchedTokens.length >= Math.min(2, tokens.length)) score = Math.max(score, 66 + matchedTokens.length * 7);
            else if (matchedTokens.length === 1 && tokens.length <= 3) score = Math.max(score, 50);
        }

        if (/(де|куди|знайти|підкажи|покажи|відкрити|відкрий|where|find|open)/i.test(query)) score += 8;
        return score;
    }

    function searchCrmFeatures(query, options = {}) {
        const limit = Number(options.limit || 5);
        const minScore = Number(options.minScore || 45);
        return FEATURES
            .map(feature => ({ ...feature, score: scoreFeature(feature, query) }))
            .filter(feature => feature.score >= minScore)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'uk'))
            .slice(0, limit);
    }

    function formatFeatureLocation(feature = {}) {
        const breadcrumb = feature.breadcrumb || feature.title || 'CRM';
        const href = feature.href ? ` (${feature.href})` : '';
        return `${breadcrumb}${href}`;
    }

    function getFeatureSearchItems() {
        return FEATURES.map(feature => ({
            href: feature.href,
            icon: feature.icon,
            label: feature.title,
            access: feature.access,
            group: feature.group,
            aliases: feature.aliases,
            featureId: feature.id,
            featureSummary: feature.summary,
            featureBreadcrumb: feature.breadcrumb
        }));
    }

    return {
        FEATURES,
        normalizeFeatureText,
        featureTokens,
        searchCrmFeatures,
        formatFeatureLocation,
        getFeatureSearchItems
    };
});
