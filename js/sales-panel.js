/**
 * js/sales-panel.js — Sales Techniques UI (v20.5.0)
 * Call script, upsell suggestions, free slots, price-per-child
 */
const SalesPanel = (() => {
    let callScriptLoaded = false;
    let upsellCatalog = [];
    let scriptVisible = false;

    async function init() {
        // Call script toggle
        const toggleBtn = document.getElementById('callScriptToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleCallScript);
        }

        // Load free slots hint
        loadFreeSlotsHint();
    }

    // Toggle call script visibility
    async function toggleCallScript() {
        const panel = document.getElementById('callScriptPanel');
        if (!panel) return;

        scriptVisible = !scriptVisible;
        panel.classList.toggle('hidden', !scriptVisible);

        if (scriptVisible && !callScriptLoaded) {
            await loadCallScript();
        }

        // Save state
        localStorage.setItem('pzp_call_script_visible', scriptVisible ? 'true' : 'false');
    }

    // Load call script from API
    async function loadCallScript() {
        const content = document.getElementById('callScriptContent');
        if (!content) return;

        try {
            const token = localStorage.getItem('pzp_token');
            const res = await fetch((window.API_BASE || '') + '/api/sales/call-script', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) { content.textContent = 'Помилка завантаження'; return; }
            const data = await res.json();

            if (!data.script || !data.script.steps) {
                content.textContent = 'Скрипт не налаштовано';
                return;
            }

            const steps = typeof data.script.steps === 'string'
                ? JSON.parse(data.script.steps)
                : data.script.steps;

            content.innerHTML = steps.map(s =>
                `<div class="script-step">
                    <div class="script-step-num">${s.step}</div>
                    <div class="script-step-body">
                        <div class="script-step-title">${escapeHtml(s.title)}</div>
                        <div class="script-step-text">${escapeHtml(s.text)}</div>
                    </div>
                </div>`
            ).join('');

            callScriptLoaded = true;
        } catch (e) {
            content.textContent = 'Помилка з\'єднання';
        }
    }

    // Load and show upsell suggestions when a program is selected
    async function showUpsells() {
        const section = document.getElementById('upsellSection');
        const list = document.getElementById('upsellList');
        if (!section || !list) return;

        try {
            if (upsellCatalog.length === 0) {
                const token = localStorage.getItem('pzp_token');
                const res = await fetch((window.API_BASE || '') + '/api/sales/upsells', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    upsellCatalog = data.upsells || [];
                }
            }

            if (upsellCatalog.length === 0) { section.classList.add('hidden'); return; }

            list.innerHTML = upsellCatalog.map(u =>
                `<label class="upsell-item">
                    <input type="checkbox" class="upsell-check" data-name="${escapeHtml(u.name)}" data-price="${u.default_price}">
                    <span class="upsell-name">${escapeHtml(u.name)}</span>
                    <span class="upsell-price">${u.default_price ? '+' + formatPrice(u.default_price) : ''}</span>
                </label>`
            ).join('');

            section.classList.remove('hidden');
        } catch (e) {
            section.classList.add('hidden');
        }
    }

    // Hide upsells
    function hideUpsells() {
        const section = document.getElementById('upsellSection');
        if (section) section.classList.add('hidden');
    }

    // Get selected upsells
    function getSelectedUpsells() {
        const checks = document.querySelectorAll('.upsell-check:checked');
        return Array.from(checks).map(c => ({
            name: c.dataset.name,
            price: parseFloat(c.dataset.price) || 0
        }));
    }

    // Update price-per-child display
    function updatePricePerChild(price, kidsCount) {
        const section = document.getElementById('pricePerChildSection');
        const info = document.getElementById('pricePerChildInfo');
        if (!section || !info) return;

        if (!price || !kidsCount || kidsCount < 2) {
            section.classList.add('hidden');
            return;
        }

        const perChild = Math.round(price / kidsCount);
        info.innerHTML = `<span class="per-child-label">Ціна за дитину:</span> <span class="per-child-value">${formatPrice(perChild)}</span> <span class="per-child-total">(${kidsCount} дітей)</span>`;
        section.classList.remove('hidden');
    }

    // Load free slots hint
    async function loadFreeSlotsHint() {
        const hint = document.getElementById('freeSlotsHint');
        if (!hint) return;

        try {
            const token = localStorage.getItem('pzp_token');
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();

            const res = await fetch((window.API_BASE || '') + `/api/sales/free-slots?month=${month}&year=${year}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();

            if (data.freeWeekends > 0 && data.freeWeekends <= 4) {
                hint.innerHTML = `<span class="free-slots-icon">&#128197;</span> Вільних вихідних у ${getMonthName(month)}: <b>${data.freeWeekends}</b><br><small>Популярні дати займаються швидко</small>`;
                hint.classList.remove('hidden');
            } else {
                hint.classList.add('hidden');
            }
        } catch (e) {
            hint.classList.add('hidden');
        }
    }

    function getMonthName(month) {
        const names = ['', 'січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'];
        return names[month] || '';
    }

    function formatPrice(n) {
        return Math.round(n).toLocaleString('uk-UA') + ' грн';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return {
        init,
        showUpsells,
        hideUpsells,
        getSelectedUpsells,
        updatePricePerChild,
        loadFreeSlotsHint,
        toggleCallScript
    };
})();

// Auto-init when loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SalesPanel.init());
} else {
    SalesPanel.init();
}
