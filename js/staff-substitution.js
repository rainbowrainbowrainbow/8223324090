/* Shared staff substitution workspace. Uses the existing authenticated API and modal lifecycle. */
(function () {
    'use strict';
    let busy = false;
    let pendingCommand = null;
    const host = () => document.getElementById('staffSubstitutionActions');
    const dar = () => host()?.dataset.substitutionBusiness === 'dar';
    const timelineBusiness = () => window.TimelineBusinessContext?.current?.()?.apiValue;
    const isDarSchedule = () => timelineBusiness() === 'dar' && window.TimelineBusinessContext?.presentation?.()?.mode === 'education';
    const canManage = () => ['hr.schedule.manage','hr.payroll.manage','manage_payroll_rules','edit_booking'].every(action => canUseAction(action));
    const labels = { active: 'Заплановано', completed: 'Виконано', cancelled: 'Скасовано' };
    const actions = {create:'Створено',revise:'Умови змінено',complete:'Виконання підтверджено',cancel:'Скасовано'};
    const money = minor => new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format((minor || 0) / 100);
    const choice = (key, label, options, value = '') => ({ key, label, type: 'select', required: true, defaultValue: value,
        options: [{ value: '', label: 'Оберіть…' }, ...options.map(([value, label]) => ({ value, label }))] });
    const field = (key, label, value = '', type = 'text', required = true) => ({ key, label, defaultValue: value, type, required });
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    async function request(method, path, body) {
        if (dar()) {
            if (!isDarSchedule()) throw new Error('Поверніться до навчального розкладу Дару, щоб продовжити.');
            path += `${path.includes('?') ? '&' : '?'}businessContext=dar`;
        }
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
        window.dispatchEvent(new CustomEvent('staff-substitution:changed', { detail: { business: dar() ? 'dar' : 'event_genix' } }));
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
        const education = dar();
        const people = catalog.staff.map(person => [String(person.id), person.name]);
        const first = await formModal('Людина на заміну · робота', [
            ...(catalog.unavailableSources?.length ? [{type:'note',text:`Поки недоступні: ${catalog.unavailableSources.map(item=>item.title).join(', ')}.`}] : []),
            choice('staffId', 'Хто виконує роботу', people, prefill.staffId),
            ...(education ? [choice('originalStaffId', 'Кого замінює', people, prefill.originalStaffId)] : [
                choice('professionKey', 'Роль на цю роботу', catalog.professions.map(role => [role.key,role.title]), prefill.professionKey),
                { ...choice('originalStaffId', 'Кого замінює', people, prefill.originalStaffId), required: false,
                    options: [{ value: '', label: 'Окрема робота без заміненого працівника' }, ...people.map(([value,label]) => ({ value,label }))] },
                choice('sourceType', 'Процес', catalog.sources.map(source => [source.key,source.title]), prefill.sourceType || 'standalone')
            ]),
            {...choice('animatorSlot','Слот призначення',[['primary','Основний аніматор'],['second','Другий аніматор']],prefill.slotKey || 'primary'),
                visibleWhen:values=>['afisha','booking'].includes(values.sourceType)},
            {...choice('shiftScope','Обсяг зміни',[['primary','Уся зміна'],['partial','Частина зміни']],prefill.slotKey || 'primary'),visibleWhen:values=>values.sourceType==='hr_shift'},
            field('workDate', 'Дата роботи', prefill.workDate || (education && window.EducationScheduleWorkspace?.state?.date) || today(), 'date'),
            field('workload', 'Обсяг роботи та умова завершення', prefill.workload),
            field('reason', 'Причина підміни', prefill.reason)
        ], { okText: 'Умови оплати', icon: '🔁' });
        if (!first) return;
        if (education) Object.assign(first, { professionKey: 'teacher', sourceType: 'education_lesson' });
        const { animatorSlot, shiftScope } = first;
        first.slotKey = (['afisha','booking'].includes(first.sourceType) ? animatorSlot : first.sourceType === 'hr_shift' ? shiftScope : null) || 'primary';
        delete first.animatorSlot;
        delete first.shiftScope;
        let source = null;
        if (first.sourceType === 'standalone') first.sourceId = crypto.randomUUID();
        else if (prefill.sourceId && first.sourceType===prefill.sourceType) first.sourceId = prefill.sourceId;
        else {
            if (!first.originalStaffId) throw new Error('Для передачі призначення оберіть, кого замінює працівник.');
            const sources=await request('GET',`/sources?${new URLSearchParams({sourceType:first.sourceType,workDate:first.workDate,originalStaffId:first.originalStaffId,slotKey:first.slotKey})}`);
            if (!sources.length) throw new Error('Для цього працівника немає доступних призначень у вибраному процесі.');
            const picked=await formModal('Оберіть роботу для передачі',[choice('sourceId','Призначення',sources.map(item=>[item.id,item.title]))],{okText:'Умови оплати'});
            if (!picked) return;
            first.sourceId=picked.sourceId;
            source=sources.find(item=>item.id===picked.sourceId);
            if (source?.slotKey) {
                first.slotKey = source.slotKey;
                first.sourceId = source.sourceId;
            }
        }
        const terms = await formModal('Людина на заміну · умови', [
            ...(first.sourceType === 'booking' ? [{type:'note',text:'Звичайна оплата заміненого працівника зберігається. Заміна основної оплати виконавця потребує завершеного сегмента обліку з тим самим часом, що й бронювання.'}] : []),
            ...(education ? [{ type: 'note', text: 'Оплата за підміну одного заняття нараховується викладачу в Дарі.' }] : []),
            choice('payUnit', 'Оплата', education ? [['hour','Погодинна'],['fixed','Фіксована за заняття']] : [['hour','Погодинна'],['shift','За зміну'],['fixed','Фіксована за роботу']]),
            field('startTime', education ? 'Початок заняття' : 'Початок (для погодинної або заміни основної оплати обов’язково)', source?.startTime || '', 'time', education),
            field('endDate', 'Дата завершення', source?.endDate || first.workDate, 'date'),
            field('endTime', 'Завершення', source?.endTime || '', 'time', education),
            ...(!education ? [field('breakMinutes', 'Неоплачувана перерва, хв', String(source?.breakMinutes || 0), 'number'),
                field('shiftUnits', 'Кількість змін / погоджена частка зміни', '1', 'text')] : []),
            { ...choice('offset', 'Лише для неоднозначного часу переведення годинника', [['+02:00','UTC+02:00'],['+03:00','UTC+03:00']]), required: false },
            ...(!education ? [choice('payMode', 'Що відбувається зі звичайною оплатою виконавця', [['additional','Підміна оплачується додатково'],['replace_base','Оплата підміни замінює звичайну за цей обсяг']]),
            ...(first.originalStaffId ? [choice('originalTreatment', 'Оплата заміненого працівника', [['retain','Зберегти оплату за передані години'],['transfer_unworked_scope','Передати невідпрацьовані години без збереження оплати']])] : []),
            choice('temporaryAdmission', 'Допуск до робочої ролі', [['false','Використати чинний допуск'],['true','Явно погодити разовий допуск (керівник HR)']], 'false'),
            field('admissionReason', 'Підстава разового допуску', '', 'text', false),
            choice('allowConcurrent', 'Суміщення з власною зміною', [['false','Без суміщення'],['true','Погоджене суміщення']], 'false'),
            field('concurrentReason', 'Підстава суміщення', '', 'text', false)] : [])
        ], { okText: 'Показати стандартну ставку', icon: '🔁' });
        if (!terms) return;
        if (education) Object.assign(terms, { payMode: 'additional', originalTreatment: 'retain' });
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
        const sourcePlan = quote.evidence?.source;
        const formatSegments = plan => plan?.segments?.length ? plan.segments.map(segment =>
            `${segment.shiftStart}–${segment.shiftEnd}${segment.shiftEnd <= segment.shiftStart ? ' (+1 день)' : ''}`).join(', ') : 'без зміни';
        const scheduleEffect = sourcePlan?.partial
            ? `\nУ графіку заміненого працівника залишиться: ${formatSegments(sourcePlan.originalAfter)}.\nГрафік виконавця: ${formatSegments(sourcePlan.replacementAfter)}.`
            : '';
        const beforeSchedule = sourcePlan?.partial && sourcePlan.originalBefore
            ? `\nБуло у заміненого: ${formatSegments(sourcePlan.originalBefore.plan)}. Було у виконавця: ${formatSegments(sourcePlan.replacementBefore?.plan)}.`
            : '';
        const originalWorkload = input.sourceType === 'hr_shift' && input.originalTreatment === 'transfer_unworked_scope'
            ? `\nІз плану заміненого передається ${quote.input.plannedMinutes} робочих хвилин.`
            : '';
        const originalImpact = quote.payImpact?.original;
        const replacementImpact = quote.payImpact?.replacement;
        const payImpact = quote.payImpact ? [
            originalImpact ? (input.originalTreatment === 'retain'
                ? `Замінений працівник зберігає ${money(originalImpact.amountMinor)} за передані години.`
                : `У заміненого працівника планова оплата зменшується на ${money(originalImpact.amountMinor)} за передані години.`)
                : 'Оплата заміненого працівника за передані години залежить від його тарифу й умов табеля.',
            replacementImpact ? (input.payMode === 'additional'
                ? `Виконавець: ${money(replacementImpact.amountMinor)} основної оплати + ${money(quote.estimateMinor)} доплати = ${money(replacementImpact.amountMinor + quote.estimateMinor)} за планом.`
                : `Виконавець: ${money(replacementImpact.amountMinor)} звичайної погодинної оплати за планом замінюється на ${money(quote.estimateMinor)}.`)
                : 'Звичайна оплата виконавця визначається за завершеним табелем.'
        ].join('\n') : '';
        const assignmentSummary = first.sourceType === 'booking' && source
            ? `${source.title} · ${first.workDate}\n${first.slotKey === 'second' ? 'Другий аніматор' : 'Основний аніматор'}\n` : '';
        const confirmed = await confirmModal(`${assignmentSummary}Оплата підміни за планом: ${money(quote.estimateMinor)}\n${quote.effects.replacement}\n${quote.effects.original}\n`
            + quote.warnings.map(warning => warning.message).join('\n') + beforeSchedule + scheduleEffect + originalWorkload + (payImpact ? `\n${payImpact}` : '') + '\nНарахування відбудеться після підтвердження фактичної роботи.',
        { okText: 'Погоджую наслідки та зберігаю', cancelText: 'Скасувати' });
        if (!confirmed) return;
        await saveCommand('', { input, previewFingerprint: quote.fingerprint, effectsAcknowledged: true });
        showNotification('Підміну збережено. Історичну ставку зафіксовано.', 'success');
    }

    async function inspect(row) {
        const history = await request('GET', `/${encodeURIComponent(row.id)}/history`);
        const details = history.substitution;
        const selected = await formModal(`Підміна #${row.id} · ${labels[details.state]}`, [
            { type: 'note', text: `${details.input.workload}\nПлан: ${money(details.quote.estimateMinor)}\nФакт: ${details.completion ? money(details.completion.amountMinor) : 'ще не підтверджено'}\n`
                + `${details.quote.effects.replacement}\n${details.quote.effects.original}\n`
                + (details.completion?.originalPay ? `Збережена оплата заміненого: ${money(details.completion.originalPay.amountMinor)}.\n` : '')
                + history.events.map(event => `Версія ${event.version} · ${actions[event.action] || event.action} · ${event.actor}: ${event.reason}`).join('\n') },
            ...(details.state === 'active' && (!dar() || canManage()) ? [choice('action', 'Дія', [
                ...(!dar() || canUseAction('manage_payroll_accrual') ? [['complete','Підтвердити виконання']] : []),
                ['revise','Змінити погоджену ставку до початку роботи'],['cancel','Скасувати підміну']])] : [])
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
                    options: base.allocations.map(item => ({value:String(item.index),label:`${item.professionKey}${item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''} · ${item.actualMinutes} хв · ${item.rate} грн/${item.rateUnit}`})) }] : [])] : [])
        ], { okText: 'Підтвердити', type: selected.action === 'cancel' ? 'warning' : 'success' });
        if (!values) return;
        if (base) values.attendanceId = base.attendanceId;
        await saveCommand(`/${row.id}/${selected.action}`, { ...values, workConfirmed: true, expectedVersion: details.version });
        showNotification('Стан підміни оновлено', 'success');
    }

    async function workspace() {
        const title = dar() ? 'Підміни викладачів · Дар' : 'Підміни · графік і облік';
        const range = await formModal(title, [field('from', 'Від', today(), 'date'),field('to', 'До', today(), 'date')], { okText: 'Показати' });
        if (!range) return;
        const rows = await request('GET', `?${new URLSearchParams(range)}`);
        const canCreate = !dar() || canManage();
        const choiceResult = await formModal(title, [
            { type: 'note', text: rows.length ? 'Оберіть підміну, щоб переглянути історію або підтвердити виконання.' : 'За обраний період підмін немає.' },
            ...(rows.length || canCreate ? [choice('selected', 'Підміна', [
                ...(canCreate ? [['new','Створити підміну']] : []),
                ...rows.map(row => [row.id, `${row.input.workDate} · ${row.input.workload} · ${labels[row.state]} · ${money(row.completion?.amountMinor ?? row.quote.estimateMinor)}`])], canCreate ? 'new' : '')] : [])
        ], { okText: 'Відкрити' });
        if (!choiceResult?.selected) return;
        if (choiceResult.selected === 'new') return create();
        return inspect(rows.find(row => row.id === choiceResult.selected));
    }

    async function showDarRates() {
        const { staff } = await request('GET', '/catalog');
        const teacher = await formModal('Стандартні ставки за підміну · Дар', [
            choice('staffId', 'Викладач', staff.map(person => [String(person.id), person.name]))
        ], { okText: 'Показати ставки' });
        if (!teacher) return;
        const rates = await request('GET', `/teacher-rates?${new URLSearchParams(teacher)}`);
        await formModal('Стандартні ставки за підміну · Дар', [{ type:'note', text: rates.length
            ? rates.map(rate => `${rate.effectiveFrom} · ${money(rate.rateMinor)} ${rate.payUnit === 'hour' ? 'за годину' : 'за заняття'} · ${rate.reason}`).join('\n')
            : 'Для цього викладача ще немає стандартної ставки.' }],
        { okText:'Готово', cancelText:'Закрити', className:'dar-substitution-accruals' });
    }

    async function addDarRate() {
        const { staff } = await request('GET', '/catalog');
        const values = await formModal('Стандартна ставка за підміну · Дар', [
            choice('staffId', 'Викладач', staff.map(person => [String(person.id), person.name])),
            choice('payUnit', 'Оплата', [['hour','Погодинна'],['fixed','Фіксована за заняття']]),
            field('effectiveFrom', 'Діє з', today(), 'date'),
            field('rate', 'Ставка, грн'),
            field('reason', 'Підстава для ставки')
        ], { okText: 'Зберегти ставку' });
        if (!values) return;
        await saveCommand('/teacher-rates', values);
        showNotification('Ставку підміни для Дару збережено.', 'success');
    }

    async function accruals() {
        const title = 'Нарахування за підміни · Дар';
        const range = await formModal(title, [field('from','Від',today(),'date'),field('to','До',today(),'date'),
            choice('action','Дія', [['show','Переглянути нарахування'],['rates','Переглянути стандартні ставки'],
                ...(canManage() ? [['rate','Додати стандартну ставку']] : [])], 'show')
        ], { okText: 'Продовжити' });
        if (!range) return;
        if (range.action === 'rate') return addDarRate();
        if (range.action === 'rates') return showDarRates();
        const { rows, totalMinor } = await request('GET', `/accruals?${new URLSearchParams({from:range.from,to:range.to})}`);
        const lines = rows.map(row => `${row.date} · ${row.teacherName} · заняття №${row.lessonId} · ${money(row.amountMinor)}`);
        await formModal(title, [{ type: 'note', text: rows.length ? [`Разом ${money(totalMinor)}`, ...lines].join('\n') : 'За обраний період нарахувань немає.' }],
            { okText:'Готово', cancelText:'Закрити', className:'dar-substitution-accruals' });
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
        const container = host();
        if (!container) return;
        container.hidden = !(typeof canUseAction === 'function' && canUseAction('hr.staff.view') && canUseAction('hr.payroll.view')
            && (!dar() || isDarSchedule()));
        if (dar()) container.querySelector('[data-substitution-action="create"]').hidden = !(!container.hidden && canManage());
        if (container.dataset.ready) return;
        container.dataset.ready = 'true';
        container.addEventListener('click', event => {
            const action = event.target.closest('[data-substitution-action]')?.dataset.substitutionAction;
            if (action === 'create') run(() => create());
            if (action === 'list') run(workspace);
            if (action === 'accruals' && dar()) run(accruals);
        });
    }
    window.StaffSubstitution = { open: prefill => run(() => create(prefill)), workspace: () => run(workspace) };
    window.addEventListener('crm:authenticated-runtime-ready', install);
    window.addEventListener('permissions:lifecycle', install);
    window.addEventListener('timeline:business-context-changed', install);
    window.addEventListener('timeline:display-settings-changed', install);
    window.addEventListener('crmBusinessProfileChanged', install);
    window.addEventListener('popstate', install);
    window.addEventListener('crm:auth-cleared', () => {
        pendingCommand = null;
        const container = host();
        if (container) container.hidden = true;
    });
    install();
}());
