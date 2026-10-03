/* global apiRequest, escapeHtml */
'use strict';

// The finance page already enforces its existing role/capability gate.
window.CostingWorkspace = (() => {
    const state = { initialized: false, templates: [], current: null, preview: null, plans: [], actual: null, group: null };
    const $ = id => document.getElementById(id);
    const kinds = { lesson: 'Заняття', session: 'Сеанс', rental: 'Оренда', service: 'Послуга', agency_order: 'Агентське замовлення', admission_day: 'День парку' };
    const bases = { execution: 'за проведення', hour: 'за годину', participant: 'за учасника', unit: 'за одиницю', percent: 'відсоток' };

    function minorFromUah(value, field) {
        const text = String(value ?? '').trim().replace(',', '.');
        if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) throw new Error(`${field}: введіть суму в гривнях, до двох знаків після коми`);
        const [whole, fraction = ''] = text.split('.');
        return (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
    }

    function signedMinorFromUah(value, field) {
        const text = String(value ?? '').trim().replace(',', '.');
        return text.startsWith('-') ? `-${minorFromUah(text.slice(1), field)}` : minorFromUah(text, field);
    }

    function uahFromMinor(value) {
        const amount = BigInt(value || '0');
        const sign = amount < 0n ? '-' : '';
        const absolute = amount < 0n ? -amount : amount;
        return `${sign}${(absolute / 100n).toLocaleString('uk-UA')},${String(absolute % 100n).padStart(2, '0')} ₴`;
    }

    function friendlyError(message) {
        const value = String(message || 'Помилка запиту');
        if (/already belongs to an aggregate|already linked to another execution/i.test(value)) return 'Цей план або ID джерела вже прив’язаний до іншого виконання.';
        if (/already exists with different evidence/i.test(value)) return 'Джерело вже має іншу суму або підставу. Використайте виправлення з причиною.';
        if (/Resolve estimated sources/i.test(value)) return 'Спочатку замініть усі оцінки цієї категорії підтвердженими записами.';
        if (/already saved|already linked/i.test(value)) return 'Цей запис уже збережено. Оновіть список перед повторною дією.';
        if (/Source not found in this business/i.test(value)) return 'Джерело не знайдено в поточному бізнесі.';
        if (/Canonical amount differs/i.test(value)) return 'Сума не збігається з канонічним записом.';
        if (/Group composition changed|Concurrent group change/i.test(value)) return 'Склад групи вже змінився. Оновіть групу й повторіть виправлення.';
        if (/Group composition is unchanged/i.test(value)) return 'Склад не змінився. Виберіть інші складові перед збереженням.';
        return value;
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
        element.textContent = error ? friendlyError(message) : (message || '');
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
        state.plans = data.plans || [];
        const list = $('costPlanList');
        const select = $('costActualPlan');
        const previous = select.value;
        select.replaceChildren(new Option(state.plans.length ? 'Оберіть виконання' : 'Планів ще немає', ''));
        state.plans.forEach(plan => select.add(new Option(`${plan.execution_label} · ${plan.execution_date}`, plan.id)));
        select.value = state.plans.some(plan => String(plan.id) === previous) ? previous : '';
        const management = $('costManagementPlan');
        const selectedManagement = management.value;
        management.replaceChildren(new Option(state.plans.length ? 'Оберіть виконання' : 'Планів ще немає', ''));
        state.plans.forEach(plan => management.add(new Option(`${plan.execution_label} · ${plan.execution_date}`, plan.id)));
        management.value = state.plans.some(plan => String(plan.id) === selectedManagement) ? selectedManagement : '';
        renderGroupMembers();
        if (!state.plans.length) { list.textContent = 'Планів поки немає.'; state.actual = null; $('costActualSummary').textContent = 'Спочатку збережіть план.'; return; }
        list.innerHTML = state.plans.map(plan => `<article><div><strong>${escapeHtml(plan.execution_label)}</strong><br><small>${escapeHtml(plan.execution_date)} · ${escapeHtml(plan.template_name)} · v${escapeHtml(String(plan.version_number))}</small></div><div>Внесок: <strong>${uahFromMinor(plan.contribution_minor)}</strong></div></article>`).join('');
        if (select.value) await loadActual();
    }

    async function savePlan() {
        try {
            if (!state.preview) throw new Error('Спершу оновіть розрахунок');
            const executionLabel = $('costExecutionLabel').value.trim();
            if (!executionLabel) throw new Error('Вкажіть назву виконання');
            $('costSavePlan').disabled = true;
            const payload = { ...state.preview, expectedVersionId: state.preview.versionId, executionLabel,
                bookingId: $('costExecutionBookingId').value.trim(), clientKey: crypto.randomUUID() };
            const saved = await apiRequest('POST', '/api/finance/costing/plans', payload);
            invalidatePreview();
            await refreshPlans();
            $('costActualPlan').value = String(saved.planId);
            await loadActual();
            status('Плановий знімок збережено.');
        } catch (error) { $('costSavePlan').disabled = false; status(error.message, true); }
    }

    function actualStatus(message, error = false) {
        const element = $('costActualStatus');
        element.hidden = !message;
        element.classList.toggle('error', error);
        element.textContent = error ? friendlyError(message) : (message || '');
    }

    function renderActual(data) {
        const summary = data.summary;
        const plan = summary.planned;
        const category = (row, label, planned) => `<div>${label}<strong>${uahFromMinor(planned)}</strong>
            <small>Підтверджено: ${row.confirmedMinor === null ? 'ще немає' : uahFromMinor(row.confirmedMinor)} · оцінка: ${row.estimateMinor === null ? 'немає' : uahFromMinor(row.estimateMinor)}</small>
            <small>Стан: ${row.status === 'complete' ? 'звірено' : row.status === 'partial' ? 'неповно' : 'факт відсутній'}</small></div>`;
        $('costActualSummary').innerHTML = `<div class="cost-result-grid">
            ${category(summary.revenue, 'Планова виручка', plan.revenueMinor)}
            ${category(summary.directCost, 'Планові прямі витрати', plan.directCostMinor)}
            <div>Плановий внесок<strong>${uahFromMinor(plan.contributionMinor)}</strong></div>
            <div>Фактичний внесок<strong>${summary.actualComplete ? uahFromMinor(summary.actualContributionMinor) : 'Ще не визначено'}</strong>
                <small>${summary.actualComplete ? `Різниця з планом: ${uahFromMinor(summary.contributionVarianceMinor)} · маржа: ${summary.actualMarginBps === null ? 'н/д' : `${(summary.actualMarginBps / 100).toFixed(2)}%`}` : 'Потрібні фактичні джерела і звірка обох категорій.'}</small></div>
            </div>${summary.actualComplete ? '' : '<p class="cost-pending">Неповний факт: це ще не завершений прибуток.</p>'}`;
        const select = $('costCorrectionSource');
        const selected = select.value;
        select.replaceChildren(new Option('Оберіть джерело', ''));
        data.sources.forEach(source => select.add(new Option(`${source.external_id} · ${source.economic_role} · ${source.evidence_state === 'estimate' ? 'оцінка' : 'підтверджено вручну'}`, source.id)));
        select.value = data.sources.some(source => String(source.id) === selected) ? selected : '';
        $('costActualHistory').innerHTML = data.entries.length ? `<h4>Історія джерел і виправлень</h4>${data.entries.map(entry =>
            `<article>${escapeHtml(entry.external_id)} · ${escapeHtml(entry.economic_role)} · ${entry.entry_type === 'reversal' ? 'сторно' : entry.evidence_state === 'estimate' ? 'оцінка' : 'підтверджено вручну'} · ${uahFromMinor(entry.amount_minor)}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</article>`).join('')}` : '<p>Фактичних джерел поки немає.</p>';
    }

    async function loadActual() {
        const planId = $('costActualPlan').value;
        if (!planId) { state.actual = null; $('costActualSummary').textContent = 'Виберіть збережений план.'; $('costActualHistory').textContent = ''; return; }
        try {
            const data = await apiRequest('GET', `/api/finance/costing/actual/plans/${encodeURIComponent(planId)}`);
            state.actual = data;
            renderActual(data);
        } catch (error) { actualStatus(error.message, true); }
    }

    async function addActualSource() {
        try {
            const planId = $('costActualPlan').value;
            if (!planId) throw new Error('Оберіть виконання');
            const payload = { externalId: $('costSourceExternalId').value.trim(), economicRole: $('costSourceRole').value.trim(),
                category: $('costSourceCategory').value, amountMinor: signedMinorFromUah($('costSourceAmount').value, 'Сума'),
                evidenceState: $('costSourceEvidence').value, semantic: $('costSourceSemantic').value };
            const result = await apiRequest('POST', `/api/finance/costing/actual/plans/${encodeURIComponent(planId)}/sources`, payload);
            await loadActual();
            actualStatus(result.idempotent ? 'Джерело вже враховано; повтор не додав суму.' : 'Джерело записано. Попередню звірку цієї категорії треба підтвердити знову.');
        } catch (error) { actualStatus(error.message, true); }
    }

    async function previewCanonicalLink() {
        const result = $('costLinkResult');
        try {
            const type = $('costLinkType').value;
            const payload = { type, sourceId: $('costLinkId').value.trim() };
            if (type !== 'education_attendance') payload.expectedAmountMinor = signedMinorFromUah($('costLinkAmount').value, 'Очікувана сума');
            const response = await apiRequest('POST', '/api/finance/costing/actual/source-links/preview', payload);
            const preview = response.preview;
            const fields = preview.verifiedFields || [];
            const match = fields.includes('amount') ? 'Перевірено ID, бізнес і суму' :
                fields.includes('id') && preview.canonicalAmountMinor === null && type !== 'education_attendance' ? 'ID і бізнес збігаються; канонічної суми немає' :
                fields.includes('id') && preview.amountMatches === false ? 'ID і бізнес збігаються; сума відрізняється' :
                fields.includes('id') ? 'Перевірено ID і бізнес; цей запис не містить суми' :
                'Посилання не пройшло перевірку';
            result.innerHTML = `<strong>${match}</strong>
                ${fields.includes('id') ? `<p>${preview.canonicalAmountMinor === null ? 'Суми немає' : `Сума запису: ${uahFromMinor(preview.canonicalAmountMinor)}`} · стан: ${escapeHtml(preview.status || 'невідомий')}</p>` : `<p>${escapeHtml(preview.reason || 'Запис не знайдено в поточному бізнесі')}</p>`}
                <p>Перевірка посилання не створює фактичного запису й не проводить суму в P&amp;L.</p>
                ${preview.blockers?.length ? `<ul>${preview.blockers.map(blocker => `<li>${escapeHtml(blocker)}</li>`).join('')}</ul>` : ''}`;
            result.hidden = false;
        } catch (error) { result.textContent = friendlyError(error.message); result.hidden = false; }
    }

    function selectCorrectionSource() {
        const source = state.actual?.sources.find(item => String(item.id) === $('costCorrectionSource').value);
        if (!source) return;
        $('costCorrectionAmount').value = inputUah(source.amount_minor.replace(/^-/, ''));
        if (source.amount_minor.startsWith('-')) $('costCorrectionAmount').value = `-${$('costCorrectionAmount').value}`;
        $('costCorrectionEvidence').value = source.evidence_state;
        $('costCorrectionSemantic').value = source.semantic;
    }

    async function correctActualSource() {
        try {
            const sourceId = $('costCorrectionSource').value;
            if (!sourceId) throw new Error('Оберіть джерело для виправлення');
            await apiRequest('POST', `/api/finance/costing/actual/sources/${encodeURIComponent(sourceId)}/correct`, {
                amountMinor: signedMinorFromUah($('costCorrectionAmount').value, 'Нова сума'),
                evidenceState: $('costCorrectionEvidence').value, semantic: $('costCorrectionSemantic').value,
                reason: $('costCorrectionReason').value.trim()
            });
            $('costCorrectionReason').value = '';
            await loadActual();
            actualStatus('Виправлення записано зі сторнуванням і новою ревізією. Повторіть звірку категорії.');
        } catch (error) { actualStatus(error.message, true); }
    }

    async function saveCompletion() {
        try {
            const planId = $('costActualPlan').value;
            if (!planId) throw new Error('Оберіть виконання');
            await apiRequest('POST', `/api/finance/costing/actual/plans/${encodeURIComponent(planId)}/completions`, {
                category: $('costCompletionCategory').value, isComplete: $('costCompletionConfirmed').checked,
                reason: $('costCompletionReason').value.trim()
            });
            $('costCompletionConfirmed').checked = false;
            $('costCompletionReason').value = '';
            await loadActual();
            actualStatus('Стан звірки записано в історію.');
        } catch (error) { actualStatus(error.message, true); }
    }

    function groupStatus(message, error = false) {
        const element = $('costGroupStatus');
        element.hidden = !message;
        element.classList.toggle('error', error);
        element.textContent = error ? friendlyError(message) : (message || '');
    }

    function renderGroupMembers(containerId = 'costGroupMembers', selected = []) {
        const container = $(containerId);
        if (!state.plans.length) { container.textContent = 'Спочатку створіть плани виконань.'; return; }
        container.innerHTML = state.plans.map(plan => {
            const member = selected.find(item => String(item.planId) === String(plan.id));
            return `<article data-plan-id="${escapeHtml(String(plan.id))}">
            <div><strong>${escapeHtml(plan.execution_label)}</strong><small>${escapeHtml(plan.execution_date)} · ${escapeHtml(plan.template_name)} · план ${uahFromMinor(plan.revenue_minor)} / ${uahFromMinor(plan.direct_cost_minor)}</small></div>
            <label><input type="checkbox" data-include-revenue${member?.include_plan_revenue ? ' checked' : ''}> Включити виручку</label>
            <label><input type="checkbox" data-include-cost${member?.include_plan_direct_cost ? ' checked' : ''}> Включити витрати</label></article>`;
        }).join('');
    }

    function selectedGroupMembers(containerId) {
        return [...$(containerId).querySelectorAll('[data-plan-id]')].map(row => ({
            planId: row.dataset.planId,
            includePlanRevenue: row.querySelector('[data-include-revenue]').checked,
            includePlanDirectCost: row.querySelector('[data-include-cost]').checked
        })).filter(member => member.includePlanRevenue || member.includePlanDirectCost);
    }

    async function refreshGroups(selectedId = null) {
        const data = await apiRequest('GET', '/api/finance/costing/actual/groups');
        const select = $('costGroupSelect');
        const previous = selectedId === null ? select.value : String(selectedId);
        const groups = data.groups || [];
        select.replaceChildren(new Option(groups.length ? 'Оберіть групу' : 'Груп ще немає', ''));
        groups.forEach(group => select.add(new Option(`${group.label} · ${group.kind}`, group.id)));
        select.value = groups.some(group => String(group.id) === previous) ? previous : '';
        await loadGroup();
    }

    async function loadGroup() {
        const groupId = $('costGroupSelect').value;
        if (!groupId) {
            state.group = null;
            $('costGroupSummary').textContent = 'Виберіть збережену групу або створіть нову.';
            $('costGroupEditMembers').textContent = 'Оберіть групу для виправлення складу.';
            $('costGroupHistory').replaceChildren();
            return;
        }
        try {
            const data = await apiRequest('GET', `/api/finance/costing/actual/groups/${encodeURIComponent(groupId)}`);
            state.group = data;
            const summary = data.summary;
            const members = data.members.map(member => {
                const plan = state.plans.find(item => String(item.id) === String(member.planId));
                return `${escapeHtml(plan?.execution_label || `#${member.planId}`)}: ${member.include_plan_revenue ? 'виручка' : 'без виручки'}, ${member.include_plan_direct_cost ? 'витрати' : 'без витрат'}`;
            });
            $('costGroupSummary').innerHTML = `<strong>${escapeHtml(data.group.label)} · ревізія ${data.revision}</strong><div class="cost-result-grid">
                <div>Планова виручка<strong>${uahFromMinor(summary.planned.revenueMinor)}</strong></div>
                <div>Планові прямі витрати<strong>${uahFromMinor(summary.planned.directCostMinor)}</strong></div>
                <div>Плановий внесок<strong>${uahFromMinor(summary.planned.contributionMinor)}</strong></div>
                <div>Фактичний внесок<strong>${summary.actualComplete ? uahFromMinor(summary.actualContributionMinor) : 'Ще не визначено'}</strong></div>
            </div><p>${summary.actualComplete ? 'Факт звірено.' : 'Факт групи або її складових ще не звірено.'}</p>
            <ul>${members.map(member => `<li>${member}</li>`).join('')}</ul>`;
            renderGroupMembers('costGroupEditMembers', data.members);
            $('costGroupHistory').innerHTML = `<h4>Історія складу</h4>${data.history.map(revision => {
                const composition = revision.members.map(member => {
                    const plan = state.plans.find(item => String(item.id) === String(member.plan_id));
                    return `<li>${escapeHtml(plan?.execution_label || `#${member.plan_id}`)}: ${member.include_plan_revenue ? 'виручка' : 'без виручки'}, ${member.include_plan_direct_cost ? 'витрати' : 'без витрат'}</li>`;
                }).join('');
                return `<article><strong>Ревізія ${revision.revision_number}</strong> · ${escapeHtml(revision.reason)}<ul>${composition}</ul></article>`;
            }).join('')}`;
        } catch (error) { groupStatus(error.message, true); }
    }

    async function createGroup() {
        try {
            const members = selectedGroupMembers('costGroupMembers');
            if (!members.length) throw new Error('Виберіть принаймні один план і складову виручки або витрат');
            const response = await apiRequest('POST', '/api/finance/costing/actual/groups', {
                kind: $('costGroupKind').value, label: $('costGroupLabel').value.trim(), members
            });
            await refreshGroups(response.groupId);
            groupStatus('Склад групи збережено як незмінний історичний знімок.');
        } catch (error) { groupStatus(error.message, true); }
    }

    async function saveGroupRevision() {
        try {
            if (!state.group) throw new Error('Спочатку виберіть збережену групу');
            const members = selectedGroupMembers('costGroupEditMembers');
            if (!members.length) throw new Error('Залиште в групі принаймні один план');
            const groupId = state.group.group.id;
            await apiRequest('POST', `/api/finance/costing/actual/groups/${encodeURIComponent(groupId)}/revisions`, {
                expectedRevision: state.group.revision,
                reason: $('costGroupRevisionReason').value.trim(), members
            });
            $('costGroupRevisionReason').value = '';
            await refreshGroups(groupId);
            groupStatus('Нову ревізію складу збережено; звірку групи потрібно повторити.');
        } catch (error) { groupStatus(error.message, true); }
    }

    function managementStatus(elementId, message, error = false) {
        const element = $(elementId);
        element.hidden = !message;
        element.classList.toggle('error', error);
        element.textContent = error ? friendlyError(message) : message;
    }

    async function loadManagementSources() {
        const select = $('costManagementSource');
        select.replaceChildren(new Option('Оберіть фактичне джерело', ''));
        const planId = $('costManagementPlan').value;
        if (!planId) return;
        try {
            const detail = await apiRequest('GET', `/api/finance/costing/actual/plans/${encodeURIComponent(planId)}`);
            detail.sources.forEach(source => select.add(new Option(
                `${source.external_id} · ${source.category} · ${uahFromMinor(source.amount_minor)} · ${source.evidence_state === 'confirmed' ? 'підтверджено вручну' : 'оцінка'}`,
                source.id
            )));
            const plan = state.plans.find(item => String(item.id) === planId);
            if (plan) {
                $('costManagementPerformedOn').value = plan.execution_date;
                $('costManagementEffectOn').value = plan.execution_date;
            }
        } catch (error) { managementStatus('costManagementLinkStatus', error.message, true); }
    }

    async function savePerformance() {
        try {
            const planId = $('costManagementPlan').value;
            if (!planId) throw new Error('Оберіть виконання');
            const url = `/api/finance/costing/management/plans/${encodeURIComponent(planId)}/performance`;
            const current = await apiRequest('GET', url);
            const evidenceType = $('costManagementEvidence').value;
            const payload = { expectedRevision: current.current?.revision_number || 0, state: 'performed',
                performedOn: $('costManagementPerformedOn').value, evidenceType,
                reason: $('costManagementPerformanceReason').value.trim() };
            if (evidenceType === 'attendance') payload.evidenceId = $('costManagementAttendanceId').value.trim();
            await apiRequest('POST', url, payload);
            $('costManagementEffectOn').value = payload.performedOn;
            managementStatus('costManagementPerformanceStatus', 'Факт виконання додано до незмінної історії.');
        } catch (error) { managementStatus('costManagementPerformanceStatus', error.message, true); }
    }

    async function saveManagementLink() {
        try {
            const sourceId = $('costManagementSource').value;
            if (!sourceId) throw new Error('Оберіть підтверджене фактичне джерело');
            const url = `/api/finance/costing/management/sources/${encodeURIComponent(sourceId)}/links`;
            const current = await apiRequest('GET', url);
            const payload = { expectedRevision: current.current?.revision_number || 0,
                kind: $('costManagementKind').value, effectOn: $('costManagementEffectOn').value,
                reason: $('costManagementLinkReason').value.trim() };
            for (const [field, elementId] of [
                ['financeTransactionId', 'costManagementFinanceId'], ['paymentOrderId', 'costManagementPaymentOrderId'],
                ['paymentRefundId', 'costManagementRefundId'], ['originalLinkId', 'costManagementOriginalLinkId'],
                ['payrollInstallmentId', 'costManagementPayrollId'], ['hrTimeRecordId', 'costManagementTimeId'],
                ['confirmedMinutes', 'costManagementMinutes']
            ]) {
                const value = $(elementId).value.trim();
                if (value) payload[field] = value;
            }
            if ($('costManagementHourlyRate').value.trim()) {
                payload.hourlyRateMinor = minorFromUah($('costManagementHourlyRate').value, 'Погодинна ставка');
            }
            const saved = await apiRequest('POST', url, payload);
            managementStatus('costManagementLinkStatus', `Зв’язок #${saved.link.id} збережено як ревізію ${saved.link.revision_number}. Оновіть звіт.`);
        } catch (error) { managementStatus('costManagementLinkStatus', error.message, true); }
    }

    const managementIssueLabels = {
        'Reconciliation explicitly unresolved': 'Звірку призупинено вручну',
        'Confirmed evidence changed or is no longer active': 'Підтверджене джерело змінилося або більше не активне',
        'Execution performance is absent, voided, or changed': 'Факт виконання відсутній, скасований або змінений',
        'Present attendance evidence changed': 'Підтвердження присутності змінилося',
        'Linked finance transaction is missing or outside this business': 'Finance-транзакція відсутня або належить іншому бізнесу',
        'Finance transaction is claimed by multiple economic operations': 'Finance-транзакція прив’язана до кількох операцій',
        'Payroll allocations exceed finance expense': 'Розподіл зарплати перевищує finance-витрату',
        'Earned revenue does not match the linked finance income': 'Виручка не збігається з finance-надходженням',
        'Canonical booking or cash reference changed': 'Booking або платіжний зв’язок змінився',
        'Direct cost does not match the linked finance expense': 'Пряма витрата не збігається з finance-витратою',
        'Finance cost recognition date changed': 'Дата визнання finance-витрати змінилася',
        'Execution performance changed after labor allocation': 'Факт виконання змінився після розподілу праці',
        'Payroll approval, business, or finance link changed': 'Підтвердження зарплати, бізнес або finance-зв’язок змінився',
        'Labor allocations exceed the approved installment': 'Розподіл праці перевищує затверджену виплату',
        'Confirmed hourly time or amount changed': 'Підтверджений час або погодинна сума змінилися',
        'Original earned revenue is no longer financially valid': 'Початкова виручка більше не проходить фінансову перевірку',
        'Original earned-revenue link is missing or correction is too large': 'Початковий зв’язок відсутній або коригування завелике',
        'Refund is not linked to the original payment': 'Повернення не пов’язане з початковим платежем'
    };

    async function loadManagementReport() {
        const result = $('costManagementSummary');
        try {
            const from = $('costManagementFrom').value;
            const to = $('costManagementTo').value;
            const data = await apiRequest('GET', `/api/finance/costing/management/pnl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
            result.innerHTML = `<div class="cost-result-grid">
                <div>Зароблена виручка<strong>${uahFromMinor(data.summary.earnedRevenueMinor)}</strong></div>
                <div>Прямі й зарплатні витрати<strong>${uahFromMinor(data.summary.directCostMinor)}</strong></div>
                <div>Управлінський внесок<strong>${uahFromMinor(data.summary.contributionMinor)}</strong></div>
            </div><p>Лише звірені операції: ${data.lines.length}. Нерозв’язані зв’язки: ${data.unresolved.length}.
            Незв’язані старі finance-транзакції: ${data.legacyUnlinked.finance.count}; фактичні джерела без зв’язку: ${data.legacyUnlinked.costingSourceCount}. Ці суми не додано до підсумку.</p>
            <div class="cost-actual-history">${data.lines.map(line => `<article>${escapeHtml(line.kind)} · ${escapeHtml(line.effectOn)} · ${uahFromMinor(line.amountMinor)} · ${escapeHtml(line.provenance)}</article>`).join('')}</div>
            ${data.unresolved.length ? `<div class="cost-actual-history"><strong>Потребують звірки</strong>${data.unresolved.map(item =>
                `<article><strong>${item.linkId == null ? 'Finance-витрата' : `Зв’язок #${escapeHtml(String(item.linkId))}`}${item.sourceId == null ? '' : ` · джерело #${escapeHtml(String(item.sourceId))}`}${item.financeTransactionId == null ? '' : ` · finance #${escapeHtml(String(item.financeTransactionId))}`}</strong>
                <ul>${(item.issues || []).map(issue => `<li>${escapeHtml(managementIssueLabels[issue] || String(issue))}</li>`).join('')}</ul></article>`).join('')}</div>` : ''}`;
        } catch (error) { result.textContent = friendlyError(error.message); }
    }

    async function load() {
        if (!state.initialized) {
            state.initialized = true;
            const today = new Date().toISOString().slice(0, 10);
            $('costEffectiveFrom').value = today;
            $('costExecutionDate').value = today;
            $('costManagementFrom').value = `${today.slice(0, 8)}01`;
            $('costManagementTo').value = today;
            $('costManagementPerformedOn').value = today;
            $('costManagementEffectOn').value = today;
            $('costManagementAttendanceId').disabled = true;
            $('costTemplateSelect').addEventListener('change', () => { selectTemplate().catch(error => status(error.message, true)); });
            $('costAddLine').addEventListener('click', () => addLine());
            $('costSaveTemplate').addEventListener('click', saveTemplate);
            $('costPreview').addEventListener('click', preview);
            $('costSavePlan').addEventListener('click', savePlan);
            $('costActualPlan').addEventListener('change', loadActual);
            $('costAddSource').addEventListener('click', addActualSource);
            $('costPreviewLink').addEventListener('click', previewCanonicalLink);
            $('costLinkType').addEventListener('change', () => {
                const attendance = $('costLinkType').value === 'education_attendance';
                $('costLinkAmount').disabled = attendance;
                $('costLinkAmount').placeholder = $('costLinkType').value === 'payment_refund' ? '-300.00' : '0.00';
                $('costLinkResult').hidden = true;
            });
            $('costCorrectionSource').addEventListener('change', selectCorrectionSource);
            $('costCorrectSource').addEventListener('click', correctActualSource);
            $('costCompleteCategory').addEventListener('click', saveCompletion);
            $('costCreateGroup').addEventListener('click', createGroup);
            $('costSaveGroupRevision').addEventListener('click', saveGroupRevision);
            $('costGroupSelect').addEventListener('change', loadGroup);
            $('costManagementPlan').addEventListener('change', loadManagementSources);
            $('costManagementPerform').addEventListener('click', savePerformance);
            $('costManagementLink').addEventListener('click', saveManagementLink);
            $('costManagementRefresh').addEventListener('click', loadManagementReport);
            $('costManagementEvidence').addEventListener('change', () => {
                $('costManagementAttendanceId').disabled = $('costManagementEvidence').value !== 'attendance';
            });
            $('costSourceCategory').addEventListener('change', () => {
                $('costSourceSemantic').value = $('costSourceCategory').value === 'direct_cost' ? 'cost' : 'charge';
            });
            $('tabCosting').addEventListener('input', event => {
                if (event.target.closest('#costLineQuantities') ||
                    ['costExecutionDate','costParticipants','costPaidParticipants','costHours','costUnits','costDiscountPercent','costDiscountMoney'].includes(event.target.id)) invalidatePreview();
            });
        }
        try {
            await Promise.all([refreshTemplates($('costTemplateSelect').value || null), refreshPlans()]);
            await refreshGroups();
        } catch (error) { status(error.message, true); }
    }

    return { load };
})();
