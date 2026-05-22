/**
 * Canonical page knowledge for CRM assistant prompts.
 *
 * Keep this server-side registry structured and compact. Frontend clients only
 * send the current page context; backend enriches it from this source of truth.
 */

const MAX_LIST_ITEMS = 10;

function compactText(value, limit = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactList(value, limit = MAX_LIST_ITEMS, itemLimit = 160) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => compactText(item, itemLimit))
        .filter(Boolean)
        .slice(0, limit);
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

const PAGE_KNOWLEDGE = {
    timeline: {
        pageKey: 'timeline',
        label: 'Таймлайн бронювань',
        pathnames: ['/', '/index', '/index.html'],
        aliases: ['timeline', 'таймлайн', 'calendar', 'розклад', 'bookings', 'booking', 'бронювання'],
        businessPurpose: 'Операційний календар дня: бронювання, події афіші, лінійки, кімнати, підтвердження і видимий розклад.',
        owns: ['бронювання дня', 'час/кімната/програма/група', 'статуси бронювань', 'афіша у розкладі'],
        primaryQuestions: ['що є сьогодні або на видимій даті', 'які бронювання потребують підтвердження', 'де вільна кімната або слот'],
        relatedModules: ['customers', 'finance', 'tasks', 'programs', 'certificates'],
        apiHints: ['/api/bookings/:date', '/api/afisha/:date', '/api/rooms/free/:date/:time/:duration'],
        guardrails: ['Не вигадуй бронювання або вільні кімнати без live/API даних.', 'Якщо дата не очевидна, уточни або використовуй видиму дату сторінки.']
    },
    dashboard: {
        pageKey: 'dashboard',
        label: 'Дашборд',
        pathnames: ['/dashboard', '/dashboard.html'],
        aliases: ['dashboard', 'дашборд', 'головна', 'центр дня', 'work queue'],
        businessPurpose: 'Shell-дашборд для рольового операційного огляду: віджети, bottlenecks, робоча черга, quick actions і preview сценаріїв.',
        owns: ['віджети ролі', 'робоча черга', 'сигнали прострочки/відповідей/лідів', 'dashboard preset'],
        primaryQuestions: ['що зараз найважливіше', 'який bottleneck перший', 'яку одну дію зробити далі'],
        relatedModules: ['timeline', 'tasks', 'sales-funnel', 'finance', 'chat', 'center'],
        apiHints: ['/api/dashboard/config', '/api/dashboard/widgets/*', '/api/work-queue'],
        guardrails: ['Dashboard підсумовує інші модулі, але деталі треба брати з відповідного live/API джерела.']
    },
    center: {
        pageKey: 'center',
        label: 'Центр керування',
        pathnames: ['/center', '/center.html'],
        aliases: ['center', 'центр', 'control center', 'операційний центр'],
        businessPurpose: 'Executive/control workspace для цілей, briefing, loyalty, performance, cross-sell, leads і клієнтських точок контролю.',
        owns: ['керівний briefing', 'цілі центру', 'loyalty/cross-sell', 'program performance', 'event log'],
        primaryQuestions: ['що контролювати керівнику', 'де ризик по цілях', 'який cross-sell або performance сигнал важливий'],
        relatedModules: ['dashboard', 'customers', 'sales-funnel', 'finance', 'programs', 'staff'],
        apiHints: ['/api/center/overview', '/api/center/briefing', '/api/center/goals', '/api/center/cross-sell'],
        guardrails: ['Не підміняй фінансові або customer details без відповідного module data.']
    },
    customers: {
        pageKey: 'customers',
        label: 'Клієнти',
        pathnames: ['/customers', '/customers.html'],
        aliases: ['customers', 'clients', 'клієнти', 'клієнтська база', 'crm база'],
        businessPurpose: 'CRM база клієнтів: профілі, джерела, RFM, теги, комунікаційний контекст, дублікати, імпорт/експорт і customer journey.',
        owns: ['профілі клієнтів', 'контакти і джерела', 'RFM сегменти', 'теги', 'дублікати', 'історія комунікацій', 'сертифікати клієнта'],
        primaryQuestions: ['як знайти або сегментувати клієнта', 'що означає RFM', 'як клієнти повʼязані з лідами', 'як працювати з дублікатами'],
        relatedModules: ['sales-funnel', 'timeline', 'omni', 'finance', 'certificates'],
        apiHints: ['/api/customers', '/api/customers/rfm', '/api/customers/stats', '/api/customers/:id/communication-context', '/api/customers/duplicates'],
        crossPageHints: [
            'Воронка/ліди живуть у модулі Ліди (`/sales-funnel`): там ведуть потенційні звернення до бронювання або втрати.',
            'Клієнти — це база людей/організацій після або поруч із продажем; lead може бути привʼязаний до customer profile.',
            'Якщо користувач питає про funnel на сторінці клієнтів, поясни звʼязок і за потреби направ у `Ліди / Воронка`, не удавай що live pipeline відкритий тут.'
        ],
        guardrails: ['Не заявляй точні pipeline counts із сторінки клієнтів без live сигналів лідів.', 'API доступ і права лишаються реальними, page knowledge не обходить backend auth.']
    },
    'sales-funnel': {
        pageKey: 'sales-funnel',
        label: 'Ліди / Воронка',
        pathnames: ['/sales-funnel', '/leads', '/leads.html'],
        aliases: ['sales-funnel', 'leads', 'lead', 'ліди', 'лід', 'воронка', 'funnel', 'продажі'],
        businessPurpose: 'Sales workspace для лідів: типи звернень, pipeline/kanban, статуси, джерела, workspace ліда, customer linking, tasks, bookings і follow-up.',
        owns: ['ліди', 'тип ліда', 'pipeline stages', 'kanban', 'джерело звернення', 'workspace ліда', 'звʼязок із клієнтом', 'follow-up задачі'],
        primaryQuestions: ['що означають етапи воронки', 'де гарячі/завислі ліди', 'яка наступна комунікація', 'як lead переходить у клієнта або бронювання'],
        relatedModules: ['customers', 'tasks', 'timeline', 'omni', 'finance'],
        apiHints: ['/api/leads', '/api/leads/hot', '/api/leads/stats', '/api/leads/:id/workspace', '/api/leads/:id/link-customer'],
        domainTerms: [
            'Етапи pipeline: Новий лід -> Контакт -> Надання інфо -> Угода -> Завдаток -> В очікуванні -> Проведено -> Закрито або Провалено.',
            'Типи: якісний, спам, співпраця, інформаційний, неякісний.',
            'Джерела: Telegram, Facebook, Instagram, Viber, TikTok, Google, сайт, телефон, walk-in, рекомендація, landing/manual.'
        ],
        crossPageHints: [
            'Customer profile потрібен для історії, тегів, RFM і повторних продажів; funnel показує процес до угоди/бронювання.',
            'Tasks фіксують наступний follow-up; timeline показує бронювання, що виросло з ліда.'
        ],
        guardrails: ['Не вигадуй stage counts або конкретні ліди без live даних.', 'Для клієнтського профілю направляй у `Клієнти`, а не дублюй customer CRUD у funnel відповіді.']
    },
    leads: {
        aliasOf: 'sales-funnel'
    },
    tasks: {
        pageKey: 'tasks',
        label: 'Задачі',
        pathnames: ['/tasks', '/tasks.html'],
        aliases: ['tasks', 'task', 'задачі', 'завдання', 'таски', 'чекліст', 'дедлайн'],
        businessPurpose: 'Операційна дошка задач: ownership, deadlines, statuses, inbox/today/waiting/team/my slices, checklist і follow-up контроль.',
        owns: ['активні задачі', 'відповідальний/автор', 'дедлайн', 'пріоритет', 'workflow статус', 'звʼязок із lead/customer/booking'],
        primaryQuestions: ['які саме задачі', 'що прострочено', 'хто відповідальний', 'яку задачу взяти першою'],
        relatedModules: ['dashboard', 'sales-funnel', 'timeline', 'chat', 'staff'],
        apiHints: ['/api/tasks', '/api/tasks/my-cabinet', '/api/tasks/:id/status'],
        guardrails: ['Відповідай по задачах тільки в межах видимості користувача.', 'Не призначай/закривай задачі словами без явної дії API.']
    },
    finance: {
        pageKey: 'finance',
        label: 'Фінанси та аналітика',
        pathnames: ['/finance', '/finance.html'],
        aliases: ['finance', 'фінанси', 'гроші', 'каса', 'борги', 'p&l', 'pnl', 'analytics', 'аналітика'],
        businessPurpose: 'Контроль грошей і KPI: доходи/витрати, борги, P&L, cashflow, salary workspace, accounts, currency, forecast і analytics overlays.',
        owns: ['транзакції', 'борги по бронюваннях', 'P&L', 'cashflow', 'зарплатний зріз', 'рахунки', 'прогноз'],
        primaryQuestions: ['де борги', 'що з прибутком', 'який фінансовий ризик', 'звідки цифри бронювань і клієнтів'],
        relatedModules: ['timeline', 'customers', 'sales-funnel', 'staff', 'analytics'],
        apiHints: ['/api/finance/dashboard', '/api/finance/debts', '/api/finance/advanced-dashboard', '/api/analytics/overview', '/api/analytics/deals-lifecycle'],
        crossPageHints: ['Booking revenue приходить із бронювань/timeline.', 'Customer і lead метрики приходять із customers/leads analytics, не з ручних припущень.'],
        guardrails: ['Не називай точні суми без live/API даних.', 'Фінансові висновки мають бути framed як контроль ризику, а не бухгалтерська істина без звіту.']
    },
    analytics: {
        aliasOf: 'finance'
    },
    reports: {
        pageKey: 'reports',
        label: 'Звіти',
        pathnames: ['/reports', '/reports.html'],
        aliases: ['reports', 'звіти', 'reporting', 'звіт'],
        businessPurpose: 'Звітний workspace для підсумків, контрольних висновків і менеджерських reporting surfaces.',
        owns: ['операційні звіти', 'підсумки', 'контрольні висновки'],
        primaryQuestions: ['який висновок зі звіту', 'де ризик', 'що винести керівнику'],
        relatedModules: ['finance', 'dashboard', 'tasks', 'center'],
        apiHints: ['/api/reports/*'],
        guardrails: ['Якщо звіт не завантажений у live context, не вигадуй його зміст.']
    },
    staff: {
        pageKey: 'staff',
        label: 'Графік команди',
        pathnames: ['/staff', '/staff.html'],
        aliases: ['staff', 'schedule', 'графік', 'зміни', 'персонал', 'команда'],
        businessPurpose: 'Сторінка графіка: співробітники, зміни, статуси, години, bulk schedule і звʼязка staff профілю з акаунтом.',
        owns: ['staff list', 'weekly schedule', 'shift status', 'department filter', 'hours summary', 'account linking'],
        primaryQuestions: ['хто на зміні', 'де конфлікт графіка', 'кому не вистачає акаунта', 'які години за період'],
        relatedModules: ['hr', 'tasks', 'finance', 'training'],
        apiHints: ['/api/staff', '/api/staff/schedule', '/api/staff/schedule/hours', '/api/staff/link-status'],
        guardrails: ['Не змінюй графік або акаунти без явної дії користувача і API.']
    },
    hr: {
        pageKey: 'hr',
        label: 'Кадри / HR',
        pathnames: ['/hr', '/hr.html'],
        aliases: ['hr', 'кадри', 'співробітники', 'люди', 'персонал', 'hr team'],
        businessPurpose: 'HR workspace для профілів співробітників, станів, no-show/conflict контролю, документів, командного складу і кадрових дій.',
        owns: ['employee profiles', 'HR status', 'командний склад', 'кадрові задачі', 'звʼязок із staff schedule'],
        primaryQuestions: ['що по людині', 'де кадровий ризик', 'як HR профіль повʼязаний із графіком'],
        relatedModules: ['staff', 'tasks', 'training', 'finance'],
        apiHints: ['/api/hr/*', '/api/users', '/api/staff/link-status'],
        guardrails: ['HR дані можуть бути чутливими: не показуй зайві приватні деталі без потреби.']
    },
    programs: {
        pageKey: 'programs',
        label: 'Продукти / Програми',
        pathnames: ['/programs', '/programs.html', '/embed/programs'],
        aliases: ['programs', 'products', 'програми', 'послуги', 'пакети', 'продукти'],
        businessPurpose: 'Product IA hub: розважальні програми, кухонні/додаткові продукти, каталоги і source documents.',
        owns: ['product cards', 'категорії програм', 'ціни/пакети', 'каталоги', 'source document links'],
        primaryQuestions: ['яку програму запропонувати', 'де знайти каталог', 'як продукт повʼязаний із бронюванням або продажем'],
        relatedModules: ['timeline', 'sales-funnel', 'center', 'designs', 'graduation'],
        apiHints: ['/api/products', '/api/products/catalogs', '/api/products/:id/source-document'],
        guardrails: ['Не вигадуй актуальні ціни або availability без product/API даних.']
    },
    certificates: {
        pageKey: 'certificates',
        label: 'Сертифікати',
        pathnames: ['/certificates', '/certificates/new', '/certificates/batch', '/certificates.html'],
        aliases: ['certificates', 'certificate', 'сертифікати', 'сертифікат', 'грамота', 'реєстр сертифікатів'],
        businessPurpose: 'Registry and issue flow для сертифікатів/грамот: один сертифікат, пакетна видача, статуси, QR/code lookup і привʼязка до клієнта.',
        owns: ['реєстр сертифікатів', 'видання одного сертифіката', 'пакетна видача', 'статус/код/QR', 'звʼязок із клієнтом'],
        primaryQuestions: ['де видати сертифікат', 'як перевірити статус', 'що робити з пакетною видачею'],
        relatedModules: ['customers', 'timeline', 'programs'],
        apiHints: ['/api/certificates', '/api/certificates/batch', '/api/certificates/code/:code', '/api/certificates/:id/status'],
        guardrails: ['Не генеруй або змінюй код сертифіката без API дії.']
    },
    chat: {
        pageKey: 'chat',
        label: 'Чат команди',
        pathnames: ['/chat', '/chat.html'],
        aliases: ['chat', 'чат', 'повідомлення', 'діалоги', 'командний чат'],
        businessPurpose: 'Командні канали, діалоги, notes, задачі з чату, guardian signals і assistant continuity.',
        owns: ['канали', 'повідомлення', 'непрочитані', 'notes', 'задачі з повідомлень', 'guardian moderation signals'],
        primaryQuestions: ['які діалоги чекають відповіді', 'де створити задачу з чату', 'який канал перевірити'],
        relatedModules: ['omni', 'tasks', 'assistant', 'guardian-ops'],
        apiHints: ['/api/chat/*', '/api/tasks', '/api/guardian/*'],
        guardrails: ['Не цитуй приватні повідомлення без потреби; давай мінімальний контекст для дії.']
    },
    omni: {
        pageKey: 'omni',
        label: 'Комунікації / Omni',
        pathnames: ['/omni', '/omni.html'],
        aliases: ['omni', 'комунікації', 'inbox', 'external messages', 'омні'],
        businessPurpose: 'External conversation hub для клієнтських каналів, reply expectations, provider delivery truth і follow-up.',
        owns: ['external conversations', 'reply expected state', 'delivery truth', 'customer communication trail'],
        primaryQuestions: ['хто чекає відповіді', 'який статус відправки', 'як це повʼязано з клієнтом або лідом'],
        relatedModules: ['customers', 'sales-funnel', 'chat', 'tasks'],
        apiHints: ['/api/omni/*', '/api/chat/unread'],
        guardrails: ['Не обіцяй доставку повідомлення без provider truth.']
    },
    kleshnya: {
        pageKey: 'kleshnya',
        label: 'Помічник / AI чат',
        pathnames: ['/kleshnya', '/kleshnya.html', '/copilot', '/copilot.html'],
        aliases: ['assistant', 'помічник', 'клішня', 'kleshnya', 'copilot', 'ai менеджер'],
        businessPurpose: 'AI surface для питань по CRM, продажах і операціях; має пояснювати межі live data та сторінковий контекст.',
        owns: ['assistant sessions', 'chat history', 'AI guidance', 'safe suggestions'],
        primaryQuestions: ['що ти вмієш', 'як працювати зі сторінкою', 'де знайти функцію CRM'],
        relatedModules: ['dashboard', 'chat', 'sales-funnel', 'tasks'],
        apiHints: ['/api/kleshnya/chat', '/api/crm-assistant/reply'],
        guardrails: ['Чесно розрізняй знання про модуль і наявність live даних.']
    },
    copilot: {
        aliasOf: 'kleshnya'
    },
    warehouse: {
        pageKey: 'warehouse',
        label: 'Склад',
        pathnames: ['/warehouse', '/warehouse.html'],
        aliases: ['warehouse', 'склад', 'залишки', 'інвентар', 'stock'],
        businessPurpose: 'Складський контроль: залишки, низький сток, рух товарів, procurement і повʼязані операційні задачі.',
        owns: ['stock items', 'stock movements', 'low stock', 'procurement links'],
        primaryQuestions: ['що закінчується', 'який рух по позиції', 'що треба докупити'],
        relatedModules: ['tasks', 'finance', 'center'],
        apiHints: ['/api/warehouse/*', '/api/procurement/*'],
        guardrails: ['Не стверджуй наявність товару без live/API inventory data.']
    },
    training: {
        pageKey: 'training',
        label: 'Навчання',
        pathnames: ['/training', '/training.html'],
        aliases: ['training', 'навчання', 'тести', 'knowledge base', 'прогрес команди'],
        businessPurpose: 'Навчання команди: матеріали, тести, прогрес, badges, submissions і review.',
        owns: ['training materials', 'tests', 'progress', 'badges', 'submissions'],
        primaryQuestions: ['хто пройшов навчання', 'який матеріал потрібен', 'де прогрес команди'],
        relatedModules: ['staff', 'hr', 'tasks'],
        apiHints: ['/api/training/*'],
        guardrails: ['Не вигадуй прогрес співробітника без live/API даних.']
    },
    content: {
        pageKey: 'content',
        label: 'Контент',
        pathnames: ['/content', '/content.html'],
        aliases: ['content', 'контент', 'marketing', 'пости', 'business cards'],
        businessPurpose: 'Marketing/content workspace для контент-планів, generation, publish flow і business cards.',
        owns: ['content items', 'marketing plans', 'publish actions', 'business cards'],
        primaryQuestions: ['який контент підготувати', 'де статус публікації', 'що треба доробити'],
        relatedModules: ['programs', 'designs', 'sales-funnel'],
        apiHints: ['/api/content/*', '/api/marketing-agent/*', '/api/business-cards/*'],
        guardrails: ['Не заявляй, що контент опубліковано, без publish/API confirmation.']
    },
    designs: {
        pageKey: 'designs',
        label: 'Дизайн-борд',
        pathnames: ['/designs', '/designs.html', '/art', '/art-director'],
        aliases: ['designs', 'design', 'дизайни', 'арт директор', 'каталоги дизайну'],
        businessPurpose: 'Design/product visual board: gallery, collections, price/calendar/catalogs і production pipeline для візуалів.',
        owns: ['design gallery', 'collections', 'price list', 'calendar', 'catalog cards'],
        primaryQuestions: ['де каталог дизайнів', 'який production status', 'що показати клієнту'],
        relatedModules: ['programs', 'content', 'graduation'],
        apiHints: ['/api/designs/*', '/api/products/catalogs'],
        guardrails: ['Не вигадуй готовність макета без visible/API status.']
    },
    'art-director': {
        aliasOf: 'designs'
    },
    graduation: {
        pageKey: 'graduation',
        label: 'Випускний',
        pathnames: ['/graduation', '/graduation.html'],
        aliases: ['graduation', 'випускний', 'дипломи', 'діти випускний'],
        businessPurpose: 'Workspace для випускних подій: quotes, дипломи, списки дітей, export/print і підготовчі задачі.',
        owns: ['graduation quotes', 'diplomas', 'children list', 'export/print', 'preparation tasks'],
        primaryQuestions: ['що готово по випускному', 'де дипломи', 'що треба підготувати'],
        relatedModules: ['programs', 'tasks', 'designs', 'certificates'],
        apiHints: ['/api/graduation/*'],
        guardrails: ['Не вигадуй імена дітей або дипломні тексти без live даних.']
    }
};

const PATH_TO_PAGE = {};
const ALIAS_TO_PAGE = {};

function canonicalEntry(key) {
    const entry = PAGE_KNOWLEDGE[key];
    if (!entry) return null;
    if (entry.aliasOf) return canonicalEntry(entry.aliasOf);
    return entry;
}

for (const [key, rawEntry] of Object.entries(PAGE_KNOWLEDGE)) {
    const entry = canonicalEntry(key);
    if (!entry) continue;
    for (const pathname of asArray(rawEntry.pathnames || entry.pathnames)) {
        PATH_TO_PAGE[normalizePathname(pathname)] = entry.pageKey;
    }
    for (const alias of asArray(rawEntry.aliases || entry.aliases)) {
        ALIAS_TO_PAGE[normalizePageKey(alias)] = entry.pageKey;
    }
    ALIAS_TO_PAGE[normalizePageKey(key)] = entry.pageKey;
    ALIAS_TO_PAGE[normalizePageKey(entry.pageKey)] = entry.pageKey;
}

function normalizePathname(value = '') {
    let raw = compactText(value, 160);
    if (!raw) return '/';
    try {
        raw = new URL(raw, 'https://crm.local').pathname;
    } catch {}
    raw = raw.split('?')[0].split('#')[0].trim();
    if (!raw.startsWith('/')) raw = `/${raw}`;
    raw = raw.replace(/\/+$/, '') || '/';
    raw = raw.replace(/\.html$/i, '');
    return raw || '/';
}

function normalizePageKey(value = '') {
    const text = compactText(value, 120).toLowerCase();
    if (!text) return '';
    return text
        .replace(/\.html$/i, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\s+/g, '-')
        || 'timeline';
}

function resolvePageKey(input = {}) {
    const source = typeof input === 'string' ? { pageKey: input } : (input || {});
    const rawPath = source.pathname || source.path || source.href || '';
    if (rawPath) {
        const pathname = normalizePathname(rawPath);
        if (PATH_TO_PAGE[pathname]) return PATH_TO_PAGE[pathname];
    }

    const candidates = [
        source.pageKey,
        source.page,
        source.module,
        source.id,
        source.href,
        rawPath
    ];
    for (const candidate of candidates) {
        const normalized = normalizePageKey(candidate);
        if (!normalized) continue;
        if (normalized === 'index') return 'timeline';
        if (ALIAS_TO_PAGE[normalized]) return ALIAS_TO_PAGE[normalized];
    }
    return 'dashboard';
}

function getAssistantPageKnowledge(input = {}) {
    const key = resolvePageKey(input);
    return canonicalEntry(key) || canonicalEntry('dashboard');
}

function normalizeEntity(input = {}) {
    if (!input || typeof input !== 'object') return null;
    const type = compactText(input.type || input.entityType || input.kind, 60);
    const id = compactText(input.id || input.entityId || input.selectedEntityId, 80);
    const label = compactText(input.label || input.name || input.title, 120);
    if (!type && !id && !label) return null;
    return { type, id, label };
}

function normalizeFilters(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = {};
    for (const [key, value] of Object.entries(input).slice(0, 12)) {
        if (value === null || value === undefined || value === '') continue;
        if (['string', 'number', 'boolean'].includes(typeof value)) {
            out[compactText(key, 50)] = compactText(value, 120);
        }
    }
    return out;
}

function normalizePageContext(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const rawPath = source.pathname || source.path || source.href || '';
    const normalizedPath = rawPath ? normalizePathname(rawPath) : '';
    const pageKey = resolvePageKey({ ...source, pathname: normalizedPath });
    const knowledge = getAssistantPageKnowledge(pageKey);
    const selectedEntity = normalizeEntity(source.selectedEntity || {
        type: source.selectedEntityType,
        id: source.selectedEntityId,
        label: source.selectedEntityLabel
    });

    return {
        pageKey: knowledge.pageKey || pageKey,
        pathname: normalizedPath || normalizePathname((knowledge.pathnames || [])[0] || ''),
        pageTitle: compactText(source.pageTitle || source.title || source.label || knowledge.label, 160),
        activeTab: compactText(source.activeTab || source.tab || source.view, 120),
        selectedEntity,
        selectedEntityId: compactText(source.selectedEntityId || selectedEntity?.id || '', 80),
        activeFilters: normalizeFilters(source.activeFilters || source.filters || {}),
        relatedPageHints: compactList(source.relatedPageHints || source.relatedHints || [], 8, 140)
    };
}

function listAssistantPages() {
    return Object.values(PAGE_KNOWLEDGE)
        .filter(entry => !entry.aliasOf)
        .map(entry => ({
            pageKey: entry.pageKey,
            label: entry.label,
            pathnames: entry.pathnames || [],
            aliases: entry.aliases || []
        }));
}

function formatList(label, items = []) {
    const list = compactList(items, 8, 150);
    return list.length ? `${label}: ${list.join('; ')}` : '';
}

function buildPageKnowledgePrompt(input = {}) {
    const context = normalizePageContext(input);
    const page = getAssistantPageKnowledge(context.pageKey);
    const related = compactList(page.relatedModules, 8, 80)
        .map(key => getAssistantPageKnowledge(key))
        .filter(Boolean)
        .map(item => `${item.label} (${item.pageKey})`);
    const lines = [
        '=== КОНТЕКСТ ПОТОЧНОЇ СТОРІНКИ ===',
        `Сторінка: ${page.label} (${page.pageKey})`,
        context.pathname ? `Path: ${context.pathname}` : '',
        context.pageTitle && context.pageTitle !== page.label ? `UI title: ${context.pageTitle}` : '',
        context.activeTab ? `Активний view/tab: ${context.activeTab}` : '',
        context.selectedEntity ? `Обраний обʼєкт: ${[context.selectedEntity.type, context.selectedEntity.id, context.selectedEntity.label].filter(Boolean).join(' | ')}` : '',
        Object.keys(context.activeFilters).length ? `Активні фільтри: ${Object.entries(context.activeFilters).map(([key, value]) => `${key}=${value}`).join('; ')}` : '',
        `Бізнес-сенс: ${page.businessPurpose}`,
        formatList('Що модуль реально володіє', page.owns),
        formatList('На які питання відповідає напряму', page.primaryQuestions),
        related.length ? `Повʼязані модулі: ${related.join('; ')}` : '',
        formatList('Domain terms', page.domainTerms),
        formatList('Cross-page hints', page.crossPageHints),
        formatList('API/domain hints', page.apiHints),
        formatList('Guardrails', page.guardrails),
        'Правило відповіді: розрізняй знання про модуль, live дані поточної сторінки і дані, яких немає в контексті. Якщо точних live даних немає, скажи це прямо і дай корисний navigation/business next step.'
    ].filter(Boolean);
    return lines.join('\n');
}

function buildPageKnowledgeDebug(input = {}) {
    const context = normalizePageContext(input);
    const knowledge = getAssistantPageKnowledge(context.pageKey);
    return {
        pageContext: context,
        knowledge: {
            pageKey: knowledge.pageKey,
            label: knowledge.label,
            relatedModules: knowledge.relatedModules || [],
            apiHints: knowledge.apiHints || []
        }
    };
}

const TOPIC_PATTERNS = [
    { topic: 'funnel', pattern: /воронк|funnel|pipeline|пайплайн|лід|lead|ліди|продаж/i, target: 'sales-funnel' },
    { topic: 'customers', pattern: /клієнт|customer|rfm|дублікат|сегмент/i, target: 'customers' },
    { topic: 'finance', pattern: /фінанс|гроші|борг|оплат|p&l|pnl|cashflow|каса/i, target: 'finance' },
    { topic: 'tasks', pattern: /задач|task|дедлайн|простроч/i, target: 'tasks' },
    { topic: 'timeline', pattern: /бронюван|таймлайн|розклад|поді[яї]|booking|event/i, target: 'timeline' },
    { topic: 'staff', pattern: /графік|змін|персонал|staff|hr|кадри/i, target: 'staff' },
    { topic: 'programs', pattern: /програм|послуг|продукт|catalog|каталог/i, target: 'programs' },
    { topic: 'certificates', pattern: /сертифікат|грамот|certificate/i, target: 'certificates' }
];

function detectPageKnowledgeTopic(message = '') {
    const text = String(message || '');
    return TOPIC_PATTERNS.find(item => item.pattern.test(text)) || null;
}

function isConceptQuestion(message = '') {
    const text = String(message || '').toLowerCase();
    return /(що таке|як працю|що означ|поясни|пов.?язан|зв.?яз|де це|де знайти|куди|what is|how does)/i.test(text);
}

function buildPageKnowledgeAnswer(message = '', input = {}) {
    const topic = detectPageKnowledgeTopic(message);
    if (!topic || !isConceptQuestion(message)) return null;

    const context = normalizePageContext(input);
    const current = getAssistantPageKnowledge(context.pageKey);
    const target = getAssistantPageKnowledge(topic.target);
    if (!target) return null;

    const samePage = current.pageKey === target.pageKey;
    const relationship = samePage
        ? `Ти зараз саме в модулі «${target.label}», тому тут доречно дивитися ${compactList(target.owns, 4, 80).join(', ')}.`
        : `Ти зараз у «${current.label}», а детальний робочий модуль для цього — «${target.label}» (${(target.pathnames || [])[0] || target.pageKey}).`;

    let concept = target.businessPurpose;
    if (topic.topic === 'funnel') {
        concept = 'Воронка — це шлях звернення від нового ліда до контакту, інфо, угоди, завдатку, очікування, проведення, закриття або втрати.';
    } else if (topic.topic === 'customers') {
        concept = 'Клієнти — це CRM база профілів, історії, RFM, тегів і комунікацій; вона не замінює pipeline лідів, а доповнює його після або поруч із продажем.';
    }

    const crossHints = compactList(target.crossPageHints || current.crossPageHints || [], 2, 180).join(' ');
    const liveCaveat = 'Точні live-цифри я беру тільки з відкритого контексту або API; якщо їх немає в запиті, не буду вигадувати.';
    const suggestions = compactList([
        samePage ? `Пояснити ${target.label}` : `Відкрити ${target.label}`,
        current.pageKey === 'customers' && topic.topic === 'funnel' ? 'Як клієнти повʼязані з лідами?' : '',
        'Що тут найважливіше?'
    ], 3, 80);

    return {
        message: `🤖 ${concept}\n\n${relationship}${crossHints ? ` ${crossHints}` : ''}\n\n${liveCaveat}`,
        suggestions,
        source: 'page-knowledge',
        pageContext: buildPageKnowledgeDebug(context)
    };
}

module.exports = {
    PAGE_KNOWLEDGE,
    listAssistantPages,
    normalizePathname,
    normalizePageKey,
    resolvePageKey,
    normalizePageContext,
    getAssistantPageKnowledge,
    buildPageKnowledgePrompt,
    buildPageKnowledgeDebug,
    buildPageKnowledgeAnswer,
    detectPageKnowledgeTopic
};
