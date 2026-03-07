/**
 * js/chat-page.js — Team messenger frontend logic v2.0
 * Telegram-inspired UX: channels, @mentions, reactions, reply-to, typing, sounds
 */
(function () {
    'use strict';

    var API_BASE = '/api/chat';
    var _currentChannel = null;
    var _channels = [];
    var _chatUsers = [];
    var _replyTo = null;
    var _editingMsg = null;
    var _contextMsg = null;
    var _oldestSeq = null;
    var _loadingMore = false;
    var _typingUsers = {};
    var _typingTimers = {};
    var _currentUserId = null;
    var _currentUsername = null;
    var _offlineQueue = [];
    var _soundsEnabled = true;
    var _emojiPanelOpen = false;
    var _emojiFrequent = [];
    var _channelMembers = [];

    // Emoji data (Telegram categories)
    var EMOJI_CATEGORIES = [
        { icon: '\u{1F554}', name: 'Часті', key: 'frequent' },
        { icon: '\u{1F600}', name: 'Смайли', key: 'smileys' },
        { icon: '\u{1F44D}', name: 'Жести', key: 'gestures' },
        { icon: '\u{2764}\uFE0F', name: 'Символи', key: 'symbols' },
        { icon: '\u{1F436}', name: 'Тварини', key: 'animals' },
        { icon: '\u{1F34E}', name: 'Їжа', key: 'food' },
        { icon: '\u{26BD}', name: 'Активності', key: 'activities' }
    ];

    var EMOJI_DATA = {
        smileys: ['\u{1F600}','\u{1F603}','\u{1F604}','\u{1F601}','\u{1F606}','\u{1F605}','\u{1F602}','\u{1F923}','\u{1F642}','\u{1F643}','\u{1F609}','\u{1F60A}','\u{1F607}','\u{1F970}','\u{1F60D}','\u{1F929}','\u{1F618}','\u{1F617}','\u{1F61A}','\u{1F619}','\u{1F60B}','\u{1F61B}','\u{1F61C}','\u{1F92A}','\u{1F61D}','\u{1F911}','\u{1F917}','\u{1F92D}','\u{1F92B}','\u{1F914}','\u{1F910}','\u{1F928}','\u{1F610}','\u{1F611}','\u{1F636}','\u{1F60F}','\u{1F612}','\u{1F644}','\u{1F62C}','\u{1F925}','\u{1F60C}','\u{1F614}','\u{1F62A}','\u{1F924}','\u{1F634}','\u{1F637}','\u{1F912}','\u{1F915}','\u{1F922}','\u{1F92E}','\u{1F927}','\u{1F975}','\u{1F976}','\u{1F974}','\u{1F635}','\u{1F92F}','\u{1F920}','\u{1F973}','\u{1F60E}','\u{1F913}','\u{1F9D0}','\u{1F615}','\u{1F61F}','\u{1F641}','\u{2639}\uFE0F','\u{1F62E}','\u{1F62F}','\u{1F632}','\u{1F633}','\u{1F97A}','\u{1F626}','\u{1F627}','\u{1F628}','\u{1F630}','\u{1F625}','\u{1F622}','\u{1F62D}','\u{1F631}','\u{1F616}','\u{1F623}','\u{1F61E}','\u{1F613}','\u{1F629}','\u{1F62B}','\u{1F971}','\u{1F624}','\u{1F621}','\u{1F620}','\u{1F92C}','\u{1F608}','\u{1F47F}','\u{1F480}','\u{2620}\uFE0F','\u{1F4A9}','\u{1F921}','\u{1F479}','\u{1F47A}','\u{1F47B}','\u{1F47D}','\u{1F47E}','\u{1F916}'],
        gestures: ['\u{1F44D}','\u{1F44E}','\u{1F44A}','\u{270A}','\u{1F91B}','\u{1F91C}','\u{1F44F}','\u{1F64C}','\u{1F450}','\u{1F932}','\u{1F91D}','\u{1F64F}','\u{270D}\uFE0F','\u{1F485}','\u{1F933}','\u{1F4AA}','\u{1F9BE}','\u{1F9BF}','\u{1F448}','\u{1F449}','\u{261D}\uFE0F','\u{1F446}','\u{1F595}','\u{1F447}','\u{270C}\uFE0F','\u{1F91E}','\u{1F596}','\u{1F918}','\u{1F919}','\u{1F590}\uFE0F','\u{270B}','\u{1F44B}','\u{1F44C}','\u{1F90F}','\u{1F90C}','\u{1F90D}','\u{1F9E1}','\u{1F49B}','\u{1F49A}','\u{1F499}','\u{1F49C}','\u{1F5A4}','\u{1F90E}','\u{1F494}','\u{2764}\uFE0F','\u{1F495}','\u{1F496}','\u{1F497}','\u{1F498}','\u{1F49D}'],
        symbols: ['\u{2705}','\u{274C}','\u{2753}','\u{2757}','\u{1F4AF}','\u{1F525}','\u{2B50}','\u{1F31F}','\u{1F4A5}','\u{1F4A2}','\u{1F4AB}','\u{1F4A6}','\u{1F4A8}','\u{1F4A3}','\u{1F389}','\u{1F38A}','\u{1F3AF}','\u{1F3C6}','\u{1F3C5}','\u{1F947}','\u{1F948}','\u{1F949}','\u{26A0}\uFE0F','\u{1F6AB}','\u{267B}\uFE0F','\u{1F504}','\u{1F4CC}','\u{1F4DD}','\u{1F4CB}','\u{1F4C8}','\u{1F4C9}','\u{1F4CA}','\u{1F512}','\u{1F513}','\u{1F514}','\u{1F515}'],
        animals: ['\u{1F436}','\u{1F431}','\u{1F42D}','\u{1F439}','\u{1F430}','\u{1F98A}','\u{1F43B}','\u{1F43C}','\u{1F428}','\u{1F42F}','\u{1F981}','\u{1F42E}','\u{1F437}','\u{1F438}','\u{1F435}','\u{1F412}','\u{1F414}','\u{1F427}','\u{1F426}','\u{1F985}','\u{1F989}','\u{1F987}','\u{1F43A}','\u{1F417}','\u{1F434}','\u{1F984}','\u{1F41D}','\u{1F41B}','\u{1F98B}','\u{1F40C}','\u{1F41A}','\u{1F41E}','\u{1F41C}','\u{1F997}','\u{1F577}\uFE0F','\u{1F982}','\u{1F422}','\u{1F40D}','\u{1F98E}','\u{1F9E6}'],
        food: ['\u{1F34E}','\u{1F34F}','\u{1F34A}','\u{1F34B}','\u{1F34C}','\u{1F349}','\u{1F347}','\u{1F353}','\u{1F348}','\u{1F352}','\u{1F351}','\u{1F34D}','\u{1F965}','\u{1F95D}','\u{1F345}','\u{1F346}','\u{1F951}','\u{1F955}','\u{1F33D}','\u{1F336}\uFE0F','\u{1F954}','\u{1F360}','\u{1F950}','\u{1F35E}','\u{1F956}','\u{1F968}','\u{1F96F}','\u{1F9C0}','\u{1F356}','\u{1F357}','\u{1F969}','\u{1F953}','\u{1F354}','\u{1F35F}','\u{1F355}','\u{1F32D}','\u{1F96A}','\u{1F32E}','\u{1F32F}','\u{1F959}'],
        activities: ['\u{26BD}','\u{1F3C0}','\u{1F3C8}','\u{26BE}','\u{1F94E}','\u{1F3BE}','\u{1F3D0}','\u{1F3C9}','\u{1F94F}','\u{1F3B1}','\u{1F3D3}','\u{1F3F8}','\u{1F3D2}','\u{1F94C}','\u{1F3D1}','\u{1F94D}','\u{26F3}','\u{1F3CB}\uFE0F','\u{1F6B4}','\u{1F3AE}','\u{1F3B2}','\u{1F3AD}','\u{1F3A8}','\u{1F3B5}','\u{1F3B6}','\u{1F3A4}','\u{1F3A7}','\u{1F3B8}','\u{1F3B9}','\u{1F3BA}']
    };

    // Color palette for avatars and usernames
    var COLORS = 8;
    function _colorIdx(id) {
        return (parseInt(id, 10) || 0) % COLORS;
    }
    function _channelColorIdx(idx) {
        return idx % 6;
    }

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
    // AUTH + INIT (direct execution, kleshnya pattern)
    // ==========================================

    function _checkAuthAndInit() {
        _preloadSounds();
        _loadOfflineQueue();

        // Dark mode
        if (localStorage.getItem('pzp_darkMode') === 'true') {
            document.body.classList.add('dark-mode');
        }

        // Auth check (standalone page pattern)
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
    var _logoutBtn = document.getElementById('logoutBtn');
    if (_logoutBtn) {
        _logoutBtn.addEventListener('click', function () {
            if (typeof ParkWS !== 'undefined') ParkWS.disconnect();
            localStorage.removeItem('pzp_token');
            localStorage.removeItem('pzp_current_user');
            localStorage.removeItem('pzp_session');
            window.location.href = '/';
        });
    }

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

    // Channel search
    var _searchInput = document.getElementById('chatSearchInput');
    if (_searchInput) {
        _searchInput.addEventListener('input', function () {
            var q = this.value.toLowerCase().trim();
            document.querySelectorAll('.chat-channel-item').forEach(function (el) {
                var name = (el.querySelector('.chat-channel-name') || {}).textContent || '';
                el.style.display = name.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    // Input handlers
    var _input = document.getElementById('chatInput');
    var _sendBtn = document.getElementById('chatSendBtn');

    if (_input) {
        _input.addEventListener('input', function () {
            _autoGrow(this);
            if (_currentChannel && typeof ParkWS !== 'undefined') {
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
                _cancelEdit();
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

    // Emoji panel toggle
    var _emojiToggle = document.getElementById('chatEmojiToggle');
    if (_emojiToggle) {
        _emojiToggle.addEventListener('click', function () {
            _toggleEmojiPanel();
        });
    }

    function _loadEmojiFrequent() {
        try {
            _emojiFrequent = JSON.parse(localStorage.getItem('pzp_emoji_freq') || '[]');
        } catch (e) { _emojiFrequent = []; }
    }
    function _saveEmojiFrequent(emoji) {
        _emojiFrequent = _emojiFrequent.filter(function (e) { return e !== emoji; });
        _emojiFrequent.unshift(emoji);
        if (_emojiFrequent.length > 30) _emojiFrequent = _emojiFrequent.slice(0, 30);
        localStorage.setItem('pzp_emoji_freq', JSON.stringify(_emojiFrequent));
    }
    _loadEmojiFrequent();

    function _toggleEmojiPanel() {
        var panel = document.getElementById('chatEmojiPanel');
        if (!panel) return;
        _emojiPanelOpen = !_emojiPanelOpen;
        panel.style.display = _emojiPanelOpen ? 'flex' : 'none';
        if (_emojiToggle) _emojiToggle.classList.toggle('active', _emojiPanelOpen);
        if (_emojiPanelOpen) _buildEmojiPanel(panel);
    }

    function _buildEmojiPanel(panel) {
        var activeCategory = 'frequent';
        panel.innerHTML = '';

        // Tabs
        var tabs = document.createElement('div');
        tabs.className = 'chat-emoji-panel-tabs';
        EMOJI_CATEGORIES.forEach(function (cat) {
            var btn = document.createElement('button');
            btn.className = 'chat-emoji-panel-tab' + (cat.key === activeCategory ? ' active' : '');
            btn.textContent = cat.icon;
            btn.title = cat.name;
            btn.addEventListener('click', function () {
                activeCategory = cat.key;
                tabs.querySelectorAll('.chat-emoji-panel-tab').forEach(function (t) { t.classList.remove('active'); });
                btn.classList.add('active');
                _renderEmojiGrid(grid, cat.key, searchInput.value.trim());
            });
            tabs.appendChild(btn);
        });
        panel.appendChild(tabs);

        // Search
        var searchWrap = document.createElement('div');
        searchWrap.className = 'chat-emoji-panel-search';
        searchWrap.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        var searchInput = document.createElement('input');
        searchInput.placeholder = 'Пошук...';
        searchInput.addEventListener('input', _debounce(function () {
            _renderEmojiGrid(grid, activeCategory, searchInput.value.trim());
        }, 150));
        searchWrap.appendChild(searchInput);
        panel.appendChild(searchWrap);

        // Grid
        var grid = document.createElement('div');
        grid.className = 'chat-emoji-panel-grid';
        _renderEmojiGrid(grid, activeCategory, '');
        panel.appendChild(grid);
    }

    function _renderEmojiGrid(grid, category, search) {
        grid.innerHTML = '';
        var emojis = [];
        if (category === 'frequent') {
            emojis = _emojiFrequent.length > 0 ? _emojiFrequent : EMOJI_DATA.smileys.slice(0, 20);
        } else {
            emojis = EMOJI_DATA[category] || [];
        }
        if (search) {
            // Simple search: just show all matching across categories
            emojis = [];
            Object.keys(EMOJI_DATA).forEach(function (k) {
                emojis = emojis.concat(EMOJI_DATA[k]);
            });
        }
        var row = document.createElement('div');
        row.className = 'chat-emoji-panel-row';
        emojis.forEach(function (e) {
            var btn = document.createElement('button');
            btn.className = 'chat-emoji-panel-btn';
            btn.textContent = e;
            btn.addEventListener('click', function () {
                _insertEmojiIntoInput(e);
                _saveEmojiFrequent(e);
            });
            row.appendChild(btn);
        });
        grid.appendChild(row);
    }

    function _insertEmojiIntoInput(emoji) {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var start = input.selectionStart || input.value.length;
        var before = input.value.substring(0, start);
        var after = input.value.substring(start);
        input.value = before + emoji + after;
        var newPos = start + emoji.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
        _autoGrow(input);
    }

    // Reply close
    var _replyCloseBtn = document.getElementById('chatReplyClose');
    if (_replyCloseBtn) {
        _replyCloseBtn.addEventListener('click', _cancelReply);
    }

    // Edit close
    var _editCloseBtn = document.getElementById('chatEditClose');
    if (_editCloseBtn) {
        _editCloseBtn.addEventListener('click', _cancelEdit);
    }

    // Create channel modal
    var _newChannelBtn = document.getElementById('chatNewChannel');
    var _newChannelOverlay = document.getElementById('chatNewChannelOverlay');
    var _newChannelCancel = document.getElementById('chatNewChannelCancel');
    var _newChannelCreate = document.getElementById('chatNewChannelCreate');
    var _newChannelName = document.getElementById('chatNewChannelName');
    var _newChannelDesc = document.getElementById('chatNewChannelDesc');

    if (_newChannelBtn) {
        _newChannelBtn.addEventListener('click', function () {
            _newChannelOverlay.style.display = 'flex';
            _newChannelName.value = '';
            _newChannelDesc.value = '';
            _newChannelName.focus();
        });
    }
    if (_newChannelCancel) {
        _newChannelCancel.addEventListener('click', function () {
            _newChannelOverlay.style.display = 'none';
        });
    }
    if (_newChannelOverlay) {
        _newChannelOverlay.addEventListener('click', function (e) {
            if (e.target === _newChannelOverlay) _newChannelOverlay.style.display = 'none';
        });
    }
    if (_newChannelCreate) {
        _newChannelCreate.addEventListener('click', async function () {
            var name = _newChannelName.value.trim();
            if (!name) return;
            try {
                var channel = await _api('POST', '/channels', { name: name, description: _newChannelDesc.value.trim() });
                if (channel) {
                    _channels.unshift(channel);
                    _renderChannels();
                    _selectChannel(channel);
                    _newChannelOverlay.style.display = 'none';
                }
            } catch (err) {
                alert(err.message || 'Помилка створення каналу');
            }
        });
    }
    if (_newChannelName) {
        _newChannelName.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') _newChannelCreate.click();
            if (e.key === 'Escape') _newChannelOverlay.style.display = 'none';
        });
    }

    // ==========================================
    // DM MODAL
    // ==========================================
    var _dmBtn = document.getElementById('chatNewDm');
    var _dmOverlay = document.getElementById('chatDmOverlay');
    var _dmCancel = document.getElementById('chatDmCancel');
    var _dmSearch = document.getElementById('chatDmSearch');
    var _dmUserList = document.getElementById('chatDmUserList');

    if (_dmBtn) {
        _dmBtn.addEventListener('click', function () {
            _dmOverlay.style.display = 'flex';
            _dmSearch.value = '';
            _renderDmUserList('');
            _dmSearch.focus();
        });
    }
    if (_dmCancel) {
        _dmCancel.addEventListener('click', function () { _dmOverlay.style.display = 'none'; });
    }
    if (_dmOverlay) {
        _dmOverlay.addEventListener('click', function (e) { if (e.target === _dmOverlay) _dmOverlay.style.display = 'none'; });
    }
    if (_dmSearch) {
        _dmSearch.addEventListener('input', function () { _renderDmUserList(this.value.trim()); });
    }

    function _renderDmUserList(query) {
        if (!_dmUserList) return;
        var q = query.toLowerCase();
        var filtered = _chatUsers.filter(function (u) {
            if (String(u.id) === _currentUserId) return false;
            if (!q) return true;
            return (u.username || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
        });
        _dmUserList.innerHTML = '';
        filtered.forEach(function (u) {
            var initial = (u.displayName || u.username || '?').charAt(0).toUpperCase();
            var colorClass = 'chat-avatar-color-' + _colorIdx(u.id || 0);
            var item = document.createElement('div');
            item.className = 'chat-dm-user-item';
            item.innerHTML =
                '<div class="chat-dm-user-item-avatar ' + colorClass + '">' + initial + '</div>' +
                '<div class="chat-dm-user-item-info">' +
                    '<div class="chat-dm-user-item-name">' + _esc(u.displayName || u.username) + '</div>' +
                    '<div class="chat-dm-user-item-role">@' + _esc(u.username) + ' · ' + _esc(_roleLabel(u.role)) + '</div>' +
                '</div>';
            item.addEventListener('click', function () {
                _startDm(u.id);
                _dmOverlay.style.display = 'none';
            });
            _dmUserList.appendChild(item);
        });
        if (filtered.length === 0) {
            _dmUserList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Нікого не знайдено</div>';
        }
    }

    async function _startDm(targetUserId) {
        try {
            var channel = await _api('POST', '/dm', { targetUserId: targetUserId });
            if (channel) {
                // Check if already in channels list
                var exists = _channels.find(function (c) { return c.id === channel.id; });
                if (!exists) {
                    _channels.unshift(channel);
                }
                _renderChannels();
                _selectChannel(channel);
            }
        } catch (err) {
            console.error('[Chat] DM error:', err);
        }
    }

    function _roleLabel(role) {
        if (role === 'admin') return 'Адмін';
        if (role === 'manager') return 'Менеджер';
        if (role === 'animator') return 'Аніматор';
        return 'Користувач';
    }

    // ==========================================
    // ADD MEMBER MODAL
    // ==========================================
    var _addMemberOverlay = document.getElementById('chatAddMemberOverlay');
    var _addMemberCancel = document.getElementById('chatAddMemberCancel');
    var _addMemberSearch = document.getElementById('chatAddMemberSearch');
    var _addMemberList = document.getElementById('chatAddMemberList');

    if (_addMemberCancel) {
        _addMemberCancel.addEventListener('click', function () { _addMemberOverlay.style.display = 'none'; });
    }
    if (_addMemberOverlay) {
        _addMemberOverlay.addEventListener('click', function (e) { if (e.target === _addMemberOverlay) _addMemberOverlay.style.display = 'none'; });
    }
    if (_addMemberSearch) {
        _addMemberSearch.addEventListener('input', function () { _renderAddMemberList(this.value.trim()); });
    }

    function _openAddMemberModal() {
        if (!_addMemberOverlay) return;
        _addMemberOverlay.style.display = 'flex';
        _addMemberSearch.value = '';
        _renderAddMemberList('');
        _addMemberSearch.focus();
    }

    function _renderAddMemberList(query) {
        if (!_addMemberList || !_currentChannel) return;
        var q = query.toLowerCase();
        var memberIds = _channelMembers.map(function (m) { return String(m.id); });
        var filtered = _chatUsers.filter(function (u) {
            if (memberIds.indexOf(String(u.id)) >= 0) return false;
            if (!q) return true;
            return (u.username || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q);
        });
        _addMemberList.innerHTML = '';
        filtered.forEach(function (u) {
            var initial = (u.displayName || u.username || '?').charAt(0).toUpperCase();
            var colorClass = 'chat-avatar-color-' + _colorIdx(u.id || 0);
            var item = document.createElement('div');
            item.className = 'chat-dm-user-item';
            item.innerHTML =
                '<div class="chat-dm-user-item-avatar ' + colorClass + '">' + initial + '</div>' +
                '<div class="chat-dm-user-item-info">' +
                    '<div class="chat-dm-user-item-name">' + _esc(u.displayName || u.username) + '</div>' +
                    '<div class="chat-dm-user-item-role">@' + _esc(u.username) + '</div>' +
                '</div>';
            item.addEventListener('click', async function () {
                try {
                    await _api('POST', '/channels/' + _currentChannel.id + '/members', { userId: u.id });
                    _channelMembers.push({ id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role });
                    _renderAddMemberList(query);
                    _renderInfoPanel();
                } catch (err) {
                    console.error('[Chat] Add member error:', err);
                }
            });
            _addMemberList.appendChild(item);
        });
        if (filtered.length === 0) {
            _addMemberList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Всі вже додані</div>';
        }
    }

    // ==========================================
    // USER PROFILE PANEL
    // ==========================================
    async function _showUserProfile(userId) {
        if (!_infoPanel) return;
        try {
            var profile = await _api('GET', '/users/' + userId + '/profile');
            if (!profile) return;
            _infoBtn.classList.remove('active');
            _pinBtn.classList.remove('active');
            document.getElementById('chatInfoPanelTitle').textContent = 'Профіль';
            var body = document.getElementById('chatInfoPanelBody');
            var initial = (profile.displayName || profile.username || '?').charAt(0).toUpperCase();
            var colorClass = 'chat-avatar-color-' + _colorIdx(profile.id);
            var roleLabel = _roleLabel(profile.role);

            var fields = '';
            if (profile.department) {
                fields += '<div class="chat-profile-field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><div><span class="chat-profile-field-label">Відділ</span>' + _esc(profile.department) + '</div></div>';
            }
            if (profile.position) {
                fields += '<div class="chat-profile-field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg><div><span class="chat-profile-field-label">Посада</span>' + _esc(profile.position) + '</div></div>';
            }
            if (profile.phone) {
                fields += '<div class="chat-profile-field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg><div><span class="chat-profile-field-label">Телефон</span>' + _esc(profile.phone) + '</div></div>';
            }
            if (profile.telegram) {
                fields += '<div class="chat-profile-field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><div><span class="chat-profile-field-label">Telegram</span>@' + _esc(profile.telegram) + '</div></div>';
            }
            var joinDate = new Date(profile.joinedAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
            fields += '<div class="chat-profile-field"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div><span class="chat-profile-field-label">В системі з</span>' + joinDate + '</div></div>';

            body.innerHTML =
                '<div class="chat-profile-card">' +
                    '<div class="chat-profile-avatar ' + colorClass + '">' + initial + '</div>' +
                    '<div class="chat-profile-name">' + _esc(profile.displayName) + '</div>' +
                    '<div class="chat-profile-username">@' + _esc(profile.username) + '</div>' +
                    '<div class="chat-profile-role-badge">' + roleLabel + '</div>' +
                    '<div class="chat-profile-fields">' + fields + '</div>' +
                    '<div class="chat-profile-actions">' +
                        '<button class="chat-profile-action-btn" data-dm-user="' + profile.id + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Написати</button>' +
                        '<button class="chat-profile-action-btn" data-tasks-user="' + profile.username + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Задачі</button>' +
                    '</div>' +
                '</div>';

            // DM button handler
            var dmBtn = body.querySelector('[data-dm-user]');
            if (dmBtn) {
                dmBtn.addEventListener('click', function () {
                    _startDm(parseInt(dmBtn.dataset.dmUser, 10));
                    _infoPanel.classList.remove('open');
                });
            }
            // Tasks button handler
            var tasksBtn = body.querySelector('[data-tasks-user]');
            if (tasksBtn) {
                tasksBtn.addEventListener('click', function () {
                    window.open('/tasks?assignee=' + encodeURIComponent(tasksBtn.dataset.tasksUser), '_blank');
                });
            }

            _infoPanel.classList.add('open');
        } catch (err) {
            console.error('[Chat] Profile error:', err);
        }
    }

    // Pin button — show pinned messages in right panel
    var _pinBtn = document.getElementById('chatPinBtn');
    if (_pinBtn) {
        _pinBtn.addEventListener('click', async function () {
            if (!_currentChannel) return;
            var isOpen = _infoPanel.classList.contains('open') && document.getElementById('chatInfoPanelTitle').textContent === 'Закріплені';
            if (isOpen) {
                _infoPanel.classList.remove('open');
                _pinBtn.classList.remove('active');
            } else {
                _infoBtn.classList.remove('active');
                _pinBtn.classList.add('active');
                document.getElementById('chatInfoPanelTitle').textContent = 'Закріплені';
                await _renderPinnedPanel();
                _infoPanel.classList.add('open');
            }
        });
    }

    async function _renderPinnedPanel() {
        var body = document.getElementById('chatInfoPanelBody');
        if (!body || !_currentChannel) return;
        body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Завантаження...</div>';
        try {
            var pinned = await _api('GET', '/channels/' + _currentChannel.id + '/pinned');
            if (!pinned || pinned.length === 0) {
                body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px">Немає закріплених повідомлень</div>';
                return;
            }
            var html = '';
            pinned.forEach(function (msg) {
                var time = new Date(msg.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
                html += '<div class="chat-pinned-item" data-message-id="' + msg.id + '">' +
                    '<div class="chat-info-member-name">' + _esc(msg.displayName || msg.username) + ' <span style="font-weight:400;color:var(--gray-400);font-size:11px">' + time + '</span></div>' +
                    '<div style="font-size:13px;color:var(--gray-600);margin:2px 0 6px;line-height:1.4">' + _esc(_truncate(msg.content, 100)) + '</div>' +
                    '<button class="chat-context-item chat-context-danger" onclick="document.dispatchEvent(new CustomEvent(\'chat:unpin\',{detail:{messageId:' + msg.id + '}}))" style="padding:4px 8px;font-size:11px">Відкріпити</button>' +
                '</div>';
            });
            body.innerHTML = html;
        } catch (err) {
            body.innerHTML = '<div style="padding:16px;color:var(--danger);font-size:13px">Помилка завантаження</div>';
        }
    }

    document.addEventListener('chat:unpin', async function (e) {
        if (!_currentChannel) return;
        try {
            await _api('DELETE', '/channels/' + _currentChannel.id + '/pinned/' + e.detail.messageId);
            _renderPinnedPanel();
        } catch (err) {
            console.error('[Chat] Unpin error:', err);
        }
    });

    // Mute button
    var _muteBtn = document.getElementById('chatMuteBtn');
    if (_muteBtn) {
        _muteBtn.addEventListener('click', async function () {
            if (!_currentChannel) return;
            try {
                var result = await _api('PUT', '/channels/' + _currentChannel.id + '/mute');
                if (result) {
                    _muteBtn.classList.toggle('active', result.muted);
                    _muteBtn.title = result.muted ? 'Увімкнути сповіщення' : 'Вимкнути сповіщення';
                }
            } catch (err) {
                console.error('[Chat] Mute error:', err);
            }
        });
    }

    // Context menu (right-click on messages)
    var _contextMenu = document.getElementById('chatContextMenu');
    document.addEventListener('contextmenu', function (e) {
        var msgEl = e.target.closest('.chat-message');
        if (!msgEl || !_currentChannel) return;
        e.preventDefault();

        var msgId = msgEl.dataset.messageId;
        var msgUserId = msgEl.dataset.userId;
        var isOwn = msgEl.classList.contains('own');
        _contextMsg = { id: msgId, isOwn: isOwn, el: msgEl, userId: msgUserId };

        // Show/hide edit option (only own messages)
        var editItem = _contextMenu.querySelector('[data-action="edit"]');
        if (editItem) editItem.style.display = isOwn ? 'flex' : 'none';

        // Show/hide delete option (own messages)
        var deleteItem = _contextMenu.querySelector('[data-action="delete"]');
        if (deleteItem) deleteItem.style.display = isOwn ? 'flex' : 'none';

        // Show/hide profile and DM (only for other users' messages)
        var profileItem = _contextMenu.querySelector('[data-action="profile"]');
        if (profileItem) profileItem.style.display = isOwn ? 'none' : 'flex';
        var dmItem = _contextMenu.querySelector('[data-action="dm"]');
        if (dmItem) dmItem.style.display = isOwn ? 'none' : 'flex';

        // Position context menu
        var x = e.clientX;
        var y = e.clientY;
        _contextMenu.style.display = 'block';
        var menuW = _contextMenu.offsetWidth;
        var menuH = _contextMenu.offsetHeight;
        if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
        if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
        _contextMenu.style.left = x + 'px';
        _contextMenu.style.top = y + 'px';
    });

    document.addEventListener('click', function () {
        if (_contextMenu) _contextMenu.style.display = 'none';
    });

    // Context menu action handlers
    if (_contextMenu) {
        _contextMenu.addEventListener('click', function (e) {
            var btn = e.target.closest('.chat-context-item');
            if (!btn || !_contextMsg) return;
            var action = btn.dataset.action;

            switch (action) {
                case 'reply':
                    _startReplyFromContext();
                    break;
                case 'edit':
                    _startEdit();
                    break;
                case 'pin':
                    _pinFromContext();
                    break;
                case 'react':
                    _reactFromContext();
                    break;
                case 'delete':
                    _deleteFromContext();
                    break;
                case 'profile':
                    if (_contextMsg && _contextMsg.userId) {
                        _showUserProfile(parseInt(_contextMsg.userId, 10));
                    }
                    break;
                case 'dm':
                    if (_contextMsg && _contextMsg.userId) {
                        _startDm(parseInt(_contextMsg.userId, 10));
                    }
                    break;
            }
            _contextMenu.style.display = 'none';
        });
    }

    function _startReplyFromContext() {
        if (!_contextMsg) return;
        var contentEl = _contextMsg.el.querySelector('.chat-bubble-content');
        var usernameEl = _contextMsg.el.querySelector('.chat-bubble-username');
        _startReply({
            id: _contextMsg.id,
            content: contentEl ? contentEl.textContent : '',
            displayName: usernameEl ? usernameEl.textContent : '',
            username: usernameEl ? usernameEl.textContent : ''
        });
    }

    function _startEdit() {
        if (!_contextMsg || !_contextMsg.isOwn) return;
        var contentEl = _contextMsg.el.querySelector('.chat-bubble-content');
        if (!contentEl) return;
        _editingMsg = { id: _contextMsg.id, el: _contextMsg.el };
        var editPreview = document.getElementById('chatEditPreview');
        var editContent = document.getElementById('chatEditContent');
        if (editPreview) editPreview.style.display = 'flex';
        if (editContent) editContent.textContent = _truncate(contentEl.textContent, 80);
        var input = document.getElementById('chatInput');
        if (input) {
            input.value = contentEl.textContent;
            input.focus();
            _autoGrow(input);
        }
    }

    function _cancelEdit() {
        _editingMsg = null;
        var editPreview = document.getElementById('chatEditPreview');
        if (editPreview) editPreview.style.display = 'none';
        var input = document.getElementById('chatInput');
        if (input) {
            input.value = '';
            _autoGrow(input);
        }
    }

    async function _pinFromContext() {
        if (!_contextMsg || !_currentChannel) return;
        try {
            await _api('POST', '/channels/' + _currentChannel.id + '/pinned', { messageId: parseInt(_contextMsg.id, 10) });
        } catch (err) {
            console.error('[Chat] Pin error:', err);
        }
    }

    function _reactFromContext() {
        if (!_contextMsg) return;
        var bubble = _contextMsg.el.querySelector('.chat-bubble');
        if (bubble) {
            _showEmojiPicker({ id: _contextMsg.id }, bubble);
        }
    }

    async function _deleteFromContext() {
        if (!_contextMsg) return;
        if (!confirm('Видалити повідомлення?')) return;
        try {
            await _api('DELETE', '/messages/' + _contextMsg.id);
            // Update UI immediately
            var contentEl = _contextMsg.el.querySelector('.chat-bubble-content');
            if (contentEl) {
                contentEl.innerHTML = '<em style="color:var(--gray-400)">Повідомлення видалено</em>';
            }
            // Remove reactions and actions
            var reactions = _contextMsg.el.querySelector('.chat-reactions');
            if (reactions) reactions.remove();
            var actions = _contextMsg.el.querySelector('.chat-msg-actions');
            if (actions) actions.remove();
        } catch (err) {
            console.error('[Chat] Delete error:', err);
        }
    }

    // Search messages button
    var _searchMsgBtn = document.getElementById('chatSearchMsgBtn');
    var _searchBar = document.getElementById('chatSearchBar');
    var _searchMsgInput = document.getElementById('chatSearchMsgInput');
    var _searchMsgClose = document.getElementById('chatSearchMsgClose');
    var _searchMsgCount = document.getElementById('chatSearchMsgCount');

    if (_searchMsgBtn) {
        _searchMsgBtn.addEventListener('click', function () {
            if (!_currentChannel) return;
            var isOpen = _searchBar.style.display !== 'none';
            if (isOpen) {
                _closeSearchBar();
            } else {
                _searchBar.style.display = 'flex';
                _searchMsgBtn.classList.add('active');
                _searchMsgInput.focus();
            }
        });
    }
    if (_searchMsgClose) {
        _searchMsgClose.addEventListener('click', _closeSearchBar);
    }
    if (_searchMsgInput) {
        _searchMsgInput.addEventListener('input', _debounce(function () {
            _searchMessages(this.value.trim());
        }, 250));
        _searchMsgInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') _closeSearchBar();
        });
    }

    function _closeSearchBar() {
        if (_searchBar) _searchBar.style.display = 'none';
        if (_searchMsgBtn) _searchMsgBtn.classList.remove('active');
        if (_searchMsgInput) _searchMsgInput.value = '';
        if (_searchMsgCount) _searchMsgCount.textContent = '';
        // Remove highlights
        document.querySelectorAll('.chat-message.search-highlight').forEach(function (el) {
            el.classList.remove('search-highlight');
        });
    }

    function _searchMessages(query) {
        // Remove previous highlights
        document.querySelectorAll('.chat-message.search-highlight').forEach(function (el) {
            el.classList.remove('search-highlight');
        });
        if (!query) {
            if (_searchMsgCount) _searchMsgCount.textContent = '';
            return;
        }
        var q = query.toLowerCase();
        var found = 0;
        var firstMatch = null;
        document.querySelectorAll('.chat-message').forEach(function (el) {
            var content = (el.querySelector('.chat-bubble-content') || {}).textContent || '';
            if (content.toLowerCase().includes(q)) {
                el.classList.add('search-highlight');
                found++;
                if (!firstMatch) firstMatch = el;
            }
        });
        if (_searchMsgCount) _searchMsgCount.textContent = found > 0 ? found + ' зн.' : 'не знайдено';
        if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Channel info panel button
    var _infoBtn = document.getElementById('chatInfoBtn');
    var _infoPanel = document.getElementById('chatInfoPanel');
    var _infoPanelClose = document.getElementById('chatInfoPanelClose');

    if (_infoBtn) {
        _infoBtn.addEventListener('click', function () {
            if (!_currentChannel) return;
            var isOpen = _infoPanel.classList.contains('open') && document.getElementById('chatInfoPanelTitle').textContent === 'Учасники';
            if (isOpen) {
                _infoPanel.classList.remove('open');
                _infoBtn.classList.remove('active');
            } else {
                if (_pinBtn) _pinBtn.classList.remove('active');
                _infoBtn.classList.add('active');
                document.getElementById('chatInfoPanelTitle').textContent = 'Учасники';
                _renderInfoPanel();
                _infoPanel.classList.add('open');
            }
        });
    }
    if (_infoPanelClose) {
        _infoPanelClose.addEventListener('click', function () {
            _infoPanel.classList.remove('open');
            if (_infoBtn) _infoBtn.classList.remove('active');
            if (_pinBtn) _pinBtn.classList.remove('active');
        });
    }

    async function _renderInfoPanel() {
        var body = document.getElementById('chatInfoPanelBody');
        if (!body || !_currentChannel) return;
        body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">Завантаження...</div>';
        try {
            var members = await _api('GET', '/channels/' + _currentChannel.id + '/members');
            _channelMembers = members || [];
        } catch (err) {
            _channelMembers = _chatUsers;
        }
        var count = _channelMembers.length;
        var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px 8px">' +
            '<div class="chat-info-section-label" style="padding:0">' + count + ' ' + _pluralize(count, 'учасник', 'учасники', 'учасників') + '</div>' +
            '<button class="chat-sidebar-action-btn" id="chatAddMemberBtn" title="Додати учасника"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
            '</div>';
        _channelMembers.forEach(function (u) {
            var initial = (u.displayName || u.username || '?').charAt(0).toUpperCase();
            var colorClass = 'chat-avatar-color-' + _colorIdx(u.id || 0);
            html += '<div class="chat-info-member" data-user-id="' + u.id + '" style="cursor:pointer">' +
                '<div class="chat-info-member-avatar ' + colorClass + '">' + initial + '</div>' +
                '<div>' +
                    '<div class="chat-info-member-name">' + _esc(u.displayName || u.username) + '</div>' +
                    '<div class="chat-info-member-role">@' + _esc(u.username) + ' · ' + _esc(_roleLabel(u.role)) + '</div>' +
                '</div>' +
            '</div>';
        });
        body.innerHTML = html;

        // Add member button
        var addBtn = body.querySelector('#chatAddMemberBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function () { _openAddMemberModal(); });
        }

        // Click member → profile
        body.querySelectorAll('.chat-info-member[data-user-id]').forEach(function (el) {
            el.addEventListener('click', function () {
                _showUserProfile(parseInt(el.dataset.userId, 10));
            });
        });
    }

    // Scroll to bottom button
    var _scrollBottomBtn = document.getElementById('chatScrollBottom');
    var _messagesEl = document.getElementById('chatMessages');
    if (_scrollBottomBtn && _messagesEl) {
        _scrollBottomBtn.addEventListener('click', function () {
            _messagesEl.scrollTop = _messagesEl.scrollHeight;
            _scrollBottomBtn.classList.remove('visible');
        });
    }

    // WebSocket chat events
    window.addEventListener('ws:chat', function (e) {
        _handleChatEvent(e.detail);
    });

    // Infinite scroll + scroll-to-bottom visibility
    if (_messagesEl) {
        _messagesEl.addEventListener('scroll', function () {
            // Infinite scroll up
            if (this.scrollTop < 100 && !_loadingMore && _currentChannel && _oldestSeq > 1) {
                _loadOlderMessages();
            }
            // Show/hide scroll-to-bottom button
            var distFromBottom = this.scrollHeight - this.scrollTop - this.clientHeight;
            if (_scrollBottomBtn) {
                _scrollBottomBtn.classList.toggle('visible', distFromBottom > 200);
            }
        });
    }

    // Reconnect: drain offline queue
    window.addEventListener('wsStatusChange', function (e) {
        if (e.detail && e.detail.connected) {
            _drainOfflineQueue();
            if (_currentChannel && typeof ParkWS !== 'undefined') {
                ParkWS.joinChannel(_currentChannel.id);
            }
        }
    });

    // Keyboard shortcut: Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (_sidebar) _sidebar.classList.remove('open');
            if (_overlay) _overlay.classList.remove('visible');
        }
    });

    // Init
    _checkAuthAndInit();

    // ==========================================
    // INITIALIZATION
    // ==========================================

    async function _init() {
        try {
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
        if (!list) return;
        list.innerHTML = '';

        _channels.forEach(function (ch, idx) {
            var el = document.createElement('div');
            var isActive = _currentChannel && _currentChannel.id === ch.id;
            var hasUnread = ch.unreadCount > 0;
            el.className = 'chat-channel-item' + (isActive ? ' active' : '') + (hasUnread ? ' has-unread' : '');
            el.dataset.channelId = ch.id;

            var isDm = ch.isDm || false;
            var colorClass = isDm ? 'chat-avatar-color-' + _colorIdx(ch.dmOtherUserId || idx) : 'chat-channel-color-' + _channelColorIdx(idx);
            var iconClass = isDm ? 'chat-channel-dm-icon' : 'chat-channel-icon';
            var icon = isDm ? (ch.name || '?').charAt(0).toUpperCase() : ch.name.charAt(1).toUpperCase();
            var preview = ch.lastMessageContent
                ? (ch.lastMessageUsername ? ch.lastMessageUsername + ': ' : '') + ch.lastMessageContent
                : ch.description || 'Ще немає повідомлень';

            var timeStr = '';
            if (ch.lastMessageAt) {
                var d = new Date(ch.lastMessageAt);
                var now = new Date();
                timeStr = d.toDateString() === now.toDateString()
                    ? d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
                    : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
            }

            el.innerHTML =
                '<div class="' + iconClass + ' ' + colorClass + '">' + icon + '</div>' +
                '<div class="chat-channel-info">' +
                    '<div class="chat-channel-name-row">' +
                        '<div class="chat-channel-name">' + _esc(ch.name) + '</div>' +
                        (timeStr ? '<span class="chat-channel-time">' + timeStr + '</span>' : '') +
                    '</div>' +
                    '<div class="chat-channel-preview-row">' +
                        '<div class="chat-channel-preview">' + _esc(_truncate(preview, 35)) + '</div>' +
                        (hasUnread ? '<div class="chat-channel-badge">' + ch.unreadCount + '</div>' : '') +
                    '</div>' +
                '</div>';

            el.addEventListener('click', function () {
                _selectChannel(ch);
            });
            list.appendChild(el);
        });
    }

    async function _selectChannel(channel) {
        // Leave previous
        if (_currentChannel && typeof ParkWS !== 'undefined') {
            ParkWS.leaveChannel(_currentChannel.id);
        }

        _currentChannel = channel;
        _replyTo = null;
        _cancelReply();

        // Update header
        document.getElementById('chatHeaderName').textContent = channel.name;
        document.getElementById('chatHeaderDesc').textContent = channel.description || '';

        // Close right panel
        if (_infoPanel && _infoPanel.classList.contains('open')) {
            _infoPanel.classList.remove('open');
            if (_infoBtn) _infoBtn.classList.remove('active');
            if (_pinBtn) _pinBtn.classList.remove('active');
        }

        // Set mute button state from channel data
        if (_muteBtn) {
            _muteBtn.classList.toggle('active', !!channel.muted);
            _muteBtn.title = channel.muted ? 'Увімкнути сповіщення' : 'Вимкнути сповіщення';
        }

        // Enable input
        var inputEl = document.getElementById('chatInput');
        var sendBtnEl = document.getElementById('chatSendBtn');
        if (inputEl) inputEl.disabled = false;
        if (sendBtnEl) sendBtnEl.disabled = false;

        // Mark active in sidebar
        document.querySelectorAll('.chat-channel-item').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.channelId) === channel.id);
        });

        // Close mobile sidebar
        if (_sidebar) _sidebar.classList.remove('open');
        if (_overlay) _overlay.classList.remove('visible');

        // Join WS channel
        if (typeof ParkWS !== 'undefined') ParkWS.joinChannel(channel.id);

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
        if (inputEl) inputEl.focus();
    }

    // ==========================================
    // MESSAGES RENDERING
    // ==========================================

    function _renderMessages(messages) {
        var container = document.getElementById('chatMessages');
        if (!container) return;
        container.innerHTML = '';

        if (messages.length === 0) {
            container.innerHTML =
                '<div class="chat-empty">' +
                    '<div class="chat-empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>' +
                    '<div class="chat-empty-title">Почніть спілкування!</div>' +
                    '<div class="chat-empty-hint">Напишіть перше повідомлення у канал ' + _esc(_currentChannel ? _currentChannel.name : '') + '</div>' +
                '</div>';
            return;
        }

        var lastDate = null;
        var lastUserId = null;
        messages.forEach(function (msg) {
            var msgDate = new Date(msg.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
            if (msgDate !== lastDate) {
                lastDate = msgDate;
                lastUserId = null; // Reset grouping on new date
                var divider = document.createElement('div');
                divider.className = 'chat-date-divider';
                divider.innerHTML = '<span>' + msgDate + '</span>';
                container.appendChild(divider);
            }

            // Message grouping: same user within 3 minutes
            var isGrouped = false;
            if (lastUserId === String(msg.userId) && !msg.replyTo) {
                isGrouped = true;
            }
            lastUserId = String(msg.userId);

            container.appendChild(_createMessageEl(msg, isGrouped));
        });

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    function _createMessageEl(msg, isGrouped) {
        var isOwn = String(msg.userId) === _currentUserId;
        var el = document.createElement('div');
        el.className = 'chat-message' + (isOwn ? ' own' : '') + (isGrouped ? ' grouped' : '');
        el.dataset.messageId = msg.id;
        el.dataset.seq = msg.seq;
        el.dataset.userId = msg.userId;

        var initial = (msg.displayName || msg.username || '?').charAt(0).toUpperCase();
        var time = new Date(msg.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        var content = msg.deletedAt ? '<em style="color:var(--gray-400)">Повідомлення видалено</em>' : _formatContent(msg.content);
        var editedHtml = msg.editedAt && !msg.deletedAt ? '<span class="chat-bubble-edited">(ред.)</span>' : '';
        var readCheckHtml = '';
        if (isOwn && !msg.deletedAt) {
            readCheckHtml = '<span class="chat-read-check sent" title="Відправлено">✓</span>';
        }

        var avatarColorClass = 'chat-avatar-color-' + _colorIdx(msg.userId);
        var usernameColorClass = 'chat-username-color-' + _colorIdx(msg.userId);

        var replyHtml = '';
        if (msg.replyTo && msg.replyContent) {
            replyHtml = '<div class="chat-reply-block">' +
                '<div class="chat-reply-block-user">' + _esc(msg.replyUsername || '') + '</div>' +
                '<div class="chat-reply-block-text">' + _esc(_truncate(msg.replyContent, 60)) + '</div>' +
                '</div>';
        }

        var reactionsHtml = _renderReactions(msg);

        el.innerHTML =
            '<div class="chat-avatar ' + avatarColorClass + '">' + initial + '</div>' +
            '<div class="chat-bubble">' +
                '<div class="chat-bubble-header">' +
                    '<span class="chat-bubble-username ' + usernameColorClass + '">' + _esc(msg.displayName || msg.username) + '</span>' +
                    editedHtml +
                    '<span class="chat-bubble-time">' + time + readCheckHtml + '</span>' +
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
        var replyBtn = el.querySelector('[data-action="reply"]');
        if (replyBtn) {
            replyBtn.addEventListener('click', function () {
                _startReply(msg);
            });
        }
        var reactBtn = el.querySelector('[data-action="react"]');
        if (reactBtn) {
            reactBtn.addEventListener('click', function (e) {
                _showEmojiPicker(msg, e.target);
            });
        }

        // Reaction chip clicks
        el.querySelectorAll('.chat-reaction-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                _toggleReaction(msg.id, chip.dataset.emoji);
            });
        });

        // Avatar click → profile
        var avatarEl = el.querySelector('.chat-avatar');
        if (avatarEl && !isOwn) {
            avatarEl.style.cursor = 'pointer';
            avatarEl.addEventListener('click', function () {
                _showUserProfile(msg.userId);
            });
        }

        // Username click → profile
        var usernameEl = el.querySelector('.chat-bubble-username');
        if (usernameEl && !isOwn) {
            usernameEl.style.cursor = 'pointer';
            usernameEl.addEventListener('click', function () {
                _showUserProfile(msg.userId);
            });
        }

        return el;
    }

    function _renderReactions(msg) {
        if (!msg.reactions || msg.reactions.length === 0) return '';

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
        var safe = _esc(text);
        // Format @mentions
        safe = safe.replace(/\B@(\w+)/g, '<span class="chat-mention">@$1</span>');
        // Format URLs
        safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary-dark);text-decoration:underline">$1</a>');
        return safe;
    }

    // ==========================================
    // SEND MESSAGE
    // ==========================================

    async function _sendMessage() {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var content = input.value.trim();
        if (!content || !_currentChannel) return;

        // Close emoji panel on send
        if (_emojiPanelOpen) _toggleEmojiPanel();

        // Handle /task command
        if (content.startsWith('/task ') || content.startsWith('/задача ')) {
            var taskText = content.replace(/^\/(?:task|задача)\s+/, '');
            input.value = '';
            _autoGrow(input);
            _sendTaskFromChat(taskText);
            return;
        }

        // Handle edit mode
        if (_editingMsg) {
            var editId = _editingMsg.id;
            var editEl = _editingMsg.el;
            _cancelEdit();
            input.value = '';
            _autoGrow(input);
            try {
                var updated = await _api('PUT', '/messages/' + editId, { content: content });
                if (updated && editEl) {
                    var contentEl = editEl.querySelector('.chat-bubble-content');
                    if (contentEl) contentEl.innerHTML = _formatContent(updated.content);
                    // Add edited indicator
                    if (!editEl.querySelector('.chat-bubble-edited')) {
                        var timeEl = editEl.querySelector('.chat-bubble-time');
                        if (timeEl) timeEl.insertAdjacentHTML('beforebegin', '<span class="chat-bubble-edited">(ред.)</span>');
                    }
                }
            } catch (err) {
                console.error('[Chat] Edit error:', err);
                input.value = content;
                _autoGrow(input);
            }
            return;
        }

        // Clear input immediately (optimistic)
        input.value = '';
        _autoGrow(input);
        _closeMentionPopup();

        var msgData = {
            content: content,
            replyTo: _replyTo ? _replyTo.id : null,
            clientMessageId: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        };

        _cancelReply();

        // Check if online
        if (typeof ParkWS !== 'undefined' && !ParkWS.isConnected()) {
            _offlineQueue.push({ channelId: _currentChannel.id, data: msgData });
            _saveOfflineQueue();
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
            input.value = content;
            _autoGrow(input);
        }
    }

    function _appendMessage(msg) {
        var container = document.getElementById('chatMessages');
        if (!container) return;
        // Remove empty state
        var empty = container.querySelector('.chat-empty');
        if (empty) empty.remove();

        // Check grouping with last message
        var lastMsg = container.querySelector('.chat-message:last-child');
        var isGrouped = false;
        if (lastMsg && lastMsg.dataset.messageId) {
            var lastUserId = lastMsg.classList.contains('own') ? _currentUserId : (lastMsg.querySelector('.chat-avatar') || {}).dataset ? null : null;
            // Simplified: group if same user class
            var newIsOwn = String(msg.userId) === _currentUserId;
            var lastIsOwn = lastMsg.classList.contains('own');
            if (newIsOwn === lastIsOwn && !msg.replyTo) {
                isGrouped = true;
            }
        }

        container.appendChild(_createMessageEl(msg, isGrouped));
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
        if (preview) preview.classList.add('visible');
        var replyUser = document.getElementById('chatReplyUser');
        if (replyUser) replyUser.textContent = msg.displayName || msg.username;
        var replyContent = document.getElementById('chatReplyContent');
        if (replyContent) replyContent.textContent = _truncate(msg.content, 100);
        var input = document.getElementById('chatInput');
        if (input) input.focus();
    }

    function _cancelReply() {
        _replyTo = null;
        var preview = document.getElementById('chatReplyPreview');
        if (preview) preview.classList.remove('visible');
    }

    // ==========================================
    // REACTIONS
    // ==========================================

    function _showEmojiPicker(msg, target) {
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
        if (bubble) bubble.appendChild(picker);

        setTimeout(function () { if (picker.parentNode) picker.remove(); }, 5000);
        document.addEventListener('click', function handler(e) {
            if (!picker.contains(e.target) && e.target !== target) {
                picker.remove();
                document.removeEventListener('click', handler);
            }
        });
    }

    async function _toggleReaction(messageId, emoji) {
        try {
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

        var atIdx = beforeCursor.lastIndexOf('@');
        if (atIdx === -1 || (atIdx > 0 && /\w/.test(beforeCursor[atIdx - 1]))) {
            _closeMentionPopup();
            return;
        }

        var query = beforeCursor.substring(atIdx + 1).toLowerCase();
        _mentionStart = atIdx;

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
        if (!popup) return;
        popup.innerHTML = '<div class="chat-mention-popup-header">Учасники</div>';
        popup.classList.add('visible');

        users.forEach(function (u, idx) {
            var item = document.createElement('div');
            item.className = 'chat-mention-item' + (idx === _mentionActiveIdx ? ' active' : '');
            item.dataset.username = u.username;
            var initial = (u.displayName || u.username).charAt(0).toUpperCase();
            var avatarColor = 'chat-avatar-color-' + _colorIdx(u.id || idx);
            item.innerHTML =
                '<div class="chat-mention-item-avatar ' + avatarColor + '">' + initial + '</div>' +
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
        if (!input) return;
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
        if (popup) {
            popup.classList.remove('visible');
            popup.innerHTML = '';
        }
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
            case 'chat:edit':
                _onEditMessage(payload);
                break;
            case 'chat:delete':
                _onDeleteMessage(payload);
                break;
            case 'chat:read':
                _onReadReceipt(payload);
                break;
            case 'chat:mention':
                _playSoundAlways('mention');
                break;
        }
    }

    function _onNewMessage(payload) {
        var msg = payload.message;
        if (!msg) return;

        if (_currentChannel && msg.channelId === _currentChannel.id) {
            // Don't show our own messages twice (already shown optimistically by _sendMessage)
            if (String(msg.userId) === _currentUserId) return;
            _appendMessage(msg);
            _api('PUT', '/channels/' + msg.channelId + '/read', { seq: msg.seq });
        } else {
            var ch = _channels.find(function (c) { return c.id === msg.channelId; });
            if (ch) {
                ch.unreadCount = (ch.unreadCount || 0) + 1;
                ch.lastMessageContent = msg.content;
                ch.lastMessageUsername = msg.username;
                ch.lastMessageAt = msg.createdAt;
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

        if (_typingTimers[username]) clearTimeout(_typingTimers[username]);
        _typingTimers[username] = setTimeout(function () {
            delete _typingUsers[username];
            delete _typingTimers[username];
            _renderTyping();
        }, 4000);
    }

    function _renderTyping() {
        var el = document.getElementById('chatTyping');
        if (!el) return;
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

    function _onReadReceipt(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        // When someone reads up to seq X, mark all own messages with seq <= X as read (✓✓)
        var readSeq = payload.seq;
        if (!readSeq) return;
        document.querySelectorAll('.chat-message.own').forEach(function (el) {
            var msgSeq = parseInt(el.dataset.seq, 10);
            if (msgSeq <= readSeq) {
                var check = el.querySelector('.chat-read-check');
                if (check && !check.classList.contains('read')) {
                    check.classList.remove('sent');
                    check.classList.add('read');
                    check.textContent = '✓✓';
                    check.title = 'Прочитано';
                }
            }
        });
    }

    function _onReaction(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.messageId + '"]');
        if (!msgEl) return;

        var existingReactions = msgEl.querySelector('.chat-reactions');
        var fakeMsg = { reactions: payload.reactions };
        var newHtml = _renderReactions(fakeMsg);

        if (existingReactions) {
            existingReactions.outerHTML = newHtml;
        } else {
            var content = msgEl.querySelector('.chat-bubble-content');
            if (content) content.insertAdjacentHTML('afterend', newHtml);
        }

        msgEl.querySelectorAll('.chat-reaction-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                _toggleReaction(payload.messageId, chip.dataset.emoji);
            });
        });
    }

    function _onEditMessage(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.message.id + '"]');
        if (!msgEl) return;
        var contentEl = msgEl.querySelector('.chat-bubble-content');
        if (contentEl) contentEl.innerHTML = _formatContent(payload.message.content);
        if (!msgEl.querySelector('.chat-bubble-edited')) {
            var timeEl = msgEl.querySelector('.chat-bubble-time');
            if (timeEl) timeEl.insertAdjacentHTML('beforebegin', '<span class="chat-bubble-edited">(ред.)</span>');
        }
    }

    function _onDeleteMessage(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.messageId + '"]');
        if (!msgEl) return;
        var contentEl = msgEl.querySelector('.chat-bubble-content');
        if (contentEl) contentEl.innerHTML = '<em style="color:var(--gray-400)">Повідомлення видалено</em>';
        var reactions = msgEl.querySelector('.chat-reactions');
        if (reactions) reactions.remove();
        var actions = msgEl.querySelector('.chat-msg-actions');
        if (actions) actions.remove();
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
                _oldestSeq = 0;
                return;
            }

            _oldestSeq = messages[0].seq;
            var container = document.getElementById('chatMessages');
            if (!container) return;
            var prevHeight = container.scrollHeight;

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
                frag.appendChild(_createMessageEl(msg, false));
            });
            container.insertBefore(frag, container.firstChild);

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

        for (var i = 0; i < queue.length; i++) {
            try {
                await _api('POST', '/channels/' + queue[i].channelId + '/messages', queue[i].data);
            } catch (err) {
                console.error('[Chat] Offline drain error:', err);
            }
        }
    }

    // ==========================================
    // TASK FROM CHAT
    // ==========================================

    async function _sendTaskFromChat(taskText) {
        try {
            // Parse @username from task text: /task @username description
            var assignedTo = null;
            var title = taskText;
            var mentionMatch = taskText.match(/^@(\w+)\s+(.+)/);
            if (mentionMatch) {
                var targetUsername = mentionMatch[1];
                title = mentionMatch[2];
                var targetUser = _chatUsers.find(function (u) { return u.username.toLowerCase() === targetUsername.toLowerCase(); });
                if (targetUser) assignedTo = targetUser.id;
            }

            // Create task via chat tasks API
            var task = await _api('POST', '/tasks', {
                channelId: _currentChannel.id,
                assignedTo: assignedTo,
                title: title
            });

            if (task) {
                // Also create in main tasks system
                var token = localStorage.getItem('pzp_token');
                fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ title: title, priority: 'normal' })
                }).catch(function () {});

                // Send confirmation message
                var assignText = assignedTo ? ' → @' + mentionMatch[1] : '';
                var confirmMsg = await _api('POST', '/channels/' + _currentChannel.id + '/messages', {
                    content: '\u{1F4CB} Задачу створено: «' + title + '»' + assignText
                });
                if (confirmMsg) _appendMessage(confirmMsg);
            }
        } catch (err) {
            console.error('[Chat] Task creation error:', err);
            alert('Помилка: ' + err.message);
        }
    }

    // ==========================================
    // UTILITIES
    // ==========================================

    function _autoGrow(textarea) {
        if (!textarea) return;
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

    function _debounce(fn, ms) {
        var timer;
        return function () {
            var ctx = this, args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
        };
    }

    function _pluralize(n, one, few, many) {
        var abs = Math.abs(n) % 100;
        var last = abs % 10;
        if (abs > 10 && abs < 20) return many;
        if (last > 1 && last < 5) return few;
        if (last === 1) return one;
        return many;
    }
})();
