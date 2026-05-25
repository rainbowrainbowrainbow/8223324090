'use strict';

const { pool } = require('../db');
const { settingsCache } = require('./cache');
const { createLogger } = require('../utils/logger');
const {
  DEFAULT_BUSINESS_CONTEXT,
  normalizeBusinessContext,
} = require('./businessContext');

const log = createLogger('OmniLeadAssistant');

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const SETTINGS_KEY = 'omni_lead_assistant_config';
const DEFAULT_MODEL = process.env.OMNI_LEAD_AI_MODEL
  || process.env.OPENAI_OMNI_LEAD_MODEL
  || process.env.OPENAI_ASSISTANT_MODEL
  || 'gpt-4.1-mini';

const FIELD_DEFINITIONS = {
  client_name: {
    label: "Ім'я клієнта",
    question: 'Як до вас можна звертатись?',
    required: true,
  },
  contact: {
    label: 'Контакт',
    question: 'Підкажіть номер телефону для бронювання.',
    required: true,
  },
  event_type: {
    label: 'Тип події',
    question: 'Який формат події плануєте: день народження, випускний, корпоратив чи інше?',
    required: true,
  },
  event_date: {
    label: 'Дата або період',
    question: 'На яку дату або хоча б на який період плануєте свято?',
    required: true,
  },
  children_count: {
    label: 'Кількість дітей',
    question: 'Скільки дітей планується?',
    required: true,
  },
  child_age: {
    label: 'Вік дітей',
    question: 'Який вік дітей або іменинника?',
    required: true,
  },
  program_preferences: {
    label: 'Побажання до програми',
    question: 'Що більше цікавить: квест, аніматор, майстер-клас, банкет чи все разом?',
    required: true,
  },
  budget: {
    label: 'Бюджет',
    question: 'На який бюджет орієнтуєтесь?',
    required: false,
  },
};

const DEFAULT_REQUIRED_FIELDS = [
  'client_name',
  'contact',
  'event_type',
  'event_date',
  'children_count',
  'child_age',
  'program_preferences',
  'budget',
].map(key => ({ key, ...FIELD_DEFINITIONS[key] }));

const DEFAULT_SCRIPT_RULES = [
  'Вести діалог коротко, тепло і без тиску.',
  'Спочатку закрити обовʼязкові поля, потім радити формат.',
  'Не називати остаточну ціну без кількості дітей, віку, дати і формату.',
  'Якщо даних мало, ставити одне найважливіше питання за раз.',
  'Коли всі ключові потреби зібрані, вести до бронювання або дзвінка менеджера.',
].join('\n');

const DEFAULT_SCENARIOS = [
  {
    id: 'birthday',
    label: 'День народження',
    keywords: ['день народження', 'др', 'іменин', 'birthday'],
    requiredFieldKeys: ['client_name', 'contact', 'event_date', 'children_count', 'child_age', 'program_preferences'],
    catalogTags: ['program', 'cake', 'menu', 'pinyata', 'costume'],
    nextStepGoal: 'recommend_package',
    enabled: true,
  },
  {
    id: 'graduation',
    label: 'Випускний',
    keywords: ['випускний', 'садочок', 'школа', 'graduation'],
    requiredFieldKeys: ['client_name', 'contact', 'event_date', 'children_count', 'child_age', 'program_preferences'],
    catalogTags: ['graduation', 'program', 'menu'],
    nextStepGoal: 'send_catalog',
    enabled: true,
  },
  {
    id: 'corporate',
    label: 'Корпоратив / компанія',
    keywords: ['корпоратив', 'компанія', 'team', 'corporate'],
    requiredFieldKeys: ['client_name', 'contact', 'event_date', 'children_count', 'program_preferences', 'budget'],
    catalogTags: ['program', 'menu'],
    nextStepGoal: 'manager_call',
    enabled: true,
  },
  {
    id: 'trip',
    label: 'Груповий візит',
    keywords: ['група', 'клас', 'екскурсія', 'виїзд', 'школа'],
    requiredFieldKeys: ['client_name', 'contact', 'event_date', 'children_count', 'child_age'],
    catalogTags: ['program', 'menu'],
    nextStepGoal: 'collect_date',
    enabled: true,
  },
  {
    id: 'info',
    label: 'Інформаційний запит',
    keywords: ['ціна', 'скільки', 'прайс', 'розклад', 'графік'],
    requiredFieldKeys: ['contact', 'event_type', 'program_preferences'],
    catalogTags: ['program'],
    nextStepGoal: 'qualify_lead',
    enabled: true,
  },
];

const DEFAULT_GUARDRAILS = [
  { id: 'no_fake_prices', label: 'Не вигадувати ціни', text: 'Не називати ціну, якої немає в каталозі або в CRM-даних.', severity: 'blocker', enabled: true },
  { id: 'no_fake_availability', label: 'Не підтверджувати дату без CRM', text: 'Не казати, що дата або зал точно вільні, якщо це не підтверджено календарем/бронюванням.', severity: 'blocker', enabled: true },
  { id: 'no_unapproved_discount', label: 'Не обіцяти знижку', text: 'Не обіцяти знижку, бонус або подарунок без правила чи дозволу менеджера.', severity: 'warning', enabled: true },
  { id: 'no_final_booking_without_deposit', label: 'Не підтверджувати бронь без передоплати', text: 'Фінальну бронь підтверджує менеджер після умов бронювання та передоплати.', severity: 'blocker', enabled: true },
  { id: 'one_question', label: 'Одне питання за раз', text: 'У відповідях ставити одне ключове питання, не перевантажувати клієнта анкетою.', severity: 'style', enabled: true },
];

const DEFAULT_NEXT_STEP_GOALS = [
  { id: 'qualify_lead', label: 'Кваліфікувати лід', description: 'Зрозуміти формат події і чи це реальний запит.', enabled: true },
  { id: 'collect_contact', label: 'Отримати контакт', description: 'Попросити телефон або зручний канал для бронювання.', enabled: true },
  { id: 'collect_date', label: 'Дізнатись дату', description: 'Уточнити дату або період, щоб перевірити доступність.', enabled: true },
  { id: 'recommend_package', label: 'Підібрати пакет', description: 'Запропонувати 1-3 релевантні програми/матеріали.', enabled: true },
  { id: 'send_catalog', label: 'Надіслати каталог', description: 'Вставити релевантний каталог або вкладення.', enabled: true },
  { id: 'manager_call', label: 'Передати менеджеру', description: 'Запропонувати короткий дзвінок або ручний підбір.', enabled: true },
  { id: 'create_booking', label: 'Вести до бронювання', description: 'Коли дані зібрані, запропонувати зафіксувати дату.', enabled: true },
  { id: 'follow_up_task', label: 'Follow-up', description: 'Якщо клієнт думає, створити наступний контакт.', enabled: true },
];

const DEFAULT_REPLY_TEMPLATES = [
  {
    key: 'greeting',
    title: 'Привітання',
    text: 'Вітаю! Підкажіть, будь ласка, для якої події підбираєте формат і на яку дату орієнтуєтесь?',
    enabled: true,
  },
  {
    key: 'need_question',
    title: 'Уточнення потреби',
    text: 'Щоб порадити найкращий варіант, уточню одне питання: {{question}}',
    enabled: true,
  },
  {
    key: 'catalog_offer',
    title: 'Пропозиція каталогу',
    text: 'Можу скинути вам кілька варіантів, які найкраще підходять під вік і формат. Ось що раджу подивитись: {{materials}}',
    enabled: true,
  },
  {
    key: 'price_objection',
    title: 'Відповідь на “дорого”',
    text: 'Розумію. Можемо підібрати формат простіше або залишити головне враження і прибрати необовʼязкові допи. Підкажіть, у який бюджет комфортно вписатись?',
    enabled: true,
  },
  {
    key: 'think_followup',
    title: 'Клієнт думає',
    text: 'Добре, я тоді залишу коротко варіанти. Якщо дата важлива, краще попередньо перевірити її, бо місця можуть змінюватись.',
    enabled: true,
  },
  {
    key: 'booking_close',
    title: 'Доведення до броні',
    text: 'Якщо формат підходить, можу передати менеджеру, щоб перевірили дату і підказали наступний крок по бронюванню.',
    enabled: true,
  },
];

const DEFAULT_CATALOG_SOURCES = [
  { id: 'program_products', label: 'Програми CRM', source: 'products', domain: 'program', kitchenType: null, tags: ['program'], maxItems: 18, enabled: true },
  { id: 'cake_products', label: 'Торти', source: 'products', domain: 'kitchen', kitchenType: 'cake', tags: ['cake'], maxItems: 8, enabled: true },
  { id: 'menu_products', label: 'Меню / банкет', source: 'products', domain: 'kitchen', kitchenType: 'menu', tags: ['menu'], maxItems: 12, enabled: true },
  { id: 'catalog_items', label: 'Дизайн-каталоги', source: 'catalog_items', domain: null, kitchenType: null, tags: ['pinyata', 'costume', 'catalog'], maxItems: 18, enabled: true },
];

const DEFAULT_MANUAL_MATERIALS = [
  {
    id: 'programs_page',
    title: 'Каталог програм',
    type: 'link',
    url: '/programs',
    description: 'Внутрішній каталог програм і пакетів для підбору формату.',
    tags: ['program'],
    scenarioIds: ['birthday', 'trip', 'corporate'],
    enabled: true,
  },
  {
    id: 'graduation_catalog',
    title: 'Каталог випускних',
    type: 'link',
    url: '/designs#catalog-graduation',
    description: 'Випускні програми, ідеї та матеріали для груп.',
    tags: ['graduation'],
    scenarioIds: ['graduation'],
    enabled: true,
  },
  {
    id: 'cake_catalog',
    title: 'Каталог тортів',
    type: 'link',
    url: '/programs?domain=kitchen&kitchenType=cake',
    description: 'Торти з CRM-каталогу для допродажу до дня народження.',
    tags: ['cake'],
    scenarioIds: ['birthday'],
    enabled: true,
  },
  {
    id: 'menu_catalog',
    title: 'Меню / банкет',
    type: 'link',
    url: '/programs?domain=kitchen&kitchenType=menu',
    description: 'Банкетне меню та додаткове харчування.',
    tags: ['menu'],
    scenarioIds: ['birthday', 'graduation', 'corporate', 'trip'],
    enabled: true,
  },
  {
    id: 'certificates_page',
    title: 'Подарункові сертифікати',
    type: 'link',
    url: '/certificates',
    description: 'Сертифікати як альтернатива, якщо клієнт не готовий бронювати дату.',
    tags: ['certificate'],
    scenarioIds: ['info', 'birthday'],
    enabled: true,
  },
];

const EVENT_TYPE_TO_QUALITY = {
  birthday: 'birthday',
  graduation: 'graduation',
  corporate: 'corporate',
  trip: 'trip',
  other: null,
};

function compactString(value, limit = 500) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, limit);
}

function cleanLongText(value, limit = 3000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, limit);
}

function safeParseJson(value, fallback = null) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractResponseText(payload) {
  if (payload?.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
      if (content?.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value !== false && value !== 'false';
}

function normalizeFieldKey(value, fallback = '') {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return key || fallback;
}

function normalizeRequiredFields(fields) {
  const input = Array.isArray(fields) && fields.length ? fields : DEFAULT_REQUIRED_FIELDS;
  const normalized = [];
  const seen = new Set();

  for (const item of input) {
    const key = normalizeFieldKey(item?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fallback = FIELD_DEFINITIONS[key] || {};
    normalized.push({
      key,
      label: compactString(item?.label || fallback.label || key, 80),
      question: compactString(item?.question || fallback.question || `Уточніть ${fallback.label || key}.`, 240),
      required: normalizeBoolean(item?.required, fallback.required !== false),
    });
    if (normalized.length >= 16) break;
  }

  return normalized.length ? normalized : DEFAULT_REQUIRED_FIELDS;
}

function normalizeStringList(value, limit = 20) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,\n]/);
  const items = [];
  const seen = new Set();
  for (const raw of source) {
    const text = compactString(raw, 80);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}

function normalizeScenarioList(scenarios) {
  const input = Array.isArray(scenarios) && scenarios.length ? scenarios : DEFAULT_SCENARIOS;
  const normalized = [];
  const seen = new Set();
  for (const item of input) {
    const id = normalizeFieldKey(item?.id || item?.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      label: compactString(item?.label || id, 100),
      keywords: normalizeStringList(item?.keywords, 16),
      requiredFieldKeys: normalizeStringList(item?.requiredFieldKeys || item?.required_fields || item?.fields, 16)
        .map(key => normalizeFieldKey(key))
        .filter(Boolean),
      catalogTags: normalizeStringList(item?.catalogTags || item?.catalog_tags || item?.tags, 16)
        .map(tag => normalizeFieldKey(tag))
        .filter(Boolean),
      nextStepGoal: normalizeFieldKey(item?.nextStepGoal || item?.next_step_goal || 'qualify_lead'),
      enabled: normalizeBoolean(item?.enabled, true),
    });
    if (normalized.length >= 12) break;
  }
  return normalized.length ? normalized : DEFAULT_SCENARIOS;
}

function normalizeGuardrails(guardrails) {
  const input = Array.isArray(guardrails) && guardrails.length ? guardrails : DEFAULT_GUARDRAILS;
  return input
    .map((item, idx) => ({
      id: normalizeFieldKey(item?.id || `guardrail_${idx + 1}`),
      label: compactString(item?.label || item?.title || `Правило ${idx + 1}`, 100),
      text: compactString(item?.text || item?.description || item, 400),
      severity: ['blocker', 'warning', 'style'].includes(item?.severity) ? item.severity : 'warning',
      enabled: normalizeBoolean(item?.enabled, true),
    }))
    .filter(item => item.id && item.text)
    .slice(0, 20);
}

function normalizeNextStepGoals(goals) {
  const input = Array.isArray(goals) && goals.length ? goals : DEFAULT_NEXT_STEP_GOALS;
  return input
    .map((item, idx) => ({
      id: normalizeFieldKey(item?.id || `goal_${idx + 1}`),
      label: compactString(item?.label || item?.title || `Крок ${idx + 1}`, 100),
      description: compactString(item?.description || item?.text || '', 240),
      enabled: normalizeBoolean(item?.enabled, true),
    }))
    .filter(item => item.id && item.label)
    .slice(0, 16);
}

function normalizeReplyTemplates(templates) {
  const input = Array.isArray(templates) && templates.length ? templates : DEFAULT_REPLY_TEMPLATES;
  return input
    .map((item, idx) => ({
      key: normalizeFieldKey(item?.key || item?.id || `template_${idx + 1}`),
      title: compactString(item?.title || item?.label || `Шаблон ${idx + 1}`, 100),
      text: cleanLongText(item?.text || item?.body || '', 900),
      enabled: normalizeBoolean(item?.enabled, true),
    }))
    .filter(item => item.key && item.text)
    .slice(0, 20);
}

function normalizeCatalogSources(sources) {
  const input = Array.isArray(sources) && sources.length ? sources : DEFAULT_CATALOG_SOURCES;
  return input
    .map((item, idx) => {
      const source = ['products', 'catalog_items'].includes(item?.source) ? item.source : 'products';
      const domain = item?.domain === 'kitchen' || item?.domain === 'program' ? item.domain : null;
      const kitchenType = ['cake', 'menu'].includes(item?.kitchenType || item?.kitchen_type)
        ? (item.kitchenType || item.kitchen_type)
        : null;
      return {
        id: normalizeFieldKey(item?.id || `${source}_${idx + 1}`),
        label: compactString(item?.label || item?.title || `Каталог ${idx + 1}`, 100),
        source,
        domain,
        kitchenType,
        tags: normalizeStringList(item?.tags, 12).map(tag => normalizeFieldKey(tag)).filter(Boolean),
        maxItems: Math.max(1, Math.min(Number.parseInt(item?.maxItems || item?.max_items || 10, 10) || 10, 40)),
        enabled: normalizeBoolean(item?.enabled, true),
      };
    })
    .filter(item => item.id && item.label)
    .slice(0, 12);
}

function normalizeManualMaterials(materials) {
  const input = Array.isArray(materials) && materials.length ? materials : DEFAULT_MANUAL_MATERIALS;
  const seen = new Set();
  const normalized = [];
  for (const item of input) {
    const id = normalizeFieldKey(item?.id || item?.title || item?.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = ['link', 'pdf', 'image', 'video', 'text'].includes(item?.type) ? item.type : 'link';
    normalized.push({
      id,
      title: compactString(item?.title || item?.label || id, 140),
      type,
      url: compactString(item?.url || item?.href || '', 1000) || null,
      description: compactString(item?.description || item?.text || '', 500) || null,
      tags: normalizeStringList(item?.tags, 12).map(tag => normalizeFieldKey(tag)).filter(Boolean),
      scenarioIds: normalizeStringList(item?.scenarioIds || item?.scenario_ids || item?.scenarios, 12)
        .map(scenario => normalizeFieldKey(scenario))
        .filter(Boolean),
      enabled: normalizeBoolean(item?.enabled, true),
    });
    if (normalized.length >= 40) break;
  }
  return normalized;
}

function normalizeSettingsHistory(history) {
  const input = Array.isArray(history) ? history : [];
  return input
    .map(item => ({
      revision: Math.max(0, Number.parseInt(item?.revision, 10) || 0),
      updatedAt: compactString(item?.updatedAt || item?.updated_at, 40) || null,
      updatedBy: compactString(item?.updatedBy || item?.updated_by, 80) || null,
      summary: compactString(item?.summary, 220) || null,
      counts: {
        fields: Math.max(0, Number.parseInt(item?.counts?.fields, 10) || 0),
        scenarios: Math.max(0, Number.parseInt(item?.counts?.scenarios, 10) || 0),
        catalogSources: Math.max(0, Number.parseInt(item?.counts?.catalogSources, 10) || 0),
        manualMaterials: Math.max(0, Number.parseInt(item?.counts?.manualMaterials, 10) || 0),
        guardrails: Math.max(0, Number.parseInt(item?.counts?.guardrails, 10) || 0),
        templates: Math.max(0, Number.parseInt(item?.counts?.templates, 10) || 0),
      },
    }))
    .filter(item => item.revision || item.summary || item.updatedAt)
    .slice(0, 12);
}

function leadAssistantConfigSummary(config) {
  return [
    `${config.requiredFields?.length || 0} fields`,
    `${config.scenarios?.length || 0} scenarios`,
    `${config.catalogSources?.length || 0} catalog sources`,
    `${config.manualMaterials?.length || 0} manual materials`,
    `${config.guardrails?.length || 0} guardrails`,
    `${config.replyTemplates?.length || 0} templates`,
  ].join(', ');
}

function buildLeadAssistantHistorySnapshot(config) {
  return {
    revision: Math.max(0, Number.parseInt(config?.revision, 10) || 0),
    updatedAt: compactString(config?.updatedAt || config?.updated_at, 40) || null,
    updatedBy: compactString(config?.updatedBy || config?.updated_by, 80) || null,
    summary: leadAssistantConfigSummary(config || {}),
    counts: {
      fields: config?.requiredFields?.length || 0,
      scenarios: config?.scenarios?.length || 0,
      catalogSources: config?.catalogSources?.length || 0,
      manualMaterials: config?.manualMaterials?.length || 0,
      guardrails: config?.guardrails?.length || 0,
      templates: config?.replyTemplates?.length || 0,
    },
  };
}

function normalizeLeadAssistantConfig(input = {}) {
  const base = {
    enabled: true,
    model: DEFAULT_MODEL,
    tone: 'friendly_short',
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    scriptRules: DEFAULT_SCRIPT_RULES,
    scenarios: DEFAULT_SCENARIOS,
    guardrails: DEFAULT_GUARDRAILS,
    nextStepGoals: DEFAULT_NEXT_STEP_GOALS,
    replyTemplates: DEFAULT_REPLY_TEMPLATES,
    catalogSources: DEFAULT_CATALOG_SOURCES,
    manualMaterials: DEFAULT_MANUAL_MATERIALS,
  };
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled !== false,
    model: compactString(raw.model || DEFAULT_MODEL, 128) || DEFAULT_MODEL,
    tone: ['friendly_short', 'sales_direct', 'premium_care'].includes(raw.tone) ? raw.tone : base.tone,
    requiredFields: normalizeRequiredFields(raw.requiredFields),
    scriptRules: cleanLongText(raw.scriptRules || base.scriptRules, 4000) || base.scriptRules,
    scenarios: normalizeScenarioList(raw.scenarios),
    guardrails: normalizeGuardrails(raw.guardrails),
    nextStepGoals: normalizeNextStepGoals(raw.nextStepGoals || raw.next_step_goals),
    replyTemplates: normalizeReplyTemplates(raw.replyTemplates || raw.reply_templates),
    catalogSources: normalizeCatalogSources(raw.catalogSources || raw.catalog_sources),
    manualMaterials: normalizeManualMaterials(raw.manualMaterials || raw.manual_materials),
    revision: Math.max(0, Number.parseInt(raw.revision, 10) || 0),
    updatedAt: compactString(raw.updatedAt || raw.updated_at, 40) || null,
    updatedBy: compactString(raw.updatedBy || raw.updated_by, 80) || null,
    history: normalizeSettingsHistory(raw.history),
  };
}

async function readLeadAssistantSettingsRaw() {
  const cached = settingsCache.get(SETTINGS_KEY);
  if (cached !== null) return safeParseJson(cached, {});

  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
  const value = result.rows[0]?.value || null;
  settingsCache.set(SETTINGS_KEY, value);
  return safeParseJson(value, {});
}

async function getLeadAssistantSettings() {
  return normalizeLeadAssistantConfig(await readLeadAssistantSettingsRaw());
}

async function saveLeadAssistantSettings(input, meta = {}) {
  const previousRaw = await readLeadAssistantSettingsRaw();
  const previous = normalizeLeadAssistantConfig(previousRaw || {});
  const settings = normalizeLeadAssistantConfig(input || {});
  const previousRevision = Math.max(0, Number.parseInt(previousRaw?.revision || previous.revision, 10) || 0);
  const history = normalizeSettingsHistory(previousRaw?.history);
  const hadPreviousSettings = previousRaw && typeof previousRaw === 'object' && Object.keys(previousRaw).length > 0;

  if (hadPreviousSettings) {
    const snapshot = buildLeadAssistantHistorySnapshot(previous);
    if (!history.some(item => item.revision === snapshot.revision && item.updatedAt === snapshot.updatedAt)) {
      history.unshift(snapshot);
    }
  }

  settings.revision = previousRevision + 1;
  settings.updatedAt = new Date().toISOString();
  settings.updatedBy = compactString(meta.username || meta.name || input?.updatedBy || input?.updated_by, 80) || null;
  settings.history = history.slice(0, 12);

  const value = JSON.stringify(settings);
  await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SETTINGS_KEY, value]
  );
  settingsCache.invalidate(SETTINGS_KEY);
  return settings;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  const raw = compactString(value, 40);
  if (!raw) return '';
  const digits = normalizeDigits(raw);
  if (digits.length < 9) return raw;
  if (digits.startsWith('380')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+38${digits}`;
  if (digits.length === 9) return `+380${digits}`;
  return raw;
}

function parsePositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? Math.round(parsed) : null;
}

function toIsoDate(value) {
  const raw = compactString(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ddmmyyyy = raw.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (!ddmmyyyy) return null;
  const year = ddmmyyyy[3]
    ? (ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3])
    : String(new Date().getFullYear());
  const month = ddmmyyyy[2].padStart(2, '0');
  const day = ddmmyyyy[1].padStart(2, '0');
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : iso;
}

function normalizeEventType(value, text = '') {
  const raw = `${value || ''} ${text || ''}`.toLowerCase();
  if (/випуск|graduation|садоч|школ/.test(raw)) return 'graduation';
  if (/корпоратив|corporate|компан/.test(raw)) return 'corporate';
  if (/виїзд|выезд|trip|school trip|екскурс/.test(raw)) return 'trip';
  if (/день народ|др|birthday|іменин/.test(raw)) return 'birthday';
  if (/birthday|graduation|corporate|trip|other/.test(String(value || ''))) return String(value || '').trim();
  return value ? compactString(value, 40) : null;
}

function normalizeLeadType(value) {
  const raw = String(value || '').trim().toLowerCase();
  return ['quality', 'spam', 'collaboration', 'informational', 'low_quality'].includes(raw) ? raw : 'quality';
}

function buildTranscript(messages = []) {
  return messages
    .map(message => {
      const who = message.direction === 'outbound' ? (message.ai_generated ? 'AI/CRM' : 'Менеджер') : 'Клієнт';
      const time = message.created_at ? new Date(message.created_at).toISOString() : '';
      return `[${time}] ${who}: ${compactString(message.content, 900)}`;
    })
    .filter(line => !line.endsWith(':'))
    .join('\n');
}

function inferEventType(text) {
  return normalizeEventType('', text);
}

function findFirst(regex, text) {
  const match = String(text || '').match(regex);
  return match ? compactString(match[1] || match[0], 120) : '';
}

function extractFallbackLead(bundle = {}) {
  const conversation = bundle.conversation || {};
  const messages = bundle.messages || [];
  const transcript = buildTranscript(messages);
  const messageText = messages.map(message => message.content || '').join('\n');
  const allText = `${conversation.customer_name || ''}\n${conversation.customer_phone || ''}\n${messageText}`;
  const phone = normalizePhone(conversation.customer_phone)
    || normalizePhone(findFirst(/(\+?\d[\d\s().-]{8,}\d)/, allText));
  const childrenCount = parsePositiveInt(findFirst(/(\d{1,3})\s*(?:дітей|дитини|дит|діток|kids|children)/i, allText));
  const childAge = parsePositiveInt(findFirst(/(\d{1,2})\s*(?:років|роки|р\.?|years|y\.o\.)/i, allText));
  const dateText = findFirst(/(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/, allText);
  const eventType = inferEventType(allText);
  const budget = parseMoney(findFirst(/(\d{3,6})\s*(?:грн|uah|₴)/i, allText));
  const name = compactString(
    conversation.customer_name && !/^unknown$/i.test(conversation.customer_name)
      ? conversation.customer_name
      : '',
    120
  );

  return normalizeLeadDraft({
    clientName: name || null,
    phone: phone || null,
    instagram: null,
    eventType,
    eventDate: toIsoDate(dateText),
    eventDateText: dateText || null,
    childrenCount,
    childAge,
    budget,
    programPreferences: /квест|quest|аніматор|анима|майстер|мастер|банкет|show|шоу/i.test(allText)
      ? compactString(findFirst(/(квест|quest|аніматор|анима[^\n.]*|майстер[^\n.]*|банкет[^\n.]*)/i, allText), 180)
      : null,
    notes: compactString(transcript, 900),
    leadType: 'quality',
    qualityCategory: EVENT_TYPE_TO_QUALITY[eventType] || null,
    confidence: name || phone || eventType || childrenCount ? 0.45 : 0.2,
  });
}

function normalizeCelebrants(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = compactString(item.name || item.childName || item.child_name, 80) || null;
      const age = parsePositiveInt(item.age || item.childAge || item.child_age);
      const birthday = toIsoDate(item.birthday || item.birthDate || item.birth_date);
      const notes = compactString(item.notes, 160) || null;
      if (!name && !age && !birthday && !notes) return null;
      return { name, age, birthday, notes, source: 'omni_ai' };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeLeadDraft(input = {}) {
  const eventType = normalizeEventType(input.eventType || input.event_type, input.notes);
  const childrenCount = parsePositiveInt(input.childrenCount ?? input.children_count);
  const childAge = parsePositiveInt(input.childAge ?? input.child_age);
  const eventDate = toIsoDate(input.eventDate || input.event_date);
  return {
    clientName: compactString(input.clientName || input.client_name, 160) || null,
    phone: normalizePhone(input.phone) || null,
    instagram: compactString(input.instagram, 100).replace(/^@+/, '') || null,
    eventType,
    eventDate,
    eventDateText: compactString(input.eventDateText || input.event_date_text, 80) || null,
    childrenCount,
    childAge,
    celebrants: normalizeCelebrants(input.celebrants),
    budget: parseMoney(input.budget),
    programPreferences: compactString(input.programPreferences || input.program_preferences, 260) || null,
    notes: cleanLongText(input.notes, 1200) || null,
    leadType: normalizeLeadType(input.leadType || input.lead_type),
    qualityCategory: compactString(input.qualityCategory || input.quality_category || EVENT_TYPE_TO_QUALITY[eventType], 40) || null,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0.35)),
  };
}

function valueForField(key, lead) {
  switch (key) {
    case 'client_name': return lead.clientName;
    case 'contact': return lead.phone || (lead.instagram ? `@${lead.instagram}` : null);
    case 'event_type': return lead.eventType;
    case 'event_date': return lead.eventDate || lead.eventDateText;
    case 'children_count': return lead.childrenCount;
    case 'child_age': return lead.childAge;
    case 'program_preferences': return lead.programPreferences;
    case 'budget': return lead.budget;
    default: return null;
  }
}

function inferScenario(config, lead, bundle = {}) {
  const text = [
    lead.eventType,
    lead.programPreferences,
    lead.notes,
    bundle?.conversation?.customer_name,
    ...(bundle?.messages || []).map(message => message.content),
  ].filter(Boolean).join('\n').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const scenario of config.scenarios || []) {
    if (scenario.enabled === false) continue;
    let score = 0;
    if (lead.eventType && scenario.id === lead.eventType) score += 8;
    for (const keyword of scenario.keywords || []) {
      if (keyword && text.includes(String(keyword).toLowerCase())) score += 3;
    }
    if (score > bestScore) {
      best = scenario;
      bestScore = score;
    }
  }
  const fallback = (config.scenarios || []).find(item => item.id === 'info')
    || (config.scenarios || []).find(item => item.enabled !== false)
    || DEFAULT_SCENARIOS[0];
  const scenario = best || fallback;
  return {
    id: scenario.id,
    label: scenario.label,
    confidence: best ? Math.min(0.95, 0.45 + bestScore * 0.08) : 0.25,
    nextStepGoal: scenario.nextStepGoal || 'qualify_lead',
    catalogTags: scenario.catalogTags || [],
  };
}

function normalizeScenarioResult(raw, config, lead, bundle) {
  const inferred = inferScenario(config, lead, bundle);
  if (!raw || typeof raw !== 'object') return inferred;
  const id = normalizeFieldKey(raw.id || raw.key || inferred.id);
  const configured = (config.scenarios || []).find(item => item.id === id);
  return {
    id: configured?.id || id || inferred.id,
    label: compactString(raw.label || configured?.label || inferred.label, 100),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || inferred.confidence)),
    nextStepGoal: normalizeFieldKey(raw.nextStepGoal || raw.next_step_goal || configured?.nextStepGoal || inferred.nextStepGoal),
    catalogTags: normalizeStringList(raw.catalogTags || raw.catalog_tags || configured?.catalogTags || inferred.catalogTags, 12)
      .map(tag => normalizeFieldKey(tag))
      .filter(Boolean),
  };
}

function materialAttachText(material) {
  const price = material.price ? ` (${material.price} грн${material.unit ? `/${material.unit}` : ''})` : '';
  const url = material.url ? `\n${material.url}` : '';
  const desc = material.description ? ` — ${material.description}` : '';
  return `${material.title}${price}${desc}${url}`.trim();
}

function normalizeMaterial(item, source = 'manual') {
  if (!item || typeof item !== 'object') return null;
  const id = compactString(item.id || item.sourceId || item.source_id || item.title, 120);
  const title = compactString(item.title || item.label || item.name, 160);
  if (!id || !title) return null;
  const material = {
    id,
    source: compactString(item.source || source, 40),
    sourceId: compactString(item.sourceId || item.source_id || item.productId || item.product_id || '', 120) || null,
    type: compactString(item.type || item.kind || item.domain || 'link', 40),
    title,
    url: compactString(item.url || item.href || item.sourceDocumentUrl || item.source_document_url || '', 1000) || null,
    internalUrl: compactString(item.internalUrl || item.internal_url || '', 1000) || null,
    description: compactString(item.description || item.shortDescription || item.short_description || item.promoDescription || item.promo_description || '', 500) || null,
    price: parseMoney(item.price),
    unit: compactString(item.unit || item.servingUnit || item.serving_unit || '', 80) || null,
    tags: normalizeStringList(item.tags, 12).map(tag => normalizeFieldKey(tag)).filter(Boolean),
    scenarioIds: normalizeStringList(item.scenarioIds || item.scenario_ids || item.scenarios, 12)
      .map(scenario => normalizeFieldKey(scenario))
      .filter(Boolean),
    reason: compactString(item.reason || '', 220) || null,
  };
  material.attachText = compactString(item.attachText || item.attach_text || materialAttachText(material), 1000);
  return material;
}

function materialMatches(material, lead, scenario) {
  const text = [
    lead.eventType,
    lead.programPreferences,
    lead.notes,
    scenario?.id,
    scenario?.label,
  ].filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  if (material.scenarioIds?.includes(scenario?.id)) score += 10;
  for (const tag of material.tags || []) {
    if ((scenario?.catalogTags || []).includes(tag)) score += 2;
    if (tag && text.includes(tag)) score += 4;
  }
  if (material.type === 'program' && ['birthday', 'trip', 'corporate', 'graduation'].includes(scenario?.id)) score += 3;
  if (material.type === 'cake' && scenario?.id === 'birthday') score += 5;
  if (material.type === 'menu' && ['birthday', 'graduation', 'corporate', 'trip'].includes(scenario?.id)) score += 3;
  if (material.title && text.includes(material.title.toLowerCase())) score += 8;
  return score;
}

function normalizeRecommendedMaterials(rawMaterials, config, salesContext, lead, scenario) {
  const byId = new Map();
  const add = (material, score = 0) => {
    const normalized = normalizeMaterial(material, material?.source || 'manual');
    if (!normalized) return;
    const key = `${normalized.source}:${normalized.id}`;
    const current = byId.get(key);
    const next = { ...normalized, matchScore: score || materialMatches(normalized, lead, scenario) };
    if (!current || next.matchScore > current.matchScore) byId.set(key, next);
  };

  for (const item of Array.isArray(rawMaterials) ? rawMaterials : []) add(item, 20);
  for (const item of config.manualMaterials || []) {
    if (item.enabled === false) continue;
    add({ ...item, source: 'manual', internalUrl: item.url, url: item.url }, 0);
  }
  for (const item of salesContext?.materials || []) add(item, 0);

  return [...byId.values()]
    .filter(item => item.matchScore > 0 || item.source === 'manual')
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0) || a.title.localeCompare(b.title))
    .slice(0, 8)
    .map(item => ({
      id: item.id,
      source: item.source,
      sourceId: item.sourceId,
      type: item.type,
      title: item.title,
      url: item.url || item.internalUrl || null,
      internalUrl: item.internalUrl || null,
      description: item.description,
      price: item.price,
      unit: item.unit,
      tags: item.tags,
      scenarioIds: item.scenarioIds,
      reason: item.reason || (item.matchScore >= 10 ? 'Підходить під сценарій і потреби з діалогу.' : null),
      attachText: item.attachText,
    }));
}

function calculateLeadScore(lead, needs, scenario, riskFlags = []) {
  let score = 15;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    if (reason) reasons.push(reason);
  };
  if (lead.clientName) add(10, 'Є імʼя клієнта');
  if (lead.phone || lead.instagram) add(15, 'Є контакт');
  if (lead.eventType) add(10, 'Зрозумілий тип події');
  if (lead.eventDate || lead.eventDateText) add(15, 'Є дата або період');
  if (lead.childrenCount) add(10, 'Є кількість дітей');
  if (lead.childAge) add(8, 'Є вік дітей');
  if (lead.programPreferences) add(8, 'Є побажання до програми');
  if (lead.budget) add(5, 'Є бюджет');
  if (scenario?.id && scenario.id !== 'info') add(4, `Сценарій: ${scenario.label}`);
  const missingRequired = needs.filter(item => item.required && item.status !== 'found').length;
  score -= missingRequired * 8;
  score -= Math.min(riskFlags.length * 5, 20);
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const temperature = bounded >= 78 ? 'hot' : (bounded >= 48 ? 'warm' : 'cold');
  const label = temperature === 'hot' ? 'Гарячий' : (temperature === 'warm' ? 'Теплий' : 'Холодний');
  const blockers = needs
    .filter(item => item.required && item.status !== 'found')
    .map(item => item.label)
    .slice(0, 5);
  return { score: bounded, temperature, label, reasons: reasons.slice(0, 8), blockers };
}

function normalizeLeadScore(raw, lead, needs, scenario, riskFlags) {
  const calculated = calculateLeadScore(lead, needs, scenario, riskFlags);
  if (!raw || typeof raw !== 'object') return calculated;
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || calculated.score)));
  const temperature = ['hot', 'warm', 'cold'].includes(raw.temperature) ? raw.temperature : calculated.temperature;
  return {
    score,
    temperature,
    label: compactString(raw.label || calculated.label, 80),
    reasons: normalizeStringList(raw.reasons || calculated.reasons, 8),
    blockers: normalizeStringList(raw.blockers || calculated.blockers, 8),
  };
}

function normalizeRecommendedActions(rawActions, config, missing, lead, scenario, score) {
  const byId = new Map((config.nextStepGoals || []).map(goal => [goal.id, goal]));
  const actions = [];
  const pushAction = (id, priority, reason) => {
    const goal = byId.get(id);
    if (!goal || goal.enabled === false || actions.some(item => item.id === id)) return;
    actions.push({ id, label: goal.label, priority, reason: compactString(reason || goal.description, 240) });
  };

  for (const item of Array.isArray(rawActions) ? rawActions : []) {
    const id = normalizeFieldKey(item?.id || item?.key);
    const goal = byId.get(id);
    if (!goal || goal.enabled === false) continue;
    actions.push({
      id,
      label: compactString(item?.label || goal.label, 100),
      priority: compactString(item?.priority || 'normal', 40),
      reason: compactString(item?.reason || goal.description, 240),
    });
  }

  if (missing.includes('contact')) pushAction('collect_contact', 'high', 'Без контакту лід важко довести до бронювання.');
  if (missing.includes('event_date')) pushAction('collect_date', 'high', 'Дата потрібна для перевірки доступності.');
  if (!lead.programPreferences && scenario?.nextStepGoal !== 'qualify_lead') pushAction('qualify_lead', 'normal', 'Потрібно зрозуміти бажаний формат.');
  if (score.temperature === 'hot' && missing.length <= 1) pushAction('create_booking', 'high', 'Лід достатньо прогрітий для бронювання.');
  pushAction(scenario?.nextStepGoal || 'qualify_lead', 'normal', null);

  return actions.slice(0, 6);
}

function normalizeNeeds(aiNeeds, config, lead) {
  const byKey = new Map();
  for (const item of Array.isArray(aiNeeds) ? aiNeeds : []) {
    const key = normalizeFieldKey(item?.key);
    if (!key) continue;
    byKey.set(key, item);
  }

  return config.requiredFields.map(field => {
    const fromAi = byKey.get(field.key) || {};
    const value = compactString(fromAi.value || valueForField(field.key, lead) || '', 240);
    const status = value ? 'found' : (field.required ? 'missing' : 'optional');
    return {
      key: field.key,
      label: field.label,
      required: field.required,
      status,
      value: value || null,
      question: compactString(fromAi.question || field.question, 240),
    };
  });
}

function firstMissingRequired(needs) {
  return needs.find(item => item.required && item.status !== 'found') || null;
}

function defaultSuggestedReply(need) {
  if (!need) {
    return 'Дякую, маю основну інформацію. Можу підібрати найкращий варіант і запропонувати доступний час.';
  }
  return need.question || `Підкажіть, будь ласка: ${need.label.toLowerCase()}.`;
}

function normalizeAnalysis(raw, bundle, config, provider = {}, salesContext = null) {
  const fallbackLead = extractFallbackLead(bundle);
  const lead = normalizeLeadDraft({ ...fallbackLead, ...(raw?.lead || {}) });
  if (!lead.clientName && fallbackLead.clientName) lead.clientName = fallbackLead.clientName;
  if (!lead.phone && fallbackLead.phone) lead.phone = fallbackLead.phone;
  const needs = normalizeNeeds(raw?.needs, config, lead);
  const missing = needs.filter(item => item.required && item.status !== 'found').map(item => item.key);
  const nextNeed = firstMissingRequired(needs);
  const suggestedReply = cleanLongText(raw?.suggestedReply || raw?.suggested_reply || defaultSuggestedReply(nextNeed), 900);
  const summary = compactString(raw?.summary || summarizeLead(lead, needs), 600);
  const scenario = normalizeScenarioResult(raw?.scenario, config, lead, bundle);
  const riskFlags = Array.isArray(raw?.riskFlags || raw?.risk_flags)
    ? (raw.riskFlags || raw.risk_flags).map(item => compactString(item, 140)).filter(Boolean).slice(0, 6)
    : [];
  const leadScore = normalizeLeadScore(raw?.leadScore || raw?.lead_score, lead, needs, scenario, riskFlags);
  const recommendedMaterials = normalizeRecommendedMaterials(
    raw?.recommendedMaterials || raw?.recommended_materials,
    config,
    salesContext,
    lead,
    scenario
  );
  const recommendedActions = normalizeRecommendedActions(
    raw?.recommendedActions || raw?.recommended_actions,
    config,
    missing,
    lead,
    scenario,
    leadScore
  );

  return {
    ok: true,
    provider: {
      name: provider.name || 'local',
      model: provider.model || 'heuristic',
      status: provider.status || 'fallback',
      reason: provider.reason || null,
    },
    summary,
    scenario,
    leadScore,
    lead,
    needs,
    missingRequiredKeys: missing,
    nextBestQuestion: compactString(raw?.nextBestQuestion || raw?.next_best_question || defaultSuggestedReply(nextNeed), 260),
    suggestedReply,
    createLeadReady: missing.length <= 2 && Boolean(lead.clientName || lead.phone),
    riskFlags,
    sourceFacts: Array.isArray(raw?.sourceFacts || raw?.source_facts)
      ? (raw.sourceFacts || raw.source_facts).map(item => compactString(item, 180)).filter(Boolean).slice(0, 8)
      : [],
    recommendedMaterials,
    recommendedActions,
    salesContext: salesContext ? {
      sourceCount: salesContext.sourceCount || 0,
      materialCount: salesContext.materials?.length || 0,
      stale: salesContext.stale === true,
      errors: salesContext.errors || [],
    } : null,
    settings: config,
  };
}

function summarizeLead(lead, needs) {
  const parts = [
    lead.clientName,
    lead.eventType,
    lead.eventDate || lead.eventDateText,
    lead.childrenCount ? `${lead.childrenCount} дітей` : null,
    lead.childAge ? `${lead.childAge} років` : null,
  ].filter(Boolean);
  const missing = needs.filter(item => item.required && item.status !== 'found').length;
  return `${parts.length ? parts.join(' · ') : 'Даних для ліда поки мало'}${missing ? `. Треба уточнити: ${missing}.` : '. Ключові потреби зібрані.'}`;
}

function buildAnalysisSchema() {
  const nullableString = { type: ['string', 'null'] };
  const nullableNumber = { type: ['number', 'null'] };
  const nullableInteger = { type: ['integer', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      scenario: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          confidence: nullableNumber,
          nextStepGoal: { type: 'string' },
          catalogTags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'label', 'confidence', 'nextStepGoal', 'catalogTags'],
      },
      lead: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clientName: nullableString,
          phone: nullableString,
          instagram: nullableString,
          eventType: nullableString,
          eventDate: nullableString,
          eventDateText: nullableString,
          childrenCount: nullableInteger,
          childAge: nullableInteger,
          celebrants: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: nullableString,
                age: nullableInteger,
                birthday: nullableString,
                notes: nullableString,
              },
              required: ['name', 'age', 'birthday', 'notes'],
            },
          },
          budget: nullableInteger,
          programPreferences: nullableString,
          notes: nullableString,
          leadType: { type: 'string' },
          qualityCategory: nullableString,
          confidence: nullableNumber,
        },
        required: [
          'clientName', 'phone', 'instagram', 'eventType', 'eventDate', 'eventDateText',
          'childrenCount', 'childAge', 'celebrants', 'budget', 'programPreferences',
          'notes', 'leadType', 'qualityCategory', 'confidence',
        ],
      },
      needs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            required: { type: 'boolean' },
            status: { type: 'string' },
            value: nullableString,
            question: { type: 'string' },
          },
          required: ['key', 'label', 'required', 'status', 'value', 'question'],
        },
      },
      missingRequiredKeys: { type: 'array', items: { type: 'string' } },
      nextBestQuestion: { type: 'string' },
      suggestedReply: { type: 'string' },
      createLeadReady: { type: 'boolean' },
      leadScore: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'integer' },
          temperature: { type: 'string' },
          label: { type: 'string' },
          reasons: { type: 'array', items: { type: 'string' } },
          blockers: { type: 'array', items: { type: 'string' } },
        },
        required: ['score', 'temperature', 'label', 'reasons', 'blockers'],
      },
      recommendedMaterials: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            source: { type: 'string' },
            sourceId: nullableString,
            type: { type: 'string' },
            title: { type: 'string' },
            url: nullableString,
            internalUrl: nullableString,
            description: nullableString,
            price: nullableInteger,
            unit: nullableString,
            tags: { type: 'array', items: { type: 'string' } },
            scenarioIds: { type: 'array', items: { type: 'string' } },
            reason: nullableString,
            attachText: { type: 'string' },
          },
          required: [
            'id', 'source', 'sourceId', 'type', 'title', 'url', 'internalUrl',
            'description', 'price', 'unit', 'tags', 'scenarioIds', 'reason', 'attachText',
          ],
        },
      },
      recommendedActions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            priority: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['id', 'label', 'priority', 'reason'],
        },
      },
      riskFlags: { type: 'array', items: { type: 'string' } },
      sourceFacts: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'summary', 'scenario', 'lead', 'needs', 'missingRequiredKeys', 'nextBestQuestion',
      'suggestedReply', 'createLeadReady', 'leadScore', 'recommendedMaterials',
      'recommendedActions', 'riskFlags', 'sourceFacts',
    ],
  };
}

function productMaterialFromRow(row, sourceConfig) {
  const type = row.domain === 'kitchen' ? (row.kitchen_type || row.category || 'kitchen') : 'program';
  const url = row.source_document_url || null;
  const internalUrl = type === 'program'
    ? `/programs?product=${encodeURIComponent(row.id)}`
    : `/programs?domain=kitchen&kitchenType=${encodeURIComponent(row.kitchen_type || row.category || '')}`;
  return normalizeMaterial({
    id: `product_${row.id}`,
    source: 'product',
    sourceId: row.id,
    type,
    title: row.label || row.name || row.code || row.id,
    url,
    internalUrl,
    description: row.short_description || row.promo_description || row.description,
    price: row.price,
    unit: row.serving_unit || (row.is_per_child ? 'дитина' : null),
    tags: [
      ...(sourceConfig.tags || []),
      row.category,
      row.domain,
      row.kitchen_type,
      row.age_range,
    ].filter(Boolean),
    attachText: [
      row.label || row.name,
      row.price ? `${row.price} грн${row.serving_unit ? `/${row.serving_unit}` : ''}` : null,
      row.short_description || row.description,
      url,
    ].filter(Boolean).join('\n'),
  }, 'product');
}

function catalogMaterialFromRow(row, sourceConfig) {
  return normalizeMaterial({
    id: `catalog_${row.catalog_id}_${row.id}`,
    source: 'catalog_item',
    sourceId: String(row.id),
    type: row.catalog_id || 'catalog',
    title: row.name,
    url: row.image_url || null,
    internalUrl: `/designs#catalog-${encodeURIComponent(row.catalog_id || '')}`,
    description: row.description,
    price: row.price,
    tags: [
      ...(sourceConfig.tags || []),
      row.catalog_id,
      row.subcategory,
      row.catalog_name,
    ].filter(Boolean),
    attachText: [
      row.name,
      row.price ? `${row.price} грн` : null,
      row.description,
      row.image_url,
    ].filter(Boolean).join('\n'),
  }, 'catalog_item');
}

async function loadProductMaterials(sourceConfig, businessContext = DEFAULT_BUSINESS_CONTEXT) {
  const where = [
    `COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1`,
    'COALESCE(is_active, true) = true',
  ];
  const params = [businessContext];
  if (sourceConfig.domain) {
    params.push(sourceConfig.domain);
    where.push(`COALESCE(domain, 'program') = $${params.length}`);
  }
  if (sourceConfig.kitchenType) {
    params.push(sourceConfig.kitchenType);
    where.push(`kitchen_type = $${params.length}`);
  }
  const limit = sourceConfig.maxItems || 12;
  const result = await pool.query(
    `SELECT id, code, label, name, category, domain, kitchen_type, short_description,
            promo_description, description, price, serving_unit, is_per_child,
            age_range, kids_capacity, source_document_url, source_document_title,
            availability_status, sort_order
       FROM products
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(sort_order, 999), name
      LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  return result.rows.map(row => productMaterialFromRow(row, sourceConfig)).filter(Boolean);
}

async function loadCatalogItemMaterials(sourceConfig) {
  const result = await pool.query(
    `SELECT ci.id, ci.catalog_id, ci.subcategory, ci.name, ci.description, ci.price,
            ci.image_url, cd.name AS catalog_name, cd.emoji AS catalog_emoji
       FROM catalog_items ci
       JOIN catalog_definitions cd ON cd.id = ci.catalog_id
      WHERE COALESCE(ci.status, 'active') = 'active'
        AND COALESCE(cd.is_active, true) = true
      ORDER BY cd.sort_order, ci.subcategory NULLS LAST, ci.created_at DESC
      LIMIT $1`,
    [sourceConfig.maxItems || 18]
  );
  return result.rows.map(row => catalogMaterialFromRow(row, sourceConfig)).filter(Boolean);
}

async function getLeadAssistantSalesContext(config, bundle = {}, options = {}) {
  const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
  const materials = [];
  const errors = [];
  let sourceCount = 0;
  for (const sourceConfig of config.catalogSources || []) {
    if (sourceConfig.enabled === false) continue;
    sourceCount += 1;
    try {
      const loaded = sourceConfig.source === 'catalog_items'
        ? await loadCatalogItemMaterials(sourceConfig)
        : await loadProductMaterials(sourceConfig, businessContext);
      materials.push(...loaded);
    } catch (err) {
      errors.push(`${sourceConfig.id}: ${err.message}`);
      log.warn('Omni lead assistant catalog source skipped', { source: sourceConfig.id, message: err.message });
    }
  }

  return {
    businessContext,
    sourceCount,
    materials: materials.slice(0, 80),
    errors: errors.slice(0, 8),
    conversationId: bundle?.conversation?.id || null,
  };
}

function compactMaterialsForPrompt(materials = []) {
  return materials.slice(0, 36).map(item => ({
    id: item.id,
    source: item.source,
    sourceId: item.sourceId,
    type: item.type,
    title: item.title,
    price: item.price,
    unit: item.unit,
    tags: item.tags,
    scenarioIds: item.scenarioIds,
    url: item.url || item.internalUrl || null,
    description: compactString(item.description, 220),
  }));
}

function buildOpenAIInput(bundle, config, salesContext) {
  return {
    conversation: {
      id: bundle.conversation.id,
      channel: bundle.conversation.channel,
      customerName: bundle.conversation.customer_name,
      customerPhone: bundle.conversation.customer_phone,
      externalId: bundle.conversation.external_id,
      status: bundle.conversation.status,
    },
    requiredFields: config.requiredFields,
    scenarios: config.scenarios,
    guardrails: config.guardrails.filter(item => item.enabled !== false),
    nextStepGoals: config.nextStepGoals.filter(item => item.enabled !== false),
    replyTemplates: config.replyTemplates.filter(item => item.enabled !== false),
    manualMaterials: config.manualMaterials.filter(item => item.enabled !== false),
    scriptRules: config.scriptRules,
    tone: config.tone,
    availableSalesMaterials: compactMaterialsForPrompt(salesContext?.materials || []),
    transcript: buildTranscript(bundle.messages),
  };
}

async function callOpenAIForAnalysis(bundle, config, salesContext = null) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return normalizeAnalysis(null, bundle, config, {
      name: 'openai',
      model: config.model,
      status: 'missing_key',
      reason: 'OPENAI_API_KEY is not configured',
    }, salesContext);
  }
  if (config.enabled === false) {
    return normalizeAnalysis(null, bundle, config, {
      name: 'openai',
      model: config.model,
      status: 'disabled',
      reason: 'Omni lead assistant is disabled',
    }, salesContext);
  }

  const instructions = [
    'Ти — sales intake assistant для Event Genix CRM.',
    'Завдання: з історії Omni-діалогу витягнути дані ліда, визначити незакриті потреби і дати одну готову відповідь менеджеру.',
    'Не вигадуй факти. Якщо поле не прозвучало явно, став null і missing.',
    'Визнач сценарій продажу, lead score, наступні дії і релевантні матеріали з availableSalesMaterials.',
    'Рекомендовані матеріали бери тільки з availableSalesMaterials або manualMaterials у конфігу; ціни й посилання не вигадуй.',
    'Якщо матеріал не підходить або даних мало, краще постав уточнююче питання, ніж відправляти випадковий каталог.',
    'Запитуй тільки одне найважливіше питання за раз.',
    'Мова suggestedReply: українська, якщо клієнт не пише іншою мовою.',
    'Не обіцяй фінальну ціну без дати, кількості дітей, віку і формату.',
    'Не підтверджуй доступність дати/залу і не обіцяй знижки без явного факту в даних CRM.',
  ].join('\n');

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify(buildOpenAIInput(bundle, config, salesContext)) },
      ],
      store: false,
      temperature: 0.15,
      max_output_tokens: 2200,
      text: {
        format: {
          type: 'json_schema',
          name: 'omni_lead_intake',
          strict: true,
          schema: buildAnalysisSchema(),
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    log.warn('OpenAI lead analysis failed', {
      status: response.status,
      message: payload?.error?.message || payload?.error || 'unknown',
    });
    return normalizeAnalysis(null, bundle, config, {
      name: 'openai',
      model: config.model,
      status: 'provider_error',
      reason: compactString(payload?.error?.message || payload?.error || `openai_http_${response.status}`, 240),
    }, salesContext);
  }

  const parsed = parseJsonObject(extractResponseText(payload));
  if (!parsed) {
    return normalizeAnalysis(null, bundle, config, {
      name: 'openai',
      model: config.model,
      status: 'unparseable',
      reason: 'OpenAI response was not valid JSON',
    }, salesContext);
  }

  return normalizeAnalysis(parsed, bundle, config, {
    name: 'openai',
    model: config.model,
    status: 'ok',
    reason: null,
  }, salesContext);
}

async function getConversationBundle(conversationId, limit = 100) {
  const id = Number.parseInt(conversationId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Невалідний ID розмови');
    err.status = 400;
    throw err;
  }

  const conversationResult = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [id]);
  const conversation = conversationResult.rows[0];
  if (!conversation) {
    const err = new Error('Розмову не знайдено');
    err.status = 404;
    throw err;
  }

  const messagesResult = await pool.query(
    `SELECT *
       FROM conversation_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [id, Math.max(1, Math.min(Number(limit) || 100, 200))]
  );

  return {
    conversation,
    messages: messagesResult.rows,
  };
}

async function analyzeConversationLead(conversationId) {
  const [config, bundle] = await Promise.all([
    getLeadAssistantSettings(),
    getConversationBundle(conversationId, 120),
  ]);
  const salesContext = await getLeadAssistantSalesContext(config, bundle);
  const analysis = await callOpenAIForAnalysis(bundle, config, salesContext);
  await recordConversationLeadAssistantAnalysis(bundle.conversation.id, analysis).catch(err => {
    log.warn('Conversation lead assistant analysis meta skipped', {
      conversationId: bundle.conversation.id,
      message: err.message,
    });
  });
  return analysis;
}

function transcriptToMessages(transcript) {
  return cleanLongText(transcript, 6000)
    .split(/\n+/)
    .map((line, idx) => {
      const text = compactString(line.replace(/^\[[^\]]+\]\s*/, '').replace(/^(клієнт|client|manager|менеджер|crm|ai)\s*:\s*/i, ''), 900);
      if (!text) return null;
      const outbound = /^(manager|менеджер|crm|ai)\s*:/i.test(line);
      return {
        id: idx + 1,
        direction: outbound ? 'outbound' : 'inbound',
        content: text,
        created_at: new Date(Date.now() + idx * 1000).toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

async function testLeadAssistantScript(input = {}) {
  const savedConfig = await getLeadAssistantSettings();
  const config = normalizeLeadAssistantConfig({ ...savedConfig, ...(input.settings || {}) });
  const bundle = {
    conversation: {
      id: 0,
      channel: compactString(input.channel || 'test', 40),
      customer_name: compactString(input.customerName || input.customer_name || 'Тестовий клієнт', 120),
      customer_phone: compactString(input.customerPhone || input.customer_phone || '', 60),
      external_id: 'omni_lead_assistant_test',
      status: 'test',
    },
    messages: Array.isArray(input.messages) && input.messages.length
      ? input.messages
      : transcriptToMessages(input.transcript || ''),
  };
  const salesContext = await getLeadAssistantSalesContext(config, bundle);
  return callOpenAIForAnalysis(bundle, config, salesContext);
}

function linkedLeadIdFromMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  return parsePositiveInt(meta.lead_id || meta.leadId || meta?.crm?.leadId || meta?.leadAssistant?.leadId);
}

async function findExistingLinkedLead(conversation) {
  const metaLeadId = linkedLeadIdFromMeta(conversation?.meta);
  if (metaLeadId) {
    const byMeta = await pool.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [metaLeadId]);
    if (byMeta.rows[0]) return byMeta.rows[0];
  }

  const externalId = `omni_conv_${conversation.id}`;
  const businessContext = DEFAULT_BUSINESS_CONTEXT;
  const byExternal = await pool.query(
    `SELECT *
       FROM leads
      WHERE COALESCE(business_context, $1) = $1
        AND source_channel = $2
        AND external_id = $3
      LIMIT 1`,
    [businessContext, conversation.channel, externalId]
  );
  return byExternal.rows[0] || null;
}

async function recordConversationLeadAssistantAnalysis(conversationId, analysis, db = pool) {
  if (!conversationId || !analysis) return;
  await db.query(
    `UPDATE conversations
        SET meta = jsonb_set(
              COALESCE(meta, '{}'::jsonb),
              '{leadAssistant}',
              COALESCE(meta->'leadAssistant', '{}'::jsonb) || $2::jsonb,
              true
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [
      conversationId,
      JSON.stringify({
        lastAnalysisAt: new Date().toISOString(),
        summary: analysis.summary || null,
        scenario: analysis.scenario || null,
        leadScore: analysis.leadScore || null,
        missingRequiredKeys: analysis.missingRequiredKeys || [],
        providerStatus: analysis.provider?.status || null,
        recommendedMaterialIds: (analysis.recommendedMaterials || []).map(item => item.id).slice(0, 8),
        recommendedActionIds: (analysis.recommendedActions || []).map(item => item.id).slice(0, 8),
      }),
    ]
  );
}

async function markConversationLead(conversationId, leadId, analysis, db = pool) {
  if (!conversationId || !leadId) return;
  await db.query(
    `UPDATE conversations
        SET meta = jsonb_set(
              COALESCE(meta, '{}'::jsonb),
              '{leadAssistant}',
              COALESCE(meta->'leadAssistant', '{}'::jsonb) || $2::jsonb,
              true
            ) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      conversationId,
      JSON.stringify({
        leadId,
        linkedAt: new Date().toISOString(),
        summary: analysis?.summary || null,
        missingRequiredKeys: analysis?.missingRequiredKeys || [],
      }),
      JSON.stringify({
        lead_id: leadId,
      }),
    ]
  );
}

function buildLeadNotes(analysis, bundle) {
  const lead = analysis?.lead || {};
  const needs = analysis?.needs || [];
  const materials = (analysis?.recommendedMaterials || [])
    .slice(0, 5)
    .map(item => item.title)
    .join(', ');
  const missing = needs
    .filter(item => item.required && item.status !== 'found')
    .map(item => item.label)
    .join(', ');
  const facts = (analysis?.sourceFacts || []).join('; ');
  return [
    `Створено з OmniClaw розмови #${bundle.conversation.id}.`,
    analysis?.summary ? `AI summary: ${analysis.summary}` : null,
    lead.programPreferences ? `Побажання: ${lead.programPreferences}` : null,
    lead.budget ? `Бюджет: ${lead.budget} грн` : null,
    analysis?.scenario?.label ? `Сценарій: ${analysis.scenario.label}` : null,
    analysis?.leadScore ? `AI score: ${analysis.leadScore.score}/100 (${analysis.leadScore.label})` : null,
    materials ? `Рекомендовані матеріали: ${materials}` : null,
    missing ? `Ще уточнити: ${missing}` : null,
    facts ? `Факти з діалогу: ${facts}` : null,
  ].filter(Boolean).join('\n');
}

function primaryProgramIdFromMaterials(materials = []) {
  const match = materials.find(item => item.source === 'product' && item.type === 'program' && item.sourceId);
  return match?.sourceId || null;
}

function buildLeadInsertDraft(analysis, bundle, options = {}) {
  const lead = normalizeLeadDraft(analysis?.lead || {});
  const conversation = bundle.conversation || {};
  const businessContext = normalizeBusinessContext(options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT);
  const fallbackName = compactString(conversation.customer_name, 160);
  const clientName = lead.clientName || (fallbackName && !/^unknown$/i.test(fallbackName) ? fallbackName : null) || `Клієнт ${conversation.channel || 'Omni'}`;
  const phone = lead.phone || normalizePhone(conversation.customer_phone) || null;
  const externalId = `omni_conv_${conversation.id}`;
  const notes = buildLeadNotes({ ...analysis, lead }, bundle);

  return {
    businessContext,
    clientName,
    phone,
    instagram: lead.instagram,
    source: conversation.channel || 'omni',
    sourceChannel: conversation.channel || 'omni',
    externalId,
    eventDate: lead.eventDate,
    childrenCount: lead.childrenCount,
    childAge: lead.childAge,
    programId: primaryProgramIdFromMaterials(analysis?.recommendedMaterials || []),
    celebrants: lead.celebrants || [],
    notes,
    leadType: lead.leadType || 'quality',
    qualityCategory: lead.qualityCategory || EVENT_TYPE_TO_QUALITY[lead.eventType] || null,
    eventType: lead.eventType || null,
    budget: lead.budget || null,
    customerCardNotes: [
      lead.programPreferences ? `Побажання: ${lead.programPreferences}` : null,
      analysis?.nextBestQuestion ? `Наступне питання: ${analysis.nextBestQuestion}` : null,
    ].filter(Boolean).join('\n') || null,
  };
}

async function createLeadFromConversation(conversationId, analysis, options = {}) {
  const bundle = await getConversationBundle(conversationId, 120);
  const existing = await findExistingLinkedLead(bundle.conversation);
  if (existing) {
    await markConversationLead(bundle.conversation.id, existing.id, analysis).catch(err => {
      log.warn('Conversation lead relink skipped', { conversationId: bundle.conversation.id, leadId: existing.id, message: err.message });
    });
    return { created: false, lead: existing, analysis };
  }

  const draft = buildLeadInsertDraft(analysis, bundle, options);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO leads
         (business_context, client_name, phone, instagram, source, source_channel, external_id,
          program_id, event_date, children_count, child_age, notes, status, pipeline_stage, lead_type,
          quality_category, celebrants, raw_payload)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, 'new', 'new', $13,
          $14, $15::jsonb, $16::jsonb)
       RETURNING *`,
      [
        draft.businessContext,
        draft.clientName,
        draft.phone,
        draft.instagram,
        draft.source,
        draft.sourceChannel,
        draft.externalId,
        draft.programId,
        draft.eventDate,
        draft.childrenCount,
        draft.childAge,
        draft.notes,
        draft.leadType,
        draft.qualityCategory,
        JSON.stringify(draft.celebrants),
        JSON.stringify({
          source: 'omni_lead_assistant',
          conversationId: bundle.conversation.id,
          analysis: {
            summary: analysis?.summary || null,
            missingRequiredKeys: analysis?.missingRequiredKeys || [],
            provider: analysis?.provider || null,
            scenario: analysis?.scenario || null,
            leadScore: analysis?.leadScore || null,
            recommendedMaterials: analysis?.recommendedMaterials || [],
          },
        }),
      ]
    );
    const lead = result.rows[0];

    await client.query('SAVEPOINT omni_lead_customer_card');
    try {
      await client.query(
        `INSERT INTO customer_cards
           (business_context, lead_id, event_type, event_date, children_count, budget_approx, channel, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          draft.businessContext,
          lead.id,
          draft.eventType,
          draft.eventDate,
          draft.childrenCount,
          draft.budget,
          draft.sourceChannel,
          draft.customerCardNotes,
        ]
      );
      await client.query('RELEASE SAVEPOINT omni_lead_customer_card');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT omni_lead_customer_card');
      log.warn('Customer card create skipped for Omni lead', { leadId: lead.id, message: err.message });
    }

    await markConversationLead(bundle.conversation.id, lead.id, analysis, client);

    await client.query('COMMIT');
    return { created: true, lead, analysis };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getLeadAssistantAnalytics() {
  const analytics = {
    totalAnalyses: 0,
    totalCreatedLeads: 0,
    averageScore: null,
    scenarios: [],
    temperatures: [],
    topMaterials: [],
    followUpTasks: 0,
    errors: [],
  };

  const run = async (label, query, params = []) => {
    try {
      return await pool.query(query, params);
    } catch (err) {
      analytics.errors.push(`${label}: ${err.message}`);
      log.warn('Omni lead assistant analytics query skipped', { label, message: err.message });
      return { rows: [] };
    }
  };

  const overview = await run(
    'overview',
    `SELECT COUNT(*)::int AS total,
            ROUND(AVG(
              CASE
                WHEN (meta #>> '{leadAssistant,leadScore,score}') ~ '^[0-9]+(\\.[0-9]+)?$'
                  THEN (meta #>> '{leadAssistant,leadScore,score}')::numeric
                ELSE NULL
              END
            ))::int AS average_score
       FROM conversations
      WHERE meta #>> '{leadAssistant,lastAnalysisAt}' IS NOT NULL`
  );
  analytics.totalAnalyses = Number(overview.rows[0]?.total || 0);
  analytics.averageScore = overview.rows[0]?.average_score === null || overview.rows[0]?.average_score === undefined
    ? null
    : Number(overview.rows[0].average_score);

  const scenarios = await run(
    'scenarios',
    `SELECT COALESCE(NULLIF(meta #>> '{leadAssistant,scenario,id}', ''), 'unknown') AS id,
            COALESCE(NULLIF(meta #>> '{leadAssistant,scenario,label}', ''), 'Unknown') AS label,
            COUNT(*)::int AS count
       FROM conversations
      WHERE meta #>> '{leadAssistant,lastAnalysisAt}' IS NOT NULL
      GROUP BY id, label
      ORDER BY count DESC, label ASC
      LIMIT 8`
  );
  analytics.scenarios = scenarios.rows.map(row => ({
    id: row.id,
    label: row.label,
    count: Number(row.count || 0),
  }));

  const temperatures = await run(
    'temperatures',
    `SELECT COALESCE(NULLIF(meta #>> '{leadAssistant,leadScore,temperature}', ''), 'unknown') AS temperature,
            COUNT(*)::int AS count
       FROM conversations
      WHERE meta #>> '{leadAssistant,lastAnalysisAt}' IS NOT NULL
      GROUP BY temperature
      ORDER BY count DESC`
  );
  analytics.temperatures = temperatures.rows.map(row => ({
    temperature: row.temperature,
    count: Number(row.count || 0),
  }));

  const createdLeads = await run(
    'created_leads',
    `SELECT COUNT(*)::int AS total
       FROM leads
      WHERE raw_payload->>'source' = 'omni_lead_assistant'`
  );
  analytics.totalCreatedLeads = Number(createdLeads.rows[0]?.total || 0);

  const materials = await run(
    'top_materials',
    `SELECT COALESCE(NULLIF(material->>'title', ''), material->>'id', 'material') AS title,
            COUNT(*)::int AS count
       FROM leads l
       CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(l.raw_payload #> '{analysis,recommendedMaterials}', '[]'::jsonb)
       ) AS material
      WHERE l.raw_payload->>'source' = 'omni_lead_assistant'
      GROUP BY title
      ORDER BY count DESC, title ASC
      LIMIT 8`
  );
  analytics.topMaterials = materials.rows.map(row => ({
    title: row.title,
    count: Number(row.count || 0),
  }));

  const tasks = await run(
    'follow_up_tasks',
    `SELECT COUNT(*)::int AS total
       FROM tasks
      WHERE source_type = 'omni_lead_followup'`
  );
  analytics.followUpTasks = Number(tasks.rows[0]?.total || 0);

  analytics.errors = analytics.errors.slice(0, 5);
  return analytics;
}

function kyivDateInDays(days = 1) {
  const date = new Date(Date.now() + (Number(days) || 0) * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function userIdFrom(user) {
  const id = Number(user?.id || user?.userId || user?.user_id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function buildFollowUpTaskDraft(conversation = {}, analysis = {}, options = {}) {
  const lead = analysis?.lead || {};
  const linkedLeadId = parsePositiveInt(options.leadId || options.lead_id || linkedLeadIdFromMeta(conversation.meta));
  const clientName = compactString(
    lead.clientName || conversation.customer_name || conversation.customerName || conversation.external_id || 'Omni lead',
    120
  );
  const score = Number(analysis?.leadScore?.score || 0);
  const materials = (analysis?.recommendedMaterials || [])
    .slice(0, 5)
    .map(item => item.title)
    .filter(Boolean)
    .join(', ');
  const missing = (analysis?.needs || [])
    .filter(item => item.required && item.status !== 'found')
    .map(item => item.label)
    .slice(0, 6)
    .join(', ');
  const followUpDate = toIsoDate(options.date || options.followUpDate || options.follow_up_date) || kyivDateInDays(1);
  const ownerUserId = userIdFrom(options.user);
  const ownerName = compactString(
    options.assignedTo || options.assigned_to || options.user?.username || options.user?.name,
    80
  ) || null;

  return {
    title: `Follow-up Omni: ${clientName}`,
    description: [
      `Omni conversation #${conversation.id || 'n/a'} (${conversation.channel || 'omni'}).`,
      analysis?.scenario?.label ? `Сценарій: ${analysis.scenario.label}` : null,
      analysis?.leadScore ? `AI score: ${analysis.leadScore.score}/100 (${analysis.leadScore.label || analysis.leadScore.temperature || 'score'})` : null,
      analysis?.summary ? `Коротко: ${analysis.summary}` : null,
      analysis?.nextBestQuestion ? `Наступне питання: ${analysis.nextBestQuestion}` : null,
      missing ? `Ще уточнити: ${missing}` : null,
      materials ? `Матеріали: ${materials}` : null,
      conversation.id ? `/omni?conversation=${encodeURIComponent(conversation.id)}` : null,
    ].filter(Boolean).join('\n'),
    date: followUpDate,
    priority: options.priority || (score >= 78 ? 'high' : 'normal'),
    assigned_to: ownerName,
    owner: ownerName,
    owner_user_id: ownerUserId,
    created_by: compactString(options.user?.username || options.user?.name || 'omni_lead_assistant', 80),
    created_by_user_id: ownerUserId,
    task_type: 'human',
    category: 'admin',
    source_type: 'omni_lead_followup',
    source_id: `omni:${conversation.id || 'draft'}`,
    source_entity_type: linkedLeadId ? 'lead' : null,
    source_entity_id: linkedLeadId ? String(linkedLeadId) : null,
    related_entity_type: 'conversation',
    related_entity_id: conversation.id ? String(conversation.id) : null,
    source_module: 'omni',
    type: 'auto',
    control_meta: {
      origin: 'omni_lead_assistant',
      conversationId: conversation.id || null,
      leadId: linkedLeadId || null,
      scenario: analysis?.scenario?.id || null,
      leadScore: analysis?.leadScore?.score || null,
      recommendedActionIds: (analysis?.recommendedActions || []).map(item => item.id).slice(0, 8),
    },
  };
}

async function markConversationFollowUpTask(conversationId, task, db = pool) {
  if (!conversationId || !task?.id) return;
  await db.query(
    `UPDATE conversations
        SET meta = jsonb_set(
              COALESCE(meta, '{}'::jsonb),
              '{leadAssistant}',
              COALESCE(meta->'leadAssistant', '{}'::jsonb) || $2::jsonb,
              true
            ),
            updated_at = NOW()
      WHERE id = $1`,
    [
      conversationId,
      JSON.stringify({
        lastFollowUpTaskId: task.id,
        lastFollowUpTaskAt: new Date().toISOString(),
      }),
    ]
  );
}

async function createLeadAssistantFollowUpTask(conversationId, analysis, options = {}) {
  const bundle = await getConversationBundle(conversationId, 120);
  const effectiveAnalysis = analysis?.lead ? analysis : await analyzeConversationLead(conversationId);
  const draft = buildFollowUpTaskDraft(bundle.conversation, effectiveAnalysis, options);
  const kleshnya = require('./kleshnya');
  const task = await kleshnya.createTask({
    ...draft,
    duplicateMode: 'skip',
  });
  await markConversationFollowUpTask(bundle.conversation.id, task).catch(err => {
    log.warn('Conversation follow-up task meta skipped', {
      conversationId: bundle.conversation.id,
      taskId: task?.id,
      message: err.message,
    });
  });
  return {
    created: !task.duplicateSkipped,
    task,
    analysis: effectiveAnalysis,
    link: task?.id ? `/tasks?highlight=${encodeURIComponent(task.id)}` : null,
  };
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_REQUIRED_FIELDS,
  DEFAULT_SCRIPT_RULES,
  DEFAULT_SCENARIOS,
  DEFAULT_GUARDRAILS,
  DEFAULT_CATALOG_SOURCES,
  DEFAULT_MANUAL_MATERIALS,
  normalizeLeadAssistantConfig,
  buildLeadAssistantHistorySnapshot,
  getLeadAssistantSettings,
  saveLeadAssistantSettings,
  getLeadAssistantSalesContext,
  getLeadAssistantAnalytics,
  getConversationBundle,
  analyzeConversationLead,
  testLeadAssistantScript,
  createLeadFromConversation,
  createLeadAssistantFollowUpTask,
  buildTranscript,
  extractFallbackLead,
  normalizeLeadDraft,
  normalizeAnalysis,
  normalizeRecommendedMaterials,
  buildLeadInsertDraft,
  buildFollowUpTaskDraft,
  linkedLeadIdFromMeta,
};
