'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const originalFetch = global.fetch;

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
    };
}

function loadService() {
    const accountsId = require.resolve('../services/omni-accounts');
    const serviceId = require.resolve('../services/omni-whatsapp');
    delete require.cache[serviceId];
    require.cache[accountsId] = {
        id: accountsId,
        filename: accountsId,
        loaded: true,
        exports: {
            resolveOmniRuntimeConfig: async () => ({
                accessToken: 'fixture-access-token-that-is-never-returned',
                wabaId: '123456789012345',
                phoneNumberId: '987654321098765',
                apiVersion: 'v21.0',
            }),
        },
    };
    return require('../services/omni-whatsapp');
}

describe('Omni WhatsApp approved templates', () => {
    afterEach(() => {
        global.fetch = originalFetch;
        for (const modulePath of ['../services/omni-whatsapp', '../services/omni-accounts']) {
            try { delete require.cache[require.resolve(modulePath)]; } catch {}
        }
    });

    it('closes free-form replies without an inbound timestamp and at the 24-hour boundary', () => {
        const service = loadService();
        const now = new Date('2026-09-20T12:00:00.000Z');

        assert.deepEqual(service.whatsappReplyWindowState(null, now), {
            open: false,
            message: service.whatsappReplyWindowState(null, now).message,
            ageMs: null,
            closesAt: null,
            remainingMs: 0,
        });
        assert.equal(service.whatsappReplyWindowState('2026-09-19T12:00:00.000Z', now).open, true);
        assert.equal(service.whatsappReplyWindowState('2026-09-19T11:59:59.999Z', now).open, false);
        assert.equal(service.whatsappReplyWindowState('invalid-date', now).open, false);
    });

    it('returns an honest empty list when the WABA has no approved templates', async () => {
        global.fetch = async () => response(200, { data: [
            { id: 'pending', name: 'pending_offer', status: 'PENDING', category: 'MARKETING', language: 'uk', components: [] },
            { id: 'rejected', name: 'rejected_offer', status: 'REJECTED', category: 'MARKETING', language: 'uk', components: [] },
            { id: 'paused', name: 'paused_offer', status: 'PAUSED', category: 'MARKETING', language: 'uk', components: [] },
        ] });
        const templates = await loadService().fetchApprovedWhatsAppTemplates({ businessContext: 'event_genix' });
        assert.deepEqual(templates, []);
    });

    it('surfaces a redacted provider error when template loading fails', async () => {
        global.fetch = async () => response(503, { error: { message: 'Meta fixture unavailable' } });
        const service = loadService();

        await assert.rejects(
            () => service.fetchApprovedWhatsAppTemplates({ businessContext: 'event_genix' }),
            error => error.code === 'WHATSAPP_TEMPLATE_PROVIDER_ERROR'
                && error.statusCode === 503
                && /Meta fixture unavailable/.test(error.message)
        );
    });

    it('returns only approved templates and never exposes runtime secrets', async () => {
        const calls = [];
        global.fetch = async (url, options) => {
            calls.push({ url: String(url), options });
            return response(200, { data: [
                { id: '1', name: 'follow_up', status: 'APPROVED', category: 'UTILITY', language: 'uk', components: [{ type: 'BODY', text: 'Вітаємо, {{1}}' }] },
                { id: '2', name: 'draft_offer', status: 'PENDING', category: 'MARKETING', language: 'uk', components: [{ type: 'BODY', text: 'Чернетка' }] },
                { id: '3', name: 'paused_offer', status: 'PAUSED', category: 'MARKETING', language: 'uk', components: [{ type: 'BODY', text: 'Пауза' }] },
            ] });
        };
        const service = loadService();
        const templates = await service.fetchApprovedWhatsAppTemplates({ businessContext: 'dar' });

        assert.equal(templates.length, 1);
        assert.equal(templates[0].name, 'follow_up');
        assert.deepEqual(templates[0].parameters.body, ['1']);
        assert.equal(JSON.stringify(templates).includes('fixture-access-token'), false);
        assert.match(calls[0].url, /123456789012345\/message_templates/);
        assert.match(calls[0].options.headers.Authorization, /^Bearer /);
    });

    it('validates variables server-side and builds header, body and quick-reply components', async () => {
        global.fetch = async () => response(200, { data: [{
            id: 'template-4',
            name: 'appointment_reminder',
            status: 'APPROVED',
            category: 'UTILITY',
            language: 'uk',
            components: [
                { type: 'HEADER', format: 'TEXT', text: 'Подія {{event_name}}' },
                { type: 'BODY', text: 'Вітаємо, {{customer_name}}. Чекаємо {{1}}.' },
                { type: 'FOOTER', text: 'EventGenix' },
                { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Підтверджую' }] },
            ],
        }] });
        const service = loadService();

        await assert.rejects(
            () => service.prepareWhatsAppTemplateRequest({ name: 'appointment_reminder', language: 'uk', parameters: { body: { customer_name: 'Сергій' } } }, { businessContext: 'dar' }),
            error => error.code === 'WHATSAPP_TEMPLATE_MISSING_PARAMETER'
        );
        const prepared = await service.prepareWhatsAppTemplateRequest({
            name: 'appointment_reminder',
            language: 'uk',
            parameters: {
                header: { event_name: 'День народження' },
                body: { customer_name: 'Сергій', 1: 'о 18:00' },
            },
        }, { businessContext: 'dar' });

        assert.match(prepared.preview, /Подія День народження/);
        assert.match(prepared.preview, /Вітаємо, Сергій\. Чекаємо о 18:00\./);
        assert.equal(prepared.components[0].parameters[0].parameter_name, 'event_name');
        assert.equal(prepared.components[1].parameters[0].parameter_name, 'customer_name');
        assert.equal(prepared.components[1].parameters[1].parameter_name, undefined);
        assert.deepEqual(prepared.components[2], {
            type: 'button', sub_type: 'quick_reply', index: '0',
            parameters: [{ type: 'payload', payload: 'omni:template-4:0' }],
        });
    });

    it('sends a prepared template and returns the provider message id', async () => {
        let captured;
        global.fetch = async (_url, options) => {
            captured = JSON.parse(options.body);
            return response(200, { messages: [{ id: 'wamid.template-test' }] });
        };
        const service = loadService();
        const result = await service.sendWhatsAppTemplate('+380671112233', {
            name: 'follow_up', language: 'uk', components: [],
        }, { businessContext: 'dar' });

        assert.equal(result.success, true);
        assert.equal(result.messageId, 'wamid.template-test');
        assert.equal(captured.to, '380671112233');
        assert.equal(captured.type, 'template');
        assert.deepEqual(captured.template, { name: 'follow_up', language: { code: 'uk' } });
    });
});
