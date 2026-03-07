/**
 * js/chat-page.js — Team messenger frontend logic (Phase 1 MVP)
 */
(function () {
    'use strict';

    var API_BASE = '/api/chat';
    var _currentChannel = null;
    var _channels = [];
    var _chatUsers = [];
    var _replyTo = null;
    var _oldestSeq = null;
    var _loadingMore = false;
    var _typingUsers = {};
    var _typingTimers = {};
    var _currentUserId = null;
    var _currentUsername = null;
    var _offlineQueue = [];
    var _soundsEnabled = true;

    // Sound preloading
    var _sounds = {};
    function _preloadSounds() {
        ['message-new', 'message-sent', 'mention'].forEach(function (name) {
            try {
                _sounds[name] = new Audio('sounds/' + name + '.mp3');
                _sounds[name].volume = 0.5;
            } catch (e) { /* ignore */ }
        });
    }

    function _playSound(name) {
        if (!_soundsEnabled || document.hasFocus()) return;
        try {
            if (_sounds[name]) {
                _sounds[name].currentTime = 0;
                _sounds[name].play().catch(function () {});
            }
        } catch (e) { /* ignore */ }
    }

    function _playSoundAlways(name) {
        if (!_soundsEnabled) return;
        try {
            if (_sounds[name]) {
                _sounds[name].currentTime = 0;
                _sounds[name].play().catch(function () {});
            }
        } catch (e) { /* ignore */ }
    }

    // ==========================================
    // AUTH HEADERS
    // ==========================================

    function _headers(withContentType) {
        var token = localStorage.getItem('pzp_token');
        var h = {};
        if (withContentType !== false) h['Content-Type'] = 'application/json';
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    async function _api(method, path, body) {
        var opts = { method: method, headers: _headers() };
        if (body) opts.body = JSON.stringify(body);
        var resp = await fetch(API_BASE + path, opts);
        if (resp.status === 401 || resp.status === 403) {
            localStorage.removeItem('pzp_token');
            if (typeof showLoginScreen === 'function') showLoginScreen();
            return null;
        }
        if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.error || 'API error');
        }
        return resp.json();
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================

    // ==========================================
    // AUTH + INIT (direct execution, kleshnya pattern)
    // ==========================================

    function _checkAuthAndInit() {
        _preloadSounds();
        _loadOfflineQueue();

        // Dark mode
        if (localStorage.getItem('pzp_darkMode') === 'true') {
            document.body.classList.add('dark-mode');
        }

        // Auth check (standalone page pattern — like kleshnya)
        var token = localStorage.getItem('pzp_token');
        if (!token) {
            window.location.href = '/';
            return;
        }

        var savedUser = localStorage.getItem('pzp_current_user');
        if (savedUser) {
            try {
                var parsed = JSON.parse(savedUser);
                _currentUserId = String(parsed.id || parsed.userId);
                _currentUsername = parsed.username;
                var userEl = document.getElementById('currentUser');
                if (userEl) userEl.textContent = parsed.name || parsed.username || '';
            } catch (e) {
                console.error('[Chat] Failed to parse saved user:', e);
            }
        }

        // Show main app FIRST (prevent white page)
        document.getElementById('mainApp').classList.remove('hidden');

        // Connect WebSocket
        if (typeof ParkWS !== 'undefined') ParkWS.connect();

        // Load channels and messages
        _init();
    }

    // Logout handler
    document.getElementById('logoutBtn').addEventListener('click', function () {
        if (typeof ParkWS !== 'undefined') ParkWS.disconnect();
        localStorage.removeItem('pzp_token');
        localStorage.removeItem('pzp_current_user');
        localStorage.removeItem('pzp_session');
        window.location.href = '/';
    });

    // Sidebar toggle (mobile)
    var _toggleBtn = document.getElementById('chatToggleSidebar');
    var _sidebar = document.getElementById('chatSidebar');
    var _overlay = document.getElementById('chatSidebarOverlay');
    if (_toggleBtn) {
        _toggleBtn.addEventListener('click', function () {
            _sidebar.classList.toggle('open');
            _overlay.classList.toggle('visible');
        });
    }
    if (_overlay) {
        _overlay.addEventListener('click', function () {
            _sidebar.classList.remove('open');
            _overlay.classList.remove('visible');
        });
    }

    // Input handlers
    var _input = document.getElementById('chatInput');
    var _sendBtn = document.getElementById('chatSendBtn');

    if (_input) {
        _input.addEventListener('input', function () {
            _autoGrow(this);
            if (_currentChannel) {
                ParkWS.sendChatTyping(_currentChannel.id);
            }
            _handleMentionInput(this);
        });

        _input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
            }
            if (e.key === 'Escape') {
                _closeMentionPopup();
                _cancelReply();
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                var popup = document.getElementById('chatMentionPopup');
                if (popup && popup.classList.contains('visible')) {
                    e.preventDefault();
                    _navigateMention(e.key === 'ArrowDown' ? 1 : -1);
                }
            }
            if (e.key === 'Tab') {
                var popup2 = document.getElementById('chatMentionPopup');
                if (popup2 && popup2.classList.contains('visible')) {
                    e.preventDefault();
                    _selectMention();
                }
            }
        });
    }

    if (_sendBtn) {
        _sendBtn.addEventListener('click', _sendMessage);
    }

    // Reply close
    var _replyCloseBtn = document.getElementById('chatReplyClose');
    if (_replyCloseBtn) {
        _replyCloseBtn.addEventListener('click', _cancelReply);
    }

    // WebSocket chat events
    window.addEventListener('ws:chat', function (e) {
        _handleChatEvent(e.detail);
    });

    // Infinite scroll
    var _messagesEl = document.getElementById('chatMessages');
    if (_messagesEl) {
        _messagesEl.addEventListener('scroll', function () {
            if (this.scrollTop < 100 && !_loadingMore && _currentChannel && _oldestSeq > 1) {
                _loadOlderMessages();
            }
        });
    }

    // Reconnect: drain offline queue
    window.addEventListener('wsStatusChange', function (e) {
        if (e.detail.connected) {
            _drainOfflineQueue();
            if (_currentChannel) {
                ParkWS.joinChannel(_currentChannel.id);
            }
        }
    });

    // Keyboard shortcut: Escape closes modals/sidebar
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            _sidebar.classList.remove('open');
            _overlay.classList.remove('visible');
        }
    });

    // Init
    _checkAuthAndInit();

    async function _init() {
        try {
            // Load channels and users in parallel
            var results = await Promise.all([
                _api('GET', '/channels'),
                _api('GET', '/users')
            ]);
            _channels = results[0] || [];
            _chatUsers = results[1] || [];

            _renderChannels();

            // Select first channel
            if (_channels.length > 0) {
                _selectChannel(_channels[0]);
            }
        } catch (err) {
            console.error('[Chat] Init error:', err);
        }
    }

    // ==========================================
    // CHANNELS
    // ==========================================

    function _renderChannels() {
        var list = document.getElementById('chatChannelsList');
        list.innerHTML = '';

        _channels.forEach(function (ch) {
            var el = document.createElement('div');
            el.className = 'chat-channel-item' + (_currentChannel && _currentChannel.id === ch.id ? ' active' : '');
            el.dataset.channelId = ch.id;

            var icon = ch.name.charAt(1).toUpperCase();
            var preview = ch.lastMessageContent
                ? (ch.lastMessageUsername ? ch.lastMessageUsername + ': ' : '') + ch.lastMessageContent
                : ch.description || 'Ще немає повідомлень';

            el.innerHTML =
                '<div class="chat-channel-icon">' + icon + '</div>' +
                '<div class="chat-channel-info">' +
                    '<div class="chat-channel-name">' + _esc(ch.name) + '</div>' +
                    '<div class="chat-channel-preview">' + _esc(_truncate(preview, 40)) + '</div>' +
                '</div>' +
                (ch.unreadCount > 0 ? '<div class="chat-channel-badge">' + ch.unreadCount + '</div>' : '');

            el.addEventListener('click', function () {
                _selectChannel(ch);
            });
            list.appendChild(el);
        });
    }

    async function _selectChannel(channel) {
        // Leave previous
        if (_currentChannel) {
            ParkWS.leaveChannel(_currentChannel.id);
        }

        _currentChannel = channel;
        _replyTo = null;
        _cancelReply();

        // Update UI
        document.getElementById('chatHeaderName').textContent = channel.name;
        document.getElementById('chatHeaderDesc').textContent = channel.description || '';
        document.getElementById('chatInput').disabled = false;
        document.getElementById('chatSendBtn').disabled = false;

        // Mark active in sidebar
        document.querySelectorAll('.chat-channel-item').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.channelId) === channel.id);
        });

        // Close mobile sidebar
        document.getElementById('chatSidebar').classList.remove('open');
        document.getElementById('chatSidebarOverlay').classList.remove('visible');

        // Join WS channel
        ParkWS.joinChannel(channel.id);

        // Load messages
        try {
            var messages = await _api('GET', '/channels/' + channel.id + '/messages');
            _renderMessages(messages || []);

            // Mark as read
            if (messages && messages.length > 0) {
                var maxSeq = messages[messages.length - 1].seq;
                _oldestSeq = messages[0].seq;
                _api('PUT', '/channels/' + channel.id + '/read', { seq: maxSeq });

                // Update local unread count
                channel.unreadCount = 0;
                _renderChannels();
            } else {
                _oldestSeq = 0;
            }
        } catch (err) {
            console.error('[Chat] Load messages error:', err);
        }

        // Focus input
        document.getElementById('chatInput').focus();
    }

    // ==========================================
    // MESSAGES RENDERING
    // ==========================================

    function _renderMessages(messages) {
        var container = document.getElementById('chatMessages');
        container.innerHTML = '';

        if (messages.length === 0) {
            container.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">💬</div><div>Почніть спілкування!</div></div>';
            return;
        }

        var lastDate = null;
        messages.forEach(function (msg) {
            var msgDate = new Date(msg.createdAt).toLocaleDateString('uk-UA');
            if (msgDate !== lastDate) {
                lastDate = msgDate;
                var divider = document.createElement('div');
                divider.className = 'chat-date-divider';
                divider.innerHTML = '<span>' + msgDate + '</span>';
                container.appendChild(divider);
            }
            container.appendChild(_createMessageEl(msg));
        });

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    function _createMessageEl(msg) {
        var isOwn = String(msg.userId) === _currentUserId;
        var el = document.createElement('div');
        el.className = 'chat-message' + (isOwn ? ' own' : '');
        el.dataset.messageId = msg.id;
        el.dataset.seq = msg.seq;

        var initial = (msg.displayName || msg.username || '?').charAt(0).toUpperCase();
        var time = new Date(msg.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        var content = msg.deletedAt ? '<em style="color:var(--gray-400)">Повідомлення видалено</em>' : _formatContent(msg.content);

        var replyHtml = '';
        if (msg.replyTo && msg.replyContent) {
            replyHtml = '<div class="chat-reply-block">' +
                '<div class="chat-reply-block-user">' + _esc(msg.replyUsername || '') + '</div>' +
                '<div class="chat-reply-block-text">' + _esc(_truncate(msg.replyContent, 60)) + '</div>' +
                '</div>';
        }

        var reactionsHtml = _renderReactions(msg);

        el.innerHTML =
            '<div class="chat-avatar">' + initial + '</div>' +
            '<div class="chat-bubble">' +
                '<div class="chat-bubble-header">' +
                    '<span class="chat-bubble-username">' + _esc(msg.displayName || msg.username) + '</span>' +
                    '<span class="chat-bubble-time">' + time + '</span>' +
                '</div>' +
                replyHtml +
                '<div class="chat-bubble-content">' + content + '</div>' +
                reactionsHtml +
                '<div class="chat-msg-actions">' +
                    '<button class="chat-msg-action-btn" data-action="reply" title="Відповісти">↩</button>' +
                    '<button class="chat-msg-action-btn" data-action="react" title="Реакція">😊</button>' +
                '</div>' +
            '</div>';

        // Action handlers
        el.querySelector('[data-action="reply"]').addEventListener('click', function () {
            _startReply(msg);
        });
        el.querySelector('[data-action="react"]').addEventListener('click', function (e) {
            _showEmojiPicker(msg, e.target);
        });

        // Reaction chip clicks
        el.querySelectorAll('.chat-reaction-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                _toggleReaction(msg.id, chip.dataset.emoji);
            });
        });

        return el;
    }

    function _renderReactions(msg) {
        if (!msg.reactions || msg.reactions.length === 0) return '';

        // Group by emoji
        var groups = {};
        msg.reactions.forEach(function (r) {
            if (!groups[r.emoji]) groups[r.emoji] = [];
            groups[r.emoji].push(r);
        });

        var html = '<div class="chat-reactions">';
        for (var emoji in groups) {
            var isOwn = groups[emoji].some(function (r) { return String(r.userId) === _currentUserId; });
            html += '<button class="chat-reaction-chip' + (isOwn ? ' own' : '') + '" data-emoji="' + emoji + '">' +
                emoji + ' <span class="chat-reaction-count">' + groups[emoji].length + '</span></button>';
        }
        html += '</div>';
        return html;
    }

    function _formatContent(text) {
        // Escape HTML first
        var safe = _esc(text);
        // Format @mentions
        safe = safe.replace(/\B@(\w+)/g, '<span class="chat-mention">@$1</span>');
        return safe;
    }

    // ==========================================
    // SEND MESSAGE
    // ==========================================

    async function _sendMessage() {
        var input = document.getElementById('chatInput');
        var content = input.value.trim();
        if (!content || !_currentChannel) return;

        // Clear input immediately (optimistic)
        input.value = '';
        _autoGrow(input);
        _closeMentionPopup();

        var msgData = {
            content: content,
            replyTo: _replyTo ? _replyTo.id : null
        };

        _cancelReply();

        // Check if online
        if (!ParkWS.isConnected()) {
            _offlineQueue.push({ channelId: _currentChannel.id, data: msgData });
            _saveOfflineQueue();
            // Show optimistic message
            _appendOptimisticMessage(content);
            return;
        }

        try {
            var msg = await _api('POST', '/channels/' + _currentChannel.id + '/messages', msgData);
            if (msg) {
                _appendMessage(msg);
                _playSoundAlways('message-sent');
            }
        } catch (err) {
            console.error('[Chat] Send error:', err);
            // Put content back
            input.value = content;
            _autoGrow(input);
        }
    }

    function _appendMessage(msg) {
        var container = document.getElementById('chatMessages');
        // Remove empty state
        var empty = container.querySelector('.chat-empty');
        if (empty) empty.remove();

        container.appendChild(_createMessageEl(msg));
        container.scrollTop = container.scrollHeight;
    }

    function _appendOptimisticMessage(content) {
        var msg = {
            id: 'pending-' + Date.now(),
            channelId: _currentChannel.id,
            userId: _currentUserId,
            seq: 0,
            content: content,
            replyTo: null,
            replyContent: null,
            replyUsername: null,
            createdAt: new Date().toISOString(),
            username: _currentUsername,
            displayName: _currentUsername,
            reactions: []
        };
        _appendMessage(msg);
    }

    // ==========================================
    // REPLY
    // ==========================================

    function _startReply(msg) {
        _replyTo = msg;
        var preview = document.getElementById('chatReplyPreview');
        preview.classList.add('visible');
        document.getElementById('chatReplyUser').textContent = msg.displayName || msg.username;
        document.getElementById('chatReplyContent').textContent = _truncate(msg.content, 100);
        document.getElementById('chatInput').focus();
    }

    function _cancelReply() {
        _replyTo = null;
        document.getElementById('chatReplyPreview').classList.remove('visible');
    }

    // ==========================================
    // REACTIONS
    // ==========================================

    function _showEmojiPicker(msg, target) {
        // Remove existing picker
        document.querySelectorAll('.chat-emoji-picker').forEach(function (el) { el.remove(); });

        var picker = document.createElement('div');
        picker.className = 'chat-emoji-picker';
        var emojis = ['👍', '❤️', '😂', '🔥', '👀', '✅'];
        emojis.forEach(function (emoji) {
            var btn = document.createElement('button');
            btn.className = 'chat-emoji-btn';
            btn.textContent = emoji;
            btn.addEventListener('click', function () {
                _toggleReaction(msg.id, emoji);
                picker.remove();
            });
            picker.appendChild(btn);
        });

        var bubble = target.closest('.chat-bubble');
        bubble.appendChild(picker);

        // Auto-close
        setTimeout(function () { picker.remove(); }, 5000);
        document.addEventListener('click', function handler(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', handler);
            }
        }, { once: false });
    }

    async function _toggleReaction(messageId, emoji) {
        try {
            // Check if own reaction exists
            var msgEl = document.querySelector('[data-message-id="' + messageId + '"]');
            var existingChip = msgEl ? msgEl.querySelector('.chat-reaction-chip.own[data-emoji="' + emoji + '"]') : null;

            if (existingChip) {
                await _api('DELETE', '/messages/' + messageId + '/reactions/' + encodeURIComponent(emoji));
            } else {
                await _api('POST', '/messages/' + messageId + '/reactions', { emoji: emoji });
            }
        } catch (err) {
            console.error('[Chat] Reaction error:', err);
        }
    }

    // ==========================================
    // @MENTION AUTOCOMPLETE
    // ==========================================

    var _mentionStart = -1;
    var _mentionActiveIdx = 0;

    function _handleMentionInput(input) {
        var val = input.value;
        var cursorPos = input.selectionStart;
        var beforeCursor = val.substring(0, cursorPos);

        // Find @ trigger
        var atIdx = beforeCursor.lastIndexOf('@');
        if (atIdx === -1 || (atIdx > 0 && /\w/.test(beforeCursor[atIdx - 1]))) {
            _closeMentionPopup();
            return;
        }

        var query = beforeCursor.substring(atIdx + 1).toLowerCase();
        _mentionStart = atIdx;

        // Filter users
        var filtered = _chatUsers.filter(function (u) {
            return u.username.toLowerCase().startsWith(query) ||
                   (u.displayName && u.displayName.toLowerCase().startsWith(query));
        }).slice(0, 6);

        if (filtered.length === 0) {
            _closeMentionPopup();
            return;
        }

        _mentionActiveIdx = 0;
        _renderMentionPopup(filtered);
    }

    function _renderMentionPopup(users) {
        var popup = document.getElementById('chatMentionPopup');
        popup.innerHTML = '';
        popup.classList.add('visible');

        users.forEach(function (u, idx) {
            var item = document.createElement('div');
            item.className = 'chat-mention-item' + (idx === _mentionActiveIdx ? ' active' : '');
            item.dataset.username = u.username;
            var initial = (u.displayName || u.username).charAt(0).toUpperCase();
            item.innerHTML =
                '<div class="chat-mention-item-avatar">' + initial + '</div>' +
                '<div>' +
                    '<div class="chat-mention-item-name">' + _esc(u.displayName || u.username) + '</div>' +
                    '<div class="chat-mention-item-role">@' + _esc(u.username) + '</div>' +
                '</div>';
            item.addEventListener('click', function () {
                _insertMention(u.username);
            });
            popup.appendChild(item);
        });
    }

    function _navigateMention(dir) {
        var items = document.querySelectorAll('.chat-mention-item');
        if (items.length === 0) return;
        items[_mentionActiveIdx].classList.remove('active');
        _mentionActiveIdx = (_mentionActiveIdx + dir + items.length) % items.length;
        items[_mentionActiveIdx].classList.add('active');
    }

    function _selectMention() {
        var active = document.querySelector('.chat-mention-item.active');
        if (active) {
            _insertMention(active.dataset.username);
        }
    }

    function _insertMention(username) {
        var input = document.getElementById('chatInput');
        var val = input.value;
        var before = val.substring(0, _mentionStart);
        var after = val.substring(input.selectionStart);
        input.value = before + '@' + username + ' ' + after;
        var newPos = _mentionStart + username.length + 2;
        input.setSelectionRange(newPos, newPos);
        input.focus();
        _closeMentionPopup();
    }

    function _closeMentionPopup() {
        var popup = document.getElementById('chatMentionPopup');
        popup.classList.remove('visible');
        popup.innerHTML = '';
        _mentionStart = -1;
    }

    // ==========================================
    // WEBSOCKET EVENTS
    // ==========================================

    function _handleChatEvent(detail) {
        var type = detail.eventType;
        var payload = detail.payload;

        switch (type) {
            case 'chat:message':
                _onNewMessage(payload);
                break;
            case 'chat:typing':
                _onTyping(payload);
                break;
            case 'chat:reaction':
                _onReaction(payload);
                break;
            case 'chat:read':
                // Could show read indicators in future
                break;
            case 'chat:mention':
                _playSound('mention');
                break;
        }
    }

    function _onNewMessage(payload) {
        var msg = payload.message;
        if (!msg) return;

        // If it's for the active channel, show it
        if (_currentChannel && msg.channelId === _currentChannel.id) {
            _appendMessage(msg);
            // Mark as read
            _api('PUT', '/channels/' + msg.channelId + '/read', { seq: msg.seq });
        } else {
            // Increment unread for that channel
            var ch = _channels.find(function (c) { return c.id === msg.channelId; });
            if (ch) {
                ch.unreadCount = (ch.unreadCount || 0) + 1;
                ch.lastMessageContent = msg.content;
                ch.lastMessageUsername = msg.username;
                _renderChannels();
            }
        }

        _playSound('message-new');
    }

    function _onTyping(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        if (String(payload.userId) === _currentUserId) return;

        var username = payload.username;
        _typingUsers[username] = true;
        _renderTyping();

        // Clear after 4 seconds
        if (_typingTimers[username]) clearTimeout(_typingTimers[username]);
        _typingTimers[username] = setTimeout(function () {
            delete _typingUsers[username];
            delete _typingTimers[username];
            _renderTyping();
        }, 4000);
    }

    function _renderTyping() {
        var el = document.getElementById('chatTyping');
        var names = Object.keys(_typingUsers);
        if (names.length === 0) {
            el.innerHTML = '';
            return;
        }
        var text = names.length === 1
            ? names[0] + ' пише'
            : names.slice(0, 2).join(', ') + ' пишуть';
        el.innerHTML = text + ' <span class="chat-typing-dots"><span></span><span></span><span></span></span>';
    }

    function _onReaction(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.messageId + '"]');
        if (!msgEl) return;

        // Update reactions in DOM
        var existingReactions = msgEl.querySelector('.chat-reactions');
        var fakeMsg = { reactions: payload.reactions };
        var newHtml = _renderReactions(fakeMsg);

        if (existingReactions) {
            existingReactions.outerHTML = newHtml;
        } else {
            var content = msgEl.querySelector('.chat-bubble-content');
            if (content) content.insertAdjacentHTML('afterend', newHtml);
        }

        // Re-bind reaction chip clicks
        msgEl.querySelectorAll('.chat-reaction-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                _toggleReaction(payload.messageId, chip.dataset.emoji);
            });
        });
    }

    // ==========================================
    // INFINITE SCROLL
    // ==========================================

    async function _loadOlderMessages() {
        if (!_currentChannel || _loadingMore || _oldestSeq <= 1) return;
        _loadingMore = true;

        try {
            var messages = await _api('GET', '/channels/' + _currentChannel.id + '/messages?before=' + _oldestSeq + '&limit=30');
            if (!messages || messages.length === 0) {
                _oldestSeq = 0; // No more messages
                return;
            }

            _oldestSeq = messages[0].seq;
            var container = document.getElementById('chatMessages');
            var prevHeight = container.scrollHeight;

            // Prepend messages (they come oldest-first)
            var lastDate = null;
            var frag = document.createDocumentFragment();
            messages.forEach(function (msg) {
                var msgDate = new Date(msg.createdAt).toLocaleDateString('uk-UA');
                if (msgDate !== lastDate) {
                    lastDate = msgDate;
                    var divider = document.createElement('div');
                    divider.className = 'chat-date-divider';
                    divider.innerHTML = '<span>' + msgDate + '</span>';
                    frag.appendChild(divider);
                }
                frag.appendChild(_createMessageEl(msg));
            });
            container.insertBefore(frag, container.firstChild);

            // Maintain scroll position
            container.scrollTop = container.scrollHeight - prevHeight;
        } catch (err) {
            console.error('[Chat] Load older error:', err);
        } finally {
            _loadingMore = false;
        }
    }

    // ==========================================
    // OFFLINE QUEUE
    // ==========================================

    function _loadOfflineQueue() {
        try {
            var data = localStorage.getItem('pzp_chat_queue');
            _offlineQueue = data ? JSON.parse(data) : [];
        } catch (e) {
            _offlineQueue = [];
        }
    }

    function _saveOfflineQueue() {
        localStorage.setItem('pzp_chat_queue', JSON.stringify(_offlineQueue));
    }

    async function _drainOfflineQueue() {
        if (_offlineQueue.length === 0) return;
        var queue = _offlineQueue.slice();
        _offlineQueue = [];
        _saveOfflineQueue();

        for (var item of queue) {
            try {
                await _api('POST', '/channels/' + item.channelId + '/messages', item.data);
            } catch (err) {
                console.error('[Chat] Offline drain error:', err);
            }
        }
    }

    // ==========================================
    // UTILITIES
    // ==========================================

    function _autoGrow(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    function _esc(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '...' : str;
    }
})();
