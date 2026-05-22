/**
 * js/kleshnya-widget.js - legacy assistant widget bridge.
 *
 * The CRM now has one canonical assistant surface: CrmAssistantRail.
 * This file stays loaded for cache/backward compatibility, but it must not
 * create a second floating chat widget or a second assistant FAB.
 */
(function () {
    'use strict';

    function hideLegacyWidgetDom() {
        const ids = ['kleshnyaWidget', 'kleshnyaFab', 'kleshnyaPopup', 'kleshnyaPanel'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('hidden');
            el.classList.remove('open', 'active');
            el.setAttribute('aria-hidden', 'true');
        });

        document.querySelectorAll('.kleshnya-fab, .kleshnya-panel, .kleshnya-popup').forEach(el => {
            el.classList.add('hidden');
            el.classList.remove('open', 'active');
            el.setAttribute('aria-hidden', 'true');
        });
    }

    function openCanonicalAssistant(prompt, options = {}) {
        hideLegacyWidgetDom();
        if (options.userInitiated !== true) {
            console.info('[assistant-widget-bridge] ignored non-user assistant open request');
            return false;
        }

        if (window.CrmAssistantRail?.expand) {
            window.CrmAssistantRail.expand();
            if (prompt && window.CrmAssistantRail.requestGuideReply) {
                window.CrmAssistantRail.requestGuideReply({ prompt, proactive: false }).catch(err => {
                    console.warn('[assistant-widget-bridge] prompt handoff failed', err);
                });
            }
            return true;
        }

        if (window.CrmAssistantRail?.init) {
            try {
                const mounted = window.CrmAssistantRail.init({
                    page: document.body?.dataset?.page || document.title || window.location.pathname
                });
                if (mounted && window.CrmAssistantRail?.expand) window.CrmAssistantRail.expand();
                return true;
            } catch (err) {
                console.warn('[assistant-widget-bridge] canonical rail init failed', err);
            }
        }

        return false;
    }

    function bindLegacyTriggers() {
        document.addEventListener('click', event => {
            const trigger = event.target?.closest?.('#kleshnyaFab, [data-open-kleshnya], [data-open-assistant-widget]');
            if (!trigger) return;

            if (event.isTrusted !== false && openCanonicalAssistant(trigger.dataset?.assistantPrompt || '', { userInitiated: true })) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    function init() {
        hideLegacyWidgetDom();
        bindLegacyTriggers();

        window.KleshnyaWidget = {
            open: openCanonicalAssistant,
            openFromUser: (prompt = '') => openCanonicalAssistant(prompt, { userInitiated: true }),
            close: hideLegacyWidgetDom,
            isLegacyBridge: true
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
