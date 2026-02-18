/**
 * js/kleshnya-page.js — Kleshnya Chat v2 (multi-session)
 * Sidebar sessions, media bubbles, reactions, WebSocket real-time, voice input
 */
(function () {
    'use strict';

    // ==========================================
    // STATE
    // ==========================================
    var sessions = [];
    var activeSessionId = null;
    var isSending = false;
    var contextMenuSessionId = null;
    var renameSessionId = null;
    var renameEmoji = null;

    var EMOJIS = ['💬', '🦀', '🎨', '🎵', '📊', '🔥', '💡', '🎯', '🚀', '⭐', '🌈', '🎭'];

    // ==========================================
    // DOM REFS
    // ==========================================
    var $messages = document.getElementById('klMessages');
    var $input = document.getElementById('klInput');
    var $sendBtn = document.getElementById('klSendBtn');
    var $voiceBtn = document.getElementById('klVoiceBtn');
    var $suggestions = document.getElementById('klSuggestions');
    var $hint = document.getElementById('klHint');
    var $sessionsList = document.getElementById('klSessionsList');
    var $chatTitle = document.getElementById('klChatTitle');
    var $sidebar = document.getElementById('klSidebar');
    var $sidebarOverlay = document.getElementById('klSidebarOverlay');
    var $menuBtn = document.getElementById('klMenuBtn');
    var $newChatBtn = document.getElementById('klNewChatBtn');
    var $fab = document.getElementById('klFab');
    var $contextMenu = document.getElementById('klContextMenu');
    var $renameOverlay = document.getElementById('klRenameOverlay');
    var $renameInput = document.getElementById('klRenameInput');
    var $emojiRow = document.getElementById('klEmojiRow');

    // ==========================================
    // HELPERS
    // ==========================================
    function getToken() {
        return localStorage.getItem('pzp_token');
    }

    function formatTime(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
    }

    function formatSessionTime(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        var now = new Date();
        var diffMs = now - d;
        var diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'щойно';
        if (diffMins < 60) return diffMins + ' хв';
        var diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return diffHours + ' год';
        var diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return diffDays + ' дн';
        return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
    }

    function sanitizeHtml(html) {
        var div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('script,style,iframe,object,embed').forEach(function (el) { el.remove(); });
        div.querySelectorAll('*').forEach(function (el) {
            for (var i = el.attributes.length - 1; i >= 0; i--) {
                if (el.attributes[i].name.startsWith('on')) el.removeAttribute(el.attributes[i].name);
            }
        });
        return div.innerHTML;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================
    // SIDEBAR — SESSIONS
    // ==========================================
    function renderSessions() {
        $sessionsList.innerHTML = '';

        var pinned = sessions.filter(function (s) { return s.is_pinned; });
        var unpinned = sessions.filter(function (s) { return !s.is_pinned; });

        if (pinned.length > 0) {
            var label = document.createElement('div');
            label.className = 'kl-sessions-group-label';
            label.textContent = 'Закріплені';
            $sessionsList.appendChild(label);
            pinned.forEach(function (s) { $sessionsList.appendChild(createSessionItem(s)); });
        }

        if (unpinned.length > 0) {
            if (pinned.length > 0) {
                var label2 = document.createElement('div');
                label2.className = 'kl-sessions-group-label';
                label2.textContent = 'Чати';
                $sessionsList.appendChild(label2);
            }
            unpinned.forEach(function (s) { $sessionsList.appendChild(createSessionItem(s)); });
        }
    }

    function createSessionItem(session) {
        var item = document.createElement('div');
        item.className = 'kl-session-item' + (session.id === activeSessionId ? ' active' : '');
        item.dataset.id = session.id;

        var emoji = document.createElement('span');
        emoji.className = 'kl-s-emoji';
        emoji.textContent = session.emoji || '💬';

        var body = document.createElement('div');
        body.className = 'kl-s-body';

        var title = document.createElement('div');
        title.className = 'kl-s-title';
        title.textContent = session.title || 'Новий чат';

        var preview = document.createElement('div');
        preview.className = 'kl-s-preview';
        preview.textContent = session.last_message || 'Порожній чат';

        body.appendChild(title);
        body.appendChild(preview);

        var time = document.createElement('span');
        time.className = 'kl-s-time';
        time.textContent = formatSessionTime(session.last_message_at || session.updated_at);

        item.appendChild(emoji);
        item.appendChild(body);
        item.appendChild(time);

        if (session.is_pinned) {
            var pin = document.createElement('span');
            pin.className = 'kl-s-pin';
            pin.textContent = '📌';
            item.appendChild(pin);
        }

        // Click — switch session
        item.addEventListener('click', function () {
            switchSession(session.id);
            closeSidebar();
        });

        // Context menu — right click / long press
        item.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            showContextMenu(e, session.id);
        });

        var longPressTimer = null;
        item.addEventListener('touchstart', function (e) {
            longPressTimer = setTimeout(function () {
                longPressTimer = null;
                var touch = e.touches[0];
                showContextMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: function () {} }, session.id);
            }, 500);
        }, { passive: true });
        item.addEventListener('touchend', function () {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
        item.addEventListener('touchmove', function () {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });

        return item;
    }

    // ==========================================
    // SESSIONS — LOAD / CREATE / SWITCH
    // ==========================================
    async function loadSessions() {
        sessions = await apiGetKleshnyaSessions();

        if (sessions.length === 0) {
            // Auto-create first session
            var newSession = await apiCreateKleshnyaSession('Новий чат', '💬');
            if (newSession) {
                sessions = [newSession];
            }
        }

        renderSessions();

        // Restore last active or pick first
        var savedId = localStorage.getItem('kl_active_session');
        var found = sessions.find(function (s) { return String(s.id) === savedId; });
        if (found) {
            switchSession(found.id);
        } else if (sessions.length > 0) {
            switchSession(sessions[0].id);
        }
    }

    async function createNewSession() {
        var newSession = await apiCreateKleshnyaSession('Новий чат', '💬');
        if (newSession) {
            sessions.unshift(newSession);
            renderSessions();
            switchSession(newSession.id);
            closeSidebar();
        }
    }

    async function switchSession(sessionId) {
        if (activeSessionId === sessionId && $messages.children.length > 0) return;
        activeSessionId = sessionId;
        localStorage.setItem('kl_active_session', String(sessionId));

        // Update active state in sidebar
        $sessionsList.querySelectorAll('.kl-session-item').forEach(function (el) {
            el.classList.toggle('active', el.dataset.id === String(sessionId));
        });

        // Update header
        var session = sessions.find(function (s) { return s.id === sessionId; });
        $chatTitle.textContent = session ? (session.emoji || '') + ' ' + (session.title || 'Клешня') : 'Клешня';

        // Load messages
        $messages.innerHTML = '';
        clearSuggestions();
        $hint.style.display = '';

        var msgs = await apiGetSessionMessages(sessionId, 50, 0);

        if (msgs.length === 0) {
            // Show greeting for empty session
            var dateStr = new Date().toISOString().split('T')[0];
            var greeting = await apiGetKleshnyaGreeting(dateStr);
            if (greeting && greeting.message) {
                addMessage('assistant', greeting.message, new Date().toISOString(), null);
            } else {
                addMessage('assistant', '🦀 Привіт! Я Клешня — центральний інтелект парку. Питай що завгодно!', new Date().toISOString(), null);
            }
            renderSuggestions(['Що ти вмієш?', 'Бронювання сьогодні', 'Мої задачі', 'Хто працює?']);
        } else {
            msgs.forEach(function (msg) {
                addMessage(msg.role, msg.message, msg.created_at, msg.id, msg);
            });
            $hint.style.display = 'none';
        }
    }

    // ==========================================
    // CONTEXT MENU
    // ==========================================
    function showContextMenu(e, sessionId) {
        e.preventDefault();
        contextMenuSessionId = sessionId;

        var session = sessions.find(function (s) { return s.id === sessionId; });
        var pinBtn = $contextMenu.querySelector('[data-action="pin"]');
        if (pinBtn) {
            pinBtn.textContent = (session && session.is_pinned) ? '📌 Відкріпити' : '📌 Закріпити';
        }

        $contextMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
        $contextMenu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
        $contextMenu.classList.add('visible');
    }

    function hideContextMenu() {
        $contextMenu.classList.remove('visible');
        contextMenuSessionId = null;
    }

    // Context menu actions
    $contextMenu.addEventListener('click', async function (e) {
        var btn = e.target.closest('.kl-ctx-item');
        if (!btn || !contextMenuSessionId) return;

        var action = btn.dataset.action;
        var sid = contextMenuSessionId;
        hideContextMenu();

        if (action === 'rename') {
            openRenameModal(sid);
        } else if (action === 'pin') {
            var session = sessions.find(function (s) { return s.id === sid; });
            if (session) {
                await apiUpdateKleshnyaSession(sid, { is_pinned: !session.is_pinned });
                session.is_pinned = !session.is_pinned;
                renderSessions();
            }
        } else if (action === 'clear') {
            if (confirm('Очистити всі повідомлення цього чату?')) {
                var token = getToken();
                await fetch(API_BASE + '/kleshnya/sessions/' + sid + '/messages', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                var s = sessions.find(function (s) { return s.id === sid; });
                if (s) { s.last_message = null; s.message_count = 0; }
                if (sid === activeSessionId) {
                    $messages.innerHTML = '';
                    addMessage('assistant', '🦀 Чат очищено. Починаємо заново!', new Date().toISOString(), null);
                }
                renderSessions();
            }
        } else if (action === 'delete') {
            if (confirm('Видалити цей чат назавжди?')) {
                await apiDeleteKleshnyaSession(sid);
                sessions = sessions.filter(function (s) { return s.id !== sid; });
                renderSessions();
                if (sid === activeSessionId) {
                    activeSessionId = null;
                    if (sessions.length > 0) {
                        switchSession(sessions[0].id);
                    } else {
                        createNewSession();
                    }
                }
            }
        }
    });

    document.addEventListener('click', function (e) {
        if (!$contextMenu.contains(e.target)) hideContextMenu();
    });

    // ==========================================
    // RENAME MODAL
    // ==========================================
    function openRenameModal(sessionId) {
        renameSessionId = sessionId;
        var session = sessions.find(function (s) { return s.id === sessionId; });
        $renameInput.value = session ? session.title : '';
        renameEmoji = session ? (session.emoji || '💬') : '💬';

        // Render emoji options
        $emojiRow.innerHTML = '';
        EMOJIS.forEach(function (em) {
            var btn = document.createElement('button');
            btn.className = 'kl-emoji-opt' + (em === renameEmoji ? ' active' : '');
            btn.textContent = em;
            btn.addEventListener('click', function () {
                renameEmoji = em;
                $emojiRow.querySelectorAll('.kl-emoji-opt').forEach(function (b) {
                    b.classList.toggle('active', b.textContent === em);
                });
            });
            $emojiRow.appendChild(btn);
        });

        $renameOverlay.classList.add('visible');
        $renameInput.focus();
    }

    document.getElementById('klRenameSave').addEventListener('click', async function () {
        if (!renameSessionId) return;
        var newTitle = $renameInput.value.trim() || 'Новий чат';
        await apiUpdateKleshnyaSession(renameSessionId, { title: newTitle, emoji: renameEmoji });

        var session = sessions.find(function (s) { return s.id === renameSessionId; });
        if (session) {
            session.title = newTitle;
            session.emoji = renameEmoji;
        }
        renderSessions();
        if (renameSessionId === activeSessionId) {
            $chatTitle.textContent = renameEmoji + ' ' + newTitle;
        }
        $renameOverlay.classList.remove('visible');
        renameSessionId = null;
    });

    document.getElementById('klRenameCancel').addEventListener('click', function () {
        $renameOverlay.classList.remove('visible');
        renameSessionId = null;
    });

    $renameOverlay.addEventListener('click', function (e) {
        if (e.target === $renameOverlay) {
            $renameOverlay.classList.remove('visible');
            renameSessionId = null;
        }
    });

    $renameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('klRenameSave').click();
    });

    // ==========================================
    // SIDEBAR TOGGLE (mobile)
    // ==========================================
    function openSidebar() {
        $sidebar.classList.add('open');
        $sidebarOverlay.classList.add('visible');
    }
    function closeSidebar() {
        $sidebar.classList.remove('open');
        $sidebarOverlay.classList.remove('visible');
    }

    $menuBtn.addEventListener('click', openSidebar);
    $sidebarOverlay.addEventListener('click', closeSidebar);
    $newChatBtn.addEventListener('click', createNewSession);
    $fab.addEventListener('click', createNewSession);

    // ==========================================
    // CHAT MESSAGES
    // ==========================================
    function addMessage(role, text, time, msgId, msgData) {
        var msg = document.createElement('div');
        msg.className = 'kl-msg kl-msg--' + role;
        if (msgId) msg.dataset.msgId = msgId;

        var avatar = document.createElement('div');
        avatar.className = 'kl-msg-avatar';
        avatar.textContent = role === 'assistant' ? '🦀' : '👤';

        var wrapper = document.createElement('div');
        wrapper.className = 'kl-msg-content';

        // Skill badge
        if (msgData && msgData.skill_used && role === 'assistant') {
            var badge = document.createElement('div');
            badge.className = 'kl-skill-badge';
            badge.textContent = msgData.skill_used;
            wrapper.appendChild(badge);
        }

        // Media
        if (msgData && msgData.media_type && msgData.media_file_id) {
            var mediaWrap = document.createElement('div');
            mediaWrap.className = 'kl-msg-media';

            var mediaUrl = API_BASE + '/kleshnya/media/file/' + msgData.media_file_id;

            if (msgData.media_type === 'image') {
                var img = document.createElement('img');
                img.src = mediaUrl;
                img.alt = msgData.media_caption || 'Зображення';
                img.loading = 'lazy';
                mediaWrap.appendChild(img);
            } else if (msgData.media_type === 'audio') {
                var audio = document.createElement('audio');
                audio.src = mediaUrl;
                audio.controls = true;
                audio.preload = 'metadata';
                mediaWrap.appendChild(audio);
            } else if (msgData.media_type === 'video') {
                var video = document.createElement('video');
                video.src = mediaUrl;
                video.controls = true;
                video.preload = 'metadata';
                mediaWrap.appendChild(video);
            }

            wrapper.appendChild(mediaWrap);

            if (msgData.media_caption) {
                var caption = document.createElement('div');
                caption.className = 'kl-msg-media-caption';
                caption.textContent = msgData.media_caption;
                wrapper.appendChild(caption);
            }
        }

        // Text bubble
        if (text) {
            var bubble = document.createElement('div');
            bubble.className = 'kl-msg-bubble';
            if (role === 'assistant') {
                bubble.innerHTML = sanitizeHtml(text);
            } else {
                bubble.textContent = text;
            }
            wrapper.appendChild(bubble);
        }

        // Time
        if (time) {
            var timeEl = document.createElement('div');
            timeEl.className = 'kl-msg-time';
            timeEl.textContent = formatTime(time);
            wrapper.appendChild(timeEl);
        }

        // Reactions (assistant only)
        if (role === 'assistant' && msgId) {
            var reactions = document.createElement('div');
            reactions.className = 'kl-msg-reactions';

            var currentReaction = (msgData && msgData.reaction) || null;

            ['👍', '👎'].forEach(function (emoji) {
                var btn = document.createElement('button');
                btn.className = 'kl-reaction-btn' + (currentReaction === emoji ? ' active' : '');
                btn.textContent = emoji;
                btn.addEventListener('click', function () {
                    toggleReaction(msgId, emoji, btn);
                });
                reactions.appendChild(btn);
            });

            wrapper.appendChild(reactions);
        }

        msg.appendChild(avatar);
        msg.appendChild(wrapper);
        $messages.appendChild(msg);
        $messages.scrollTop = $messages.scrollHeight;
    }

    async function toggleReaction(msgId, emoji, btn) {
        var isActive = btn.classList.contains('active');
        var newReaction = isActive ? null : emoji;

        // Update UI immediately
        var container = btn.parentElement;
        container.querySelectorAll('.kl-reaction-btn').forEach(function (b) { b.classList.remove('active'); });
        if (!isActive) btn.classList.add('active');

        await apiSetMessageReaction(msgId, newReaction);
    }

    // ==========================================
    // SUGGESTIONS
    // ==========================================
    function renderSuggestions(items) {
        $suggestions.innerHTML = '';
        if (!items || items.length === 0) return;
        $hint.style.display = 'none';

        items.forEach(function (text) {
            var chip = document.createElement('button');
            chip.className = 'kl-suggestion-chip';
            chip.textContent = text;
            chip.addEventListener('click', function () {
                $input.value = text;
                sendMessage();
            });
            $suggestions.appendChild(chip);
        });
    }

    function clearSuggestions() {
        $suggestions.innerHTML = '';
    }

    // ==========================================
    // TYPING / GENERATING INDICATOR
    // ==========================================
    function showTyping() {
        removeIndicators();
        var typing = document.createElement('div');
        typing.className = 'kl-typing';
        typing.id = 'klTypingIndicator';
        typing.innerHTML = '<span>🦀 Клешня думає</span><div class="kl-typing-dots"><span></span><span></span><span></span></div>';
        $messages.appendChild(typing);
        $messages.scrollTop = $messages.scrollHeight;
    }

    function showGenerating(text) {
        removeIndicators();
        var gen = document.createElement('div');
        gen.className = 'kl-generating';
        gen.id = 'klGeneratingIndicator';
        gen.innerHTML = '<div class="kl-generating-text">' + escapeHtml(text || '🦀 Генерую...') + '</div>' +
            '<div class="kl-generating-bar"><div class="kl-generating-bar-fill"></div></div>';
        $messages.appendChild(gen);
        $messages.scrollTop = $messages.scrollHeight;
    }

    function removeIndicators() {
        var t = document.getElementById('klTypingIndicator');
        if (t) t.remove();
        var g = document.getElementById('klGeneratingIndicator');
        if (g) g.remove();
    }

    // ==========================================
    // SEND MESSAGE
    // ==========================================
    async function sendMessage() {
        var text = $input.value.trim();
        if (!text || isSending) return;

        $input.value = '';
        isSending = true;
        $sendBtn.disabled = true;
        clearSuggestions();
        addMessage('user', text, new Date().toISOString(), null);
        showTyping();

        try {
            var response = await apiSendKleshnyaMessage(text, activeSessionId);

            if (!response) {
                removeIndicators();
                addMessage('assistant', '🦀 Упс, щось пішло не так. Спробуй ще раз!', new Date().toISOString(), null);
                renderSuggestions(['Бронювання', 'Задачі', 'Допомога']);
            } else if (response.status === 'pending') {
                // Bridge mode — waiting for WebSocket reply
                if (response.action === 'generating' && response.message) {
                    removeIndicators();
                    showGenerating(response.message);
                }
                // typing indicator stays until WS kleshnya:reply
                // Update session in sidebar
                updateSessionPreview(activeSessionId, text);
            } else if (response.message) {
                removeIndicators();
                addMessage('assistant', response.message, response.created_at || new Date().toISOString(), response.id, response);

                if (response.suggestions && response.suggestions.length > 0) {
                    renderSuggestions(response.suggestions);
                }
                // Update session
                updateSessionPreview(activeSessionId, response.message);
            }
        } catch (err) {
            removeIndicators();
            addMessage('assistant', '🦀 Помилка з\'єднання. Перевір інтернет!', new Date().toISOString(), null);
            renderSuggestions(['Бронювання', 'Задачі', 'Допомога']);
        }

        isSending = false;
        $sendBtn.disabled = false;
        $input.focus();
    }

    function updateSessionPreview(sessionId, lastMsg) {
        var session = sessions.find(function (s) { return s.id === sessionId; });
        if (session) {
            session.last_message = (lastMsg || '').substring(0, 100);
            session.last_message_at = new Date().toISOString();
        }
        renderSessions();
    }

    $sendBtn.addEventListener('click', sendMessage);
    $input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // ==========================================
    // WEBSOCKET — REAL-TIME RESPONSES
    // ==========================================
    window.addEventListener('message', handleWSEvent);

    // Listen for WS events dispatched by ws.js
    function setupWSListener() {
        // Override the default handler to catch kleshnya events
        var origHandler = null;

        // Poll for ParkWS messages - listen to raw WS events
        if (typeof ParkWS !== 'undefined') {
            // ParkWS dispatches unknown events to console.log
            // We intercept them via a custom event approach
        }

        // Use a MutationObserver-like approach: periodically check nothing
        // Actually, we need to hook into ws.js message handler
        // The cleanest way: listen for custom events on window
    }

    // Patch ws.js to emit custom events for kleshnya
    // We add a listener that hooks into the raw WebSocket
    function hookWebSocket() {
        // Wait for ParkWS to be available and connected
        var checkInterval = setInterval(function () {
            if (typeof ParkWS === 'undefined' || !ParkWS.isConnected()) return;
            clearInterval(checkInterval);

            // ParkWS.connect creates _ws internally. We can't access it directly.
            // Instead, we'll use the window event approach by extending ws.js behavior.
            // For now, listen for 'ws:kleshnya' custom events
        }, 1000);
    }

    // Kleshnya WS events come through as custom events dispatched by ws.js
    // We need to add kleshnya event handling to ws.js message handler
    // Since ws.js logs unknown events, let's intercept via console override
    // Better approach: just add kleshnya events to the window dispatch pattern

    // Actually the simplest: add custom WS listener directly
    function initKleshnyaWS() {
        var token = getToken();
        if (!token) return;

        var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var wsUrl = protocol + '//' + window.location.host + '/ws';

        var ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[KleshnyaWS] Failed to connect:', err);
            return;
        }

        ws.onopen = function () {
            ws.send(JSON.stringify({ type: 'auth', token: token }));
        };

        ws.onmessage = function (event) {
            var msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }

            if (msg.type === 'kleshnya:thinking') {
                var payload = msg.payload || {};
                if (payload.session_id === activeSessionId) {
                    showTyping();
                }
            } else if (msg.type === 'kleshnya:reply') {
                var p = msg.payload || {};
                if (p.session_id === activeSessionId || !p.session_id) {
                    removeIndicators();
                    addMessage('assistant', p.message, p.created_at || new Date().toISOString(), p.id, p);
                    if (p.session_id) updateSessionPreview(p.session_id, p.message);
                }
            } else if (msg.type === 'kleshnya:media') {
                var pm = msg.payload || {};
                if (pm.session_id === activeSessionId || !pm.session_id) {
                    removeIndicators();
                    var mediaData = {
                        media_type: pm.media ? pm.media.type : null,
                        media_file_id: pm.media ? pm.media.file_id : null,
                        media_caption: pm.media ? pm.media.caption : null
                    };
                    addMessage('assistant', pm.message, pm.created_at || new Date().toISOString(), pm.id, mediaData);
                    if (pm.session_id) updateSessionPreview(pm.session_id, pm.message || '[Медіа]');
                }
            }
        };

        ws.onclose = function () {
            // Don't reconnect — ParkWS handles the main connection
            // This is a secondary connection just for kleshnya events
            setTimeout(function () {
                if (getToken()) initKleshnyaWS();
            }, 5000);
        };
    }

    // ==========================================
    // VOICE INPUT
    // ==========================================
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var voiceRecognition = null;
    var voiceRecording = false;

    if (!SpeechRecognition) {
        $voiceBtn.style.display = 'none';
    } else {
        voiceRecognition = new SpeechRecognition();
        voiceRecognition.lang = 'uk-UA';
        voiceRecognition.interimResults = true;
        voiceRecognition.continuous = false;
        voiceRecognition.maxAlternatives = 1;

        voiceRecognition.onresult = function (event) {
            var transcript = '';
            for (var i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            $input.value = transcript;
        };

        voiceRecognition.onend = function () {
            voiceRecording = false;
            $voiceBtn.classList.remove('recording');
            $voiceBtn.textContent = '🎤';
            if ($input.value.trim()) sendMessage();
        };

        voiceRecognition.onerror = function () {
            voiceRecording = false;
            $voiceBtn.classList.remove('recording');
            $voiceBtn.textContent = '🎤';
        };

        $voiceBtn.addEventListener('click', function () {
            if (voiceRecording) {
                voiceRecognition.stop();
                voiceRecording = false;
                $voiceBtn.classList.remove('recording');
                $voiceBtn.textContent = '🎤';
            } else {
                voiceRecognition.start();
                voiceRecording = true;
                $voiceBtn.classList.add('recording');
                $voiceBtn.textContent = '⏹';
            }
        });
    }

    // ==========================================
    // REPORT BUG / IMPROVEMENT
    // ==========================================
    var reportOverlay = document.getElementById('reportOverlay');
    var reportTitle = document.getElementById('reportTitle');
    var reportDesc = document.getElementById('reportDesc');
    var reportPriority = document.getElementById('reportPriority');
    var reportSubmitBtn = document.getElementById('reportSubmitBtn');
    var reportType = 'bug';

    document.getElementById('reportBtn').addEventListener('click', function () {
        reportOverlay.classList.add('visible');
        reportTitle.value = '';
        reportDesc.value = '';
        reportPriority.value = 'normal';
        reportTitle.focus();
    });

    document.getElementById('reportCancelBtn').addEventListener('click', function () {
        reportOverlay.classList.remove('visible');
    });
    reportOverlay.addEventListener('click', function (e) {
        if (e.target === reportOverlay) reportOverlay.classList.remove('visible');
    });

    document.querySelectorAll('.report-type-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.report-type-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            reportType = btn.dataset.type;
        });
    });

    reportSubmitBtn.addEventListener('click', async function () {
        var title = reportTitle.value.trim();
        if (!title) { reportTitle.focus(); return; }

        reportSubmitBtn.disabled = true;
        reportSubmitBtn.textContent = 'Надсилаю...';

        var emoji = reportType === 'bug' ? '🐛' : '💡';
        var label = reportType === 'bug' ? 'Баг' : 'Покращення';
        var user = localStorage.getItem('pzp_current_user');
        var userName = 'Користувач';
        try { userName = JSON.parse(user).name || JSON.parse(user).username; } catch (e) {}

        try {
            var token = getToken();
            var res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({
                    title: emoji + ' ' + label + ': ' + title,
                    description: (reportDesc.value.trim() ? reportDesc.value.trim() + '\n\n' : '') + 'Від: ' + userName,
                    priority: reportPriority.value,
                    category: 'improvement',
                    assigned_to: 'Sergey',
                    source_type: 'kleshnya',
                    task_type: 'human'
                })
            });

            if (!res.ok) throw new Error('Failed');
            reportOverlay.classList.remove('visible');
            var prioLabel = reportPriority.value === 'high' ? 'Високий' : reportPriority.value === 'low' ? 'Низький' : 'Звичайний';
            addMessage('assistant',
                '🦀 ' + emoji + ' ' + label + ' прийнято!\n\n📋 "' + title + '"\n👤 Призначено: Сергій\n⚡ Пріоритет: ' + prioLabel + '\n\nДякую за фідбек!',
                new Date().toISOString(), null);
        } catch (err) {
            addMessage('assistant', '🦀 Упс, не вдалося створити задачу. Спробуй ще раз!', new Date().toISOString(), null);
            reportOverlay.classList.remove('visible');
        }

        reportSubmitBtn.disabled = false;
        reportSubmitBtn.textContent = 'Надіслати Сергію';
    });

    // ==========================================
    // AUTH + INIT
    // ==========================================
    function checkAuth() {
        var token = getToken();
        if (!token) {
            window.location.href = '/';
            return;
        }

        var user = localStorage.getItem('pzp_current_user');
        if (user) {
            try {
                var parsed = JSON.parse(user);
                document.getElementById('currentUser').textContent = parsed.name || parsed.username || '';
            } catch (e) {}
        }

        document.getElementById('mainApp').classList.remove('hidden');
        loadSessions();
        initKleshnyaWS();

        // Connect main ParkWS too
        if (typeof ParkWS !== 'undefined') ParkWS.connect();
    }

    document.getElementById('logoutBtn').addEventListener('click', function () {
        if (typeof ParkWS !== 'undefined') ParkWS.disconnect();
        localStorage.removeItem('pzp_token');
        localStorage.removeItem('pzp_current_user');
        localStorage.removeItem('pzp_session');
        window.location.href = '/';
    });

    // Keyboard shortcut: Escape closes modals/sidebar
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            hideContextMenu();
            if ($renameOverlay.classList.contains('visible')) {
                $renameOverlay.classList.remove('visible');
            }
            if (reportOverlay.classList.contains('visible')) {
                reportOverlay.classList.remove('visible');
            }
            closeSidebar();
        }
    });

    // Init
    checkAuth();
})();
