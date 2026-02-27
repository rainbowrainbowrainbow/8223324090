/**
 * js/idle-hints.js — Subtle idle hint bubbles (v1.0)
 * Shows floating text hints near the ☰ cmd-fab when user is idle.
 * First launch: triggers after 5s. Then very rarely (3-5 min idle).
 */

const IdleHints = (() => {
    const STORAGE_KEY = 'eg_idle_hints';
    const FIRST_LAUNCH_DELAY = 5000;
    const MIN_IDLE_MS = 180000;   // 3 min
    const MAX_IDLE_MS = 300000;   // 5 min
    const COOLDOWN_MS = 600000;   // 10 min between hints

    const HINTS = [
        'Відкрий мене \u2728',
        'Тут є корисне \u2615',
        'Спробуй натиснути \u261d',
        'Швидкі дії тут \u26a1',
        'KPI одним кліком \ud83d\udcca',
        'Нотатки та статистика \ud83d\udcdd',
    ];

    let idleTimer = null;
    let lastActivity = Date.now();
    let lastHintTime = 0;
    let isActive = false;

    function init() {
        if (isActive) return;
        isActive = true;

        injectStyles();

        const state = loadState();

        // Track user activity
        const resetIdle = () => {
            lastActivity = Date.now();
        };
        document.addEventListener('mousemove', resetIdle, { passive: true });
        document.addEventListener('keydown', resetIdle, { passive: true });
        document.addEventListener('touchstart', resetIdle, { passive: true });
        document.addEventListener('click', resetIdle, { passive: true });
        document.addEventListener('scroll', resetIdle, { passive: true });

        if (!state.firstHintShown) {
            // First launch — show after 5s
            setTimeout(() => {
                const fab = document.querySelector('.cmd-fab');
                if (fab && !fab.classList.contains('hidden')) {
                    showHint();
                    saveState({ firstHintShown: true });
                }
            }, FIRST_LAUNCH_DELAY);
        }

        // Start idle checker loop
        idleTimer = setInterval(checkIdle, 30000);
    }

    function checkIdle() {
        const now = Date.now();
        const idleMs = now - lastActivity;
        const sinceLast = now - lastHintTime;

        // Only trigger if idle 3-5min AND cooldown passed
        if (idleMs < MIN_IDLE_MS || sinceLast < COOLDOWN_MS) return;

        // Random chance so it doesn't feel mechanical
        const threshold = MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS);
        if (idleMs < threshold) return;

        const fab = document.querySelector('.cmd-fab');
        if (!fab || fab.classList.contains('hidden')) return;

        // Panel already open — skip
        const panel = document.querySelector('.cmd-panel--open');
        if (panel) return;

        showHint();
    }

    function showHint() {
        const fab = document.querySelector('.cmd-fab');
        if (!fab) return;

        lastHintTime = Date.now();

        const text = HINTS[Math.floor(Math.random() * HINTS.length)];

        const bubble = document.createElement('div');
        bubble.className = 'idle-hint-bubble';
        bubble.textContent = text;

        // Position near the FAB
        const fabRect = fab.getBoundingClientRect();
        bubble.style.right = (window.innerWidth - fabRect.left + 8) + 'px';
        bubble.style.bottom = (window.innerHeight - fabRect.top - fabRect.height / 2) + 'px';

        document.body.appendChild(bubble);

        // Trigger animation
        requestAnimationFrame(() => {
            bubble.classList.add('idle-hint-visible');
        });

        // Remove after animation completes
        setTimeout(() => {
            bubble.classList.add('idle-hint-fadeout');
            setTimeout(() => bubble.remove(), 1000);
        }, 3500);
    }

    function injectStyles() {
        if (document.getElementById('idle-hints-css')) return;
        const style = document.createElement('style');
        style.id = 'idle-hints-css';
        style.textContent = `
            .idle-hint-bubble {
                position: fixed;
                z-index: 9000;
                background: rgba(255, 255, 255, 0.92);
                color: #334155;
                font-family: 'Nunito', sans-serif;
                font-size: 13px;
                font-weight: 600;
                padding: 8px 14px;
                border-radius: 16px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.08);
                pointer-events: none;
                opacity: 0;
                transform: translateY(8px) scale(0.9);
                transition: opacity 0.6s ease, transform 0.8s ease;
                white-space: nowrap;
                max-width: 200px;
            }

            .idle-hint-bubble.idle-hint-visible {
                opacity: 1;
                transform: translateY(-12px) scale(1);
            }

            .idle-hint-bubble.idle-hint-fadeout {
                opacity: 0;
                transform: translateY(-40px) scale(0.85);
                transition: opacity 0.8s ease, transform 1s ease;
            }

            body.dark-mode .idle-hint-bubble {
                background: rgba(30, 41, 59, 0.92);
                color: #e2e8f0;
                box-shadow: 0 2px 12px rgba(0,0,0,0.3);
            }

            @media (max-width: 480px) {
                .idle-hint-bubble {
                    font-size: 12px;
                    padding: 6px 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function loadState() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch { return {}; }
    }

    function saveState(patch) {
        try {
            const state = { ...loadState(), ...patch };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch { /* ignore */ }
    }

    function destroy() {
        if (idleTimer) clearInterval(idleTimer);
        isActive = false;
    }

    return { init, destroy };
})();
