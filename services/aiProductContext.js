/**
 * services/aiProductContext.js - read-only product context excerpts for CRM AI.
 *
 * This intentionally loads a tiny, deterministic slice from docs/ai-context
 * instead of dumping the whole knowledge base into the assistant prompt.
 */
const fs = require('fs');
const path = require('path');

const DOC_ROOT = path.join(__dirname, '..', 'docs', 'ai-context');
const DEFAULT_EXCERPT_LIMIT = 900;
const DEFAULT_DOC_LIMIT = 4;

const PAGE_DOCS = {
    dashboard: 'pages/dashboard.md',
    timeline: 'pages/timeline.md',
    tasks: 'pages/tasks.md',
    chat: 'pages/chat.md',
    customers: 'pages/client.md',
    customer: 'pages/client.md',
    client: 'pages/client.md',
    clients: 'pages/client.md',
    leads: 'pages/sales-funnel.md',
    sales: 'pages/sales-funnel.md',
    'sales-funnel': 'pages/sales-funnel.md',
    omni: 'pages/omni.md',
    reports: 'pages/reports.md',
    finance: 'pages/finance.md',
    analytics: 'pages/analytics.md',
    copilot: 'pages/copilot.md',
    staff: 'pages/staff.md',
    hr: 'pages/hr.md',
    training: 'pages/training.md',
    products: 'pages/products.md',
    content: 'pages/content.md',
    art: 'pages/art.md',
    graduation: 'pages/graduation.md',
    designs: 'pages/designs.md',
    designer: 'pages/designer.md',
    sound: 'pages/sound.md',
    afisha: 'pages/afisha.md',
    certificates: 'pages/certificates.md',
    warehouse: 'pages/warehouse.md',
    game: 'pages/game.md',
    shop: 'pages/shop.md',
    profile: 'pages/profile.md',
    status: 'pages/status.md',
    room: 'pages/room.md',
    quiz: 'pages/quiz.md'
};

const ENTITY_MATCHERS = [
    { rel: 'entities/call.md', pattern: /\b(call|calls|phone|ring)\b|дзвін|дзвон|подзвон|комунікац/i },
    { rel: 'entities/client.md', pattern: /\b(client|customer|rfm)\b|клієнт|замовник/i },
    { rel: 'entities/lead.md', pattern: /\b(lead|funnel)\b|лід|воронк/i },
    { rel: 'entities/task.md', pattern: /\b(task|todo|deadline)\b|задач|дедлайн|простроч/i },
    { rel: 'entities/conversation.md', pattern: /\b(chat|conversation|inbox|dm)\b|чат|розмов|повідомлен/i },
    { rel: 'entities/booking.md', pattern: /\b(booking|reservation)\b|брон|подія/i },
    { rel: 'entities/product.md', pattern: /\b(product|program|catalog)\b|продукт|програм|каталог/i },
    { rel: 'entities/warehouse-item.md', pattern: /\b(warehouse|stock|inventory)\b|склад|залишк|товар/i },
    { rel: 'entities/sound-asset.md', pattern: /\b(sound|music|audio|suno|tts)\b|звук|музик|аудіо|оголош/i },
    { rel: 'entities/staff-member.md', pattern: /\b(staff|employee|shift|hr)\b|персонал|співробіт|зміна|графік/i }
];

const WORKFLOW_MATCHERS = [
    { rel: 'workflows/client-call-flow.md', pattern: /\b(call|phone|follow[- ]?up)\b|дзвін|дзвон|подзвон|комунікац/i },
    { rel: 'workflows/lead-to-booking-flow.md', pattern: /\b(lead|booking|funnel)\b|лід|воронк|брон/i },
    { rel: 'workflows/task-lifecycle.md', pattern: /\b(task|todo|deadline|done)\b|задач|дедлайн|викон/i },
    { rel: 'workflows/omni-reply-flow.md', pattern: /\b(reply|conversation|inbox|omni)\b|відповід|чат|повідомлен/i },
    { rel: 'workflows/graduation-diploma-flow.md', pattern: /\b(graduation|diploma)\b|випуск|диплом/i },
    { rel: 'workflows/account-management-flow.md', pattern: /\b(account|user|permission|role)\b|акаунт|користувач|роль|доступ/i }
];

function compactString(value, limit = DEFAULT_EXCERPT_LIMIT) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, limit);
}

function normalizePageKey(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    const cleaned = raw
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/[?#].*$/, '')
        .replace(/^\/+/, '')
        .replace(/\.html$/, '')
        .replace(/^api\//, '')
        .replace(/^crm\//, '');
    const key = cleaned.split('/')[0] || raw;
    if (key === 'customer' || key === 'client' || key === 'clients') return 'customers';
    if (key === 'leads' || key === 'sales') return 'sales-funnel';
    return key || 'dashboard';
}

function readDoc(rel) {
    const fullPath = path.join(DOC_ROOT, rel);
    if (!fullPath.startsWith(DOC_ROOT) || !fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf8');
}

function titleFromMarkdown(markdown, rel) {
    const heading = String(markdown || '').match(/^#\s+(.+)$/m);
    return heading ? heading[1].trim() : rel;
}

function addDoc(target, rel, reason, options = {}) {
    if (!rel || target.some(item => item.path === rel)) return;
    if (target.length >= (options.docLimit || DEFAULT_DOC_LIMIT)) return;
    const markdown = readDoc(rel);
    if (!markdown) return;
    target.push({
        path: rel,
        title: titleFromMarkdown(markdown, rel),
        reason,
        excerpt: compactString(markdown, options.excerptLimit || DEFAULT_EXCERPT_LIMIT)
    });
}

function matchDocs(matchers, text, target, reason, options) {
    for (const matcher of matchers) {
        if (target.length >= (options.docLimit || DEFAULT_DOC_LIMIT)) return;
        if (matcher.pattern.test(text)) addDoc(target, matcher.rel, reason, options);
    }
}

function selectAIProductContext(input = {}, options = {}) {
    const pageContext = input.pageContext && typeof input.pageContext === 'object' ? input.pageContext : {};
    const pageKey = normalizePageKey(pageContext.pageKey || input.page || input.pageKey || pageContext.pathname || input.pathname || input.path);
    const text = [
        input.userMessage,
        input.intent,
        input.title,
        pageContext.selectedEntity,
        pageContext.activeTab,
        pageContext.pageTitle
    ].filter(Boolean).join('\n');
    const normalizedText = text || pageKey;
    const documents = [];

    addDoc(documents, PAGE_DOCS[pageKey], `current-page:${pageKey}`, options);
    matchDocs(ENTITY_MATCHERS, normalizedText, documents, 'matched-entity', options);
    matchDocs(WORKFLOW_MATCHERS, normalizedText, documents, 'matched-workflow', options);

    return {
        source: 'docs/ai-context',
        pageKey,
        documents
    };
}

function buildAIProductContextPrompt(productContext = {}) {
    const documents = Array.isArray(productContext.documents) ? productContext.documents : [];
    if (!documents.length) return '';
    const lines = [
        'AI PRODUCT CONTEXT (read-only excerpts from docs/ai-context; use for product terminology and workflow grounding, not as live data):'
    ];
    documents.forEach((doc, index) => {
        lines.push(`DOC ${index + 1}: ${doc.title} [${doc.path}] reason=${doc.reason}`);
        lines.push(doc.excerpt);
    });
    return lines.join('\n\n');
}

module.exports = {
    selectAIProductContext,
    buildAIProductContextPrompt,
    normalizePageKey
};
