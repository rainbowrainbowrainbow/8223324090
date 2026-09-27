/** In-page PNG preview and explicit save/share actions for certificate pages. */
(function() {
    let activeExport = null;

    function exportMessage(error) {
        if (error?.message === 'auth_session_unavailable') {
            return 'Сеанс завершився. Увійдіть у CRM знову та повторіть спробу.';
        }
        if (error?.message === 'certificate_qr_unavailable') {
            return 'Не вдалося завантажити QR. Зображення не створено.';
        }
        return 'Не вдалося підготувати зображення. Перевірте з’єднання та повторіть спробу.';
    }

    function canShareFile(file) {
        if (!file || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
        try { return navigator.canShare({ files: [file] }); } catch (_) { return false; }
    }

    function canvasBlob(canvas) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('certificate_png_unavailable')), 'image/png');
            } catch (error) { reject(error); }
        });
    }

    function imageReady(image) {
        if (typeof image.decode === 'function') return image.decode();
        if (image.complete) return image.naturalWidth ? Promise.resolve() : Promise.reject(new Error('certificate_image_unavailable'));
        return new Promise((resolve, reject) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', reject, { once: true });
        });
    }

    function revokePreview(state) {
        const url = state.url;
        state.url = null;
        state.href = null;
        state.image.removeAttribute('src');
        if (!url) return;
        if (state.downloadStarted) {
            // Give the browser time to consume a download that was just started.
            window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {
            URL.revokeObjectURL(url);
        }
    }

    function close(state) {
        if (state.closed) return;
        state.closed = true;
        state.requestId++;
        revokePreview(state);
        state.dialog.remove();
        if (activeExport === state) activeExport = null;
        if (state.returnFocus?.isConnected) state.returnFocus.focus();
    }

    function setStatus(state, message) {
        if (!state.closed) state.status.textContent = message;
    }

    async function prepare(state) {
        if (state.busy || state.closed) return;
        state.busy = true;
        const requestId = ++state.requestId;
        state.retry.hidden = true;
        state.save.hidden = true;
        state.share.hidden = true;
        state.fullSize.hidden = true;
        state.image.hidden = true;
        state.returnFocus?.setAttribute('aria-busy', 'true');
        setStatus(state, 'Готуємо зображення сертифіката…');
        try {
            const cert = await state.options.loadCertificate();
            if (!cert || state.closed || requestId !== state.requestId) return;
            const canvas = await window.CertificatePreview.generateCertificateCanvas(cert, {
                apiBase: state.options.apiBase,
                getAuthHeaders: state.options.getAuthHeaders
            });
            if (state.closed || requestId !== state.requestId) return;
            const blob = await canvasBlob(canvas);
            if (state.closed || requestId !== state.requestId) return;
            const filename = `${String(cert.certCode || 'certificate').replace(/[^\w-]/g, '_')}.png`;
            const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
            const url = URL.createObjectURL(blob);
            if (state.closed || requestId !== state.requestId) {
                URL.revokeObjectURL(url);
                return;
            }
            state.file = file;
            state.filename = filename;
            state.url = url;
            state.href = url;
            state.downloadStarted = false;
            state.image.src = url;
            try {
                await imageReady(state.image);
            } catch (_) {
                if (state.closed || requestId !== state.requestId) return;
                // Some WebKit builds cannot decode a Blob URL even when the PNG Blob is valid.
                URL.revokeObjectURL(url);
                state.url = null;
                state.href = canvas.toDataURL('image/png');
                state.image.src = state.href;
                await imageReady(state.image);
            }
            if (state.closed || requestId !== state.requestId) return;
            state.image.hidden = false;
            state.fullSize.href = state.href;
            state.fullSize.hidden = false;
            state.save.hidden = !('download' in document.createElement('a'));
            state.share.hidden = !canShareFile(file);
            setStatus(state, state.save.hidden
                ? 'Зображення готове. Відкрийте його в повному розмірі та збережіть через меню браузера.'
                : 'Зображення готове. Оберіть збереження або відкрийте його в повному розмірі.');
        } catch (error) {
            if (state.closed || requestId !== state.requestId) return;
            revokePreview(state);
            state.retry.hidden = false;
            setStatus(state, exportMessage(error));
            state.retry.focus();
        } finally {
            state.busy = false;
            state.returnFocus?.removeAttribute('aria-busy');
        }
    }

    function save(state) {
        if (!state.href || state.closed) return;
        const link = document.createElement('a');
        link.href = state.href;
        link.download = state.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        state.downloadStarted = true;
        setStatus(state, 'Запит на завантаження передано браузеру. Перевірте «Завантаження» або меню браузера.');
    }

    function share(state) {
        if (state.closed || !canShareFile(state.file)) return;
        // Call share synchronously inside the click handler to preserve user activation.
        let request;
        try { request = navigator.share({ files: [state.file], title: 'Сертифікат' }); }
        catch (error) { request = Promise.reject(error); }
        Promise.resolve(request).then(
            () => setStatus(state, 'Повернулися з меню поширення. Зображення залишається доступним тут.'),
            error => setStatus(state, error?.name === 'AbortError'
                ? 'Поширення скасовано. Зображення залишається доступним тут.'
                : 'Не вдалося відкрити поширення. Скористайтеся збереженням або відкрийте зображення.')
        );
    }

    function open(options = {}) {
        if (activeExport && !activeExport.closed) {
            activeExport.dialog.focus();
            return activeExport.dialog;
        }
        if (typeof options.loadCertificate !== 'function' || !window.CertificatePreview?.generateCertificateCanvas) {
            throw new Error('certificate_export_unavailable');
        }
        const dialog = document.createElement('dialog');
        dialog.className = 'cert-image-export-dialog';
        dialog.setAttribute('aria-labelledby', 'certImageExportTitle');
        dialog.innerHTML = `<div class="cert-image-export-body">
            <div class="cert-image-export-head">
                <h2 id="certImageExportTitle">Зображення сертифіката</h2>
                <button type="button" class="cert-image-export-close" data-export-action="close" aria-label="Закрити">×</button>
            </div>
            <p class="cert-image-export-status" aria-live="polite"></p>
            <img class="cert-image-export-preview" alt="Повне зображення сертифіката з QR-кодом" hidden>
            <div class="cert-image-export-actions">
                <button type="button" data-export-action="save" hidden>Зберегти зображення</button>
                <button type="button" data-export-action="share" hidden>Поділитися</button>
                <a data-export-action="full" target="_blank" rel="noopener" hidden>Відкрити повний розмір</a>
                <button type="button" data-export-action="retry" hidden>Повторити</button>
                <button type="button" data-export-action="close">Повернутися до сертифіката</button>
            </div>
        </div>`;
        document.body.appendChild(dialog);
        const state = {
            dialog, options, closed: false, busy: false, requestId: 0, url: null, downloadStarted: false,
            file: null, filename: '', href: null, returnFocus: options.trigger || document.activeElement,
            status: dialog.querySelector('.cert-image-export-status'),
            image: dialog.querySelector('.cert-image-export-preview'),
            save: dialog.querySelector('[data-export-action="save"]'),
            share: dialog.querySelector('[data-export-action="share"]'),
            fullSize: dialog.querySelector('[data-export-action="full"]'),
            retry: dialog.querySelector('[data-export-action="retry"]')
        };
        activeExport = state;
        dialog.addEventListener('close', () => close(state));
        dialog.addEventListener('click', event => {
            if (event.target === dialog) { dialog.close(); return; }
            const action = event.target.closest('[data-export-action]')?.dataset.exportAction;
            if (action === 'close') dialog.close();
            if (action === 'retry') prepare(state);
            if (action === 'save') save(state);
            if (action === 'share') share(state);
        });
        dialog.showModal();
        prepare(state);
        return dialog;
    }

    window.CertificateImageExport = { open };
})();
