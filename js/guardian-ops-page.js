/**
 * js/guardian-ops-page.js - protected Guardian operator console.
 */
(function() {
    'use strict';

    const ENDPOINT = '/api/guardian/ops/reliability?limit=50';
    const STATUS_LABELS = {
        pending: 'pending',
        retry_needed: 'retry needed',
        blocked: 'blocked',
        published: 'published',
        failed: 'failed',
        terminal_failed: 'terminal failed',
        dead_letter: 'dead letter',
        replayed: 'replayed',
        retry_scheduled: 'retry scheduled',
        duplicate_noop: 'duplicate no-op',
        delivered: 'delivered',
        processed: 'processed'
    };

    const state = {
        snapshot: null,
        filter: 'attention',
        loading: false,
        requeueing: null
    };

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return 'n/a';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function statusBadge(status) {
        const safeStatus = String(status || 'unknown').replace(/[^a-z0-9_-]/gi, '');
        const label = STATUS_LABELS[status] || status || 'unknown';
        return `<span class="ops-badge ${safeStatus}">${escapeHtml(label)}</span>`;
    }

    function setStatus(message, type = '') {
        const el = $('guardianOpsStatus');
        if (!el) return;
        el.textContent = message;
        el.className = `ops-banner${type ? ` ${type}` : ''}`;
    }

    function setBusy(isBusy) {
        state.loading = isBusy;
        const btn = $('guardianOpsRefreshBtn');
        if (btn) {
            btn.disabled = isBusy;
            btn.textContent = isBusy ? 'Refreshing...' : 'Refresh';
        }
        const main = $('main-content');
        if (main) main.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    }

    async function apiJson(method, url, payload) {
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(url, {
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
            },
            body: method === 'POST' ? JSON.stringify(payload || {}) : undefined
        });

        if (res.status === 401 || res.status === 403) {
            if (typeof handleAuthError === 'function') handleAuthError(res);
            throw new Error('Access denied');
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function needsAttention(event) {
        return ['pending', 'retry_needed', 'blocked', 'failed', 'terminal_failed', 'dead_letter'].includes(event?.status);
    }

    function filteredEvents(events) {
        const rows = Array.isArray(events) ? events : [];
        if (state.filter === 'all') return rows;
        return rows.filter(needsAttention);
    }

    function renderSummary(snapshot) {
        const outbox = snapshot.outbox?.summary || {};
        const queue = snapshot.eventQueue?.summary || {};
        const moderation = snapshot.moderation || {};
        const deadLetterSummary = snapshot.deadLetter?.summary || {};
        const retryCount = Number(outbox.retry_needed || 0) + Number(outbox.blocked || 0);
        const deadLetterCount = Object.values(deadLetterSummary).reduce((sum, value) => sum + Number(value || 0), 0);

        $('guardianOutboxRetryCount').textContent = String(retryCount);
        $('guardianOutboxTotalCount').textContent = `${Number(outbox.total || 0)} total Guardian outbox events`;
        $('guardianEventFailedCount').textContent = String(Number(queue.failed || 0) + Number(queue.terminal_failed || 0));
        $('guardianEventPendingCount').textContent = `${Number(queue.pending || 0)} pending`;
        $('guardianDeadLetterCount').textContent = String(deadLetterCount);
        $('guardianDeadLetterSub').textContent = `${Number(deadLetterSummary.transient_provider_failure || 0)} transient, ${Number(deadLetterSummary.provider_rejected || 0) + Number(deadLetterSummary.configuration_missing || 0) + Number(deadLetterSummary.malformed_payload || 0)} terminal`;
        $('guardianActiveMuteCount').textContent = String((moderation.activeMutes || []).length);
        $('guardianRecentActionCount').textContent = String((moderation.recentActions || []).length);
        $('guardianOpsGeneratedAt').textContent = `Loaded ${formatDate(snapshot.generatedAt)}`;
    }

    function payloadMeta(summary) {
        if (!summary) return '';
        const parts = [];
        if (summary.deliveryKey) parts.push(`delivery ${summary.deliveryKey}`);
        if (summary.sourceType || summary.sourceId) parts.push(`source ${summary.sourceType || 'n/a'}:${summary.sourceId || 'n/a'}`);
        if (summary.channelId) parts.push(`channel ${summary.channelId}`);
        if (summary.userId) parts.push(`user ${summary.userId}`);
        if (summary.hasContent) parts.push('content present');
        return parts.map(escapeHtml).join(' | ');
    }

    function renderOutbox(events) {
        const rows = filteredEvents(events);
        const el = $('guardianOutboxList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No Guardian outbox events require operator attention in the loaded window.</div>';
            return;
        }

        el.innerHTML = rows.map(row => {
            const canRequeue = !row.publishedAt && row.status !== 'published';
            const button = canRequeue
                ? `<button type="button" class="ops-requeue-btn" data-requeue-kind="outbox" data-requeue-id="${escapeHtml(row.id)}"${state.requeueing ? ' disabled' : ''}>Requeue</button>`
                : '<span class="ops-muted">No action</span>';
            return `
                <div class="ops-row" data-event-id="${escapeHtml(row.id)}">
                    <div>
                        <div class="ops-row-title">${escapeHtml(row.eventType)} ${statusBadge(row.status)}</div>
                        <div class="ops-row-meta">id ${escapeHtml(row.id)} | aggregate ${escapeHtml(row.aggregateType || 'n/a')}:${escapeHtml(row.aggregateId || 'n/a')} | attempts ${escapeHtml(row.publishAttempts || 0)} | ${formatDate(row.occurredAt || row.createdAt)}</div>
                        <div class="ops-row-meta">${payloadMeta(row.payloadSummary) || escapeHtml(row.idempotencyKey || '')}</div>
                        ${row.lastError ? `<div class="ops-row-error">${escapeHtml(row.lastError)}</div>` : ''}
                    </div>
                    <div class="ops-action-cell">${button}</div>
                </div>
            `;
        }).join('');
    }

    function renderEventQueue(events) {
        const rows = filteredEvents(events);
        const el = $('guardianEventQueueList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No Guardian event-queue items require operator attention in the loaded window.</div>';
            return;
        }

        el.innerHTML = rows.map(row => {
            const canRequeue = row.status === 'failed' || row.status === 'terminal_failed';
            const button = canRequeue
                ? `<button type="button" class="ops-requeue-btn" data-requeue-kind="events" data-requeue-id="${escapeHtml(row.id)}"${state.requeueing ? ' disabled' : ''}>Requeue</button>`
                : '<span class="ops-muted">No action</span>';
            return `
                <div class="ops-row" data-event-id="${escapeHtml(row.id)}">
                    <div>
                        <div class="ops-row-title">${escapeHtml(row.eventType)} ${statusBadge(row.status)}</div>
                        <div class="ops-row-meta">id ${escapeHtml(row.id)} | attempts ${escapeHtml(row.attempts || 0)}/${escapeHtml(row.maxAttempts || 0)} | next retry ${formatDate(row.nextRetryAt)}</div>
                        <div class="ops-row-meta">convergence ${escapeHtml(row.convergenceStatus || row.status || 'n/a')} | failure ${escapeHtml(row.failureClass || 'n/a')}</div>
                        <div class="ops-row-meta">${payloadMeta(row.payloadSummary) || escapeHtml(row.idempotencyKey || '')}</div>
                        ${row.lastError ? `<div class="ops-row-error">${escapeHtml(row.lastError)}</div>` : ''}
                    </div>
                    <div class="ops-action-cell">${button}</div>
                </div>
            `;
        }).join('');
    }

    function renderDeadLetter(events) {
        const rows = filteredEvents(events);
        const el = $('guardianDeadLetterList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No Guardian dead-letter events in the loaded window.</div>';
            return;
        }

        el.innerHTML = rows.map(row => {
            const canRequeue = row.status === 'dead_letter';
            const button = canRequeue
                ? `<button type="button" class="ops-requeue-btn" data-requeue-kind="dead-letter" data-requeue-id="${escapeHtml(row.id)}"${state.requeueing ? ' disabled' : ''}>Replay</button>`
                : '<span class="ops-muted">Already replayed</span>';
            return `
                <div class="ops-row" data-event-id="${escapeHtml(row.id)}">
                    <div>
                        <div class="ops-row-title">${escapeHtml(row.eventType)} ${statusBadge(row.status)}</div>
                        <div class="ops-row-meta">dead-letter ${escapeHtml(row.id)} | original ${escapeHtml(row.originalEventId || 'n/a')} | attempts ${escapeHtml(row.attempts || 0)}/${escapeHtml(row.maxAttempts || 0)}</div>
                        <div class="ops-row-meta">failure ${escapeHtml(row.failureClass || 'n/a')} | moved ${formatDate(row.movedAt)} | replayed ${formatDate(row.requeuedAt)}</div>
                        <div class="ops-row-meta">${payloadMeta(row.payloadSummary) || escapeHtml(row.idempotencyKey || '')}</div>
                        ${row.terminalReason ? `<div class="ops-row-error">${escapeHtml(row.terminalReason)}</div>` : ''}
                    </div>
                    <div class="ops-action-cell">${button}</div>
                </div>
            `;
        }).join('');
    }

    function renderMutes(items) {
        const rows = Array.isArray(items) ? items : [];
        const el = $('guardianMutesList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No active Guardian mutes in the loaded snapshot.</div>';
            return;
        }

        el.innerHTML = rows.map(row => `
            <div class="ops-row">
                <div>
                    <div class="ops-row-title">${escapeHtml(row.displayName || row.username || row.userId)} ${statusBadge('pending')}</div>
                    <div class="ops-row-meta">channel ${escapeHtml(row.channelName || row.channelId || 'n/a')} | until ${formatDate(row.mutedUntil)}</div>
                    <div class="ops-row-meta">${escapeHtml(row.reason || '')}</div>
                </div>
            </div>
        `).join('');
    }

    function renderCounters(items) {
        const rows = Array.isArray(items) ? items : [];
        const el = $('guardianCountersList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No durable Guardian counters in the loaded snapshot.</div>';
            return;
        }

        el.innerHTML = rows.map(row => `
            <div class="ops-row">
                <div>
                    <div class="ops-row-title">${escapeHtml(row.counterType)} ${statusBadge(row.alertedAt ? 'processed' : 'pending')}</div>
                    <div class="ops-row-meta">${escapeHtml(row.username || row.userId || 'n/a')} | count ${escapeHtml(row.count || 0)} | ${escapeHtml(row.windowKey || '')}</div>
                    <div class="ops-row-meta">window ${formatDate(row.windowStart)} to ${formatDate(row.windowEnd)} | updated ${formatDate(row.updatedAt)}</div>
                </div>
            </div>
        `).join('');
    }

    function renderActions(items) {
        const rows = Array.isArray(items) ? items : [];
        const el = $('guardianActionsList');
        if (!el) return;
        if (!rows.length) {
            el.innerHTML = '<div class="ops-empty">No recent Guardian actions in the loaded snapshot.</div>';
            return;
        }

        el.innerHTML = rows.map(row => `
            <div class="ops-row">
                <div>
                    <div class="ops-row-title">${escapeHtml(row.actionType || 'action')} ${statusBadge('processed')}</div>
                    <div class="ops-row-meta">target ${escapeHtml(row.targetUsername || row.targetUserId || 'n/a')} | channel ${escapeHtml(row.channelName || row.channelId || 'n/a')}</div>
                    <div class="ops-row-meta">${formatDate(row.createdAt)}</div>
                </div>
            </div>
        `).join('');
    }

    function renderRepairResult(payload) {
        const el = $('guardianRepairResult');
        if (!el) return;
        const result = payload?.preview || payload?.result || payload;
        if (!result) {
            el.innerHTML = '<div class="ops-empty">Enter a user id to preview Guardian moderation-state drift.</div>';
            return;
        }

        const issues = Array.isArray(result.issues) ? result.issues : [];
        if (!issues.length) {
            el.innerHTML = `
                <div class="ops-row">
                    <div>
                        <div class="ops-row-title">${escapeHtml(result.user?.username || result.user?.id || 'User')} ${statusBadge('processed')}</div>
                        <div class="ops-row-meta">No moderation counter drift found in the ${escapeHtml(result.lookbackDays || 8)} day window.</div>
                    </div>
                </div>
            `;
            return;
        }

        const applied = payload?.result?.appliedCount || 0;
        const header = `
            <div class="ops-row">
                <div>
                    <div class="ops-row-title">${escapeHtml(result.user?.username || result.user?.id || 'User')} ${statusBadge(payload?.dryRun === false ? 'replayed' : 'pending')}</div>
                    <div class="ops-row-meta">${escapeHtml(result.repairableIssueCount || 0)} repairable of ${escapeHtml(result.issueCount || issues.length)} issue(s). ${payload?.dryRun === false ? `${escapeHtml(applied)} counter row(s) repaired.` : 'Preview only.'}</div>
                </div>
            </div>
        `;
        const rows = issues.map(issue => `
            <div class="ops-row">
                <div>
                    <div class="ops-row-title">${escapeHtml(issue.type)} ${statusBadge(issue.repairable ? 'retry_needed' : 'blocked')}</div>
                    <div class="ops-row-meta">${escapeHtml(issue.counterType || 'n/a')} | ${escapeHtml(issue.windowKey || 'n/a')}</div>
                    <div class="ops-row-meta">${escapeHtml(issue.explanation || '')}</div>
                    ${issue.expected ? `<div class="ops-row-meta">expected count ${escapeHtml(issue.expected.expectedCount)} | last ${escapeHtml(issue.expected.lastSourceType || 'n/a')}:${escapeHtml(issue.expected.lastSourceId || 'n/a')}</div>` : ''}
                    ${issue.actual ? `<div class="ops-row-error">actual count ${escapeHtml(issue.actual.count || 0)} | last ${escapeHtml(issue.actual.lastSourceType || 'n/a')}:${escapeHtml(issue.actual.lastSourceId || 'n/a')}</div>` : ''}
                </div>
            </div>
        `).join('');
        el.innerHTML = header + rows;
    }

    function renderSnapshot(snapshot) {
        state.snapshot = snapshot;
        renderSummary(snapshot);
        renderOutbox(snapshot.outbox?.events || []);
        renderEventQueue(snapshot.eventQueue?.events || []);
        renderDeadLetter(snapshot.deadLetter?.events || []);
        renderMutes(snapshot.moderation?.activeMutes || []);
        renderCounters(snapshot.moderation?.counters || []);
        renderActions(snapshot.moderation?.recentActions || []);
    }

    async function loadSnapshot() {
        setBusy(true);
        setStatus('Loading Guardian reliability snapshot...');
        try {
            const snapshot = await apiJson('GET', ENDPOINT);
            renderSnapshot(snapshot);
            setStatus('Guardian ops snapshot loaded.', 'success');
        } catch (err) {
            console.error('Guardian ops load failed', err);
            setStatus(err.message || 'Failed to load Guardian ops snapshot', 'error');
        } finally {
            setBusy(false);
        }
    }

    async function requeue(kind, id, button) {
        if (!kind || !id || state.requeueing) return;
        state.requeueing = `${kind}:${id}`;
        if (button) {
            button.disabled = true;
            button.textContent = 'Queued...';
        }
        setStatus(`Requeueing ${kind} item ${id}...`);
        try {
            await apiJson('POST', `/api/guardian/ops/${kind}/${encodeURIComponent(id)}/requeue`);
            setStatus(`Requeued ${kind} item ${id}.`, 'success');
            await loadSnapshot();
        } catch (err) {
            console.error('Guardian ops requeue failed', err);
            setStatus(err.message || 'Failed to requeue Guardian item', 'error');
            if (button) {
                button.disabled = false;
                button.textContent = 'Requeue';
            }
        } finally {
            state.requeueing = null;
            if (state.snapshot) renderSnapshot(state.snapshot);
        }
    }

    async function reconcileUser(apply, button) {
        const input = $('guardianRepairUserId');
        const userId = input?.value?.trim();
        if (!userId || state.requeueing) {
            setStatus('Enter a user id before running Guardian repair preview.', 'error');
            return;
        }

        state.requeueing = `repair:${userId}`;
        if (button) button.disabled = true;
        setStatus(`${apply ? 'Applying' : 'Previewing'} Guardian moderation repair for user ${userId}...`);
        try {
            const data = apply
                ? await apiJson('POST', `/api/guardian/ops/reconcile/users/${encodeURIComponent(userId)}`, { apply: true })
                : await apiJson('GET', `/api/guardian/ops/reconcile/users/${encodeURIComponent(userId)}`);
            renderRepairResult(data);
            setStatus(apply ? 'Guardian moderation repair applied.' : 'Guardian moderation repair preview loaded.', 'success');
            if (apply) await loadSnapshot();
        } catch (err) {
            console.error('Guardian repair failed', err);
            setStatus(err.message || 'Guardian repair failed', 'error');
        } finally {
            state.requeueing = null;
            if (button) button.disabled = false;
        }
    }

    function bindEvents() {
        $('guardianOpsRefreshBtn')?.addEventListener('click', loadSnapshot);
        $('guardianRepairPreviewBtn')?.addEventListener('click', event => reconcileUser(false, event.currentTarget));
        $('guardianRepairApplyBtn')?.addEventListener('click', event => reconcileUser(true, event.currentTarget));
        $('logoutBtn')?.addEventListener('click', () => {
            if (typeof logout === 'function') logout();
            else {
                localStorage.removeItem('pzp_token');
                window.location.href = '/';
            }
        });

        document.querySelectorAll('[data-ops-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.filter = btn.dataset.opsFilter || 'attention';
                document.querySelectorAll('[data-ops-filter]').forEach(other => {
                    other.classList.toggle('active', other === btn);
                });
                if (state.snapshot) renderSnapshot(state.snapshot);
            });
        });

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-requeue-kind][data-requeue-id]');
            if (!button) return;
            requeue(button.dataset.requeueKind, button.dataset.requeueId, button);
        });

        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => btn.closest('.modal')?.classList.add('hidden'));
        });
    }

    async function initSession() {
        const token = localStorage.getItem('pzp_token');
        if (!token) {
            window.location.href = '/';
            return false;
        }

        try {
            const user = await apiVerifyToken();
            if (!user) throw new Error('Invalid token');
            AppState.currentUser = user;
            const userEl = $('currentUser');
            if (userEl) userEl.textContent = user.name || user.username || '';
            if (typeof Sidebar !== 'undefined') {
                Sidebar.render('#sidebarLinks');
                Sidebar.initUserCard();
                if (typeof canAccessPage === 'function' && !canAccessPage('/guardian-ops')) {
                    window.location.href = '/dashboard';
                    return false;
                }
            }
            return true;
        } catch (err) {
            console.error('Guardian ops auth failed', err);
            window.location.href = '/';
            return false;
        }
    }

    async function init() {
        bindEvents();
        const allowed = await initSession();
        if (!allowed) return;
        await loadSnapshot();
    }

    document.addEventListener('DOMContentLoaded', init);

    window.GuardianOpsPage = {
        init,
        renderSnapshot,
        _test: {
            escapeHtml,
            needsAttention,
            filteredEvents,
            state
        }
    };
})();
