/* Shared Afisha schedule preview and save flow. */
(function () {
    'use strict';

    function bind(form, { request, onSaved, onBusy }) {
        const date = form.elements.importDate;
        const month = form.elements.importMonth;
        const text = form.elements.importText;
        const check = form.querySelector('[data-import-check]');
        const save = form.querySelector('[data-import-save]');
        const status = form.querySelector('[data-import-status]');
        const list = form.querySelector('[data-import-preview]');
        const fields = [date, month, text].filter(Boolean);
        let preview = null;

        function reset() {
            preview = null;
            status.textContent = '';
            list.replaceChildren();
            list.hidden = true;
            save.disabled = true;
        }

        async function submit(commit) {
            if (check.disabled || (commit && !preview)) return;
            const previous = preview;
            const draft = commit ? previous.draft : {
                month: month?.value || date?.value.slice(0, 7),
                ...(date ? { date: date.value } : {}),
                text: text.value
            };
            if (!commit) reset();
            check.disabled = save.disabled = true;
            for (const field of fields) field.readOnly = true;
            onBusy?.(true);
            status.textContent = commit ? 'Додаємо події…' : 'Перевіряємо розклад…';
            try {
                const result = await request({ ...draft, commit });
                if (commit) {
                    text.value = '';
                    reset();
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
                preview = { draft, dates: [...new Set(result.items.map(item => item.date))] };
                status.textContent = `Подій у списку: ${result.items.length}.${result.repeated ? ` Повторів у тексті: ${result.repeated}.` : ''} Наявні дублікати буде пропущено.`;
            } catch (error) {
                status.textContent = error.message;
            } finally {
                for (const field of fields) field.readOnly = false;
                check.disabled = false;
                save.disabled = !preview;
                onBusy?.(false);
            }
        }

        form.addEventListener('input', reset);
        form.addEventListener('submit', event => {
            event.preventDefault();
            submit(false);
        });
        save.addEventListener('click', () => submit(true));
    }

    window.AfishaImportForm = { bind };
})();
