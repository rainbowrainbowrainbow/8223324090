'use strict';

(function HermesStudioPage() {
    const API_BASE = '/api/hermes-studio';
    const DECISION_ROLES = new Set([
        'creator',
        'director',
        'vice_director',
        'senior_manager',
        'art_director',
        'marketer',
        'admin'
    ]);
    const STATUSES = [
        'queued',
        'claimed',
        'in_progress',
        'needs_input',
        'ready_for_review',
        'revision_requested',
        'approved',
        'rejected',
        'failed',
        'cancelled'
    ];

    const state = {
        jobs: [],
        selectedJobId: null,
        canDecide: false,
        loading: false
    };

    function $(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function notify(message, type = 'info') {
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        }
    }

    function getToken() {
        return localStorage.getItem('pzp_token');
    }

    function businessContextParam() {
        const value = new URLSearchParams(window.location.search).get('businessContext');
        return value ? String(value).trim() : '';
    }

    function withBusinessContext(params = new URLSearchParams()) {
        const context = businessContextParam();
        if (context) params.set('businessContext', context);
        return params;
    }

    async function studioFetch(path, options = {}) {
        const token = getToken();
        const headers = {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers
        });
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { error: text };
        }
        if (res.status === 401) {
            window.location.href = '/';
            return null;
        }
        if (!res.ok) {
            const err = new Error(data.error || data.message || `HTTP ${res.status}`);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    function currentUserRoles() {
        const user = typeof AppState !== 'undefined' ? AppState.currentUser : null;
        const roles = [user?.role];
        if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
        if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
        return roles.filter(Boolean).map(role => String(role).trim());
    }

    function canCurrentUserDecide() {
        return currentUserRoles().some(role => DECISION_ROLES.has(role));
    }

    function selectedJob() {
        return state.jobs.find(job => String(job.id) === String(state.selectedJobId)) || null;
    }

    function statusLabel(status) {
        return String(status || '-').replace(/_/g, ' ');
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function safeUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (raw.startsWith('/')) return raw;
        try {
            const url = new URL(raw);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch {
            return '';
        }
    }

    function isImageAsset(asset) {
        const mime = String(asset?.mimeType || '').toLowerCase();
        const url = String(asset?.url || '').toLowerCase();
        return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(url);
    }

    function renderStatusRow() {
        const counts = new Map(STATUSES.map(status => [status, 0]));
        for (const job of state.jobs) {
            counts.set(job.status, (counts.get(job.status) || 0) + 1);
        }
        const visible = ['queued', 'in_progress', 'needs_input', 'ready_for_review', 'revision_requested', 'approved'];
        $('hermesStudioStatusRow').innerHTML = visible.map(status => `
            <div class="hermes-studio-status-tile">
                <span>${esc(statusLabel(status))}</span>
                <strong>${counts.get(status) || 0}</strong>
            </div>
        `).join('');
    }

    function renderQueue() {
        const list = $('hermesStudioQueueList');
        if (state.loading) {
            list.innerHTML = '<div class="empty-state">Завантаження...</div>';
            return;
        }
        if (!state.jobs.length) {
            list.innerHTML = '<div class="empty-state">Creative jobs не знайдено</div>';
            return;
        }
        list.innerHTML = state.jobs.map(job => {
            const payload = job.sourcePayload || {};
            const active = String(job.id) === String(state.selectedJobId) ? ' active' : '';
            const material = Array.isArray(payload.materialTypes) && payload.materialTypes.length
                ? payload.materialTypes[0]
                : (payload.formatSize || payload.formats?.[0] || 'creative');
            return `
                <button type="button" class="hermes-studio-job${active}" data-job-id="${esc(job.id)}">
                    <span class="hermes-studio-job-title">${esc(job.title || payload.title || 'Creative job')}</span>
                    <span class="hermes-studio-job-meta">
                        <span>${esc(material)}</span>
                        <span class="hermes-studio-status-chip" data-status="${esc(job.status)}">${esc(statusLabel(job.status))}</span>
                    </span>
                    <span class="hermes-studio-job-meta">
                        <span>${esc(formatDate(job.updatedAt || job.createdAt))}</span>
                        <span>${esc((job.assets || []).length)} assets</span>
                    </span>
                </button>
            `;
        }).join('');
        list.querySelectorAll('[data-job-id]').forEach(button => {
            button.addEventListener('click', () => {
                state.selectedJobId = button.dataset.jobId;
                renderAll();
            });
        });
    }

    function renderAssets(job) {
        const assets = (job.assets || [])
            .filter(asset => asset.assetType !== 'source')
            .slice(0, 3);
        if (!assets.length) {
            return '<p class="hermes-studio-empty-note">Assets ще не повернулись.</p>';
        }
        return `
            <div class="hermes-studio-assets">
                ${assets.map((asset, index) => {
                    const url = safeUrl(asset.url);
                    const role = asset.role || asset.assetType || `variant-${index + 1}`;
                    const preview = url && isImageAsset(asset)
                        ? `<img src="${esc(url)}" alt="${esc(role)}">`
                        : '<div class="hermes-studio-asset-file">Asset</div>';
                    const link = url
                        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Variant ${index + 1}</a>`
                        : `<strong>Variant ${index + 1}</strong>`;
                    return `
                        <article class="hermes-studio-asset">
                            ${preview}
                            <div class="hermes-studio-asset-meta">
                                ${link}
                                <span>${esc(role)}</span>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderHistory(job) {
        const history = (job.history || []).slice(-8).reverse();
        if (!history.length) {
            return '<p class="hermes-studio-empty-note">History порожня.</p>';
        }
        return `
            <ul class="hermes-studio-history">
                ${history.map(event => `
                    <li>
                        <strong>${esc(event.summary || event.eventType)}</strong>
                        <span>${esc(event.eventType)} · ${esc(formatDate(event.createdAt))}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    function renderDetail() {
        const job = selectedJob();
        const body = $('hermesStudioDetailBody');
        const status = $('hermesStudioSelectedStatus');
        if (!job) {
            status.textContent = '-';
            status.removeAttribute('data-status');
            body.innerHTML = '<div class="empty-state">Оберіть job у черзі</div>';
            setDecisionButtonsState();
            return;
        }
        const payload = job.sourcePayload || {};
        status.textContent = statusLabel(job.status);
        status.dataset.status = job.status || '';
        const material = Array.isArray(payload.materialTypes) && payload.materialTypes.length
            ? payload.materialTypes.join(', ')
            : '-';
        const formats = Array.isArray(payload.formats) && payload.formats.length
            ? payload.formats.join(', ')
            : (payload.formatSize || '-');
        const references = Array.isArray(payload.references) && payload.references.length
            ? payload.references.join('\n')
            : '';
        body.innerHTML = `
            <div class="hermes-studio-detail-grid">
                <div class="hermes-studio-detail-row">
                    <span>Назва</span>
                    <strong>${esc(job.title || payload.title || '-')}</strong>
                </div>
                <div class="hermes-studio-detail-row">
                    <span>Тип / формат</span>
                    <p>${esc(material)} · ${esc(formats)}</p>
                </div>
                <div class="hermes-studio-detail-row">
                    <span>Дедлайн</span>
                    <p>${esc(payload.deadline || formatDate(job.dueAt))}</p>
                </div>
                <div class="hermes-studio-detail-row">
                    <span>Вимоги</span>
                    <p>${esc(payload.requirements || payload.brief || '-')}</p>
                </div>
                ${references ? `<div class="hermes-studio-detail-row"><span>References</span><p>${esc(references)}</p></div>` : ''}
                <div class="hermes-studio-detail-row">
                    <span>Assets</span>
                    ${renderAssets(job)}
                </div>
                <div class="hermes-studio-detail-row">
                    <span>History</span>
                    ${renderHistory(job)}
                </div>
            </div>
        `;
        setDecisionButtonsState();
    }

    function setDecisionButtonsState() {
        const job = selectedJob();
        const canDecide = state.canDecide && !!job;
        document.querySelectorAll('[data-hermes-decision], #hermesStudioRegenerateBtn').forEach(button => {
            button.disabled = !canDecide;
            button.title = canDecide ? '' : 'Недостатньо прав або job не обрано';
        });
        const decisionBox = document.querySelector('.hermes-studio-decision-box');
        if (decisionBox) decisionBox.setAttribute('aria-disabled', canDecide ? 'false' : 'true');
    }

    function renderAll() {
        renderStatusRow();
        renderQueue();
        renderDetail();
    }

    async function loadJobs({ preserveSelection = true } = {}) {
        state.loading = true;
        renderQueue();
        try {
            const params = withBusinessContext(new URLSearchParams());
            const status = $('hermesStudioStatusFilter')?.value || '';
            if (status) params.set('status', status);
            params.set('limit', '50');
            const data = await studioFetch(`/jobs?${params.toString()}`);
            if (!data) return;
            state.jobs = Array.isArray(data.items) ? data.items : [];
            state.canDecide = data.meta?.canDecide === true || canCurrentUserDecide();
            if (!preserveSelection || !state.jobs.some(job => String(job.id) === String(state.selectedJobId))) {
                state.selectedJobId = state.jobs[0]?.id || null;
            }
        } catch (err) {
            console.error('[hermes-studio] load jobs failed', err);
            notify(err.message || 'Не вдалося завантажити Hermes Studio', 'error');
        } finally {
            state.loading = false;
            renderAll();
        }
    }

    function collectBriefForm() {
        return {
            businessContext: businessContextParam() || undefined,
            materialType: $('hermesStudioMaterialType').value,
            title: $('hermesStudioTitle').value.trim(),
            source: $('hermesStudioSource').value.trim(),
            formatSize: $('hermesStudioFormatSize').value.trim(),
            requirements: $('hermesStudioRequirements').value.trim(),
            deadline: $('hermesStudioDeadline').value,
            priority: $('hermesStudioPriority').value,
            references: $('hermesStudioReferences').value,
            comment: $('hermesStudioComment').value.trim()
        };
    }

    async function submitBrief(event) {
        event.preventDefault();
        const button = $('hermesStudioSubmitBtn');
        button.disabled = true;
        try {
            const data = await studioFetch('/jobs', {
                method: 'POST',
                body: JSON.stringify(collectBriefForm())
            });
            if (!data?.job) return;
            notify('Hermes Studio job створено', 'success');
            $('hermesStudioBriefForm').reset();
            state.selectedJobId = data.job.id;
            await loadJobs({ preserveSelection: true });
        } catch (err) {
            console.error('[hermes-studio] create failed', err);
            notify(err.message || 'Не вдалося створити Hermes job', 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function postDecision(decision) {
        const job = selectedJob();
        if (!job || !state.canDecide) return;
        const notes = $('hermesStudioDecisionNotes').value.trim();
        try {
            const data = await studioFetch(`/jobs/${encodeURIComponent(job.id)}/decision`, {
                method: 'POST',
                body: JSON.stringify({
                    businessContext: businessContextParam() || undefined,
                    decision,
                    notes,
                    action: decision
                })
            });
            if (data?.job) {
                state.selectedJobId = data.job.id;
                $('hermesStudioDecisionNotes').value = '';
                notify('Рішення записано в history', 'success');
                await loadJobs({ preserveSelection: true });
            }
        } catch (err) {
            console.error('[hermes-studio] decision failed', err);
            notify(err.message || 'Не вдалося записати рішення', 'error');
        }
    }

    async function regenerateJob() {
        const job = selectedJob();
        if (!job || !state.canDecide) return;
        const notes = $('hermesStudioDecisionNotes').value.trim();
        try {
            const data = await studioFetch(`/jobs/${encodeURIComponent(job.id)}/regenerate`, {
                method: 'POST',
                body: JSON.stringify({
                    businessContext: businessContextParam() || undefined,
                    notes
                })
            });
            if (data?.regeneratedJob) {
                state.selectedJobId = data.regeneratedJob.id;
                $('hermesStudioDecisionNotes').value = '';
                notify('Regenerate job створено', 'success');
                await loadJobs({ preserveSelection: true });
            }
        } catch (err) {
            console.error('[hermes-studio] regenerate failed', err);
            notify(err.message || 'Не вдалося створити regenerate job', 'error');
        }
    }

    function bindUi() {
        $('hermesStudioRefreshBtn')?.addEventListener('click', () => loadJobs({ preserveSelection: true }));
        $('hermesStudioFocusFormBtn')?.addEventListener('click', () => $('hermesStudioTitle')?.focus());
        $('hermesStudioStatusFilter')?.addEventListener('change', () => loadJobs({ preserveSelection: false }));
        $('hermesStudioBriefForm')?.addEventListener('submit', submitBrief);
        document.querySelectorAll('[data-hermes-decision]').forEach(button => {
            button.addEventListener('click', () => postDecision(button.dataset.hermesDecision));
        });
        $('hermesStudioRegenerateBtn')?.addEventListener('click', regenerateJob);
    }

    async function initAuth() {
        const token = getToken();
        if (!token) {
            window.location.href = '/';
            return;
        }
        try {
            const res = await fetch('/api/auth/verify', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Token invalid');
            const data = await res.json();
            const user = data.user || data;
            if (typeof AppState !== 'undefined') AppState.currentUser = user;
            $('currentUser').textContent = user.name || user.username || '';
            if (typeof enforceCurrentPageAccess === 'function' && !enforceCurrentPageAccess(user)) return;
            if (typeof bindLogoutButton === 'function') bindLogoutButton();
            if (typeof initDarkMode === 'function') initDarkMode();
            state.canDecide = canCurrentUserDecide();
            bindUi();
            await loadJobs({ preserveSelection: false });
            if (typeof showAuthenticatedPageShell === 'function') {
                showAuthenticatedPageShell();
            } else {
                $('mainApp')?.classList.remove('hidden');
                if (window.Sidebar?.markShellReady) window.Sidebar.markShellReady();
            }
        } catch (err) {
            console.error('[hermes-studio] auth failed', err);
            if (typeof clearAuthenticatedPageShell === 'function') clearAuthenticatedPageShell();
            window.location.href = '/';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth, { once: true });
    } else {
        initAuth();
    }
})();
