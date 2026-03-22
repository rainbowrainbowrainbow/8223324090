/* decision-screen.js — Центр прийняття рішень v1.0
 * Залежності: api.js (apiCall), auth.js (AppState)
 * apiCall сигнатура: ('METHOD', '/url', body)
 */
'use strict';

const DecisionScreen = (() => {
    let _pending = [];
    let _initialized = false;
    let _hideTimeout = null;

    // ── Локальні утиліти ──────────────────────────────────────
    function _esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function _ago(dateStr) {
        if (!dateStr) return '';
        const sec = Math.floor((Date.now() - new Date(dateStr)) / 1000);
        if (sec < 60) return 'щойно';
        if (sec < 3600) return `${Math.floor(sec / 60)} хв. тому`;
        if (sec < 86400) return `${Math.floor(sec / 3600)} год. тому`;
        if (sec < 604800) return `${Math.floor(sec / 86400)} дн. тому`;
        return new Date(dateStr).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
    }

    function _priorityLabel(p) {
        return {
            critical: '🔴\u00A0КРИТИЧНО',
            important: '🟡\u00A0ВАЖЛИВО',
            normal: '🔵\u00A0ЗВИЧАЙНЕ'
        }[p] || '🔵';
    }

    // ── Public API ────────────────────────────────────────────
    async function init() {
        if (_initialized) return;
        _initialized = true;

        if (!AppState?.currentUser) {
            console.warn('[DecisionScreen] no user, skipping');
            return;
        }

        await _loadAndRender();
    }

    async function decide(id, action) {
        const card = document.querySelector(`.ds-card[data-id="${id}"]`);
        if (card) {
            card.classList.add('ds-card--deciding');
            card.querySelectorAll('.ds-btn').forEach(b => (b.disabled = true));
        }

        try {
            await apiCall('PUT', `/api/decisions/${id}/${action}`);
            _pending = _pending.filter(d => d.id !== id);
            _render();

            if (_pending.length === 0) {
                clearTimeout(_hideTimeout);
                _hideTimeout = setTimeout(_hide, 1200);
            }
        } catch (err) {
            console.error('[DecisionScreen.decide]', err);
            if (card) {
                card.classList.remove('ds-card--deciding');
                card.querySelectorAll('.ds-btn').forEach(b => (b.disabled = false));
            }
        }
    }

    // ── Private ───────────────────────────────────────────────
    async function _loadAndRender() {
        try {
            const data = await apiCall('GET', '/api/decisions/pending');
            _pending = data?.decisions || [];
        } catch (err) {
            console.warn('[DecisionScreen] load failed:', err);
            _pending = [];
        }

        _render();
        if (_pending.length > 0) {
            _show();
        } else {
        }
    }

    function _render() {
        const $list = document.getElementById('dsDecisionList');
        const $count = document.getElementById('dsCount');
        if (!$list) return;

        if ($count) {
            $count.textContent = _pending.length > 0
                ? `${_pending.length} очікують`
                : 'Готово ✓';
        }

        if (_pending.length === 0) {
            $list.innerHTML = `
                <div class="ds-empty" aria-live="polite">
                    <div class="ds-empty-icon">✅</div>
                    <p class="ds-empty-text">Всі рішення прийняті</p>
                </div>`;
            return;
        }

        $list.innerHTML = _pending.map((d, i) => `
            <article class="ds-card ds-card--${_esc(d.priority)}"
                     data-id="${d.id}"
                     style="animation-delay:${i * 0.06}s"
                     role="group"
                     aria-label="${_esc(d.title)}">
                <header class="ds-card-header">
                    <span class="ds-priority">${_priorityLabel(d.priority)}</span>
                    <span class="ds-time">${_ago(d.created_at)}</span>
                </header>
                <h3 class="ds-title">${_esc(d.title)}</h3>
                ${d.description ? `<p class="ds-desc">${_esc(d.description)}</p>` : ''}
                <footer class="ds-card-footer">
                    <span class="ds-meta">Від: ${_esc(d.created_by || 'система')}</span>
                    ${d.context_url
                ? `<a class="ds-link" href="${_esc(d.context_url)}" target="_blank" rel="noopener">→ Контекст</a>`
                : ''}
                </footer>
                <div class="ds-actions" role="group" aria-label="Дії">
                    <button class="ds-btn ds-btn--approve"
                            onclick="DecisionScreen.decide(${d.id},'approve')">
                        ✅ Затвердити
                    </button>
                    <button class="ds-btn ds-btn--reject"
                            onclick="DecisionScreen.decide(${d.id},'reject')">
                        ❌ Відхилити
                    </button>
                    <button class="ds-btn ds-btn--defer"
                            onclick="DecisionScreen.decide(${d.id},'defer')">
                        ⏸ Потім
                    </button>
                </div>
            </article>
        `).join('');
    }

    function _show() {
        const el = document.getElementById('decisionScreen');
        if (!el) return;
        el.classList.remove('hidden');
        el.removeAttribute('aria-hidden');
        document.body.classList.add('ds-open');
        requestAnimationFrame(() => {
            el.querySelector('.ds-btn')?.focus();
        });
    }

    function _hide() {
        const el = document.getElementById('decisionScreen');
        if (!el) return;
        el.classList.add('ds-closing');
        setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('ds-closing');
            el.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('ds-open');
        }, 300);
    }

    return { init, decide };
})();
