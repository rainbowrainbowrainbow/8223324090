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

    function openCanonicalAssistant(prompt) {
        hideLegacyWidgetDom();

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
                window.CrmAssistantRail.init({
                    page: document.body?.dataset?.page || document.title || window.location.pathname
                });
                window.setTimeout(() => window.CrmAssistantRail?.expand?.(), 80);
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

            if (openCanonicalAssistant(trigger.dataset?.assistantPrompt || '')) {
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
