/* global apiRequest, escapeHtml */
'use strict';

// The finance page already enforces its existing role/capability gate.
window.CostingWorkspace = (() => {
    const state = { initialized: false, templates: [], current: null, preview: null };
    const $ = id => document.getElementById(id);
    const kinds = { lesson: 'Заняття', session: 'Сеанс', rental: 'Оренда', service: 'Послуга', agency_order: 'Агентське замовлення', admission_day: 'День парку' };
    const bases = { execution: 'за проведення', hour: 'за годину', participant: 'за учасника', unit: 'за одиницю', percent: 'відсоток' };

    function minorFromUah(value, field) {
        const text = String(value ?? '').trim().replace(',', '.');
        if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) throw new Error(`${field}: введіть суму в гривнях, до двох знаків після коми`);
        const [whole, fraction = ''] = text.split('.');
        return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
    }

    function uahFromMinor(value) {
        const amount = BigInt(value || '0');
        const sign = amount < 0n ? '-' : '';
        const absolute = amount < 0n ? -amount : amount;
        return `${sign}${(absolute / 100n).toLocaleString('uk-UA')},${String(absolute % 100n).padStart(2, '0')} ₴`;
    }

    function inputUah(value) {
        const absolute = BigInt(value || '0');
        return `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
    }

    function bpsFromPercent(value, field) {
        const text = String(value ?? '').trim().replace(',', '.');
        if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) throw new Error(`${field}: введіть відсоток до двох знаків після коми`);
        const [whole, fraction = ''] = text.split('.');
        const bps = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
        if (!Number.isSafeInteger(bps) || bps > 10000) throw new Error(`${field}: максимум 100%`);
        return bps;
    }

    function status(message, error = false) {
        const element = $('costStatus');
        element.hidden = !message;
        element.classList.toggle('error', error);
        element.textContent = message || '';
    }

    function invalidatePreview() {
        state.preview = null;
        $('costSavePlan').disabled = true;
        $('costPreviewResult').hidden = true;
    }

    function addLine(line = {}) {
        const row = document.createElement('div');
        row.className = 'cost-line';
        row.dataset.code = line.code || '';
        row.innerHTML = `<label>Витрата<input data-field="label" maxlength="120" placeholder="Викладач, матеріали…"></label>
            <label>Основа<select data-field="basis"><option value="execution">проведення</option><option value="hour">година</option><option value="participant">учасник</option><option value="unit">одиниця</option><option value="percent">відсоток</option></select></label>
            <label data-rate-label>Ставка, ₴<input data-field="rate" inputmode="decimal" placeholder="0.00"></label>
            <label data-base-label style="display:none">Від чого<select data-field="percentBase"><option value="revenue">виручки після знижки</option><option value="base_direct_cost">базових прямих витрат</option></select></label>
            <button type="button" class="btn-page-secondary" data-remove-line aria-label="Видалити рядок витрат">×</button>`;
        row.querySelector('[data-field="label"]').value = line.label || '';
        row.querySelector('[data-field="basis"]').value = line.basis || 'execution';
        row.querySelector('[data-field="rate"]').value = line.basis === 'percent' ? String((line.percentBps || 0) / 100) : (line.rateMinor === undefined ? '' : inputUah(line.rateMinor));
        row.querySelector('[data-field="percentBase"]').value = line.percentBase || 'revenue';
        row.querySelector('[data-field="basis"]').addEventListener('change', () => {
            const percent = row.querySelector('[data-field="basis"]').value === 'percent';
            row.querySelector('[data-rate-label]').firstChild.textContent = percent ? 'Ставка, %' : 'Ставка, ₴';
            row.querySelector('[data-base-label]').style.display = percent ? '' : 'none';
            row.querySelector('[data-field="rate"]').value = '';
        });
        if (line.basis === 'percent') {
            row.querySelector('[data-rate-label]').firstChild.textContent = 'Ставка, %';
            row.querySelector('[data-base-label]').style.display = '';
        }
        row.querySelector('[data-remove-line]').addEventListener('click', () => row.remove());
        $('costLines').appendChild(row);
    }

    function readDefinition() {
        const rows = [...$('costLines').querySelectorAll('.cost-line')];
        if (!rows.length) throw new Error('Додайте хоча б один рядок прямих витрат');
        const used = new Set();
        const lines = rows.map((row, index) => {
            const label = row.querySelector('[data-field="label"]').value.trim();
            if (!label) throw new Error(`Рядок ${index + 1}: вкажіть назву витрати`);
            let code = row.dataset.code;
            if (!code) {
                let suffix = index + 1;
                while (used.has(`line_${suffix}`) || rows.some(other => other !== row && other.dataset.code === `line_${suffix}`)) suffix += 1;
                code = `line_${suffix}`;
                row.dataset.code = code;
            }
            used.add(code);
            const basis = row.querySelector('[data-field="basis"]').value;
            const value = row.querySelector('[data-field="rate"]').value;
            return basis === 'percent'
                ? { code, label, basis, percentBps: bpsFromPercent(value, label), percentBase: row.querySelector('[data-field="percentBase"]').value }
                : { code, label, basis, rateMinor: minorFromUah(value, label) };
        });
        return {
            revenueBasis: $('costRevenueBasis').value,
            revenueRateMinor: minorFromUah($('costRevenueRate').value, 'Ціна'), lines
        };
    }

    function renderDefinition(definition) {
        $('costRevenueBasis').value = definition.revenueBasis;
        $('costRevenueRate').value = inputUah(definition.revenueRateMinor);
        $('costLines').replaceChildren();
        definition.lines.forEach(addLine);
        $('costLineQuantities').replaceChildren();
        definition.lines.filter(line => line.basis === 'unit').forEach(line => {
            const label = document.createElement('label');
            label.textContent = `Кількість: ${line.label}`;
            const input = document.createElement('input');
            input.type = 'number'; input.min = '0'; input.step = '1'; input.value = '1';
            input.dataset.lineQuantity = line.code;
            label.appendChild(input);
            $('costLineQuantities').appendChild(label);
        });
    }

    async function refreshTemplates(selectedId = null) {
        const data = await apiRequest('GET', '/api/finance/costing/templates');
        state.templates = data.templates || [];
        const select = $('costTemplateSelect');
        select.replaceChildren(new Option('Новий шаблон', ''));
        state.templates.forEach(template => select.add(new Option(`${template.name} · ${kinds[template.kind] || template.kind}`, template.id)));
        select.value = selectedId === null ? '' : String(selectedId);
        await selectTemplate();
    }

    async function selectTemplate() {
        invalidatePreview();
        const templateId = $('costTemplateSelect').value;
        state.current = null;
        if (!templateId) {
            $('costTemplateName').disabled = false;
            $('costTemplateKind').disabled = false;
            $('costTemplateName').value = '';
            $('costTemplateKind').value = 'lesson';
            $('costRevenueRate').value = '';
            $('costRevenueBasis').value = 'execution';
            $('costLines').replaceChildren();
            $('costLineQuantities').replaceChildren();
            addLine();
            $('costSaveTemplate').textContent = 'Зберегти шаблон';
            return;
        }
        const data = await apiRequest('GET', `/api/finance/costing/templates/${encodeURIComponent(templateId)}`);
        state.current = data;
        $('costTemplateName').value = data.template.name;
        $('costTemplateName').disabled = true;
        $('costTemplateKind').value = data.template.kind;
        $('costTemplateKind').disabled = true;
        const version = data.versions.find(item => item.effective_from <= new Date().toISOString().slice(0, 10)) || data.versions[0];
        state.displayedVersionId = String(version.id);
        renderDefinition(version.definition);
        $('costSaveTemplate').textContent = 'Зберегти нову версію';
        status(`Показана версія ${version.version_number}. Дата плану визначає, яку версію застосувати.`);
    }

    async function saveTemplate() {
        try {
            status('Зберігаю шаблон…');
            const definition = readDefinition();
            const effectiveFrom = $('costEffectiveFrom').value;
            const selectedId = $('costTemplateSelect').value;
            const response = selectedId
                ? await apiRequest('POST', `/api/finance/costing/templates/${encodeURIComponent(selectedId)}/versions`, { effectiveFrom, definition })
                : await apiRequest('POST', '/api/finance/costing/templates', {
                    name: $('costTemplateName').value.trim(), kind: $('costTemplateKind').value, effectiveFrom, definition
                });
            await refreshTemplates(selectedId || response.template.id);
            status(`Збережено версію ${response.version.version_number}.`);
        } catch (error) { status(error.message, true); }
    }

    function readInputs() {
        const hours = String($('costHours').value).trim().replace(',', '.');
        if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(hours)) throw new Error('Тривалість має бути невід’ємним числом годин');
        const durationMinutes = Math.round(Number(hours) * 60);
        const lineQuantities = {};
        $('costLineQuantities').querySelectorAll('[data-line-quantity]').forEach(input => {
            lineQuantities[input.dataset.lineQuantity] = Number(input.value);
        });
        return {
            participants: Number($('costParticipants').value),
            paidParticipants: Number($('costPaidParticipants').value),
            durationMinutes, units: Number($('costUnits').value),
            discountBps: bpsFromPercent($('costDiscountPercent').value, 'Знижка'),
            discountMinor: minorFromUah($('costDiscountMoney').value, 'Додаткова знижка'), lineQuantities
        };
    }

    function renderPreview(calculation, version) {
        const el = $('costPreviewResult');
        const margin = calculation.marginBps === null ? 'н/д' : `${(calculation.marginBps / 100).toFixed(2)}%`;
        el.innerHTML = `<div>Версія ${escapeHtml(String(version.number))} · діє з ${escapeHtml(version.effectiveFrom)}</div>
            <div class="cost-result-grid">
                <div>Виручка після знижки<strong>${uahFromMinor(calculation.revenueMinor)}</strong></div>
                <div>Прямі витрати<strong>${uahFromMinor(calculation.directCostMinor)}</strong></div>
                <div>Внесок після прямих витрат<strong>${uahFromMinor(calculation.contributionMinor)}</strong></div>
                <div>Маржа від виручки<strong>${margin}</strong></div>
            </div>
            ${calculation.breakEvenParticipants === null ? '' : `<p>Беззбитковість: ${calculation.breakEvenParticipants} платних учасників за умови такої самої кількості споживачів.</p>`}
            <ul>${calculation.lines.map(line => `<li>${escapeHtml(line.label)} · ${bases[line.basis]} · ${line.classification === 'fixed' ? 'фіксована' : 'змінна'}: ${uahFromMinor(line.amountMinor)}</li>`).join('')}</ul>`;
        el.hidden = false;
    }

    async function preview() {
        try {
            invalidatePreview();
            const templateId = $('costTemplateSelect').value;
            if (!templateId) throw new Error('Спершу збережіть і виберіть шаблон');
            const executionDate = $('costExecutionDate').value;
            const inputs = readInputs();
            status('Розраховую…');
            const response = await apiRequest('POST', '/api/finance/costing/preview', { templateId, executionDate, inputs });
            if (String(response.version.id) !== state.displayedVersionId) {
                const effectiveVersion = state.current?.versions.find(item => String(item.id) === String(response.version.id));
                if (effectiveVersion) {
                    state.displayedVersionId = String(effectiveVersion.id);
                    renderDefinition(effectiveVersion.definition);
                    status(`Для цієї дати діє версія ${effectiveVersion.version_number}. Перевірте кількості рядків і натисніть «Розрахувати» ще раз.`);
                    return;
                }
            }
            state.preview = { templateId, executionDate, inputs, versionId: response.version.id };
            renderPreview(response.calculation, response.version);
            $('costSavePlan').disabled = false;
            status('Розрахунок готовий. Збереження створить незмінний плановий знімок.');
        } catch (error) { status(error.message, true); }
    }

    async function refreshPlans() {
        const data = await apiRequest('GET', '/api/finance/costing/plans');
        const list = $('costPlanList');
        if (!data.plans?.length) { list.textContent = 'Планів поки немає.'; return; }
        list.innerHTML = data.plans.map(plan => `<article><div><strong>${escapeHtml(plan.execution_label)}</strong><br><small>${escapeHtml(plan.execution_date)} · ${escapeHtml(plan.template_name)} · v${escapeHtml(String(plan.version_number))}</small></div><div>Внесок: <strong>${uahFromMinor(plan.contribution_minor)}</strong></div></article>`).join('');
    }

    async function savePlan() {
        try {
            if (!state.preview) throw new Error('Спершу оновіть розрахунок');
            const executionLabel = $('costExecutionLabel').value.trim();
            if (!executionLabel) throw new Error('Вкажіть назву виконання');
            $('costSavePlan').disabled = true;
            const payload = { ...state.preview, expectedVersionId: state.preview.versionId, executionLabel, clientKey: crypto.randomUUID() };
            await apiRequest('POST', '/api/finance/costing/plans', payload);
            invalidatePreview();
            await refreshPlans();
            status('Плановий знімок збережено.');
        } catch (error) { $('costSavePlan').disabled = false; status(error.message, true); }
    }

    async function load() {
        if (!state.initialized) {
            state.initialized = true;
            const today = new Date().toISOString().slice(0, 10);
            $('costEffectiveFrom').value = today;
            $('costExecutionDate').value = today;
            $('costTemplateSelect').addEventListener('change', () => { selectTemplate().catch(error => status(error.message, true)); });
            $('costAddLine').addEventListener('click', () => addLine());
            $('costSaveTemplate').addEventListener('click', saveTemplate);
            $('costPreview').addEventListener('click', preview);
            $('costSavePlan').addEventListener('click', savePlan);
            $('tabCosting').addEventListener('input', event => {
                if (event.target.closest('#costLineQuantities') ||
                    ['costExecutionDate','costParticipants','costPaidParticipants','costHours','costUnits','costDiscountPercent','costDiscountMoney'].includes(event.target.id)) invalidatePreview();
            });
        }
        try {
            await Promise.all([refreshTemplates($('costTemplateSelect').value || null), refreshPlans()]);
        } catch (error) { status(error.message, true); }
    }

    return { load };
})();
