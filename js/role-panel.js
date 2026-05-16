/**
 * Compatibility tombstone for the removed right-side role panel.
 *
 * The obsolete "ПАНЕЛЬ" drawer is no longer part of the app shell. This file
 * intentionally renders nothing; it only neutralizes stale cached pages or old
 * Service Worker responses that may still request js/role-panel.js.
 */
(function removeObsoleteRolePanelShell() {
    function cleanup() {
        ['rolePanelFab', 'rolePanelOverlay', 'rolePanel'].forEach((id) => {
            document.getElementById(id)?.remove();
        });
        document.body?.classList.remove('role-panel-open');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanup, { once: true });
    } else {
        cleanup();
    }

    window.RolePanel = {
        init: cleanup,
        open: cleanup,
        close: cleanup,
        toggle: cleanup
    };
})();
