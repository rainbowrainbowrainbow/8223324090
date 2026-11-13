/* Shared staff substitution workspace. Uses the existing authenticated API and modal lifecycle. */
(function () {
    'use strict';
    let busy = false;
    let pendingCommand = null;
    const labels = { active: 'Заплановано', completed: 'Виконано', cancelled: 'Скасовано' };
    const actions = {create:'Створено',revise:'Умови змінено',complete:'Виконання підтверджено',cancel:'Скасовано'};
    const money = minor => new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format((minor || 0) / 100);
    const choice = (key, label, options, value = '') => ({ key, label, type: 'select', required: true, defaultValue: value,
        options: [{ value: '', label: 'Оберіть…' }, ...options.map(([value, label]) => ({ value, label }))] });
    const field = (key, label, value = '', type = 'text', required = true) => ({ key, label, defaultValue: value, type, required });
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    async function request(method, path, body) {
        const response = await apiCall(method, `/staff-substitutions${path}`, body);
        if (!response?.success) {
            if (response?.success === false && response?.code) pendingCommand = null;
            throw new Error(response?.error || 'З’єднання перервано. Запит збережено до повторної спроби на цій сторінці.');
        }
        return response.data;
    }
    async function saveCommand(path, body) {
        pendingCommand = { path, body: { ...body, requestKey: crypto.randomUUID() } };
        return resumeCommand();
    }
    async function resumeCommand() {
        const command = pendingCommand;
        const result = await request('POST', command.path, command.body);
        pendingCommand = null;
        return result;
    }
    function localTime(date, time, offset) {
        if (!time) return null;
        const candidates = ['+02:00', '+03:00'].map(value => `${date}T${time}:00${value}`).filter(value => {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
            const p = Object.fromEntries(parts.map(part => [part.type,part.value]));
            return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
        });
        const value = candidates.length === 1 ? candidates[0] : candidates.find(value => value.endsWith(offset));
        if (!value) throw new Error('Час неоднозначний або не існує через переведення годинника. Уточніть UTC-зміщення.');
        return value;
    }

    async function create(prefill = {}) {
        const catalog = await request('GET', '/catalog');
        const people = catalog.staff.map(person => [String(person.id), person.name]);
        const first = await formModal('Людина на заміну · робота', [
            ...(catalog.unavailableSources?.length ? [{type:'note',text:`Поки недоступні: ${catalog.unavailableSources.map(item=>item.title).join(', ')}.`}] : []),
            choice('staffId', 'Хто виконує роботу', people, prefill.staffId),
            choice('professionKey', 'Роль на цю роботу', catalog.professions.map(role => [role.key,role.title]), prefill.professionKey),
            { ...choice('originalStaffId', 'Кого замінює', people, prefill.originalStaffId), required: false,
                options: [{ value: '', label: 'Окрема робота без заміненого працівника' }, ...people.map(([value,label]) => ({ value,label }))] },
            choice('sourceType', 'Процес', catalog.sources.map(source => [source.key,source.title]), prefill.sourceType || 'standalone'),
            {...choice('slotKey','Слот призначення',[['primary','Основний'],['second','Другий аніматор Афіші']],prefill.slotKey || 'primary'),visibleWhen:values=>values.sourceType==='afisha'},
            field('workDate', 'Дата роботи', prefill.workDate || today(), 'date'),
            field('workload', 'Обсяг роботи та умова завершення', prefill.workload),
            field('reason', 'Причина підміни', prefill.reason)
        ], { okText: 'Умови оплати', icon: '🔁' });
        if (!first) return;
        if (first.sourceType!=='afisha') first.slotKey='primary';
        let source = null;
        if (first.sourceType === 'standalone') first.sourceId = crypto.randomUUID();
        else if (prefill.sourceId && first.sourceType===prefill.sourceType) first.sourceId = prefill.sourceId;
        else {
            if (!first.originalStaffId) throw new Error('Для передачі призначення оберіть, кого замінює працівник.');
            const sources=await request('GET',`/sources?${new URLSearchParams({sourceType:first.sourceType,workDate:first.workDate,originalStaffId:first.originalStaffId})}`);
            if (!sources.length) throw new Error('Для цього працівника немає доступних призначень у вибраному процесі.');
            const picked=await formModal('Оберіть роботу для передачі',[choice('sourceId','Призначення',sources.map(item=>[item.id,item.title]))],{okText:'Умови оплати'});
            if (!picked) return;
            first.sourceId=picked.sourceId;
            source=sources.find(item=>item.id===picked.sourceId);
        }
        const terms = await formModal('Людина на заміну · умови', [
            choice('payUnit', 'Оплата', [['hour','Погодинна'],['shift','За зміну'],['fixed','Фіксована за роботу']]),
            field('startTime', 'Початок (для погодинної обов’язково)', source?.startTime || '', 'time', false),
            field('endDate', 'Дата завершення', first.workDate, 'date'),
            field('endTime', 'Завершення', source?.endTime || '', 'time', false),
            field('breakMinutes', 'Неоплачувана перерва, хв', String(source?.breakMinutes || 0), 'number'),
            field('shiftUnits', 'Кількість змін / погоджена частка зміни', '1', 'text'),
            { ...choice('offset', 'Лише для неоднозначного часу переведення годинника', [['+02:00','UTC+02:00'],['+03:00','UTC+03:00']]), required: false },
            choice('payMode', 'Що відбувається зі звичайною оплатою виконавця', [['additional','Підміна оплачується додатково'],['replace_base','Оплата підміни замінює звичайну за цей обсяг']]),
            ...(first.originalStaffId ? [choice('originalTreatment', 'Оплата заміненого працівника', [['retain','Зберегти звичайну оплату'],['transfer_unworked_scope','Передати лише невідпрацьований обсяг']])] : []),
            choice('temporaryAdmission', 'Допуск до робочої ролі', [['false','Використати чинний допуск'],['true','Явно погодити разовий допуск (керівник HR)']], 'false'),
            field('admissionReason', 'Підстава разового допуску', '', 'text', false),
            choice('allowConcurrent', 'Суміщення з власною зміною', [['false','Без суміщення'],['true','Погоджене суміщення']], 'false'),
            field('concurrentReason', 'Підстава суміщення', '', 'text', false)
        ], { okText: 'Показати стандартну ставку', icon: '🔁' });
        if (!terms) return;
        const input = { ...first, ...terms, temporaryAdmission: terms.temporaryAdmission === 'true', allowConcurrent: terms.allowConcurrent === 'true',
            startsAt: localTime(first.workDate, terms.startTime, terms.offset), endsAt: localTime(terms.endDate, terms.endTime, terms.offset),
            rateMode: 'standard', originalStaffId: first.originalStaffId || null };
        const standard = await request('POST', '/preview', { input });
        const rate = await formModal('Людина на заміну · ставка', [
            { type: 'note', text: standard.rate ? `Стандартна ставка: ${money(standard.rate.rateMinor)}. ${standard.rate.title || standard.rate.source || ''}` : 'Стандартну ставку для обраної одиниці не знайдено.' },
            choice('rateMode', 'Джерело ставки', [['standard','Стандартна ставка'],['individual','Індивідуальна ставка']], standard.rate ? 'standard' : 'individual'),
            field('rate', 'Індивідуальна ставка / фіксована сума, грн', '', 'text', false),
            field('rateReason', 'Причина індивідуальної ставки', '', 'text', false)
        ], { okText: 'Попередній розрахунок', icon: '🔁' });
        if (!rate) return;
        Object.assign(input, rate);
        const quote = await request('POST', '/preview', { input });
        if (!quote.available) throw new Error(quote.blockers.map(blocker => blocker.message).join('\n'));
        const confirmed = await confirmModal(`Попередня сума: ${money(quote.estimateMinor)}\n${quote.effects.replacement}\n${quote.effects.original}\n`
            + quote.warnings.map(warning => warning.message).join('\n') + '\nНарахування відбудеться після підтвердження фактичної роботи.',
        { okText: 'Погоджую наслідки та зберігаю', cancelText: 'Скасувати' });
        if (!confirmed) return;
        await saveCommand('', { input, previewFingerprint: quote.fingerprint, effectsAcknowledged: true });
        showNotification('Підміну збережено. Історичну ставку зафіксовано.', 'success');
        window.dispatchEvent(new CustomEvent('staff-substitution:changed'));
    }

    async function inspect(row) {
        const history = await request('GET', `/${encodeURIComponent(row.id)}/history`);
        const details = history.substitution;
        const selected = await formModal(`Підміна #${row.id} · ${labels[details.state]}`, [
            { type: 'note', text: `${details.input.workload}\nПлан: ${money(details.quote.estimateMinor)}\nФакт: ${details.completion ? money(details.completion.amountMinor) : 'ще не підтверджено'}\n`
                + `${details.quote.effects.replacement}\n${details.quote.effects.original}\n`
                + history.events.map(event => `Версія ${event.version} · ${actions[event.action] || event.action} · ${event.actor}: ${event.reason}`).join('\n') },
            ...(details.state === 'active' ? [choice('action', 'Дія', [['complete','Підтвердити виконання'],['revise','Змінити погоджену ставку до початку роботи'],['cancel','Скасувати підміну']])] : [])
        ], { okText: details.state === 'active' ? 'Продовжити' : 'Закрити', cancelText: 'Закрити' });
        if (!selected?.action) return;
        if (selected.action === 'revise') {
            const terms=await formModal('Зміна ставки підміни',[
                field('rate','Нова погоджена ставка, грн',String(details.quote.rate.rateMinor/100)),
                field('rateReason','Підстава індивідуальної ставки'),field('reason','Причина зміни погодження')
            ],{okText:'Попередній розрахунок'});
            if (!terms) return;
            const input={...details.input,...terms,rateMode:'individual',shiftUnits:details.input.shiftUnitsMilli/1000};
            const quote=await request('POST','/preview',{input,id:row.id});
            if (!quote.available) throw new Error(quote.blockers.map(item=>item.message).join('\n'));
            if (!await confirmModal(`Було: ${money(details.quote.estimateMinor)}\nСтане: ${money(quote.estimateMinor)}\n${quote.effects.replacement}\n${quote.effects.original}`,{okText:'Погоджую нову ставку'})) return;
            await saveCommand(`/${row.id}/revise`,{input,previewFingerprint:quote.fingerprint,effectsAcknowledged:true,expectedVersion:details.version});
            showNotification('Нову ставку зафіксовано в історії','success');
            window.dispatchEvent(new CustomEvent('staff-substitution:changed'));
            return;
        }
        const base = selected.action === 'complete' && details.input.payMode === 'replace_base'
            ? await request('GET', `/${row.id}/completion-options`) : null;
        if (base && !base.allocations.length) throw new Error('Спершу завершіть облік фактичної роботи. Після цього можна вибрати звичайну оплату, яку замінює підміна.');
        const values = await formModal(selected.action === 'cancel' ? 'Скасування підміни' : 'Фактично виконана робота', [
            field('reason', 'Підстава дії'),
            ...(selected.action === 'complete' ? [field('workEvidence', 'Підтвердження результату'),
                ...(details.input.payUnit === 'hour' ? [field('actualMinutes', 'Фактичні оплачувані хвилини', String(details.input.plannedMinutes), 'number')] : []),
                ...(details.input.payUnit === 'shift' ? [field('completedShiftUnits', 'Виконані зміни', String(details.input.shiftUnitsMilli / 1000))] : []),
                ...(base ? [{ key: 'baseAllocationIndices', type: 'checkboxGroup', label: 'Звичайна оплата, яку замінює підміна', required: true,
                    options: base.allocations.map(item => ({value:String(item.index),label:`${item.professionKey} · ${item.actualMinutes} хв · ${item.rate} грн/${item.rateUnit}`})) }] : [])] : [])
        ], { okText: 'Підтвердити', type: selected.action === 'cancel' ? 'warning' : 'success' });
        if (!values) return;
        if (base) values.attendanceId = base.attendanceId;
        await saveCommand(`/${row.id}/${selected.action}`, { ...values, workConfirmed: true, expectedVersion: details.version });
        showNotification('Стан підміни оновлено', 'success');
        window.dispatchEvent(new CustomEvent('staff-substitution:changed'));
    }

    async function workspace() {
        const range = await formModal('Підміни · графік і облік', [field('from', 'Від', today(), 'date'),field('to', 'До', today(), 'date')], { okText: 'Показати' });
        if (!range) return;
        const rows = await request('GET', `?${new URLSearchParams(range)}`);
        const choiceResult = await formModal('Підміни · графік і облік', [
            { type: 'note', text: rows.length ? 'Оберіть підміну для обліку виконання та історії. Підтверджена оплата відображається у зарплатному розрахунку.' : 'За обраний період підмін немає.' },
            choice('selected', 'Підміна', [['new','Створити підміну'], ...rows.map(row => [row.id, `${row.input.workDate} · ${row.input.workload} · ${labels[row.state]} · ${money(row.completion?.amountMinor ?? row.quote.estimateMinor)}`])], 'new')
        ], { okText: 'Відкрити' });
        if (!choiceResult) return;
        if (choiceResult.selected === 'new') return create();
        return inspect(rows.find(row => row.id === choiceResult.selected));
    }

    async function run(work) {
        if (busy) return;
        busy = true;
        const trigger = document.activeElement;
        if (trigger instanceof HTMLButtonElement) trigger.disabled = true;
        try {
            if (pendingCommand) {
                const retry = await confirmModal('Попередній запит не отримав підтвердження. Повторити його з тим самим ключем, щоб уникнути подвійної підміни?', {okText:'Повторити запит',cancelText:'Закрити'});
                if (retry) { await resumeCommand(); showNotification('Запит підтверджено без повторного нарахування','success'); }
                return;
            }
            await work();
        }
        catch (error) { showNotification(error.message, 'error'); }
        finally { busy = false; if (trigger instanceof HTMLButtonElement) trigger.disabled = false; trigger?.focus?.(); }
    }
    function install() {
        const host = document.getElementById('staffSubstitutionActions');
        if (!host) return;
        host.hidden = !(typeof canUseAction === 'function' && canUseAction('hr.staff.view') && canUseAction('hr.payroll.view'));
        if (host.dataset.ready) return;
        host.dataset.ready = 'true';
        host.addEventListener('click', event => {
            const action = event.target.closest('[data-substitution-action]')?.dataset.substitutionAction;
            if (action) run(action === 'create' ? () => create() : workspace);
        });
    }
    window.StaffSubstitution = { open: prefill => run(() => create(prefill)), workspace: () => run(workspace) };
    window.addEventListener('crm:authenticated-runtime-ready', install);
    window.addEventListener('permissions:lifecycle', install);
    window.addEventListener('crm:auth-cleared', () => { const host = document.getElementById('staffSubstitutionActions'); if (host) host.hidden = true; });
    install();
}());
