/**
 * js/graduation.js — Graduation Event Builder (v30.0.0)
 * Конструктор випускного: вибір послуг, підрахунок, збереження, КП
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

    // Parse JWT for role
    function getUserRole() {
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) return 'manager';
            const parts = token.split('.');
            if (parts.length < 2) return 'manager';
            const payload = JSON.parse(atob(parts[1]));
            return payload.role || 'manager';
        } catch (e) { console.warn('[Graduation] getUserRole error:', e); return 'manager'; }
    }

    function isDirector() {
        return ['creator', 'director'].includes(userRole);
    }

    // === PRICING FORMULAS ===

    function getCoefficient() {
        return settings.coefficient?.value || 6.0;
    }

    function getMarkup() {
        return settings.markup?.value || 1.15;
    }

    function getMinPricePerChild() {
        return settings.min_price_per_child?.value || 599;
    }

    function getKickbackRate() {
        return settings.kickback_rate?.value || 0.10;
    }

    function getMkExternalRate() {
        return settings.mk_external_rate?.value || 0.80;
    }

    // ROUNDUP to nearest 10: ROUNDUP(x, -1)
    function roundUpTen(x) {
        return Math.ceil(x / 10) * 10;
    }

    function calcFormulaPrice(pricePark) {
        if (!pricePark) return 0;
        return roundUpTen(pricePark / getCoefficient() * getMarkup());
    }

    function getEffectivePrice(svc) {
        if (svc.priceType === 'formula' && svc.pricePark) {
            return calcFormulaPrice(svc.pricePark);
        }
        return svc.pricePerChild || 0;
    }

    function getKidsCount() {
        const el = document.getElementById('gradKidsCount');
        return el ? Math.max(1, parseInt(el.value) || 15) : 15;
    }

    function getDiscount() {
        const el = document.getElementById('gradDiscount');
        return el ? Math.max(0, Math.min(100, parseFloat(el.value) || 0)) / 100 : 0;
    }

    // Entry rule: {"8":1,"16":2,"99":3}
    function calcEntryCount(kids, rule) {
        if (!rule) return kids;
        const thresholds = Object.keys(rule).map(Number).sort((a, b) => a - b);
        for (const t of thresholds) {
            if (kids <= t) return rule[String(t)];
        }
        return rule[String(thresholds[thresholds.length - 1])] || kids;
    }

    function calcServiceCost(svc, kids) {
        if (svc.costType === 'mk_external') return null; // calculated differently
        let cost = (svc.costHost || 0) + (svc.costCostume || 0) +
            (svc.costDelivery || 0) + (svc.costIce || 0) +
            (svc.costOther || 0) + (svc.costBox || 0) +
            (svc.costMarkers || 0) + (svc.costSolution || 0) +
            (svc.costCleaning || 0);
        // Dynamic costs
        cost += (svc.costBalloonsPerKid || 0) * kids;
        cost += (svc.costAquagrimPerKid || 0) * kids;
        cost += (svc.costPrintPerKid || 0) * kids;
        cost += (svc.costDesignPerKid || 0) * kids;
        cost += (svc.costDrinksPerKid || 0) * kids;
        return cost;
    }

    function calcTotals() {
        const kids = getKidsCount();
        const discount = getDiscount();
        const selected = services.filter(s => selectedServiceIds.has(s.id));

        let totalPerChild = 0;
        let totalDuration = 0;
        let totalCost = 0;

        for (const svc of selected) {
            const price = getEffectivePrice(svc);

            // Entry has special quantity logic
            if (svc.entryRule) {
                const entryCount = calcEntryCount(kids, svc.entryRule);
                totalPerChild += price * entryCount;
            } else {
                totalPerChild += price;
            }

            totalDuration += svc.durationMin || 0;

            // Cost calculation
            if (svc.costType === 'mk_external') {
                // MK: cost = total_svc × mk_external_rate
                const svcTotal = price * kids * (1 - discount);
                totalCost += svcTotal * getMkExternalRate();
            } else {
                const cost = calcServiceCost(svc, kids);
                if (cost !== null) totalCost += cost;
            }
        }

        const totalAll = totalPerChild * kids * (1 - discount);
        const profit = totalAll - totalCost;
        const margin = totalAll > 0 ? (profit / totalAll * 100) : 0;
        const kickback = totalAll * getKickbackRate();

        return { totalPerChild, totalAll, totalCost, profit, margin, kickback, totalDuration, kids, discount };
    }

    // === API CALLS (use global apiCall from api.js) ===

    async function gradApi(method, path, body) {
        const result = await apiCall(method, path, body, { fallback: null });
        if (result === null || result === undefined) throw new Error('API error');
        if (result.success === false) throw new Error(result.error || 'API error');
        return result;
    }

    // === DATA LOADING ===

    async function loadAll() {
        try {
            [services, packages, settings] = await Promise.all([
                gradApi('GET','/graduation/services'),
                gradApi('GET','/graduation/packages'),
                gradApi('GET','/graduation/settings')
            ]);
            renderCurrentTab();
        } catch (err) {
            console.error('Failed to load graduation data:', err);
            showNotification('Помилка завантаження даних', 'error');
        }
    }

    async function loadQuotes() {
        try {
            quotes = await gradApi('GET','/graduation/quotes');
        } catch (err) {
            console.error('Failed to load quotes:', err);
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

    function renderCurrentTab() {
        document.querySelectorAll('.grad-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
        const content = document.getElementById('gradContent');
        if (!content) return;

        switch (currentTab) {
            case 'constructor': renderConstructor(content); break;
            case 'packages': renderPackages(content); break;
            case 'quotes': renderQuotes(content); break;
            case 'settings': renderSettings(content); break;
        }
    }

    function renderConstructor(container) {
        // Group services by category
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
            </div>
        </div>

        <div class="grad-services-grid">
        ${categoryOrder.map(cat => {
            const items = groups[cat];
            if (!items || items.length === 0) return '';
            return `
            <div class="grad-category">
                <h3 class="grad-category-title">${CATEGORY_ICONS[cat] || ''} ${CATEGORY_LABELS[cat] || cat}</h3>
                <div class="grad-category-items">
                ${items.map(svc => renderServiceCard(svc)).join('')}
                </div>
            </div>`;
        }).join('')}
        </div>

        <div class="grad-summary ${belowMin ? 'grad-summary-error' : ''}">
            ${belowMin ? `<div class="grad-error">Мінімум ${minPrice} ₴/дитина!</div>` : ''}
            <div class="grad-summary-grid">
                <div class="grad-summary-item">
                    <span class="grad-summary-label">Вартість 1 дитина</span>
                    <span class="grad-summary-value" id="gradTotalPerChild">${formatPrice(totals.totalPerChild)}</span>
                </div>
                <div class="grad-summary-item">
                    <span class="grad-summary-label">Вартість всі діти (${totals.kids})</span>
                    <span class="grad-summary-value grad-summary-main" id="gradTotalAll">${formatPrice(totals.totalAll)}</span>
                </div>
                <div class="grad-summary-item">
                    <span class="grad-summary-label">Тривалість</span>
                    <span class="grad-summary-value" id="gradDuration">${totals.totalDuration} хв</span>
                </div>
                ${isDirector() ? `
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">Собівартість</span>
                    <span class="grad-summary-value">${formatPrice(totals.totalCost)}</span>
                </div>
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">Дохід</span>
                    <span class="grad-summary-value" style="color:#4CAF50">${formatPrice(totals.profit)}</span>
                </div>
                <div class="grad-summary-item director-only">
                    <span class="grad-summary-label">Маржа</span>
                    <span class="grad-summary-value">${totals.margin.toFixed(1)}%</span>
                </div>
                ` : ''}
                ${userRole === 'creator' ? `
                <div class="grad-summary-item creator-only">
                    <span class="grad-summary-label">Відкат (10%)</span>
                    <span class="grad-summary-value" style="color:#E53E3E">${formatPrice(totals.kickback)}</span>
                </div>
                ` : ''}
            </div>

            <div class="grad-actions">
                <button class="grad-btn grad-btn-primary" onclick="GradPage.saveQuote()">
                    Зберегти
                </button>
                <button class="grad-btn grad-btn-secondary" onclick="GradPage.generateProposal()">
                    КП клієнту
                </button>
            </div>
        </div>`;

        container.innerHTML = html;
    }

    function renderServiceCard(svc) {
        const checked = selectedServiceIds.has(svc.id);
        const price = getEffectivePrice(svc);
        const kids = getKidsCount();
        const isFormula = svc.priceType === 'formula';

        // Entry special display
        let entryNote = '';
        if (svc.entryRule) {
            const count = calcEntryCount(kids, svc.entryRule);
            entryNote = `<span class="grad-entry-note">${count} вх. × ${price} ₴</span>`;
        }

        return `
        <label class="grad-service-card ${checked ? 'grad-service-selected' : ''}"
               data-id="${svc.id}">
            <div class="grad-service-check">
                <input type="checkbox" ${checked ? 'checked' : ''}
                    onchange="GradPage.toggleService(${svc.id})">
            </div>
            <div class="grad-service-info">
                <div class="grad-service-name">${svc.name}</div>
                <div class="grad-service-meta">
                    ${svc.durationMin ? `<span>${svc.durationMin} хв</span>` : ''}
                    <span class="grad-price-badge ${isFormula ? 'grad-formula' : 'grad-fixed'}">
                        ${isFormula ? 'формула' : 'фікс'}
                    </span>
                    ${entryNote}
                </div>
            </div>
            <div class="grad-service-price">
                ${formatPrice(price)}
                <span class="grad-price-unit">/дит</span>
            </div>
            <button class="grad-info-btn" onclick="event.preventDefault();event.stopPropagation();GradPage.showInfo(${svc.id})" title="Детальніше">i</button>
        </label>`;
    }

    function renderPackages(container) {
        let html = '<div class="grad-packages-grid">';
        for (const pkg of packages) {
            // Calculate live price from package services
            let totalPrice = 0;
            const svcNames = [];
            for (const item of pkg.services) {
                const svc = services.find(s => s.id === item.serviceId);
                if (svc) {
                    totalPrice += item.overridePrice || getEffectivePrice(svc);
                    svcNames.push(svc.name);
                }
            }

            html += `
            <div class="grad-package-card" onclick="GradPage.selectPackage('${pkg.slug}')">
                <div class="grad-package-name">${pkg.name}</div>
                <div class="grad-package-price">${formatPrice(totalPrice)}<span>/дит</span></div>
                <div class="grad-package-services">
                    ${svcNames.map(n => `<span class="grad-package-tag">${n}</span>`).join('')}
                </div>
                <button class="grad-btn grad-btn-sm">Обрати</button>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;
    }

    async function renderQuotes(container) {
        await loadQuotes();
        const statusLabels = { draft: 'Чернетка', sent: 'Відправлено', approved: 'Погоджено', booked: 'Заброньовано', cancelled: 'Скасовано' };
        const statusColors = { draft: '#999', sent: '#3B82F6', approved: '#10B981', booked: '#C9A84C', cancelled: '#EF4444' };

        let html = `
        <div class="grad-quotes-filter">
            <button class="grad-filter-btn active" onclick="GradPage.filterQuotes('')">Всі</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('draft')">Чернетки</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('sent')">Відправлені</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('approved')">Погоджені</button>
            <button class="grad-filter-btn" onclick="GradPage.filterQuotes('booked')">Заброньовані</button>
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
                        <span>${q.kidsCount} дітей</span>
                        <span>${formatPrice(q.totalAll)}</span>
                    </div>
                    <div class="grad-quote-status" style="color:${statusColors[q.status] || '#999'}">
                        ${statusLabels[q.status] || q.status}
                    </div>
                    <div class="grad-quote-date">${new Date(q.createdAt).toLocaleDateString('uk-UA')}</div>
                    <div class="grad-quote-actions">
                        <button class="grad-btn grad-btn-sm" onclick="GradPage.loadQuote(${q.id})">Відкрити</button>
                        ${q.status !== 'booked' ? `<button class="grad-btn grad-btn-sm" onclick="GradPage.viewProposal(${q.id})">КП</button>` : ''}
                    </div>
                </div>`;
            }
        }
        html += '</div>';
        container.innerHTML = html;
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

    // === ACTIONS ===

    function toggleService(id) {
        if (selectedServiceIds.has(id)) {
            selectedServiceIds.delete(id);
        } else {
            selectedServiceIds.add(id);
        }
        recalc();
    }

    function recalc() {
        if (currentTab === 'constructor') {
            renderCurrentTab();
        }
    }

    function adjustKids(delta) {
        const el = document.getElementById('gradKidsCount');
        if (!el) return;
        const val = Math.max(1, Math.min(99, (parseInt(el.value) || 15) + delta));
        el.value = val;
        recalc();
    }

    function updateCoeff() {
        const el = document.getElementById('gradCoeff');
        if (!el) return;
        const val = parseFloat(el.value) || 6.0;
        settings.coefficient = { ...settings.coefficient, value: val };
        recalc();
    }

    function updateMarkup() {
        const el = document.getElementById('gradMarkup');
        if (!el) return;
        const val = parseFloat(el.value) || 1.15;
        settings.markup = { ...settings.markup, value: val };
        recalc();
    }

    async function selectPackage(slug) {
        try {
            const pkg = await gradApi('GET',`/graduation/packages/${slug}`);
            selectedServiceIds.clear();
            for (const svc of pkg.services) {
                selectedServiceIds.add(svc.id);
            }
            currentTab = 'constructor';
            renderCurrentTab();
            showNotification(`Пакет "${pkg.name}" обрано`, 'success');
        } catch (err) {
            showNotification('Помилка завантаження пакету', 'error');
        }
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

        try {
            const quote = await gradApi('POST','/graduation/quotes', {
                kidsCount: getKidsCount(),
                discountPercent: getDiscount() * 100,
                selectedServices: selectedSvcs,
                totalPerChild: totals.totalPerChild,
                totalAll: totals.totalAll,
                totalCost: totals.totalCost,
                totalProfit: totals.profit,
                profitMargin: totals.margin
            });
            showNotification(`Конфігурацію ${quote.quoteNumber} збережено`, 'success');
        } catch (err) {
            showNotification(err.message || 'Помилка збереження', 'error');
        }
    }

    async function loadQuote(id) {
        try {
            const quote = await gradApi('GET',`/graduation/quotes/${id}`);
            const svcList = quote.selectedServices || [];

            selectedServiceIds.clear();
            for (const s of svcList) {
                selectedServiceIds.add(s.serviceId || s.service_id);
            }

            const kidsEl = document.getElementById('gradKidsCount');
            const discEl = document.getElementById('gradDiscount');

            currentTab = 'constructor';
            renderCurrentTab();

            // Set values after render
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

        // First save, then open proposal
        const selectedSvcs = services
            .filter(s => selectedServiceIds.has(s.id))
            .map(s => ({ serviceId: s.id, name: s.name, price: getEffectivePrice(s) }));

        try {
            const quote = await gradApi('POST','/graduation/quotes', {
                kidsCount: getKidsCount(),
                discountPercent: getDiscount() * 100,
                selectedServices: selectedSvcs,
                totalPerChild: totals.totalPerChild,
                totalAll: totals.totalAll,
                totalCost: totals.totalCost,
                totalProfit: totals.profit,
                profitMargin: totals.margin
            });

            viewProposal(quote.id);
        } catch (err) {
            showNotification(err.message || 'Помилка', 'error');
        }
    }

    function viewProposal(id) {
        const token = localStorage.getItem('pzp_token');
        window.open(`${API_BASE}/graduation/quotes/${id}/proposal?token=${token}`, '_blank');
    }

    function showInfo(id) {
        const svc = services.find(s => s.id === id);
        if (!svc) return;

        const kids = getKidsCount();
        const price = getEffectivePrice(svc);
        const cost = svc.costType === 'mk_external'
            ? price * kids * getMkExternalRate()
            : calcServiceCost(svc, kids);

        const modal = document.getElementById('gradInfoModal');
        if (!modal) return;

        let html = `
        <div class="grad-modal-header">
            <h3>${svc.name}</h3>
            <button class="grad-modal-close" onclick="document.getElementById('gradInfoModal').style.display='none'">&times;</button>
        </div>
        <div class="grad-modal-body">
            <p class="grad-modal-desc">${svc.description || 'Без опису'}</p>
            <div class="grad-modal-details">
                <div class="grad-modal-row"><span>Тривалість:</span><span>${svc.durationMin || 0} хв</span></div>
                <div class="grad-modal-row"><span>Ціна за дитину:</span><span>${formatPrice(price)}</span></div>
                <div class="grad-modal-row"><span>Тип ціни:</span><span>${svc.priceType === 'formula' ? 'Формула' : 'Фіксована'}</span></div>
                ${svc.priceType === 'formula' ? `<div class="grad-modal-row"><span>Ціна парку:</span><span>${formatPrice(svc.pricePark)}</span></div>` : ''}
                ${isDirector() ? `
                <hr style="border-color:rgba(255,255,255,0.1);margin:12px 0">
                <div class="grad-modal-row"><span>Собівартість (${kids} діт.):</span><span>${formatPrice(cost)}</span></div>
                <div class="grad-modal-row"><span>Тип витрат:</span><span>${svc.costType === 'mk_external' ? 'МК зовнішній (80%)' : 'Стандарт'}</span></div>
                ` : ''}
            </div>
            ${isDirector() ? `
            <div class="grad-modal-edit">
                <button class="grad-btn grad-btn-sm" onclick="GradPage.editServicePrice(${svc.id})">Редагувати ціну</button>
            </div>
            ` : ''}
        </div>`;

        modal.querySelector('.grad-modal-content').innerHTML = html;
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
            await gradApi('PUT',`/graduation/services/${id}`, {
                pricePerChild: val,
                priceType: 'fixed' // Override to fixed when manually set
            });
            // Reload services
            services = await gradApi('GET','/graduation/services');
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
            settings = await gradApi('PUT','/graduation/settings', {
                settings: { [key]: value }
            });
            recalc();
            showNotification('Параметр збережено', 'success');
        } catch (err) {
            showNotification('Помилка збереження', 'error');
        }
    }

    async function resetPrices() {
        if (!confirm('Скинути всі ціни до стандартних?')) return;
        try {
            services = await gradApi('GET','/graduation/services');
            settings = await gradApi('GET','/graduation/settings');
            recalc();
            renderCurrentTab();
            showNotification('Ціни скинуто', 'success');
        } catch (err) {
            showNotification('Помилка', 'error');
        }
    }

    function filterQuotes(status) {
        document.querySelectorAll('.grad-filter-btn').forEach(b => b.classList.remove('active'));
        event.target.classList.add('active');
        document.querySelectorAll('.grad-quote-row').forEach(row => {
            if (!status || row.dataset.status === status) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    function switchTab(tab) {
        currentTab = tab;
        // Hide settings tab for non-directors
        if (tab === 'settings' && !isDirector()) {
            currentTab = 'constructor';
        }
        renderCurrentTab();
    }

    function formatPrice(val) {
        if (!val) return '0 ₴';
        return Math.round(val).toLocaleString('uk-UA') + ' ₴';
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

        // Tab click handlers
        document.querySelectorAll('.grad-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Hide settings tab for non-directors
        if (!isDirector()) {
            const settingsTab = document.querySelector('.grad-tab[data-tab="settings"]');
            if (settingsTab) settingsTab.style.display = 'none';
        }
    }

    // Public API
    window.GradPage = {
        init,
        toggleService,
        recalc,
        adjustKids,
        updateCoeff,
        updateMarkup,
        selectPackage,
        saveQuote,
        loadQuote,
        generateProposal,
        viewProposal,
        showInfo,
        editServicePrice,
        saveSetting,
        resetPrices,
        filterQuotes,
        switchTab
    };
})();
