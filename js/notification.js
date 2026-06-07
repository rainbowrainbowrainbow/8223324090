/**
 * js/notification.js — Centralized notification system v38.12
 * Single source of truth — replaces 16 duplicate showNotification() functions
 */
(function() {
    var TOAST_MAX_VISIBLE = 3;
    var TOAST_DEDUPE_MS = 1400;
    var TOAST_DEFAULT_DURATION_MS = 6000;
    var TOAST_DEFAULT_FADE_MS = 750;
    var toastRecent = new Map();

    function isStructuredNotification(value) {
        return value && typeof value === 'object' && !(value instanceof Error)
            && (value.title || value.body || value.text || Array.isArray(value.details) || Array.isArray(value.actions));
    }

    function normalizeNotificationArgs(message, type, options) {
        var structured = isStructuredNotification(message) ? message : null;
        if (type && typeof type === 'object') {
            options = type;
            type = options.type || '';
        }
        options = Object.assign({}, structured || {}, options || {});
        var text = '';
        if (structured) {
            text = String(options.body || options.text || options.message || '').trim();
        } else if (message instanceof Error) {
            text = (window.CrmApiErrors && window.CrmApiErrors.format && window.CrmApiErrors.format(message))
                || message.message
                || 'Помилка';
        } else if (message && typeof message === 'object' && (message.error || message.message || message.requestId)) {
            text = (window.CrmApiErrors && window.CrmApiErrors.format && window.CrmApiErrors.format(message))
                || String(message.error || message.message || 'Помилка');
        } else {
            text = String(message == null ? '' : message);
        }
        return {
            type: String(type || options.type || '').trim(),
            title: options.title ? String(options.title).trim() : '',
            message: text,
            details: Array.isArray(options.details) ? options.details.filter(Boolean).map(String) : [],
            actions: Array.isArray(options.actions) ? options.actions : [],
            duration: Number.isFinite(Number(options.durationMs || options.duration))
                ? Math.max(1200, Number(options.durationMs || options.duration))
                : TOAST_DEFAULT_DURATION_MS,
            fadeDuration: Number.isFinite(Number(options.fadeDurationMs || options.fadeDuration))
                ? Math.max(250, Number(options.fadeDurationMs || options.fadeDuration))
                : TOAST_DEFAULT_FADE_MS,
            pauseOnInteract: options.pauseOnInteract !== false,
            closeButton: options.closeButton !== false && Boolean(structured || Array.isArray(options.actions)),
            onClick: typeof options.onClick === 'function' ? options.onClick : null
        };
    }

    function appendText(parent, className, text) {
        if (!text) return null;
        var node = document.createElement('div');
        node.className = className;
        node.textContent = text;
        parent.appendChild(node);
        return node;
    }

    function buildToastContent(toast, config, dismiss) {
        var content = document.createElement('div');
        content.className = 'toast-content';
        appendText(content, 'toast-title', config.title);
        appendText(content, 'toast-message', config.message);
        if (config.details.length) {
            var details = document.createElement('div');
            details.className = 'toast-details';
            config.details.forEach(function(detail) {
                appendText(details, 'toast-detail', detail);
            });
            content.appendChild(details);
        }
        if (config.actions.length) {
            var actions = document.createElement('div');
            actions.className = 'toast-actions';
            config.actions.forEach(function(action) {
                if (!action || !action.label) return;
                var button = document.createElement(action.href ? 'a' : 'button');
                button.className = 'toast-action-btn' + (action.variant ? ' ' + action.variant : '');
                button.textContent = String(action.label);
                if (action.href) button.href = String(action.href);
                else button.type = 'button';
                button.addEventListener('click', function(event) {
                    if (!action.href) event.preventDefault();
                    event.stopPropagation();
                    if (typeof action.onClick === 'function') action.onClick(event);
                    if (action.dismissOnClick !== false) dismiss();
                });
                actions.appendChild(button);
            });
            content.appendChild(actions);
        }
        toast.appendChild(content);
        if (config.closeButton) {
            var close = document.createElement('button');
            close.type = 'button';
            close.className = 'toast-close';
            close.setAttribute('aria-label', 'Закрити повідомлення');
            close.textContent = '×';
            close.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
            });
            toast.appendChild(close);
        }
    }

    function showNotification(message, type, options) {
        var config = normalizeNotificationArgs(message, type, options);
        var dedupeText = [config.title, config.message].concat(config.details).join('|');
        var dedupeKey = (config.type || 'info') + ':' + dedupeText;
        var now = Date.now();
        var recentAt = toastRecent.get(dedupeKey) || 0;
        if (dedupeText && now - recentAt < TOAST_DEDUPE_MS) return null;
        toastRecent.set(dedupeKey, now);
        setTimeout(function() {
            if (toastRecent.get(dedupeKey) === now) toastRecent.delete(dedupeKey);
        }, TOAST_DEDUPE_MS + 250);

        let c = document.getElementById('toastContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toastContainer';
            c.className = 'toast-container';
            c.setAttribute('aria-live', 'polite');
            c.setAttribute('role', 'region');
            document.body.appendChild(c);
        }
        Array.from(c.querySelectorAll('.toast')).slice(0, Math.max(0, c.querySelectorAll('.toast').length - TOAST_MAX_VISIBLE + 1)).forEach(function(item) {
            item.remove();
        });

        var t = document.createElement('div');
        t.className = 'toast' + (config.type ? ' ' + config.type : '');
        t.style.setProperty('--toast-exit-ms', config.fadeDuration + 'ms');
        t.setAttribute('role', config.type === 'error' ? 'alert' : 'status');
        t.setAttribute('aria-live', config.type === 'error' ? 'assertive' : 'polite');
        if (config.actions.length || config.onClick) t.tabIndex = 0;

        var removed = false;
        var timer = null;
        var timerStartedAt = 0;
        var remaining = config.duration;
        function dismiss() {
            if (removed) return;
            removed = true;
            if (timer) clearTimeout(timer);
            t.classList.add('toast-exit');
            setTimeout(function() { t.remove(); }, config.fadeDuration);
        }
        function startTimer() {
            if (removed || !Number.isFinite(remaining)) return;
            timerStartedAt = Date.now();
            timer = setTimeout(dismiss, remaining);
        }
        function pauseTimer() {
            if (!timer) return;
            clearTimeout(timer);
            timer = null;
            remaining = Math.max(900, remaining - (Date.now() - timerStartedAt));
        }
        function resumeTimer() {
            if (timer || removed || (config.pauseOnInteract && (t.matches(':hover') || t.matches(':focus-within')))) return;
            startTimer();
        }

        buildToastContent(t, config, dismiss);
        if (config.onClick) {
            t.classList.add('is-clickable');
            t.addEventListener('click', function(event) {
                if (event.target.closest('button,a')) return;
                config.onClick(event);
            });
        }
        if (config.pauseOnInteract) {
            t.addEventListener('mouseenter', pauseTimer);
            t.addEventListener('focusin', pauseTimer);
            t.addEventListener('mouseleave', resumeTimer);
            t.addEventListener('focusout', function() { setTimeout(resumeTimer, 0); });
        }
        c.appendChild(t);
        startTimer();
        return t;
    }

    function assetVersion() {
        var script = Array.from(document.scripts || []).find(function(item) {
            return /(^|\/)js\/notification\.js/.test(item.getAttribute('src') || '');
        });
        if (!script) return '';
        try {
            return new URL(script.src, window.location.href).searchParams.get('v') || '';
        } catch {
            return '';
        }
    }

    function assetSuffix() {
        var version = assetVersion();
        return version ? '?v=' + encodeURIComponent(version) : '';
    }

    function ensureSidebarSmartMenuAssets() {
        if (!document.getElementById('sidebarNav')) return;
        var suffix = assetSuffix();

        if (!document.querySelector('link[data-sidebar-smart-menu-css]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/sidebar-smart-menu.css' + suffix;
            link.dataset.sidebarSmartMenuCss = 'true';
            document.head.appendChild(link);
        }

        if (!window.SidebarSmartMenu && !document.querySelector('script[data-sidebar-smart-menu-js]')) {
            var script = document.createElement('script');
            script.src = '/js/sidebar-smart-menu.js' + suffix;
            script.defer = true;
            script.dataset.sidebarSmartMenuJs = 'true';
            document.body.appendChild(script);
        } else if (window.SidebarSmartMenu && typeof window.SidebarSmartMenu.init === 'function') {
            window.SidebarSmartMenu.init();
        }
    }

    function scheduleSidebarSmartMenu() {
        var ensure = window.ensureSidebarSmartMenuAssets || ensureSidebarSmartMenuAssets;
        var timer = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (!timer) return;
        [0, 80, 240, 700, 1500].forEach(function(delay) {
            timer(function() { ensure(); }, delay);
        });
    }

    window.CrmToast = window.CrmToast || {};
    window.CrmToast.show = showNotification;
    window.showNotification = showNotification;
    if (!window.ensureSidebarSmartMenuAssets) {
        window.ensureSidebarSmartMenuAssets = ensureSidebarSmartMenuAssets;
    }
    if (!window.scheduleSidebarSmartMenuAssets) {
        window.scheduleSidebarSmartMenuAssets = scheduleSidebarSmartMenu;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleSidebarSmartMenu, { once: true });
    } else {
        scheduleSidebarSmartMenu();
    }
})();
