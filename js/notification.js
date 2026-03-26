/**
 * js/notification.js — Centralized notification system v38.11
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
    window.showNotification = showNotification;
})();
