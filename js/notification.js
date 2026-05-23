/**
 * js/notification.js — Centralized notification system v38.12
 * Single source of truth — replaces 16 duplicate showNotification() functions
 */
(function() {
    function showNotification(message, type) {
        type = type || '';
        let c = document.getElementById('toastContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toastContainer';
            c.className = 'toast-container';
            c.setAttribute('aria-live', 'polite');
            c.setAttribute('role', 'region');
            document.body.appendChild(c);
        }
        var t = document.createElement('div');
        t.className = 'toast' + (type ? ' ' + type : '');
        t.setAttribute('role', type === 'error' ? 'alert' : 'status');
        t.textContent = message;
        c.appendChild(t);
        setTimeout(function() {
            t.classList.add('toast-exit');
            setTimeout(function() { t.remove(); }, 300);
        }, 3500);
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
