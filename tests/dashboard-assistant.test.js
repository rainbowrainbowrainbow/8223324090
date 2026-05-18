const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'dashboard-assistant-test-secret';

const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_API_BASE: process.env.OPENAI_API_BASE,
    OPENAI_TTS_VOICE: process.env.OPENAI_TTS_VOICE
};
const originalFetch = global.fetch;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearAssistantModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/dashboardAssistant',
        '../services/dashboardAssistantAudio',
        '../routes/crm-assistant',
        '../routes/dashboard-assistant'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function restoreEnv() {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    global.fetch = originalFetch;
    clearAssistantModules();
}

function tokenFor(role = 'manager') {
    return jwt.sign(
        { id: role === 'creator' ? 1 : 20, username: `${role}-user`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function postJson(baseUrl, path, body, role = 'manager') {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenFor(role)}`
        },
        body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json() };
}

afterEach(restoreEnv);

describe('dashboard assistant service contract', () => {
    it('builds compact role/page context for the rail prompt', () => {
        clearAssistantModules();
        const { buildAssistantContext } = require('../services/dashboardAssistant');
        const context = buildAssistantContext({
            role: 'creator',
            page: 'dashboard',
            title: 'Дашборд',
            intent: 'Поясни сторінку',
            proactive: true,
            widgets: ['tasks', 'alerts', '', 'director_pnl'],
            signals: [{ signalId: 'tasks.overdue', label: 'Overdue tasks', severity: 'danger', value: 2 }],
            actions: [{ actionId: 'tasks.focus-overdue', page: 'tasks', actionType: 'focus', label: 'Focus overdue' }],
            teachingTargets: [{ targetId: 'tasks-board', page: 'tasks', label: 'Task board', selectorOrRef: '#boardContent' }],
            fallbackReason: '',
            scenePreset: 'director',
            voiceMode: true,
            recentState: { mode: 'listening', voiceEnabled: true, previewRole: 'director' },
            userMessage: 'Поясни сцену'
        });

        assert.equal(context.role, 'creator');
        assert.equal(context.page, 'dashboard');
        assert.equal(context.title, 'Дашборд');
        assert.equal(context.intent, 'Поясни сторінку');
        assert.equal(context.proactive, true);
        assert.deepEqual(context.widgets, ['tasks', 'alerts', 'director_pnl']);
        assert.equal(context.signals[0].signalId, 'tasks.overdue');
        assert.equal(context.actions[0].actionId, 'tasks.focus-overdue');
        assert.equal(context.teachingTargets[0].targetId, 'tasks-board');
        assert.equal(context.scenePreset, 'director');
        assert.equal(context.voiceMode, true);
        assert.equal(context.recentState.previewRole, 'director');
        assert.match(context.strategicFrame, /creator|цілісності|dashboard|bottlenecks/);
        assert.match(context.pagePriority, /bottlenecks|пріоритети/);
    });

    it('normalizes assistant replies into the foundation schema', () => {
        clearAssistantModules();
        const { normalizeAssistantReply } = require('../services/dashboardAssistant');
        const reply = normalizeAssistantReply('Перевір прострочені задачі.', {
            signals: [{ signalId: 'tasks.overdue', label: 'Overdue tasks', severity: 'danger', value: 2 }],
            actionProposal: { actionId: 'tasks.focus-overdue', page: 'tasks', actionType: 'focus', label: 'Focus overdue' },
            teachingTarget: { targetId: 'tasks-board', page: 'tasks', label: 'Task board' }
        }, { model: 'test-model' });

        assert.equal(reply.mode, 'speaking');
        assert.equal(reply.summary, 'Перевір прострочені задачі.');
        assert.equal(reply.text, reply.summary);
        assert.equal(reply.subtitle, reply.summary);
        assert.equal(reply.evidence[0].signalId, 'tasks.overdue');
        assert.equal(reply.riskLevel, 'high');
        assert.equal(reply.confidence, 'medium');
        assert.equal(reply.actionProposal.actionId, 'tasks.focus-overdue');
        assert.equal(reply.teachingTarget.targetId, 'tasks-board');
        assert.equal(reply.model, 'test-model');
    });

    it('uses context actions and teaching targets as safe reply fallbacks', () => {
        clearAssistantModules();
        const { normalizeAssistantReply } = require('../services/dashboardAssistant');
        const reply = normalizeAssistantReply({ summary: 'Є тиск по відповідях.' }, {
            signals: [{ signalId: 'chat.unread.total', label: 'Unread chat', severity: 'warning', value: 5 }],
            actions: [{ actionId: 'chat.filter-unread', page: 'chat', actionType: 'filter', label: 'Filter unread chats' }],
            teachingTargets: [{ targetId: 'chat-first-unread', page: 'chat', label: 'First unread channel', available: true }]
        });

        assert.equal(reply.riskLevel, 'medium');
        assert.equal(reply.actionProposal.actionId, 'chat.filter-unread');
        assert.equal(reply.teachingTarget.targetId, 'chat-first-unread');
    });

    it('keeps OpenAI keys server-side and sends only CRM context to Responses API', async () => {
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.OPENAI_API_BASE = 'https://openai.test/v1';
        clearAssistantModules();

        let request = null;
        global.fetch = async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                status: 200,
                json: async () => ({ output_text: 'Коротка role-aware підказка.' })
            };
        };

        const { getDashboardAssistantReply } = require('../services/dashboardAssistant');
        const reply = await getDashboardAssistantReply({
            role: 'manager',
            page: 'dashboard',
            widgets: ['funnel', 'tasks'],
            userMessage: 'Що головне?'
        });

        assert.equal(reply.summary, 'Коротка role-aware підказка.');
        assert.equal(reply.subtitle, 'Коротка role-aware підказка.');
        assert.match(reply.recommendation, /Для менеджера|Коротка role-aware підказка/);
        assert.equal(request.url, 'https://openai.test/v1/responses');
        assert.equal(request.options.headers.Authorization, 'Bearer test-openai-key');
        assert.doesNotMatch(request.options.body, /test-openai-key/);
        assert.match(request.options.body, /funnel/);
        assert.match(request.options.body, /Що головне\?/);
    });

    it('builds sharper strategic recommendations from signals and actions', () => {
        clearAssistantModules();
        const { normalizeAssistantReply } = require('../services/dashboardAssistant');
        const reply = normalizeAssistantReply({ summary: 'Є фінансовий ризик.' }, {
            role: 'director',
            page: 'finance',
            signals: [{ signalId: 'finance.debt.overdue', label: 'Overdue debt', severity: 'danger', evidence: '3 борги на 12000 грн.' }],
            actionProposal: { actionId: 'finance.open-debts', page: 'finance', actionType: 'filter', label: 'Open debts tab' }
        });

        assert.equal(reply.riskLevel, 'high');
        assert.match(reply.recommendation, /P&L|ризику/);
        assert.match(reply.recommendation, /Open debts tab/);
    });

    it('frames the same business context differently for director and manager roles', () => {
        clearAssistantModules();
        const { normalizeAssistantReply } = require('../services/dashboardAssistant');
        const context = {
            page: 'dashboard',
            signals: [{ signalId: 'dashboard.work_queue.overdue_tasks', label: 'Overdue task pressure', severity: 'danger', evidence: '4 прострочені задачі у work queue.' }],
            actionProposal: { actionId: 'dashboard.focus-work-queue', page: 'dashboard', actionType: 'focus', label: 'Focus work queue' }
        };

        const director = normalizeAssistantReply({ summary: 'Є тиск у черзі.' }, { ...context, role: 'director' });
        const manager = normalizeAssistantReply({ summary: 'Є тиск у черзі.' }, { ...context, role: 'manager' });

        assert.notEqual(director.recommendation, manager.recommendation);
        assert.match(director.recommendation, /P&L|відповідальності|ризику/);
        assert.match(manager.recommendation, /лідах|задачах|командному/);
    });

    it('fails closed when OPENAI_API_KEY is not configured', async () => {
        delete process.env.OPENAI_API_KEY;
        clearAssistantModules();
        const { getDashboardAssistantReply } = require('../services/dashboardAssistant');

        await assert.rejects(
            () => getDashboardAssistantReply({ userMessage: 'ping' }),
            error => error.code === 'openai_not_configured' && error.status === 503
        );
    });

    it('falls back to a safe TTS voice when env contains an unsupported value', () => {
        process.env.OPENAI_TTS_VOICE = 'unsupported-voice';
        clearAssistantModules();
        const { normalizeVoice } = require('../services/dashboardAssistantAudio');

        assert.equal(normalizeVoice(), 'alloy');
        assert.equal(normalizeVoice('coral'), 'coral');
    });
});

describe('dashboard assistant route context', () => {
    it('uses JWT role as the source of truth and limits role preview to creator', async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        clearAssistantModules();

        const calls = [];
        installMock('../db', {
            pool: { query: async () => ({ rows: [] }) },
            query: async () => ({ rows: [] })
        });
        installMock('../services/dashboardAssistant', {
            getDashboardAssistantReply: async input => {
                calls.push(input);
                return { text: 'ok', subtitle: 'ok', mode: 'speaking' };
            }
        });
        installMock('../services/dashboardAssistantAudio', {
            transcribeDashboardAudio: async () => 'voice text',
            synthesizeDashboardSpeech: async () => Buffer.from('mp3')
        });

        const app = express();
        app.use(express.json());
        app.use('/api/crm-assistant', require('../routes/crm-assistant'));
        const { server, baseUrl } = await listen(app);

        try {
            const manager = await postJson(baseUrl, '/api/crm-assistant/reply', {
                role: 'creator',
                scenePreset: 'director',
                userMessage: 'manager spoof'
            }, 'manager');
            const creator = await postJson(baseUrl, '/api/crm-assistant/reply', {
                scenePreset: 'director',
                userMessage: 'creator preview'
            }, 'creator');

            assert.equal(manager.status, 200);
            assert.equal(creator.status, 200);
            assert.equal(calls[0].role, 'manager');
            assert.equal(calls[0].scenePreset, 'manager');
            assert.equal(calls[0].recentState.previewRole, '');
            assert.equal(calls[1].role, 'creator');
            assert.equal(calls[1].scenePreset, 'director');
            assert.equal(calls[1].recentState.previewRole, 'director');
        } finally {
            await close(server);
        }
    });
});
