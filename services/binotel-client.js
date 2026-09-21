'use strict';

class BinotelCapabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BinotelCapabilityError';
    this.code = code;
    this.statusCode = 503;
    this.details = details;
  }
}

function requiredBusinessContext(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new BinotelCapabilityError(
      'BINOTEL_BUSINESS_CONTEXT_REQUIRED',
      'Binotel requests require an explicit business context'
    );
  }
  return normalized;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createBinotelClient(options = {}) {
  const runtimeResolver = options.runtimeResolver || require('./omni-accounts').resolveOmniRuntimeConfig;

  async function runtimeFor(scope = {}) {
    const businessContext = requiredBusinessContext(scope.businessContext);
    const runtime = await runtimeResolver('binotel', { businessContext });
    if (!runtime || !nonEmpty(runtime.apiKey) || !nonEmpty(runtime.apiSecret)) {
      throw new BinotelCapabilityError(
        'BINOTEL_NOT_CONFIGURED',
        'Binotel read API credentials are not configured for this business',
        { businessContext, capability: 'not_configured' }
      );
    }
    return {
      businessContext,
      accountId: nonEmpty(runtime.accountId) ? runtime.accountId : null,
    };
  }

  async function requireDocumentedOperation(operation, scope = {}) {
    const runtime = await runtimeFor(scope);
    throw new BinotelCapabilityError(
      'BINOTEL_PROVIDER_CONTRACT_UNAVAILABLE',
      'Binotel read operation is unavailable until the account-specific provider contract is confirmed',
      { ...runtime, operation, capability: 'unsupported_capability' }
    );
  }

  return Object.freeze({
    listCalls: scope => requireDocumentedOperation('list_calls', scope),
    listCallsByAgent: scope => requireDocumentedOperation('list_calls_by_agent', scope),
    listCallsByNumber: scope => requireDocumentedOperation('list_calls_by_number', scope),
    listLostCalls: scope => requireDocumentedOperation('list_lost_calls', scope),
    listLiveCalls: scope => requireDocumentedOperation('list_live_calls', scope),
    getRecording: scope => requireDocumentedOperation('get_recording', scope),
  });
}

module.exports = { BinotelCapabilityError, createBinotelClient };
