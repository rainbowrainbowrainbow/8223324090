/**
 * js/copilot-page.js — Manager AI Copilot (всі 11 модулів)
 * v27.0.0 | 2026-03-13 | Клешня 🦞
 */

const CopilotPage = (() => {
    'use strict';

    const MANAGER_ROLES = ['creator', 'director', 'senior_manager', 'manager'];
    let currentModule = 'coach';
    let liveMode = false;
    let liveDebounceTimer = null;
    let dataCache = {};
    let currentScriptId = null;
    let currentStepId = null;

    // ─── Init ───────────────────────────────────────────────────────────────

    async function init() {
        // Wait for auth
        await waitForAuth();

        const user = AppState?.currentUser;
        if (!user || !MANAGER_ROLES.includes(user.role)) {
            var denied = document.getElementById('accessDenied');
            if (denied) { denied.classList.remove('hidden'); denied.style.display = 'flex'; }
            document.getElementById('copilotApp')?.classList.add('hidden');
            return;
        }

        document.getElementById('copilotApp')?.classList.remove('hidden');
        document.getElementById('accessDenied')?.classList.add('hidden');

        // Bind nav
        document.querySelectorAll('.copilot-nav-item').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                const mod = item.dataset.module;
                if (mod) switchModule(mod);
            });
        });

        // Load initial data
        await loadAllData();

        // Render default module
        switchModule('coach');
    }

    async function waitForAuth() {
        // If already authenticated, return immediately
        if (AppState?.currentUser) return;

        // Try to restore from localStorage
        const token = localStorage.getItem('pzp_token');
        if (!token) { window.location.href = '/'; return; }

        const savedUser = localStorage.getItem('pzp_current_user');
        if (savedUser) {
            try { AppState.currentUser = JSON.parse(savedUser); } catch {}
        }

        // Verify with server
        if (typeof apiVerifyToken === 'function') {
            const verified = await apiVerifyToken();
            if (!verified) { window.location.href = '/'; return; }
            AppState.currentUser = verified;
            if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
        }
    }

    async function loadAllData() {
        const files = ['objections', 'call-scripts', 'message-templates', 'battle-cards', 'sales-academy', 'sales-methodology', 'buyer-profiles'];
        await Promise.all(files.map(async f => {
            try {
                const r = await fetch(`/api/copilot/data/${f}`, { headers: authHeaders() });
                if (r.ok) dataCache[f] = await r.json();
            } catch (e) { /* non-blocking */ }
        }));
    }

    function authHeaders() {
        const token = localStorage.getItem('pzp_token');
        return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }

    async function apiPost(url, body) {
        const r = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        return r.json();
    }

    async function apiGet(url) {
        const r = await fetch(url, { headers: authHeaders() });
        return r.json();
    }

    // ─── Navigation ─────────────────────────────────────────────────────────

    function switchModule(module) {
        currentModule = module;
        document.querySelectorAll('.copilot-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.module === module);
        });
        renderModule(module);
    }

    function renderModule(module) {
        const content = document.getElementById('copilotContent');
        if (!content) return;
        content.innerHTML = '';

        const renderers = {
            'coach':        renderCoach,
            'objections':   renderObjections,
            'scripts':      renderScripts,
            'templates':    renderTemplates,
            'debrief':      renderDebrief,
            'academy':      renderAcademy,
            'tracker':      renderTracker,
            'battle-cards': renderBattleCards,
            'meeting-prep': renderMeetingPrep,
            'pipeline':     renderPipeline,
            'writer':       renderWriter,
        };

        const fn = renderers[module];
        if (fn) fn(content);
    }

    // ─── MODULE 1: AI Live Coach ─────────────────────────────────────────────

    function renderCoach(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>🎯 AI LIVE COACH <span class="module-badge">МОДУЛЬ 1</span>
                <span style="margin-left:auto;">
                    <span id="liveToggle" class="live-indicator off" onclick="CopilotPage.toggleLive()">
                        <span class="live-dot"></span> LIVE
                    </span>
                </span>
            </h2>

            <div class="form-group">
                <label class="copilot-label">Що сказав клієнт:</label>
                <textarea id="coachInput" class="copilot-textarea" rows="3"
                    placeholder="Вставте або наберіть фразу клієнта..."
                    oninput="CopilotPage.onCoachInput(this.value)"></textarea>
            </div>

            <div class="flex-row" style="margin-bottom:14px;">
                <div style="flex:1;">
                    <label class="copilot-label">Сценарій</label>
                    <select id="coachScenario" class="copilot-select">
                        <option value="first-call">Перший дзвінок</option>
                        <option value="landing-lead">По заявці з лендінгу</option>
                        <option value="after-demo">Після презентації</option>
                        <option value="price-negotiation">Торг / обговорення ціни</option>
                        <option value="objection">Заперечення і відмова</option>
                        <option value="closing">Закриття угоди</option>
                        <option value="follow-up">Follow-up — мовчав тиждень</option>
                        <option value="reactivation">Реактивація — давно не контактували</option>
                    </select>
                </div>
                <div style="flex:1;">
                    <label class="copilot-label">Тон</label>
                    <select id="coachTone" class="copilot-select">
                        <option value="confident">Впевнений</option>
                        <option value="empathetic">М'який і емпатичний</option>
                        <option value="business">Діловий і короткий</option>
                        <option value="playful">Трохи гумору</option>
                    </select>
                </div>
            </div>

            <div class="flex-row">
                <button class="btn-gold" id="coachBtn" onclick="CopilotPage.runCoach()">
                    🎯 Підказати
                </button>
                <button class="btn-ghost" onclick="CopilotPage.clearCoach()">🔄 Очистити</button>
            </div>
        </div>

        <div id="coachResult" class="hidden">
            <div class="copilot-card">
                <h4 style="color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 14px;">── AI РЕКОМЕНДАЦІЯ ──</h4>
                <div id="coachSuggestions"></div>
                <div id="coachMeta" class="ai-meta-row"></div>
                <hr class="divider">
                <div class="flex-row" style="justify-content:space-between;">
                    <div class="flex-row">
                        <button class="btn-ghost" onclick="CopilotPage.sendFeedback(1)" title="Добре">👍 Добре</button>
                        <button class="btn-ghost" onclick="CopilotPage.sendFeedback(-1)" title="Погано">👎 Погано</button>
                    </div>
                    <button class="btn-ghost" onclick="CopilotPage.runCoach(true)">🔄 Ще варіанти</button>
                </div>
            </div>
        </div>`;
    }

    let lastCoachData = null;

    window.CopilotPage = {
        toggleLive, onCoachInput, runCoach, clearCoach, sendFeedback,
        toggleAccordion, selectObjection, runObjectionAI,
        selectScript, navigateStep, runScriptAction,
        selectTemplate, generatePreview,
        runDebrief, saveDebrief,
        runAcademyQA,
        loadTracker, markFollowupDone, addManualInteraction,
        runMeetingPrep,
        loadPipeline,
        runMessageWriter, copyMessage, resendWriter,
    };

    function toggleLive() {
        liveMode = !liveMode;
        const btn = document.getElementById('liveToggle');
        if (btn) {
            btn.className = `live-indicator ${liveMode ? 'on' : 'off'}`;
            btn.innerHTML = `<span class="live-dot"></span> LIVE`;
        }
    }

    function onCoachInput(value) {
        if (!liveMode) return;
        clearTimeout(liveDebounceTimer);
        liveDebounceTimer = setTimeout(() => {
            if (value.trim().length > 10) runCoach();
        }, 800);
    }

    async function runCoach(highTemp = false) {
        const input = document.getElementById('coachInput');
        const btn = document.getElementById('coachBtn');
        const clientText = input?.value?.trim();
        if (!clientText) return;

        const scenario = document.getElementById('coachScenario')?.value || 'first-call';
        const tone = document.getElementById('coachTone')?.value || 'confident';

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Аналізую...'; }

        try {
            const data = await apiPost('/api/copilot/coach', {
                clientText, scenario, tone,
                ...(highTemp ? { temperature: 0.9 } : {})
            });

            if (!data.success) throw new Error(data.error || 'Помилка');

            lastCoachData = { clientText, scenario, suggestions: data.suggestions };
            renderCoachResult(data);
        } catch (e) {
            showError('Помилка Live Coach: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🎯 Підказати'; }
        }
    }

    function renderCoachResult(data) {
        const result = document.getElementById('coachResult');
        const suggestions = document.getElementById('coachSuggestions');
        const meta = document.getElementById('coachMeta');
        if (!result || !suggestions) return;

        result.classList.remove('hidden');

        const typeLabels = { neutral: '💬 Нейтральний', confident: '💪 Впевнений', empathy: '❤️ Емпатія' };

        suggestions.innerHTML = (data.suggestions || []).map((s, i) => `
            <div class="suggestion-item stagger-item">
                <div class="suggestion-type">${typeLabels[s.type] || s.type}</div>
                <div class="suggestion-text">${escHtml(s.text)}</div>
                <div class="suggestion-footer">
                    <button class="btn-icon" onclick="CopilotPage.copyText(${JSON.stringify(s.text)})">📋 Копіювати</button>
                </div>
            </div>
        `).join('');

        if (meta) {
            meta.innerHTML = `
                ${data.tactic ? `<div class="ai-meta-item"><span class="label">🧭</span><span class="content"><b>Тактика:</b> ${escHtml(data.tactic)}</span></div>` : ''}
                ${(data.avoid || []).length ? `<div class="ai-meta-item"><span class="label">⚠️</span><span class="content"><b>Уникай:</b> ${(data.avoid || []).map(a => escHtml(a)).join(', ')}</span></div>` : ''}
                ${data.nextStep ? `<div class="ai-meta-item"><span class="label">➡️</span><span class="content"><b>Наступний крок:</b> ${escHtml(data.nextStep)}</span></div>` : ''}
            `;
        }
    }

    function clearCoach() {
        const input = document.getElementById('coachInput');
        if (input) input.value = '';
        const result = document.getElementById('coachResult');
        if (result) result.classList.add('hidden');
        lastCoachData = null;
    }

    async function sendFeedback(rating) {
        if (!lastCoachData) return;
        try {
            await apiPost('/api/copilot/feedback', {
                scenario: lastCoachData.scenario,
                clientText: lastCoachData.clientText,
                suggestion: lastCoachData.suggestions?.[0]?.text || '',
                rating
            });
            showToast(rating === 1 ? '👍 Дякую за зворотній зв\'язок!' : '👎 Дякую, вдосконалюємо!');
        } catch (e) { /* silent */ }
    }

    // ─── MODULE 2: Objections ───────────────────────────────────────────────

    function renderObjections(container) {
        const objData = dataCache['objections'] || {};
        const objKeys = Object.keys(objData);

        container.innerHTML = `
        <div class="copilot-card">
            <h2>🛡️ ОБРОБНИК ЗАПЕРЕЧЕНЬ <span class="module-badge">МОДУЛЬ 2</span></h2>

            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="objSearch" class="copilot-input" placeholder="Пошук: 'дорого', 'не потрібно'..."
                    oninput="CopilotPage.filterObjSearch(this.value)">
            </div>

            <div class="objection-grid" id="objGrid">
                ${objKeys.map(k => `
                    <div class="objection-chip" data-key="${k}" onclick="CopilotPage.selectObjection('${k}')">
                        <span>${objData[k].emoji || '❓'}</span>
                        <span>${objData[k].title}</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <div id="objResponses" class="hidden">
            <div class="copilot-card">
                <h2 id="objTitle">Відповіді</h2>
                <div id="objResponsesList"></div>
                <hr class="divider">
                <div class="form-group">
                    <label class="copilot-label">Або введіть кастомне заперечення:</label>
                    <div class="flex-row">
                        <input type="text" id="customObjInput" class="copilot-input" placeholder="Введіть заперечення клієнта...">
                        <button class="btn-gold" onclick="CopilotPage.runObjectionAI()">🤖 AI відповідь</button>
                    </div>
                </div>
                <div id="customObjResult" class="hidden"></div>
            </div>
        </div>`;

        // Add filter function
        window.CopilotPage.filterObjSearch = (query) => {
            const q = query.toLowerCase();
            document.querySelectorAll('.objection-chip').forEach(chip => {
                const key = chip.dataset.key;
                const obj = objData[key];
                const visible = !q || obj.title.toLowerCase().includes(q) ||
                    (obj.keywords || []).some(kw => kw.toLowerCase().includes(q));
                chip.style.display = visible ? '' : 'none';
                if (visible && q && (obj.keywords || []).some(kw => kw.toLowerCase().includes(q))) {
                    selectObjection(key);
                }
            });
        };
    }

    function selectObjection(key) {
        const objData = dataCache['objections'] || {};
        const obj = objData[key];
        if (!obj) return;

        // Highlight chip
        document.querySelectorAll('.objection-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.key === key);
        });

        const respDiv = document.getElementById('objResponses');
        const title = document.getElementById('objTitle');
        const list = document.getElementById('objResponsesList');
        if (!respDiv || !list) return;

        respDiv.classList.remove('hidden');
        if (title) title.textContent = `📌 Відповіді на: "${obj.title}"`;

        list.innerHTML = (obj.responses || []).map(r => `
            <div class="accordion-item">
                <div class="accordion-header" onclick="CopilotPage.toggleAccordion(this)">
                    <span>📌 ${escHtml(r.label)}</span>
                    <span class="accordion-chevron">▾</span>
                </div>
                <div class="accordion-body">
                    <blockquote style="background:rgba(0,0,0,.2);border-left:3px solid var(--gold);margin:0 0 10px;padding:10px 14px;border-radius:0 6px 6px 0;font-size:14px;line-height:1.6;color:#fff;">${escHtml(r.text)}</blockquote>
                    ${r.tactic ? `<div class="ai-meta-item" style="margin-bottom:6px;"><span class="label">🧭</span><span class="content text-dim">${escHtml(r.tactic)}</span></div>` : ''}
                    ${r.avoid ? `<div class="ai-meta-item"><span class="label">⚠️</span><span class="content" style="color:var(--warning-color);">${escHtml(r.avoid)}</span></div>` : ''}
                    <button class="btn-ghost" style="margin-top:10px;" onclick="CopilotPage.copyText(${JSON.stringify(r.text)})">📋 Копіювати</button>
                </div>
            </div>
        `).join('');
    }

    async function runObjectionAI() {
        const input = document.getElementById('customObjInput');
        const result = document.getElementById('customObjResult');
        const objText = input?.value?.trim();
        if (!objText || !result) return;

        result.classList.remove('hidden');
        result.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px;color:var(--text-muted);"><div class="spinner spinner-light"></div> AI аналізує заперечення...</div>`;

        try {
            const data = await apiPost('/api/copilot/objection', { objectionText: objText });
            if (!data.success) throw new Error(data.error);

            result.innerHTML = `<div class="ai-response-block">
                <h4>🤖 AI ВІДПОВІДІ</h4>
                ${(data.responses || []).map(r => `
                    <div class="suggestion-item">
                        <div class="suggestion-type">${r.label || r.type}</div>
                        <div class="suggestion-text">${escHtml(r.text)}</div>
                        ${r.tactic ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">🧭 ${escHtml(r.tactic)}</div>` : ''}
                        <button class="btn-icon" onclick="CopilotPage.copyText(${JSON.stringify(r.text)})">📋 Копіювати</button>
                    </div>
                `).join('')}
                ${data.nextStep ? `<div class="ai-meta-item" style="margin-top:10px;"><span class="label">➡️</span><span class="content"><b>Наступний крок:</b> ${escHtml(data.nextStep)}</span></div>` : ''}
            </div>`;
        } catch (e) {
            result.innerHTML = `<div style="color:var(--danger-color);padding:10px;">Помилка: ${escHtml(e.message)}</div>`;
        }
    }

    // ─── MODULE 3: Scripts ──────────────────────────────────────────────────

    function renderScripts(container) {
        const scripts = dataCache['call-scripts']?.scripts || [];

        container.innerHTML = `
        <div class="copilot-card">
            <h2>📝 СКРИПТИ ДЗВІНКІВ <span class="module-badge">МОДУЛЬ 3</span></h2>
            <div class="flex-wrap" id="scriptButtons">
                ${scripts.map(s => `
                    <button class="btn-ghost" onclick="CopilotPage.selectScript('${s.id}')">
                        ${s.title}
                    </button>
                `).join('')}
            </div>
        </div>
        <div id="scriptContent" class="hidden"></div>`;
    }

    function selectScript(id) {
        const scripts = dataCache['call-scripts']?.scripts || [];
        const script = scripts.find(s => s.id === id);
        if (!script) return;

        currentScriptId = id;
        currentStepId = script.steps[0]?.id;

        document.querySelectorAll('#scriptButtons .btn-ghost').forEach(b => {
            b.style.borderColor = b.textContent.trim() === script.title ? 'var(--gold)' : '';
            b.style.color = b.textContent.trim() === script.title ? 'var(--gold)' : '';
        });

        renderScriptStep(script, script.steps[0]);
    }

    function renderScriptStep(script, step) {
        const content = document.getElementById('scriptContent');
        if (!content || !step) return;
        content.classList.remove('hidden');

        const totalSteps = script.steps.filter(s => typeof s.id === 'number').length;
        const currentIdx = script.steps.findIndex(s => s.id === step.id) + 1;

        content.innerHTML = `
        <div class="copilot-card">
            <div class="flex-between" style="margin-bottom:16px;">
                <div>
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">${escHtml(script.title)}</div>
                    <h3 style="margin:0;font-size:16px;color:#fff;">Крок ${step.id}: ${escHtml(step.title)}</h3>
                    ${step.duration ? `<span style="font-size:12px;color:var(--gold);">${step.duration}</span>` : ''}
                </div>
                <button class="btn-ghost" onclick="CopilotPage.selectScript('${currentScriptId}')">🔄 Почати заново</button>
            </div>

            <!-- Progress -->
            <div class="script-progress" style="margin-bottom:20px;">
                ${script.steps.filter(s => typeof s.id === 'number').map(s => `
                    <div class="progress-step ${s.id === step.id ? 'active' : (s.id < step.id ? 'done' : '')}">${s.id < step.id ? '✓' : s.id}</div>
                    ${s.id < totalSteps ? '<div class="progress-line"></div>' : ''}
                `).join('')}
            </div>

            <div class="script-step-content">
                <blockquote>${escHtml(step.text).replace(/\n/g, '<br>')}</blockquote>
                ${step.tip ? `<div class="script-tip">💡 ${escHtml(step.tip)}</div>` : ''}

                ${(step.branches || []).length ? `
                    <div style="margin-top:14px;">
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Відповідь клієнта:</div>
                        <div class="script-branches">
                            ${step.branches.map(b => `
                                <button class="script-branch-btn"
                                    onclick="CopilotPage.navigateStep('${b.next || ''}', ${JSON.stringify(b.action || '')})">
                                    → ${b.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>

        <div id="scriptActionResult" class="hidden">
            <div class="copilot-card" style="border-color:var(--gold-border);">
                <h4 style="color:var(--gold);margin:0 0 10px;">💡 Рекомендація</h4>
                <div id="scriptActionText" style="font-size:14px;line-height:1.6;color:#fff;"></div>
            </div>
        </div>`;
    }

    function navigateStep(nextId, action) {
        const scripts = dataCache['call-scripts']?.scripts || [];
        const script = scripts.find(s => s.id === currentScriptId);
        if (!script) return;

        if (action) {
            const res = document.getElementById('scriptActionResult');
            const txt = document.getElementById('scriptActionText');
            if (res && txt) {
                res.classList.remove('hidden');
                txt.innerHTML = escHtml(action).replace(/\n/g, '<br>');
            }
        }

        if (nextId) {
            const step = script.steps.find(s => s.id === parseInt(nextId));
            if (step) {
                currentStepId = step.id;
                renderScriptStep(script, step);
            }
        }
    }

    function runScriptAction() {}

    // ─── MODULE 4: Templates ────────────────────────────────────────────────

    function renderTemplates(container) {
        const templates = dataCache['message-templates']?.templates || [];

        container.innerHTML = `
        <div class="copilot-card">
            <h2>💬 ШАБЛОНИ ПОВІДОМЛЕНЬ <span class="module-badge">МОДУЛЬ 4</span></h2>
            <div class="flex-wrap" id="templateButtons" style="margin-bottom:0;">
                ${templates.map(t => `
                    <button class="btn-ghost" onclick="CopilotPage.selectTemplate('${t.id}')">
                        ${t.title}
                    </button>
                `).join('')}
            </div>
        </div>
        <div id="templateContent" class="hidden"></div>`;
    }

    function selectTemplate(id) {
        const templates = dataCache['message-templates']?.templates || [];
        const tpl = templates.find(t => t.id === id);
        if (!tpl) return;

        const content = document.getElementById('templateContent');
        if (!content) return;
        content.classList.remove('hidden');

        // Extract variables from template
        const vars = (tpl.text.match(/\{\{(\w+)\}\}/g) || []).map(m => m.replace(/\{\{|\}\}/g, '')).filter((v, i, arr) => arr.indexOf(v) === i);

        content.innerHTML = `
        <div class="copilot-card">
            <h3 style="margin:0 0 16px;color:#fff;">${escHtml(tpl.title)}</h3>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">${escHtml(tpl.description)}</p>

            ${vars.length ? `
                <div style="margin-bottom:16px;">
                    <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);margin:0 0 12px;">Заповніть змінні</h4>
                    <div class="form-row">
                        ${vars.map(v => `
                            <div class="form-group">
                                <label class="copilot-label">{{${v}}}</label>
                                <input type="text" class="copilot-input tpl-var" data-var="${v}"
                                    placeholder="${varPlaceholder(v)}"
                                    oninput="CopilotPage.generatePreview('${id}')">
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <div>
                <h4 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:0 0 8px;">Попередній перегляд</h4>
                <div class="template-preview" id="templatePreview">${formatTemplatePreview(tpl.text, {})}</div>
            </div>

            <div class="flex-row" style="margin-top:14px;">
                <button class="btn-gold" onclick="CopilotPage.copyTemplateText('${id}')">📋 Копіювати</button>
            </div>
        </div>`;
    }

    function varPlaceholder(v) {
        const map = { name: 'Ім\'я клієнта', pain_1: 'Головна проблема', pain_2: 'Друга проблема', package: 'Базовий', price: '2000', demo_date: '15.03', demo_time: '11:00', custom_feature: 'AI-дворецький' };
        return map[v] || v;
    }

    function formatTemplatePreview(text, vars) {
        return text.replace(/\{\{(\w+)\}\}/g, (m, key) => {
            const val = vars[key];
            return val ? escHtml(val) : `<span class="template-var">{{${key}}}</span>`;
        }).replace(/\n/g, '<br>');
    }

    function generatePreview(tplId) {
        const templates = dataCache['message-templates']?.templates || [];
        const tpl = templates.find(t => t.id === tplId);
        if (!tpl) return;
        const vars = {};
        document.querySelectorAll('.tpl-var').forEach(input => { vars[input.dataset.var] = input.value; });
        const preview = document.getElementById('templatePreview');
        if (preview) preview.innerHTML = formatTemplatePreview(tpl.text, vars);
    }

    function copyTemplateText(tplId) {
        const templates = dataCache['message-templates']?.templates || [];
        const tpl = templates.find(t => t.id === tplId);
        if (!tpl) return;
        const vars = {};
        document.querySelectorAll('.tpl-var').forEach(input => { vars[input.dataset.var] = input.value; });
        const text = tpl.text.replace(/\{\{(\w+)\}\}/g, (m, key) => vars[key] || `{{${key}}}`);
        copyText(text);
    }

    window.CopilotPage.copyTemplateText = copyTemplateText;

    // ─── MODULE 5: Debrief ──────────────────────────────────────────────────

    function renderDebrief(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>📊 ДЕБРИФІНГ ДЗВІНКА <span class="module-badge">МОДУЛЬ 5</span></h2>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Клієнт</label>
                    <input type="text" id="debClientName" class="copilot-input" placeholder="Ім'я або компанія">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Тривалість (хв)</label>
                    <input type="number" id="debDuration" class="copilot-input" placeholder="15" min="1" max="180">
                </div>
            </div>

            <div class="form-group">
                <label class="copilot-label">Результат дзвінка</label>
                <div class="radio-group" id="debResultGroup">
                    <label class="radio-option" onclick="this.parentElement.querySelectorAll('.radio-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');">
                        <input type="radio" name="debResult" value="hot"> 🔥 Гарячий — призначена демо
                    </label>
                    <label class="radio-option" onclick="this.parentElement.querySelectorAll('.radio-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');">
                        <input type="radio" name="debResult" value="interested"> ✅ Зацікавлений — думає
                    </label>
                    <label class="radio-option" onclick="this.parentElement.querySelectorAll('.radio-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');">
                        <input type="radio" name="debResult" value="callback"> 📅 Передзвонити пізніше
                    </label>
                    <label class="radio-option" onclick="this.parentElement.querySelectorAll('.radio-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');">
                        <input type="radio" name="debResult" value="rejected"> ❌ Відмовив
                    </label>
                </div>
            </div>

            <div class="form-group">
                <label class="copilot-label">Що обговорювали</label>
                <textarea id="debNotes" class="copilot-textarea" rows="4" placeholder="Основні теми, заперечення, реакція клієнта..."></textarea>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Що спрацювало добре</label>
                    <textarea id="debWorked" class="copilot-textarea" rows="2" placeholder="..."></textarea>
                </div>
                <div class="form-group">
                    <label class="copilot-label">Що зробив би інакше</label>
                    <textarea id="debImprove" class="copilot-textarea" rows="2" placeholder="..."></textarea>
                </div>
            </div>

            <div class="form-group">
                <label class="copilot-label">Головне заперечення</label>
                <select id="debObjection" class="copilot-select">
                    <option value="">— не було / не вказано —</option>
                    <option value="expensive">💸 Ціна / дорого</option>
                    <option value="not_needed">🤔 Нам не потрібно</option>
                    <option value="has_solution">💼 Є своє рішення</option>
                    <option value="need_to_think">⏳ Потрібно подумати</option>
                    <option value="no_budget">📅 Немає бюджету</option>
                    <option value="need_approval">👥 Треба погодити</option>
                    <option value="too_complex">🔧 Складно</option>
                </select>
            </div>

            <button class="btn-gold" id="debBtn" onclick="CopilotPage.runDebrief()">
                🤖 Аналізувати дзвінок
            </button>
        </div>

        <div id="debResult" class="hidden"></div>`;
    }

    async function runDebrief() {
        const btn = document.getElementById('debBtn');
        const notes = document.getElementById('debNotes')?.value?.trim();
        if (!notes) { showError('Заповніть нотатки про дзвінок'); return; }

        const callResult = document.querySelector('input[name="debResult"]:checked')?.value || 'interested';

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Аналізую...'; }

        try {
            const data = await apiPost('/api/copilot/debrief', {
                clientName: document.getElementById('debClientName')?.value || 'Невідомий',
                callResult,
                durationMin: parseInt(document.getElementById('debDuration')?.value || 0),
                notes,
                mainObjection: document.getElementById('debObjection')?.value || '',
                whatWorked: document.getElementById('debWorked')?.value || '',
                whatImprove: document.getElementById('debImprove')?.value || ''
            });

            if (!data.success) throw new Error(data.error);

            const resultDiv = document.getElementById('debResult');
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                const score = data.score || 0;
                const fillWidth = (score / 10 * 100).toFixed(0);

                resultDiv.innerHTML = `
                <div class="copilot-card" style="border-color:var(--gold-border);">
                    <h2>📊 АНАЛІЗ ДЗВІНКА</h2>

                    <div class="score-bar-wrap" style="margin-bottom:16px;">
                        <div class="score-number">${score}/10</div>
                        <div class="score-bar"><div class="score-bar-fill" style="width:${fillWidth}%"></div></div>
                    </div>

                    ${(data.good || []).length ? `
                        <div style="margin-bottom:12px;">
                            <h4 style="font-size:12px;color:var(--success-color);text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px;">✅ Що зроблено добре</h4>
                            ${data.good.map(g => `<div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">• ${escHtml(g)}</div>`).join('')}
                        </div>
                    ` : ''}

                    ${(data.improve || []).length ? `
                        <div style="margin-bottom:12px;">
                            <h4 style="font-size:12px;color:var(--warning-color);text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px;">📈 Що покращити</h4>
                            ${data.improve.map(i => `<div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">• ${escHtml(i)}</div>`).join('')}
                        </div>
                    ` : ''}

                    ${data.nextStep ? `
                        <div class="ai-meta-item" style="background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:8px;padding:10px;">
                            <span class="label">➡️</span>
                            <span class="content" style="color:#fff;"><b>Наступний крок:</b> ${escHtml(data.nextStep)}</span>
                        </div>
                    ` : ''}

                    <div class="flex-row" style="margin-top:16px;">
                        <button class="btn-gold" onclick="CopilotPage.saveDebrief(${score}, ${JSON.stringify(JSON.stringify({ good: data.good, improve: data.improve, nextStep: data.nextStep }))})">
                            📝 Зберегти в CRM
                        </button>
                    </div>
                </div>`;
            }
        } catch (e) {
            showError('Помилка аналізу: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🤖 Аналізувати дзвінок'; }
        }
    }

    async function saveDebrief(score, analysisJson) {
        try {
            const analysis = JSON.parse(analysisJson);
            const callResult = document.querySelector('input[name="debResult"]:checked')?.value || 'interested';
            const data = await apiPost('/api/copilot/debrief/save', {
                clientName: document.getElementById('debClientName')?.value || '',
                callResult,
                durationMin: parseInt(document.getElementById('debDuration')?.value || 0),
                notes: document.getElementById('debNotes')?.value || '',
                mainObjection: document.getElementById('debObjection')?.value || '',
                whatWorked: document.getElementById('debWorked')?.value || '',
                whatImprove: document.getElementById('debImprove')?.value || '',
                aiScore: score,
                aiAnalysis: analysis,
                nextStep: analysis.nextStep || ''
            });
            if (data.success) showToast('✅ Дебрифінг збережено в CRM!');
        } catch (e) {
            showError('Помилка збереження: ' + e.message);
        }
    }

    // ─── MODULE 6: Sales Academy ────────────────────────────────────────────

    function renderAcademy(container) {
        const academy = dataCache['sales-academy'] || {};
        const methodology = dataCache['sales-methodology']?.methodologies || [];
        const profiles = dataCache['buyer-profiles']?.profiles || [];
        const sections = academy.sections || [];

        container.innerHTML = `
        <div class="copilot-card">
            <h2>📚 SALES ACADEMY <span class="module-badge">МОДУЛЬ 6</span></h2>
            <div class="copilot-tabs" id="academyTabs">
                ${sections.map((s, i) => `
                    <div class="copilot-tab ${i===0?'active':''}" onclick="CopilotPage.switchAcademyTab('${s.id}', this)">${s.icon} ${s.title.split(' ').slice(1).join(' ')}</div>
                `).join('')}
                <div class="copilot-tab" onclick="CopilotPage.switchAcademyTab('qa', this)">❓ Q&A з AI</div>
            </div>
            <div id="academyContent"></div>
        </div>`;

        // Render first section
        if (sections.length) renderAcademySection(sections[0], container);

        window.CopilotPage.switchAcademyTab = (id, el) => {
            document.querySelectorAll('.copilot-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            if (id === 'qa') renderAcademyQA();
            else {
                const sec = sections.find(s => s.id === id);
                if (sec) renderAcademySection(sec, null);
            }
        };
    }

    function renderAcademySection(section, _container) {
        const content = document.getElementById('academyContent');
        if (!content) return;

        content.innerHTML = `
        <div style="margin-top:16px;">
            ${(section.items || []).map(item => `
                <div class="accordion-item">
                    <div class="accordion-header" onclick="CopilotPage.toggleAccordion(this)">
                        <span>${escHtml(item.title)}</span>
                        <span class="accordion-chevron">▾</span>
                    </div>
                    <div class="accordion-body">
                        <div style="font-size:14px;line-height:1.7;color:var(--text-dim);white-space:pre-line;">${escHtml(item.content || item.summary || '')}</div>
                        ${item.key_phrase ? `<div style="margin-top:10px;font-size:13px;font-style:italic;color:var(--gold);border-left:2px solid var(--gold);padding-left:10px;">"${escHtml(item.key_phrase)}"</div>` : ''}
                        ${item.use_when ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">📍 Коли застосовувати: ${escHtml(item.use_when)}</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>`;
    }

    function renderAcademyQA() {
        const content = document.getElementById('academyContent');
        if (!content) return;
        const academy = dataCache['sales-academy'] || {};
        const quickQuestions = academy.quick_questions || [];

        content.innerHTML = `
        <div style="margin-top:16px;">
            <div class="form-group">
                <label class="copilot-label">Задай питання Sales AI</label>
                <div class="flex-row">
                    <textarea id="academyQuestion" class="copilot-textarea" rows="2" placeholder="Як відповісти якщо клієнт каже..."></textarea>
                </div>
                <div class="flex-row" style="margin-top:8px;">
                    <button class="btn-gold" onclick="CopilotPage.runAcademyQA()">💡 Запитати</button>
                </div>
            </div>

            ${quickQuestions.length ? `
                <div>
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Швидкі запити:</div>
                    <div class="flex-wrap">
                        ${quickQuestions.map(q => `
                            <button class="btn-ghost" style="font-size:12px;" onclick="document.getElementById('academyQuestion').value=${JSON.stringify(q)}">${escHtml(q)}</button>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <div id="academyQAResult" class="hidden" style="margin-top:16px;"></div>
        </div>`;
    }

    async function runAcademyQA() {
        const question = document.getElementById('academyQuestion')?.value?.trim();
        const result = document.getElementById('academyQAResult');
        if (!question || !result) return;

        result.classList.remove('hidden');
        result.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px;color:var(--text-muted);"><div class="spinner spinner-light"></div> AI аналізує питання...</div>`;

        try {
            const data = await apiPost('/api/copilot/sales-qa', { question });
            if (!data.success) throw new Error(data.error);

            result.innerHTML = `
            <div class="ai-response-block">
                <h4>💡 ВІДПОВІДЬ SALES AI</h4>
                <div style="font-size:14px;line-height:1.7;color:#fff;white-space:pre-line;">${escHtml(data.answer)}</div>
            </div>`;
        } catch (e) {
            result.innerHTML = `<div style="color:var(--danger-color);">Помилка: ${escHtml(e.message)}</div>`;
        }
    }

    // ─── MODULE 7: Interaction Tracker ──────────────────────────────────────

    async function renderTracker(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>📡 МОНІТОРИНГ ВЗАЄМОДІЙ <span class="module-badge">МОДУЛЬ 7</span></h2>
            <div class="flex-row" style="flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                <select id="trackerType" class="copilot-select" style="width:auto;" onchange="CopilotPage.loadTracker()">
                    <option value="">Всі типи</option>
                    <option value="call">📞 Дзвінки</option>
                    <option value="message_sent">📧 Повідомлення</option>
                    <option value="debrief">📊 Дебрифінги</option>
                    <option value="status_change">🔄 Зміни статусу</option>
                    <option value="note">📝 Нотатки</option>
                </select>
                <input type="date" id="trackerFrom" class="copilot-input" style="width:auto;" onchange="CopilotPage.loadTracker()">
                <button class="btn-gold" onclick="CopilotPage.showAddInteractionForm()">+ Додати нотатку</button>
                <button class="btn-ghost" onclick="CopilotPage.loadTrackerAlerts()">⚠️ Алерти</button>
            </div>
            <div id="trackerList"><div style="color:var(--text-muted);text-align:center;padding:40px;">Завантаження...</div></div>
        </div>

        <div id="trackerAlertsDiv" class="hidden">
            <div class="copilot-card" style="border-color:var(--danger-color);">
                <h2 style="color:var(--danger-color);">⚠️ ЛІДИ БЕЗ КОНТАКТУ</h2>
                <div id="trackerAlertsList"></div>
            </div>
        </div>

        <div id="addInteractionForm" class="hidden">
            <div class="copilot-card">
                <h2>+ Додати взаємодію</h2>
                <div class="form-row">
                    <div class="form-group">
                        <label class="copilot-label">ID Ліда</label>
                        <input type="number" id="intLeadId" class="copilot-input" placeholder="123">
                    </div>
                    <div class="form-group">
                        <label class="copilot-label">Тип</label>
                        <select id="intType" class="copilot-select">
                            <option value="call">📞 Дзвінок</option>
                            <option value="note">📝 Нотатка</option>
                            <option value="message_sent">📧 Повідомлення</option>
                            <option value="meeting">🤝 Зустріч</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="copilot-label">Опис</label>
                    <textarea id="intSummary" class="copilot-textarea" rows="2" placeholder="Що відбулось..."></textarea>
                </div>
                <div class="form-group">
                    <label class="copilot-label">Follow-up дата</label>
                    <input type="date" id="intFollowup" class="copilot-input">
                </div>
                <div class="flex-row">
                    <button class="btn-gold" onclick="CopilotPage.addManualInteraction()">Зберегти</button>
                    <button class="btn-ghost" onclick="document.getElementById('addInteractionForm').classList.add('hidden')">Скасувати</button>
                </div>
            </div>
        </div>`;

        loadTracker();
    }

    async function loadTracker() {
        const list = document.getElementById('trackerList');
        if (!list) return;

        const type = document.getElementById('trackerType')?.value || '';
        const from = document.getElementById('trackerFrom')?.value || '';
        let url = '/api/copilot/interactions?limit=30';
        if (type) url += `&type=${type}`;
        if (from) url += `&from=${from}`;

        try {
            const data = await apiGet(url);
            if (!data.success) { list.innerHTML = '<div style="color:var(--danger-color);padding:20px;">Помилка завантаження</div>'; return; }

            const interactions = data.interactions || [];
            if (!interactions.length) {
                list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">Взаємодій ще немає</div>';
                return;
            }

            const typeIcons = { call: '📞', message_sent: '📧', debrief: '📊', status_change: '🔄', note: '📝', meeting: '🤝', meeting_prep: '🔮', message_draft: '✍️', landing_submission: '🌐' };
            const badgeClasses = { call: 'badge-call', message_sent: 'badge-message', debrief: 'badge-debrief', note: 'badge-note', status_change: 'badge-status' };

            list.innerHTML = interactions.map(i => `
                <div class="interaction-item">
                    <div class="interaction-icon" style="background:var(--glass-bg);">${typeIcons[i.type] || '📌'}</div>
                    <div class="interaction-body">
                        <div class="interaction-header">
                            <span class="interaction-client">${escHtml(i.lead_name || 'Невідомий')}</span>
                            <span class="interaction-time">${formatDateTime(i.created_at)}</span>
                        </div>
                        <div class="interaction-summary">${escHtml(i.summary || '')}</div>
                        <div style="margin-top:4px;display:flex;align-items:center;gap:8px;">
                            <span class="interaction-badge ${badgeClasses[i.type] || 'badge-note'}">${i.type}</span>
                            ${i.manager_name ? `<span style="font-size:11px;color:var(--text-muted);">👤 ${escHtml(i.manager_name)}</span>` : ''}
                            ${i.follow_up_date && !i.follow_up_done ? `<span style="font-size:11px;color:var(--warning-color);">⏰ Follow-up: ${i.follow_up_date} <button class="btn-icon" style="font-size:10px;" onclick="CopilotPage.markFollowupDone(${i.id})">✓</button></span>` : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<div style="color:var(--danger-color);padding:20px;">Помилка: ${escHtml(e.message)}</div>`;
        }
    }

    async function loadTrackerAlerts() {
        const div = document.getElementById('trackerAlertsDiv');
        const list = document.getElementById('trackerAlertsList');
        if (!div || !list) return;
        div.classList.remove('hidden');

        try {
            const data = await apiGet('/api/copilot/interactions/alerts');
            const alerts = data.alerts || [];

            list.innerHTML = alerts.map(a => {
                const days = Math.round(a.days_ago || 0);
                const cls = days >= 7 ? 'critical' : (days >= 3 ? 'warning' : '');
                return `
                <div class="alert-item ${cls}">
                    <div>
                        <div style="font-weight:600;color:#fff;">${escHtml(a.client_name)}</div>
                        <div style="font-size:12px;color:var(--text-muted);">${escHtml(a.manager_name) || '—'} • ${escHtml(a.status)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:13px;font-weight:600;color:${days>=7?'var(--danger-color)':'var(--warning-color)'};">${days} днів без контакту</div>
                    </div>
                </div>`;
            }).join('') || '<div style="color:var(--text-muted);padding:20px;text-align:center;">Всі ліди в нормі ✅</div>';
        } catch (e) {
            list.innerHTML = `<div style="color:var(--danger-color);">Помилка: ${escHtml(e.message)}</div>`;
        }
    }

    function showAddInteractionForm() {
        document.getElementById('addInteractionForm')?.classList.remove('hidden');
    }

    async function markFollowupDone(id) {
        try {
            await fetch(`/api/copilot/interactions/${id}/followup`, { method: 'PATCH', headers: authHeaders() });
            showToast('✅ Follow-up виконано!');
            loadTracker();
        } catch (e) { showError('Помилка: ' + e.message); }
    }

    async function addManualInteraction() {
        const leadId = document.getElementById('intLeadId')?.value;
        const type = document.getElementById('intType')?.value;
        const summary = document.getElementById('intSummary')?.value?.trim();
        const followUpDate = document.getElementById('intFollowup')?.value;

        if (!leadId || !type || !summary) { showError('Заповніть всі обов\'язкові поля'); return; }

        try {
            const data = await apiPost('/api/copilot/interactions', { leadId: parseInt(leadId), type, summary, followUpDate });
            if (data.success) {
                showToast('✅ Взаємодію збережено!');
                document.getElementById('addInteractionForm')?.classList.add('hidden');
                loadTracker();
            }
        } catch (e) { showError('Помилка: ' + e.message); }
    }

    // ─── MODULE 8: Battle Cards ──────────────────────────────────────────────

    function renderBattleCards(container) {
        const cards = dataCache['battle-cards']?.cards || [];

        container.innerHTML = `
        <div class="copilot-card">
            <h2>🃏 КОНКУРЕНТНІ BATTLE CARDS <span class="module-badge">МОДУЛЬ 8</span></h2>

            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="bcSearch" class="copilot-input" placeholder="Пошук: 'excel', 'yclients', 'дешевше'..."
                    oninput="CopilotPage.filterBattleCards(this.value)">
            </div>

            <div id="battleCardsList">
                ${cards.map(card => `
                    <div class="accordion-item" data-keywords="${(card.keywords || []).join(',')}">
                        <div class="accordion-header" onclick="CopilotPage.toggleAccordion(this)">
                            <div class="battle-card-header">
                                <span style="font-size:20px;">${card.emoji}</span>
                                <span>${escHtml(card.title)}</span>
                            </div>
                            <span class="accordion-chevron">▾</span>
                        </div>
                        <div class="accordion-body">
                            <div class="battle-card-body">
                                <div class="competitor-strength">⚔️ Їх аргумент: ${escHtml(card.competitor_strength)}</div>
                                <div class="our-argument">${escHtml(card.our_argument)}</div>
                                <div class="killer-q">${escHtml(card.killer_question)}</div>
                                <div class="avoid-text">⚠️ ${escHtml(card.avoid)}</div>
                                ${(card.differentiators || []).length ? `
                                    <div style="margin-top:10px;">
                                        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Наші переваги</div>
                                        ${card.differentiators.map(d => `<div style="font-size:13px;color:var(--text-dim);margin-bottom:3px;">✅ ${escHtml(d)}</div>`).join('')}
                                    </div>
                                ` : ''}
                                <button class="btn-ghost" style="margin-top:10px;" onclick="CopilotPage.copyText(${JSON.stringify(card.killer_question)})">📋 Копіювати killer question</button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;

        window.CopilotPage.filterBattleCards = (query) => {
            const q = query.toLowerCase();
            document.querySelectorAll('#battleCardsList .accordion-item').forEach(item => {
                const kws = (item.dataset.keywords || '').toLowerCase();
                item.style.display = !q || kws.includes(q) ? '' : 'none';
            });
        };
    }

    // ─── MODULE 9: Meeting Prep ──────────────────────────────────────────────

    function renderMeetingPrep(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>🔮 MEETING PREP <span class="module-badge">МОДУЛЬ 9</span></h2>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">За 5 хвилин до дзвінка — заповни і отримай персональний бриф</p>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Компанія / ім'я клієнта</label>
                    <input type="text" id="prepClient" class="copilot-input" placeholder="Школа 'Сонечко', 9 філій">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Тип дзвінка</label>
                    <select id="prepCallType" class="copilot-select">
                        <option value="first">Перший дзвінок</option>
                        <option value="demo">Онлайн-демо</option>
                        <option value="closing">Закриття угоди</option>
                        <option value="follow-up">Follow-up</option>
                    </select>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Джерело контакту</label>
                    <select id="prepSource" class="copilot-select">
                        <option value="landing">Лендінг</option>
                        <option value="referral">Рекомендація</option>
                        <option value="cold">Холодний</option>
                        <option value="social">Соцмережі</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="copilot-label">Розмір бізнесу</label>
                    <input type="text" id="prepSize" class="copilot-input" placeholder="3 кімнати, 5 осіб команди">
                </div>
            </div>

            <div class="form-group">
                <label class="copilot-label">Що знаємо про клієнта</label>
                <textarea id="prepNotes" class="copilot-textarea" rows="2" placeholder="Попередні розмови, болі, інтереси..."></textarea>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Пакет що цікавить</label>
                    <select id="prepPackage" class="copilot-select">
                        <option value="unknown">Невідомо</option>
                        <option value="basic">Базовий (2,000 ₴/міс)</option>
                        <option value="full">Повний (21,000 ₴/міс)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="copilot-label">Попереднє спілкування</label>
                    <input type="text" id="prepPrevContact" class="copilot-input" placeholder="Ні / дзвінок 5.03...">
                </div>
            </div>

            <button class="btn-gold" id="prepBtn" onclick="CopilotPage.runMeetingPrep()">
                🔮 Підготувати бриф
            </button>
        </div>

        <div id="prepResult" class="hidden"></div>`;
    }

    async function runMeetingPrep() {
        const btn = document.getElementById('prepBtn');
        const clientName = document.getElementById('prepClient')?.value?.trim();
        if (!clientName) { showError('Введіть назву клієнта'); return; }

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Генерую бриф...'; }

        try {
            const data = await apiPost('/api/copilot/meeting-prep', {
                clientName,
                source: document.getElementById('prepSource')?.value || 'landing',
                businessSize: document.getElementById('prepSize')?.value || '',
                notes: document.getElementById('prepNotes')?.value || '',
                package: document.getElementById('prepPackage')?.value || 'unknown',
                previousContact: document.getElementById('prepPrevContact')?.value || 'Ні',
                callType: document.getElementById('prepCallType')?.value || 'first'
            });

            if (!data.success) throw new Error(data.error);
            const brief = data.brief || {};

            const resultDiv = document.getElementById('prepResult');
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                resultDiv.innerHTML = `
                <div class="copilot-card" style="border-color:var(--gold-border);">
                    <h2>🎯 БРИФ: ${escHtml(clientName)}</h2>

                    ${brief.focus ? `
                        <div style="background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:8px;padding:12px;margin-bottom:16px;">
                            <div style="font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">🎯 ФОКУС</div>
                            <div style="font-size:14px;color:#fff;">${escHtml(brief.focus)}</div>
                        </div>
                    ` : ''}

                    ${brief.openingQuestion ? `
                        <div class="ai-meta-item" style="margin-bottom:12px;">
                            <span class="label">❓</span>
                            <span class="content"><b>Перше питання:</b> ${escHtml(brief.openingQuestion)}</span>
                        </div>
                    ` : ''}

                    ${(brief.killerQuestions || []).length ? `
                        <div style="margin-bottom:14px;">
                            <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">💡 KILLER QUESTIONS</div>
                            ${brief.killerQuestions.map(q => `<div style="font-size:13px;color:var(--text-dim);margin-bottom:6px;padding-left:14px;border-left:2px solid var(--gold-border);">• ${escHtml(q)}</div>`).join('')}
                        </div>
                    ` : ''}

                    ${(brief.likelyObjections || []).length ? `
                        <div style="margin-bottom:14px;">
                            <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">🛡️ ЙМОВІРНІ ЗАПЕРЕЧЕННЯ</div>
                            ${brief.likelyObjections.map(o => `
                                <div style="background:rgba(0,0,0,.2);border-radius:6px;padding:10px;margin-bottom:8px;">
                                    <div style="font-size:13px;color:var(--danger-color);margin-bottom:4px;">❌ ${escHtml(o.objection)}</div>
                                    <div style="font-size:13px;color:var(--text-dim);">✅ ${escHtml(o.response)}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
                        ${brief.callGoal ? `<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:8px;padding:10px;"><div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">🏁 ЦІЛЬ</div><div style="font-size:13px;color:#fff;">${escHtml(brief.callGoal)}</div></div>` : ''}
                        ${brief.potentialValue ? `<div style="background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:8px;padding:10px;"><div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">💰 ПОТЕНЦІАЛ</div><div style="font-size:13px;color:var(--gold);">${escHtml(brief.potentialValue)}</div></div>` : ''}
                    </div>
                </div>`;
            }
        } catch (e) {
            showError('Помилка Meeting Prep: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🔮 Підготувати бриф'; }
        }
    }

    // ─── MODULE 10: Deal Pipeline ────────────────────────────────────────────

    async function renderPipeline(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>📈 DEAL PIPELINE <span class="module-badge">МОДУЛЬ 10</span></h2>
            <div id="pipelineStats" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:13px;color:var(--text-muted);">
                <div class="spinner spinner-light" style="margin:8px 0;"></div>
            </div>
            <div id="pipelineBoard">
                <div style="color:var(--text-muted);text-align:center;padding:40px;">Завантаження...</div>
            </div>
        </div>`;

        loadPipeline();
    }

    async function loadPipeline() {
        try {
            const data = await apiGet('/api/copilot/pipeline/stats');
            if (!data.success) return;

            const leads = data.leads || [];
            const stats = data.stats || {};

            const statsDiv = document.getElementById('pipelineStats');
            if (statsDiv) {
                const total = leads.reduce((sum, l) => sum + 1, 0);
                statsDiv.innerHTML = `
                    <span>🆕 Нові: <b>${stats.new_count || 0}</b></span>
                    <span>📞 Контакт: <b>${stats.contact_count || 0}</b></span>
                    <span>🖥️ Демо: <b>${stats.demo_count || 0}</b></span>
                    <span>🤝 Переговори: <b>${stats.negotiation_count || 0}</b></span>
                    <span>✅ Закрито: <b>${stats.closed_count || 0}</b></span>
                    <span style="color:var(--gold);">Всього активних: <b>${total}</b></span>
                `;
            }

            const STAGES = [
                { id: 'new',         label: '🆕 Нові',         color: '#64748b' },
                { id: 'contact',     label: '📞 Контакт',      color: '#6366f1' },
                { id: 'demo',        label: '🖥️ Демо',          color: '#f59e0b' },
                { id: 'negotiation', label: '🤝 Переговори',   color: '#22c55e' },
                { id: 'closed',      label: '✅ Закрито',       color: '#10b981' },
            ];

            const board = document.getElementById('pipelineBoard');
            if (!board) return;

            board.innerHTML = `
                <div class="pipeline-header">
                    ${STAGES.map(s => `<div class="pipeline-header-col" style="border-color:${s.color}33;">${s.label}</div>`).join('')}
                </div>
                <div class="pipeline-board" id="kanbanBoard">
                    ${STAGES.map(s => `
                        <div class="pipeline-col" id="col-${s.id}"
                            ondragover="event.preventDefault();this.classList.add('drag-over');"
                            ondragleave="this.classList.remove('drag-over');"
                            ondrop="CopilotPage.onDrop(event, '${s.id}')">
                            ${leads.filter(l => l.status === s.id).map(l => renderDealCard(l)).join('')}
                            ${leads.filter(l => l.status === s.id).length === 0 ?
                                `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;opacity:.5;">Порожньо</div>` : ''}
                        </div>
                    `).join('')}
                </div>`;

            window.CopilotPage.onDrop = async (event, newStatus) => {
                event.currentTarget.classList.remove('drag-over');
                const leadId = event.dataTransfer.getData('leadId');
                if (!leadId) return;
                try {
                    await fetch(`/api/leads/${leadId}`, {
                        method: 'PATCH',
                        headers: authHeaders(),
                        body: JSON.stringify({ status: newStatus })
                    });
                    loadPipeline();
                } catch (e) { showError('Помилка переміщення: ' + e.message); }
            };
        } catch (e) {
            const board = document.getElementById('pipelineBoard');
            if (board) board.innerHTML = `<div style="color:var(--danger-color);padding:20px;">Помилка: ${escHtml(e.message)}</div>`;
        }
    }

    function renderDealCard(lead) {
        const days = lead.updated_at ? Math.round((Date.now() - new Date(lead.updated_at)) / 86400000) : 0;
        const daysCls = days >= 7 ? 'deal-days-red' : (days >= 3 ? 'deal-days-yellow' : 'deal-days-green');

        return `
        <div class="deal-card" draggable="true"
            ondragstart="event.dataTransfer.setData('leadId','${lead.id}');this.classList.add('dragging');"
            ondragend="this.classList.remove('dragging');">
            <div class="deal-card-title">${escHtml(lead.client_name)}</div>
            <div class="deal-card-meta">${escHtml(lead.manager_name || '—')}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                <span class="deal-days-badge ${daysCls}">${days}д</span>
                <a href="/sales-funnel" style="font-size:11px;color:var(--text-muted);text-decoration:none;">→ Відкрити</a>
            </div>
        </div>`;
    }

    // ─── MODULE 11: AI Message Writer ────────────────────────────────────────

    function renderWriter(container) {
        container.innerHTML = `
        <div class="copilot-card">
            <h2>✍️ AI MESSAGE WRITER <span class="module-badge">МОДУЛЬ 11</span></h2>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Клієнт</label>
                    <input type="text" id="writerClient" class="copilot-input" placeholder="Іванченко Олег">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Тип повідомлення</label>
                    <select id="writerType" class="copilot-select">
                        <option value="after-call">Після першого дзвінка</option>
                        <option value="follow-up">Follow-up після мовчання</option>
                        <option value="after-demo">Після онлайн-демо</option>
                        <option value="reminder">Нагадування про рішення</option>
                        <option value="reactivation">Реактивація холодного</option>
                        <option value="closing">Підтвердження угоди</option>
                        <option value="after-rejection">Після відмови</option>
                    </select>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Що обговорювали</label>
                    <input type="text" id="writerTopics" class="copilot-input" placeholder="подвійне бронювання, ціна, пакет базовий">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Що зацікавило найбільше</label>
                    <input type="text" id="writerInterest" class="copilot-input" placeholder="AI-дворецький Клешня">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Що хвилює клієнта</label>
                    <input type="text" id="writerConcerns" class="copilot-input" placeholder="чи команда розбереться">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Результат розмови</label>
                    <select id="writerResult" class="copilot-select">
                        <option value="interested">Зацікавлений, думає</option>
                        <option value="hot">Гарячий — майже готові</option>
                        <option value="callback">Передзвонити пізніше</option>
                        <option value="cold">Холодний</option>
                    </select>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="copilot-label">Наступний крок</label>
                    <input type="text" id="writerNextStep" class="copilot-input" placeholder="follow-up через 3 дні">
                </div>
                <div class="form-group">
                    <label class="copilot-label">Тон</label>
                    <select id="writerTone" class="copilot-select">
                        <option value="friendly">Дружній</option>
                        <option value="business">Діловий</option>
                        <option value="light">Легкий</option>
                    </select>
                </div>
            </div>

            <button class="btn-gold" id="writerBtn" onclick="CopilotPage.runMessageWriter()">
                ✍️ Написати повідомлення
            </button>
        </div>

        <div id="writerResult" class="hidden"></div>`;
    }

    async function runMessageWriter() {
        const btn = document.getElementById('writerBtn');
        const clientName = document.getElementById('writerClient')?.value?.trim();
        if (!clientName) { showError('Введіть ім\'я клієнта'); return; }

        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Пишу повідомлення...'; }

        try {
            const data = await apiPost('/api/copilot/write-message', {
                clientName,
                messageType: document.getElementById('writerType')?.value || 'after-call',
                discussedTopics: document.getElementById('writerTopics')?.value || '',
                mainInterest: document.getElementById('writerInterest')?.value || '',
                concerns: document.getElementById('writerConcerns')?.value || '',
                callResult: document.getElementById('writerResult')?.value || 'interested',
                nextStep: document.getElementById('writerNextStep')?.value || '',
                tone: document.getElementById('writerTone')?.value || 'friendly'
            });

            if (!data.success) throw new Error(data.error);

            const resultDiv = document.getElementById('writerResult');
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                resultDiv.innerHTML = `
                <div class="copilot-card" style="border-color:var(--gold-border);">
                    <h4 style="color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 14px;">✍️ ПОВІДОМЛЕННЯ</h4>
                    <div id="writerMessageText" class="template-preview" contenteditable="true" style="min-height:120px;">${escHtml(data.message).replace(/\n/g, '<br>')}</div>
                    <div class="flex-row" style="margin-top:14px;">
                        <button class="btn-gold" onclick="CopilotPage.copyMessage()">📋 Копіювати</button>
                        <button class="btn-ghost" onclick="CopilotPage.resendWriter()">🔄 Переписати</button>
                    </div>
                </div>`;
            }
        } catch (e) {
            showError('Помилка Writer: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '✍️ Написати повідомлення'; }
        }
    }

    function copyMessage() {
        const el = document.getElementById('writerMessageText');
        if (el) copyText(el.innerText || el.textContent);
    }

    function resendWriter() {
        runMessageWriter();
    }

    // ─── Common utilities ────────────────────────────────────────────────────

    function toggleAccordion(header) {
        header.classList.toggle('open');
        const body = header.nextElementSibling;
        if (body) body.classList.toggle('open');
    }

    function copyText(text) {
        navigator.clipboard.writeText(text).then(() => showToast('📋 Скопійовано!')).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('📋 Скопійовано!');
        });
    }

    window.CopilotPage.copyText = copyText;

    function showToast(msg) {
        const el = document.getElementById('copiedFlash');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        el.style.display = 'block';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.display = 'none'; }, 2000);
    }

    function showError(msg) {
        showToast('❌ ' + msg);
    }

    function escHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatDateTime(dt) {
        if (!dt) return '—';
        const d = new Date(dt);
        const now = new Date();
        const diff = now - d;
        if (diff < 3600000) return `${Math.round(diff/60000)} хв тому`;
        if (diff < 86400000) return `${Math.round(diff/3600000)} год тому`;
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    // ─── Start ───────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 300); // Wait for auth.js to init
    }

    return { init, switchModule };
})();
