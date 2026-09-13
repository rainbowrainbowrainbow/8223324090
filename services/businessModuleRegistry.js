'use strict';

// Capability of a business module is independent of the employee's role.
// Only the compatibility path may use the historical built-in defaults.
const CORE_MODULES = Object.freeze({
    dashboard: 'Огляд', timeline: 'Бронювання і таймлайн', tasks: 'Задачі',
    customers: 'Клієнти', leads: 'Продажі', finance: 'Фінанси',
    programs: 'Продукти', warehouse: 'Склад', settings: 'Налаштування'
});
const UNMIGRATED_MODULES = Object.freeze({
    chat: 'Чат', reports: 'Звіти', copilot: 'Copilot', staff: 'Працівники (legacy)',
    hr: 'HR', training: 'Навчання', checkin: 'Check-in', kitchen: 'Кухня',
    catalogs: 'Legacy-каталоги', content: 'Контент', art: 'Art', sound: 'Звук',
    afisha: 'Афіша', certificates: 'Сертифікати', kleshnya: 'Клешня',
    guardian: 'Guardian', center: 'Центр', game: 'Гра', demo: 'Демо',
    payroll: 'Зарплата', telegram: 'Telegram', payments: 'Платежі'
});

function businessModuleCatalog(contextKey) {
    const catalog = Object.entries(CORE_MODULES).map(([key, label]) => ({
        key, label, status: 'supported', canEnable: true, reason: null
    }));
    catalog.push({ key: 'omni', label: 'Omni', status: 'limited', canEnable: true,
        reason: 'Робота з чатами бізнесу. Підключення каналів і надсилання потребують окремого налаштування.' });
    const graduationSupported = ['event_genix', 'dar'].includes(contextKey);
    catalog.push({ key: 'graduation', label: 'Конструктор випускного',
        status: graduationSupported ? 'limited' : 'not_migrated', canEnable: graduationSupported,
        reason: graduationSupported
            ? 'Конструктор у бізнесі; конвертація в бронювання підтримується лише для Парку.'
            : 'Конструктор для нового бізнесу ще недоступний.' });
    return catalog.concat(Object.entries(UNMIGRATED_MODULES).map(([key, label]) => ({
        key, label, status: 'not_migrated', canEnable: false,
        reason: 'Ще недоступний для окремих бізнесів.'
    })));
}

function validateBusinessModules(value, { contextKey, existingModules = [] } = {}) {
    if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) {
        throw Object.assign(new Error('modules must be an array of module identifiers'),
            { status: 400, code: 'business_modules_invalid' });
    }
    const catalog = new Map(businessModuleCatalog(contextKey).map(module => [module.key, module]));
    const result = [...new Set(value)];
    for (const key of result) {
        if (!/^[a-z][a-z0-9_]*$/.test(key) || (!catalog.get(key)?.canEnable && !existingModules.includes(key))) {
            throw Object.assign(new Error(`Module ${key} is unavailable for this business`),
                { status: 400, code: 'business_module_not_supported' });
        }
    }
    return result;
}

function configuredBusinessModuleEnabled(business, moduleId) {
    const context = business?.context_key || business?.contextKey || business?.businessContext;
    const modules = business?.modules ?? business?.businessModules;
    return Array.isArray(modules) && modules.includes(moduleId)
        && businessModuleCatalog(context).some(module => module.key === moduleId && module.canEnable);
}

function userBusinessRegistryEntry(user, context) {
    const access = user?.businessMembershipAccess;
    return access?.memberships?.find(item => item.businessContext === context)
        || access?.registry?.find(item => item.businessContext === context) || null;
}

function userBusinessModuleState(user, context, moduleId) {
    const access = user?.businessMembershipAccess;
    const entry = userBusinessRegistryEntry(user, context);
    const registry = access?.registry?.find(item => item.businessContext === context);
    if (access?.invalid || registry?.active === false) {
        return { available: false, code: 'business_context_unavailable', message: 'Бізнес недоступний.' };
    }
    if (entry?.accessMode === 'membership' || registry?.accessMode === 'membership'
        || (access?.membershipEnabled && !entry)) {
        const membership = access?.memberships?.find(item => item.businessContext === context);
        if (!membership) return { available: false, code: 'business_context_unavailable', message: 'Немає активного членства.' };
        const descriptor = businessModuleCatalog(context).find(module => module.key === moduleId);
        if (!descriptor?.canEnable) return { available: false, code: 'business_module_not_migrated', message: descriptor?.reason || 'Модуль не підтримується.' };
        return configuredBusinessModuleEnabled(membership, moduleId)
            ? { available: true, code: null, message: null }
            : { available: false, code: 'business_module_disabled', message: 'Модуль вимкнений у цьому бізнесі.' };
    }
    const { BUSINESS_CONTEXTS } = require('./businessContext');
    return BUSINESS_CONTEXTS[context]?.modules?.includes(moduleId)
        ? { available: true, code: null, message: null }
        : { available: false, code: 'business_module_disabled', message: 'Модуль недоступний у цьому бізнесі.' };
}

// Managed operational routers only. Account recovery/lifecycle, provider ingress
// and unmigrated domains keep their separate authority/containment contracts.
const OPERATIONAL_API_MODULES = Object.freeze({
    bookings: 'timeline', lines: 'timeline', history: 'timeline',
    tasks: 'tasks', customers: 'customers', leads: 'leads', finance: 'finance',
    products: 'programs', warehouse: 'warehouse', dashboard: 'dashboard', omni: 'omni'
});

function requestBusinessModule(req) {
    let path = String(req.originalUrl || req.path || req.url || '').split('?')[0];
    try { path = decodeURIComponent(path); } catch { return null; }
    path = path.toLowerCase().replace(/^\/api(?:\/v1)?(?=\/)/, '');
    // Preserve the specific D02 response and its unavailable consumer handling.
    if (/^\/finance\/report\/salary\/?$/.test(path)) return null;
    return OPERATIONAL_API_MODULES[path.split('/')[1]] || null;
}

function requireRequestBusinessModule(req, res, scope) {
    const moduleId = requestBusinessModule(req);
    if (!moduleId) return true;
    const access = req.user?.businessMembershipAccess;
    const contexts = scope.selectedContexts?.length ? scope.selectedContexts : [scope.activeContext];
    for (const context of contexts) {
        const entry = userBusinessRegistryEntry(req.user, context);
        if (entry?.accessMode !== 'membership' && !access?.membershipEnabled) continue;
        const state = userBusinessModuleState(req.user, context, moduleId);
        if (!state.available) {
            res.status(403).json({ success: false, code: state.code, error: state.message,
                businessContext: context, module: moduleId });
            return false;
        }
    }
    return true;
}

module.exports = { businessModuleCatalog, validateBusinessModules, configuredBusinessModuleEnabled,
    userBusinessModuleState, userBusinessRegistryEntry, requestBusinessModule, requireRequestBusinessModule };
