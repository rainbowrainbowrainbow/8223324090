(function initCrmCreateHandoff(global) {
    'use strict';

    const CONTRACT_APP = 'event-genix.crm-create-handoff';
    const CONTRACT_VERSION = 1;
    const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
    const HANDOFF_PARAM = 'crm_handoff';
    const TOKEN_PARAM = 'crm_handoff_token';
    const CONTEXT_PARAM = 'crm_handoff_context';
    const ENTITY_PARAM = 'crm_handoff_entity';
    const RETURN_PARAM = 'crm_handoff_return';
    const VALID_ENTITIES = new Set(['customer', 'lead']);
    const VALID_MESSAGE_TYPES = new Set(['customer.created', 'lead.created']);
    const TOKEN_RE = /^[a-zA-Z0-9_-]{24,128}$/;
    const CONTEXT_RE = /^[a-zA-Z0-9_-]{1,64}$/;

    function getWindow(options = {}) {
        return options.windowRef || global;
    }

    function cleanString(value) {
        return value === undefined || value === null ? '' : String(value).trim();
    }

    function normalizeEntity(value) {
        const entity = cleanString(value).toLowerCase();
        return VALID_ENTITIES.has(entity) ? entity : '';
    }

    function normalizeBusinessContext(value) {
        const context = cleanString(value) || 'default';
        return CONTEXT_RE.test(context) ? context : '';
    }

    function eventTypeForEntity(entity) {
        const normalized = normalizeEntity(entity);
        return normalized ? `${normalized}.created` : '';
    }

    function entityForEventType(type) {
        const cleanType = cleanString(type);
        if (!VALID_MESSAGE_TYPES.has(cleanType)) return '';
        return cleanType.split('.')[0];
    }

    function positiveId(value) {
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    function randomToken(win = global) {
        const bytes = new Uint8Array(24);
        const cryptoObj = win?.crypto || global?.crypto;
        if (!cryptoObj?.getRandomValues) {
            throw new Error('Secure token generation is unavailable');
        }
        cryptoObj.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function normalizeToken(value) {
        const token = cleanString(value);
        return TOKEN_RE.test(token) ? token : '';
    }

    function channelNameForToken(token) {
        const cleanToken = normalizeToken(token);
        if (!cleanToken) return '';
        return `${CONTRACT_APP}.v${CONTRACT_VERSION}.${cleanToken}`;
    }

    function sameOriginPath(value, win = global) {
        const raw = cleanString(value);
        if (!raw) return '';
        try {
            const origin = win?.location?.origin || 'http://localhost';
            const url = new URL(raw, origin);
            if (url.origin !== origin) return '';
            return `${url.pathname}${url.search}${url.hash}`;
        } catch {
            return '';
        }
    }

    function createRequest(options = {}) {
        const win = getWindow(options);
        const entity = normalizeEntity(options.entity);
        const businessContext = normalizeBusinessContext(options.businessContext);
        if (!entity) throw new Error('CRM handoff entity must be customer or lead');
        if (!businessContext) throw new Error('CRM handoff business context is invalid');
        const token = normalizeToken(options.token) || randomToken(win);
        return {
            app: CONTRACT_APP,
            version: CONTRACT_VERSION,
            token,
            entity,
            businessContext,
            channelName: channelNameForToken(token),
            returnPath: sameOriginPath(options.returnPath, win)
        };
    }

    function requestToUrl(baseUrl, request, options = {}) {
        const win = getWindow(options);
        const origin = win?.location?.origin || 'http://localhost';
        const url = new URL(baseUrl, origin);
        url.searchParams.set(HANDOFF_PARAM, '1');
        url.searchParams.set(TOKEN_PARAM, request.token);
        url.searchParams.set(CONTEXT_PARAM, request.businessContext);
        url.searchParams.set(ENTITY_PARAM, request.entity);
        const returnPath = sameOriginPath(request.returnPath || options.returnPath, win);
        if (returnPath) url.searchParams.set(RETURN_PARAM, returnPath);
        return url;
    }

    function readRequestFromUrl(urlLike, options = {}) {
        const win = getWindow(options);
        const href = urlLike || win?.location?.href;
        if (!href) return null;
        const origin = win?.location?.origin || 'http://localhost';
        const url = new URL(href, origin);
        if (url.searchParams.get(HANDOFF_PARAM) !== '1') return null;
        const token = normalizeToken(url.searchParams.get(TOKEN_PARAM));
        const entity = normalizeEntity(url.searchParams.get(ENTITY_PARAM));
        const businessContext = normalizeBusinessContext(url.searchParams.get(CONTEXT_PARAM));
        if (!token || !entity || !businessContext) return null;
        return {
            app: CONTRACT_APP,
            version: CONTRACT_VERSION,
            token,
            entity,
            businessContext,
            channelName: channelNameForToken(token),
            returnPath: sameOriginPath(url.searchParams.get(RETURN_PARAM), win)
        };
    }

    function sanitizePayload(type, payload = {}) {
        if (type === 'customer.created') {
            const customerId = positiveId(payload.customerId ?? payload.customer_id ?? payload.id);
            return customerId ? { customerId } : null;
        }
        if (type === 'lead.created') {
            const leadId = positiveId(payload.leadId ?? payload.lead_id ?? payload.id);
            if (!leadId) return null;
            const customerId = positiveId(payload.customerId ?? payload.customer_id);
            return customerId ? { leadId, customerId } : { leadId };
        }
        return null;
    }

    function validateEnvelope(message, expected = {}) {
        if (!message || typeof message !== 'object') return { ok: false, reason: 'message_invalid' };
        if (message.app !== CONTRACT_APP) return { ok: false, reason: 'app_mismatch' };
        if (message.version !== CONTRACT_VERSION) return { ok: false, reason: 'version_mismatch' };
        if (!VALID_MESSAGE_TYPES.has(message.type)) return { ok: false, reason: 'type_invalid' };
        const token = normalizeToken(message.token);
        if (!token) return { ok: false, reason: 'token_invalid' };
        if (expected.token && token !== expected.token) return { ok: false, reason: 'token_mismatch' };
        const businessContext = normalizeBusinessContext(message.businessContext);
        if (!businessContext) return { ok: false, reason: 'business_context_invalid' };
        if (expected.businessContext && businessContext !== normalizeBusinessContext(expected.businessContext)) {
            return { ok: false, reason: 'business_context_mismatch' };
        }
        const entity = entityForEventType(message.type);
        if (expected.entity && entity !== normalizeEntity(expected.entity)) {
            return { ok: false, reason: 'entity_mismatch' };
        }
        const payload = sanitizePayload(message.type, message.payload || {});
        if (!payload) return { ok: false, reason: 'payload_invalid' };
        return {
            ok: true,
            envelope: {
                app: CONTRACT_APP,
                version: CONTRACT_VERSION,
                type: message.type,
                token,
                businessContext,
                payload
            }
        };
    }

    function openChannel(channelName, win = global) {
        const ChannelCtor = win?.BroadcastChannel || global?.BroadcastChannel;
        if (!ChannelCtor || !channelName) return null;
        return new ChannelCtor(channelName);
    }

    function addChannelListener(channel, handler) {
        if (!channel) return () => {};
        if (typeof channel.addEventListener === 'function') {
            channel.addEventListener('message', handler);
            return () => channel.removeEventListener?.('message', handler);
        }
        const previous = channel.onmessage;
        channel.onmessage = handler;
        return () => {
            if (channel.onmessage === handler) channel.onmessage = previous || null;
        };
    }

    function createReceiver(options = {}) {
        const win = getWindow(options);
        const request = createRequest(options);
        const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
        const channel = openChannel(request.channelName, win);
        let active = true;
        let timer = null;

        function dispose() {
            if (!active) return;
            active = false;
            if (timer) clearTimeout(timer);
            removeChannelListener();
            win?.removeEventListener?.('message', postMessageListener);
            channel?.close?.();
        }

        function handleEnvelope(raw) {
            if (!active) return false;
            const validation = validateEnvelope(raw, request);
            if (!validation.ok) {
                if (typeof options.onIgnoredMessage === 'function') options.onIgnoredMessage(validation.reason, raw);
                return false;
            }
            dispose();
            if (typeof options.onCreated === 'function') options.onCreated(validation.envelope.payload, validation.envelope);
            return true;
        }

        function channelListener(event) {
            handleEnvelope(event?.data);
        }

        function postMessageListener(event) {
            const origin = win?.location?.origin;
            if (origin && event?.origin !== origin) return;
            handleEnvelope(event?.data);
        }

        const removeChannelListener = addChannelListener(channel, channelListener);
        win?.addEventListener?.('message', postMessageListener);
        timer = setTimeout(() => {
            if (!active) return;
            dispose();
            if (typeof options.onTimeout === 'function') options.onTimeout(request);
        }, timeoutMs);

        return {
            request,
            token: request.token,
            channelName: request.channelName,
            urlFor(baseUrl, urlOptions = {}) {
                return requestToUrl(baseUrl, request, { ...urlOptions, windowRef: win });
            },
            dispose,
            isActive() {
                return active;
            }
        };
    }

    function sendCreated(request, type, payload, options = {}) {
        const win = getWindow(options);
        const cleanRequest = request?.token ? request : readRequestFromUrl(null, { windowRef: win });
        if (!cleanRequest) return { ok: false, reason: 'request_missing' };
        const message = {
            app: CONTRACT_APP,
            version: CONTRACT_VERSION,
            type: cleanString(type) || eventTypeForEntity(cleanRequest.entity),
            token: cleanRequest.token,
            businessContext: cleanRequest.businessContext,
            payload
        };
        const validation = validateEnvelope(message, cleanRequest);
        if (!validation.ok) return { ok: false, reason: validation.reason };

        const channel = openChannel(cleanRequest.channelName, win);
        channel?.postMessage?.(validation.envelope);
        channel?.close?.();

        const opener = win?.opener;
        const origin = win?.location?.origin;
        if (origin && opener && opener !== win && typeof opener.postMessage === 'function') {
            opener.postMessage(validation.envelope, origin);
        }

        return {
            ok: true,
            envelope: validation.envelope,
            returnPath: cleanRequest.returnPath || ''
        };
    }

    function completeChildAfterSend(result, options = {}) {
        const win = getWindow(options);
        if (!result?.ok) return false;
        if (options.close !== false && typeof win?.close === 'function') {
            try {
                win.close();
            } catch {
                return false;
            }
        }
        return true;
    }

    const api = {
        CONTRACT_APP,
        CONTRACT_VERSION,
        DEFAULT_TIMEOUT_MS,
        HANDOFF_PARAM,
        TOKEN_PARAM,
        CONTEXT_PARAM,
        ENTITY_PARAM,
        RETURN_PARAM,
        createRequest,
        requestToUrl,
        readRequestFromUrl,
        createReceiver,
        sendCreated,
        completeChildAfterSend,
        validateEnvelope,
        sanitizePayload,
        normalizeBusinessContext,
        eventTypeForEntity
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    global.CrmCreateHandoff = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
