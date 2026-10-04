/* Printable, read-only roster for the HR Today tab. */
(function () {
    'use strict';

    const MAX_EMPTY_ROWS = 50;
    const DEFAULT_EMPTY_ROWS = 5;
    const excludedShiftTypes = new Set(['dayoff', 'day_off', 'vacation', 'sick']);
    let dialog;
    let frame;
    let printButton;
    let status;
    let rows = null;
    let rosterDate = '';
    let requestNumber = 0;
    let opener = null;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
    }

    function currentScope() {
        const user = typeof getHrCurrentUser === 'function' ? getHrCurrentUser() : null;
        const scope = typeof resolveCrmBusinessScopeState === 'function'
            ? resolveCrmBusinessScopeState(user) : null;
        return JSON.stringify({
            mode: scope?.mode || 'single',
            context: scope?.activeContext || user?.activeBusinessContext || '',
            href: window.location.href
        });
    }

    function canOpen() {
        const scope = typeof resolveCrmBusinessScopeState === 'function'
            ? resolveCrmBusinessScopeState(typeof getHrCurrentUser === 'function' ? getHrCurrentUser() : null) : null;
        if (scope && scope.mode !== 'single') return false;
        return typeof canExportHrReports === 'function' && canExportHrReports()
            && typeof canUseHrCapability === 'function'
            && canUseHrCapability('hr.today.view')
            && canUseHrCapability('hr.schedule.view');
    }

    async function fetchEligibleRoster() {
        if (typeof apiFetchWithAuthRetry !== 'function') throw new Error('Не вдалося завантажити допуски.');
        const response = await apiFetchWithAuthRetry('/api/staff', { headers: { Accept: 'application/json' } });
        const data = await response?.json().catch(() => null);
        if (!response?.ok || data?.success !== true) {
            throw new Error(data?.error || 'Не вдалося завантажити допуски.');
        }
        return data;
    }

    function eligibleKeys(staff) {
        const primary = String(staff?.role_type || '').trim();
        const secondary = Array.isArray(staff?.secondary_professions)
            ? staff.secondary_professions : [];
        return [...new Set([primary, ...secondary].map(key => String(key || '').trim()).filter(Boolean))];
    }

    function labelFor(key) {
        return (typeof professionTitle === 'function' && professionTitle(key)) || key;
    }

    function plannedSegments(shift, fallbackProfession = '') {
        if (!shift || excludedShiftTypes.has(String(shift.shift_type || '').toLowerCase())) return [];
        if (Array.isArray(shift.segments) && shift.segments.length) return shift.segments.map(segment => ({
            profession: segment.professionKey || segment.profession_key || shift.primary_profession_key || fallbackProfession,
            start: segment.shiftStart || segment.planned_start || '',
            end: segment.shiftEnd || segment.planned_end || ''
        }));
        if (!shift.planned_start && !shift.planned_end) return [];
        return [{ profession: shift.primary_profession_key || fallbackProfession,
            start: shift.planned_start || '', end: shift.planned_end || '' }];
    }

    function buildRows(today, staffResponse) {
        if (today?.success !== true || staffResponse?.success !== true
            || !Array.isArray(today.data) || !Array.isArray(staffResponse.data)
            || !/^\d{4}-\d{2}-\d{2}$/.test(today.date || '')) {
            throw new Error('Не вдалося отримати повний графік і допуски. Спробуйте ще раз.');
        }
        const staffById = new Map(staffResponse.data.map(person => [Number(person.id), person]));
        const result = [];
        for (const person of today.data) {
            const segments = plannedSegments(person.shift, person.role_type || person.position || '');
            if (!segments.length) continue;
            const staff = staffById.get(Number(person.staff_id));
            if (!staff) throw new Error('Дані про допуски запланованої людини недоступні. Спробуйте ще раз.');
            result.push({
                id: person.staff_id,
                name: person.staff_name || staff.name || '',
                segments,
                eligible: eligibleKeys(staff)
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    }

    function formatTime(value) {
        const match = String(value || '').match(/^(\d{1,2}:\d{2})/);
        return match ? match[1] : '—';
    }

    function buildSheetHtml(date, roster, emptyRows) {
        const count = Math.max(0, Math.min(MAX_EMPTY_ROWS, Math.trunc(Number(emptyRows) || 0)));
        const dateLabel = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(new Date(`${date}T12:00:00Z`));
        const bodyRows = roster.map((person, index) => {
            const plan = person.segments.map(segment => `<div class="plan-line">${escapeHtml(labelFor(segment.profession) || 'Посаду не вказано')} · ${escapeHtml(formatTime(segment.start))}–${escapeHtml(formatTime(segment.end))}</div>`).join('');
            const roles = person.eligible.length
                ? person.eligible.map(key => `<div class="role-line"><span class="paper-checkbox" aria-hidden="true"></span>${escapeHtml(labelFor(key))}</div>`).join('')
                : '<span class="muted">Допуски не вказано</span>';
            return { html: `<tr><td class="number">${index + 1}</td><td class="person-name">${escapeHtml(person.name)}</td><td>${plan}</td><td>${roles}</td><td></td><td></td><td></td><td></td></tr>`,
                units: Math.max(1, person.segments.length, person.eligible.length) };
        });
        for (let index = 0; index < count; index += 1) {
            bodyRows.push({ html: `<tr class="empty-row"><td class="number">${roster.length + index + 1}</td><td></td><td></td><td><span class="paper-checkbox" aria-hidden="true"></span></td><td></td><td></td><td></td><td></td></tr>`, units: 1 });
        }
        const pages = [];
        let page = [];
        let units = 0;
        for (const row of bodyRows) {
            if (page.length && units + row.units > 20) {
                pages.push(page);
                page = [];
                units = 0;
            }
            page.push(row.html);
            units += row.units;
        }
        if (page.length) pages.push(page);
        const heading = `<thead><tr class="sheet-heading"><th colspan="8"><strong>Бланк відмічалки на сьогодні</strong><span>Event Genix · ${escapeHtml(dateLabel)}</span></th></tr><tr class="column-heading"><th>№</th><th>ПІБ</th><th>Планова посада / зміна</th><th>Фактична посада (позначити)</th><th>Прихід</th><th>Вихід</th><th>Примітка</th><th>Підпис</th></tr></thead>`;
        const sheets = pages.map(rowsOnPage => `<section class="sheet-page"><table class="attendance-sheet">${heading}<tbody>${rowsOnPage.join('')}</tbody></table></section>`).join('');
        return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Бланк виходу · ${escapeHtml(date)}</title><link rel="stylesheet" href="/css/hr-today-print.css?v=0.82.63"></head><body class="hr-today-print-document">${sheets}</body></html>`;
    }

    function setStatus(message, kind = '') {
        status.textContent = message;
        status.dataset.state = kind;
    }

    function updatePreview() {
        const count = Math.trunc(Number(dialog.querySelector('#hrTodayPrintEmptyRows').value) || 0);
        printButton.disabled = true;
        if (!rows) return;
        const hasRows = rows.length + count > 0;
        frame.hidden = !hasRows;
        if (!hasRows) {
            setStatus('На сьогодні немає запланованих людей. Додайте порожні рядки для друку.', 'empty');
            return;
        }
        setStatus(rows.length ? `${rows.length} людей за графіком · ${count} порожніх рядків` : `Немає людей за графіком · ${count} порожніх рядків`, rows.length ? 'ready' : 'empty');
        frame.onload = () => { printButton.disabled = false; };
        frame.srcdoc = buildSheetHtml(rosterDate, rows, count);
    }

    function closeDialog() {
        requestNumber += 1;
        dialog.hidden = true;
        frame.srcdoc = '';
        rows = null;
        opener?.focus();
        opener = null;
    }

    async function openDialog(event) {
        if (!canOpen()) return;
        if (dialog.hidden) opener = event?.currentTarget || document.activeElement;
        dialog.hidden = false;
        frame.hidden = true;
        printButton.disabled = true;
        rows = null;
        setStatus('Завантажуємо сьогоднішній графік…', 'loading');
        dialog.querySelector('#hrTodayPrintClose').focus();
        const ownRequest = ++requestNumber;
        const scope = currentScope();
        dialog.dataset.scope = scope;
        try {
            const today = await hrFetch('/today');
            if (today?.success !== true) throw new Error(today?.error || 'Не вдалося завантажити графік.');
            const staff = await fetchEligibleRoster();
            if (ownRequest !== requestNumber || dialog.hidden) return;
            if (scope !== currentScope()) throw new Error('Активний бізнес змінився. Відкрийте бланк повторно.');
            rows = buildRows(today, staff);
            rosterDate = today.date;
            updatePreview();
        } catch (error) {
            if (ownRequest !== requestNumber || dialog.hidden) return;
            rows = null;
            frame.hidden = true;
            printButton.disabled = true;
            setStatus(error?.message || 'Не вдалося підготувати бланк.', 'error');
        }
    }

    function init() {
        const trigger = document.getElementById('btnHrTodayPrint');
        if (!trigger || document.getElementById('hrTodayPrintDialog')) return;
        trigger.hidden = !canOpen();
        dialog = document.createElement('div');
        dialog.id = 'hrTodayPrintDialog';
        dialog.className = 'hr-today-print-overlay';
        dialog.hidden = true;
        dialog.innerHTML = `<section class="hr-today-print-modal" role="dialog" aria-modal="true" aria-labelledby="hrTodayPrintTitle"><header><div><h2 id="hrTodayPrintTitle">Бланк відмічалки на сьогодні</h2><p>Дані графіка завантажуються заново перед друком. Відмітки на папері не змінюють CRM.</p></div><button type="button" id="hrTodayPrintClose" aria-label="Закрити">×</button></header><div class="hr-today-print-controls"><label for="hrTodayPrintEmptyRows">Додаткові порожні рядки</label><input id="hrTodayPrintEmptyRows" type="number" min="0" max="50" step="1" value="5"><button type="button" id="hrTodayPrintRetry">Оновити дані</button><button type="button" id="hrTodayPrintGo" disabled>Друкувати</button></div><p id="hrTodayPrintStatus" role="status" aria-live="polite"></p><div class="hr-today-print-preview" role="region" aria-label="Попередній перегляд бланка, горизонтальна прокрутка"><iframe id="hrTodayPrintFrame" title="Попередній перегляд бланка" hidden></iframe></div></section>`;
        document.body.append(dialog);
        frame = dialog.querySelector('#hrTodayPrintFrame');
        status = dialog.querySelector('#hrTodayPrintStatus');
        printButton = dialog.querySelector('#hrTodayPrintGo');
        trigger.addEventListener('click', openDialog);
        dialog.querySelector('#hrTodayPrintClose').addEventListener('click', closeDialog);
        dialog.querySelector('#hrTodayPrintRetry').addEventListener('click', openDialog);
        dialog.querySelector('#hrTodayPrintEmptyRows').addEventListener('input', event => {
            const input = event.currentTarget;
            input.value = String(Math.max(0, Math.min(MAX_EMPTY_ROWS, Math.trunc(Number(input.value) || 0))));
            updatePreview();
        });
        printButton.addEventListener('click', () => {
            if (!rows || !canOpen() || currentScope() !== dialog.dataset.scope) return;
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
        });
        dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !dialog.hidden) closeDialog();
        });
        window.addEventListener('popstate', () => { if (!dialog.hidden) closeDialog(); });
        window.addEventListener('focus', () => { trigger.hidden = !canOpen(); });
        const mainApp = document.getElementById('mainApp');
        if (mainApp && typeof MutationObserver === 'function') {
            new MutationObserver(() => { trigger.hidden = !canOpen(); })
                .observe(mainApp, { attributes: true, attributeFilter: ['class'] });
        }
    }

    window.HrTodayPrint = { buildRows, buildSheetHtml, plannedSegments, init };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
