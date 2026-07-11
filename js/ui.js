/**
 * ui.js - Утиліти + UI функції (dark mode, zoom, undo, swipe, minimap, tooltip, export тощо)
 */

// ==========================================
// GLOBAL UTILITIES (v40.2 — single source of truth)
// ==========================================
if (typeof escapeHtml !== 'function') {
    window.escapeHtml = function(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
}

// ==========================================
// SHARED ACTION HISTORY RENDERER
// One frontend contract for timeline, tasks, and Work Queue history rows.
// ==========================================
if (!window.ActionHistoryView) {
    window.ActionHistoryView = (() => {
        const GENERAL_LABELS = {
            create: 'Створено',
            edit: 'Змінено',
            delete: 'Видалено',
            permanent_delete: 'Видалено назавжди',
            shift: 'Перенесено',
            drag: 'Перенесено на таймлайні',
            resize: 'Змінено тривалість',
            undo_create: 'Скасовано створення',
            undo_delete: 'Скасовано видалення',
            undo_edit: 'Скасовано зміну',
            undo_shift: 'Скасовано перенос',
            undo_drag: 'Скасовано перенос',
            undo_resize: 'Скасовано зміну тривалості',
            booking_confirmed: 'Бронювання підтверджено',
            booking_shared_room_link_created: 'Звʼязок кімнат створено',
            booking_banquet_link_created: 'Банкетний звʼязок створено',
            booking_banquet_link_deleted: 'Банкетний звʼязок видалено',
            education_series_create: 'Серію занять створено',
            education_series_cancel: 'Серію занять скасовано',
            afisha_create: 'Афіша створена',
            afisha_edit: 'Афіша змінена',
            afisha_move: 'Афіша перенесена',
            afisha_delete: 'Афіша видалена',
            tasks_generated: 'Завдання створені',
            automation_triggered: 'Автоматизація',
            certificate_create: 'Сертифікат видано',
            certificate_batch: 'Пакет сертифікатів',
            certificate_used: 'Сертифікат використано',
            certificate_revoked: 'Сертифікат анульовано',
            certificate_blocked: 'Сертифікат заблоковано',
            certificate_deleted: 'Сертифікат видалено',
            certificate_delete: 'Сертифікат видалено',
            certificate_edit: 'Сертифікат змінено',
            certificate_expired: 'Сертифікат прострочено',
            task_completed: 'Задачу виконано',
            task_owner_reassigned: 'Відповідального змінено',
            task_rescheduled: 'Дедлайн перенесено',
            reply_expectation_cleared: 'Очікування відповіді очищено',
            reply_sla_snoozed: 'SLA перенесено',
            reply_owner_reassigned: 'Відповідального змінено',
            reply_escalated: 'Ескалацію створено або перевикористано',
            reply_escalation_closed: 'Ескалацію закрито'
        };

        const TASK_LABELS = {
            task_completed: 'Задачу виконано',
            task_owner_reassigned: 'Відповідального змінено',
            task_rescheduled: 'Дедлайн перенесено',
            task_observers_updated: 'Спостерігачів оновлено',
            task_scheduled: 'Задачу заплановано',
            task_schedule_moved: 'Розклад перенесено',
            task_schedule_manual_override: 'Ручний розклад',
            task_schedule_proposal_created: 'Пропозиція розкладу',
            task_slot_missed: 'Слот пропущено',
            task_discipline_penalty_applied: 'Штраф дисципліни застосовано'
        };

        const REPLY_LABELS = {
            reply_expectation_cleared: 'Очікування відповіді очищено',
            reply_sla_snoozed: 'SLA перенесено',
            reply_owner_reassigned: 'Відповідального змінено',
            reply_escalated: 'Ескалацію створено або перевикористано',
            reply_escalation_closed: 'Ескалацію закрито'
        };

        const SUMMARY_LABELS = {
            'Reply owner reassigned': 'Відповідального за відповідь змінено',
            'Reply SLA moved': 'SLA відповіді перенесено',
            'Reply expectation cleared': 'Очікування відповіді очищено',
            'Reply execution action recorded': 'Дію відповіді записано',
            'Task completed': 'Задачу виконано',
            'Task owner reassigned': 'Відповідального задачі змінено',
            'Task rescheduled': 'Дедлайн задачі перенесено',
            'Task execution action': 'Дія задачі',
            'Booking confirmed': 'Бронювання підтверджено'
        };

        const VALUE_LABELS = {
            todo: 'до виконання',
            done: 'виконано',
            cancelled: 'скасовано',
            in_progress: 'в роботі',
            waiting_reply: 'очікування відповіді',
            preliminary: 'попереднє',
            confirmed: 'підтверджено'
        };

        function esc(value) {
            const escape = window.escapeHtml || (str => String(str).replace(/[&<>"]/g, ch => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;'
            }[ch])));
            return escape(value == null ? '' : String(value));
        }

        function humanizeToken(value, fallback = '') {
            const text = String(value || '').trim();
            if (!text) return fallback;
            if (VALUE_LABELS[text]) return VALUE_LABELS[text];
            return text
                .replace(/[_-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function titleFor(actionType, kind = 'general') {
            const action = String(actionType || '').trim();
            if (!action) return kind === 'reply' ? 'Дія відповіді' : kind === 'task' ? 'Дія задачі' : 'Дія';
            if (kind === 'reply') return REPLY_LABELS[action] || humanizeToken(action, 'Дія відповіді');
            if (kind === 'task') return TASK_LABELS[action] || humanizeToken(action, 'Дія задачі');
            return GENERAL_LABELS[action] || humanizeToken(action, 'Дія');
        }

        function summaryLabel(summary) {
            const value = String(summary || '').trim();
            return SUMMARY_LABELS[value] || humanizeToken(value);
        }

        function formatDateTime(value) {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleString('uk-UA');
        }

        function valueLabel(value) {
            if (value === undefined || value === null || value === '') return 'немає';
            if (typeof value === 'boolean') return value ? 'так' : 'ні';
            if (typeof value === 'string') {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(value)) return formatDateTime(value);
                return humanizeToken(value, value);
            }
            if (typeof value === 'object') return JSON.stringify(value);
            return String(value);
        }

        function toneFor(actionType, kind = 'general') {
            const action = String(actionType || '');
            if (action.includes('delete') || action.includes('revoked') || action.includes('blocked')) return 'danger';
            if (action.includes('undo') || action.includes('snoozed') || action.includes('rescheduled') || action.includes('moved')) return 'warning';
            if (action.includes('create') || action.includes('completed') || action.includes('confirmed') || action.includes('closed') || action.includes('used')) return 'success';
            if (kind === 'reply' && action.includes('escalated')) return 'warning';
            return 'info';
        }

        function actorName(event = {}, kind = 'general') {
            if (kind === 'general') return event.user || event.username || event.actor?.name || event.createdBy || 'system';
            return event.actor?.name || event.actorName || (event.actor?.userId ? `Користувач #${event.actor.userId}` : 'Невідомий виконавець');
        }

        function eventTimestamp(event = {}) {
            return event.timestamp || event.createdAt || event.created_at || event.changedAt || '';
        }

        function generalDetails(item = {}) {
            const action = String(item.action || item.actionType || '');
            const data = item.data && typeof item.data === 'object' ? item.data : {};
            const isCert = action.startsWith('certificate_');
            const isAfisha = action.startsWith('afisha_');

            if (isCert) {
                if (action === 'certificate_batch') {
                    const codes = Array.isArray(data.codes) ? data.codes.join(', ') : '';
                    return `${data.quantity || 0} шт.${codes ? `, коди: ${codes}` : ''}`;
                }
                return [data.certCode, data.displayValue, data.typeText ? `(${data.typeText})` : ''].filter(Boolean).join(' ');
            }

            if (action === 'afisha_move') {
                return `${data.title || ''}: ${data.from || ''} -> ${data.to || ''}`.trim();
            }

            if (isAfisha) {
                const meta = [data.type || 'event', data.duration ? `${data.duration} хв` : ''].filter(Boolean).join(', ');
                const schedule = [data.date, data.time].filter(Boolean).join(' ');
                return `${data.title || ''}${meta ? ` (${meta})` : ''}${schedule ? `, ${schedule}` : ''}`.trim();
            }

            if (action === 'tasks_generated') {
                return `${data.title || ''}${data.count !== undefined ? `, ${data.count} завдань` : ''}`.trim();
            }

            if (action === 'automation_triggered') {
                return `${data.rule_name || ''}${data.booking_id ? `, бронювання ${data.booking_id}` : ''}`.trim();
            }

            const subject = data.label || data.programCode || data.title || data.name || data.bookingId || data.id || '';
            const room = data.room || data.lineName || data.lineId || '';
            const schedule = [data.date, data.time].filter(Boolean).join(' ');
            return [subject, room, schedule ? `(${schedule})` : ''].filter(Boolean).join(' ');
        }

        function taskChange(event = {}) {
            const oldValue = event.oldValue || {};
            const newValue = event.newValue || {};
            switch (event.actionType) {
                case 'task_completed':
                    return `статус ${valueLabel(oldValue.status)} -> ${valueLabel(newValue.status)}`;
                case 'task_owner_reassigned':
                    return `${valueLabel(oldValue.assignedTo || oldValue.ownerUserId)} -> ${valueLabel(newValue.assignedTo || newValue.ownerUserId)}`;
                case 'task_rescheduled':
                    return `${valueLabel(oldValue.deadline || oldValue.date)} -> ${valueLabel(newValue.deadline || newValue.date)}`;
                default:
                    if (oldValue.status || newValue.status) return `${valueLabel(oldValue.status)} -> ${valueLabel(newValue.status)}`;
                    if (oldValue.deadline !== undefined || newValue.deadline !== undefined) return `${valueLabel(oldValue.deadline)} -> ${valueLabel(newValue.deadline)}`;
                    if (oldValue.scheduledStartAt !== undefined || newValue.scheduledStartAt !== undefined) return `${valueLabel(oldValue.scheduledStartAt || oldValue.scheduleSlot)} -> ${valueLabel(newValue.scheduledStartAt || newValue.scheduleSlot)}`;
                    return summaryLabel(event.summary);
            }
        }

        function replyChange(event = {}) {
            const oldValue = event.oldValue || {};
            const newValue = event.newValue || {};
            switch (event.actionType) {
                case 'reply_owner_reassigned':
                    return `${valueLabel(oldValue.replyOwner || oldValue.replyOwnerUserId)} -> ${valueLabel(newValue.replyOwner || newValue.replyOwnerUserId)}`;
                case 'reply_sla_snoozed':
                    return `${valueLabel(oldValue.replySlaAt)} -> ${valueLabel(newValue.replySlaAt)}`;
                case 'reply_expectation_cleared':
                    return `очікування відповіді ${valueLabel(oldValue.replyExpected)} -> ${valueLabel(newValue.replyExpected)}`;
                case 'reply_escalated':
                case 'reply_escalation_closed':
                    return `задача ${valueLabel(oldValue.replyEscalationTaskId)} -> ${valueLabel(newValue.replyEscalationTaskId)}`;
                default:
                    return summaryLabel(event.summary);
            }
        }

        function normalizeEvent(event = {}, options = {}) {
            const kind = options.kind || 'general';
            const actionType = event.actionType || event.action || '';
            const change = kind === 'task' ? taskChange(event) : kind === 'reply' ? replyChange(event) : generalDetails(event);
            return {
                title: titleFor(actionType, kind),
                summary: kind === 'general' ? '' : summaryLabel(event.summary),
                actor: actorName(event, kind),
                timestamp: formatDateTime(eventTimestamp(event)),
                details: change,
                tone: toneFor(actionType, kind)
            };
        }

        function renderRow(event, options = {}) {
            const normalized = options.normalize ? options.normalize(event) : normalizeEvent(event, options);
            const rowClass = ['action-history-row', `action-history-row--${normalized.tone || 'info'}`, options.rowClass]
                .filter(Boolean)
                .join(' ');
            const meta = [normalized.actor, normalized.timestamp].filter(Boolean).join(' · ');
            return `
                <li class="${esc(rowClass)}">
                    <div class="action-history-row-main">
                        <strong>${esc(normalized.title)}</strong>
                        ${normalized.summary ? `<span>${esc(normalized.summary)}</span>` : ''}
                    </div>
                    ${meta ? `<p class="action-history-row-meta">${esc(meta)}</p>` : ''}
                    ${normalized.details ? `<code class="action-history-row-detail">${esc(normalized.details)}</code>` : ''}
                </li>
            `;
        }

        function renderState(message, options = {}) {
            const tone = options.tone ? ` action-history-state--${options.tone}` : '';
            const className = options.className ? ` ${options.className}` : '';
            const role = options.role ? ` role="${esc(options.role)}"` : '';
            return `<p class="action-history-state${tone}${className}"${role}>${esc(message)}</p>`;
        }

        function renderList(events = [], options = {}) {
            if (!events.length) {
                return renderState(options.emptyMessage || 'Історії дій ще немає.', {
                    className: options.stateClass || '',
                    tone: options.emptyTone || ''
                });
            }
            const listClass = ['action-history-list', options.listClass].filter(Boolean).join(' ');
            return `<ol class="${esc(listClass)}">${events.map(event => renderRow(event, options)).join('')}</ol>`;
        }

        return {
            formatDateTime,
            generalDetails,
            normalizeEvent,
            renderList,
            renderRow,
            renderState,
            summaryLabel,
            titleFor,
            valueLabel
        };
    })();
}

// ==========================================
// MODAL LAYER GUARD
// Keeps page-local dialogs above assistant/drawer surfaces without one-off z-index fixes.
// ==========================================
if (!window.ModalLayer) {
    window.ModalLayer = (() => {
        const BASE = 30000;
        const CONFIRM = 30100;
        const SELECTOR = [
            '.modal:not(.hidden)',
            '.sch-modal-overlay.visible',
            '.lead-modal-overlay.active',
            '.chat-modal-overlay',
            '.content-modal-overlay.open',
            '.smart-menu-modal-overlay',
            '.price-confirm-overlay',
            '.grad-modal',
            '.achievement-overlay-visible',
            '.confirm-overlay'
        ].join(',');
        let scheduled = false;
        let observer = null;

        function isVisible(el) {
            if (!el || !el.isConnected) return false;
            if (el.classList.contains('hidden')) return false;
            const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (!cs) return true;
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) !== 0;
        }

        function isConfirmLayer(el) {
            return el.classList.contains('confirm-overlay') || el.id === 'confirmModal' || el.id === 'noteModal';
        }

        function elevate(root = document) {
            const scope = root.querySelectorAll ? root : document;
            const active = Array.from(scope.querySelectorAll(SELECTOR)).filter(isVisible);
            active.forEach((el, index) => {
                const next = String((isConfirmLayer(el) ? CONFIRM : BASE) + index);
                if (el.style.zIndex !== next) el.style.zIndex = next;
            });
            return active.length;
        }

        function schedule() {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                elevate();
            });
        }

        function ensureTopLayer(el, options = {}) {
            if (!el) return null;
            const next = String(options.confirm ? CONFIRM : BASE);
            if (el.style.zIndex !== next) el.style.zIndex = next;
            schedule();
            return el;
        }

        function install() {
            if (observer || !document.body || !window.MutationObserver) return;
            observer = new MutationObserver(schedule);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'open', 'hidden', 'aria-hidden']
            });
            schedule();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', install, { once: true });
        } else {
            install();
        }

        return { elevate, ensureTopLayer, install };
    })();
}

// ==========================================
// EXPLAINABILITY KIT v1
// ==========================================
if (!window.Explainability) {
    window.Explainability = (() => {
        function esc(value) {
            return (window.escapeHtml || function(str) {
                if (!str) return '';
                return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            })(value);
        }

        function activeFilters(filters) {
            return (filters || []).filter(item => item && item.value !== undefined && item.value !== null && String(item.value).trim() !== '');
        }

        function renderFilterSummary(filters, options = {}) {
            const active = activeFilters(filters);
            if (!active.length && !options.note) return '';
            const label = options.label || 'Активно';
            const chips = active.map(item => {
                const text = item.label ? `${item.label}: ${item.value}` : item.value;
                return `<span class="explain-chip">${esc(text)}</span>`;
            }).join('');
            const note = options.note ? `<span class="explain-chip">${esc(options.note)}</span>` : '';
            const clear = options.clearAction
                ? `<button type="button" class="explain-clear-btn" data-explain-clear="${esc(options.clearAction)}">${esc(options.clearLabel || 'Очистити')}</button>`
                : '';
            return `
                <div class="explain-filter-summary" role="status" aria-live="polite">
                    <div class="explain-filter-main">
                        <span class="explain-filter-label">${esc(label)}</span>
                        ${chips}${note}
                    </div>
                    ${clear}
                </div>
            `;
        }

        function renderEmptyState(options = {}) {
            const icon = options.icon ? `<span class="explain-empty-icon" aria-hidden="true">${esc(options.icon)}</span>` : '';
            const title = options.title || 'Немає даних';
            const message = options.message || '';
            const action = options.clearAction
                ? `<div class="explain-empty-actions"><button type="button" class="explain-clear-btn" data-explain-clear="${esc(options.clearAction)}">${esc(options.clearLabel || 'Очистити фільтри')}</button></div>`
                : '';
            return `
                <div class="explain-empty">
                    ${icon}
                    <div class="explain-empty-title">${esc(title)}</div>
                    ${message ? `<div class="explain-empty-message">${esc(message)}</div>` : ''}
                    ${action}
                </div>
            `;
        }

        function setRegion(elementOrId, html) {
            const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
            if (!el) return;
            el.innerHTML = html || '';
            el.hidden = !html;
        }

        return { activeFilters, renderFilterSummary, renderEmptyState, setRegion };
    })();
}

// ==========================================
// CRM SYSTEM UI STATE + API ERROR KIT
// ==========================================
if (!window.CrmApiErrors) {
    window.CrmApiErrors = (() => {
        function normalize(payload = {}, fallback = 'Помилка запиту') {
            const source = payload && typeof payload === 'object' ? payload : {};
            const message = source.error || source.message || fallback;
            const requestId = source.requestId || source.request_id || source.traceId || source.trace_id || '';
            return {
                message: String(message || fallback),
                requestId: requestId ? String(requestId) : '',
                status: source.status || null,
                payload: source
            };
        }

        function format(error, fallback = 'Помилка запиту') {
            if (error instanceof Error) {
                const requestId = error.requestId || error.request_id || '';
                return `${error.message || fallback}${requestId ? ` · код: ${requestId}` : ''}`;
            }
            const normalized = normalize(error, fallback);
            return `${normalized.message}${normalized.requestId ? ` · код: ${normalized.requestId}` : ''}`;
        }

        function toError(payload = {}, fallback = 'Помилка запиту') {
            const normalized = normalize(payload, fallback);
            const error = new Error(normalized.message);
            error.requestId = normalized.requestId;
            error.status = normalized.status;
            error.payload = normalized.payload;
            return error;
        }

        async function fromResponse(response, fallback = 'Помилка запиту') {
            const payload = await response.json().catch(() => ({}));
            return toError({ ...payload, status: response.status }, fallback);
        }

        return { normalize, format, toError, fromResponse };
    })();
}

if (!window.CrmUiState) {
    window.CrmUiState = (() => {
        const esc = window.escapeHtml || (value => String(value ?? ''));

        function renderLoading(message = 'Завантаження...') {
            return `<div class="empty-state crm-ui-state crm-ui-state--loading" role="status" aria-live="polite">
                <div class="skeleton skeleton-text short"></div>
                <div class="empty-state-text">${esc(message)}</div>
            </div>`;
        }

        function renderError(error, options = {}) {
            const message = window.CrmApiErrors?.format?.(error, options.message || 'Не вдалося виконати дію') || String(error || options.message || 'Не вдалося виконати дію');
            const retry = options.retryAction
                ? `<button type="button" class="btn-secondary crm-ui-state-retry" data-crm-ui-retry="${esc(options.retryAction)}">${esc(options.retryLabel || 'Спробувати ще раз')}</button>`
                : '';
            return `<div class="empty-state crm-ui-state crm-ui-state--error" role="alert">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">${esc(options.title || 'Є помилка')}</div>
                <div class="empty-state-hint">${esc(message)}</div>
                ${retry}
            </div>`;
        }

        function renderEmpty(options = {}) {
            if (window.Explainability?.renderEmptyState) {
                return window.Explainability.renderEmptyState({
                    icon: options.icon || '∅',
                    title: options.title || 'Немає даних',
                    message: options.message || '',
                    clearAction: options.clearAction,
                    clearLabel: options.clearLabel
                });
            }
            return `<div class="empty-state crm-ui-state crm-ui-state--empty">
                <div class="empty-state-text">${esc(options.title || 'Немає даних')}</div>
                ${options.message ? `<div class="empty-state-hint">${esc(options.message)}</div>` : ''}
            </div>`;
        }

        function apply(target, html) {
            const el = typeof target === 'string' ? document.getElementById(target) : target;
            if (!el) return;
            el.innerHTML = html || '';
        }

        return { renderLoading, renderError, renderEmpty, apply };
    })();
}

// ==========================================
// LEGACY LAYOUT CONTROLS REPAIR
// Gives old "Рухати / Сховати / Скинути" block controls one safe owner.
// ==========================================
if (!window.CrmLayoutControls) {
    window.CrmLayoutControls = (() => {
        const STORAGE_PREFIX = 'eg_crm_layout_controls_v1:';
        const UNDO_LIMIT = 30;
        const TEXT_TO_ACTION = new Map([
            ['Рухати', 'move'],
            ['Сховати', 'hide'],
            ['Скинути', 'reset-item'],
            ['Скинути вигляд', 'reset-all']
        ]);
        const undoStack = [];
        const redoStack = [];
        const managedByKey = new Map();
        let observer = null;
        let scanScheduled = false;
        let keydownBound = false;
        let dragState = null;

        function pageStorageKey() {
            const path = `${window.location.pathname || '/'}${window.location.search || ''}`;
            return STORAGE_PREFIX + path;
        }

        function readStore() {
            try {
                const raw = localStorage.getItem(pageStorageKey());
                const parsed = raw ? JSON.parse(raw) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        }

        function writeStore(store) {
            try {
                const clean = {};
                Object.entries(store || {}).forEach(([key, state]) => {
                    const next = normalizeState(state);
                    if (next.x || next.y || next.hidden) clean[key] = next;
                });
                if (Object.keys(clean).length) localStorage.setItem(pageStorageKey(), JSON.stringify(clean));
                else localStorage.removeItem(pageStorageKey());
            } catch {
                // Layout persistence is a local convenience; broken storage must not break the page.
            }
        }

        function normalizeText(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function cssEscape(value) {
            const text = String(value || '');
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
            return text.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char.codePointAt(0).toString(16)} `);
        }

        function actionOf(button) {
            if (!button || button.tagName !== 'BUTTON') return '';
            const explicit = normalizeText(button.dataset.crmLayoutAction || '');
            if (explicit && ['move', 'hide', 'reset-item', 'reset-all'].includes(explicit)) return explicit;
            return TEXT_TO_ACTION.get(normalizeText(button.textContent)) || '';
        }

        function isEditableTarget(target) {
            return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
        }

        function normalizeState(state = {}) {
            return {
                x: Math.round(Number(state.x || 0)),
                y: Math.round(Number(state.y || 0)),
                hidden: state.hidden === true
            };
        }

        function stateEquals(a, b) {
            const left = normalizeState(a);
            const right = normalizeState(b);
            return left.x === right.x && left.y === right.y && left.hidden === right.hidden;
        }

        function cssPathFor(el) {
            const parts = [];
            let node = el;
            while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
                const name = node.tagName.toLowerCase();
                if (node.id) {
                    parts.unshift(`#${cssEscape(node.id)}`);
                    break;
                }
                const parent = node.parentElement;
                if (!parent) break;
                const siblings = Array.from(parent.children).filter(item => item.tagName === node.tagName);
                const index = siblings.indexOf(node) + 1;
                parts.unshift(`${name}:nth-of-type(${Math.max(1, index)})`);
                node = parent;
            }
            return parts.join('>');
        }

        function shortLabelFor(el) {
            const labelSource = el.querySelector('h1,h2,h3,h4,strong,[aria-label]') || el;
            const label = labelSource.getAttribute?.('aria-label') || labelSource.textContent || '';
            return normalizeText(label).slice(0, 48);
        }

        function keyFor(el) {
            if (!el) return '';
            const existing = el.dataset.crmLayoutKey;
            if (existing) return existing;
            const explicit = el.getAttribute('data-layout-id') || el.getAttribute('data-widget-id') || el.getAttribute('data-board-item-id') || el.id || '';
            const key = explicit
                ? `explicit:${explicit}`
                : `path:${cssPathFor(el)}:${shortLabelFor(el)}`;
            el.dataset.crmLayoutKey = key;
            return key;
        }

        function actionsIn(root) {
            const actions = new Set();
            if (!root || !root.querySelectorAll) return actions;
            root.querySelectorAll('button').forEach(button => {
                const action = actionOf(button);
                if (action) actions.add(action);
            });
            return actions;
        }

        function findControlGroup(button) {
            let node = button.parentElement;
            while (node && node !== document.body) {
                const actions = actionsIn(node);
                if (actions.has('move') && (actions.has('hide') || actions.has('reset-item'))) return node;
                if (actions.has('reset-all') && normalizeText(node.textContent).includes('Вигляд блоків')) return node;
                node = node.parentElement;
            }
            return button.parentElement;
        }

        function isLikelyBlock(el) {
            if (!el || el === document.body || el === document.documentElement) return false;
            if (el.matches?.('button, input, textarea, select, option, script, style, link')) return false;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width < 120 || rect.height < 44) return false;
            const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
            if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
            const text = normalizeText(el.textContent || '');
            const actionOnly = Array.from(TEXT_TO_ACTION.keys()).every(label => text === label || text.replace(label, '').trim() === '');
            return !actionOnly;
        }

        function findTarget(button) {
            const explicitId = button.getAttribute('aria-controls') || button.dataset.target || button.dataset.layoutTarget || '';
            if (explicitId) {
                const explicit = document.getElementById(explicitId) || document.querySelector(`[data-layout-id="${cssEscape(explicitId)}"]`);
                if (isLikelyBlock(explicit)) return explicit;
            }

            const group = findControlGroup(button);
            let sibling = group?.nextElementSibling || null;
            while (sibling) {
                if (isLikelyBlock(sibling)) return sibling;
                sibling = sibling.nextElementSibling;
            }

            let node = group;
            while (node && node !== document.body) {
                if (isLikelyBlock(node) && node.getBoundingClientRect().height > ((group?.getBoundingClientRect?.().height || 0) + 28)) {
                    return node;
                }
                node = node.parentElement;
            }

            return button.closest('section, article, aside, .workspace-module, .dashboard-board-item, .crm-card, .panel, .card, .modal-content, .main-content > div');
        }

        function applyState(target, state) {
            if (!target) return;
            const next = normalizeState(state);
            const key = keyFor(target);
            managedByKey.set(key, target);
            target.classList.add('crm-layout-block-managed');
            target.classList.toggle('is-crm-layout-hidden', next.hidden);
            target.classList.toggle('is-crm-layout-offset', !!(next.x || next.y));
            target.style.setProperty('--crm-layout-x', `${next.x}px`);
            target.style.setProperty('--crm-layout-y', `${next.y}px`);
            if (!target.dataset.crmLayoutBaseTransform) {
                target.dataset.crmLayoutBaseTransform = target.style.transform || '';
            }
        }

        function stateFor(target) {
            if (!target) return normalizeState();
            const key = keyFor(target);
            const stored = readStore()[key];
            if (stored) return normalizeState(stored);
            const x = parseFloat(target.style.getPropertyValue('--crm-layout-x') || target.dataset.crmLayoutX || '0') || 0;
            const y = parseFloat(target.style.getPropertyValue('--crm-layout-y') || target.dataset.crmLayoutY || '0') || 0;
            return normalizeState({ x, y, hidden: target.classList.contains('is-crm-layout-hidden') });
        }

        function saveState(target, state) {
            const key = keyFor(target);
            const store = readStore();
            const next = normalizeState(state);
            if (next.x || next.y || next.hidden) store[key] = next;
            else delete store[key];
            writeStore(store);
        }

        function pushUndo(entry) {
            undoStack.push(entry);
            if (undoStack.length > UNDO_LIMIT) undoStack.shift();
            redoStack.length = 0;
        }

        function applyEntryState(entry, direction) {
            if (!entry) return false;
            if (entry.type === 'all') {
                const stateMap = direction === 'undo' ? entry.before : entry.after;
                writeStore(stateMap || {});
                scan(document, { applyStored: true });
                return true;
            }
            const target = entry.target && entry.target.isConnected
                ? entry.target
                : managedByKey.get(entry.key);
            if (!target) return false;
            const next = direction === 'undo' ? entry.before : entry.after;
            applyState(target, next);
            saveState(target, next);
            return true;
        }

        function undo() {
            const entry = undoStack.pop();
            if (!entry) return false;
            if (applyEntryState(entry, 'undo')) {
                redoStack.push(entry);
                if (redoStack.length > UNDO_LIMIT) redoStack.shift();
                notify('Зміну вигляду скасовано', 'success');
                return true;
            }
            return false;
        }

        function redo() {
            const entry = redoStack.pop();
            if (!entry) return false;
            if (applyEntryState(entry, 'redo')) {
                undoStack.push(entry);
                if (undoStack.length > UNDO_LIMIT) undoStack.shift();
                notify('Зміну вигляду повернуто', 'success');
                return true;
            }
            return false;
        }

        function notify(message, type = 'info') {
            if (typeof window.showNotification === 'function') window.showNotification(message, type);
            else if (typeof window.showToast === 'function') window.showToast(message, type);
        }

        function hideTarget(button) {
            const target = findTarget(button);
            if (!target) return;
            const before = stateFor(target);
            const after = normalizeState({ ...before, hidden: true });
            if (stateEquals(before, after)) return;
            applyState(target, after);
            saveState(target, after);
            pushUndo({ type: 'one', key: keyFor(target), target, before, after });
            notify('Блок сховано. Ctrl+Z поверне його.', 'success');
        }

        function resetTarget(button) {
            const target = findTarget(button);
            if (!target) return;
            const before = stateFor(target);
            const after = normalizeState();
            if (stateEquals(before, after)) return;
            applyState(target, after);
            saveState(target, after);
            pushUndo({ type: 'one', key: keyFor(target), target, before, after });
            notify('Блок скинуто', 'success');
        }

        function resetAll() {
            const before = readStore();
            const hasStored = Object.keys(before).length > 0;
            const liveTargets = Array.from(managedByKey.values()).filter(Boolean).filter(el => el.isConnected);
            liveTargets.forEach(target => {
                const state = stateFor(target);
                if (state.x || state.y || state.hidden) {
                    before[keyFor(target)] = state;
                }
            });
            if (!hasStored && !Object.keys(before).length) return;
            writeStore({});
            liveTargets.forEach(target => applyState(target, normalizeState()));
            pushUndo({ type: 'all', before, after: {} });
            notify('Вигляд блоків скинуто', 'success');
        }

        function beginMove(event, button) {
            if (event.button !== 0 || isEditableTarget(event.target)) return;
            const target = findTarget(button);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            const before = stateFor(target);
            const key = keyFor(target);
            applyState(target, before);
            dragState = {
                pointerId: event.pointerId,
                button,
                target,
                key,
                before,
                latest: before,
                startX: event.clientX,
                startY: event.clientY,
                moved: false
            };
            button.classList.add('is-crm-layout-active');
            target.classList.add('is-crm-layout-moving');
            document.body.classList.add('crm-layout-dragging');
            document.addEventListener('pointermove', moveDrag, true);
            document.addEventListener('pointerup', endDrag, true);
            document.addEventListener('pointercancel', cancelDrag, true);
        }

        function moveDrag(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            event.preventDefault();
            const dx = event.clientX - dragState.startX;
            const dy = event.clientY - dragState.startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true;
            const next = normalizeState({
                ...dragState.before,
                x: dragState.before.x + dx,
                y: dragState.before.y + dy
            });
            dragState.latest = next;
            applyState(dragState.target, next);
        }

        function cleanupDrag() {
            if (dragState?.button) dragState.button.classList.remove('is-crm-layout-active');
            if (dragState?.target) dragState.target.classList.remove('is-crm-layout-moving');
            document.body.classList.remove('crm-layout-dragging');
            document.removeEventListener('pointermove', moveDrag, true);
            document.removeEventListener('pointerup', endDrag, true);
            document.removeEventListener('pointercancel', cancelDrag, true);
        }

        function endDrag(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            const entry = {
                type: 'one',
                key: dragState.key,
                target: dragState.target,
                before: dragState.before,
                after: dragState.latest
            };
            const moved = dragState.moved && !stateEquals(entry.before, entry.after);
            if (moved) {
                saveState(entry.target, entry.after);
                pushUndo(entry);
            } else {
                applyState(entry.target, entry.before);
            }
            cleanupDrag();
            dragState = null;
        }

        function cancelDrag(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            applyState(dragState.target, dragState.before);
            cleanupDrag();
            dragState = null;
        }

        function handleButtonEvent(event) {
            const button = event.target?.closest?.('button.crm-layout-control-button');
            if (!button) return;
            const action = actionOf(button);
            if (event.type === 'pointerdown' && action === 'move') {
                beginMove(event, button);
                return;
            }
            if (event.type !== 'click') return;
            event.preventDefault();
            event.stopPropagation();
            if (action === 'hide') hideTarget(button);
            if (action === 'reset-item') resetTarget(button);
            if (action === 'reset-all') resetAll();
        }

        function handleKeydown(event) {
            const mod = event.ctrlKey || event.metaKey;
            if (!mod || isEditableTarget(event.target)) return;
            const key = String(event.key || '').toLowerCase();
            const wantsUndo = key === 'z' && !event.shiftKey;
            const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
            if (!wantsUndo && !wantsRedo) return;
            const handled = wantsUndo ? undo() : redo();
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        function shouldOwnButton(button, action) {
            if (!button || !action || button.dataset.crmLayoutSkip === 'true') return false;
            if (button.closest('[data-crm-layout-skip="true"]')) return false;
            if (action === 'reset-all') {
                const text = normalizeText(button.closest('section, article, div')?.textContent || document.body?.textContent || '');
                return text.includes('Вигляд блоків') || document.querySelectorAll('.crm-layout-control-button[data-crm-layout-action="move"]').length > 0;
            }
            const group = findControlGroup(button);
            const actions = actionsIn(group);
            return actions.has('move') && (actions.has('hide') || actions.has('reset-item'));
        }

        function enhanceButton(button) {
            const action = actionOf(button);
            if (!shouldOwnButton(button, action)) return;
            button.dataset.crmLayoutAction = action;
            button.classList.add('crm-layout-control-button', `crm-layout-control-${action}`);
            const group = findControlGroup(button);
            if (group) group.classList.add('crm-layout-control-strip');
            if (action === 'move') {
                button.setAttribute('title', 'Затисніть і тягніть блок. Ctrl+Z скасовує рух.');
                button.setAttribute('aria-label', 'Рухати блок');
            } else if (action === 'hide') {
                button.setAttribute('title', 'Сховати блок. Ctrl+Z поверне його.');
            } else if (action === 'reset-item') {
                button.setAttribute('title', 'Скинути позицію цього блоку');
            } else if (action === 'reset-all') {
                button.setAttribute('title', 'Скинути вигляд усіх блоків');
            }
            const target = action === 'reset-all' ? null : findTarget(button);
            if (target) {
                applyState(target, stateFor(target));
            }
        }

        function scan(root = document, options = {}) {
            const scope = root.querySelectorAll ? root : document;
            scope.querySelectorAll('button').forEach(enhanceButton);
            if (options.applyStored) {
                const store = readStore();
                managedByKey.forEach((target, key) => {
                    if (target?.isConnected) applyState(target, store[key] || normalizeState());
                });
            }
        }

        function scheduleScan() {
            if (scanScheduled) return;
            scanScheduled = true;
            requestAnimationFrame(() => {
                scanScheduled = false;
                scan(document);
            });
        }

        function init() {
            scan(document);
            document.addEventListener('pointerdown', handleButtonEvent, true);
            document.addEventListener('click', handleButtonEvent, true);
            if (!keydownBound) {
                keydownBound = true;
                document.addEventListener('keydown', handleKeydown, true);
            }
            if (!observer && window.MutationObserver && document.body) {
                observer = new MutationObserver(scheduleScan);
                observer.observe(document.body, { childList: true, subtree: true });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }

        return { scan, undo, redo, resetAll };
    })();
}

// ==========================================
// STAFF ACCOUNT BADGE (v39.8.0)
// ==========================================
let _staffLinkCache = null;
async function _loadStaffLinks() {
    if (_staffLinkCache) return _staffLinkCache;
    try {
        const token = localStorage.getItem('pzp_token');
        if (!token) return [];
        const res = await fetch('/api/staff/link-status', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return [];
        const data = await res.json();
        _staffLinkCache = Array.isArray(data) ? data : (data.data || []);
        return _staffLinkCache;
    } catch { return []; }
}

function staffAccountBadgeIconSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
}

function staffAccountBadge(staffId, opts = {}) {
    if (!_staffLinkCache) return '';
    const link = _staffLinkCache.find(r => Number(r.id) === Number(staffId));
    if (!link) return '';
    const { compact = false } = opts;
    if (link.user_id) {
        const userId = Number(link.user_id);
        if (!Number.isInteger(userId) || userId <= 0) return compact ? '' : '<span class="staff-crm-badge no-account" title="Немає кабінету">—</span>';
        const username = window.escapeHtml ? window.escapeHtml(link.username || '') : String(link.username || '');
        const label = username ? `Кабінет: ${username}` : 'Відкрити робочий профіль';
        const profileHandler = `openStaffProfile(${userId})`;
        const icon = staffAccountBadgeIconSvg();
        if (compact) {
            return `<button type="button" class="staff-crm-badge staff-crm-badge--profile has-account" title="${label}" aria-label="${label}" onclick="event.stopPropagation();${profileHandler}">${icon}</button>`;
        }
        return `<button type="button" class="staff-crm-badge staff-crm-badge--profile has-account" onclick="event.stopPropagation();${profileHandler}" title="${label}" aria-label="${label}">${icon}<span>${username}</span></button>`;
    }
    if (link.is_freelance) return compact ? '' : '<span class="staff-crm-badge freelance">~</span>';
    return compact ? '' : '<span class="staff-crm-badge no-account" title="Немає кабінету">—</span>';
}

function openSafeNewTab(url) {
    if (!url) return null;
    const win = window.open(String(url), '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
    return win;
}

function isTouchDownloadDevice() {
    const ua = navigator.userAgent || '';
    const mobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
    const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    return mobileUa || coarsePointer;
}

function openTouchDownloadWindow(title = 'Завантаження') {
    if (!isTouchDownloadDevice()) return null;
    try {
        const win = window.open('', '_blank');
        if (!win) return null;
        win.opener = null;
        const safeTitle = window.escapeHtml ? window.escapeHtml(title) : String(title).replace(/[<>&"]/g, '');
        win.document.write(`<!doctype html><html lang="uk"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;padding:20px;background:#07111f;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}p{font-size:15px;line-height:1.45;color:#cbd5e1}</style></head><body><p>Готуємо файл...</p></body></html>`);
        win.document.close();
        return win;
    } catch (_) {
        return null;
    }
}

function closeTouchDownloadWindow(touchWindow) {
    try {
        if (touchWindow && !touchWindow.closed) touchWindow.close();
    } catch (_) {}
}

function finishBlobDownload(blob, filename, options = {}) {
    if (!blob) return null;
    const name = filename || 'download';
    const url = URL.createObjectURL(blob);
    const touchWindow = options.touchWindow || null;
    const successMessage = options.successMessage || 'Файл підготовлено';
    const safeName = window.escapeHtml ? window.escapeHtml(name) : String(name).replace(/[<>&"]/g, '');
    const mime = String(blob.type || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isPdf = mime.includes('pdf') || /\.pdf$/i.test(name);

    if (touchWindow && !touchWindow.closed) {
        const preview = isImage
            ? `<img src="${url}" alt="${safeName}" style="display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35)">`
            : isPdf
                ? `<iframe src="${url}" title="${safeName}" style="display:block;width:100%;height:min(78dvh,760px);border:0;border-radius:14px;background:#fff"></iframe>`
                : `<p>Файл готовий. Якщо Safari не почне завантаження автоматично, натисніть кнопку нижче.</p>`;
        touchWindow.document.open();
        touchWindow.document.write(`<!doctype html><html lang="uk"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeName}</title><style>body{margin:0;padding:16px;background:#07111f;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.eg-download-action{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:14px 0 10px;padding:10px 16px;border-radius:12px;background:#10b981;color:#02140e;text-decoration:none;font-weight:900}p{font-size:15px;line-height:1.45;color:#cbd5e1}</style></head><body>${preview}<a class="eg-download-action" href="${url}" download="${safeName}">Відкрити / зберегти файл</a><p>На iPhone відкрийте файл або скористайтесь Share/Save у браузері.</p></body></html>`);
        touchWindow.document.close();
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        if (typeof showNotification === 'function') showNotification(successMessage, 'success');
        return url;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof showNotification === 'function') showNotification(successMessage, 'success');
    return url;
}

function openAsyncNavigationWindow(title = 'Відкриття') {
    if (!isTouchDownloadDevice()) return null;
    return openTouchDownloadWindow(title);
}

function finishAsyncNavigationWindow(asyncWindow, url) {
    if (!url) return null;
    if (asyncWindow && !asyncWindow.closed) {
        asyncWindow.location.href = String(url);
        return asyncWindow;
    }
    return openSafeNewTab(url);
}

function openStaffProfile(identifier) {
    if (identifier === null || identifier === undefined || identifier === '') return;
    const raw = String(identifier).trim();
    const userId = Number(raw);
    if (Number.isInteger(userId) && userId > 0) {
        openSafeNewTab('/profile?id=' + encodeURIComponent(String(userId)));
        return;
    }
    const link = Array.isArray(_staffLinkCache)
        ? _staffLinkCache.find(item => String(item.username || '').toLowerCase() === raw.toLowerCase())
        : null;
    const linkedUserId = Number(link?.user_id);
    if (Number.isInteger(linkedUserId) && linkedUserId > 0) {
        openSafeNewTab('/profile?id=' + encodeURIComponent(String(linkedUserId)));
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification('Не вдалося знайти робочий профіль цього співробітника', 'warning');
    }
}

window.openSafeNewTab = openSafeNewTab;
window.isTouchDownloadDevice = isTouchDownloadDevice;
window.openTouchDownloadWindow = openTouchDownloadWindow;
window.closeTouchDownloadWindow = closeTouchDownloadWindow;
window.finishBlobDownload = finishBlobDownload;
window.openAsyncNavigationWindow = openAsyncNavigationWindow;
window.finishAsyncNavigationWindow = finishAsyncNavigationWindow;

// ==========================================
// ДОПОМІЖНІ УТИЛІТИ
// ==========================================

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// v30.7: Human-friendly Ukrainian date format (e.g. "14 бер")
const MONTHS_SHORT_UKR = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
function formatDateUkr(date) {
    const day = date.getDate();
    const month = MONTHS_SHORT_UKR[date.getMonth()];
    return `${day} ${month}`;
}

function timeToMinutes(time) {
    if (!time || typeof time !== 'string' || !time.includes(':')) return 0;
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
}

function minutesToTime(totalMinutes) {
    if (isNaN(totalMinutes) || totalMinutes === null || totalMinutes === undefined) return '00:00';
    const clamped = Math.max(0, Math.min(1439, totalMinutes));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesToTime(time, minutes) {
    let total = timeToMinutes(time) + minutes;
    if (total < 0) total = 0;
    if (total > 1439) total = 1439;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ==========================================
// FOCUS TRAP FOR MODALS (#21)
// ==========================================

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Stack for nested modals (e.g. confirmModal on top of bookingModal)
const _focusTrapStack = [];

const UnsafeDismissGuard = (() => {
    const FIELD_SELECTOR = [
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[contenteditable="true"]'
    ].join(', ');

    function getFieldValue(el) {
        if (!el) return '';
        if (el.matches?.('input[type="checkbox"],input[type="radio"]')) return el.checked ? '1' : '0';
        if (el.getAttribute?.('contenteditable') === 'true') return el.textContent || '';
        return el.value || '';
    }

    function snapshot(surface, selector = FIELD_SELECTOR) {
        if (!surface) return '';
        return Array.from(surface.querySelectorAll(selector))
            .filter(el => !el.disabled)
            .map(el => `${el.id || el.name || el.dataset.key || el.tagName}:${getFieldValue(el)}`)
            .join('|');
    }

    function remember(surface, options = {}) {
        if (!surface) return '';
        const value = snapshot(surface, options.selector);
        surface.dataset.editableSurface = 'true';
        surface.dataset.dirtyBaseline = value;
        surface.dataset.dirty = 'false';
        if (!surface._unsafeDismissDirtyHandler) {
            surface._unsafeDismissDirtyHandler = () => {
                if (surface.dataset.dirtyBaseline !== snapshot(surface, options.selector)) {
                    surface.dataset.dirty = 'true';
                }
            };
            surface.addEventListener('input', surface._unsafeDismissDirtyHandler, true);
            surface.addEventListener('change', surface._unsafeDismissDirtyHandler, true);
        }
        return value;
    }

    function markClean(surface, options = {}) {
        if (!surface) return;
        surface.dataset.dirtyBaseline = snapshot(surface, options.selector);
        surface.dataset.dirty = 'false';
    }

    function isDirtySurface(surface, options = {}) {
        if (typeof options.isDirty === 'function') return !!options.isDirty();
        if (!surface) return false;
        if (surface.dataset.dirty === 'true') return true;
        if (surface.dataset.dirtyBaseline !== undefined) {
            return surface.dataset.dirtyBaseline !== snapshot(surface, options.selector);
        }
        return false;
    }

    async function confirmDiscardIfDirty(surface, options = {}) {
        if (!isDirtySurface(surface, options)) return true;
        const message = options.message || 'Є незбережені зміни. Закрити без збереження?';
        const okText = options.okText || 'Закрити без збереження';
        const cancelText = options.cancelText || 'Повернутись';
        if (typeof confirmModal === 'function') {
            return !!(await confirmModal(message, { type: 'warning', okText, cancelText }));
        }
        if (typeof customConfirm === 'function') {
            return !!(await customConfirm(message, 'Незбережені зміни'));
        }
        if (typeof showNotification === 'function') {
            showNotification('Підтвердження недоступне. Оновіть сторінку і повторіть дію.', 'error');
        }
        return false;
    }

    async function attemptCloseEditableSurface(surface, closeFn, options = {}) {
        if (!surface) return true;
        if (!options.force && !(await confirmDiscardIfDirty(surface, options))) return false;
        if (typeof closeFn === 'function') closeFn();
        if (options.markClean !== false) markClean(surface, options);
        if (typeof options.onClosed === 'function') options.onClosed();
        return true;
    }

    function canDismissByBackdrop(surface, options = {}) {
        return !isDirtySurface(surface, options);
    }

    function canDismissByEscape(surface, options = {}) {
        return !isDirtySurface(surface, options);
    }

    function bindBackdropClose(surface, closeFn, options = {}) {
        if (!surface || surface._unsafeDismissBackdropBound) return;
        surface._unsafeDismissBackdropBound = true;
        surface.addEventListener('click', (e) => {
            if (e.target !== surface) return;
            attemptCloseEditableSurface(surface, closeFn, { ...options, reason: 'backdrop' });
        });
    }

    function bindEscapeClose(surface, closeFn, options = {}) {
        if (!surface || surface._unsafeDismissEscapeBound) return;
        surface._unsafeDismissEscapeBound = true;
        surface.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            attemptCloseEditableSurface(surface, closeFn, { ...options, reason: 'escape' });
        });
    }

    return {
        remember,
        markClean,
        snapshot,
        isDirtySurface,
        confirmDiscardIfDirty,
        attemptCloseEditableSurface,
        canDismissByBackdrop,
        canDismissByEscape,
        bindBackdropClose,
        bindEscapeClose
    };
})();

if (typeof window !== 'undefined') {
    window.UnsafeDismissGuard = UnsafeDismissGuard;
}

function resolveModalLifecycleTarget(target, modalEl) {
    if (typeof target === 'function') return target(modalEl) || null;
    if (typeof target === 'string') return modalEl.querySelector(target) || document.querySelector(target);
    return target || null;
}

function openModal(modalEl, triggerEl, options = {}) {
    if (!modalEl) return;

    // Re-opening the same surface must replace its existing trap instead of
    // stacking duplicate listeners and stale focus-restoration targets.
    for (let index = _focusTrapStack.length - 1; index >= 0; index -= 1) {
        const existingState = _focusTrapStack[index];
        if (existingState.modal !== modalEl) continue;
        if (existingState.handler) modalEl.removeEventListener('keydown', existingState.handler);
        _focusTrapStack.splice(index, 1);
    }
    if (modalEl._focusTrapHandler) {
        modalEl.removeEventListener('keydown', modalEl._focusTrapHandler);
        delete modalEl._focusTrapHandler;
    }

    // Save trigger element for focus restoration
    const trapState = {
        modal: modalEl,
        trigger: triggerEl || document.activeElement,
        options,
        previousTrap: _focusTrapStack[_focusTrapStack.length - 1] || null
    };
    _focusTrapStack.push(trapState);

    // Show modal
    if (typeof options.show === 'function') options.show(modalEl);
    else modalEl.classList.remove('hidden');

    // Focus first focusable element after DOM renders
    requestAnimationFrame(() => {
        if (!_focusTrapStack.includes(trapState)) return;
        const preferred = resolveModalLifecycleTarget(options.initialFocus, modalEl);
        if (preferred && !preferred.disabled && preferred.offsetParent !== null && typeof preferred.focus === 'function') {
            preferred.focus();
            return;
        }
        const focusableEls = modalEl.querySelectorAll(FOCUSABLE_SELECTOR);
        const visible = Array.from(focusableEls).filter(el => el.offsetParent !== null);
        if (visible.length > 0) {
            visible[0].focus();
        } else {
            // If no focusable elements, make modal-content focusable
            const content = modalEl.querySelector('.modal-content');
            if (content) {
                content.setAttribute('tabindex', '-1');
                content.focus();
            }
        }
    });

    // Attach keydown listener for Tab trap + Escape
    trapState.handler = (e) => {
        if (e.key === 'Tab') {
            // Re-query focusable elements (content may change dynamically)
            const focusable = Array.from(
                modalEl.querySelectorAll(FOCUSABLE_SELECTOR)
            ).filter(el => el.offsetParent !== null);

            if (focusable.length === 0) return;

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof options.onRequestClose === 'function') {
                options.onRequestClose({ reason: 'escape', modal: modalEl });
                return;
            }
            if (modalEl.dataset.editableSurface === 'true' && window.UnsafeDismissGuard) {
                window.UnsafeDismissGuard.attemptCloseEditableSurface(modalEl, () => closeModal(modalEl, { force: true }), { reason: 'escape' });
            } else {
                closeModal(modalEl);
            }
        }
    };

    modalEl._focusTrapHandler = trapState.handler;
    modalEl.addEventListener('keydown', trapState.handler);
}

function closeModal(modalEl, options = {}) {
    if (!modalEl) return;

    if (!options.force && modalEl.dataset.editableSurface === 'true' && window.UnsafeDismissGuard && window.UnsafeDismissGuard.isDirtySurface(modalEl)) {
        window.UnsafeDismissGuard.attemptCloseEditableSurface(modalEl, () => closeModal(modalEl, { force: true }), {
            reason: options.reason || 'direct-close'
        });
        return false;
    }

    // Find the current instance of this modal in the stack.
    let idx = -1;
    for (let index = _focusTrapStack.length - 1; index >= 0; index -= 1) {
        if (_focusTrapStack[index].modal === modalEl) {
            idx = index;
            break;
        }
    }
    if (idx === -1) {
        // Not in stack — just hide (fallback)
        if (typeof options.hide === 'function') options.hide(modalEl);
        else modalEl.classList.add('hidden');
        return;
    }

    const trapState = _focusTrapStack.splice(idx, 1)[0];
    const lifecycleOptions = { ...(trapState.options || {}), ...options };

    // Remove keydown handler
    if (trapState.handler) modalEl.removeEventListener('keydown', trapState.handler);
    if (modalEl._focusTrapHandler) {
        if (modalEl._focusTrapHandler !== trapState.handler) {
            modalEl.removeEventListener('keydown', modalEl._focusTrapHandler);
        }
        delete modalEl._focusTrapHandler;
    }

    // Hide modal
    if (typeof lifecycleOptions.hide === 'function') lifecycleOptions.hide(modalEl);
    else modalEl.classList.add('hidden');

    // Restore focus to trigger element
    const restoreTarget = resolveModalLifecycleTarget(lifecycleOptions.restoreFocus, modalEl) || trapState.trigger;
    if (restoreTarget && restoreTarget.isConnected !== false && typeof restoreTarget.focus === 'function') {
        try { restoreTarget.focus(); } catch (_) { /* element may no longer exist */ }
    }
}

function closeModalFromControl(control, event) {
    if (!control) return false;
    if (control.getAttribute('data-cert-modal-close')) return false;

    const surface = control.closest('.modal');
    if (!surface) return false;

    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (surface.dataset.editableSurface === 'true' && window.UnsafeDismissGuard) {
        window.UnsafeDismissGuard.attemptCloseEditableSurface(
            surface,
            () => closeModal(surface, { force: true }),
            { reason: 'close-control' }
        );
    } else {
        closeModal(surface);
    }
    return true;
}

function initSharedModalCloseControls() {
    if (document._sharedModalCloseControlsBound) return;
    document._sharedModalCloseControlsBound = true;

    const handler = (event) => {
        const closeControl = event.target?.closest?.('.modal-close');
        if (!closeControl) return;
        closeModalFromControl(closeControl, event);
    };

    document.addEventListener('click', handler, true);
    document.addEventListener('touchend', handler, { capture: true, passive: false });
}

async function closeAllModals() {
    for (const m of document.querySelectorAll('.modal')) {
        if (m.id === 'confirmModal') continue;
        if (!m.classList.contains('hidden')) {
            if (m.dataset.editableSurface === 'true' && window.UnsafeDismissGuard) {
                const closed = await window.UnsafeDismissGuard.attemptCloseEditableSurface(m, () => closeModal(m, { force: true }), {
                    reason: 'close-all'
                });
                if (!closed) return false;
                continue;
            }
            closeModal(m);
        }
    }
    return true;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSharedModalCloseControls, { once: true });
    } else {
        initSharedModalCloseControls();
    }
}

function customConfirm(message, title = 'Підтвердження') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        titleEl.textContent = title;
        messageEl.textContent = message;

        // Use openModal for focus trap (pushes onto stack for nested modal support)
        openModal(modal);

        let resolved = false;
        const cleanup = () => {
            closeModal(modal);
            yesBtn.removeEventListener('click', onYes);
            yesBtn.removeEventListener('touchend', onYes);
            noBtn.removeEventListener('click', onNo);
            noBtn.removeEventListener('touchend', onNo);
        };

        const onYes = (e) => {
            e.preventDefault();
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(true);
        };

        const onNo = (e) => {
            e.preventDefault();
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(false);
        };

        yesBtn.addEventListener('click', onYes);
        yesBtn.addEventListener('touchend', onYes);
        noBtn.addEventListener('click', onNo);
        noBtn.addEventListener('touchend', onNo);
    });
}

const _toastMaxVisible = 3;
const _toastDedupeMs = 1400;
const _toastRecent = new Map();
let _activeConfirmClose = null;

function closeActiveConfirmModal(result = false) {
    if (typeof _activeConfirmClose === 'function') {
        _activeConfirmClose(result, { immediate: true });
    }
}
// ==========================================
// CUSTOM CONFIRM MODAL (replaces native confirm())
// ==========================================

/**
 * Beautiful confirm dialog that replaces native confirm().
 * Returns a Promise<boolean>.
 * Usage: if (await confirmModal('Видалити?')) { ... }
 */
function confirmModal(message, options = {}) {
    return new Promise((resolve) => {
        closeActiveConfirmModal(false);
        document.querySelectorAll('.confirm-overlay[data-confirm-kind="confirm"]').forEach(el => el.remove());
        const { okText = 'Підтвердити', cancelText = 'Скасувати', type = 'warning' } = options;
        const icons = { danger: '🗑️', success: '✅', warning: '⚠️' };
        const icon = icons[type] || '❓';
        const safeMsg = String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.dataset.confirmKind = 'confirm';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="confirm-dialog ${type}">
                <div class="confirm-icon">${icon}</div>
                <div class="confirm-message">${safeMsg}</div>
                <div class="confirm-actions">
                    <button class="confirm-btn confirm-cancel">${cancelText}</button>
                    <button class="confirm-btn confirm-ok ${type}">${okText}</button>
                </div>
            </div>`;

        let closed = false;
        const close = (result, closeOptions = {}) => {
            if (closed) return;
            closed = true;
            if (_activeConfirmClose === close) _activeConfirmClose = null;
            if (!closeOptions.immediate) overlay.classList.add('confirm-exit');
            document.removeEventListener('keydown', onKey);
            if (closeOptions.immediate) {
                overlay.remove();
            } else {
                setTimeout(() => overlay.remove(), 80);
            }
            resolve(result);
        };
        _activeConfirmClose = close;

        overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
        overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

        const onKey = (e) => { if (e.key === 'Escape') close(false); };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.querySelector('.confirm-ok').focus());
    });
}

/**
 * promptModal — заміна native prompt().
 * Returns Promise<string|null> (null = cancelled).
 * Usage: const val = await promptModal('Назва:', { defaultValue: 'hello', placeholder: 'Введіть...' });
 */
function promptModal(message, options = {}) {
    return new Promise((resolve) => {
        const { defaultValue = '', placeholder = '', okText = 'OK', cancelText = 'Скасувати', type = 'warning', inputType = 'text' } = options;
        const icons = { danger: '🗑️', success: '✅', warning: '✏️', info: 'ℹ️' };
        const icon = icons[type] || '✏️';
        const safeMsg = String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
        const safeDef = String(defaultValue).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const safePh = String(placeholder).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog ${type}">
                <div class="confirm-icon">${icon}</div>
                <div class="confirm-message">${safeMsg}</div>
                <div class="prompt-input-wrap" style="margin: 12px 0 4px;">
                    <input type="${inputType}" class="prompt-input" value="${safeDef}" placeholder="${safePh}"
                        style="width:100%;padding:10px 14px;border:2px solid rgba(139,92,246,0.3);border-radius:10px;font-size:15px;font-family:inherit;background:var(--surface,#fff);color:var(--text,#1a1a2e);outline:none;transition:border-color 0.2s;">
                </div>
                <div class="confirm-actions">
                    <button class="confirm-btn confirm-cancel">${cancelText}</button>
                    <button class="confirm-btn confirm-ok ${type}">${okText}</button>
                </div>
            </div>`;

        let closed = false;
        const close = (val) => {
            if (closed) return;
            closed = true;
            overlay.classList.add('confirm-exit');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 200);
            resolve(val);
        };

        const input = overlay.querySelector('.prompt-input');
        input.addEventListener('focus', () => { input.style.borderColor = 'rgba(139,92,246,0.6)'; });
        input.addEventListener('blur', () => { input.style.borderColor = 'rgba(139,92,246,0.3)'; });

        overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.confirm-ok').addEventListener('click', () => close(input.value));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });

        const onKey = (e) => { if (e.key === 'Escape') close(null); };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => { input.focus(); input.select(); });
    });
}

/**
 * formModal — multi-field form modal.
 * fields: [{ key, label, type?, defaultValue?, placeholder?, options?, required? }]
 * options = [{ value, label }] for select type
 * Returns Promise<Object|null> (null = cancelled).
 */
function formModal(title, fields, options = {}) {
    return new Promise((resolve) => {
        const {
            okText = 'Зберегти',
            cancelText = 'Скасувати',
            type = 'success',
            icon: customIcon,
            compact = false,
            className = '',
            closeOnBackdrop = true,
            validate = null
        } = options;
        const icons = { danger: '🗑️', success: '✅', warning: '⚠️', info: 'ℹ️' };
        const icon = customIcon || icons[type] || '📝';
        const safeTitle = String(title).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const safeClassName = String(className || '').replace(/[^\w\s-]/g, '').trim();
        const escAttr = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const escHtml = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const noteTextToHtml = (value) => escHtml(value).replace(/\n/g, '<br>');
        const renderSelectOptions = (field, optionList, selectedOverride = null) => {
            const optionsToRender = Array.isArray(optionList) ? optionList : [];
            const hasSelectedOverride = selectedOverride !== null && selectedOverride !== undefined;
            const hasDefaultValue = field.defaultValue !== null && field.defaultValue !== undefined;
            const selectedValue = hasSelectedOverride
                ? String(selectedOverride)
                : (hasDefaultValue ? String(field.defaultValue) : null);
            return optionsToRender.map(o => {
                const selected = selectedValue !== null
                    ? String(o.value) === selectedValue
                    : o.selected === true;
                return `<option value="${escAttr(o.value)}"${selected ? ' selected' : ''}>${escAttr(o.label)}</option>`;
            }).join('');
        };
        const renderCheckboxOptions = (field, optionList, selectedOverride = null) => {
            const optionsToRender = Array.isArray(optionList) ? optionList : [];
            const hasDefaultValue = field.defaultValue !== null && field.defaultValue !== undefined;
            const selectedValues = selectedOverride !== null
                ? selectedOverride
                : (hasDefaultValue
                    ? (Array.isArray(field.defaultValue) ? field.defaultValue.map(String) : String(field.defaultValue || '').split(/[,;\s]+/).filter(Boolean))
                    : optionsToRender.filter(o => o.selected === true).map(o => o.value));
            const selected = new Set(selectedValues.map(String));
            return optionsToRender.map(o => {
                const value = escAttr(o.value);
                const text = escAttr(o.label);
                const checked = selected.has(String(o.value)) ? ' checked' : '';
                return `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid rgba(139,92,246,0.22);border-radius:10px;margin-bottom:6px;background:rgba(139,92,246,0.05);font-size:14px;line-height:1.3;">
                    <input type="checkbox" data-key="${field.key}" data-fm-checkbox-group="${field.key}" value="${value}"${checked} style="margin-top:2px;">
                    <span>${text}</span>
                </label>`;
            }).join('');
        };

        const fieldsHtml = fields.map(f => {
            const id = 'fm_' + f.key;
            const req = f.required ? ' *' : '';
            const label = `<label for="${id}" style="display:block;font-size:13px;font-weight:600;color:var(--text-secondary,#666);margin-bottom:4px;">${f.label}${req}</label>`;
            const defVal = (f.defaultValue != null ? String(f.defaultValue) : '').replace(/"/g,'&quot;');
            const ph = (f.placeholder || '').replace(/"/g,'&quot;');
            const baseStyle = 'width:100%;padding:10px 14px;border:2px solid rgba(139,92,246,0.3);border-radius:10px;font-size:15px;font-family:inherit;background:var(--surface,#fff);color:var(--text,#1a1a2e);outline:none;transition:border-color 0.2s;';
            const hint = f.hint ? `<div class="form-modal-field-hint" style="margin-top:4px;font-size:12px;line-height:1.35;color:var(--text-secondary,#666);">${String(f.hint).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : '';

            if (f.type === 'note') {
                const note = String(f.text || f.defaultValue || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return `<div class="form-modal-note" data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;padding:10px 12px;border:1px solid rgba(59,130,246,0.24);border-radius:10px;background:rgba(59,130,246,0.08);font-size:13px;line-height:1.4;color:var(--text-secondary,#666);">${note}</div>`;
            }
            if (f.type === 'dynamicNote') {
                return `<div id="${id}" class="form-modal-note form-modal-dynamic-note" data-fm-field-wrap="${escAttr(f.key)}" data-dynamic-note="${f.key}" style="margin-bottom:10px;padding:10px 12px;border:1px solid rgba(16,185,129,0.24);border-radius:10px;background:rgba(16,185,129,0.08);font-size:13px;line-height:1.45;color:var(--text-secondary,#666);"></div>`;
            }
            if (f.type === 'presetButtons' && Array.isArray(f.presets)) {
                const buttons = f.presets.map((preset, index) => {
                    const labelText = escHtml(preset.label || `Пакет ${index + 1}`);
                    const hintText = preset.hint ? `<small style="display:block;margin-top:2px;font-size:11px;line-height:1.25;opacity:0.76;">${escHtml(preset.hint)}</small>` : '';
                    return `<button type="button" class="form-modal-preset-btn" data-fm-preset="${f.key}" data-fm-preset-index="${index}" aria-pressed="false" style="text-align:left;padding:9px 10px;border:1px solid rgba(45,212,191,0.26);border-radius:10px;background:rgba(45,212,191,0.08);color:var(--text,#1a1a2e);font:inherit;font-size:13px;font-weight:800;cursor:pointer;">${labelText}${hintText}</button>`;
                }).join('');
                return `<div data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;">${f.label ? `<div style="font-size:13px;font-weight:700;color:var(--text-secondary,#666);margin-bottom:6px;">${escHtml(f.label)}</div>` : ''}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">${buttons}</div>${hint}</div>`;
            }
            if (f.type === 'select' && f.options) {
                const opts = renderSelectOptions(f, f.options);
                return `<div data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;">${label}<select id="${id}" data-key="${f.key}" class="fm-field" style="${baseStyle}">${opts}</select>${hint}</div>`;
            }
            if (f.type === 'checkboxGroup' && f.options) {
                const opts = renderCheckboxOptions(f, f.options);
                return `<div data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;">${label}<div id="${id}" class="fm-field fm-checkbox-group" data-key="${f.key}" data-checkbox-group="true">${opts}</div>${hint}</div>`;
            }
            if (f.type === 'textarea') {
                return `<div data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;">${label}<textarea id="${id}" data-key="${f.key}" class="fm-field" placeholder="${ph}" rows="3" style="${baseStyle}resize:vertical;">${defVal}</textarea>${hint}</div>`;
            }
            const inputType = f.type || 'text';
            return `<div data-fm-field-wrap="${escAttr(f.key)}" style="margin-bottom:10px;">${label}<input type="${inputType}" id="${id}" data-key="${f.key}" class="fm-field" value="${defVal}" placeholder="${ph}" style="${baseStyle}">${hint}</div>`;
        }).join('');

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay form-modal-overlay';
        const dialogClasses = ['confirm-dialog', type, 'form-modal-dialog', compact ? 'form-modal-dialog-compact' : '', safeClassName]
            .filter(Boolean)
            .join(' ');
        overlay.innerHTML = `
            <div class="${dialogClasses}" style="max-width:420px;">
                <div class="confirm-icon">${icon}</div>
                <div class="confirm-message" style="font-size:17px;font-weight:700;">${safeTitle}</div>
                <div class="form-modal-fields" style="text-align:left;margin:8px 0;">${fieldsHtml}</div>
                <div class="form-modal-validation-error" role="alert" hidden style="margin:8px 0 0;padding:8px 10px;border:1px solid rgba(239,68,68,0.32);border-radius:8px;background:rgba(239,68,68,0.08);color:#b91c1c;font-size:13px;font-weight:700;text-align:left;"></div>
                <div class="confirm-actions">
                    <button class="confirm-btn confirm-cancel">${cancelText}</button>
                    <button class="confirm-btn confirm-ok ${type}">${okText}</button>
                </div>
            </div>`;

        let closed = false;
        const close = (result) => {
            if (closed) return;
            closed = true;
            overlay.classList.add('confirm-exit');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };

        const getValues = () => {
            const vals = {};
            overlay.querySelectorAll('.fm-field').forEach(el => {
                if (el.dataset.checkboxGroup === 'true') {
                    vals[el.dataset.key] = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
                } else {
                    vals[el.dataset.key] = el.value;
                }
            });
            return vals;
        };
        const clearValidationError = () => {
            const error = overlay.querySelector('.form-modal-validation-error');
            if (error) {
                error.textContent = '';
                error.hidden = true;
            }
            overlay.querySelectorAll('.fm-field[aria-invalid="true"]').forEach(el => {
                el.setAttribute('aria-invalid', 'false');
                el.style.borderColor = 'rgba(139,92,246,0.3)';
            });
        };
        const showValidationError = (message, key = null) => {
            const text = String(message || 'Перевірте поля форми').trim();
            const error = overlay.querySelector('.form-modal-validation-error');
            if (error) {
                error.textContent = text;
                error.hidden = false;
            }
            const el = key ? overlay.querySelector(`#fm_${String(key).replace(/"/g, '\\"')}`) : null;
            if (el) {
                el.setAttribute('aria-invalid', 'true');
                el.style.borderColor = '#ef4444';
                if (typeof el.focus === 'function') el.focus();
            }
        };
        const normalizeValidationResult = (result) => {
            if (!result) return null;
            if (typeof result === 'string') return { message: result };
            if (typeof result === 'object') {
                const message = result.message || result.error;
                if (message) return { message, key: result.key || result.field || null };
            }
            return null;
        };

        let initialValuesJson = null;
        const getValuesJson = () => JSON.stringify(getValues());
        const isDirty = () => initialValuesJson !== null && getValuesJson() !== initialValuesJson;
        const setFieldValue = (key, value, options = {}) => {
            const { notify = true } = options;
            const el = overlay.querySelector(`.fm-field[data-key="${String(key).replace(/"/g, '\\"')}"]`);
            if (!el) return;
            if (el.dataset.checkboxGroup === 'true') {
                const selected = new Set((Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/)).filter(Boolean).map(String));
                el.querySelectorAll('input[type="checkbox"]').forEach(input => {
                    input.checked = selected.has(String(input.value));
                });
            } else {
                el.value = value == null ? '' : String(value);
            }
            if (notify) el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const isFieldVisible = (field, vals = getValues()) => {
            if (typeof field.visibleWhen === 'function') return !!field.visibleWhen(vals);
            if (typeof field.hiddenWhen === 'function') return !field.hiddenWhen(vals);
            return true;
        };
        const updateConditionalFields = () => {
            const vals = getValues();
            fields.forEach(f => {
                const wrap = overlay.querySelector(`[data-fm-field-wrap="${String(f.key).replace(/"/g, '\\"')}"]`);
                if (!wrap) return;
                const visible = isFieldVisible(f, vals);
                wrap.hidden = !visible;
                wrap.classList.toggle('form-modal-field-hidden', !visible);
            });
        };
        const updateDynamicNotes = () => {
            const vals = getValues();
            fields
                .filter(f => f.type === 'dynamicNote' && typeof f.render === 'function')
                .forEach(f => {
                    const el = overlay.querySelector(`#fm_${f.key}`);
                    if (!el) return;
                    el.innerHTML = noteTextToHtml(f.render(vals) || '');
                });
        };
        const updateFormState = () => {
            clearValidationError();
            updateConditionalFields();
            updateDynamicNotes();
        };
        const requestCancel = async () => {
            if (isDirty() && window.UnsafeDismissGuard) {
                const ok = await window.UnsafeDismissGuard.confirmDiscardIfDirty(overlay, {
                    isDirty,
                    message: 'Є незбережені зміни у формі. Закрити без збереження?',
                    okText: 'Закрити без збереження',
                    cancelText: 'Повернутись'
                });
                if (!ok) return;
            }
            close(null);
        };

        overlay.querySelector('.confirm-cancel').addEventListener('click', () => requestCancel());
        overlay.querySelector('.confirm-ok').addEventListener('click', () => {
            clearValidationError();
            const vals = getValues();
            for (const f of fields) {
                const wrap = overlay.querySelector(`[data-fm-field-wrap="${String(f.key).replace(/"/g, '\\"')}"]`);
                if (wrap?.hidden) continue;
                const value = vals[f.key];
                const missing = Array.isArray(value) ? value.length === 0 : !String(value || '').trim();
                if (f.required && missing) {
                    const el = overlay.querySelector(`#fm_${f.key}`);
                    if (el) {
                        el.setAttribute('aria-invalid', 'true');
                        el.style.borderColor = '#ef4444';
                        if (typeof el.focus === 'function') el.focus();
                    }
                    showValidationError(`Заповніть поле "${f.label || f.key}"`, f.key);
                    return;
                }
            }
            if (typeof validate === 'function') {
                const validationError = normalizeValidationResult(validate(vals, { fields, overlay }));
                if (validationError) {
                    showValidationError(validationError.message, validationError.key);
                    return;
                }
            }
            close(vals);
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay && closeOnBackdrop) requestCancel(); });

        // Focus management
        overlay.querySelectorAll('.fm-field').forEach(el => {
            el.addEventListener('focus', () => { el.style.borderColor = 'rgba(139,92,246,0.6)'; });
            el.addEventListener('blur', () => { el.style.borderColor = 'rgba(139,92,246,0.3)'; });
            el.addEventListener('input', updateFormState);
            el.addEventListener('change', updateFormState);
        });
        overlay.querySelectorAll('input[data-fm-checkbox-group]').forEach(el => {
            el.addEventListener('change', updateFormState);
        });

        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); requestCancel(); } };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);

        const dependentRebuilders = [];
        fields
            .filter(f => f.type === 'select' && f.dependsOn && (f.optionsBy || typeof f.optionsFor === 'function'))
            .forEach(f => {
                const parent = overlay.querySelector(`#fm_${f.dependsOn}`);
                const target = overlay.querySelector(`#fm_${f.key}`);
                if (!parent || !target) return;

                const rebuild = () => {
                    const previous = target.value || f.defaultValue || '';
                    const vals = getValues();
                    const parentValue = parent.dataset.checkboxGroup === 'true' ? vals[f.dependsOn] : parent.value;
                    const nextOptions = typeof f.optionsFor === 'function'
                        ? f.optionsFor(parentValue, vals)
                        : (f.optionsBy[parent.value] || f.optionsBy.__default || f.options || []);
                    const nextValue = nextOptions.some(o => String(o.value) === String(previous))
                        ? previous
                        : (nextOptions.find(o => o.selected === true)?.value ?? nextOptions[0]?.value ?? '');
                    target.innerHTML = renderSelectOptions(f, nextOptions, nextValue);
                    target.value = nextValue == null ? '' : String(nextValue);
                    updateFormState();
                };

                dependentRebuilders.push(rebuild);
                parent.addEventListener('change', rebuild);
                rebuild();
            });
        fields
            .filter(f => f.type === 'checkboxGroup' && f.dependsOn && (f.optionsBy || typeof f.optionsFor === 'function'))
            .forEach(f => {
                const parent = overlay.querySelector(`#fm_${f.dependsOn}`);
                const target = overlay.querySelector(`#fm_${f.key}`);
                if (!parent || !target) return;

                const rebuild = () => {
                    const selected = Array.from(target.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
                    const vals = getValues();
                    const nextOptions = typeof f.optionsFor === 'function'
                        ? f.optionsFor(parent.value, vals)
                        : (f.optionsBy[parent.value] || f.optionsBy.__default || f.options || []);
                    target.innerHTML = renderCheckboxOptions(f, nextOptions, selected);
                    updateFormState();
                };

                dependentRebuilders.push(rebuild);
                parent.addEventListener('change', rebuild);
                rebuild();
            });
        const rebuildDependentFields = () => dependentRebuilders.forEach(rebuild => rebuild());
        const applyPresetValues = (presetValues, activeButton = null) => {
            const entries = Object.entries(presetValues || {});
            if (!entries.length) return;

            entries.forEach(([key, value]) => setFieldValue(key, value, { notify: false }));
            rebuildDependentFields();
            entries.forEach(([key, value]) => setFieldValue(key, value, { notify: false }));
            updateFormState();

            if (activeButton) {
                overlay.querySelectorAll(`[data-fm-preset="${activeButton.dataset.fmPreset}"]`).forEach(item => {
                    const isActive = item === activeButton;
                    item.classList.toggle('is-active', isActive);
                    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });
            }
        };
        overlay.querySelectorAll('[data-fm-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const field = fields.find(item => item.key === btn.dataset.fmPreset);
                const preset = field?.presets?.[Number(btn.dataset.fmPresetIndex)];
                if (!preset?.values || typeof preset.values !== 'object') return;
                applyPresetValues(preset.values, btn);
            });
        });

        updateFormState();
        initialValuesJson = getValuesJson();
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
        const firstField = Array.from(overlay.querySelectorAll('.fm-field'))
            .find(field => !field.closest('[data-fm-field-wrap]')?.hidden);
        if (firstField) requestAnimationFrame(() => firstField.focus());
    });
}

function showNotification(message, type = '') {
    if (window.CrmToast?.show && window.CrmToast.show !== showNotification) {
        return window.CrmToast.show(message, type, arguments[2]);
    }
    const normalizedMessage = message instanceof Error
        ? (window.CrmApiErrors?.format?.(message) || message.message || 'Помилка')
        : (message && typeof message === 'object' && (message.error || message.message || message.requestId)
            ? (window.CrmApiErrors?.format?.(message) || String(message.error || message.message || 'Помилка'))
            : String(message ?? ''));
    const dedupeKey = `${type || 'info'}:${normalizedMessage}`;
    const now = Date.now();
    const recentAt = _toastRecent.get(dedupeKey) || 0;
    if (normalizedMessage && now - recentAt < _toastDedupeMs) return;
    _toastRecent.set(dedupeKey, now);
    setTimeout(() => {
        if (_toastRecent.get(dedupeKey) === now) _toastRecent.delete(dedupeKey);
    }, _toastDedupeMs + 250);

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
        document.body.appendChild(container);
    }

    // Remove oldest if at max
    const existing = container.querySelectorAll('.toast');
    if (existing.length >= _toastMaxVisible) {
        existing[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ` ${type}` : '');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.textContent = normalizedMessage;

    container.appendChild(toast);

    // Auto-dismiss after 6s. notification.js owns richer interactive toasts when present.
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 750);
    }, 6000);
}

// Alias for showNotification (used by chat-page.js and others).
// Keep this as a var-backed global because legacy catalog/dashboard scripts
// also declare a defensive var showToast fallback.
var showToast = window.showToast || showNotification;
window.showToast = showToast;

function handleError(context, error) {
    console.error(`[${context}]`, error);
    showNotification(`Помилка: ${context}`, 'error');
}

function showWarning(text) {
    const banner = document.getElementById('warningBanner');
    document.getElementById('warningText').textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('danger');

    // v8.6.1: Auto-hide warning banner when user scrolls the timeline
    const timelineScroll = document.getElementById('timelineScroll');
    if (timelineScroll && !timelineScroll._warningScrollAttached) {
        timelineScroll._warningScrollAttached = true;
        timelineScroll.addEventListener('scroll', function onTimelineScroll() {
            const b = document.getElementById('warningBanner');
            if (b && !b.classList.contains('hidden')) {
                b.classList.add('hidden');
            }
        }, { passive: true });
    }

    // Also hide on page/window scroll
    if (!window._warningWindowScrollAttached) {
        window._warningWindowScrollAttached = true;
        window.addEventListener('scroll', function() {
            const b = document.getElementById('warningBanner');
            if (b && !b.classList.contains('hidden')) {
                b.classList.add('hidden');
            }
        }, { passive: true });
    }
}

// ==========================================
// ЧЕРВОНА ЛІНІЯ "ЗАРАЗ"
// ==========================================

function renderNowLine() {
    document.querySelectorAll('.now-line, .now-line-top, .now-line-global').forEach(el => el.remove());
    const now = new Date();
    if (formatDate(AppState.selectedDate) !== formatDate(now)) return;
    if (AppState.multiDayMode) return;

    const { start, end } = getTimeRange();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = start * 60;
    if (nowMin < startMin || nowMin > end * 60) return;

    const gridAnchor = document.querySelector('.line-grid[data-line-id]:not([data-line-id="afisha"])')
        || document.querySelector('.line-grid[data-line-id]');
    const left = typeof timelineMinutesToPixels === 'function'
        ? timelineMinutesToPixels(nowMin - startMin, gridAnchor)
        : ((nowMin - startMin) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;

    // Single continuous line inside the actual timeline grid, not over the sticky time scale.
    const timelineScroll = document.getElementById('timelineScroll');
    const timelineLines = document.getElementById('timelineLines');
    if (timelineScroll && timelineLines) {
        const globalLine = document.createElement('div');
        globalLine.className = 'now-line-global';
        const scrollRect = timelineScroll.getBoundingClientRect?.();
        const gridRect = gridAnchor?.getBoundingClientRect?.();
        const measuredLeft = scrollRect && gridRect
            ? (gridRect.left - scrollRect.left + timelineScroll.scrollLeft + left)
            : null;
        const contentTop = timelineLines.offsetTop
            || Math.max(0, (timelineLines.getBoundingClientRect?.().top || 0) - (scrollRect?.top || 0) + (timelineScroll.scrollTop || 0));
        const contentHeight = Math.max(
            timelineLines.scrollHeight || 0,
            timelineLines.offsetHeight || 0,
            timelineLines.getBoundingClientRect?.().height || 0
        );
        const timeScale = document.getElementById('timeScale');
        const marginLeft = timeScale ? parseInt(getComputedStyle(timeScale).marginLeft) || 110 : 110;
        globalLine.style.left = `${Math.round(measuredLeft ?? (marginLeft + left))}px`;
        globalLine.style.setProperty('--timeline-now-line-top', `${Math.round(contentTop)}px`);
        globalLine.style.setProperty('--timeline-now-line-height', `${Math.round(contentHeight)}px`);
        timelineScroll.appendChild(globalLine);
    }
}

// ==========================================
// TOOLTIP
// ==========================================

if (typeof window.ensureBookingTooltip !== 'function') {
    window.ensureBookingTooltip = function ensureBookingTooltip() {
        if (!document.body) return null;
        const candidates = Array.from(document.querySelectorAll('#bookingTooltip, .booking-tooltip[data-booking-tooltip="true"]'));
        let tooltip = candidates.find(el => el.id === 'bookingTooltip') || candidates[0] || null;
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'booking-tooltip hidden';
            tooltip.hidden = true;
            document.body.appendChild(tooltip);
        } else if (!tooltip.isConnected) {
            document.body.appendChild(tooltip);
        }
        candidates.forEach(el => {
            if (el !== tooltip) el.remove();
        });
        tooltip.id = 'bookingTooltip';
        tooltip.classList.add('booking-tooltip');
        tooltip.dataset.bookingTooltip = 'true';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.style.pointerEvents = 'none';

        const hidden = tooltip.hidden || tooltip.classList.contains('hidden') || tooltip.style.display === 'none';
        tooltip.hidden = hidden;
        tooltip.classList.toggle('hidden', hidden);
        tooltip.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        return tooltip;
    };
}

const PINATA_NUMBERS_ROOT = typeof window !== 'undefined'
    ? window
    : (typeof globalThis !== 'undefined' ? globalThis : null);

if (PINATA_NUMBERS_ROOT && !PINATA_NUMBERS_ROOT.PinataNumbers) {
    PINATA_NUMBERS_ROOT.PinataNumbers = (() => {
        const OPERATIONAL_BASE = 500;
        const LEGACY_MIN_ID = 1;
        const LEGACY_MAX_ID = 36;

        function normalize(value) {
            const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
            if (!raw) return '';
            const normalized = raw
                .replace(/^(?:№|#)\s*/u, '')
                .replace(/^P\s+(\d+)$/i, 'P-$1')
                .trim();
            const legacy = normalized.match(/^P-(\d{1,3})$/i);
            if (legacy) {
                const id = Number(legacy[1]);
                if (Number.isInteger(id) && id >= LEGACY_MIN_ID && id <= LEGACY_MAX_ID) {
                    return String(OPERATIONAL_BASE + id);
                }
            }
            return normalized;
        }

        function extractFromText(value) {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            const explicit = text.match(/(?:№|#)\s*((?:P[-\s]?)?\d{1,4})/iu);
            if (explicit) return normalize(explicit[1]);
            const legacy = text.match(/\b(P[-\s]?\d{1,4})\b/iu);
            if (legacy) return normalize(legacy[1]);
            return '';
        }

        function display(value) {
            const normalized = normalize(value);
            if (!normalized) return '';
            return /^\d+$/.test(normalized) ? `№${normalized}` : normalized;
        }

        function extraObject(source = {}) {
            const extra = source.extraData || source.extra_data || {};
            if (extra && typeof extra === 'object') return extra;
            if (typeof extra === 'string') {
                try {
                    return JSON.parse(extra) || {};
                } catch {
                    return {};
                }
            }
            return {};
        }

        function valueFromBooking(booking = {}, options = {}) {
            const source = options.renderBooking || booking || {};
            const bookingExtra = extraObject(booking);
            const sourceExtra = source === booking ? bookingExtra : extraObject(source);
            const direct = [
                source.pinataNumber,
                source.pinata_number,
                booking.pinataNumber,
                booking.pinata_number,
                sourceExtra.pinataNumber,
                sourceExtra.pinata_number,
                bookingExtra.pinataNumber,
                bookingExtra.pinata_number
            ].map(normalize).find(Boolean);
            if (direct) return direct;

            const textCandidates = Array.isArray(options.textCandidates) ? options.textCandidates : [];
            return textCandidates.concat([
                source.label,
                source.programName,
                source.program_name,
                source.programCode,
                source.program_code,
                source.name,
                source.title,
                booking.label,
                booking.programName,
                booking.program_name,
                booking.programCode,
                booking.program_code,
                booking.name,
                booking.title
            ]).map(extractFromText).find(Boolean) || '';
        }

        function fromCatalogId(id) {
            const raw = String(id || '').trim();
            if (!raw) return '';
            if (/^\d+$/.test(raw)) return String(OPERATIONAL_BASE + Number(raw));
            return normalize(raw);
        }

        function isPinataBooking(booking = {}) {
            const category = String(booking.category || '').trim().toLowerCase();
            const haystack = [
                category,
                booking.label,
                booking.programName,
                booking.program_name,
                booking.programCode,
                booking.program_code
            ].filter(Boolean).join(' ').toLocaleLowerCase('uk-UA');
            return category === 'pinata' || haystack.includes('пін');
        }

        return Object.freeze({
            OPERATIONAL_BASE,
            normalize,
            display,
            extractFromText,
            valueFromBooking,
            fromCatalogId,
            isPinataBooking
        });
    })();
}

function getSharedPinataNumbers() {
    return (typeof window !== 'undefined' && window.PinataNumbers)
        || (typeof globalThis !== 'undefined' && globalThis.PinataNumbers)
        || null;
}

function tooltipNormalizePinataNumber(value) {
    const helper = getSharedPinataNumbers();
    if (helper?.normalize) return helper.normalize(value);
    const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    return raw.replace(/^(?:№|#)\s*/u, '').trim();
}

function tooltipExtractPinataNumberFromText(value) {
    return getSharedPinataNumbers()?.extractFromText?.(value) || '';
}

function tooltipPinataNumberValue(booking = {}) {
    return getSharedPinataNumbers()?.valueFromBooking?.(booking) || '';
}

function tooltipPinataNumberDisplay(value) {
    return getSharedPinataNumbers()?.display?.(value) || tooltipNormalizePinataNumber(value);
}

function tooltipIsPinataBooking(booking = {}) {
    return getSharedPinataNumbers()?.isPinataBooking?.(booking) || false;
}

function showTooltip(e, booking) {
    booking = booking || {};
    const tooltip = typeof window.ensureBookingTooltip === 'function'
        ? window.ensureBookingTooltip()
        : document.getElementById('bookingTooltip');
    if (!tooltip) return;
    const pinataNumber = tooltipIsPinataBooking(booking) ? tooltipPinataNumberValue(booking) : '';
    if (tooltip._lastBookingId !== booking.id || tooltip._lastStatus !== booking.status || tooltip._lastPinataNumber !== pinataNumber) {
        tooltip._lastBookingId = booking.id;
        tooltip._lastStatus = booking.status;
        tooltip._lastPinataNumber = pinataNumber;
        const endTime = addMinutesToTime(booking.time, booking.duration);
        const statusBadge = `<span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>`;
        const pinataLine = pinataNumber ? `<br>🪅 Номер піньяти: ${escapeHtml(tooltipPinataNumberDisplay(pinataNumber))}` : '';
        tooltip.innerHTML = `
            <strong>${escapeHtml(booking.label)}: ${escapeHtml(booking.programName)}</strong><br>
            🕐 ${escapeHtml(booking.time)} - ${escapeHtml(endTime)}<br>
            🏠 ${escapeHtml(booking.room)} · ${statusBadge}
            ${pinataLine}
            ${booking.kidsCount ? '<br>👶 ' + escapeHtml(String(booking.kidsCount)) + ' дітей' : ''}
            ${booking.notes ? '<br>📝 ' + escapeHtml(booking.notes) : ''}
        `;
    }
    tooltip.style.left = `${e.pageX + 12}px`;
    tooltip.style.top = `${e.pageY - 10}px`;
    tooltip.style.display = '';
    tooltip.hidden = false;
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'false');
}

function moveTooltip(e) {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) {
        tooltip.style.left = `${e.pageX + 12}px`;
        tooltip.style.top = `${e.pageY - 10}px`;
    }
}

function hideTooltip() {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) {
        tooltip.hidden = true;
        tooltip.classList.add('hidden');
        tooltip.setAttribute('aria-hidden', 'true');
        tooltip.style.display = '';
        tooltip._lastBookingId = null;
        tooltip._lastPinataNumber = null;
    }
}

// ==========================================
// COMPACT MODE
// ==========================================

function _timelineBaseCellWidth(level, compact) {
    if (compact) return level === 15 ? 38 : level === 30 ? 44 : 64;
    return level === 15 ? 50 : level === 30 ? 80 : 120;
}

function _timelineViewportWidth() {
    const visualWidth = Number(window.visualViewport?.width || 0);
    return Math.round(visualWidth || window.innerWidth || document.documentElement?.clientWidth || 1440);
}

function _timelineViewportHeight() {
    const visualHeight = Number(window.visualViewport?.height || 0);
    return Math.round(visualHeight || window.innerHeight || document.documentElement?.clientHeight || 900);
}

function syncTimelineViewportMetrics() {
    const width = _timelineViewportWidth();
    const height = _timelineViewportHeight();
    const timelinePage = document.body?.classList?.contains('timeline-dashboard-page');
    const compactTimeline = false;
    document.documentElement.classList.toggle('timeline-dashboard-root', !!timelinePage);
    document.documentElement.classList.toggle('timeline-compact-mode', compactTimeline);
    document.body?.classList?.toggle('timeline-compact-mode', compactTimeline);
    if (width > 0) document.documentElement.style.setProperty('--eg-viewport-width', `${width}px`);
    if (height > 0) document.documentElement.style.setProperty('--eg-viewport-height', `${height}px`);
}

function _timelineActiveTimeRange() {
    if (typeof getTimeRange === 'function') {
        try {
            return getTimeRange(AppState.selectedDate || new Date());
        } catch (_) {}
    }

    const d = AppState.selectedDate || new Date();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    return {
        start: isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START,
        end: isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END
    };
}

function _timelineRangeBoundMinutes(value) {
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (match) {
            const hours = Number.parseInt(match[1], 10);
            const minutes = Number.parseInt(match[2] || '0', 10);
            if (Number.isFinite(hours) && Number.isFinite(minutes)) {
                return (hours * 60) + Math.max(0, Math.min(59, minutes));
            }
        }
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
}

function _timelineRangeCellCount(range, level) {
    const fallbackCellMinutes = (typeof CONFIG !== 'undefined' && CONFIG?.TIMELINE?.CELL_MINUTES) || 30;
    const cellMinutes = Math.max(1, Number(level) || fallbackCellMinutes);
    const startMinutes = _timelineRangeBoundMinutes(range?.start);
    let endMinutes = _timelineRangeBoundMinutes(range?.end);
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;
    return Math.max(1, Math.ceil((endMinutes - startMinutes) / cellMinutes));
}

function _timelineFitCellWidth(level, headerWidth, scrollPadding) {
    const scroll = document.getElementById('timelineScroll') || document.querySelector('.timeline-scroll');
    const container = scroll?.closest?.('.timeline-container') || document.querySelector('.timeline-container');
    const availableWidth = Math.max(
        0,
        (scroll?.clientWidth || container?.clientWidth || document.querySelector('.main-content')?.clientWidth || window.innerWidth || 1440) -
            headerWidth -
            (scrollPadding * 2) -
            16
    );
    const range = _timelineActiveTimeRange();
    const cells = _timelineRangeCellCount(range, level);
    return Math.floor(availableWidth / cells);
}

function _timelineResponsiveCellWidth(level, compact, headerWidth, scrollPadding) {
    const base = _timelineBaseCellWidth(level, compact);
    const viewportWidth = _timelineViewportWidth();
    if (viewportWidth <= 768) {
        // v0.69.20: phones must scroll horizontally instead of crushing readable time cells.
        if (viewportWidth <= 360) return level === 15 ? 36 : level === 30 ? 50 : 76;
        if (viewportWidth <= 390) return level === 15 ? 38 : level === 30 ? 54 : 80;
        if (viewportWidth <= 480) return level === 15 ? 42 : level === 30 ? 58 : 84;
        return level === 15 ? 44 : level === 30 ? 64 : 92;
    }
    if (compact) {
        const fitted = _timelineFitCellWidth(level, headerWidth, scrollPadding);
        const readableMinimum = level === 15 ? 38 : level === 30 ? 44 : 64;
        return Math.max(readableMinimum, Math.min(base, fitted || base));
    }
    if (level === 15 && viewportWidth > 768) return base;
    if (viewportWidth <= 1180) return Math.max(34, Math.round(base * 0.72));
    if (viewportWidth <= 1366) return Math.max(36, Math.round(base * 0.8));
    if (viewportWidth <= 1536) return Math.max(40, Math.round(base * 0.9));
    return base;
}

function _timelineResponsiveHeaderWidth() {
    const viewportWidth = _timelineViewportWidth();
    if (viewportWidth <= 360) return 56;
    if (viewportWidth <= 390) return 62;
    if (viewportWidth <= 480) return 84;
    if (viewportWidth <= 768) return 90;
    if (viewportWidth <= 1180) return 88;
    if (viewportWidth <= 1366) return 96;
    if (viewportWidth <= 1536) return 108;
    return 130;
}

function applyTimelineResponsiveDensity() {
    if (typeof CONFIG === 'undefined' || !CONFIG.TIMELINE) return false;
    syncTimelineViewportMetrics();
    const level = typeof normalizeTimelineZoomLevel === 'function'
        ? normalizeTimelineZoomLevel(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES)
        : (AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES || 30);
    AppState.compactMode = false;
    const compactKey = typeof timelineStorageKey === 'function' ? timelineStorageKey('compact_mode') : 'pzp_compact_mode';
    localStorage.removeItem(compactKey);
    const compact = false;
    const viewportWidth = _timelineViewportWidth();
    const nextHeaderWidth = compact
        ? viewportWidth <= 360
            ? 56
            : viewportWidth <= 390
                ? 62
            : viewportWidth <= 480
                ? 84
                : viewportWidth <= 768
                    ? 84
                    : viewportWidth <= 1180
                        ? 74
                        : viewportWidth <= 1366
                            ? 80
                            : viewportWidth <= 1536
                                ? 84
                                : 92
        : _timelineResponsiveHeaderWidth();
    const nextScrollPadding = compact ? (viewportWidth <= 768 ? 6 : 8) : (viewportWidth <= 1536 ? 14 : 20);
    const nextCellWidth = _timelineResponsiveCellWidth(level, compact, nextHeaderWidth, nextScrollPadding);
    const nextLineHeight = compact ? (level === 15 ? 44 : level === 30 ? 40 : 46) : (level === 15 ? 64 : level === 30 ? 72 : 80);
    const changed = CONFIG.TIMELINE.CELL_WIDTH !== nextCellWidth;

    CONFIG.TIMELINE.CELL_WIDTH = nextCellWidth;
    CONFIG.TIMELINE.CELL_MINUTES = level;
    document.documentElement.style.setProperty('--timeline-cell-w', `${nextCellWidth}px`);
    document.documentElement.style.setProperty('--timeline-line-header-w', `${nextHeaderWidth}px`);
    document.documentElement.style.setProperty('--timeline-scroll-pad', `${nextScrollPadding}px`);
    document.documentElement.style.setProperty('--timeline-line-min-h', `${nextLineHeight}px`);
    document.documentElement.style.setProperty('--timeline-density', compact ? 'compact' : 'regular');
    document.documentElement.classList.toggle('timeline-compact-mode', compact);
    document.body?.classList?.toggle('timeline-compact-mode', compact);

    const container = document.querySelector('.timeline-container');
    if (container) {
        container.classList.toggle('compact', compact);
        container.dataset.zoom = level;
        container.dataset.timelineDensity = viewportWidth <= 1536 ? 'tight' : 'regular';
        container.dataset.fitScreen = compact && viewportWidth > 768 ? 'true' : 'scroll';
    }

    return changed;
}

function timelineOuterHeight(el) {
    if (!el || el.hidden || el.classList?.contains('hidden')) return 0;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && style.display === 'none') return 0;
    const rectHeight = Number(el.getBoundingClientRect?.().height || 0);
    const contentHeight = Math.max(rectHeight, Number(el.scrollHeight || 0), Number(el.offsetHeight || 0));
    if (!contentHeight) return 0;
    const marginTop = parseFloat(style?.marginTop || '0') || 0;
    const marginBottom = parseFloat(style?.marginBottom || '0') || 0;
    return contentHeight + marginTop + marginBottom;
}

function timelineDirectLineCount(lines) {
    if (!lines) return 0;
    try {
        return lines.querySelectorAll(':scope > .timeline-line').length;
    } catch (_) {
        return Array.from(lines.children || []).filter(child => child?.classList?.contains('timeline-line')).length;
    }
}

function resetTimelineVerticalScroll(reason = 'manual') {
    const scroll = document.getElementById('timelineScroll');
    const container = document.querySelector('.timeline-container');
    if (!scroll) return false;

    const left = Number(scroll.scrollLeft || 0);
    scroll.scrollTop = 0;
    try {
        scroll.scrollTo({ left, top: 0, behavior: 'auto' });
    } catch (_) {
        scroll.scrollTop = 0;
        scroll.scrollLeft = left;
    }

    scroll.dataset.timelineVerticalScrollReset = String(reason || 'manual');
    if (container) {
        container.dataset.timelineVerticalScrollReset = String(reason || 'manual');
    }
    return true;
}

window.resetTimelineVerticalScroll = resetTimelineVerticalScroll;

function syncTimelineViewHeight(reason = 'manual', options = {}) {
    const container = document.querySelector('.timeline-container');
    const scroll = document.getElementById('timelineScroll');
    const timeScale = document.getElementById('timeScale');
    const lines = document.getElementById('timelineLines');
    if (!container || !scroll || !lines) return false;

    const view = document.body?.classList?.contains('timeline-view-rooms') ? 'rooms' : 'animators';
    const lineCount = timelineDirectLineCount(lines);
    container.dataset.timelineView = view;
    container.dataset.lineCount = String(lineCount);
    scroll.dataset.timelineView = view;
    scroll.dataset.lineCount = String(lineCount);
    const resetVerticalScroll = Boolean(options?.resetVerticalScroll);
    if (resetVerticalScroll) {
        resetTimelineVerticalScroll(`${reason || 'manual'}:before-height`);
    }

    if (typeof AppState !== 'undefined' && AppState.multiDayMode) {
        delete container.dataset.timelineHeightReady;
        delete container.dataset.timelineHeightReason;
        container.style.removeProperty('--timeline-content-height');
        return false;
    }

    if (view !== 'animators') {
        delete container.dataset.timelineHeightReady;
        delete container.dataset.timelineHeightReason;
        container.style.removeProperty('--timeline-content-height');
        return false;
    }

    const scrollStyle = typeof getComputedStyle === 'function' ? getComputedStyle(scroll) : null;
    const verticalPadding = (parseFloat(scrollStyle?.paddingTop || '0') || 0)
        + (parseFloat(scrollStyle?.paddingBottom || '0') || 0);
    const addLineBtn = document.getElementById('addLineBtn');
    const contentHeight = Math.ceil(
        verticalPadding
        + timelineOuterHeight(timeScale)
        + timelineOuterHeight(lines)
        + timelineOuterHeight(addLineBtn)
    );

    if (!contentHeight) {
        delete container.dataset.timelineHeightReady;
        delete container.dataset.timelineHeightReason;
        container.style.removeProperty('--timeline-content-height');
        return false;
    }

    container.style.setProperty('--timeline-content-height', `${contentHeight}px`);
    container.dataset.timelineHeightReady = 'true';
    container.dataset.timelineHeightReason = String(reason || 'manual');

    const maxScrollTop = Math.max(0, Number(scroll.scrollHeight || 0) - Number(scroll.clientHeight || 0));
    if (resetVerticalScroll) {
        resetTimelineVerticalScroll(`${reason || 'manual'}:after-height`);
    } else if (scroll.scrollTop > maxScrollTop) {
        scroll.scrollTop = maxScrollTop;
    }

    return true;
}

window.syncTimelineViewHeight = syncTimelineViewHeight;

function scheduleTimelineViewHeightSync(reason = 'manual', options = {}) {
    const run = () => syncTimelineViewHeight(reason, options);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
        setTimeout(run, 0);
    }
}

window.scheduleTimelineViewHeightSync = scheduleTimelineViewHeightSync;
window.addEventListener?.('timeline:view-changed', event => {
    const detail = event?.detail || {};
    scheduleTimelineViewHeightSync('view-changed', {
        resetVerticalScroll: detail.view !== detail.previousView
    });
});

function initTimelineResponsiveResize() {
    if (window.__timelineResponsiveResizeBound) return;
    window.__timelineResponsiveResizeBound = true;
    let resizeTimer = null;
    let lastViewportSignature = '';
    const handleResize = () => {
        const viewportSignature = `${_timelineViewportWidth()}x${_timelineViewportHeight()}`;
        if (viewportSignature === lastViewportSignature) return;
        lastViewportSignature = viewportSignature;
        syncTimelineViewportMetrics();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const changed = applyTimelineResponsiveDensity();
            if (changed && typeof renderTimeline === 'function') renderTimeline();
            scheduleTimelineViewHeightSync('resize');
            if (typeof renderNowLine === 'function') renderNowLine();
        }, 120);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    window.visualViewport?.addEventListener?.('resize', handleResize, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', handleResize, { passive: true });
}

function toggleCompactMode(event) {
    const toggle = document.getElementById('compactModeToggle');
    const previousCompactMode = Boolean(AppState.compactMode);
    AppState.compactMode = false;
    const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('compact_mode') : 'pzp_compact_mode';
    localStorage.removeItem(key);
    applyTimelineResponsiveDensity();
    if (typeof syncTimelineCompactToggleAria === 'function') {
        syncTimelineCompactToggleAria();
    } else if (toggle) {
        toggle.checked = false;
        toggle.setAttribute('aria-checked', 'false');
        const chip = toggle.closest?.('.timeline-compact-toggle');
        chip?.classList.toggle('active', false);
        chip?.removeAttribute('aria-pressed');
    }
    if (previousCompactMode !== Boolean(AppState.compactMode) && typeof markTimelineNavigationScrollReset === 'function') {
        markTimelineNavigationScrollReset('compact-change');
    }
    renderTimeline();
}

// ==========================================
// ZOOM (15/30/60 хв)
// ==========================================

function changeZoom(level) {
    const previousLevel = AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES;
    const nextLevel = typeof normalizeTimelineZoomLevel === 'function'
        ? normalizeTimelineZoomLevel(level)
        : (parseInt(level, 10) || 30);
    AppState.zoomLevel = nextLevel;
    CONFIG.TIMELINE.CELL_MINUTES = nextLevel;
    const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('zoom_level') : 'pzp_zoom_level';
    localStorage.setItem(key, nextLevel);
    applyTimelineResponsiveDensity();
    updateZoomButtons();
    if (previousLevel !== nextLevel && typeof markTimelineNavigationScrollReset === 'function') {
        markTimelineNavigationScrollReset('zoom-change');
    }
    renderTimeline();
}

function updateZoomButtons() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        const active = parseInt(btn.dataset.zoom) === AppState.zoomLevel;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

// ==========================================
// UNDO
// ==========================================

function pushUndo(action, data) {
    AppState.undoStack.push({ action, data, timestamp: Date.now() });
    if (AppState.undoStack.length > 10) AppState.undoStack.shift();
    // v30.3: Clear redo stack on new action (standard undo/redo behavior)
    AppState.redoStack = [];
    updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.classList.toggle('hidden', AppState.undoStack.length === 0);
    if (redoBtn) redoBtn.classList.toggle('hidden', AppState.redoStack.length === 0);
}

// v30.3: Backward compat alias
function updateUndoButton() { updateUndoRedoButtons(); }

async function handleUndo() {
    if (AppState.undoStack.length === 0) return;
    const item = AppState.undoStack.pop();
    // v30.3: Push to redo stack for redo support
    AppState.redoStack.push(item);
    if (AppState.redoStack.length > 10) AppState.redoStack.shift();

    if (item.action === 'create') {
        for (const b of item.data) {
            await apiDeleteBooking(b.id);
        }
        await apiAddHistory('undo_create', AppState.currentUser?.username, item.data[0]);
        showNotification('Створення скасовано', 'warning');
    } else if (item.action === 'delete') {
        for (const b of item.data) {
            await apiCreateBooking(b);
        }
        await apiAddHistory('undo_delete', AppState.currentUser?.username, item.data[0]);
        showNotification('Видалення скасовано', 'warning');
    } else if (item.action === 'edit') {
        const old = item.data.old;
        await apiUpdateBooking(old.id, old);
        await apiAddHistory('undo_edit', AppState.currentUser?.username, old);
        showNotification('Редагування скасовано', 'warning');
    } else if (item.action === 'shift') {
        const { bookingId, minutes, linked } = item.data;
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            const revertedTime = addMinutesToTime(booking.time, minutes);
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, {
                main: { time: revertedTime },
                linked: linked
                    .map(linkedId => bookings.find(b => b.id === linkedId))
                    .filter(Boolean)
                    .map(lb => ({ id: lb.id, time: addMinutesToTime(lb.time, minutes) })),
                historyAction: 'undo_shift',
                historyData: { ...booking, time: revertedTime, shiftMinutes: minutes }
            });
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка скасування переносу часу', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
        }
        showNotification('Перенос часу скасовано', 'warning');
    }

    AppState.cachedBookings = {};
    await renderTimeline();
    updateUndoRedoButtons();
}

// ==========================================
// v30.3: REDO
// ==========================================

async function handleRedo() {
    if (AppState.redoStack.length === 0) return;
    const item = AppState.redoStack.pop();
    // Push back to undo without clearing redo
    AppState.undoStack.push(item);
    if (AppState.undoStack.length > 10) AppState.undoStack.shift();

    if (item.action === 'create') {
        for (const b of item.data) {
            await apiCreateBooking(b);
        }
        showNotification('Створення повторено', 'info');
    } else if (item.action === 'delete') {
        for (const b of item.data) {
            await apiDeleteBooking(b.id);
        }
        showNotification('Видалення повторено', 'info');
    } else if (item.action === 'edit') {
        const old = item.data.old;
        // For redo of edit, we need the "new" state — but we stored "old"
        // After undo, the server has the "old" state, so redo re-applies the original edit
        // Since we don't store the new state separately, we just notify
        showNotification('Для повтору редагування — повторіть дію вручну', 'warning');
    } else if (item.action === 'shift') {
        const { bookingId, minutes, linked } = item.data;
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            // Re-apply the shift (opposite of undo direction)
            const newTime = addMinutesToTime(booking.time, -minutes);
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, {
                main: { time: newTime },
                linked: linked
                    .map(linkedId => bookings.find(b => b.id === linkedId))
                    .filter(Boolean)
                    .map(lb => ({ id: lb.id, time: addMinutesToTime(lb.time, -minutes) })),
                historyAction: 'shift',
                historyData: { ...booking, time: newTime, shiftMinutes: -minutes }
            });
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка повтору переносу часу', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
        }
        showNotification('Перенос часу повторено', 'info');
    }

    AppState.cachedBookings = {};
    await renderTimeline();
    updateUndoRedoButtons();
}

// ==========================================
// SWIPE (mobile)
// ==========================================

function setupSwipe() {
    const container = document.getElementById('timelineScroll');
    if (!container || container._swipeAttached) return;
    container._swipeAttached = true;
    let startX = 0, startY = 0, startScrollLeft = 0;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startScrollLeft = container.scrollLeft;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        // v7.8.1: Ignore swipe if timeline actually scrolled horizontally
        const scrollDelta = Math.abs(container.scrollLeft - startScrollLeft);
        if (scrollDelta > 5) return;

        // v7.8.1: Skip date swipe in multi-day mode
        if (AppState.multiDayMode) return;

        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        // v7.8.1: Increased threshold 80→150px to prevent accidental date switches
        if (Math.abs(dx) > 150 && Math.abs(dx) > Math.abs(dy) * 2.5) {
            changeDate(dx > 0 ? -1 : 1);
        }
    }, { passive: true });
}

// ==========================================
// MINIMAP
// ==========================================

let _minimapHash = null;

function renderMinimap(snapshotDate) {
    const minimap = document.getElementById('minimapContainer');
    if (!minimap || AppState.multiDayMode) {
        if (minimap) minimap.classList.add('hidden');
        return;
    }
    minimap.classList.remove('hidden');
    renderMinimapAsync(minimap, snapshotDate);
}

async function renderMinimapAsync(container, snapshotDate) {
    // v7.0.1: Use snapshot date to avoid reading stale AppState.selectedDate
    const date = snapshotDate || AppState.selectedDate;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    canvas.width = container.clientWidth || 300;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    const computed = getComputedStyle(document.body);
    const minimapBg = computed.getPropertyValue('--eg-scrubber-track').trim() || (AppState.darkMode ? '#1B1B31' : '#F3F6FA');
    const nowLineColor = computed.getPropertyValue('--eg-danger').trim() || '#E54868';

    ctx.fillStyle = minimapBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bookings = normalizeTimelineExportBookings(await getBookingsForDate(date));
    const lines = normalizeTimelineExportLines(await getLinesForDate(date));

    // Memoize: skip redraw if data hasn't changed
    const hash = date + ':' + bookings.length + ':' + bookings.map(b => b.id + b.status).join(',');
    if (hash === _minimapHash) return;
    _minimapHash = hash;

    const { start, end } = getTimeRange(date);
    const totalMin = (end - start) * 60;
    const lh = Math.max(6, (canvas.height - 4) / Math.max(lines.length, 1));

    lines.forEach((line, i) => {
        const y = 2 + i * lh;
        getTimelineExportLineBookings(bookings, line).forEach(b => {
            const bStart = timeToMinutes(b.time) - start * 60;
            const x = (bStart / totalMin) * canvas.width;
            const w = Math.max((b.duration / totalMin) * canvas.width, 2);
            ctx.fillStyle = CATEGORY_COLORS[b.category] || '#607D8B';
            if (b.status === 'preliminary') ctx.globalAlpha = 0.5;
            ctx.fillRect(x, y, w, lh - 1);
            ctx.globalAlpha = 1;
        });
    });

    // Now line
    const now = new Date();
    if (formatDate(date) === formatDate(now)) {
        const nowMin = now.getHours() * 60 + now.getMinutes() - start * 60;
        if (nowMin >= 0 && nowMin <= totalMin) {
            const x = (nowMin / totalMin) * canvas.width;
            ctx.strokeStyle = nowLineColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }
}

// ==========================================
// ЗМІНА СТАТУСУ БРОНЮВАННЯ
// ==========================================

async function changeBookingStatus(bookingId, newStatus) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) {
            showNotification('Бронювання не знайдено. Оновіть timeline і спробуйте ще раз.', 'error');
            return;
        }

        const refreshTimeline = async () => {
            if (typeof window.invalidateTimelineDateCache === 'function') window.invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
            else delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
            closeAllModals();
            await renderTimeline();
        };

        if (newStatus === 'confirmed' && booking.status === 'preliminary' && typeof apiConfirmBooking === 'function') {
            const confirmResult = await apiConfirmBooking(bookingId, { source: 'booking_panel' });
            if (!confirmResult || confirmResult.success === false) {
                showNotification(confirmResult?.error || 'Не вдалося підтвердити бронювання', 'error');
                return;
            }
            await refreshTimeline();
            showNotification('Бронювання підтверджено', 'success');
            return;
        }

        if (newStatus === 'preliminary' && booking.status !== 'preliminary' && typeof apiMarkBookingPreliminary === 'function') {
            const preliminaryResult = await apiMarkBookingPreliminary(bookingId, { source: 'booking_panel' });
            if (!preliminaryResult || preliminaryResult.success === false) {
                showNotification(preliminaryResult?.error || 'Не вдалося зробити бронювання попереднім', 'error');
                return;
            }
            await refreshTimeline();
            showNotification('Бронювання зроблено попереднім', 'success');
            return;
        }

        if (booking.status === newStatus) {
            await refreshTimeline();
            showNotification(newStatus === 'preliminary' ? 'Бронювання вже попереднє' : 'Бронювання вже підтверджене', 'success');
            return;
        }

        showNotification('Невідома дія зміни статусу бронювання', 'error');
    } catch (error) {
        handleError('Зміна статусу бронювання', error);
    }
}

// ==========================================
// ЕКСПОРТ У КАРТИНКУ
// ==========================================

function getTimelineExportBrandName() {
    const ctx = window.TimelineBusinessContext?.current?.();
    return ctx?.brandName || ctx?.productName || 'Парк Закревського Періоду';
}

function restoreTimelineDocumentTitle() {
    const ctx = window.TimelineBusinessContext?.current?.();
    document.title = ctx?.title || getTimelineExportBrandName();
}

function drawExportHeader(ctx, canvas, padding, headerHeight, dateLabel) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#00A651';
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`${getTimelineExportBrandName()} - Таймлайн`, padding, 35);

    ctx.font = '20px Arial';
    const label = dateLabel || `${formatDate(AppState.selectedDate)} (${DAYS[AppState.selectedDate.getDay()]})`;
    ctx.fillText(label, padding, 60);
}

function drawExportTimeScale(ctx, start, end, padding, timeWidth, headerHeight, cellWidth) {
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += 30) {
            const x = padding + timeWidth + ((h - start) * 4 + m / 15) * cellWidth;
            ctx.fillStyle = m === 0 ? '#333333' : '#888888';
            ctx.font = m === 0 ? 'bold 14px Arial' : '12px Arial';
            ctx.fillText(`${h}:${String(m).padStart(2, '0')}`, x, headerHeight + padding - 10);
        }
    }
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';
    const endX = padding + timeWidth + ((end - start) * 4) * cellWidth;
    ctx.fillText(`${end}:00`, endX, headerHeight + padding - 10);
}

function normalizeTimelineExportLines(lines = []) {
    const safeLines = Array.isArray(lines) ? lines : [];
    if (typeof normalizeTimelineLinesForContext === 'function') {
        return normalizeTimelineLinesForContext(safeLines);
    }
    return safeLines;
}

function normalizeTimelineExportBookings(bookings = []) {
    const safeBookings = Array.isArray(bookings) ? bookings : [];
    if (typeof normalizeTimelineBookingsForContext === 'function') {
        return normalizeTimelineBookingsForContext(safeBookings);
    }
    return safeBookings;
}

function getTimelineExportLineBookings(bookings = [], line = {}) {
    if (typeof timelineBookingsForLine === 'function') {
        return timelineBookingsForLine(bookings, line);
    }
    const lineId = String(line?.id || line?.lineId || line?.line_id || '').trim();
    return (Array.isArray(bookings) ? bookings : []).filter(booking => {
        const bookingLineId = String(booking?.lineId || booking?.line_id || booking?.resourceId || booking?.resource_id || '').trim();
        return bookingLineId && lineId && bookingLineId === lineId;
    });
}

function drawExportLines(ctx, lines, bookings, start, padding, timeWidth, headerHeight, lineHeight, cellWidth, canvasWidth) {
    lines.forEach((line, index) => {
        const y = headerHeight + padding + index * lineHeight;

        ctx.fillStyle = index % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
        ctx.fillRect(padding, y, canvasWidth - padding * 2, lineHeight);

        ctx.fillStyle = line.color;
        ctx.fillRect(padding, y, 4, lineHeight);

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(line.name, padding + 12, y + lineHeight / 2 + 5);

        const lineBookings = getTimelineExportLineBookings(bookings, line);
        lineBookings.forEach(booking => {
            const startMin = timeToMinutes(booking.time) - timeToMinutes(`${start}:00`);
            const bx = padding + timeWidth + (startMin / 15) * cellWidth;
            const bw = (booking.duration / 15) * cellWidth - 4;
            const by = y + 8;
            const bh = lineHeight - 16;

            ctx.fillStyle = CATEGORY_COLORS[booking.category] || '#607D8B';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(bx, by, bw, bh, 6);
            } else {
                const r = 6;
                ctx.moveTo(bx + r, by);
                ctx.lineTo(bx + bw - r, by);
                ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
                ctx.lineTo(bx + bw, by + bh - r);
                ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
                ctx.lineTo(bx + r, by + bh);
                ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
                ctx.lineTo(bx, by + r);
                ctx.arcTo(bx, by, bx + r, by, r);
                ctx.closePath();
            }
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 11px Arial';
            // v30.7: Richer export info — time, program, room, kids, group
            const progName = booking.label || booking.programCode || '';
            const timeStr = booking.time || '';
            const durStr = booking.duration ? `${booking.duration}хв` : '';
            const roomStr = booking.room || '';
            const kidsStr = booking.kidsCount ? `${booking.kidsCount} діт.` : '';
            const groupStr = booking.groupName || '';
            // Line 1: time + program
            const line1 = `${timeStr} ${progName}`.trim();
            // Line 2: room, kids, group
            const line2Parts = [roomStr, kidsStr, groupStr].filter(Boolean);
            const line2 = line2Parts.join(' · ');
            if (bh > 30 && line2) {
                ctx.fillText(line1, bx + 6, by + bh / 2 - 2, bw - 12);
                ctx.font = '10px Arial';
                ctx.fillText(line2, bx + 6, by + bh / 2 + 12, bw - 12);
            } else {
                ctx.fillText(`${line1} ${roomStr ? '| ' + roomStr : ''}`, bx + 6, by + bh / 2 + 4, bw - 12);
            }
        });
    });
}

function drawExportGrid(ctx, start, end, padding, timeWidth, headerHeight, cellWidth, canvasHeight) {
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;

    for (let h = start; h <= end; h++) {
        const x = padding + timeWidth + (h - start) * 4 * cellWidth;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight + padding);
        ctx.lineTo(x, canvasHeight - padding);
        ctx.stroke();
    }
}

function isTouchImageExportDevice() {
    const ua = navigator.userAgent || '';
    const mobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
    const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    return mobileUa || coarsePointer;
}

function openTouchImageExportWindow() {
    if (!isTouchImageExportDevice()) return null;
    try {
        const win = window.open('', '_blank');
        if (win) {
            win.document.write('<!doctype html><html lang="uk"><head><title>Експорт</title></head><body style="font-family:system-ui;padding:20px">Готуємо зображення...</body></html>');
        }
        return win;
    } catch (_) {
        return null;
    }
}

function finishCanvasImageExport(canvas, filename, successMessage, touchWindow) {
    const dataUrl = canvas.toDataURL('image/png');
    if (touchWindow && !touchWindow.closed) {
        const safeFilename = window.escapeHtml ? window.escapeHtml(filename) : String(filename).replace(/[<>&"]/g, '');
        touchWindow.document.open();
        touchWindow.document.write(`<!doctype html><html lang="uk"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeFilename}</title><style>body{margin:0;padding:16px;background:#07111f;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}img{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35)}p{font-size:15px;line-height:1.45;color:#cbd5e1}</style></head><body><img src="${dataUrl}" alt="${safeFilename}"><p>На iPhone затисніть зображення, щоб зберегти або поділитися ним.</p></body></html>`);
        touchWindow.document.close();
        showNotification('Зображення відкрито в окремому вікні для збереження', 'success');
        return;
    }

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
    showNotification(successMessage, 'success');
}

async function exportTimelineImage() {
    // v30.7: Support multi-day export
    if (AppState.multiDayMode) {
        if (typeof normalizeTimelineModeState === 'function') normalizeTimelineModeState(AppState);
        return exportMultiDayImage();
    }

    const touchWindow = openTouchImageExportWindow();
    try {
        const rawBookings = await getBookingsForDate(AppState.selectedDate);
        const rawLines = await getLinesForDate(AppState.selectedDate);
        const bookings = normalizeTimelineExportBookings(rawBookings);
        const lines = normalizeTimelineExportLines(rawLines);
        const { start, end } = getTimeRange();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('timeline_canvas_context_unavailable');

        const dpi = 150;
        canvas.width = 297 * dpi / 25.4;
        canvas.height = 210 * dpi / 25.4;

        const padding = 40;
        const headerHeight = 80;
        const lineHeight = (canvas.height - headerHeight - padding * 2) / Math.max(lines.length, 1);
        const timeWidth = 120;
        const cellWidth = (canvas.width - padding * 2 - timeWidth) / ((end - start) * 4);

        const dateLabel = `${formatDate(AppState.selectedDate)} (${DAYS[AppState.selectedDate.getDay()]})`;
        drawExportHeader(ctx, canvas, padding, headerHeight, dateLabel);
        drawExportTimeScale(ctx, start, end, padding, timeWidth, headerHeight, cellWidth);
        drawExportLines(ctx, lines, bookings, start, padding, timeWidth, headerHeight, lineHeight, cellWidth, canvas.width);
        drawExportGrid(ctx, start, end, padding, timeWidth, headerHeight, cellWidth, canvas.height);

        finishCanvasImageExport(
            canvas,
            `timeline_${formatDate(AppState.selectedDate)}.png`,
            'Таймлайн експортовано як картинку!',
            touchWindow
        );
    } catch (err) {
        if (touchWindow && !touchWindow.closed) touchWindow.close();
        console.error('Timeline image export failed:', err);
        showNotification('Помилка експорту таймлайну', 'error');
    }
}

// v30.7: Multi-day PNG export — each day as a separate section
async function exportMultiDayImage() {
    if (typeof normalizeTimelineModeState === 'function') normalizeTimelineModeState(AppState);
    const touchWindow = openTouchImageExportWindow();
    try {
    const dates = [];
    const startDate = new Date(AppState.selectedDate);
    for (let i = 0; i < AppState.daysToShow; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }

    // Collect all data first
    const daysData = [];
    for (const date of dates) {
        const rawBookings = await getBookingsForDate(date);
        const rawLines = await getLinesForDate(date);
        const bookings = normalizeTimelineExportBookings(rawBookings);
        const lines = normalizeTimelineExportLines(rawLines);
        daysData.push({ date, bookings, lines });
    }

    const dpi = 150;
    const canvasWidth = 297 * dpi / 25.4;
    const padding = 40;
    const headerHeight = 80;
    const dayHeaderHeight = 36;
    const lineHeight = 50;
    const timeWidth = 120;

    // Calculate total height: header + each day (day header + lines)
    let totalHeight = headerHeight + padding * 2;
    for (const dd of daysData) {
        totalHeight += dayHeaderHeight + Math.max(dd.lines.length, 1) * lineHeight + 10;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('timeline_canvas_context_unavailable');
    canvas.width = canvasWidth;
    canvas.height = totalHeight;

    // Determine time range (use widest across all days)
    let globalStart = 12, globalEnd = 20;
    for (const dd of daysData) {
        const dow = dd.date.getDay();
        const isWknd = dow === 0 || dow === 6;
        const s = isWknd ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
        const e = isWknd ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
        if (s < globalStart) globalStart = s;
        if (e > globalEnd) globalEnd = e;
    }

    const cellWidth = (canvasWidth - padding * 2 - timeWidth) / ((globalEnd - globalStart) * 4);

    // Header
    const firstDateStr = formatDateUkr(dates[0]);
    const lastDateStr = formatDateUkr(dates[dates.length - 1]);
    const dateLabel = `${firstDateStr} — ${lastDateStr}`;
    drawExportHeader(ctx, canvas, padding, headerHeight, dateLabel);

    // Draw each day
    let yOffset = headerHeight + padding;
    for (const dd of daysData) {
        // Day sub-header
        ctx.fillStyle = '#E8F5E9';
        ctx.fillRect(padding, yOffset, canvasWidth - padding * 2, dayHeaderHeight);
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        const dayLabel = `${DAYS[dd.date.getDay()]}, ${formatDateUkr(dd.date)}`;
        ctx.fillText(dayLabel, padding + 10, yOffset + dayHeaderHeight / 2 + 5);
        yOffset += dayHeaderHeight;

        // Lines and bookings for this day
        dd.lines.forEach((line, index) => {
            const y = yOffset + index * lineHeight;

            ctx.fillStyle = index % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
            ctx.fillRect(padding, y, canvasWidth - padding * 2, lineHeight);

            ctx.fillStyle = line.color;
            ctx.fillRect(padding, y, 4, lineHeight);

            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(line.name, padding + 12, y + lineHeight / 2 + 5);

            const lineBookings = getTimelineExportLineBookings(dd.bookings, line);
            lineBookings.forEach(booking => {
                const startMin = timeToMinutes(booking.time) - timeToMinutes(`${globalStart}:00`);
                const bx = padding + timeWidth + (startMin / 15) * cellWidth;
                const bw = (booking.duration / 15) * cellWidth - 4;
                const by = y + 6;
                const bh = lineHeight - 12;

                ctx.fillStyle = CATEGORY_COLORS[booking.category] || '#607D8B';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(bx, by, bw, bh, 6);
                } else {
                    const r = 6;
                    ctx.moveTo(bx + r, by); ctx.lineTo(bx + bw - r, by);
                    ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
                    ctx.lineTo(bx + bw, by + bh - r);
                    ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
                    ctx.lineTo(bx + r, by + bh);
                    ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
                    ctx.lineTo(bx, by + r);
                    ctx.arcTo(bx, by, bx + r, by, r);
                    ctx.closePath();
                }
                ctx.fill();

                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 11px Arial';
                const progName = booking.label || booking.programCode || '';
                const timeStr = booking.time || '';
                const roomStr = booking.room || '';
                const kidsStr = booking.kidsCount ? `${booking.kidsCount} діт.` : '';
                const line1 = `${timeStr} ${progName}`.trim();
                const line2Parts = [roomStr, kidsStr, booking.groupName || ''].filter(Boolean);
                const line2 = line2Parts.join(' · ');
                if (bh > 26 && line2) {
                    ctx.fillText(line1, bx + 6, by + bh / 2 - 2, bw - 12);
                    ctx.font = '10px Arial';
                    ctx.fillText(line2, bx + 6, by + bh / 2 + 10, bw - 12);
                } else {
                    ctx.fillText(`${line1}${roomStr ? ' | ' + roomStr : ''}`, bx + 6, by + bh / 2 + 4, bw - 12);
                }
            });
        });

        yOffset += Math.max(dd.lines.length, 1) * lineHeight + 10;
    }

    // Time scale at top (after header)
    drawExportTimeScale(ctx, globalStart, globalEnd, padding, timeWidth, headerHeight, cellWidth);

    const fname = `timeline_${formatDate(dates[0])}_${formatDate(dates[dates.length - 1])}.png`;
    finishCanvasImageExport(canvas, fname, 'Таймлайн експортовано як картинку!', touchWindow);
    } catch (err) {
        if (touchWindow && !touchWindow.closed) touchWindow.close();
        console.error('Timeline multi-day image export failed:', err);
        showNotification('Помилка експорту таймлайну', 'error');
    }
}

// ==========================================
// v30.3: PDF EXPORT (Print-based)
// ==========================================

function exportTimelinePdf() {
    if (typeof normalizeTimelineModeState === 'function') normalizeTimelineModeState(AppState);
    // Add print class for CSS targeting
    document.body.classList.add('printing-timeline');

    // v30.7: Support multi-day title
    let titleStr;
    if (AppState.multiDayMode) {
        const dates = [];
        const startDate = new Date(AppState.selectedDate);
        for (let i = 0; i < AppState.daysToShow; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            dates.push(d);
        }
        titleStr = `Таймлайн ${formatDateUkr(dates[0])} — ${formatDateUkr(dates[dates.length - 1])}`;
    } else {
        titleStr = `Таймлайн ${formatDate(AppState.selectedDate)}`;
    }
    document.title = `${titleStr} — ${getTimelineExportBrandName()}`;

    window.print();

    // Restore
    setTimeout(() => {
        document.body.classList.remove('printing-timeline');
        restoreTimelineDocumentTitle();
    }, 500);
}

// ==========================================
// POINTS PANEL — Role-Based Dashboard
// ==========================================

const POINTS_ROLE_HIERARCHY = [
    { key: 'creator', name: 'Творець', icon: '👑', tier: 'executive' },
    { key: 'director', name: 'Директор', icon: '🎯', tier: 'executive' },
    { key: 'vice_director', name: 'Заст. директора', icon: '📋', tier: 'executive' },
    { key: 'senior_manager', name: 'Старший менеджер', icon: '⭐', tier: 'management' },
    { key: 'manager', name: 'Менеджер', icon: '📊', tier: 'management' },
    { key: 'admin', name: 'Адміністратор', icon: '🔧', tier: 'operational' },
    { key: 'senior_instructor', name: 'Адміністратор ігрових зон', icon: '🎓', tier: 'operational' },
    { key: 'instructor', name: 'Інструктор батутів', icon: '📚', tier: 'field' },
    { key: 'animator', name: 'Аніматор', icon: '🎭', tier: 'field' },
    { key: 'security', name: 'Охорона', icon: '🛡️', tier: 'field' },
    { key: 'waiter', name: 'Офіціант', icon: '🍽️', tier: 'field' }
];

const TIER_INFO = {
    executive: { label: 'Керівництво', color: '#8b5cf6' },
    management: { label: 'Управління', color: '#3b82f6' },
    operational: { label: 'Операційний', color: '#22c55e' },
    field: { label: 'Польовий', color: '#f59e0b' }
};

// Role-specific info boards
const ROLE_BOARDS = {
    executive: [
        { id: 'kpi', icon: '📊', label: 'KPI команди', desc: 'Продуктивність, виручка, задоволеність' },
        { id: 'team', icon: '👥', label: 'Огляд команди', desc: 'Хто працює, навантаження, графік' },
        { id: 'finance', icon: '💰', label: 'Фінанси', desc: 'Дохід, витрати, прогноз' },
        { id: 'alerts', icon: '🚨', label: 'Сповіщення', desc: 'Критичні події та ескалації' }
    ],
    management: [
        { id: 'tasks', icon: '📋', label: 'Задачі команди', desc: 'Статус задач підлеглих' },
        { id: 'schedule', icon: '📅', label: 'Графік', desc: 'Розклад на сьогодні/тиждень' },
        { id: 'bookings', icon: '📞', label: 'Бронювання', desc: 'Поточні та очікувані' },
        { id: 'reports', icon: '📈', label: 'Звіти', desc: 'Тижневі показники' }
    ],
    operational: [
        { id: 'my-tasks', icon: '✅', label: 'Мої задачі', desc: 'Що потрібно зробити сьогодні' },
        { id: 'schedule', icon: '📅', label: 'Мій графік', desc: 'Коли я працюю' },
        { id: 'programs', icon: '🎪', label: 'Програми', desc: 'Програми на сьогодні' },
        { id: 'streak', icon: '🔥', label: 'Мій стрік', desc: 'Серія та досягнення' }
    ],
    field: [
        { id: 'my-tasks', icon: '✅', label: 'Мої задачі', desc: 'Задачі на сьогодні' },
        { id: 'my-rank', icon: '🏅', label: 'Моє місце', desc: 'Позиція в рейтингу' },
        { id: 'streak', icon: '🔥', label: 'Стрік', desc: 'Моя серія' },
        { id: 'tips', icon: '💡', label: 'Поради', desc: 'Як заробити більше балів' }
    ]
};

let _pointsData = [];
let _pointsTasksData = null;

async function showPointsPanel() {
    const modal = document.getElementById('pointsModal');
    const content = document.getElementById('pointsContent');
    const quickStats = document.getElementById('pointsQuickStats');
    const toolsDiv = document.getElementById('pointsTools');
    if (!modal) return;

    content.innerHTML = '<div class="loading-spinner">Завантаження...</div>';
    quickStats.innerHTML = '';
    modal.classList.remove('hidden');

    const role = getUserRole();
    _buildPointsToolbar(role, toolsDiv);

    // Fetch points + tasks in parallel
    try {
        const [pointsResp, tasksResp] = await Promise.all([
            fetch(`${API_BASE}/points`, { headers: getAuthHeaders(false) }),
            fetch(`${API_BASE}/tasks?limit=10`, { headers: getAuthHeaders(false) }).catch(() => null)
        ]);
        if (handleAuthError(pointsResp)) return;
        _pointsData = await pointsResp.json();
        _pointsTasksData = tasksResp && tasksResp.ok ? await tasksResp.json() : [];
        _renderPointsPanel();
    } catch (err) {
        content.innerHTML = '<div class="error-msg">Помилка завантаження балів</div>';
    }

    const roleSelect = document.getElementById('pointsRoleSelect');
    if (roleSelect) roleSelect.onchange = () => _renderPointsPanel();
}

function _buildPointsToolbar(role, toolsDiv) {
    if (!toolsDiv) return;
    const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === role) || { icon: '👤', name: role, tier: 'field' };
    const tierInfo = TIER_INFO[roleInfo.tier];

    toolsDiv.innerHTML = `
        <span class="points-role-badge" style="background:${tierInfo.color}">${roleInfo.icon} ${roleInfo.name}</span>
        <span class="points-tier-badge" style="border-color:${tierInfo.color};color:${tierInfo.color}">${tierInfo.label}</span>
    `;
}

function _renderPointsPanel() {
    const content = document.getElementById('pointsContent');
    const quickStats = document.getElementById('pointsQuickStats');
    const roleSelect = document.getElementById('pointsRoleSelect');
    const filterRole = roleSelect ? roleSelect.value : 'all';
    const role = getUserRole();
    const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === role) || { tier: 'field' };

    let data = _pointsData;
    if (filterRole !== 'all') data = data.filter(u => u.role === filterRole);

    // Quick stats
    const totalPermanent = data.reduce((s, u) => s + parseInt(u.permanent_total || 0), 0);
    const totalMonthly = data.reduce((s, u) => s + parseInt(u.monthly_current || 0), 0);
    const avgPermanent = data.length > 0 ? Math.round(totalPermanent / data.length) : 0;

    quickStats.innerHTML = `
        <div class="points-stat-card"><div class="points-stat-num">${data.length}</div><div class="points-stat-label">Учасників</div></div>
        <div class="points-stat-card"><div class="points-stat-num">${totalPermanent}</div><div class="points-stat-label">Всього балів</div></div>
        <div class="points-stat-card"><div class="points-stat-num positive">${totalMonthly >= 0 ? '+' : ''}${totalMonthly}</div><div class="points-stat-label">За місяць</div></div>
        <div class="points-stat-card"><div class="points-stat-num">${avgPermanent}</div><div class="points-stat-label">Середній</div></div>
    `;

    let html = '';

    // 1) Role hierarchy visualization
    html += _renderRoleHierarchy(role);

    // 2) Role-specific info boards
    html += _renderInfoBoards(roleInfo.tier);

    // 3) Leaderboard
    html += _renderLeaderboard(data, role);

    // 4) Tasks dashboard (always at bottom)
    html += _renderTasksDashboard();

    content.innerHTML = html;
}

function _renderRoleHierarchy(currentRole) {
    let html = '<div class="points-hierarchy"><h4>Ієрархія ролей</h4><div class="points-hierarchy-chain">';
    let prevTier = '';
    POINTS_ROLE_HIERARCHY.forEach(r => {
        const tierInfo = TIER_INFO[r.tier];
        if (r.tier !== prevTier) {
            if (prevTier) html += '</div>';
            html += `<div class="points-hierarchy-tier" style="--tier-color:${tierInfo.color}"><span class="points-tier-label">${tierInfo.label}</span>`;
            prevTier = r.tier;
        }
        const isMe = r.key === currentRole;
        html += `<span class="points-hierarchy-role${isMe ? ' points-hierarchy-me' : ''}" style="--role-color:${tierInfo.color}" title="${r.name}">${r.icon}</span>`;
    });
    html += '</div></div></div>';
    return html;
}

function _renderInfoBoards(tier) {
    const boards = ROLE_BOARDS[tier] || ROLE_BOARDS.field;
    let html = '<div class="points-boards"><h4>Інформаційна панель</h4><div class="points-boards-grid">';
    boards.forEach(b => {
        html += `<div class="points-board-card">
            <div class="points-board-icon">${b.icon}</div>
            <div class="points-board-info">
                <div class="points-board-label">${b.label}</div>
                <div class="points-board-desc">${b.desc}</div>
            </div>
        </div>`;
    });
    html += '</div></div>';
    return html;
}

function _renderLeaderboard(data, currentRole) {
    if (data.length === 0) return '<div class="points-empty">Немає даних</div>';

    const medals = ['🥇', '🥈', '🥉'];
    const currentUser = AppState.currentUser ? AppState.currentUser.username : '';
    const ROLE_SHORT = {};
    POINTS_ROLE_HIERARCHY.forEach(r => ROLE_SHORT[r.key] = r.name);

    let html = '<div class="points-leaderboard-section"><h4>Рейтинг</h4><div class="points-leaderboard">';
    data.forEach((u, i) => {
        const medal = medals[i] || `${i + 1}`;
        const isMe = u.username === currentUser;
        const monthCls = parseInt(u.monthly_current) >= 0 ? 'positive' : 'negative';
        const monthSign = parseInt(u.monthly_current) > 0 ? '+' : '';
        const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === u.role);
        const tierColor = roleInfo ? TIER_INFO[roleInfo.tier].color : '#999';

        html += `<div class="points-leader-row${isMe ? ' points-leader-me' : ''}">
            <span class="points-leader-rank">${medal}</span>
            <div class="points-leader-info">
                <span class="points-leader-name">${u.name || u.username}</span>
                <span class="points-leader-role" style="color:${tierColor}">${roleInfo ? roleInfo.icon : ''} ${ROLE_SHORT[u.role] || u.role || ''}</span>
            </div>
            <div class="points-leader-scores">
                <span class="points-leader-permanent">${u.permanent_total}</span>
                <span class="points-leader-monthly ${monthCls}">${monthSign}${u.monthly_current}</span>
            </div>
        </div>`;
    });
    html += '</div></div>';
    return html;
}

function _renderTasksDashboard() {
    const tasks = Array.isArray(_pointsTasksData) ? _pointsTasksData : (_pointsTasksData && _pointsTasksData.tasks ? _pointsTasksData.tasks : []);
    const currentUser = AppState.currentUser ? AppState.currentUser.username : '';

    let myTasks = tasks.filter(t => t.assigned_to === currentUser && t.status !== 'done');
    if (myTasks.length === 0) myTasks = tasks.filter(t => t.status !== 'done').slice(0, 5);

    const doneTasks = tasks.filter(t => t.assigned_to === currentUser && t.status === 'done').length;
    const pendingTasks = tasks.filter(t => t.assigned_to === currentUser && t.status !== 'done').length;

    let html = `<div class="points-tasks-dashboard">
        <h4>Задачі</h4>
        <div class="points-tasks-summary">
            <span class="points-tasks-stat">✅ Виконано: <strong>${doneTasks}</strong></span>
            <span class="points-tasks-stat">⏳ В роботі: <strong>${pendingTasks}</strong></span>
        </div>`;

    if (myTasks.length > 0) {
        html += '<div class="points-tasks-list">';
        myTasks.slice(0, 5).forEach(t => {
            const statusIcons = { todo: '⬜', in_progress: '🔄', review: '👀', blocked: '🚫' };
            const statusIcon = statusIcons[t.status] || '⬜';
            const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
            html += `<div class="points-task-row">
                <span>${statusIcon} ${priority}</span>
                <span class="points-task-title">${t.title || 'Без назви'}</span>
            </div>`;
        });
        html += '</div>';
    } else {
        html += '<div class="points-tasks-empty">Немає активних задач</div>';
    }

    html += '</div>';
    return html;
}

// ==========================================
// v30.3: TIMELINE SEARCH
// ==========================================

function initTimelineSearch() {
    const wrap = document.getElementById('timelineSearchWrap');
    const input = document.getElementById('timelineSearchInput');
    const countEl = document.getElementById('timelineSearchCount');
    const btnOpen = document.getElementById('timelineSearchBtn');
    const btnClose = document.getElementById('timelineSearchClose');
    const btnPrev = document.getElementById('timelineSearchPrev');
    const btnNext = document.getElementById('timelineSearchNext');
    if (!wrap || !input) return;

    function openSearch() {
        wrap.classList.remove('hidden');
        if (btnOpen) btnOpen.style.display = 'none';
        input.focus();
    }

    function closeSearch() {
        wrap.classList.add('hidden');
        if (btnOpen) btnOpen.style.display = '';
        input.value = '';
        clearSearchHighlights();
        AppState.searchQuery = '';
        AppState.searchResults = [];
        AppState.searchIndex = -1;
    }

    if (btnOpen) btnOpen.addEventListener('click', openSearch);
    if (btnClose) btnClose.addEventListener('click', closeSearch);
    if (btnPrev) btnPrev.addEventListener('click', () => navigateSearch(-1));
    if (btnNext) btnNext.addEventListener('click', () => navigateSearch(1));

    let searchTimeout;
    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => executeTimelineSearch(input.value.trim()), 200);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeSearch(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            navigateSearch(e.shiftKey ? -1 : 1);
        }
    });
}

function executeTimelineSearch(query) {
    clearSearchHighlights();
    const countEl = document.getElementById('timelineSearchCount');
    AppState.searchQuery = query;
    AppState.searchResults = [];
    AppState.searchIndex = -1;

    if (!query || query.length < 2) {
        if (countEl) countEl.textContent = '';
        return;
    }

    const q = query.toLowerCase();
    // v30.7: Support both single-day (.booking-block) and multi-day (.mini-booking-block) modes
    const selector = AppState.multiDayMode
        ? '.mini-booking-block'
        : '.booking-block:not(.status-hidden)';
    const blocks = document.querySelectorAll(selector);

    blocks.forEach(block => {
        const text = block.textContent.toLowerCase();
        const ariaLabel = (block.getAttribute('aria-label') || '').toLowerCase();
        const title = (block.getAttribute('title') || '').toLowerCase();
        if (text.includes(q) || ariaLabel.includes(q) || title.includes(q)) {
            AppState.searchResults.push(block);
            block.classList.add('search-match');
        } else {
            block.classList.add('search-dimmed');
        }
    });

    if (AppState.searchResults.length > 0) {
        AppState.searchIndex = 0;
        highlightActiveResult();
    }

    updateSearchCount(countEl);
}

function navigateSearch(direction) {
    if (AppState.searchResults.length === 0) return;
    // Remove active highlight from current
    if (AppState.searchIndex >= 0 && AppState.searchIndex < AppState.searchResults.length) {
        AppState.searchResults[AppState.searchIndex].classList.remove('search-match-active');
    }
    AppState.searchIndex += direction;
    if (AppState.searchIndex >= AppState.searchResults.length) AppState.searchIndex = 0;
    if (AppState.searchIndex < 0) AppState.searchIndex = AppState.searchResults.length - 1;
    highlightActiveResult();
    const countEl = document.getElementById('timelineSearchCount');
    updateSearchCount(countEl);
}

function highlightActiveResult() {
    const block = AppState.searchResults[AppState.searchIndex];
    if (!block) return;
    block.classList.add('search-match-active');
    // Auto-scroll to the found block
    block.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

function updateSearchCount(el) {
    if (!el) return;
    const total = AppState.searchResults.length;
    if (total === 0 && AppState.searchQuery.length >= 2) {
        el.textContent = 'Не знайдено';
    } else if (total > 0) {
        el.textContent = `${AppState.searchIndex + 1}/${total}`;
    } else {
        el.textContent = '';
    }
}

function clearSearchHighlights() {
    document.querySelectorAll('.search-match, .search-match-active, .search-dimmed').forEach(el => {
        el.classList.remove('search-match', 'search-match-active', 'search-dimmed');
    });
}

// ==========================================
// v30.3: KEYBOARD SHORTCUTS
// ==========================================

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Skip if user is typing in an input/textarea
        const tag = e.target.tagName;
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

        // Ctrl+F — open timeline search (override browser default on timeline page)
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            const timelinePage = document.getElementById('timelineScroll');
            if (timelinePage && !timelinePage.closest('.hidden')) {
                e.preventDefault();
                const btnOpen = document.getElementById('timelineSearchBtn');
                if (btnOpen) btnOpen.click();
                return;
            }
        }

        // Skip other shortcuts when typing
        if (isInput) return;

        // Ctrl+Z — undo
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            handleUndo();
            return;
        }

        // Ctrl+Shift+Z or Ctrl+Y — redo
        if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
            e.preventDefault();
            handleRedo();
            return;
        }
    });
}
