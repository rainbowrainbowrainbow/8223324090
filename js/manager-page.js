/**
 * js/manager-page.js — Manager AI Copilot frontend
 * v27.0.0: 11 modules — Coach, Objections, Scripts, Templates, Debrief,
 *          Academy, Interactions, Battle Cards, Meeting Prep, Pipeline, Writer
 */

// ==========================================
// STATE
// ==========================================
let _mgrUser = null;
let _liveMode = false;
let _liveDebounceTimer = null;
let _currentModule = 'coach';
let _lastCoachResult = null;

// Static data (loaded once)
let _objections = null;
let _battleCards = null;
let _callScripts = null;
let _msgTemplates = null;
let _salesAcademy = null;
let _salesMethodology = null;
let _buyerProfiles = null;

// Script state
let _currentScript = null;
let _currentStep = 0;

// Debrief state
let _lastDebriefAnalysis = null;
let _selectedDebriefResult = null;
let _selectedDebriefObjection = null;

// ==========================================
// UTILITIES
// ==========================================
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type) {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Скопійовано!')).catch(() => {});
}

function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

function formatTime(d) {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// ==========================================
// PAGE INIT
// ==========================================
async function initManagerPage() {
    // Dark mode
    if (typeof initDarkMode === 'function') initDarkMode();

    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    const user = typeof apiVerifyToken === 'function' ? await apiVerifyToken() : null;
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    _mgrUser = user;
    document.getElementById('mainApp').style.display = '';
    document.getElementById('currentUser').textContent = user.name || user.display_name || user.username;

    // Sidebar
    if (typeof Sidebar !== 'undefined') Sidebar.init('#sidebarLinks');

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        window.location = '/';
    });

    // Module navigation
    document.querySelectorAll('.mgr-sidebar-item[data-module]').forEach(item => {
        item.addEventListener('click', () => switchModule(item.dataset.module));
    });

    // Load static data
    loadStaticData();

    // Module 1: Coach bindings
    initCoach();
    // Module 5: Debrief bindings
    initDebrief();
    // Module 9: Meeting Prep bindings
    initMeetingPrep();
    // Module 11: Writer bindings
    initWriter();
}

function switchModule(module) {
    _currentModule = module;
    document.querySelectorAll('.mgr-sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.mgr-sidebar-item[data-module="${module}"]`)?.classList.add('active');
    document.querySelectorAll('.mgr-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${module}`)?.classList.add('active');

    // Lazy load module data
    if (module === 'objections' && _objections) renderObjections();
    if (module === 'scripts' && _callScripts) renderScriptTabs();
    if (module === 'templates' && _msgTemplates) renderTemplateTabs();
    if (module === 'academy') renderAcademy('methodology');
    if (module === 'battlecards' && _battleCards) renderBattleCards();
    if (module === 'interactions') loadInteractions();
    if (module === 'pipeline') loadPipeline();
}

// ==========================================
// STATIC DATA LOADER
// ==========================================
async function loadStaticData() {
    const files = [
        { key: '_objections', file: 'data/objections.json' },
        { key: '_battleCards', file: 'data/battle-cards.json' },
        { key: '_callScripts', file: 'data/call-scripts.json' },
        { key: '_msgTemplates', file: 'data/message-templates.json' },
        { key: '_salesAcademy', file: 'data/sales-academy.json' },
        { key: '_salesMethodology', file: 'data/sales-methodology.json' },
        { key: '_buyerProfiles', file: 'data/buyer-profiles.json' }
    ];

    for (const { key, file } of files) {
        try {
            const resp = await fetch(file);
            if (resp.ok) window[key] = await resp.json();
        } catch { /* silent */ }
    }

    // Set module variables from window
    _objections = window._objections;
    _battleCards = window._battleCards;
    _callScripts = window._callScripts;
    _msgTemplates = window._msgTemplates;
    _salesAcademy = window._salesAcademy;
    _salesMethodology = window._salesMethodology;
    _buyerProfiles = window._buyerProfiles;
}

// ==========================================
// MODULE 1: AI COACH
// ==========================================
function initCoach() {
    const btn = document.getElementById('coachBtn');
    const clearBtn = document.getElementById('coachClearBtn');
    const input = document.getElementById('coachInput');
    const toggle = document.getElementById('liveToggle');

    btn.addEventListener('click', requestCoach);
    clearBtn.addEventListener('click', () => {
        input.value = '';
        document.getElementById('coachResult').innerHTML = '';
        _lastCoachResult = null;
    });

    toggle.addEventListener('click', () => {
        _liveMode = !_liveMode;
        document.getElementById('liveDot').classList.toggle('active', _liveMode);
    });

    input.addEventListener('input', () => {
        if (!_liveMode) return;
        clearTimeout(_liveDebounceTimer);
        _liveDebounceTimer = setTimeout(() => {
            if (input.value.trim().length > 10) requestCoach();
        }, 800);
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
}

async function requestCoach() {
    const input = document.getElementById('coachInput');
    const text = input.value.trim();
    if (!text) return;

    const container = document.getElementById('coachResult');
    container.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI думає...</div>';

    const btn = document.getElementById('coachBtn');
    btn.disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/manager/coach`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                clientText: text,
                scenario: document.getElementById('coachScenario').value,
                tone: document.getElementById('coachTone').value
            })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();

        if (!data.success) {
            container.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error)}</div>`;
            return;
        }

        _lastCoachResult = data;
        renderCoachResult(data, container, text);
    } catch (err) {
        container.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка з\'єднання</div>';
    } finally {
        btn.disabled = false;
    }
}

function renderCoachResult(data, container, clientText) {
    let html = '<div class="mgr-ai-block">';
    html += '<div style="font-size:12px;font-weight:700;color:rgba(201,168,76,0.7);margin-bottom:12px">AI РЕКОМЕНДАЦІЯ</div>';

    if (data.suggestions && Array.isArray(data.suggestions)) {
        const types = { neutral: 'Нейтральний', confident: 'Впевнений', empathy: 'Емпатія' };
        data.suggestions.forEach((s, i) => {
            html += `<div class="mgr-suggestion" style="animation-delay:${i * 100}ms">
                <div class="mgr-suggestion-type">💬 Варіант ${i + 1} (${types[s.type] || s.type})</div>
                <div class="mgr-suggestion-text">${escHtml(s.text)}</div>
                <span class="mgr-suggestion-copy" onclick="copyToClipboard(${JSON.stringify(s.text).replace(/"/g, '&quot;')})">📋 Копіювати</span>
            </div>`;
        });
    } else if (data.raw) {
        html += `<div class="mgr-suggestion"><div class="mgr-suggestion-text">${escHtml(data.raw)}</div></div>`;
    }

    if (data.tactic) html += `<div class="mgr-tactic">🧭 <b>Тактика:</b> ${escHtml(data.tactic)}</div>`;
    if (data.avoid) {
        const avoids = Array.isArray(data.avoid) ? data.avoid : [data.avoid];
        html += `<div class="mgr-avoid">⚠️ <b>Уникай:</b> ${avoids.map(a => escHtml(a)).join('; ')}</div>`;
    }
    if (data.nextStep) html += `<div class="mgr-next-step">➡️ <b>Наступний крок:</b> ${escHtml(data.nextStep)}</div>`;

    html += `<div class="mgr-feedback-row">
        <button class="mgr-btn-feedback" onclick="sendFeedback(1, '${escHtml(clientText)}')">👍 Добре</button>
        <button class="mgr-btn-feedback" onclick="sendFeedback(-1, '${escHtml(clientText)}')">👎 Погано</button>
        <button class="mgr-btn mgr-btn-secondary mgr-btn-small" onclick="requestCoach()">🔄 Ще варіанти</button>
    </div>`;

    html += '</div>';
    container.innerHTML = html;
}

async function sendFeedback(rating, clientText) {
    try {
        await fetch(`${API_BASE}/manager/feedback`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                rating,
                clientText,
                scenario: document.getElementById('coachScenario').value,
                suggestion: _lastCoachResult?.suggestions?.[0]?.text || ''
            })
        });
        showToast(rating > 0 ? 'Дякую за відгук! 👍' : 'Зафіксовано, покращимо! 🙏');
    } catch { /* silent */ }
}

// ==========================================
// MODULE 2: OBJECTIONS
// ==========================================
function renderObjections(filter) {
    if (!_objections) return;
    const grid = document.getElementById('objectionsGrid');
    const search = (filter || document.getElementById('objectionSearch')?.value || '').toLowerCase();

    let html = '';
    for (const [key, obj] of Object.entries(_objections)) {
        const matchesSearch = !search || obj.title.toLowerCase().includes(search) ||
            obj.keywords.some(k => k.toLowerCase().includes(search));
        if (!matchesSearch) continue;

        html += `<div class="mgr-card" onclick="toggleObjection(this, '${key}')">
            <div class="mgr-card-icon">${obj.icon}</div>
            <div class="mgr-card-title">${escHtml(obj.title)}</div>
            <div class="mgr-card-desc">${obj.keywords.slice(0, 3).join(', ')}</div>
            <div class="mgr-card-detail">`;

        obj.responses.forEach(r => {
            html += `<div class="mgr-suggestion" style="margin-bottom:8px">
                <div class="mgr-suggestion-type">📌 ${escHtml(r.label)}</div>
                <div class="mgr-suggestion-text">${escHtml(r.text)}</div>
                <div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.4)">
                    🧭 ${escHtml(r.tactic)}<br>⚠️ ${escHtml(r.avoid)}
                </div>
                <span class="mgr-suggestion-copy" onclick="event.stopPropagation();copyToClipboard(${JSON.stringify(r.text).replace(/"/g, '&quot;')})">📋 Копіювати</span>
            </div>`;
        });

        html += '</div></div>';
    }

    grid.innerHTML = html || '<div class="mgr-empty"><div class="mgr-empty-icon">🔍</div>Нічого не знайдено</div>';

    // Search binding (once)
    const searchInput = document.getElementById('objectionSearch');
    if (searchInput && !searchInput._bound) {
        searchInput._bound = true;
        searchInput.addEventListener('input', () => renderObjections());
    }

    // AI custom objection
    const aiBtn = document.getElementById('objectionAIBtn');
    if (aiBtn && !aiBtn._bound) {
        aiBtn._bound = true;
        aiBtn.addEventListener('click', requestCustomObjection);
    }
}

function toggleObjection(el) {
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    } else {
        document.querySelectorAll('#objectionsGrid .mgr-card').forEach(c => c.classList.remove('expanded'));
        el.classList.add('expanded');
    }
}

async function requestCustomObjection() {
    const text = document.getElementById('customObjection').value.trim();
    if (!text) return;

    const container = document.getElementById('objectionAIResult');
    container.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI генерує відповідь...</div>';

    try {
        const resp = await fetch(`${API_BASE}/manager/objection`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ objectionText: text })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();
        if (data.success) {
            renderCoachResult(data, container, text);
        } else {
            container.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error)}</div>`;
        }
    } catch {
        container.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка</div>';
    }
}

// ==========================================
// MODULE 3: CALL SCRIPTS
// ==========================================
function renderScriptTabs() {
    if (!_callScripts) return;
    const tabs = document.getElementById('scriptTabs');
    tabs.innerHTML = _callScripts.map((s, i) =>
        `<div class="mgr-tab${i === 0 ? ' active' : ''}" onclick="selectScript(${i})">${s.icon} ${escHtml(s.title)}</div>`
    ).join('');
    selectScript(0);
}

function selectScript(index) {
    _currentScript = _callScripts[index];
    _currentStep = 0;

    document.querySelectorAll('#scriptTabs .mgr-tab').forEach((t, i) => t.classList.toggle('active', i === index));
    renderScriptSteps();

    const resetBtn = document.getElementById('scriptResetBtn');
    if (resetBtn && !resetBtn._bound) {
        resetBtn._bound = true;
        resetBtn.addEventListener('click', () => { _currentStep = 0; renderScriptSteps(); });
    }
}

function renderScriptSteps() {
    if (!_currentScript) return;
    const container = document.getElementById('scriptContent');
    const progress = document.getElementById('scriptProgress');

    // Progress bar
    progress.innerHTML = _currentScript.steps.map((_, i) =>
        `<div class="mgr-progress-step ${i < _currentStep ? 'done' : i === _currentStep ? 'current' : ''}"></div>`
    ).join('');

    // Steps
    let html = '';
    _currentScript.steps.forEach((step, i) => {
        const isActive = i === _currentStep;
        html += `<div class="mgr-script-step${isActive ? ' active' : ''}" data-step="${i}">
            <div class="mgr-script-step-header" onclick="setScriptStep(${i})">
                <span class="mgr-step-number">${step.number}</span>
                <span class="mgr-step-title">${escHtml(step.title)}</span>
                <span class="mgr-step-duration">${escHtml(step.duration)}</span>
            </div>
            <div class="mgr-script-step-body">
                <div class="mgr-step-text">${escHtml(step.text)}</div>
                ${step.note ? `<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:10px">💡 ${escHtml(step.note)}</div>` : ''}
                <div class="mgr-step-branches">
                    ${(step.branches || []).map(b => `<button class="mgr-branch-btn" onclick="handleBranch(${JSON.stringify(b).replace(/"/g, '&quot;')})">→ ${escHtml(b.label)}${b.text ? ': ' + escHtml(b.text).substring(0, 60) + '...' : ''}</button>`).join('')}
                </div>
                <span class="mgr-suggestion-copy" onclick="copyToClipboard(${JSON.stringify(step.text).replace(/"/g, '&quot;')})">📋 Копіювати фразу</span>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function setScriptStep(i) {
    _currentStep = i;
    renderScriptSteps();
}

function handleBranch(branch) {
    if (branch.goto !== undefined) {
        _currentStep = branch.goto - 1; // steps are 1-indexed in data
        renderScriptSteps();
    } else if (branch.text) {
        showToast(branch.text);
    }
    if (branch.action) {
        showToast(`Дія: ${branch.action}`);
    }
}

// ==========================================
// MODULE 4: MESSAGE TEMPLATES
// ==========================================
function renderTemplateTabs() {
    if (!_msgTemplates) return;
    const tabs = document.getElementById('templateTabs');
    tabs.innerHTML = _msgTemplates.map((t, i) =>
        `<div class="mgr-tab${i === 0 ? ' active' : ''}" onclick="selectTemplate(${i})">${t.icon} ${escHtml(t.title)}</div>`
    ).join('');
    selectTemplate(0);
}

function selectTemplate(index) {
    const tmpl = _msgTemplates[index];
    document.querySelectorAll('#templateTabs .mgr-tab').forEach((t, i) => t.classList.toggle('active', i === index));

    // Render variable form
    const form = document.getElementById('templateForm');
    let html = '<div style="margin-bottom:16px">';
    tmpl.variables.forEach(v => {
        html += `<div class="mgr-form-group" style="margin-bottom:8px">
            <label class="mgr-label">${escHtml(v)}:</label>
            <input class="mgr-input mgr-tmpl-var" data-var="${escHtml(v)}" placeholder="${escHtml(v)}">
        </div>`;
    });
    html += `<button class="mgr-btn mgr-btn-primary" onclick="previewTemplate(${index})">👁️ Попередній перегляд</button>`;
    html += '</div>';
    form.innerHTML = html;

    document.getElementById('templatePreview').innerHTML = '';
}

function previewTemplate(index) {
    const tmpl = _msgTemplates[index];
    let text = tmpl.template;

    document.querySelectorAll('.mgr-tmpl-var').forEach(input => {
        const varName = input.dataset.var;
        const val = input.value || `[${varName}]`;
        text = text.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), val);
    });

    document.getElementById('templatePreview').innerHTML = `
        <div class="mgr-template-preview">${escHtml(text)}</div>
        <div style="margin-top:10px;display:flex;gap:8px">
            <button class="mgr-btn mgr-btn-primary mgr-btn-small" onclick="copyToClipboard(document.querySelector('.mgr-template-preview').textContent)">📋 Копіювати</button>
        </div>`;
}

// ==========================================
// MODULE 5: DEBRIEF
// ==========================================
function initDebrief() {
    // Radio groups
    document.querySelectorAll('#debriefResult .mgr-radio-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('#debriefResult .mgr-radio-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            _selectedDebriefResult = opt.dataset.value;
        });
    });

    document.querySelectorAll('#debriefObjection .mgr-radio-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('#debriefObjection .mgr-radio-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            _selectedDebriefObjection = opt.dataset.value;
        });
    });

    document.getElementById('debriefAnalyzeBtn').addEventListener('click', requestDebrief);
    document.getElementById('debriefSaveBtn').addEventListener('click', saveDebrief);
}

async function requestDebrief() {
    const notes = document.getElementById('debriefNotes').value.trim();
    if (!notes) { showToast('Опишіть що обговорювали', 'error'); return; }

    // Note: there's a naming collision with the result radio group - use different container
    const container = document.querySelector('#panel-debrief #debriefResult')?.nextElementSibling || document.getElementById('debriefSaveBtn').parentElement.nextElementSibling;
    // Actually use a dedicated container
    let resultDiv = document.getElementById('debriefAnalysisResult');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.id = 'debriefAnalysisResult';
        document.getElementById('debriefSaveBtn').parentElement.after(resultDiv);
    }
    resultDiv.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI аналізує...</div>';

    try {
        const resp = await fetch(`${API_BASE}/manager/debrief`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                clientName: document.getElementById('debriefClient').value,
                result: _selectedDebriefResult,
                durationMin: parseInt(document.getElementById('debriefDuration').value) || null,
                notes,
                mainObjection: _selectedDebriefObjection,
                whatWorked: document.getElementById('debriefWorked').value,
                whatImprove: document.getElementById('debriefImprove').value
            })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();

        if (data.success && data.analysis) {
            _lastDebriefAnalysis = data.analysis;
            renderDebriefResult(data.analysis, resultDiv);
            document.getElementById('debriefSaveBtn').style.display = '';
        } else {
            resultDiv.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error || 'Помилка')}</div>`;
        }
    } catch {
        resultDiv.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка з\'єднання</div>';
    }
}

function renderDebriefResult(analysis, container) {
    const score = analysis.score || 0;
    const scoreColor = score >= 8 ? '#22c55e' : score >= 6 ? '#eab308' : '#ef4444';

    let html = '<div class="mgr-ai-block">';
    html += '<div style="font-size:12px;font-weight:700;color:rgba(201,168,76,0.7);margin-bottom:12px">📊 АНАЛІЗ ДЗВІНКА</div>';

    // Score bar
    html += `<div class="mgr-score-bar">
        <span style="font-size:13px;color:rgba(255,255,255,0.5)">Оцінка:</span>
        <div class="mgr-score-track"><div class="mgr-score-fill" style="width:${score * 10}%;background:${scoreColor}"></div></div>
        <span class="mgr-score-label">${score}/10</span>
    </div>`;

    if (analysis.good) {
        html += '<div class="mgr-tactic" style="flex-direction:column;align-items:flex-start"><b>✅ Що зроблено добре:</b>';
        (Array.isArray(analysis.good) ? analysis.good : [analysis.good]).forEach(g => {
            html += `<div style="margin-top:4px">• ${escHtml(g)}</div>`;
        });
        html += '</div>';
    }

    if (analysis.improve) {
        html += '<div class="mgr-avoid" style="flex-direction:column;align-items:flex-start"><b>📈 Що покращити:</b>';
        (Array.isArray(analysis.improve) ? analysis.improve : [analysis.improve]).forEach(g => {
            html += `<div style="margin-top:4px">• ${escHtml(g)}</div>`;
        });
        html += '</div>';
    }

    if (analysis.nextStep) {
        html += `<div class="mgr-next-step">➡️ <b>Наступний крок:</b> ${escHtml(analysis.nextStep)}</div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

async function saveDebrief() {
    try {
        const resp = await fetch(`${API_BASE}/manager/debrief/save`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                clientName: document.getElementById('debriefClient').value,
                callResult: _selectedDebriefResult,
                durationMin: parseInt(document.getElementById('debriefDuration').value) || null,
                notes: document.getElementById('debriefNotes').value,
                mainObjection: _selectedDebriefObjection,
                whatWorked: document.getElementById('debriefWorked').value,
                whatImprove: document.getElementById('debriefImprove').value,
                aiScore: _lastDebriefAnalysis?.score,
                aiAnalysis: _lastDebriefAnalysis,
                nextStep: _lastDebriefAnalysis?.nextStep
            })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();
        if (data.success) {
            showToast('Дебрифінг збережено! ✅');
            document.getElementById('debriefSaveBtn').style.display = 'none';
        }
    } catch {
        showToast('Помилка збереження', 'error');
    }
}

// ==========================================
// MODULE 6: SALES ACADEMY
// ==========================================
function renderAcademy(section) {
    document.querySelectorAll('#academyTabs .mgr-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));

    const container = document.getElementById('academyContent');

    // Add tab click bindings (once)
    if (!document.getElementById('academyTabs')._bound) {
        document.getElementById('academyTabs')._bound = true;
        document.querySelectorAll('#academyTabs .mgr-tab').forEach(t => {
            t.addEventListener('click', () => renderAcademy(t.dataset.section));
        });
    }

    if (section === 'methodology') return renderMethodology(container);
    if (section === 'market') return renderAcademySection(container, _salesAcademy?.market);
    if (section === 'cases') return renderAcademySection(container, _salesAcademy?.cases);
    if (section === 'closing') return renderClosingTechniques(container);
    if (section === 'psychology') return renderPsychology(container);
    if (section === 'profiles') return renderProfiles(container);
    if (section === 'qa') return renderSalesQA(container);
}

function renderMethodology(container) {
    if (!_salesMethodology) { container.innerHTML = '<div class="mgr-empty">Завантаження...</div>'; return; }

    let html = '';
    for (const [key, m] of Object.entries(_salesMethodology)) {
        html += `<div class="mgr-card" onclick="toggleObjection(this)" style="margin-bottom:10px">
            <div class="mgr-card-icon">${m.icon}</div>
            <div class="mgr-card-title">${escHtml(m.title)} <span style="font-size:11px;color:rgba(255,255,255,0.3)">(${escHtml(m.author)})</span></div>
            <div class="mgr-card-desc">${escHtml(m.principle)}</div>
            <div class="mgr-card-detail">`;

        m.steps.forEach(s => {
            html += `<div style="margin-bottom:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px">
                <div style="font-size:13px;font-weight:700;color:#C9A84C">${escHtml(s.letter)} — ${escHtml(s.name)} (${escHtml(s.ua)})</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px">${escHtml(s.description)}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;font-style:italic">"${escHtml(s.example)}"</div>
            </div>`;
        });

        if (m.tips) {
            html += '<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4)">';
            m.tips.forEach(t => { html += `<div>💡 ${escHtml(t)}</div>`; });
            html += '</div>';
        }

        html += '</div></div>';
    }
    container.innerHTML = html;
}

function renderAcademySection(container, data) {
    if (!data) { container.innerHTML = '<div class="mgr-empty">Завантаження...</div>'; return; }

    let html = `<h3 style="color:#fff;font-size:16px;margin-bottom:16px">${data.icon} ${escHtml(data.title)}</h3>`;
    data.sections.forEach(s => {
        html += `<div class="mgr-card" onclick="toggleObjection(this)" style="margin-bottom:10px">
            <div class="mgr-card-title">${escHtml(s.title)}</div>
            <div class="mgr-card-detail">`;
        if (s.content) html += `<div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6">${escHtml(s.content)}</div>`;
        if (s.items) s.items.forEach(i => {
            if (typeof i === 'string') html += `<div style="padding:4px 0;font-size:13px;color:rgba(255,255,255,0.6)">• ${escHtml(i)}</div>`;
            else html += `<div style="padding:4px 0;font-size:13px;color:rgba(255,255,255,0.6)">• ${escHtml(i)}</div>`;
        });
        if (s.lesson) html += `<div class="mgr-tactic" style="margin-top:10px">🎯 <b>Урок:</b> ${escHtml(s.lesson)}</div>`;
        html += '</div></div>';
    });
    container.innerHTML = html;
}

function renderClosingTechniques(container) {
    const data = _salesAcademy?.closing_techniques;
    if (!data) { container.innerHTML = '<div class="mgr-empty">Завантаження...</div>'; return; }

    let html = `<h3 style="color:#fff;font-size:16px;margin-bottom:16px">${data.icon} ${escHtml(data.title)}</h3>`;
    data.sections.forEach(s => {
        html += `<div class="mgr-card" onclick="toggleObjection(this)" style="margin-bottom:10px">
            <div class="mgr-card-title">${escHtml(s.title)}</div>
            <div class="mgr-card-desc">${escHtml(s.description)}</div>
            <div class="mgr-card-detail">`;
        if (s.bad) html += `<div class="mgr-avoid">❌ <b>Погано:</b> "${escHtml(s.bad)}"</div>`;
        if (s.good) html += `<div class="mgr-tactic">✅ <b>Добре:</b> "${escHtml(s.good)}"</div>`;
        if (s.example) html += `<div class="mgr-next-step">💬 <b>Приклад:</b> "${escHtml(s.example)}"</div>`;
        if (s.note) html += `<div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4)">💡 ${escHtml(s.note)}</div>`;
        html += '</div></div>';
    });
    container.innerHTML = html;
}

function renderPsychology(container) {
    const data = _salesAcademy?.psychology;
    if (!data) { container.innerHTML = '<div class="mgr-empty">Завантаження...</div>'; return; }

    let html = `<h3 style="color:#fff;font-size:16px;margin-bottom:16px">${data.icon} ${escHtml(data.title)}</h3>`;
    data.sections.forEach(s => {
        html += `<div class="mgr-card" onclick="toggleObjection(this)" style="margin-bottom:10px">
            <div class="mgr-card-title">${escHtml(s.title)}</div>
            <div class="mgr-card-detail">`;

        if (s.stages) {
            html += '<table style="width:100%;font-size:12px;color:rgba(255,255,255,0.7);border-collapse:collapse">';
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1)"><th style="text-align:left;padding:6px">Стадія</th><th style="text-align:left;padding:6px">Що відчуває</th><th style="text-align:left;padding:6px">Що казати</th></tr>';
            s.stages.forEach(st => {
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05)"><td style="padding:6px;font-weight:700">${escHtml(st.stage)}</td><td style="padding:6px">${escHtml(st.feeling)}</td><td style="padding:6px">${escHtml(st.approach)}</td></tr>`;
            });
            html += '</table>';
        }

        if (s.items) s.items.forEach(i => {
            if (typeof i === 'object' && i.bias) {
                html += `<div style="padding:8px;margin-top:6px;background:rgba(255,255,255,0.03);border-radius:6px"><b style="color:#C9A84C">${escHtml(i.bias)}:</b> <span style="color:rgba(255,255,255,0.6)">${escHtml(i.description)}</span></div>`;
            } else {
                html += `<div style="padding:4px 0;font-size:13px;color:rgba(255,255,255,0.6)">• ${escHtml(typeof i === 'string' ? i : i.toString())}</div>`;
            }
        });

        html += '</div></div>';
    });
    container.innerHTML = html;
}

function renderProfiles(container) {
    if (!_buyerProfiles) { container.innerHTML = '<div class="mgr-empty">Завантаження...</div>'; return; }

    let html = '<h3 style="color:#fff;font-size:16px;margin-bottom:16px">👤 Профілі покупців</h3>';
    html += '<div class="mgr-cards-grid">';
    _buyerProfiles.forEach(p => {
        html += `<div class="mgr-card" onclick="toggleObjection(this)">
            <div class="mgr-card-icon">${p.icon}</div>
            <div class="mgr-card-title">${escHtml(p.title)}</div>
            <div class="mgr-card-desc">${escHtml(p.description)}</div>
            <div class="mgr-card-detail">
                <div class="mgr-avoid" style="flex-direction:column;align-items:flex-start"><b>😰 Страхи:</b>${p.fears.map(f => `<div>• ${escHtml(f)}</div>`).join('')}</div>
                <div class="mgr-tactic" style="flex-direction:column;align-items:flex-start;margin-top:8px"><b>🎯 Підхід:</b><div>${escHtml(p.approach)}</div></div>
                <div class="mgr-next-step" style="margin-top:8px">🔑 <b>Закриття:</b> ${escHtml(p.closing)}</div>
                <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4)"><b>Ознаки:</b> ${p.signs.map(s => escHtml(s)).join(' | ')}</div>
            </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

function renderSalesQA(container) {
    let html = `<h3 style="color:#fff;font-size:16px;margin-bottom:16px">❓ Запитай Sales AI</h3>
        <div class="mgr-form-group" style="margin-bottom:12px">
            <textarea class="mgr-textarea" id="salesQAInput" placeholder="Як відповісти якщо клієнт каже..." rows="2"></textarea>
        </div>
        <button class="mgr-btn mgr-btn-primary" id="salesQABtn">Запитати →</button>
        <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="mgr-btn mgr-btn-secondary mgr-btn-small" onclick="document.getElementById('salesQAInput').value='Як зробити follow-up після мовчання?';document.getElementById('salesQABtn').click()">Як зробити follow-up?</button>
            <button class="mgr-btn mgr-btn-secondary mgr-btn-small" onclick="document.getElementById('salesQAInput').value='Яку ціну озвучити першою?';document.getElementById('salesQABtn').click()">Яку ціну першою?</button>
            <button class="mgr-btn mgr-btn-secondary mgr-btn-small" onclick="document.getElementById('salesQAInput').value='Як дізнатись хто приймає рішення?';document.getElementById('salesQABtn').click()">Хто приймає рішення?</button>
        </div>
        <div id="salesQAResult" style="margin-top:16px"></div>`;
    container.innerHTML = html;

    document.getElementById('salesQABtn').addEventListener('click', async () => {
        const q = document.getElementById('salesQAInput').value.trim();
        if (!q) return;
        const result = document.getElementById('salesQAResult');
        result.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI думає...</div>';

        try {
            const resp = await fetch(`${API_BASE}/manager/sales-qa`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ question: q })
            });
            if (handleAuthError(resp)) return;
            const data = await resp.json();
            if (data.success) {
                result.innerHTML = `<div class="mgr-ai-block"><div style="font-size:14px;color:rgba(255,255,255,0.85);line-height:1.6;white-space:pre-wrap">${escHtml(data.answer)}</div></div>`;
            } else {
                result.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error)}</div>`;
            }
        } catch {
            result.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка</div>';
        }
    });
}

// ==========================================
// MODULE 7: INTERACTIONS
// ==========================================
async function loadInteractions() {
    const feed = document.getElementById('interactionsFeed');
    feed.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> Завантаження...</div>';

    try {
        const type = document.getElementById('interactionsTypeFilter').value;
        const days = document.getElementById('interactionsDaysFilter').value;
        const search = document.getElementById('interactionsSearch').value;

        const params = new URLSearchParams();
        if (type) params.set('type', type);
        if (days) params.set('days', days);
        if (search) params.set('search', search);

        const resp = await fetch(`${API_BASE}/manager/interactions?${params}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(resp)) return;
        const data = await resp.json();

        if (!data.success || !data.interactions?.length) {
            feed.innerHTML = '<div class="mgr-empty"><div class="mgr-empty-icon">📡</div>Немає взаємодій</div>';
            return;
        }

        renderInteractionFeed(data.interactions, feed);
    } catch {
        feed.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка завантаження</div>';
    }

    // Bind filters (once)
    ['interactionsTypeFilter', 'interactionsDaysFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el._bound) { el._bound = true; el.addEventListener('change', loadInteractions); }
    });
    const searchEl = document.getElementById('interactionsSearch');
    if (searchEl && !searchEl._bound) {
        searchEl._bound = true;
        let timer;
        searchEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadInteractions, 500); });
    }
}

function renderInteractionFeed(interactions, container) {
    const typeIcons = { call: '📞', message_sent: '📧', status_change: '✅', debrief: '📊', note: '📝', landing_submission: '🌐', meeting_prep: '🔮', message_draft: '✍️' };
    const typeLabels = { call: 'Дзвінок', message_sent: 'Повідомлення', status_change: 'Зміна статусу', debrief: 'Дебрифінг', note: 'Нотатка', landing_submission: 'Заявка', meeting_prep: 'Підготовка', message_draft: 'Чернетка' };

    let html = '';
    let lastDate = '';
    interactions.forEach(i => {
        const date = formatDate(i.created_at);
        if (date !== lastDate) {
            lastDate = date;
            html += `<div class="mgr-date-sep">${date}</div>`;
        }

        const dotClass = i.type.includes('call') || i.type === 'debrief' ? 'call' : i.type.includes('message') ? 'message' : i.type === 'status_change' ? 'status' : 'note';

        html += `<div class="mgr-feed-item">
            <div class="mgr-feed-dot ${dotClass}"></div>
            <div class="mgr-feed-body">
                <div class="mgr-feed-header">
                    <span class="mgr-feed-time">${formatTime(i.created_at)}</span>
                    <span class="mgr-feed-client">${escHtml(i.lead_name || 'Невідомий')}</span>
                    <span class="mgr-feed-type">${typeIcons[i.type] || '📌'} ${typeLabels[i.type] || i.type}</span>
                </div>
                ${i.summary ? `<div class="mgr-feed-summary">${escHtml(i.summary)}</div>` : ''}
                <div class="mgr-feed-meta">
                    ${i.user_name ? `<span>👤 ${escHtml(i.user_name)}</span>` : ''}
                    ${i.follow_up_date && !i.follow_up_done ? `<span style="color:#eab308">⏰ Follow-up: ${formatDate(i.follow_up_date)}</span>` : ''}
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// ==========================================
// MODULE 8: BATTLE CARDS
// ==========================================
function renderBattleCards(filter) {
    if (!_battleCards) return;
    const grid = document.getElementById('battleCardsGrid');
    const search = (filter || document.getElementById('battleSearch')?.value || '').toLowerCase();

    let html = '';
    _battleCards.forEach(card => {
        const matches = !search || card.competitor.toLowerCase().includes(search) ||
            card.keywords.some(k => k.toLowerCase().includes(search));
        if (!matches) return;

        html += `<div class="mgr-card" onclick="toggleObjection(this)">
            <div class="mgr-card-icon">${card.icon}</div>
            <div class="mgr-card-title">vs ${escHtml(card.competitor)}</div>
            <div class="mgr-card-desc">${escHtml(card.strength)}</div>
            <div class="mgr-card-detail">
                <div class="mgr-tactic" style="flex-direction:column;align-items:flex-start"><b>💪 Наш аргумент:</b><div style="margin-top:4px">${escHtml(card.argument)}</div></div>
                <div class="mgr-next-step" style="margin-top:8px">📊 <b>Цифра:</b> ${escHtml(card.number)}</div>
                <div style="margin-top:8px;padding:10px;background:rgba(201,168,76,0.08);border-radius:8px;font-size:13px;color:rgba(255,255,255,0.8)">❓ <b>Killer question:</b> "${escHtml(card.killer_question)}"</div>
                <div class="mgr-avoid" style="margin-top:8px">⚠️ ${escHtml(card.avoid)}</div>
            </div>
        </div>`;
    });

    grid.innerHTML = html || '<div class="mgr-empty"><div class="mgr-empty-icon">🔍</div>Нічого не знайдено</div>';

    const searchInput = document.getElementById('battleSearch');
    if (searchInput && !searchInput._bound) {
        searchInput._bound = true;
        searchInput.addEventListener('input', () => renderBattleCards());
    }
}

// ==========================================
// MODULE 9: MEETING PREP
// ==========================================
function initMeetingPrep() {
    document.getElementById('prepBtn').addEventListener('click', requestMeetingPrep);
}

async function requestMeetingPrep() {
    const client = document.getElementById('prepClient').value.trim();
    if (!client) { showToast('Вкажіть клієнта', 'error'); return; }

    const container = document.getElementById('prepResult');
    container.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI готує бриф...</div>';
    document.getElementById('prepBtn').disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/manager/meeting-prep`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                clientName: client,
                source: document.getElementById('prepSource').value,
                businessSize: document.getElementById('prepSize').value,
                knownInfo: document.getElementById('prepInfo').value,
                packageInterest: document.getElementById('prepPackage').value,
                callType: document.getElementById('prepCallType').value
            })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();

        if (data.success && data.brief) {
            renderMeetingBrief(data.brief, container);
        } else {
            container.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error || 'Помилка')}</div>`;
        }
    } catch {
        container.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка з\'єднання</div>';
    } finally {
        document.getElementById('prepBtn').disabled = false;
    }
}

function renderMeetingBrief(brief, container) {
    let html = '<div class="mgr-ai-block">';
    html += '<div style="font-size:12px;font-weight:700;color:rgba(201,168,76,0.7);margin-bottom:12px">🔮 БРИФ ДО ДЗВІНКА</div>';

    if (brief.focus) html += `<div class="mgr-tactic">🎯 <b>Фокус:</b> ${escHtml(brief.focus)}</div>`;
    if (brief.opening_question) html += `<div class="mgr-next-step" style="margin-top:8px">💬 <b>Перше питання:</b> "${escHtml(brief.opening_question)}"</div>`;

    if (brief.killer_questions?.length) {
        html += '<div style="margin-top:12px"><b style="color:rgba(255,255,255,0.6);font-size:12px">❓ KILLER QUESTIONS:</b>';
        brief.killer_questions.forEach(q => {
            html += `<div style="padding:6px 10px;margin-top:4px;background:rgba(201,168,76,0.06);border-radius:6px;font-size:13px;color:rgba(255,255,255,0.8)">• ${escHtml(q)}</div>`;
        });
        html += '</div>';
    }

    if (brief.likely_objections?.length) {
        html += '<div style="margin-top:12px"><b style="color:rgba(255,255,255,0.6);font-size:12px">🛡️ ЙМОВІРНІ ЗАПЕРЕЧЕННЯ:</b>';
        brief.likely_objections.forEach(o => {
            html += `<div class="mgr-avoid" style="margin-top:4px;flex-direction:column;align-items:flex-start">
                <b>${escHtml(o.objection)}</b>
                <div style="margin-top:4px;color:#22c55e">→ ${escHtml(o.response)}</div>
            </div>`;
        });
        html += '</div>';
    }

    if (brief.call_goal) html += `<div class="mgr-tactic" style="margin-top:12px">🏆 <b>Ціль дзвінка:</b> ${escHtml(brief.call_goal)}</div>`;
    if (brief.potential_value) html += `<div style="margin-top:8px;font-size:14px;font-weight:700;color:#C9A84C">💰 Потенціал: ${escHtml(brief.potential_value)}</div>`;

    html += '</div>';
    container.innerHTML = html;
}

// ==========================================
// MODULE 10: PIPELINE
// ==========================================
async function loadPipeline() {
    const kanban = document.getElementById('pipelineKanban');
    const metrics = document.getElementById('pipelineMetrics');
    kanban.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> Завантаження...</div>';

    try {
        // Load leads with pipeline view
        const [leadsResp, statsResp] = await Promise.all([
            fetch(`${API_BASE}/leads?limit=200`, { headers: getAuthHeaders(false) }),
            fetch(`${API_BASE}/manager/pipeline/stats`, { headers: getAuthHeaders(false) })
        ]);

        if (handleAuthError(leadsResp)) return;

        const leadsData = await leadsResp.json();
        const statsData = await statsResp.json();

        const leads = leadsData.leads || leadsData || [];

        // Render metrics
        if (statsData.success) {
            metrics.innerHTML = `
                <div class="mgr-metric"><div class="mgr-metric-value">${statsData.totalPipeline?.toLocaleString() || 0} ₴</div><div class="mgr-metric-label">Pipeline</div></div>
                <div class="mgr-metric"><div class="mgr-metric-value">${statsData.avgCycleDays || 0}д</div><div class="mgr-metric-label">Сер. цикл</div></div>
                <div class="mgr-metric"><div class="mgr-metric-value">${(statsData.stages || []).reduce((s, r) => s + parseInt(r.count || 0), 0)}</div><div class="mgr-metric-label">Угод</div></div>`;
        }

        renderKanban(Array.isArray(leads) ? leads : [], kanban);
    } catch {
        kanban.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка завантаження</div>';
    }
}

function renderKanban(leads, container) {
    const stages = [
        { key: 'new', label: '🆕 Нові', statuses: ['new'] },
        { key: 'contacted', label: '📞 Контакт', statuses: ['contacted', 'in_progress'] },
        { key: 'demo', label: '🖥️ Демо', statuses: ['demo', 'presentation'] },
        { key: 'negotiation', label: '🤝 Переговори', statuses: ['negotiation', 'proposal'] },
        { key: 'won', label: '✅ Закрито', statuses: ['won', 'booked', 'closed'] }
    ];

    let html = '';
    stages.forEach(stage => {
        const stageLeads = leads.filter(l => {
            const s = (l.pipeline_stage || l.status || 'new').toLowerCase();
            return stage.statuses.includes(s);
        });

        html += `<div class="mgr-kanban-column" data-stage="${stage.key}"
                      ondragover="event.preventDefault()" ondrop="handleDrop(event, '${stage.key}')">
            <div class="mgr-kanban-header">
                <span class="mgr-kanban-title">${stage.label}</span>
                <span class="mgr-kanban-count">${stageLeads.length}</span>
            </div>`;

        stageLeads.forEach(lead => {
            const daysSince = lead.created_at ? Math.floor((Date.now() - new Date(lead.created_at)) / 86400000) : 0;
            const staleClass = daysSince > 7 ? 'stale-danger' : daysSince > 3 ? 'stale-warning' : '';

            html += `<div class="mgr-kanban-card ${staleClass}" draggable="true" data-lead-id="${lead.id}"
                          ondragstart="event.dataTransfer.setData('text/plain', '${lead.id}');this.classList.add('dragging')"
                          ondragend="this.classList.remove('dragging')">
                <div class="mgr-kanban-card-name">${escHtml(lead.client_name || 'Невідомий')}</div>
                <div class="mgr-kanban-card-meta">${escHtml(lead.company_name || lead.phone || '')}</div>
                ${lead.potential_value ? `<div class="mgr-kanban-card-value">💰 ${lead.potential_value.toLocaleString()} ₴</div>` : ''}
                <div class="mgr-kanban-card-meta">${daysSince}д у стадії</div>
            </div>`;
        });

        html += '</div>';
    });

    container.innerHTML = html;
}

async function handleDrop(event, newStage) {
    event.preventDefault();
    const leadId = event.dataTransfer.getData('text/plain');
    if (!leadId) return;

    const stageMap = { new: 'new', contacted: 'contacted', demo: 'demo', negotiation: 'negotiation', won: 'won' };

    try {
        await fetch(`${API_BASE}/leads/${leadId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ pipeline_stage: stageMap[newStage] || newStage, status: stageMap[newStage] || newStage })
        });
        showToast('Статус оновлено');
        loadPipeline();
    } catch {
        showToast('Помилка оновлення', 'error');
    }
}

// ==========================================
// MODULE 11: AI WRITER
// ==========================================
function initWriter() {
    document.getElementById('writerBtn').addEventListener('click', requestWriteMessage);
}

async function requestWriteMessage() {
    const client = document.getElementById('writerClient').value.trim();
    if (!client) { showToast('Вкажіть клієнта', 'error'); return; }

    const container = document.getElementById('writerResult');
    container.innerHTML = '<div class="mgr-loading"><div class="mgr-spinner"></div> AI пише повідомлення...</div>';
    document.getElementById('writerBtn').disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/manager/write-message`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                clientName: client,
                messageType: document.getElementById('writerType').value,
                discussed: document.getElementById('writerDiscussed').value,
                interested: document.getElementById('writerInterested').value,
                concerns: document.getElementById('writerConcerns').value,
                tone: document.getElementById('writerTone').value
            })
        });
        if (handleAuthError(resp)) return;
        const data = await resp.json();

        if (data.success && data.message) {
            container.innerHTML = `
                <div class="mgr-ai-block">
                    <div style="font-size:12px;font-weight:700;color:rgba(201,168,76,0.7);margin-bottom:12px">✍️ ПОВІДОМЛЕННЯ</div>
                    <div class="mgr-template-preview">${escHtml(data.message)}</div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                        <button class="mgr-btn mgr-btn-primary mgr-btn-small" onclick="copyToClipboard(${JSON.stringify(data.message).replace(/"/g, '&quot;')})">📋 Копіювати</button>
                        <button class="mgr-btn mgr-btn-secondary mgr-btn-small" onclick="requestWriteMessage()">🔄 Переписати</button>
                    </div>
                </div>`;
        } else {
            container.innerHTML = `<div class="mgr-ai-block" style="color:#ef4444">${escHtml(data.error || 'Помилка')}</div>`;
        }
    } catch {
        container.innerHTML = '<div class="mgr-ai-block" style="color:#ef4444">Помилка з\'єднання</div>';
    } finally {
        document.getElementById('writerBtn').disabled = false;
    }
}
