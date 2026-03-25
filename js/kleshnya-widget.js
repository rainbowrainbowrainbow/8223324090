/**
 * js/kleshnya-widget.js — Floating Kleshnya Chat Widget (v12.8)
 *
 * FAB button + slide-up chat panel on the main timeline page.
 * Uses same API as kleshnya.html: /api/kleshnya/chat
 * Includes voice input via Web Speech API.
 */
(function () {
    'use strict';

    // --- State ---
    let isOpen = false;
    let isLoaded = false;
    let isRecording = false;
    let recognition = null;

    // --- DOM Creation ---

    function createWidget() {
        // FAB Button
        const fab = document.createElement('button');
        fab.id = 'kleshnyaFab';
        fab.className = 'kleshnya-fab';
        fab.innerHTML = '🦀';
        fab.title = 'Клешня — чат';
        fab.setAttribute('aria-label', 'Відкрити чат з Клешнею');

        // Chat Panel
        const panel = document.createElement('div');
        panel.id = 'kleshnyaPanel';
        panel.className = 'kleshnya-panel';
        panel.innerHTML = `
            <div class="kw-header">
                <div class="kw-header-info">
                    <span class="kw-avatar">🦀</span>
                    <div>
                        <div class="kw-title">Клешня</div>
                        <div class="kw-subtitle">Центральний інтелект парку</div>
                    </div>
                </div>
                <div class="kw-header-actions">
                    <a href="/kleshnya" class="kw-expand-btn" title="Відкрити на повну сторінку">⛶</a>
                    <button class="kw-close-btn" id="kwCloseBtn" title="Закрити">✕</button>
                </div>
            </div>
            <div class="kw-messages" id="kwMessages"></div>
            <div class="kw-suggestions" id="kwSuggestions"></div>
            <div class="kw-input-area">
                <input type="text" class="kw-input" id="kwInput" placeholder="Написати Клешні..." maxlength="500" autocomplete="off">
                <button class="kw-voice-btn" id="kwVoiceBtn" title="Голосове повідомлення">🎤</button>
                <button class="kw-send-btn" id="kwSendBtn" title="Надіслати">➤</button>
            </div>
        `;

        document.body.appendChild(fab);
        document.body.appendChild(panel);

        // --- Events ---
        fab.addEventListener('click', togglePanel);
        document.getElementById('kwCloseBtn')?.addEventListener('click', closePanel);
        document.getElementById('kwSendBtn')?.addEventListener('click', sendMessage);
        document.getElementById('kwInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        document.getElementById('kwVoiceBtn')?.addEventListener('click', toggleVoice);

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) closePanel();
        });
    }

    // --- Panel Toggle ---

    function togglePanel() {
        if (isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    function openPanel() {
        const panel = document.getElementById('kleshnyaPanel');
        const fab = document.getElementById('kleshnyaFab');
        panel.classList.add('open');
        fab.classList.add('active');
        isOpen = true;

        if (!isLoaded) {
            loadChat();
            isLoaded = true;
        }

        setTimeout(() => {
            document.getElementById('kwInput')?.focus();
        }, 300);
    }

    function closePanel() {
        const panel = document.getElementById('kleshnyaPanel');
        const fab = document.getElementById('kleshnyaFab');
        panel.classList.remove('open');
        fab.classList.remove('active');
        isOpen = false;
    }

    // --- Messages ---

    function formatTime(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
    }

    function sanitizeHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script,style,iframe,object,embed').forEach(el => el.remove());
        div.querySelectorAll('*').forEach(el => {
            for (const attr of [...el.attributes]) {
                if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
            }
        });
        return div.innerHTML;
    }

    function addMessage(role, text, time) {
        const messages = document.getElementById('kwMessages');
        const msg = document.createElement('div');
        msg.className = `kw-msg kw-msg--${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'kw-msg-bubble';
        if (role === 'assistant') {
            bubble.innerHTML = sanitizeHtml(text);
        } else {
            bubble.textContent = text;
        }

        const timeEl = document.createElement('div');
        timeEl.className = 'kw-msg-time';
        timeEl.textContent = time ? formatTime(time) : '';

        msg.appendChild(bubble);
        msg.appendChild(timeEl);
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;
    }

    function showTyping() {
        const messages = document.getElementById('kwMessages');
        const typing = document.createElement('div');
        typing.className = 'kw-typing';
        typing.id = 'kwTyping';
        typing.innerHTML = '🦀 <span class="kw-typing-dots"><span></span><span></span><span></span></span>';
        messages.appendChild(typing);
        messages.scrollTop = messages.scrollHeight;
    }

    function hideTyping() {
        const t = document.getElementById('kwTyping');
        if (t) t.remove();
    }

    function renderSuggestions(suggestions) {
        const container = document.getElementById('kwSuggestions');
        container.innerHTML = '';
        if (!suggestions || suggestions.length === 0) return;

        for (const text of suggestions) {
            const chip = document.createElement('button');
            chip.className = 'kw-chip';
            chip.textContent = text;
            chip.addEventListener('click', () => {
                document.getElementById('kwInput').value = text;
                sendMessage();
            });
            container.appendChild(chip);
        }
    }

    // --- API ---

    async function loadChat() {
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const greeting = await apiGetKleshnyaGreeting(dateStr);

            if (greeting && greeting.message) {
                addMessage('assistant', greeting.message, new Date().toISOString());
            } else {
                addMessage('assistant', '🦀 Привіт! Я Клешня. Питай що завгодно!', new Date().toISOString());
            }
            renderSuggestions(['Бронювання', 'Задачі', 'Хто працює?', 'Що ти вмієш?']);
        } catch (err) {
            console.error('Widget load error:', err);
            addMessage('assistant', '🦀 Привіт! Я на зв\'язку!', new Date().toISOString());
            renderSuggestions(['Бронювання', 'Задачі', 'Допомога']);
        }
    }

    async function sendMessage() {
        const input = document.getElementById('kwInput');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        document.getElementById('kwSendBtn').disabled = true;
        document.getElementById('kwSuggestions').innerHTML = '';
        addMessage('user', text, new Date().toISOString());
        showTyping();

        try {
            const response = await apiSendKleshnyaMessage(text);
            hideTyping();

            if (response && response.message) {
                addMessage('assistant', response.message, response.created_at || new Date().toISOString());
                if (response.suggestions && response.suggestions.length > 0) {
                    renderSuggestions(response.suggestions);
                }
            } else {
                addMessage('assistant', '🦀 Упс, щось пішло не так!', new Date().toISOString());
            }
        } catch (err) {
            hideTyping();
            addMessage('assistant', '🦀 Помилка з\'єднання!', new Date().toISOString());
        }

        document.getElementById('kwSendBtn').disabled = false;
        input.focus();
    }

    // --- Voice Input (Web Speech API) ---

    function initVoice() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            // Hide voice button if not supported
            const btn = document.getElementById('kwVoiceBtn');
            if (btn) btn.style.display = 'none';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'uk-UA';
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            const input = document.getElementById('kwInput');
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            input.value = transcript;
        };

        recognition.onend = () => {
            isRecording = false;
            const btn = document.getElementById('kwVoiceBtn');
            btn.classList.remove('recording');
            btn.innerHTML = '🎤';

            // Auto-send if we got text
            const input = document.getElementById('kwInput');
            if (input.value.trim()) {
                sendMessage();
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecording = false;
            const btn = document.getElementById('kwVoiceBtn');
            btn.classList.remove('recording');
            btn.innerHTML = '🎤';
        };
    }

    function toggleVoice() {
        if (!recognition) {
            initVoice();
            if (!recognition) return;
        }

        const btn = document.getElementById('kwVoiceBtn');

        if (isRecording) {
            recognition.stop();
            isRecording = false;
            btn.classList.remove('recording');
            btn.innerHTML = '🎤';
        } else {
            recognition.start();
            isRecording = true;
            btn.classList.add('recording');
            btn.innerHTML = '⏹';
        }
    }

    // --- Init ---

    function init() {
        // Only init on main page (not kleshnya page itself)
        if (window.location.pathname === '/kleshnya') return;

        // Wait for auth
        const checkAuth = setInterval(() => {
            const token = localStorage.getItem('pzp_token');
            const mainApp = document.getElementById('mainApp');
            if (token && mainApp && !mainApp.classList.contains('hidden')) {
                clearInterval(checkAuth);
                createWidget();
                initVoice();
            }
        }, 500);

        // Timeout after 30s
        setTimeout(() => clearInterval(checkAuth), 30000);
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
