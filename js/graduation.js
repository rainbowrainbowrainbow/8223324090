/**
 * js/graduation.js — Graduation Event Builder (v30.3.0)
 * Конструктор випускного: вибір послуг, підрахунок, збереження, КП
 * Features: auto-entry, collapse, color-code, timeline, conflicts,
 *   customer bind, share link, analytics, FAB, comparison, recommendations
 */
(function () {
    'use strict';

    let services = [];
    let packages = [];
    let quotes = [];
    let settings = {};
    let selectedServiceIds = new Set();
    let currentTab = 'constructor';
    let userRole = 'manager';
    let collapsedCategories = new Set();
    let comparePackageSlugs = new Set();
    let analyticsData = null;

    // #14: Category colors
    const CATEGORY_COLORS = {
        main: { bg: 'rgba(201,168,76,0.12)', border: '#C9A84C', text: '#C9A84C' },
        show: { bg: 'rgba(139,92,246,0.12)', border: '#8B5CF6', text: '#8B5CF6' },
        masterclass: { bg: 'rgba(16,185,129,0.12)', border: '#10B981', text: '#10B981' },
        neon: { bg: 'rgba(236,72,153,0.12)', border: '#EC4899', text: '#EC4899' },
        game: { bg: 'rgba(59,130,246,0.12)', border: '#3B82F6', text: '#3B82F6' },
        extra: { bg: 'rgba(156,163,175,0.12)', border: '#9CA3AF', text: '#9CA3AF' }
    };

    // #11: Service icons (emoji per service name keyword)
    const SERVICE_ICONS = {
        'Анімація 2': '🎭🎭',
        'Анімація': '🎭',
        'Велком': '👋',
        'Капсула': '💌',
        'Видача': '🎓',
        'Вхід': '🎟️',
        'Бульбашок': '🫧',
        'Паперова дискотека': '🎉',
        'сухим льодом': '🧊',
        'Мафія': '🕵️',
        'Аквагрим': '🎨',
        'Тимчасові тату': '✨',
        'Розпис': '👕',
        'Слайм': '🧪',
        'Піца': '🍕',
        'Термомозаїка': '🧩',
        'Тематична': '🎪',
        'Солодка вата': '🍭',
        'Бармен': '🍹',
        'кальмара': '🦑',
        'Подарунки': '🎁',
        'Неонова паперова': '💜🎉',
        'Неонові мильні': '💜🫧',
        'Неоновий аквагрим': '💜🎨'
    };

    // #34: Conflict rules (mutually exclusive services)
    const CONFLICT_RULES = [
        { names: ['Анімація', 'Анімація 2 години'], message: 'Обирайте одну: Анімація 1 або 2 години' },
        { names: ['Аквагрим', 'Неоновий аквагрим'], message: 'Звичайний і неоновий аквагрим — одне з двох' },
        { names: ['Програма "Гра в кальмара" Ч.1'], requires: ['Програма "Гра в кальмара" Ч.2'], message: 'Рекомендуємо обидві частини Гри в кальмара' }
    ];

    function getUserRole() {
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) return 'manager';
            const parts = token.split('.');
            if (parts.length < 2) return 'manager';
            const payload = JSON.parse(atob(parts[1]));
            return payload.role || 'manager';
        } catch (e) { return 'manager'; }
    }

    function isDirector() {
        return ['creator', 'director'].includes(userRole);
    }

    // === PRICING FORMULAS ===

    function getCoefficient() { return settings.coefficient?.value || 6.0; }
    function getMarkup() { return settings.markup?.value || 1.15; }
    function getMinPricePerChild() { return settings.min_price_per_child?.value || 599; }
    function getKickbackRate() { return settings.kickback_rate?.value || 0.10; }
    function getMkExternalRate() { return settings.mk_external_rate?.value || 0.80; }

    function roundUpTen(x) { return Math.ceil(x / 10) * 10; }

    function calcFormulaPrice(pricePark) {
        if (!pricePark) return 0;
        return roundUpTen(pricePark / getCoefficient() * getMarkup());
    }

    function getEffectivePrice(svc) {
        if (svc.priceType === 'formula' && svc.pricePark) return calcFormulaPrice(svc.pricePark);
        return svc.pricePerChild || 0;
    }

    function getKidsCount() {
        const pkgEl = document.getElementById('gradPkgKids');
        if (currentTab === 'packages' && pkgEl) return Math.max(1, parseInt(pkgEl.value) || 15);
        const el = document.getElementById('gradKidsCount');
        return el ? Math.max(1, parseInt(el.value) || 15) : 15;
    }

    function getDiscount() {
        const el = document.getElementById('gradDiscount');
        return el ? Math.max(0, Math.min(100, parseFloat(el.value) || 0)) / 100 : 0;
    }

    function calcEntryCount(kids, rule) {
        if (!rule) return kids;
        const thresholds = Object.keys(rule).map(Number).sort((a, b) => a - b);
        for (const t of thresholds) { if (kids <= t) return rule[String(t)]; }
        return rule[String(thresholds[thresholds.length - 1])] || kids;
    }

    function calcServiceCost(svc, kids) {
        if (svc.costType === 'mk_external') return null;
        let cost = (svc.costHost || 0) + (svc.costCostume || 0) +
            (svc.costDelivery || 0) + (svc.costIce || 0) +
            (svc.costOther || 0) + (svc.costBox || 0) +
            (svc.costMarkers || 0) + (svc.costSolution || 0) +
            (svc.costCleaning || 0);
        cost += (svc.costBalloonsPerKid || 0) * kids;
        cost += (svc.costAquagrimPerKid || 0) * kids;
        cost += (svc.costPrintPerKid || 0) * kids;
        cost += (svc.costDesignPerKid || 0) * kids;
        cost += (svc.costDrinksPerKid || 0) * kids;
        return cost;
    }

    // #35: Animator calculation
    function calcAnimators(kids) {
        if (kids <= 10) return 1;
        if (kids <= 20) return 2;
        return Math.ceil(kids / 10);
    }

    function calcTotals() {
        const kids = getKidsCount();
        const discount = getDiscount();
        const selected = services.filter(s => selectedServiceIds.has(s.id));

        let perChildSum = 0;
        let entryFlat = 0;
        let totalDuration = 0;
        let totalCost = 0;

        for (const svc of selected) {
            const price = getEffectivePrice(svc);
            if (svc.entryRule) {
                entryFlat += price * calcEntryCount(kids, svc.entryRule);
            } else {
                perChildSum += price;
            }
            totalDuration += svc.durationMin || 0;
            if (svc.costType === 'mk_external') {
                totalCost += price * kids * (1 - discount) * getMkExternalRate();
            } else {
                const cost = calcServiceCost(svc, kids);
                if (cost !== null) totalCost += cost;
            }
        }

        const grossTotal = perChildSum * kids + entryFlat;
        const totalAll = grossTotal * (1 - discount);
        const totalPerChild = kids > 0 ? Math.round(grossTotal / kids) : 0;
        const profit = totalAll - totalCost;
        const margin = totalAll > 0 ? (profit / totalAll * 100) : 0;
        const kickback = totalAll * getKickbackRate();
        const animators = calcAnimators(kids);

        return { totalPerChild, totalAll, totalCost, profit, margin, kickback, totalDuration, kids, discount, animators, entryFlat };
    }

    // === API ===

    async function gradApi(method, path, body) {
        const result = await apiCall(method, path, body, { fallback: null });
        if (result === null || result === undefined) throw new Error('API error');
        if (result.success === false) throw new Error(result.error || 'API error');
        return result;
    }

    async function loadAll() {
        try {
            const [svc, pkg, sett] = await Promise.all([
                apiCall('GET', '/graduation/services', null, { fallback: [] }),
                apiCall('GET', '/graduation/packages', null, { fallback: [] }),
                apiCall('GET', '/graduation/settings', null, { fallback: {} })
            ]);
            services = Array.isArray(svc) ? svc : [];
            packages = Array.isArray(pkg) ? pkg : [];
            settings = (sett && typeof sett === 'object' && !Array.isArray(sett)) ? sett : {};

            // #40: Auto-add Entry service
            autoAddEntry();

            // #23: Load from URL params
            loadFromURL();

            // Restore collapsed state
            try {
                const saved = localStorage.getItem('grad_collapsed');
                if (saved) collapsedCategories = new Set(JSON.parse(saved));
            } catch (e) { /* ignore */ }

            renderCurrentTab();
        } catch (err) {
            console.error('[Graduation] loadAll error:', err);
            showNotification('Помилка завантаження даних', 'error');
        }
    }

    // #40: Auto-add entry service
    function autoAddEntry() {
        const entry = services.find(s => s.name === 'Вхід');
        if (entry && !selectedServiceIds.has(entry.id)) {
            selectedServiceIds.add(entry.id);
        }
    }

    // #23: Load selection from URL
    function loadFromURL() {
        const params = new URLSearchParams(window.location.search);
        const svcParam = params.get('svc');
        const kidsParam = params.get('kids');
        const discParam = params.get('disc');

        if (svcParam) {
            const ids = svcParam.split(',').map(Number).filter(n => n > 0);
            if (ids.length > 0) {
                selectedServiceIds.clear();
                ids.forEach(id => selectedServiceIds.add(id));
                autoAddEntry(); // Always ensure entry
            }
        }
        // Kids and discount are set after render
        if (kidsParam || discParam) {
            setTimeout(() => {
                if (kidsParam) {
                    const el = document.getElementById('gradKidsCount');
                    if (el) el.value = Math.max(1, Math.min(99, parseInt(kidsParam) || 15));
                }
                if (discParam) {
                    const el = document.getElementById('gradDiscount');
                    if (el) el.value = Math.max(0, Math.min(100, parseFloat(discParam) || 0));
                }
                recalc();
            }, 100);
        }
    }

    // #23: Generate share URL
    function generateShareLink() {
        const ids = Array.from(selectedServiceIds).join(',');
        const kids = getKidsCount();
        const disc = getDiscount() * 100;
        const base = window.location.origin + window.location.pathname;
        let url = `${base}?svc=${ids}&kids=${kids}`;
        if (disc > 0) url += `&disc=${disc}`;
        return url;
    }

    function copyShareLink() {
        if (selectedServiceIds.size === 0) {
            showNotification('Оберіть хоча б одну послугу', 'error');
            return;
        }
        const url = generateShareLink();
        navigator.clipboard.writeText(url).then(() => {
            showNotification('Посилання скопійовано', 'success');
        }).catch(() => {
            // Fallback
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            showNotification('Посилання скопійовано', 'success');
        });
    }

    async function loadQuotes() {
        try {
            quotes = await gradApi('GET', '/graduation/quotes');
        } catch (err) {
            quotes = [];
        }
    }

    // === RENDERING ===

    const CATEGORY_LABELS = {
        main: 'Основне',
        show: 'Шоу програми',
        masterclass: 'Майстер-класи',
        neon: 'Неонові програми',
        game: 'Ігрові програми',
        extra: 'Додатково'
    };

    const CATEGORY_ICONS = {
        main: '🎭',
        show: '✨',
        masterclass: '🎨',
        neon: '💜',
        game: '🎮',
        extra: '🎁'
    };

    function getServiceIcon(svc) {
        for (const [key, icon] of Object.entries(SERVICE_ICONS)) {
            if (svc.name.includes(key)) return icon;
        }
        return CATEGORY_ICONS[svc.category] || '📌';
    }

    // #34: Check conflicts
    function getConflicts() {
        const selectedNames = services.filter(s => selectedServiceIds.has(s.id)).map(s => s.name);
        const warnings = [];
        for (const rule of CONFLICT_RULES) {
            if (rule.names) {
                const matched = rule.names.filter(n => selectedNames.includes(n));
                if (matched.length > 1) {
                    warnings.push(rule.message);
                }
            }
        }
        return warnings;
    }

    // #28: Min/max kids warnings
    function getKidsWarnings() {
        const kids = getKidsCount();
        const warnings = [];
        for (const svc of services) {
            if (!selectedServiceIds.has(svc.id)) continue;
            if (svc.minKids > 0 && kids < svc.minKids) {
                warnings.push(`"${svc.name}" — мінімум ${svc.minKids} дітей`);
            }
            if (svc.maxKids > 0 && kids > svc.maxKids) {
                warnings.push(`"${svc.name}" — максимум ${svc.maxKids} дітей`);
            }
        }
        return warnings;
    }

    // #30: Recommendations based on packages
    function getRecommendations() {
        const selectedIds = new Set(selectedServiceIds);
        if (selectedIds.size === 0) return [];

        const recs = new Map();
        for (const pkg of packages) {
            const pkgServiceIds = pkg.services.map(s => s.serviceId);
            const overlap = pkgServiceIds.filter(id => selectedIds.has(id));
            if (overlap.length > 0 && overlap.length < pkgServiceIds.length) {
                const missing = pkgServiceIds.filter(id => !selectedIds.has(id));
                for (const id of missing) {
                    const svc = services.find(s => s.id === id);
                    if (svc && svc.name !== 'Вхід') {
                        const count = (recs.get(id) || { svc, count: 0 }).count + 1;
                        recs.set(id, { svc, count });
                    }
                }
            }
        }

        return Array.from(recs.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(r => r.svc);
    }

    function renderCurrentTab() {
        document.querySelectorAll('.grad-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
        const content = document.getElementById('gradContent');
        if (!content) return;

        switch (currentTab) {
            case 'constructor': renderConstructor(content); break;
            case 'packages': renderPackages(content); break;
            case 'quotes': renderQuotes(content); break;
            case 'settings': renderSettings(content); break;
            case 'analytics': renderAnalytics(content); break;
        }

        // #43: FAB button for mobile
        renderFAB();
    }

    function renderConstructor(container) {
        const groups = {};
        const categoryOrder = ['main', 'show', 'masterclass', 'neon', 'game', 'extra'];
        for (const cat of categoryOrder) groups[cat] = [];
        for (const svc of services) {
            const cat = svc.category || 'main';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(svc);
        }

        const totals = calcTotals();
        const minPrice = getMinPricePerChild();
        const belowMin = totals.totalPerChild > 0 && totals.totalPerChild < minPrice;
        const conflicts = getConflicts();
        const kidsWarnings = getKidsWarnings();
        const recommendations = getRecommendations();
        const selectedCount = selectedServiceIds.size;

        let html = `
        <div class="grad-controls">
            <div class="grad-control-row">
                <div class="grad-field">
                    <label>Кількість дітей</label>
                    <div class="grad-stepper">
                        <button class="grad-stepper-btn" onclick="GradPage.adjustKids(-1)">−</button>
                        <input type="number" id="gradKidsCount" value="15" min="1" max="99"
                            onchange="GradPage.recalc()" style="font-size:16px">
                        <button class="grad-stepper-btn" onclick="GradPage.adjustKids(1)">+</button>
                    </div>
                </div>
                <div class="grad-field">
                    <label>Знижка %</label>
                    <input type="number" id="gradDiscount" value="0" min="0" max="100"
                        onchange="GradPage.recalc()" style="font-size:16px">
                </div>
                ${isDirector() ? `
                <div class="grad-field director-only">
                    <label>Коефіцієнт</label>
                    <input type="number" id="gradCoeff" value="${getCoefficient()}" step="0.1" min="1"
                        onchange="GradPage.updateCoeff()" style="font-size:16px">
                </div>
                <div class="grad-field director-only">
                    <label>Надбавка</label>
                    <input type="number" id="gradMarkup" value="${getMarkup()}" step="0.01" min="1"
                        onchange="GradPage.updateMarkup()" style="font-size:16px">
                </div>
                ` : ''}
                <div class="grad-field grad-field-actions">
                    <button class="grad-btn grad-btn-sm grad-btn-clear" onclick="GradPage.clearAll()" title="Очистити все"
                        ${selectedCount <= 1 ? 'disabled' : ''}>
                        ✕ Очистити
                    </button>
                    <button class="grad-btn grad-btn-sm grad-btn-share" onclick="GradPage.copyShareLink()" title="Скопіювати посилання">
                        🔗 Поділитись
                    </button>
                </div>
            </div>
        </div>

        ${conflicts.length > 0 ? `
        <div class="grad-warnings grad-conflicts">
            ${conflicts.map(w => `<div class="grad-warning-item">⚠️ ${w}</div>`).join('')}
        </div>` : ''}

        ${kidsWarnings.length > 0 ? `
        <div class="grad-warnings grad-kids-warnings">
            ${kidsWarnings.map(w => `<div class="grad-warning-item">👶 ${w}</div>`).join('')}
        </div>` : ''}

        <div class="grad-services-grid">
        ${categoryOrder.map(cat => {
            const items = groups[cat];
            if (!items || items.length === 0) return '';
            const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.main;
            const isCollapsed = collapsedCategories.has(cat);
            const selectedInCat = items.filter(s => selectedServiceIds.has(s.id)).length;
            return `
            <div class="grad-category" data-cat="${cat}">
                <h3 class="grad-category-title" style="color:${colors.text};border-left:3px solid ${colors.border};padding-left:8px"
                    onclick="GradPage.toggleCategory('${cat}')">
                    ${CATEGORY_ICONS[cat] || ''} ${CATEGORY_LABELS[cat] || cat}
                    ${selectedInCat > 0 ? `<span class="grad-cat-count" style="background:${colors.bg};color:${colors.text}">${selectedInCat}</span>` : ''}
                    <span class="grad-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
                </h3>
                <div class="grad-category-items ${isCollapsed ? 'grad-collapsed' : ''}">
                ${items.map(svc => renderServiceCard(svc, colors)).join('')}
                </div>
            </div>`;
        }).join('')}
        </div>

        ${recommendations.length > 0 ? `
        <div class="grad-recommendations">
            <div class="grad-rec-title">💡 Часто додають</div>
            <div class="grad-rec-items">
                ${recommendations.map(svc => `
                <button class="grad-rec-btn" onclick="GradPage.toggleService(${svc.id})">
                    ${getServiceIcon(svc)} ${svc.name} <span class="grad-rec-price">${formatPrice(getEffectivePrice(svc))}</span>
                </button>`).join('')}
            </div>
        </div>` : ''}

        ${renderTimeline(totals)}

        <div class="grad-summary ${belowMin ? 'grad-summary-error' : ''}">
            ${belowMin ? `<div class="grad-error">⚠️ Мінімум ${minPrice} ₴/дитина!</div>` : ''}
            <div class="grad-summary-grid">
                <div class="grad-summary-item">
                    <span class="grad-summary-label">👶 Вартість 1 дитина</span>
                    <span class="grad-summary-value">${formatPrice(totals.totalPerChild)}</span>
                </div>
                <div class="grad-summary-item">
                    <span class="grad-summary-label">💰 Всього (${totals.kids} діт.)</span>
                    <span class="grad-summary-value grad-summary-main">${formatPrice(totals.totalAll)}</span>
                </div>
                <div class="grad-summary-item">
                    <span class="grad-summary-label">⏱️ Тривалість</span>
                    <span class="grad-summary-value">${formatDuration(totals.totalDuration)}</span>
                </div>
                <div class="grad-summary-item">
                    <span class="grad-summary-label">🎭 Аніматорів</span>
                    <span class="grad-summary-value">${totals.animators}</span>
                </div>
                ${isDirector() ? `
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">📊 Собівартість</span>
                    <span class="grad-summary-value">${formatPrice(totals.totalCost)}</span>
                </div>
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">📈 Дохід</span>
                    <span class="grad-summary-value" style="color:#10B981">${formatPrice(totals.profit)}</span>
                </div>
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">📉 Маржа</span>
                    <span class="grad-summary-value">${totals.margin.toFixed(1)}%</span>
                </div>
                ` : ''}
                ${userRole === 'creator' ? `
                <div class="grad-summary-item creator-only">
                    <span class="grad-summary-label">💸 Відкат (10%)</span>
                    <span class="grad-summary-value" style="color:#EF4444">${formatPrice(totals.kickback)}</span>
                </div>
                ` : ''}
            </div>

            <div class="grad-customer-row" id="gradCustomerRow">
                <label>👤 Клієнт</label>
                <div class="grad-customer-search">
                    <input type="text" id="gradCustomerSearch" placeholder="Пошук за ім'ям або телефоном..."
                        oninput="GradPage.searchCustomer(this.value)" autocomplete="off" style="font-size:16px">
                    <div class="grad-customer-results" id="gradCustomerResults" style="display:none"></div>
                    <input type="hidden" id="gradCustomerId" value="">
                </div>
            </div>

            <div class="grad-actions">
                <button class="grad-btn grad-btn-primary" onclick="GradPage.saveQuote()">
                    💾 Зберегти
                </button>
                <button class="grad-btn grad-btn-secondary" onclick="GradPage.generateProposal()">
                    📄 КП клієнту
                </button>
                <button class="grad-btn grad-btn-secondary" onclick="GradPage.printProposal()">
                    🖨️ Друк
                </button>
            </div>
        </div>`;

        container.innerHTML = html;
    }

    // #13: Timeline progress bar
    function renderTimeline(totals) {
        const selected = services.filter(s => selectedServiceIds.has(s.id) && s.durationMin > 0);
        if (selected.length === 0) return '';

        const totalMin = totals.totalDuration;
        return `
        <div class="grad-timeline">
            <div class="grad-timeline-header">
                <span>⏱️ Програма: ${formatDuration(totalMin)}</span>
            </div>
            <div class="grad-timeline-bar">
                ${selected.map(svc => {
                    const pct = (svc.durationMin / totalMin * 100).toFixed(1);
                    const colors = CATEGORY_COLORS[svc.category] || CATEGORY_COLORS.main;
                    return `<div class="grad-timeline-segment" style="width:${pct}%;background:${colors.border}"
                        title="${svc.name}: ${svc.durationMin} хв">
                        ${pct > 12 ? `<span class="grad-tl-label">${svc.name.split(' ')[0]}</span>` : ''}
                    </div>`;
                }).join('')}
            </div>
            <div class="grad-timeline-legend">
                ${selected.map(svc => {
                    const colors = CATEGORY_COLORS[svc.category] || CATEGORY_COLORS.main;
                    return `<span class="grad-tl-legend-item">
                        <span class="grad-tl-dot" style="background:${colors.border}"></span>
                        ${svc.name} — ${svc.durationMin} хв
                    </span>`;
                }).join('')}
            </div>
        </div>`;
    }

    function renderServiceCard(svc, colors) {
        const checked = selectedServiceIds.has(svc.id);
        const price = getEffectivePrice(svc);
        const kids = getKidsCount();
        const isFormula = svc.priceType === 'formula';
        const isEntry = !!svc.entryRule;
        const icon = getServiceIcon(svc);

        // #15: Popularity badge
        let badge = '';
        if (analyticsData?.popularity) {
            const pop = analyticsData.popularity.find(p => p.serviceId === svc.id);
            if (pop && pop.percentage >= 60) badge = '<span class="grad-badge grad-badge-hit">ХІТ</span>';
        }

        let entryNote = '';
        if (svc.entryRule) {
            const count = calcEntryCount(kids, svc.entryRule);
            entryNote = `<span class="grad-entry-note" style="color:${colors.text}">${count} вх. × ${price} ₴</span>`;
        }

        return `
        <label class="grad-service-card ${checked ? 'grad-service-selected' : ''}"
               style="${checked ? `border-color:${colors.border};background:${colors.bg}` : ''}"
               data-id="${svc.id}">
            <div class="grad-service-check">
                <input type="checkbox" ${checked ? 'checked' : ''} ${isEntry ? 'disabled' : ''}
                    onchange="GradPage.toggleService(${svc.id})"
                    style="accent-color:${colors.border}">
            </div>
            <div class="grad-service-icon">${icon}</div>
            <div class="grad-service-info">
                <div class="grad-service-name">${svc.name} ${badge}</div>
                <div class="grad-service-meta">
                    ${svc.durationMin ? `<span>${svc.durationMin} хв</span>` : ''}
                    <span class="grad-price-badge ${isFormula ? 'grad-formula' : 'grad-fixed'}">
                        ${isFormula ? 'формула' : 'фікс'}
                    </span>
                    ${entryNote}
                </div>
            </div>
            <div class="grad-service-price" style="color:${colors.text}">
                ${formatPrice(price)}
                <span class="grad-price-unit">${isEntry ? '/вх' : '/дит'}</span>
            </div>
            <button class="grad-info-btn" onclick="event.preventDefault();event.stopPropagation();GradPage.showInfo(${svc.id})" title="Детальніше">i</button>
        </label>`;
    }

    function renderPackages(container) {
        const kids = getKidsCount();
        let html = `
        <div class="grad-packages-kids-row">
            <label>Кількість дітей:</label>
            <div class="grad-stepper">
                <button class="grad-stepper-btn" onclick="GradPage.adjustPkgKids(-1)">−</button>
                <input type="number" id="gradPkgKids" value="${kids}" min="1" max="99"
                    onchange="GradPage.recalcPackages()" style="font-size:16px">
                <button class="grad-stepper-btn" onclick="GradPage.adjustPkgKids(1)">+</button>
            </div>
            <button class="grad-btn grad-btn-sm" onclick="GradPage.showComparison()" ${comparePackageSlugs.size < 2 ? 'disabled' : ''}>
                📊 Порівняти (${comparePackageSlugs.size})
            </button>
        </div>
        <div class="grad-packages-grid">`;

        for (const pkg of packages) {
            let totalPerChild = 0;
            const rows = [];
            for (const item of pkg.services) {
                const svc = services.find(s => s.id === item.serviceId);
                if (svc) {
                    const price = item.overridePrice || getEffectivePrice(svc);
                    totalPerChild += price;
                    rows.push({ name: svc.name, price, icon: svc ? getServiceIcon(svc) : '' });
                }
            }
            const totalAll = totalPerChild * kids;
            const isComparing = comparePackageSlugs.has(pkg.slug);

            // #18: Gradient per package
            const gradients = {
                'best-dj': 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(139,92,246,0.02))',
                'super-party': 'linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.02))',
                'science-party': 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))',
                'handmade-party': 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))',
                'pizza-party': 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
                'squid-game': 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))',
                'neon-party': 'linear-gradient(135deg, rgba(236,72,153,0.08), rgba(236,72,153,0.02))'
            };
            const borderColors = {
                'best-dj': '#8B5CF6', 'super-party': '#C9A84C', 'science-party': '#3B82F6',
                'handmade-party': '#10B981', 'pizza-party': '#F59E0B', 'squid-game': '#EF4444',
                'neon-party': '#EC4899'
            };
            const gradient = gradients[pkg.slug] || '';
            const borderColor = borderColors[pkg.slug] || '#C9A84C';

            html += `
            <div class="grad-package-card" style="background:${gradient};border-top:3px solid ${borderColor}">
                <div class="grad-package-header">
                    <div class="grad-package-name">${pkg.name}</div>
                    <label class="grad-compare-check" title="Порівняти">
                        <input type="checkbox" ${isComparing ? 'checked' : ''}
                            onchange="GradPage.toggleCompare('${pkg.slug}')">
                        📊
                    </label>
                </div>
                <table class="grad-package-table">
                    <tbody>
                        ${rows.map(r => `
                        <tr>
                            <td class="grad-pkg-svc-name">${r.icon} ${r.name}</td>
                            <td class="grad-pkg-svc-price">${formatPrice(r.price)}</td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot>
                        <tr class="grad-pkg-total-row">
                            <td>Вартість 1 дитина</td>
                            <td>${formatPrice(totalPerChild)}</td>
                        </tr>
                        <tr class="grad-pkg-total-all-row">
                            <td>Всього (${kids} дітей)</td>
                            <td>${formatPrice(totalAll)}</td>
                        </tr>
                    </tfoot>
                </table>
                <button class="grad-btn grad-btn-sm grad-pkg-select-btn" onclick="GradPage.selectPackage('${pkg.slug}')">Обрати пакет</button>
            </div>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    // #8: Package comparison modal
    function showComparison() {
        if (comparePackageSlugs.size < 2) {
            showNotification('Оберіть мінімум 2 пакети для порівняння', 'error');
            return;
        }

        const pkgs = packages.filter(p => comparePackageSlugs.has(p.slug));
        const kids = getKidsCount();

        // Collect all unique services across selected packages
        const allServiceIds = new Set();
        for (const pkg of pkgs) {
            for (const item of pkg.services) allServiceIds.add(item.serviceId);
        }

        const allSvcs = Array.from(allServiceIds).map(id => services.find(s => s.id === id)).filter(Boolean);
        allSvcs.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        let rows = allSvcs.map(svc => {
            const cells = pkgs.map(pkg => {
                const item = pkg.services.find(i => i.serviceId === svc.id);
                return item ? '✅' : '—';
            });
            return `<tr><td>${getServiceIcon(svc)} ${svc.name}</td>${cells.map(c => `<td style="text-align:center">${c}</td>`).join('')}</tr>`;
        });

        // Totals row
        const totalCells = pkgs.map(pkg => {
            let total = 0;
            for (const item of pkg.services) {
                const svc = services.find(s => s.id === item.serviceId);
                if (svc) total += item.overridePrice || getEffectivePrice(svc);
            }
            return `<td style="text-align:center;font-weight:800;color:#C9A84C">${formatPrice(total)}/дит</td>`;
        });

        const modal = document.getElementById('gradInfoModal');
        if (!modal) return;
        modal.querySelector('.grad-modal-content').innerHTML = `
        <div class="grad-modal-header">
            <h3>📊 Порівняння пакетів</h3>
            <button class="grad-modal-close" onclick="document.getElementById('gradInfoModal').style.display='none'">&times;</button>
        </div>
        <div class="grad-modal-body" style="overflow-x:auto">
            <table class="grad-compare-table">
                <thead>
                    <tr><th>Послуга</th>${pkgs.map(p => `<th>${p.name}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
                <tfoot>
                    <tr><td><strong>Разом</strong></td>${totalCells.join('')}</tr>
                </tfoot>
            </table>
        </div>`;
        modal.style.display = 'flex';
    }

    async function renderQuotes(container) {
        await loadQuotes();
        const statusLabels = { draft: 'Чернетка', sent: 'Відправлено', approved: 'Погоджено', booked: 'Заброньовано', cancelled: 'Скасовано' };
        const statusColors = { draft: '#9CA3AF', sent: '#3B82F6', approved: '#10B981', booked: '#C9A84C', cancelled: '#EF4444' };
        const statusIcons = { draft: '📝', sent: '📤', approved: '✅', booked: '📅', cancelled: '❌' };

        let html = `
        <div class="grad-quotes-filter">
            <button class="grad-filter-btn active" onclick="GradPage.filterQuotes('',this)">Всі</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('draft',this)">📝 Чернетки</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('sent',this)">📤 Відправлені</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('approved',this)">✅ Погоджені</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('booked',this)">📅 Заброньовані</button>
        </div>
        <div class="grad-quotes-list">`;

        if (quotes.length === 0) {
            html += '<div class="grad-empty">Немає збережених конфігурацій</div>';
        } else {
            for (const q of quotes) {
                html += `
                <div class="grad-quote-row" data-status="${q.status}">
                    <div class="grad-quote-number">${q.quoteNumber}</div>
                    <div class="grad-quote-info">
                        <span>👶 ${q.kidsCount} дітей</span>
                        <span>💰 ${formatPrice(q.totalAll)}</span>
                    </div>
                    <div class="grad-quote-status" style="color:${statusColors[q.status] || '#999'}">
                        ${statusIcons[q.status] || ''} ${statusLabels[q.status] || q.status}
                    </div>
                    <div class="grad-quote-date">${new Date(q.createdAt).toLocaleDateString('uk-UA')}</div>
                    <div class="grad-quote-actions">
                        <button class="grad-btn grad-btn-sm" onclick="GradPage.loadQuote(${q.id})">Відкрити</button>
                        ${q.status !== 'booked' ? `<button class="grad-btn grad-btn-sm" onclick="GradPage.viewProposal(${q.id})">КП</button>` : ''}
                        ${q.status === 'approved' ? `<button class="grad-btn grad-btn-sm grad-btn-book" onclick="GradPage.convertToBooking(${q.id})">📅 Бронювати</button>` : ''}
                    </div>
                </div>`;
            }
        }
        html += '</div>';
        container.innerHTML = html;
    }

    // #46, #47, #48: Analytics tab
    async function renderAnalytics(container) {
        container.innerHTML = '<div class="grad-empty">Завантаження аналітики...</div>';

        try {
            analyticsData = await gradApi('GET', '/graduation/analytics');
        } catch (err) {
            container.innerHTML = '<div class="grad-empty">Помилка завантаження аналітики</div>';
            return;
        }

        const d = analyticsData;
        const funnel = d.funnel;
        const avg = d.averageCheck;

        let html = `
        <div class="grad-analytics">
            <div class="grad-analytics-cards">
                <div class="grad-analytics-card">
                    <div class="grad-analytics-icon">💰</div>
                    <div class="grad-analytics-num">${formatPrice(avg.perChild)}</div>
                    <div class="grad-analytics-label">Середній чек / дитина</div>
                </div>
                <div class="grad-analytics-card">
                    <div class="grad-analytics-icon">📊</div>
                    <div class="grad-analytics-num">${formatPrice(avg.total)}</div>
                    <div class="grad-analytics-label">Середній чек всього</div>
                </div>
                <div class="grad-analytics-card">
                    <div class="grad-analytics-icon">👶</div>
                    <div class="grad-analytics-num">${avg.avgKids}</div>
                    <div class="grad-analytics-label">Середня кількість дітей</div>
                </div>
                <div class="grad-analytics-card">
                    <div class="grad-analytics-icon">📈</div>
                    <div class="grad-analytics-num">${funnel.conversionRate}%</div>
                    <div class="grad-analytics-label">Конверсія → бронювання</div>
                </div>
            </div>

            <h3 class="grad-section-title">Воронка конверсії</h3>
            <div class="grad-funnel">
                ${renderFunnelStep('Всього кошиків', funnel.total, funnel.total, '#9CA3AF')}
                ${renderFunnelStep('Чернетки', funnel.draft, funnel.total, '#9CA3AF')}
                ${renderFunnelStep('Відправлено', funnel.sent, funnel.total, '#3B82F6')}
                ${renderFunnelStep('Погоджено', funnel.approved, funnel.total, '#10B981')}
                ${renderFunnelStep('Заброньовано', funnel.booked, funnel.total, '#C9A84C')}
                ${funnel.cancelled > 0 ? renderFunnelStep('Скасовано', funnel.cancelled, funnel.total, '#EF4444') : ''}
            </div>

            <h3 class="grad-section-title">Популярність послуг</h3>
            <div class="grad-popularity">
                ${d.popularity.map(p => `
                <div class="grad-pop-row">
                    <span class="grad-pop-name">${p.serviceName}</span>
                    <div class="grad-pop-bar-container">
                        <div class="grad-pop-bar" style="width:${p.percentage}%"></div>
                    </div>
                    <span class="grad-pop-pct">${p.percentage}% (${p.count})</span>
                </div>`).join('')}
            </div>
        </div>`;

        container.innerHTML = html;
    }

    function renderFunnelStep(label, value, total, color) {
        const pct = total > 0 ? (value / total * 100).toFixed(0) : 0;
        return `
        <div class="grad-funnel-step">
            <span class="grad-funnel-label">${label}</span>
            <div class="grad-funnel-bar-wrap">
                <div class="grad-funnel-bar" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="grad-funnel-val">${value} (${pct}%)</span>
        </div>`;
    }

    function renderSettings(container) {
        if (!isDirector()) {
            container.innerHTML = '<div class="grad-empty">Доступ лише для директора</div>';
            return;
        }

        let html = `
        <div class="grad-settings">
            <h3>Глобальні параметри</h3>
            <div class="grad-settings-grid">
                ${Object.entries(settings).map(([key, s]) => `
                <div class="grad-setting-item">
                    <label>${s.label || key}</label>
                    <input type="number" value="${s.value}" step="0.01"
                        data-key="${key}" onchange="GradPage.saveSetting(this)" style="font-size:16px">
                </div>`).join('')}
            </div>

            <h3 style="margin-top:24px">Каталог послуг</h3>
            <div class="grad-services-table">
                <div class="grad-table-header">
                    <span>Назва</span>
                    <span>Тип</span>
                    <span>Ціна парку</span>
                    <span>Ціна/дит</span>
                    <span>Категорія</span>
                </div>
                ${services.map(svc => `
                <div class="grad-table-row">
                    <span>${svc.name}</span>
                    <span class="grad-price-badge ${svc.priceType === 'formula' ? 'grad-formula' : 'grad-fixed'}">${svc.priceType}</span>
                    <span>${svc.pricePark || '—'}</span>
                    <span><strong>${getEffectivePrice(svc)} ₴</strong></span>
                    <span>${CATEGORY_LABELS[svc.category] || svc.category}</span>
                </div>`).join('')}
            </div>

            <div class="grad-actions" style="margin-top:16px">
                <button class="grad-btn grad-btn-secondary" onclick="GradPage.resetPrices()">
                    Скинути до стандартних
                </button>
            </div>
        </div>`;

        container.innerHTML = html;
    }

    // #43: FAB button for mobile
    function renderFAB() {
        let fab = document.getElementById('gradFAB');
        if (currentTab !== 'constructor') {
            if (fab) fab.style.display = 'none';
            return;
        }
        if (!fab) {
            fab = document.createElement('button');
            fab.id = 'gradFAB';
            fab.className = 'grad-fab';
            fab.onclick = () => saveQuote();
            fab.innerHTML = '💾';
            fab.title = 'Зберегти кошик';
            document.body.appendChild(fab);
        }
        fab.style.display = selectedServiceIds.size > 1 ? '' : 'none';
    }

    // === ACTIONS ===

    function toggleService(id) {
        // #40: Prevent unchecking entry
        const svc = services.find(s => s.id === id);
        if (svc && svc.entryRule && selectedServiceIds.has(id)) {
            showNotification('Вхід додається автоматично', 'info');
            return;
        }
        if (selectedServiceIds.has(id)) {
            selectedServiceIds.delete(id);
        } else {
            selectedServiceIds.add(id);
        }
        recalc();
    }

    // #10: Clear all
    function clearAll() {
        if (!confirm('Очистити всі обрані послуги?')) return;
        selectedServiceIds.clear();
        autoAddEntry();
        recalc();
    }

    // #2: Toggle category collapse
    function toggleCategory(cat) {
        if (collapsedCategories.has(cat)) {
            collapsedCategories.delete(cat);
        } else {
            collapsedCategories.add(cat);
        }
        // Save to localStorage
        try {
            localStorage.setItem('grad_collapsed', JSON.stringify(Array.from(collapsedCategories)));
        } catch (e) { /* ignore */ }
        renderCurrentTab();
    }

    function recalc() {
        if (currentTab === 'constructor') renderCurrentTab();
    }

    function adjustKids(delta) {
        const el = document.getElementById('gradKidsCount');
        if (!el) return;
        el.value = Math.max(1, Math.min(99, (parseInt(el.value) || 15) + delta));
        recalc();
    }

    function adjustPkgKids(delta) {
        const el = document.getElementById('gradPkgKids');
        if (!el) return;
        el.value = Math.max(1, Math.min(99, (parseInt(el.value) || 15) + delta));
        recalcPackages();
    }

    function recalcPackages() {
        if (currentTab === 'packages') renderCurrentTab();
    }

    function updateCoeff() {
        const el = document.getElementById('gradCoeff');
        if (!el) return;
        settings.coefficient = { ...settings.coefficient, value: parseFloat(el.value) || 6.0 };
        recalc();
    }

    function updateMarkup() {
        const el = document.getElementById('gradMarkup');
        if (!el) return;
        settings.markup = { ...settings.markup, value: parseFloat(el.value) || 1.15 };
        recalc();
    }

    // #8: Toggle package comparison
    function toggleCompare(slug) {
        if (comparePackageSlugs.has(slug)) {
            comparePackageSlugs.delete(slug);
        } else {
            if (comparePackageSlugs.size >= 3) {
                showNotification('Максимум 3 пакети для порівняння', 'error');
                return;
            }
            comparePackageSlugs.add(slug);
        }
        renderCurrentTab();
    }

    async function selectPackage(slug) {
        try {
            const pkg = await gradApi('GET', `/graduation/packages/${slug}`);
            selectedServiceIds.clear();
            for (const svc of pkg.services) selectedServiceIds.add(svc.id);
            autoAddEntry();
            currentTab = 'constructor';
            renderCurrentTab();
            showNotification(`Пакет "${pkg.name}" обрано`, 'success');
        } catch (err) {
            showNotification('Помилка завантаження пакету', 'error');
        }
    }

    // #26: Customer search
    let customerSearchTimer = null;
    async function searchCustomer(query) {
        clearTimeout(customerSearchTimer);
        const results = document.getElementById('gradCustomerResults');
        if (!results) return;

        if (!query || query.length < 2) {
            results.style.display = 'none';
            return;
        }

        customerSearchTimer = setTimeout(async () => {
            try {
                const customers = await gradApi('GET', `/graduation/customers/search?q=${encodeURIComponent(query)}`);
                if (!customers || customers.length === 0) {
                    results.innerHTML = '<div class="grad-customer-empty">Не знайдено</div>';
                    results.style.display = 'block';
                    return;
                }
                results.innerHTML = customers.map(c => `
                    <div class="grad-customer-option" onclick="GradPage.selectCustomer(${c.id}, '${(c.name || '').replace(/'/g, "\\'")}', '${(c.phone || '').replace(/'/g, "\\'")}')">
                        <span class="grad-customer-name">${c.name || 'Без імені'}</span>
                        <span class="grad-customer-phone">${c.phone || ''}</span>
                    </div>`).join('');
                results.style.display = 'block';
            } catch (err) {
                results.style.display = 'none';
            }
        }, 300);
    }

    function selectCustomer(id, name, phone) {
        const searchInput = document.getElementById('gradCustomerSearch');
        const hiddenInput = document.getElementById('gradCustomerId');
        const results = document.getElementById('gradCustomerResults');
        if (searchInput) searchInput.value = `${name} (${phone})`;
        if (hiddenInput) hiddenInput.value = id;
        if (results) results.style.display = 'none';
    }

    async function saveQuote() {
        const totals = calcTotals();
        if (selectedServiceIds.size === 0) {
            showNotification('Оберіть хоча б одну послугу', 'error');
            return;
        }

        const selectedSvcs = services
            .filter(s => selectedServiceIds.has(s.id))
            .map(s => ({ serviceId: s.id, name: s.name, price: getEffectivePrice(s) }));

        const customerId = document.getElementById('gradCustomerId')?.value || null;

        try {
            const quote = await gradApi('POST', '/graduation/quotes', {
                kidsCount: getKidsCount(),
                discountPercent: getDiscount() * 100,
                selectedServices: selectedSvcs,
                totalPerChild: totals.totalPerChild,
                totalAll: totals.totalAll,
                totalCost: totals.totalCost,
                totalProfit: totals.profit,
                profitMargin: totals.margin,
                customerId: customerId ? parseInt(customerId) : null
            });
            showNotification(`Конфігурацію ${quote.quoteNumber} збережено`, 'success');
        } catch (err) {
            showNotification(err.message || 'Помилка збереження', 'error');
        }
    }

    async function loadQuote(id) {
        try {
            const quote = await gradApi('GET', `/graduation/quotes/${id}`);
            const svcList = quote.selectedServices || [];

            selectedServiceIds.clear();
            for (const s of svcList) selectedServiceIds.add(s.serviceId || s.service_id);
            autoAddEntry();

            currentTab = 'constructor';
            renderCurrentTab();

            setTimeout(() => {
                const kidsInput = document.getElementById('gradKidsCount');
                const discInput = document.getElementById('gradDiscount');
                if (kidsInput) kidsInput.value = quote.kidsCount;
                if (discInput) discInput.value = quote.discountPercent;
                recalc();
            }, 50);

            showNotification(`Кошик ${quote.quoteNumber} завантажено`, 'success');
        } catch (err) {
            showNotification('Помилка завантаження кошика', 'error');
        }
    }

    async function generateProposal() {
        const totals = calcTotals();
        if (selectedServiceIds.size === 0) {
            showNotification('Оберіть хоча б одну послугу', 'error');
            return;
        }

        const selectedSvcs = services
            .filter(s => selectedServiceIds.has(s.id))
            .map(s => ({ serviceId: s.id, name: s.name, price: getEffectivePrice(s) }));

        const customerId = document.getElementById('gradCustomerId')?.value || null;

        try {
            const quote = await gradApi('POST', '/graduation/quotes', {
                kidsCount: getKidsCount(),
                discountPercent: getDiscount() * 100,
                selectedServices: selectedSvcs,
                totalPerChild: totals.totalPerChild,
                totalAll: totals.totalAll,
                totalCost: totals.totalCost,
                totalProfit: totals.profit,
                profitMargin: totals.margin,
                customerId: customerId ? parseInt(customerId) : null
            });
            viewProposal(quote.id);
        } catch (err) {
            showNotification(err.message || 'Помилка', 'error');
        }
    }

    // #24: Print proposal
    function printProposal() {
        if (selectedServiceIds.size === 0) {
            showNotification('Оберіть хоча б одну послугу', 'error');
            return;
        }
        generateProposal(); // Will open in new window which can be printed
    }

    function viewProposal(id) {
        const token = localStorage.getItem('pzp_token');
        window.open(`${API_BASE}/graduation/quotes/${id}/proposal?token=${token}`, '_blank');
    }

    // #22: Convert quote to booking
    async function convertToBooking(id) {
        const date = prompt('Дата бронювання (YYYY-MM-DD):');
        if (!date) return;
        const time = prompt('Час початку (HH:MM):', '10:00');
        if (!time) return;

        try {
            const result = await gradApi('POST', `/graduation/quotes/${id}/booking`, { date, time });
            showNotification(`Бронювання ${result.bookingId} створено!`, 'success');
            renderQuotes(document.getElementById('gradContent'));
        } catch (err) {
            showNotification(err.message || 'Помилка створення бронювання', 'error');
        }
    }

    function showInfo(id) {
        const svc = services.find(s => s.id === id);
        if (!svc) return;

        const kids = getKidsCount();
        const price = getEffectivePrice(svc);
        const colors = CATEGORY_COLORS[svc.category] || CATEGORY_COLORS.main;
        const cost = svc.costType === 'mk_external'
            ? price * kids * getMkExternalRate()
            : calcServiceCost(svc, kids);

        const modal = document.getElementById('gradInfoModal');
        if (!modal) return;

        modal.querySelector('.grad-modal-content').innerHTML = `
        <div class="grad-modal-header">
            <h3 style="color:${colors.text}">${getServiceIcon(svc)} ${svc.name}</h3>
            <button class="grad-modal-close" onclick="document.getElementById('gradInfoModal').style.display='none'">&times;</button>
        </div>
        <div class="grad-modal-body">
            <p class="grad-modal-desc">${svc.description || 'Без опису'}</p>
            <div class="grad-modal-details">
                <div class="grad-modal-row"><span>⏱️ Тривалість:</span><span>${svc.durationMin || 0} хв</span></div>
                <div class="grad-modal-row"><span>💰 Ціна за дитину:</span><span>${formatPrice(price)}</span></div>
                <div class="grad-modal-row"><span>📋 Тип ціни:</span><span>${svc.priceType === 'formula' ? 'Формула' : 'Фіксована'}</span></div>
                ${svc.priceType === 'formula' ? `<div class="grad-modal-row"><span>🏢 Ціна парку:</span><span>${formatPrice(svc.pricePark)}</span></div>` : ''}
                ${svc.minKids > 0 ? `<div class="grad-modal-row"><span>👶 Мін. дітей:</span><span>${svc.minKids}</span></div>` : ''}
                ${svc.maxKids > 0 ? `<div class="grad-modal-row"><span>👶 Макс. дітей:</span><span>${svc.maxKids}</span></div>` : ''}
                ${isDirector() ? `
                <hr style="border-color:rgba(255,255,255,0.1);margin:12px 0">
                <div class="grad-modal-row"><span>📊 Собівартість (${kids} діт.):</span><span>${formatPrice(cost)}</span></div>
                <div class="grad-modal-row"><span>📋 Тип витрат:</span><span>${svc.costType === 'mk_external' ? 'МК зовнішній (80%)' : 'Стандарт'}</span></div>
                ` : ''}
            </div>
            ${isDirector() ? `
            <div class="grad-modal-edit">
                <button class="grad-btn grad-btn-sm" onclick="GradPage.editServicePrice(${svc.id})">Редагувати ціну</button>
            </div>
            ` : ''}
        </div>`;

        modal.style.display = 'flex';
    }

    async function editServicePrice(id) {
        const svc = services.find(s => s.id === id);
        if (!svc) return;
        const newPrice = prompt(`Нова ціна за дитину для "${svc.name}":`, getEffectivePrice(svc));
        if (newPrice === null) return;
        const val = parseFloat(newPrice);
        if (isNaN(val) || val < 0) return;

        try {
            await gradApi('PUT', `/graduation/services/${id}`, {
                pricePerChild: val,
                priceType: 'fixed'
            });
            services = await gradApi('GET', '/graduation/services');
            recalc();
            showNotification('Ціну оновлено', 'success');
            document.getElementById('gradInfoModal').style.display = 'none';
        } catch (err) {
            showNotification('Помилка оновлення ціни', 'error');
        }
    }

    async function saveSetting(input) {
        const key = input.dataset.key;
        const value = parseFloat(input.value);
        if (isNaN(value)) return;

        try {
            settings = await gradApi('PUT', '/graduation/settings', { settings: { [key]: value } });
            recalc();
            showNotification('Параметр збережено', 'success');
        } catch (err) {
            showNotification('Помилка збереження', 'error');
        }
    }

    async function resetPrices() {
        if (!confirm('Скинути всі ціни до стандартних?')) return;
        try {
            services = await gradApi('GET', '/graduation/services');
            settings = await gradApi('GET', '/graduation/settings');
            recalc();
            renderCurrentTab();
            showNotification('Ціни скинуто', 'success');
        } catch (err) {
            showNotification('Помилка', 'error');
        }
    }

    function filterQuotes(status, btn) {
        document.querySelectorAll('.grad-filter-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.querySelectorAll('.grad-quote-row').forEach(row => {
            row.style.display = (!status || row.dataset.status === status) ? '' : 'none';
        });
    }

    function switchTab(tab) {
        currentTab = tab;
        if (tab === 'settings' && !isDirector()) currentTab = 'constructor';
        if (tab === 'analytics' && !isDirector()) currentTab = 'constructor';
        renderCurrentTab();
    }

    function formatPrice(val) {
        if (!val) return '0 ₴';
        return Math.round(val).toLocaleString('uk-UA') + ' ₴';
    }

    function formatDuration(min) {
        if (!min) return '0 хв';
        const h = Math.floor(min / 60);
        const m = min % 60;
        if (h === 0) return `${m} хв`;
        if (m === 0) return `${h} год`;
        return `${h} год ${m} хв`;
    }

    function showNotification(msg, type) {
        const notif = document.getElementById('notification');
        if (!notif) return;
        notif.textContent = msg;
        notif.className = 'notification ' + (type || 'info');
        notif.style.display = 'block';
        setTimeout(() => { notif.style.display = 'none'; }, 3000);
    }

    // === INIT ===

    function init() {
        userRole = getUserRole();
        loadAll();

        // Load analytics in background for popularity badges
        if (isDirector()) {
            gradApi('GET', '/graduation/analytics').then(data => {
                analyticsData = data;
            }).catch(() => {});
        }

        document.querySelectorAll('.grad-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        if (!isDirector()) {
            document.querySelector('.grad-tab[data-tab="settings"]')?.style.setProperty('display', 'none');
            document.querySelector('.grad-tab[data-tab="analytics"]')?.style.setProperty('display', 'none');
        }

        // Close customer dropdown on outside click
        document.addEventListener('click', (e) => {
            const results = document.getElementById('gradCustomerResults');
            if (results && !e.target.closest('.grad-customer-search')) {
                results.style.display = 'none';
            }
        });
    }

    // Public API
    window.GradPage = {
        init,
        toggleService,
        recalc,
        adjustKids,
        adjustPkgKids,
        recalcPackages,
        updateCoeff,
        updateMarkup,
        selectPackage,
        saveQuote,
        loadQuote,
        generateProposal,
        printProposal,
        viewProposal,
        showInfo,
        editServicePrice,
        saveSetting,
        resetPrices,
        filterQuotes,
        switchTab,
        clearAll,
        toggleCategory,
        copyShareLink,
        searchCustomer,
        selectCustomer,
        convertToBooking,
        toggleCompare,
        showComparison
    };
})();
