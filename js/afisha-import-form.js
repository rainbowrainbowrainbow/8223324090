/* Shared Afisha schedule preview and save flow. */
(function () {
    'use strict';

    const eventNouns = { one: 'захід', few: 'заходи', many: 'заходів', other: 'заходу' };
    const pluralRules = new Intl.PluralRules('uk');

    function bind(form, { request, onSaved, onBusy }) {
        const date = form.elements.importDate;
        const month = form.elements.importMonth;
        const text = form.elements.importText;
        const action = form.querySelector('[data-import-action]');
        const status = form.querySelector('[data-import-status]');
        const list = form.querySelector('[data-import-preview]');
        const fields = [date, month, text].filter(Boolean);
        let preview = null;
        let busy = false;

        function clearPreview() {
            preview = null;
            list.replaceChildren();
            list.hidden = true;
        }

        function syncAction() {
            action.disabled = !text.value.trim();
            action.textContent = preview
                ? `Додати ${preview.count} ${eventNouns[pluralRules.select(preview.count)]}`
                : 'Перевірити розклад';
        }

        async function submit() {
            if (busy || action.disabled) return;
            const previous = preview;
            const commit = Boolean(previous);
            const draft = commit ? previous.draft : {
                month: month?.value || date?.value.slice(0, 7),
                ...(date ? { date: date.value } : {}),
                text: text.value
            };
            busy = true;
            action.setAttribute('aria-disabled', 'true');
            for (const field of fields) field.readOnly = true;
            onBusy?.(true);
            status.textContent = commit ? 'Додаємо події…' : 'Перевіряємо розклад…';
            try {
                const result = await request({ ...draft, commit });
                if (commit) {
                    text.value = '';
                    clearPreview();
                    status.textContent = `Додано подій: ${result.created}. Пропущено дублікатів: ${result.skipped}.`;
                    await onSaved?.(result, previous.dates);
                    return;
                }
                list.replaceChildren(...result.items.map(item => {
                    const row = document.createElement('li');
                    row.textContent = `${item.date} · ${item.time} · ${item.title} · ${item.duration} хв`;
                    return row;
                }));
                list.hidden = false;
                preview = { draft, count: result.items.length, dates: [...new Set(result.items.map(item => item.date))] };
                status.textContent = `Подій у списку: ${result.items.length}.${result.repeated ? ` Повторів у тексті: ${result.repeated}.` : ''} Наявні дублікати буде пропущено.`;
            } catch (error) {
                status.textContent = error.message;
            } finally {
                for (const field of fields) field.readOnly = false;
                busy = false;
                action.removeAttribute('aria-disabled');
                syncAction();
                onBusy?.(false);
            }
        }

        form.addEventListener('input', () => {
            if (busy) return;
            clearPreview();
            syncAction();
            const hint = action.disabled ? '' : 'Перевірте дати й час перед додаванням.';
            if (status.textContent !== hint) status.textContent = hint;
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            submit();
        });
        syncAction();
    }

    window.AfishaImportForm = { bind };
})();
