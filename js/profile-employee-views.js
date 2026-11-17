export function createEmployeeRenderers({ escapeHtml, profileEmployeeDateText, profileEmployeeTime, profileEmployeeMoney,
    profileEmployeeNumber, profileProfessionByKey, profileRoleLabel }) {
    function renderProfileEmployeeDetails(title, rows, empty = 'Даних за цей період немає.', collapsed = false) {
        const body = rows.length
            ? `<ul>${rows.map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`).join('')}</ul>`
            : `<p>${escapeHtml(empty)}</p>`;
        return collapsed
            ? `<details class="profile-employee-details park-employee-disclosure"><summary>${title}</summary>${body}</details>`
            : `<section class="profile-employee-details"><h3>${title}</h3>${body}</section>`;
    }

    function renderSalary(data) {
        const disclosure = (title, rows, empty) => renderProfileEmployeeDetails(title, rows, empty, true);
        const reportStatus = { preview: 'Попередній розрахунок', draft: 'Збережена чернетка', reviewed: 'Перевірено',
            approved: 'Затверджено', paid: 'Закрито в обліку', voided: 'Скасовано', reversed: 'Сторновано' };
        const status = reportStatus[data.status];
        const periodStatus = data.locked ? 'Період закрито.' : '';
        const summary = [
            [data.status === 'preview' ? 'Попередньо нараховано' : 'Нараховано', data.gross],
            ['Утримано', data.deductions],
            ['Виплачено', data.paid],
            ['Залишок до виплати', data.balance, 'profile-pay-balance']
        ].filter(([, value]) => data.state !== 'empty' || value != null);
        const adjustmentStatus = { applied: 'Враховано', pending: 'Очікує погодження', pending_review: 'Очікує погодження',
            rejected: 'Відхилено', voided: 'Скасовано' };
        const types = { bonus: 'Премія', kpi_bonus: 'Бонус за показниками', tip: 'Чайові', deduction: 'Утримання',
            penalty: 'Штраф', advance: 'Аванс', zrs: 'ЗРС' };
        const units = { hour: 'год', day: 'зміну', shift: 'зміну', month: 'місяць', piece: 'роботу' };
        const installments = { advance: 'Аванс', final: 'Остаточна виплата' };
        const paymentStatus = { draft: 'Чернетка', approved: 'Затверджено', paid: 'Виплачено',
            partially_paid: 'Частково виплачено', cancelled: 'Скасовано' };
        const detail = data.detail || {};
        const work = [['Відпрацьовані дні', detail.shifts], ['Фізичні години', detail.physicalHours],
            ['Години основних професій', detail.baseRoleHours], ['Години додаткових професій', detail.additionalRoleHours]];
        const rates = (detail.rates || []).map(rate => {
            const profession = profileProfessionByKey(rate.profession)?.title || profileRoleLabel(rate.profession || '');
            const day = rate.date ? ` · ${profileEmployeeDateText(rate.date)}` : '';
            const unit = units[rate.unit] ? ` за ${units[rate.unit]}` : '';
            const workTime = rate.minutes > 0 ? ` · ${profileEmployeeNumber(rate.minutes / 60)} год`
                : rate.days > 0 ? ` · змін: ${rate.days}` : '';
            const period = rate.effectiveFrom || rate.effectiveTo
                ? ` · дія: ${profileEmployeeDateText(rate.effectiveFrom)} — ${profileEmployeeDateText(rate.effectiveTo)}` : '';
            return [`${profession}${rate.kind === 'additional' ? ' · додаткова оплата' : ''}${day}${workTime}${period}`,
                `${profileEmployeeMoney(rate.rate)}${unit} · ${profileEmployeeMoney(rate.amount)}`];
        });
        const lines = (detail.lines || []).map(line => {
            const quantity = line.kind === 'piece' && line.quantity != null
                ? ` · ${profileEmployeeNumber(line.quantity)} од.` : '';
            const rate = line.kind === 'piece' && line.rate != null
                ? ` · ${profileEmployeeMoney(line.rate)} за роботу` : '';
            return [`${line.label || 'Складова розрахунку'}${quantity}${rate}`, profileEmployeeMoney(line.amount)];
        });
        const adjustments = (data.adjustments || []).map(row => [
            [profileEmployeeDateText(row.date), types[row.type] || 'Коригування', row.reason, adjustmentStatus[row.status] || 'Статус не визначено'].filter(Boolean).join(' · '),
            profileEmployeeMoney(row.amount)
        ]);
        const late = (data.late || []).map(row => [
            `${profileEmployeeDateText(row.date)} · план ${row.planned?.slice(0, 5) || '—'} · факт ${profileEmployeeDateText(row.actual, profileEmployeeTime)}`,
            [`${row.minutes} хв`, ...(row.adjustments || []).map(item =>
                `утримання: ${profileEmployeeMoney(item.amount)} (${adjustmentStatus[item.status] || 'статус не визначено'})`)].join(' · ')
        ]);
        const payments = (data.installments || []).flatMap(item => [
            [[installments[item.kind] || 'Виплата', paymentStatus[item.status] || '', item.scheduled ? profileEmployeeDateText(item.scheduled) : ''].filter(Boolean).join(' · '),
                item.approved == null ? `Попередньо: ${profileEmployeeMoney(item.calculated)}` : profileEmployeeMoney(item.approved)],
            ...item.movements.map(movement => [
                `${movement.kind === 'reversal' ? 'Сторно' : 'Фактична виплата'} · ${profileEmployeeDateText(movement.date)}`,
                profileEmployeeMoney(movement.amount)
            ])
        ]);
        return `
            ${data.state === 'empty'
                ? `<p class="profile-month-message" role="status">За цей місяць немає збереженого розрахунку.${periodStatus ? ` ${periodStatus}` : ''}</p>`
                : `<p class="profile-pay-status" role="status">${escapeHtml(status || 'Розрахунок')}
                    ${periodStatus ? ` · ${periodStatus}` : ''}
                    ${data.updatedAt ? ` · станом на ${profileEmployeeDateText(data.updatedAt)}` : ''}</p>`}
            ${summary.length ? `<dl class="profile-employee-summary profile-pay-summary">
                ${summary.map(([label, value, cssClass]) =>
                    `<div${cssClass ? ` class="${cssClass}"` : ''}><dt>${label}</dt><dd>${profileEmployeeMoney(value)}</dd></div>`).join('')}
            </dl>` : ''}
            ${data.legacyAccounted ? '<p>Старий звіт закрито в обліку. Підтверджених дат і сум виплат у цьому джерелі немає.</p>' : ''}
            ${detail.hasBlockingIssues ? '<p>Розрахунок містить позиції, які потребують звірки.</p>' : ''}
            ${disclosure('Розрахунок', [
                ...work.filter(([, value]) => value != null).map(([label, value]) => [label, profileEmployeeNumber(value)]),
                ...lines,
                ...(data.net != null ? [['Після утримань і врахованих авансів', profileEmployeeMoney(data.net)]] : [])
            ])}
            ${detail.effectiveFrom || detail.effectiveTo ? `<p>Період дії схеми: ${profileEmployeeDateText(detail.effectiveFrom)} — ${profileEmployeeDateText(detail.effectiveTo)}</p>` : ''}
            ${disclosure('Ставки за професіями', rates, 'За цей місяць немає підтверджених даних про застосовані ставки.')}
            ${disclosure('Премії та утримання за записами HR', adjustments)}
            ${disclosure('Запізнення', late, 'Запізнень за журналом присутності не знайдено.')}
            ${late.length ? '<p>Зв’язок показано для записів HR із датою порушення та правилом про запізнення.</p>' : ''}
            ${disclosure('Аванси й виплати', payments, 'Підтверджених записів про виплати немає.')}
        `;
    }

    function renderDailyTaskResults({ days, overdue }) {
        const height = Math.max(1, ...days.map(day => day.work + day.personal));
        const summary = (label, day) => `<div>
            <dt>${label}</dt><dd><strong>${day.work + day.personal}</strong>
                <span>Робочі ${day.work} · Особисті ${day.personal}</span>
            </dd>
        </div>`;
        const calendarDay = new Intl.DateTimeFormat('uk-UA', {
            timeZone: 'Europe/Kyiv', day: 'numeric', month: 'numeric'
        });
        return `
            <dl class="profile-results-highlights">
                ${summary('Сьогодні', days.at(-1))}
                ${summary('Вчора', days.at(-2))}
                <div><dt>Прострочені</dt><dd><strong>${overdue}</strong><span>Відкриті задачі</span></dd></div>
            </dl>
            <figure class="profile-results-chart">
                <figcaption>Виконано за останні 7 днів</figcaption>
                <ul class="profile-results-chart-legend">
                    <li class="profile-results-work">Робочі</li>
                    <li class="profile-results-personal">Особисті</li>
                </ul>
                <ol class="profile-results-chart-days">
                    ${days.map(day => `
                        <li>
                            <div class="profile-results-chart-track" aria-hidden="true">
                                <span class="profile-results-personal" style="--share: ${day.personal / height}"></span>
                                <span class="profile-results-work" style="--share: ${day.work / height}"></span>
                            </div>
                            <time datetime="${escapeHtml(day.date)}">${calendarDay.format(new Date(day.date + 'T12:00:00Z'))}</time>
                            <span class="profile-results-chart-values">
                                <span><span class="sr-only">Робочі </span>${day.work}</span>
                                <span><span class="sr-only">Особисті </span>${day.personal}</span>
                            </span>
                        </li>`).join('')}
                </ol>
            </figure>`;
    }

    function renderResults(data) {
        const current = data.current;
        const previous = data.previous;
        const dateLabel = period => period.from && period.through
            ? `${profileEmployeeDateText(period.from)} – ${profileEmployeeDateText(period.through)}`
            : period.month;
        const punctuality = period => period.attendance.measuredArrivals
            ? `${period.attendance.onTime} із ${period.attendance.measuredArrivals}`
            : 'Немає даних';
        const groups = [
            ['Вчасні приходи (із записів з відомим планом і фактом)', punctuality],
            ['Зафіксовані приходи', period => period.attendance.present],
            ['Зафіксовані відсутності', period => period.attendance.absent],
            ['Запізнення', period => period.attendance.late],
            ['Хвилини запізнення', period => period.attendance.lateMinutes],
            ['Завершені пункти професійних чеклістів', period => period.checklistCompleted],
            ['Завершені курси', period => period.coursesCompleted.length]
        ];
        const courses = current.coursesCompleted.map(course => [course.title, profileEmployeeDateText(course.date)]);
        const admission = { approved: 'Допущено', pending: 'Очікує допуску', blocked: 'Допуск заблоковано', restricted: 'Обмежений допуск' };
        const assignments = (data.currentAssignments || []).filter(item => admission[item.admissionStatus]).map(item => [
            profileProfessionByKey(item.key)?.title || profileRoleLabel(item.key), admission[item.admissionStatus]
        ]);
        const substitutionStates = { active: 'Погоджено', completed: 'Завершено', cancelled: 'Скасовано' };
        const professionLabel = key => profileProfessionByKey(key)?.title || profileRoleLabel(key);
        const substitutions = (data.substitutions || []).map(item => {
            const role = item.role === 'original'
                ? (item.partial ? 'Частину зміни передано' : 'Роботу передано')
                : (item.partial ? 'Часткова підміна' : 'Підміна');
            const profession = item.professionKey ? professionLabel(item.professionKey) : '';
            const simultaneous = (item.simultaneousProfessionKeys || []).map(professionLabel).filter(Boolean);
            const label = [profileEmployeeDateText(item.date), `${role} №${item.id}`, profession,
                simultaneous.length && `суміщення — ${simultaneous.join(', ')}`].filter(Boolean).join(' · ');
            return [label, substitutionStates[item.state]];
        });
        return `
            ${data.dailyTasks?.days?.length >= 2 ? renderDailyTaskResults(data.dailyTasks) : ''}
            <details class="profile-employee-comparison">
                <summary>Відвідуваність і професійний розвиток</summary>
                <table>
                    <caption>Порівняння з попереднім місяцем</caption>
                    <thead><tr><th scope="col">Показник</th><th scope="col">${escapeHtml(dateLabel(current))}</th><th scope="col">${escapeHtml(dateLabel(previous))}</th></tr></thead>
                    <tbody>${groups.map(([label, read], index) => {
                        const value = period => index > 0 && index < 5 && !period.attendance.daysRecorded ? 'Немає даних' : read(period);
                        return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value(current))}</td><td>${escapeHtml(value(previous))}</td></tr>`;
                    }).join('')}</tbody>
                </table>
            </details>
            ${Array.isArray(data.substitutions)
                ? renderProfileEmployeeDetails('Мої підміни', substitutions, 'За цей місяць підмін немає.') : ''}
            ${renderProfileEmployeeDetails('Завершені курси', courses)}
            ${renderProfileEmployeeDetails('Поточні допуски', assignments, 'Немає підтверджених записів про допуски.')}
        `;
    }

    return { renderSalary, renderResults };
}
