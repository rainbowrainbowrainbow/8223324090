/* Shared field model for the existing HR formModal workflow. */
(function (root) {
    'use strict';
    const options = entries => entries.map(([value, label]) => ({ value, label }));
    const select = (key, label, entries, defaultValue, hiddenWhen) => ({ key, label, type: 'select', options: options(entries), defaultValue, hiddenWhen });
    const unit = (values, version) => values.rateUnit || version.rateUnit || version.rate_unit || 'hour';
    const previousRules = version => version.payRules || version.pay_rules || null;
    function monthlyFields(prefix, policy, visible) {
        return [
            select(prefix + 'Mode', 'Як рахувати місячну суму', [
                ['fixed', 'Фіксована сума, незалежно від виходів'],
                ['norm_minutes', 'Пропорційно оплачуваному часу'],
                ['norm_days', 'Пропорційно оплачуваним дням']
            ], policy?.mode || 'fixed', values => !visible(values)),
            select(prefix + 'Partial', 'Неповний місяць дії умов', [['review', 'Потрібне окреме погодження'], ['calendar_days', 'За календарною часткою місяця']],
                policy?.partialMonth || 'review', values => !visible(values)),
            { key: prefix + 'NormMonth', label: 'Місяць норми', type: 'month', defaultValue: policy?.norm?.month || '', hiddenWhen: values => !visible(values) || values[prefix + 'Mode'] === 'fixed' },
            { key: prefix + 'NormHours', label: 'Повна місячна норма, годин', type: 'number', defaultValue: policy?.mode === 'norm_minutes' ? policy.norm.value / 60 : '', hiddenWhen: values => !visible(values) || values[prefix + 'Mode'] !== 'norm_minutes' },
            { key: prefix + 'NormDays', label: 'Повна місячна норма, днів', type: 'number', defaultValue: policy?.mode === 'norm_days' ? policy.norm.value : '', hiddenWhen: values => !visible(values) || values[prefix + 'Mode'] !== 'norm_days' },
            { key: prefix + 'NormSource', label: 'Звідки взято погоджену норму', defaultValue: policy?.norm?.source || '', hiddenWhen: values => !visible(values) || values[prefix + 'Mode'] === 'fixed' },
            select(prefix + 'NormConfirmed', 'Норма перевірена', [['no', 'Ще потребує перевірки'], ['yes', 'Так, підтверджена']], policy?.norm?.confirmed ? 'yes' : 'no', values => !visible(values) || values[prefix + 'Mode'] === 'fixed')
        ];
    }
    function fields(version = {}, { includeComponents = true, allowLegacy = true } = {}) {
        version ||= {};
        const rules = previousRules(version);
        const isNew = values => !allowLegacy || values.payRuleSelection === 'configured';
        const result = [
            { key: 'payRuleExplanation', type: 'note', text: 'Для фіксованого окладу повна місячна сума не залежить від кількості виходів. Для пропорційної оплати потрібні норма й оплачуваний час або дні. Неповний місяць прийняття чи зміни умов налаштовується окремо.' },
            ...(allowLegacy ? [select('payRuleSelection', 'Правила розрахунку', [['legacy', 'Зберегти попередній спосіб'], ['configured', 'Налаштувати спосіб і компоненти']], rules ? 'configured' : 'legacy')] : []),
            ...monthlyFields('payMonth', rules?.monthly, values => isNew(values) && unit(values, version) === 'month'),
            select('payDayMode', 'Неповна денна зміна', [['per_exit', 'Повна ставка за вихід'], ['proportional', 'Зменшувати пропорційно часу']], rules?.daily?.mode || 'per_exit', values => !isNew(values) || unit(values, version) !== 'day'),
            { key: 'payDayHours', label: 'Оплачувана тривалість повного дня, годин', type: 'number', defaultValue: rules?.daily?.fullDayMinutes ? rules.daily.fullDayMinutes / 60 : '',
                hint: 'Тривалість після неоплачуваних перерв. Наприклад: 9, 10 або 11 годин.', hiddenWhen: values => !isNew(values) || unit(values, version) !== 'day' || values.payDayMode !== 'proportional' },
            select('payDayBasis', 'Який час оплачувати', [['actual', 'Фактичний час після перерв'], ['paid_planned', 'Оплачуваний плановий час']], rules?.daily?.timeBasis || 'actual', values => !isNew(values) || unit(values, version) !== 'day' || values.payDayMode !== 'proportional'),
            select('payDayOvertime', 'Робота довше повного дня', [['cap', 'Денна база обмежена однією ставкою'], ['hourly_150', 'Окрема доплата 150% за час понад норму']], rules?.daily?.overtime || 'cap', values => !isNew(values) || unit(values, version) !== 'day' || values.payDayMode !== 'proportional'),
            { key: 'payRuleNote', label: 'Примітка до оплати', defaultValue: rules?.note || '', hint: 'Наприклад: чайові не входять до ставки й нарахування в CRM.', hiddenWhen: values => !isNew(values) }
        ];
        if (includeComponents) {
            const components = rules?.components || [];
            const slots = [...components, ...Array(Math.min(3, 12 - components.length)).fill(null)];
            slots.forEach((component, index) => {
                const prefix = 'payComponent' + index;
                const visible = values => isNew(values) && values[prefix + 'Kind'] !== 'off';
                result.push(
                    select(prefix + 'Kind', component ? `Компонент ${index + 1}: спосіб оплати` : `Додати компонент оплати ${index + 1}`,
                        [['off', component ? 'Прибрати з нової версії' : 'Не додавати'], ['monthly', 'Постійна місячна доплата'], ['percent', 'Відсоток від ручної бази']], component?.kind || 'off', values => !isNew(values)),
                    { key: prefix + 'Title', label: `Назва компонента ${index + 1}`, defaultValue: component?.title || '', hiddenWhen: values => !visible(values) },
                    { key: prefix + 'Amount', label: 'Місячна доплата, грн', type: 'number', defaultValue: component?.amount ?? '', hiddenWhen: values => !visible(values) || values[prefix + 'Kind'] !== 'monthly' },
                    ...monthlyFields(prefix + 'Month', component?.monthly, values => visible(values) && values[prefix + 'Kind'] === 'monthly'),
                    { key: prefix + 'Percent', label: 'Відсоток, %', type: 'number', defaultValue: component?.percent ?? '', hiddenWhen: values => !visible(values) || values[prefix + 'Kind'] !== 'percent' },
                    select(prefix + 'Basis', 'База відсотка', [['own_bookings', 'Власні оформлення'], ['other_bookings', 'Оформлення інших менеджерів'], ['manual', 'Інша погоджена ручна база']], component?.basisKey || 'own_bookings', values => !visible(values) || values[prefix + 'Kind'] !== 'percent')
                );
            });
        }
        // Store no IDs in editable labels. The server remains the validation authority.
        return result;
    }
    function invalid(key, message) { throw Object.assign(new Error(message), { key }); }
    function positive(values, key, max = Number.MAX_SAFE_INTEGER) {
        const value = Number(values[key]);
        if (!Number.isFinite(value) || value <= 0 || value > max) invalid(key, 'Вкажіть додатне значення в допустимих межах.');
        return value;
    }
    function collectMonthly(values, prefix) {
        const mode = values[prefix + 'Mode'] || 'fixed';
        const result = { mode, partialMonth: values[prefix + 'Partial'] || 'review' };
        if (mode !== 'fixed') {
            const key = prefix + (mode === 'norm_minutes' ? 'NormHours' : 'NormDays');
            const value = positive(values, key, mode === 'norm_minutes' ? 744 : 31);
            const month = values[prefix + 'NormMonth'];
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) invalid(prefix + 'NormMonth', 'Вкажіть місяць норми.');
            const source = String(values[prefix + 'NormSource'] || '').trim();
            if (!source) invalid(prefix + 'NormSource', 'Вкажіть джерело погодженої норми.');
            result.norm = { month, value: mode === 'norm_minutes' ? Math.round(value * 60) : value,
                source, confirmed: values[prefix + 'NormConfirmed'] === 'yes' };
        }
        return result;
    }
    function collect(values, version = {}, { includeComponents = true, allowLegacy = true } = {}) {
        version ||= {};
        if (allowLegacy && values.payRuleSelection !== 'configured') {
            // An existing configured version cannot lose rules merely because an
            // older caller omitted the new fields.
            return values.payRuleSelection === 'legacy' ? null : previousRules(version);
        }
        const selectedUnit = unit(values, version), result = { schemaVersion: 1, components: [], note: String(values.payRuleNote || '').trim() };
        if (selectedUnit === 'month') result.monthly = collectMonthly(values, 'payMonth');
        if (selectedUnit === 'day') {
            result.daily = { mode: values.payDayMode || 'per_exit' };
            if (result.daily.mode === 'proportional') {
                result.daily.fullDayMinutes = Math.round(positive(values, 'payDayHours', 24) * 60);
                result.daily.timeBasis = values.payDayBasis || 'actual';
                result.daily.overtime = values.payDayOvertime || 'cap';
            }
        }
        if (!includeComponents) result.components = structuredClone(previousRules(version)?.components || []);
        else {
            const prior = previousRules(version)?.components || [];
            const slots = [...prior, ...Array(Math.min(3, 12 - prior.length)).fill(null)];
            slots.forEach((component, index) => {
                const prefix = 'payComponent' + index, kind = values[prefix + 'Kind'] || (component?.kind ?? 'off');
                if (kind === 'off') return;
                const title = String(values[prefix + 'Title'] || '').trim();
                if (!title) invalid(prefix + 'Title', 'Вкажіть назву компонента.');
                const id = component?.id || 'component_' + root.crypto.randomUUID().replaceAll('-', '');
                if (kind === 'monthly') result.components.push({ id, title, kind,
                    amount: positive(values, prefix + 'Amount'), monthly: collectMonthly(values, prefix + 'Month') });
                else result.components.push({ id, title, kind: 'percent', percent: positive(values, prefix + 'Percent', 100),
                    basisKey: values[prefix + 'Basis'] || 'own_bookings', source: 'manual_confirmed' });
            });
        }
        return result;
    }
    function validate(values, version, settings) {
        try { collect(values, version, settings); return null; }
        catch (error) { return { key: error.key || 'payRuleSelection', message: error.message }; }
    }
    function describe(rules) {
        if (!rules) return 'Попередні правила розрахунку';
        const base = rules.monthly ? ({ fixed: 'Фіксований місячний оклад', norm_minutes: 'Місячна ставка пропорційно часу', norm_days: 'Місячна ставка пропорційно дням' }[rules.monthly.mode])
            : rules.daily ? (rules.daily.mode === 'proportional' ? `Денна ставка пропорційно часу; повний день ${rules.daily.fullDayMinutes / 60} год` : 'Повна ставка за вихід') : 'Погодинна оплата';
        return base + (rules.components?.length ? ` · додаткових компонентів: ${rules.components.length}` : '');
    }
    root.HrPayRules = { fields, collect, validate, describe };
})(typeof window === 'undefined' ? globalThis : window);
