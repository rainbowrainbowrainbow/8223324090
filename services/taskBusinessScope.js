'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext,
    pushBusinessScopeCondition,
    requireBusinessScope,
    requireWritableBusinessScope,
    resolveBusinessScope
} = require('./businessContext');

function taskBusinessScopeFromRequest(req) {
    return resolveBusinessScope(req);
}

function ensureTaskBusinessScope(req, res) {
    const scope = taskBusinessScopeFromRequest(req);
    return requireBusinessScope(req, res, scope) ? scope : null;
}

function ensureWritableTaskBusinessScope(req, res) {
    const scope = taskBusinessScopeFromRequest(req);
    return requireWritableBusinessScope(req, res, scope) ? scope : null;
}

function taskBusinessScopeMeta(scope = {}) {
    return {
        mode: scope.mode || 'single',
        activeContext: normalizeBusinessContext(scope.activeContext || DEFAULT_BUSINESS_CONTEXT),
        selectedContexts: Array.isArray(scope.selectedContexts) && scope.selectedContexts.length
            ? scope.selectedContexts.map(normalizeBusinessContext)
            : [normalizeBusinessContext(scope.activeContext || DEFAULT_BUSINESS_CONTEXT)],
        readOnly: scope.readOnly === true,
        canWrite: scope.canWrite !== false && scope.readOnly !== true
    };
}

function activeTaskBusinessContext(scopeOrContext = DEFAULT_BUSINESS_CONTEXT) {
    if (scopeOrContext && typeof scopeOrContext === 'object' && !Array.isArray(scopeOrContext)) {
        return normalizeBusinessContext(scopeOrContext.activeContext || DEFAULT_BUSINESS_CONTEXT);
    }
    return normalizeBusinessContext(scopeOrContext || DEFAULT_BUSINESS_CONTEXT);
}

function taskBusinessContextFromPayload(payload = {}, fallback = DEFAULT_BUSINESS_CONTEXT) {
    return normalizeBusinessContext(
        payload.businessContext
        || payload.business_context
        || payload.tenantBusinessContext
        || payload.tenant_business_context
        || fallback
    );
}

function pushTaskBusinessScopeCondition(params, scopeOrContext, alias = 't') {
    return pushBusinessScopeCondition(params, scopeOrContext || DEFAULT_BUSINESS_CONTEXT, alias);
}

function appendTaskBusinessScopeSql(params, scopeOrContext, alias = 't') {
    return `AND ${pushTaskBusinessScopeCondition(params, scopeOrContext, alias)}`;
}

module.exports = {
    DEFAULT_TASK_BUSINESS_CONTEXT: DEFAULT_BUSINESS_CONTEXT,
    activeTaskBusinessContext,
    appendTaskBusinessScopeSql,
    ensureTaskBusinessScope,
    ensureWritableTaskBusinessScope,
    pushTaskBusinessScopeCondition,
    taskBusinessContextFromPayload,
    taskBusinessScopeFromRequest,
    taskBusinessScopeMeta
};
