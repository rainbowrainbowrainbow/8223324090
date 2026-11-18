/* Authenticated Chat attachments use the existing API session and never URL tokens. */
(function () {
    'use strict';
    const records = new Map();
    const waitingImages = new Set();
    const imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
            imageObserver.unobserve(entry.target);
            waitingImages.delete(entry.target);
            loadImage(entry.target);
        }
    }, { rootMargin: '200px' }) : null;
    const MAX_BYTES = 10 * 1024 * 1024;
    let epoch = 0;

    function apiPath(value) {
        try {
            const url = new URL(value, location.origin);
            return url.origin === location.origin && url.pathname.startsWith('/uploads/chat/')
                ? '/api/chat/uploads/' + url.pathname.slice('/uploads/chat/'.length) : null;
        } catch { return null; }
    }

    function scopeKey() {
        return typeof getCrmBusinessScope === 'function' ? JSON.stringify(getCrmBusinessScope()) : '';
    }

    function release(element) {
        const record = records.get(element);
        if (!record) return;
        records.delete(element);
        record.controller.abort();
        if (record.audio) {
            record.audio.pause();
            record.audio.removeAttribute('src');
            record.audio.load();
        }
        if (record.url) URL.revokeObjectURL(record.url);
        if (element.tagName === 'IMG') {
            element.onload = null;
            element.onerror = null;
            element.removeAttribute('src');
            element.removeAttribute('aria-busy');
            element.setAttribute('aria-disabled', 'true');
        }
        if (element.dataset.voiceUrl === record.url) element.dataset.voiceUrl = record.source;
        element.dataset.privateState = '';
    }

    function clear() {
        epoch++;
        for (const image of waitingImages) imageObserver?.unobserve(image);
        waitingImages.clear();
        for (const element of records.keys()) release(element);
        document.querySelectorAll('.chat-lightbox-overlay').forEach(element => element.remove());
    }

    async function urlFor(element, source) {
        const endpoint = apiPath(source);
        if (!endpoint) return source;
        const existing = records.get(element);
        if (existing?.source === source) return existing.promise;
        if (existing) release(element);
        if (typeof safeFetch !== 'function' || typeof captureApiAuthSessionSnapshot !== 'function') throw new Error('Attachment session unavailable');
        const session = captureApiAuthSessionSnapshot();
        const scope = scopeKey();
        const started = epoch;
        const record = { source, controller: new AbortController(), url: null, audio: null, promise: null };
        records.set(element, record);
        record.promise = (async () => {
            const response = await safeFetch(endpoint, { signal: record.controller.signal, cache: 'no-store', redirect: 'error' });
            if (!response || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Attachment unavailable');
            const blob = await response.blob();
            if (blob.size > MAX_BYTES || record.controller.signal.aborted || !element.isConnected
                || epoch !== started || scopeKey() !== scope || !isApiAuthSessionSnapshotCurrent(session)) {
                throw new DOMException('Attachment context changed', 'AbortError');
            }
            // Unsupported historical MIME types are downloads, never active documents in the app origin.
            const type = /^(?:image\/(?:png|jpeg|gif|webp)|audio\/[a-z0-9.+-]+|video\/mp4|application\/(?:pdf|zip|octet-stream|msword|vnd\.[a-z0-9.+-]+)|text\/plain)$/i.test(blob.type)
                ? blob.type : 'application/octet-stream';
            record.url = URL.createObjectURL(new Blob([blob], { type }));
            return record.url;
        })();
        try { return await record.promise; }
        catch (error) { if (records.get(element) === record) release(element); throw error; }
    }

    function bindAudio(element, audio) {
        const record = records.get(element);
        if (record) record.audio = audio;
    }

    function loadImage(image) {
        if (!image.isConnected || records.has(image)) return;
        const source = image.dataset.chatPrivateSrc;
        const originalAlt = image.dataset.privateAlt || image.alt || 'Зображення';
        image.dataset.privateAlt = originalAlt;
        image.dataset.privateState = 'loading';
        image.setAttribute('aria-busy', 'true');
        image.setAttribute('aria-disabled', 'true');
        image.setAttribute('role', 'button');
        image.tabIndex = 0;
        const started = epoch;
        const pending = urlFor(image, source);
        const ownedRecord = records.get(image);
        pending.then(url => {
            if (!image.isConnected || epoch !== started || records.get(image) !== ownedRecord) return;
            image.onload = () => {
                if (!image.isConnected || epoch !== started || records.get(image) !== ownedRecord) return;
                image.alt = originalAlt;
                image.dataset.privateState = 'ready';
                image.removeAttribute('aria-busy');
                image.setAttribute('aria-disabled', 'false');
                image.setAttribute('aria-label', 'Відкрити: ' + originalAlt);
            };
            image.onerror = () => {
                if (epoch !== started || records.get(image) !== ownedRecord) return;
                release(image);
                image.dataset.privateState = 'failed';
                image.alt = originalAlt + ' — вкладення недоступне';
            };
            // Authentication and viewport checks already delayed the fetch;
            // do not add a second native lazy-loading delay to a visible blob.
            image.loading = 'eager';
            image.src = url;
        }).catch(error => {
            if (error.name !== 'AbortError' && image.isConnected && epoch === started && !records.has(image)) {
                image.dataset.privateState = 'failed';
                image.alt = originalAlt + ' — вкладення недоступне';
            }
        }).finally(() => {
            if (epoch === started && !records.has(image)) image.removeAttribute('aria-busy');
        });
    }

    function hydrateImage(image) {
        if (!image.isConnected || records.has(image) || waitingImages.has(image)) return;
        if (!imageObserver) return loadImage(image);
        waitingImages.add(image);
        imageObserver.observe(image);
    }

    function scan(root) {
        if (root.nodeType !== 1 && root.nodeType !== 9) return;
        if (root.matches?.('img[data-chat-private-src]')) hydrateImage(root);
        root.querySelectorAll('img[data-chat-private-src]').forEach(hydrateImage);
    }

    function start() {
        scan(document);
        new MutationObserver(changes => {
            for (const element of records.keys()) if (!element.isConnected) release(element);
            for (const image of waitingImages) if (!image.isConnected) {
                imageObserver.unobserve(image); waitingImages.delete(image);
            }
            for (const change of changes) for (const node of change.addedNodes) scan(node);
        }).observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('click', async event => {
        const image = event.target.closest?.('img[data-chat-private-src]');
        if (image && image.dataset.privateState !== 'ready') {
            event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        const link = event.target.closest?.('a[data-chat-private-url]');
        if (!link) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (link.getAttribute('aria-busy') === 'true') return;
        link.setAttribute('aria-busy', 'true');
        try {
            const url = await urlFor(link, link.dataset.chatPrivateUrl);
            if (!link.isConnected) return;
            const download = document.createElement('a');
            download.href = url;
            download.download = (link.dataset.chatFilename || 'file').replace(/[\x00-\x1f]/g, '');
            document.body.appendChild(download);
            download.click();
            download.remove();
            setTimeout(() => { if (records.get(link)?.url === url) release(link); }, 30000);
        } catch (error) {
            if (error.name !== 'AbortError' && typeof showNotification === 'function') showNotification('Вкладення недоступне. Перевірте доступ до каналу.', 'error');
        } finally { link.removeAttribute('aria-busy'); }
    }, true);
    document.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key) && event.target.matches?.('img[data-chat-private-src]')) {
            event.preventDefault(); event.target.click();
        }
    });
    for (const event of ['crmBusinessContextChanged', 'crmBusinessScopeChanged', 'crm:auth-cleared', 'pagehide']) {
        window.addEventListener(event, clear);
    }
    window.addEventListener('storage', event => {
        if (event.key === null || ['pzp_user', 'pzp_auth_session_generation'].includes(event.key)) clear();
    });
    window.addEventListener('crm:authenticated-runtime-ready', () => scan(document));
    window.ChatPrivateUploads = Object.freeze({ apiPath, urlFor, bindAudio, clear });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
