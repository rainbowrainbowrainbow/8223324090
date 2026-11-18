/* Company defaults, qualification history and explicit manual commission bases. */
(function (root) {
    'use strict';
    const ui = root.HrPayRules;
    const modalOptions = { className: 'hr-pay-rule-form', closeOnBackdrop: false };
    const note = (key, text) => ({ key, type: 'note', text });
    const choice = (key, label, entries, defaultValue = '') => ({ key, label, type: 'select', required: true,
        options: entries.map(([value, text]) => ({ value: String(value), label: text })), defaultValue: String(defaultValue) });
    const dateField = (value = todayStr()) => ({ key: 'effectiveFrom', label: 'Діє з', type: 'date', required: true, defaultValue: value });
    const reasonField = { key: 'reason', label: 'Причина / підстава', required: true };
    const money = value => Number(value).toLocaleString('uk-UA') + ' грн';
    const unitLabel = unit => ({ hour: 'годину', day: 'вихід', month: 'місяць' }[unit] || unit);
    async function request(path, settings) {
        const response = await hrFetch(path, settings);
        if (!response?.success) throw new Error(response?.error || 'Не вдалося завантажити умови оплати. Оновіть дані й повторіть.');
        return response.data;
    }
    async function perform(action) {
        try { return await action(); }
        catch (error) { showNotification(error.message || 'Не вдалося виконати дію з оплатою', 'error'); return null; }
    }
    function editable() { return ensureStaffPayrollProfileCanMutate(); }
    function sameEmployee(staffId) {
        if (Number(activeEditStaffId()) !== Number(staffId)) throw new Error('Картку працівника змінено. Повторіть дію в актуальній картці.');
    }
    async function refreshEmployee(staffId) {
        if (Number(activeEditStaffId()) !== Number(staffId)) return;
        await loadStaffPayrollProfiles(staffId, { force: true });
        await loadStaffPayrollProfilePreview(staffId, { force: true });
    }
    function templateFields(template, levels = []) {
        const version = { rateUnit: template?.rateUnit || 'hour', payRules: template?.payRules || null };
        return [
            choice('rateUnit', 'Одиниця оплати', [['hour', 'Погодинна'], ['day', 'Денна'], ['month', 'Місячна']], version.rateUnit),
            { key: 'defaultRate', label: 'Точна ставка, грн', type: 'number', defaultValue: template?.defaultRate ?? '', hint: 'Для діапазону залиште порожнім. При застосуванні працівнику потрібно буде обрати точну суму.' },
            { key: 'salaryFrom', label: 'Діапазон від, грн', type: 'number', defaultValue: template?.salaryFrom ?? '' },
            { key: 'salaryTo', label: 'Діапазон до, грн', type: 'number', defaultValue: template?.salaryTo ?? '' },
            { key: 'weekdayRate', label: 'Ставка Пн–Пт, якщо відрізняється', type: 'number', defaultValue: commonDayRate(template, [1, 2, 3, 4, 5]), hiddenWhen: values => values.rateUnit === 'month' },
            { key: 'weekendRate', label: 'Ставка Сб–Нд, якщо відрізняється', type: 'number', defaultValue: commonDayRate(template, [6, 7]), hiddenWhen: values => values.rateUnit === 'month' },
            { ...choice('levelId', 'Стартовий / потрібний рівень', [['', 'Без привʼязки до рівня'], ...levels.filter(level => level.is_active).map(level => [level.id, level.title])], template?.levelId || ''), required: false },
            ...ui.fields(version, { allowLegacy: false }),
            note('templateTransfer', 'Умови застосовуються працівнику лише після перегляду й підтвердження. Подальші зміни вакансії не змінюють уже призначену ставку.')
        ];
    }
    function commonDayRate(template, days) {
        const rates = days.map(day => template?.dayRates?.find(entry => entry.isoWeekday === day)?.rate ?? template?.defaultRate);
        if (new Set(rates).size === 1) return rates[0] ?? '';
        return '';
    }
    function collectTemplate(values, template) {
        const optional = key => String(values[key] ?? '').trim() ? Number(values[key]) : null;
        const dayRates = [];
        if (values.rateUnit !== 'month') {
            for (const [key, days] of [['weekdayRate', [1, 2, 3, 4, 5]], ['weekendRate', [6, 7]]]) {
                const rate = optional(key);
                if (rate != null) days.forEach(isoWeekday => dayRates.push({ isoWeekday, rate }));
                else if (new Set(days.map(day => template?.dayRates?.find(row => row.isoWeekday === day)?.rate ?? template?.defaultRate)).size > 1) {
                    dayRates.push(...(template?.dayRates || []).filter(row => days.includes(row.isoWeekday)));
                }
            }
        }
        return { schemaVersion: 1, rateUnit: values.rateUnit, defaultRate: optional('defaultRate'),
            salaryFrom: optional('salaryFrom'), salaryTo: optional('salaryTo'), dayRates, levelId: values.levelId ? Number(values.levelId) : null,
            payRules: ui.collect(values, { rateUnit: template?.rateUnit || 'hour', payRules: template?.payRules }, { allowLegacy: false }) };
    }
    function validateTemplate(values, template) {
        const invalid = ui.validate(values, { rateUnit: template?.rateUnit || 'hour', payRules: template?.payRules }, { allowLegacy: false });
        if (invalid) return invalid;
        const keys = ['defaultRate', 'salaryFrom', 'salaryTo'];
        if (keys.every(key => !String(values[key] ?? '').trim())) return { key: 'defaultRate', message: 'Вкажіть ставку або зарплатний діапазон.' };
        for (const key of [...keys, ...(values.rateUnit === 'month' ? [] : ['weekdayRate', 'weekendRate'])]) {
            if (String(values[key] ?? '').trim() && (!(Number(values[key]) > 0) || !Number.isFinite(Number(values[key])))) return { key, message: 'Вкажіть додатну суму або залиште поле порожнім.' };
        }
        if (values.salaryFrom && values.salaryTo && Number(values.salaryFrom) > Number(values.salaryTo)) return { key: 'salaryTo', message: 'Верхня межа має бути не меншою за нижню.' };
        return null;
    }
    function summary(template) {
        if (!template) return 'Умови оплати ще не задано.';
        const rate = template.defaultRate ? money(template.defaultRate) : `${template.salaryFrom ? money(template.salaryFrom) : '—'} … ${template.salaryTo ? money(template.salaryTo) : '—'}`;
        return `${rate} за ${unitLabel(template.rateUnit)}. ${ui.describe(template.payRules)}`;
    }
    async function vacancy(vacancyId) {
        return perform(async () => {
            if (!hrCanUsePayrollAction('manage_payroll_rules')) { showNotification('Немає права змінювати умови оплати', 'warning'); return; }
            const effectiveFrom = todayStr();
            const data = await request(`/vacancies/${Number(vacancyId)}/payroll-template?effectiveFrom=${effectiveFrom}`);
            const levels = await request('/payroll-rules/levels?' + new URLSearchParams({ professionKey: data.professionKey }));
            const result = await formModal(`Оплата вакансії · ${data.vacancy.title}`, [
                note('source', `${data.source.type === 'company_profession_default' ? 'Успадковано типові умови компанії. ' : 'Власні умови вакансії. '}${summary(data.template)}`),
                ...templateFields(data.template, levels), reasonField
            ], { ...modalOptions, okText: 'Зберегти умови вакансії', validate: values => validateTemplate(values, data.template) });
            if (!result) return;
            await request(`/vacancies/${Number(vacancyId)}/payroll-template`, { method: 'PUT', body: {
                template: collectTemplate(result, data.template), expectedTemplateHash: data.templateHash, effectiveFrom, reason: result.reason
            } });
            showNotification('Умови вакансії збережено. Ставки найнятих працівників не змінено.', 'success');
        });
    }
    async function companyDefault(professionKey, current, levels = []) {
        if (!editable()) return;
        const result = await formModal(`Типові умови · ${professionTitle(professionKey) || professionKey}`, [
            note('source', 'Це шаблон для нових вакансій без власних умов. Збереження не змінює ставки чинних працівників.'),
            ...templateFields(current?.template, levels), dateField(), reasonField
        ], { ...modalOptions, okText: 'Створити версію типових умов', validate: values => validateTemplate(values, current?.template) });
        if (!result) return;
        await request('/payroll-rules/defaults', { method: 'POST', body: { professionKey, effectiveFrom: result.effectiveFrom,
            template: collectTemplate(result, current?.template), reason: result.reason } });
        showNotification('Типові умови професії збережено', 'success');
    }
    async function addLevel(professionKey, levels) {
        if (!editable()) return;
        const profiles = staffPayrollProfileState.profiles.filter(profile => profile.status === 'active'
            && (profile.profileKind || profile.profile_kind) === 'shared' && staffPayrollProfileProfessionKey(profile) === professionKey);
        if (!profiles.length) { showNotification('Спочатку створіть спільні варіанти оплати цієї професії в розділі зарплатних профілів.', 'warning'); return; }
        const result = await formModal('Додати рівень професії', [
            { key: 'title', label: 'Назва рівня', required: true, placeholder: 'Наприклад: Здав меню' },
            { key: 'rank', label: 'Порядок рівня', type: 'number', required: true, defaultValue: Math.max(-1, ...levels.map(level => Number(level.rank))) + 1 },
            choice('profileId', 'Варіант оплати рівня', profiles.map(profile => [profile.id, profile.title]), profiles[0].id),
            note('levelHint', 'Рівень кваліфікації визначає оплату. Він не змінює права доступу до CRM.')
        ], { ...modalOptions, okText: 'Створити рівень', validate: values => !Number.isInteger(Number(values.rank)) || Number(values.rank) < 0 ? { key: 'rank', message: 'Порядок має бути невідʼємним цілим числом.' } : null });
        if (!result) return;
        await request('/payroll-rules/levels', { method: 'POST', body: { professionKey, title: result.title, rank: Number(result.rank),
            profileId: Number(result.profileId), levelKey: 'level_' + root.crypto.randomUUID().replaceAll('-', '') } });
        showNotification('Рівень створено', 'success');
    }
    async function changeLevel(staffId, professionKey, data) {
        if (!editable()) return;
        const available = data.levels.filter(level => level.is_active);
        if (!available.length) { showNotification('Спочатку додайте рівні цієї професії.', 'warning'); return; }
        const current = staffPayrollEffectiveProfileForProfession(professionKey);
        const result = await formModal('Зміна рівня працівника', [
            note('current', `Поточний рівень: ${data.currentLevel?.snapshot?.level?.title || 'не задано'}. Поточний варіант оплати: ${current.profile?.title || 'резервна ставка'}${current.version ? ` · ${money(staffPayrollProfileRateOnDate(current.version, data.asOfDate))} за ${unitLabel(current.version.rateUnit)}` : ''}.`),
            choice('levelId', 'Новий рівень', available.map(level => [level.id, level.title]), available[0].id),
            { key: 'nextPay', type: 'dynamicNote', render: values => {
                const level = available.find(item => Number(item.id) === Number(values.levelId));
                const profile = staffPayrollProfileState.profiles.find(item => Number(item.id) === Number(level?.profile_id));
                const version = profile && payrollProfileCurrentVersion(profile, values.effectiveFrom || todayStr());
                const existing = staffPayrollEffectiveProfileForProfession(professionKey, values.effectiveFrom || todayStr());
                const keep = existing.assignment && values.payDecision === 'keep_personal';
                return `${keep ? 'Персональна оплата залишиться чинною; зміниться тільки рівень. Умови оплати рівня' : 'Нові умови'} з ${values.effectiveFrom || todayStr()}: ${profile?.title || 'профіль недоступний'}${version ? ` · ${money(staffPayrollProfileRateOnDate(version, values.effectiveFrom || todayStr()))} за ${unitLabel(version.rateUnit)}` : ' · немає чинної ставки на дату'}.`;
            } },
            dateField(),
            choice('payDecision', 'Що робити з персональними умовами', [['keep_personal', 'Зберегти їх; змінити тільки рівень'], ['use_level', 'Застосувати оплату нового рівня']], 'keep_personal'), reasonField,
            note('history', 'Попередній рівень і ставка залишаються в історії. Підвищення застосовується з обраної дати; зафіксований табель не переписується.')
        ], { ...modalOptions, okText: 'Підтвердити зміну рівня' });
        if (!result) return;
        sameEmployee(staffId);
        await request(`/staff/${staffId}/payroll-rules/qualification`, { method: 'POST', body: { professionKey,
            levelId: Number(result.levelId), effectiveFrom: result.effectiveFrom, expectedEventId: data.history[0]?.id || 0,
            payDecision: result.payDecision, reason: result.reason } });
        showNotification('Зміну рівня збережено', 'success');
        await refreshEmployee(staffId);
    }
    async function componentBase(staffId, key, data) {
        if (!editable()) return;
        const label = { own_bookings: 'Власні оформлення', other_bookings: 'Оформлення інших менеджерів', manual: 'Інша ручна база' }[key];
        const period = await formModal(`Період бази · ${label}`, [{ key: 'month', label: 'Місяць', type: 'month', required: true, defaultValue: data.asOfDate.slice(0, 7) }], { ...modalOptions, okText: 'Відкрити базу' });
        if (!period) return;
        const workspace = await request(`/staff/${staffId}/payroll-rules?` + new URLSearchParams({ professionKey: data.professionKey, asOfDate: period.month + '-01' }));
        const existing = workspace.componentInputs[key];
        const result = await formModal(`Ручна база · ${label} · ${period.month}`, [
            note('manual', 'Вкажіть погоджену грошову базу для відсотка. Це ручні дані, а не автоматично зібрані банкети. Порожнє поле не дорівнює нулю.'),
            { key: 'amount', label: 'Погоджена база, грн', type: 'number', required: true, defaultValue: existing?.amount ?? '' },
            choice('confirmed', 'Підтвердження', [['no', 'Чернетка, ще не підтверджено'], ['yes', 'Базу перевірено, включно з нульовою']], existing?.confirmed ? 'yes' : 'no'),
            { ...reasonField, defaultValue: existing?.reason || '' },
            ...(existing ? [note('author', `Попередня версія: ${existing.version}. Автор: ${existing.author}.`)] : [])
        ], { ...modalOptions, okText: 'Зберегти базу', validate: values => !String(values.amount ?? '').trim() || !Number.isFinite(Number(values.amount)) || Number(values.amount) < 0 ? { key: 'amount', message: 'Вкажіть невідʼємну суму. Підтверджений нуль дозволено.' } : null });
        if (!result) return;
        sameEmployee(staffId);
        await request(`/staff/${staffId}/payroll-rules/component-input`, { method: 'PUT', body: { month: period.month,
            basisKey: key, amount: Number(result.amount), confirmed: result.confirmed === 'yes', expectedVersion: existing?.version || 0, reason: result.reason } });
        showNotification('Ручну базу збережено', 'success');
        await refreshEmployee(staffId);
    }
    async function applyVacancy(staffId, professionKey) {
        if (!editable()) return;
        const response = await hrFetch('/vacancies?status=open');
        if (!response?.success) throw new Error(response?.error || 'Не вдалося завантажити вакансії');
        const vacancies = response.vacancies.filter(v => normalizeProfessionKey(v.role_type) === professionKey);
        if (!vacancies.length) { showNotification('Немає відкритих вакансій цієї професії.', 'warning'); return; }
        const selected = await formModal('Вибір умов вакансії', [choice('vacancyId', 'Вакансія', vacancies.map(v => [v.id, v.title]), vacancies[0].id), dateField()], { ...modalOptions, okText: 'Переглянути умови' });
        if (!selected) return;
        const preview = await request(`/vacancies/${selected.vacancyId}/payroll-template?effectiveFrom=${selected.effectiveFrom}`);
        if (!preview.template) throw new Error('Для цієї вакансії не налаштовано оплату');
        const result = await formModal('Застосування оплати вакансії', [
            note('preview', summary(preview.template)),
            { key: 'selectedRate', label: 'Точна ставка працівника, грн', type: 'number', required: true, defaultValue: preview.template.defaultRate ?? '' },
            choice('payDecision', 'Поточні персональні умови', [['cancel', 'Залишити чинні умови'], ['replace', 'Замінити новими з обраної дати']], 'cancel'), reasonField,
            note('snapshot', 'У працівника буде власна копія умов вакансії. Уже зафіксовані дати не змінюються.')
        ], { ...modalOptions, okText: 'Застосувати умови', validate: values => !(Number(values.selectedRate) > 0) ? { key: 'selectedRate', message: 'Вкажіть додатну точну ставку.' } : null });
        if (!result || result.payDecision !== 'replace') return;
        sameEmployee(staffId);
        await request(`/staff/${staffId}/payroll-rules/vacancy`, { method: 'POST', body: { vacancyId: Number(selected.vacancyId),
            effectiveFrom: selected.effectiveFrom, expectedTemplateHash: preview.templateHash, selectedRate: Number(result.selectedRate),
            payDecision: 'replace', reason: result.reason } });
        showNotification('Умови вакансії застосовано працівнику', 'success');
        await refreshEmployee(staffId);
    }
    async function employee(professionKey) {
        return perform(async () => {
            const staffId = Number(activeEditStaffId()), asOfDate = staffPayrollConditionsDate();
            const data = await request(`/staff/${staffId}/payroll-rules?` + new URLSearchParams({ professionKey, asOfDate }));
            if (Number(activeEditStaffId()) !== staffId) return;
            const history = data.history.map(entry => `${entry.effective_from} · ${entry.snapshot?.level?.title || 'Рівень'} · ${entry.created_by} · ${entry.reason}`);
            const current = data.currentLevel?.snapshot?.level?.title || 'не задано';
            const canEdit = hrCanUsePayrollAction('manage_payroll_rules');
            const actions = [['close', 'Закрити'], ...(canEdit ? [['change', 'Обрати / змінити рівень'], ['add_level', 'Додати рівень професії'],
                ['own_bookings', 'База відсотка: власні оформлення'], ['other_bookings', 'База відсотка: інші менеджери'], ['manual', 'Інша ручна база відсотка'],
                ['vacancy', 'Застосувати умови вакансії'], ['default', 'Типові умови компанії для професії']] : [])];
            const result = await formModal(`Рівень і відсотки · ${professionTitle(professionKey) || professionKey}`, [
                note('currentLevel', `Поточний рівень на ${asOfDate}: ${current}.`),
                note('default', `Типовий шаблон: ${summary(data.defaultTemplate?.template)}`),
                note('history', `Історія рівнів:\n${history.length ? history.join('\n') : 'Змін рівня ще немає.'}`),
                choice('action', 'Дія', actions, 'close')
            ], { ...modalOptions, okText: 'Продовжити' });
            if (!result || result.action === 'close') return;
            if (result.action === 'change') return changeLevel(staffId, professionKey, data);
            if (result.action === 'add_level') return addLevel(professionKey, data.levels);
            if (result.action === 'default') return companyDefault(professionKey, data.defaultTemplate, data.levels);
            if (result.action === 'vacancy') return applyVacancy(staffId, professionKey);
            return componentBase(staffId, result.action, data);
        });
    }
    async function defaultsPicker() {
        return perform(async () => {
            if (!hrCanUsePayrollAction('manage_payroll_rules')) return;
            await ensureProfessionsLoaded({ silent: true });
            const professions = payrollProfileProfessionOptions();
            if (!professions.length) { showNotification('Спочатку додайте професію.', 'warning'); return; }
            const selected = await formModal('Типові умови компанії', [choice('professionKey', 'Професія', professions.map(p => [p.key, p.label]), professions[0].key)], { ...modalOptions, okText: 'Налаштувати' });
            if (!selected) return;
            const [defaults, levels] = await Promise.all([
                request('/payroll-rules/defaults?' + new URLSearchParams({ asOfDate: todayStr() })),
                request('/payroll-rules/levels?' + new URLSearchParams({ professionKey: selected.professionKey }))
            ]);
            return companyDefault(selected.professionKey, defaults.find(entry => entry.profession_key === selected.professionKey), levels);
        });
    }
    async function profileRules(profileId) {
        return perform(async () => {
            if (!hrCanUsePayrollAction('manage_payroll_rules')) return;
            const profile = payrollProfileById(profileId);
            if (!profile || profile.status === 'archived') throw new Error('Активний профіль не знайдено');
            const version = payrollProfileLatestVersion(profile) || { rateUnit: 'hour' };
            const result = await formModal(`Правила розрахунку · ${profile.title}`, [
                note('scope', 'Нова версія спільного профілю змінить умови всіх, хто його успадковує. Історичні нарахування залишаться незмінними.'),
                choice('rateUnit', 'Одиниця', [['hour', 'Погодинна'], ['day', 'Денна'], ['month', 'Місячна']], version.rateUnit),
                { key: 'defaultRate', label: 'Базова ставка', type: 'number', required: true, defaultValue: version.defaultRate || '' },
                ...ui.fields(version), dateField(payrollProfileNextEffectiveDate(profile)), reasonField
            ], { ...modalOptions, okText: 'Створити версію правил', validate: values => !(Number(values.defaultRate) > 0) ? { key: 'defaultRate', message: 'Вкажіть додатну ставку.' } : ui.validate(values, version) });
            if (!result) return;
            await request(`/payroll-profiles/${profile.id}/versions`, { method: 'POST', body: {
                rateUnit: result.rateUnit, defaultRate: Number(result.defaultRate), payRules: ui.collect(result, version),
                dayRates: result.rateUnit === 'month' ? [] : version.dayRates || [], effectiveFrom: result.effectiveFrom, changeReason: result.reason
            } });
            showNotification('Нову версію правил створено', 'success');
            await loadPayrollProfilesCatalog({ selectId: profile.id });
        });
    }
    root.HrCompensationUi = { employee, vacancy, companyDefault, defaultsPicker, profileRules, templateFields, collectTemplate, validateTemplate, summary };
    // Vacancy action groups stop bubbling to their clickable card. Capture only
    // this owned button so its action reaches the controller without opening it.
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-vacancy-pay-rules]');
        if (!button || button.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        void vacancy(button.dataset.vacancyPayRules);
    }, { capture: true });
    document.addEventListener('click', event => {
        const profile = event.target.closest('[data-pay-rules-profile]');
        if (profile && !profile.disabled) { event.preventDefault(); void profileRules(profile.dataset.payRulesProfile); }
        if (event.target.closest('[data-pay-rules-defaults]')) { event.preventDefault(); void defaultsPicker(); }
    });
})(window);
