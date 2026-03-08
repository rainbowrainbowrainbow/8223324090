/**
 * js/chat-page.js — Team messenger frontend logic v2.0
 * Telegram-inspired UX: channels, @mentions, reactions, reply-to, typing, sounds
 */
(function () {
    'use strict';

    var API_BASE = '/api/chat';
    var _easterEggCommands = null; // populated later in FEATURE 20
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

    // Sound preloading — all available sounds
    var _sounds = {};
    function _preloadSounds() {
        ['message-new', 'message-sent', 'mention', 'connect', 'error', 'task-new'].forEach(function (name) {
            try {
                _sounds[name] = new Audio('sounds/' + name + '.mp3');
                _sounds[name].volume = 0.5;
                // Preload into memory
                _sounds[name].load();
            } catch (e) { /* ignore */ }
        });
    }

    function _playSound(name) {
        if (!_soundsEnabled || document.hasFocus()) return;
        try {
            if (_sounds[name]) {
                // Clone audio for overlapping sounds
                var s = _sounds[name].cloneNode();
                s.volume = _sounds[name].volume;
                s.play().catch(function () {});
            }
        } catch (e) { /* ignore */ }
    }

    function _playSoundAlways(name) {
        if (!_soundsEnabled) return;
        try {
            if (_sounds[name]) {
                var s = _sounds[name].cloneNode();
                s.volume = _sounds[name].volume;
                s.play().catch(function () {});
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
        if (resp.status === 401) {
            localStorage.removeItem('pzp_token');
            if (typeof showLoginScreen === 'function') showLoginScreen();
            return null;
        }
        if (resp.status === 403) {
            // 403 from mute = not auth failure, just blocked
            var errData = await resp.json().catch(function () { return {}; });
            throw new Error(errData.error || 'Доступ заборонено');
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
            _handleSlashCommand(this);
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

    // File upload
    var _fileBtn = document.getElementById('chatFileBtn');
    var _fileInput = document.getElementById('chatFileInput');
    var _filePreview = document.getElementById('chatFilePreview');
    var _filePreviewContent = document.getElementById('chatFilePreviewContent');
    var _filePreviewClose = document.getElementById('chatFilePreviewClose');
    var _pendingFile = null;

    if (_fileBtn && _fileInput) {
        _fileBtn.addEventListener('click', function () { _fileInput.click(); });
        _fileInput.addEventListener('change', function () {
            if (_fileInput.files && _fileInput.files[0]) {
                _pendingFile = _fileInput.files[0];
                _showFilePreview(_pendingFile);
            }
        });
    }
    if (_filePreviewClose) {
        _filePreviewClose.addEventListener('click', function () {
            _pendingFile = null;
            if (_filePreview) _filePreview.style.display = 'none';
            if (_fileInput) _fileInput.value = '';
        });
    }

    function _showFilePreview(file) {
        if (!_filePreview || !_filePreviewContent) return;
        var isImage = file.type.startsWith('image/');
        if (isImage) {
            var reader = new FileReader();
            reader.onload = function (e) {
                _filePreviewContent.innerHTML = '<img src="' + e.target.result + '" style="max-height:80px;border-radius:6px;object-fit:cover">' +
                    '<span style="margin-left:8px;font-size:13px">' + _esc(file.name) + ' (' + _formatFileSize(file.size) + ')</span>';
            };
            reader.readAsDataURL(file);
        } else {
            _filePreviewContent.innerHTML = '<span style="font-size:20px">📎</span>' +
                '<span style="margin-left:8px;font-size:13px">' + _esc(file.name) + ' (' + _formatFileSize(file.size) + ')</span>';
        }
        _filePreview.style.display = 'flex';
    }

    function _formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }

    async function _uploadFile() {
        if (!_pendingFile || !_currentChannel) return;
        var file = _pendingFile;
        var caption = document.getElementById('chatInput').value.trim();

        var formData = new FormData();
        formData.append('file', file);
        if (caption) formData.append('caption', caption);

        try {
            var token = localStorage.getItem('token');
            var resp = await fetch('/api/chat/channels/' + _currentChannel.id + '/upload', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            if (!resp.ok) throw new Error('Upload failed: ' + resp.status);

            // Clear
            _pendingFile = null;
            if (_filePreview) _filePreview.style.display = 'none';
            if (_fileInput) _fileInput.value = '';
            var input = document.getElementById('chatInput');
            if (input) { input.value = ''; if (typeof _autoGrow === 'function') _autoGrow(input); }
        } catch (err) {
            console.error('[Chat] Upload error:', err);
            alert('Помилка завантаження файлу');
        }
    }

    // Drag & drop on chat messages area
    var _chatMain = document.querySelector('.chat-main');
    if (_chatMain) {
        _chatMain.addEventListener('dragover', function (e) {
            e.preventDefault();
            _chatMain.classList.add('drag-over');
        });
        _chatMain.addEventListener('dragleave', function () {
            _chatMain.classList.remove('drag-over');
        });
        _chatMain.addEventListener('drop', function (e) {
            e.preventDefault();
            _chatMain.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                _pendingFile = e.dataTransfer.files[0];
                _showFilePreview(_pendingFile);
            }
        });
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
            var isProfileBot = profile.username === 'openclaw';
            var isProfileGuardian = profile.username === 'guardian';
            var initial = isProfileGuardian ? '🛡️' : isProfileBot ? '🦀' : (profile.avatarEmoji || (profile.displayName || profile.username || '?').charAt(0).toUpperCase());
            var colorClass = isProfileGuardian ? 'chat-avatar-guardian' : isProfileBot ? 'chat-avatar-bot' : (profile.avatarColor ? '' : 'chat-avatar-color-' + _colorIdx(profile.id));
            var avatarStyle = profile.avatarColor ? 'background:' + profile.avatarColor : '';
            var roleLabel = isProfileGuardian ? 'AI Охоронець' : isProfileBot ? 'AI Бот' : _roleLabel(profile.role);
            var isOwnProfile = String(profile.id) === _currentUserId;

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

            var avatarEditBtn = isOwnProfile ? '<button class="chat-profile-avatar-edit" data-edit-avatar="1" title="Змінити аватар">✏️</button>' : '';

            body.innerHTML =
                '<div class="chat-profile-card">' +
                    '<div class="chat-profile-avatar-wrap">' +
                        '<div class="chat-profile-avatar ' + colorClass + '"' + (avatarStyle ? ' style="' + avatarStyle + '"' : '') + '>' + initial + '</div>' +
                        avatarEditBtn +
                    '</div>' +
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

            // Avatar edit button handler
            var avatarEditBtn = body.querySelector('[data-edit-avatar]');
            if (avatarEditBtn) {
                avatarEditBtn.addEventListener('click', function () {
                    _showAvatarPicker(profile);
                });
            }

            _infoPanel.classList.add('open');
        } catch (err) {
            console.error('[Chat] Profile error:', err);
        }
    }

    var AVATAR_EMOJIS = ['😊', '😎', '🤓', '🦊', '🐱', '🐶', '🦁', '🐸', '🐵', '🦄', '🐲', '🦅', '🐺', '🐼', '🐨', '🦋', '🌟', '⚡', '🔥', '🎯', '🎸', '🎮', '🏀', '⚽', '🎪', '🎨', '🧸', '💎', '🌸', '🍀'];
    var AVATAR_COLORS = ['#10B981', '#8B5CF6', '#3B82F6', '#F97316', '#EC4899', '#06B6D4', '#EF4444', '#F59E0B', '#14B8A6', '#A855F7', '#6366F1', '#E11D48'];

    function _showAvatarPicker(profile) {
        var body = document.getElementById('chatInfoPanelBody');
        if (!body) return;

        var emojiGrid = AVATAR_EMOJIS.map(function (e) {
            return '<button class="avatar-pick-emoji' + (e === profile.avatarEmoji ? ' active' : '') + '" data-emoji="' + e + '">' + e + '</button>';
        }).join('');

        var colorGrid = AVATAR_COLORS.map(function (c) {
            return '<button class="avatar-pick-color' + (c === profile.avatarColor ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>';
        }).join('');

        body.innerHTML =
            '<div class="avatar-picker">' +
                '<div class="avatar-picker-title">Оберіть аватар</div>' +
                '<div class="avatar-picker-section">Емоджі</div>' +
                '<div class="avatar-picker-grid">' + emojiGrid + '</div>' +
                '<div class="avatar-picker-section">Колір фону</div>' +
                '<div class="avatar-picker-colors">' + colorGrid + '</div>' +
                '<div class="avatar-picker-actions">' +
                    '<button class="avatar-picker-reset" id="avatarReset">Скинути</button>' +
                    '<button class="avatar-picker-save" id="avatarSave">Зберегти</button>' +
                '</div>' +
            '</div>';

        var selectedEmoji = profile.avatarEmoji || null;
        var selectedColor = profile.avatarColor || null;

        body.querySelectorAll('.avatar-pick-emoji').forEach(function (btn) {
            btn.addEventListener('click', function () {
                body.querySelectorAll('.avatar-pick-emoji').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                selectedEmoji = btn.dataset.emoji;
            });
        });

        body.querySelectorAll('.avatar-pick-color').forEach(function (btn) {
            btn.addEventListener('click', function () {
                body.querySelectorAll('.avatar-pick-color').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                selectedColor = btn.dataset.color;
            });
        });

        document.getElementById('avatarReset').addEventListener('click', function () {
            selectedEmoji = null;
            selectedColor = null;
            body.querySelectorAll('.avatar-pick-emoji, .avatar-pick-color').forEach(function (b) { b.classList.remove('active'); });
        });

        document.getElementById('avatarSave').addEventListener('click', async function () {
            try {
                await _api('PATCH', '/users/me/avatar', { avatarEmoji: selectedEmoji, avatarColor: selectedColor });
                _showUserProfile(profile.id);
            } catch (e) {
                console.error('Avatar save error:', e);
            }
        });
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

    // Wallpaper picker
    var _wallpapers = [
        { id: 'none', label: 'Без фону' },
        { id: 'bubbles', label: 'Бульки' },
        { id: 'dots', label: 'Крапки' },
        { id: 'dino', label: 'Діно' },
        { id: 'waves', label: 'Хвилі' },
        { id: 'gradient', label: 'Градієнт' },
        { id: 'stars', label: 'Зірки' },
        { id: 'geometric', label: 'Геометрія' }
    ];
    var _wallpaperBtn = document.getElementById('chatWallpaperBtn');
    var _wallpaperPopup = null;

    function _getWallpaper() {
        try {
            // Per-channel wallpaper
            if (_currentChannel) {
                var perChannel = localStorage.getItem('chatWallpaper_ch_' + _currentChannel.id);
                if (perChannel) return perChannel;
            }
            return localStorage.getItem('chatWallpaper') || 'none';
        } catch (e) { return 'none'; }
    }

    function _setWallpaper(wp) {
        try {
            // Save per-channel
            if (_currentChannel) {
                localStorage.setItem('chatWallpaper_ch_' + _currentChannel.id, wp);
            }
            localStorage.setItem('chatWallpaper', wp);
        } catch (e) {}
        var messages = document.getElementById('chatMessages');
        if (messages) messages.setAttribute('data-wallpaper', wp);
    }

    function _applyWallpaper() {
        var wp = _getWallpaper();
        var messages = document.getElementById('chatMessages');
        if (messages) messages.setAttribute('data-wallpaper', wp);
    }

    function _toggleWallpaperPicker() {
        if (_wallpaperPopup) {
            _wallpaperPopup.remove();
            _wallpaperPopup = null;
            return;
        }
        var current = _getWallpaper();
        _wallpaperPopup = document.createElement('div');
        _wallpaperPopup.className = 'chat-wallpaper-popup';
        _wallpaperPopup.innerHTML =
            '<div class="chat-wallpaper-popup-title">Фон чату</div>' +
            '<div class="chat-wallpaper-picker">' +
                _wallpapers.map(function (wp) {
                    return '<div class="chat-wallpaper-option-wrap">' +
                        '<div class="chat-wallpaper-option' + (wp.id === current ? ' active' : '') + '" data-wp="' + wp.id + '"></div>' +
                        '<div class="chat-wallpaper-label">' + wp.label + '</div>' +
                    '</div>';
                }).join('') +
            '</div>';

        // Position below button
        if (_wallpaperBtn) {
            var rect = _wallpaperBtn.getBoundingClientRect();
            _wallpaperPopup.style.position = 'fixed';
            _wallpaperPopup.style.top = (rect.bottom + 8) + 'px';
            _wallpaperPopup.style.right = (window.innerWidth - rect.right) + 'px';
            _wallpaperPopup.style.zIndex = '200';
        }

        document.body.appendChild(_wallpaperPopup);

        // Click handler on options
        _wallpaperPopup.querySelectorAll('.chat-wallpaper-option').forEach(function (opt) {
            opt.addEventListener('click', function () {
                var wp = opt.dataset.wp;
                _setWallpaper(wp);
                // Update active state
                _wallpaperPopup.querySelectorAll('.chat-wallpaper-option').forEach(function (o) {
                    o.classList.toggle('active', o.dataset.wp === wp);
                });
            });
        });

        // Close on outside click
        setTimeout(function () {
            document.addEventListener('click', function closeWp(e) {
                if (_wallpaperPopup && !_wallpaperPopup.contains(e.target) && e.target !== _wallpaperBtn) {
                    _wallpaperPopup.remove();
                    _wallpaperPopup = null;
                    document.removeEventListener('click', closeWp);
                }
            });
        }, 100);
    }

    if (_wallpaperBtn) {
        _wallpaperBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _toggleWallpaperPicker();
        });
    }

    // Apply saved wallpaper on load
    _applyWallpaper();

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
                case 'thread':
                    _openThreadFromContext();
                    break;
                case 'forward':
                    _forwardFromContext();
                    break;
                case 'bookmark':
                    _bookmarkFromContext();
                    break;
                case 'create-task':
                    _createTaskFromMessage();
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

    // Thread support
    var _threadPanel = document.getElementById('chatThreadPanel');
    var _threadRoot = document.getElementById('chatThreadRoot');
    var _threadMessages = document.getElementById('chatThreadMessages');
    var _threadInput = document.getElementById('chatThreadInput');
    var _threadSendBtn = document.getElementById('chatThreadSendBtn');
    var _threadClose = document.getElementById('chatThreadClose');
    var _currentThreadId = null;

    async function _openThreadFromContext() {
        if (!_contextMsg) return;
        _openThread(_contextMsg.id, _contextMsg.el);
    }

    async function _openThread(messageId, msgEl) {
        if (!_threadPanel) return;
        _currentThreadId = messageId;

        // Show root message
        if (_threadRoot && msgEl) {
            var contentEl = msgEl.querySelector('.chat-bubble-content');
            var userEl = msgEl.querySelector('.chat-bubble-username');
            _threadRoot.innerHTML = '<div class="chat-thread-root-user">' + _esc(userEl ? userEl.textContent : '') + '</div>' +
                '<div class="chat-thread-root-text">' + (contentEl ? contentEl.innerHTML : '') + '</div>';
        }

        // Load thread replies
        try {
            var replies = await _api('GET', '/messages/' + messageId + '/thread');
            if (_threadMessages) {
                _threadMessages.innerHTML = '';
                (replies || []).forEach(function (r) {
                    var div = document.createElement('div');
                    div.className = 'chat-thread-msg' + (String(r.userId) === _currentUserId ? ' own' : '');
                    div.innerHTML = '<span class="chat-thread-msg-user">' + _esc(r.displayName || r.username) + '</span> ' +
                        '<span class="chat-thread-msg-text">' + _formatContent(r.content) + '</span>' +
                        '<span class="chat-thread-msg-time">' + new Date(r.createdAt).toLocaleTimeString('uk-UA', {hour:'2-digit',minute:'2-digit'}) + '</span>';
                    _threadMessages.appendChild(div);
                });
                _threadMessages.scrollTop = _threadMessages.scrollHeight;
            }
        } catch (err) {
            console.error('[Chat] Thread load error:', err);
        }

        _threadPanel.style.display = 'flex';
    }

    if (_threadClose) {
        _threadClose.addEventListener('click', function () {
            if (_threadPanel) _threadPanel.style.display = 'none';
            _currentThreadId = null;
        });
    }

    if (_threadSendBtn && _threadInput) {
        _threadSendBtn.addEventListener('click', _sendThreadReply);
        _threadInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendThreadReply();
            }
        });
    }

    async function _sendThreadReply() {
        if (!_currentThreadId || !_threadInput) return;
        var content = _threadInput.value.trim();
        if (!content) return;

        try {
            var reply = await _api('POST', '/messages/' + _currentThreadId + '/thread', { content: content });
            _threadInput.value = '';

            // Add to thread panel
            if (_threadMessages && reply) {
                var div = document.createElement('div');
                div.className = 'chat-thread-msg own';
                div.innerHTML = '<span class="chat-thread-msg-user">' + _esc(reply.displayName || reply.username) + '</span> ' +
                    '<span class="chat-thread-msg-text">' + _formatContent(reply.content) + '</span>' +
                    '<span class="chat-thread-msg-time">' + new Date(reply.createdAt).toLocaleTimeString('uk-UA', {hour:'2-digit',minute:'2-digit'}) + '</span>';
                _threadMessages.appendChild(div);
                _threadMessages.scrollTop = _threadMessages.scrollHeight;
            }
        } catch (err) {
            console.error('[Chat] Thread reply error:', err);
        }
    }

    // Forward message
    async function _forwardFromContext() {
        if (!_contextMsg) return;
        var overlay = document.getElementById('chatForwardOverlay');
        var list = document.getElementById('chatForwardChannelList');
        var cancelBtn = document.getElementById('chatForwardCancel');
        if (!overlay || !list) return;

        // Load channels
        var channels = await _api('GET', '/channels');
        list.innerHTML = '';
        (channels || []).forEach(function (ch) {
            if (ch.id === (_currentChannel ? _currentChannel.id : -1)) return;
            var item = document.createElement('button');
            item.className = 'chat-forward-item';
            item.textContent = (ch.isDm ? '💬 ' : '# ') + ch.name;
            item.addEventListener('click', async function () {
                var contentEl = _contextMsg.el.querySelector('.chat-bubble-content');
                var usernameEl = _contextMsg.el.querySelector('.chat-bubble-username');
                var fwdContent = '↪ Переслано від ' + (usernameEl ? usernameEl.textContent : '?') + ':\n' +
                    (contentEl ? contentEl.textContent : '');
                try {
                    await _api('POST', '/channels/' + ch.id + '/messages', {
                        content: fwdContent,
                        metadata: { forwarded: { fromChannel: _currentChannel.id, fromMessageId: _contextMsg.id } }
                    });
                    overlay.style.display = 'none';
                } catch (err) {
                    console.error('[Chat] Forward error:', err);
                }
            });
            list.appendChild(item);
        });

        overlay.style.display = 'flex';
        if (cancelBtn) {
            cancelBtn.onclick = function () { overlay.style.display = 'none'; };
        }
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) overlay.style.display = 'none';
        });
    }

    // Bookmark message
    async function _bookmarkFromContext() {
        if (!_contextMsg) return;
        try {
            await _api('POST', '/bookmarks', { messageId: parseInt(_contextMsg.id, 10) });
            // Show brief notification
            var el = _contextMsg.el;
            if (el) {
                var badge = document.createElement('span');
                badge.className = 'chat-bookmark-toast';
                badge.textContent = '⭐ Збережено';
                el.appendChild(badge);
                setTimeout(function () { badge.remove(); }, 2000);
            }
        } catch (err) {
            console.error('[Chat] Bookmark error:', err);
        }
    }

    function _createTaskFromMessage() {
        if (!_contextMsg) return;
        var contentEl = _contextMsg.el.querySelector('.chat-bubble-content');
        var usernameEl = _contextMsg.el.querySelector('.chat-bubble-username');
        var msgText = contentEl ? contentEl.textContent.trim() : '';
        var author = usernameEl ? usernameEl.textContent.trim() : '';

        // Show prompt for task description
        var prompt = window.prompt(
            '📋 Створити задачу з повідомлення\n\nОпишіть задачу (або залиште текст повідомлення):',
            msgText.substring(0, 200)
        );
        if (!prompt) return;

        // Create task via API
        fetch('/api/tasks', {
            method: 'POST',
            headers: _headers(),
            body: JSON.stringify({
                title: prompt.substring(0, 100),
                description: 'З чату від @' + author + ':\n\n' + msgText + '\n\n---\nЗадача: ' + prompt,
                priority: 'medium',
                sourceType: 'chat'
            })
        }).then(function (resp) {
            if (resp.ok) {
                // Show success toast
                var toast = document.createElement('div');
                toast.className = 'chat-toast';
                toast.textContent = '✅ Задачу створено';
                document.body.appendChild(toast);
                setTimeout(function () { toast.remove(); }, 3000);
            }
        }).catch(function () {});
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

    var _searchDebounce = null;
    function _searchMessages(query) {
        // Remove previous highlights
        document.querySelectorAll('.chat-message.search-highlight').forEach(function (el) {
            el.classList.remove('search-highlight');
        });
        if (!query) {
            if (_searchMsgCount) _searchMsgCount.textContent = '';
            // Remove global search results
            var globalResults = document.getElementById('chatSearchResults');
            if (globalResults) globalResults.remove();
            return;
        }

        // Local highlight first
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
        if (_searchMsgCount) _searchMsgCount.textContent = found > 0 ? found + ' зн.' : '...';
        if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Debounced server-side search for cross-channel results
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(function () {
            _globalSearch(query);
        }, 500);
    }

    async function _globalSearch(query) {
        if (query.length < 2) return;
        try {
            var results = await _api('GET', '/search?q=' + encodeURIComponent(query));
            if (!results || results.length === 0) {
                if (_searchMsgCount) _searchMsgCount.textContent = 'не знайдено';
                return;
            }
            if (_searchMsgCount) _searchMsgCount.textContent = results.length + ' зн.';

            // Show results in a dropdown
            var existing = document.getElementById('chatSearchResults');
            if (existing) existing.remove();

            var panel = document.createElement('div');
            panel.id = 'chatSearchResults';
            panel.className = 'chat-search-results';
            results.slice(0, 20).forEach(function (r) {
                var item = document.createElement('div');
                item.className = 'chat-search-result-item';
                item.innerHTML = '<div class="chat-search-result-channel">#' + _esc(r.channelName || '') + '</div>' +
                    '<div class="chat-search-result-user">' + _esc(r.displayName || r.username) + '</div>' +
                    '<div class="chat-search-result-text">' + _esc((r.content || '').slice(0, 100)) + '</div>';
                item.addEventListener('click', function () {
                    // Navigate to that channel
                    var ch = _channels.find(function (c) { return c.id === r.channelId; });
                    if (ch) _selectChannel(ch);
                    panel.remove();
                });
                panel.appendChild(item);
            });
            var bar = document.getElementById('chatSearchBar');
            if (bar) bar.parentNode.insertBefore(panel, bar.nextSibling);
        } catch (err) {
            console.error('[Chat] Global search error:', err);
        }
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
        var hasGuardian = _channelMembers.some(function (u) { return u.username === 'guardian'; });
        _channelMembers.forEach(function (u) {
            var isGuardianUser = u.username === 'guardian';
            var isOpenclawUser = u.username === 'openclaw';
            var initial = isGuardianUser ? '🛡️' : isOpenclawUser ? '🦀' : (u.displayName || u.username || '?').charAt(0).toUpperCase();
            var colorClass = isGuardianUser ? '' : 'chat-avatar-color-' + _colorIdx(u.id || 0);
            var avatarStyle = isGuardianUser ? 'background:linear-gradient(135deg,#6366F1,#8B5CF6);color:white;' : isOpenclawUser ? 'background:linear-gradient(135deg,#10B981,#059669);color:white;' : '';
            var badgeHtml = isGuardianUser ? '<span class="chat-bot-badge guardian-badge" style="margin-left:6px;font-size:8px">GUARD</span>' : isOpenclawUser ? '<span class="chat-bot-badge" style="margin-left:6px;font-size:8px">BOT</span>' : '';
            html += '<div class="chat-info-member" data-user-id="' + u.id + '" style="cursor:pointer">' +
                '<div class="chat-info-member-avatar ' + colorClass + '"' + (avatarStyle ? ' style="' + avatarStyle + '"' : '') + '>' + initial + '</div>' +
                '<div>' +
                    '<div class="chat-info-member-name">' + _esc(u.displayName || u.username) + badgeHtml + '</div>' +
                    '<div class="chat-info-member-role">@' + _esc(u.username) + ' · ' + _esc(_roleLabel(u.role)) + '</div>' +
                '</div>' +
            '</div>';
        });
        // Add Guardian invite button if not in channel
        if (!hasGuardian) {
            html += '<div class="chat-guardian-invite" id="chatGuardianInvite">' +
                '<button class="chat-guardian-invite-btn">' +
                    '<span class="chat-guardian-invite-icon">🛡️</span>' +
                    '<span>Додати Guardian — AI охоронець</span>' +
                '</button>' +
            '</div>';
        }
        body.innerHTML = html;

        // Add member button
        var addBtn = body.querySelector('#chatAddMemberBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function () { _openAddMemberModal(); });
        }

        // Guardian invite button
        var guardianInvite = body.querySelector('#chatGuardianInvite');
        if (guardianInvite) {
            guardianInvite.addEventListener('click', async function () {
                try {
                    await _api('POST', '/channels/' + _currentChannel.id + '/members', { username: 'guardian' });
                    guardianInvite.innerHTML = '<div style="text-align:center;padding:8px;color:#6366F1;font-size:13px;animation:guardianAppear 0.5s ease">🛡️ Guardian додано!</div>';
                    setTimeout(function () { _renderInfoPanel(); }, 1500);
                } catch (err) {
                    console.error('[Chat] Guardian invite error:', err);
                    guardianInvite.innerHTML = '<div style="text-align:center;padding:8px;color:var(--danger);font-size:13px">Не вдалось додати</div>';
                }
            });
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
            _playSoundAlways('connect');
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

    async function _loadChannels() {
        try {
            _channels = await _api('GET', '/channels') || [];
            _renderChannels();
        } catch (err) {
            console.error('[Chat] Load channels error:', err);
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

        // Apply wallpaper
        _applyWallpaper();

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

        // Animate channel switch
        var container = document.getElementById('chatMessages');
        if (container) {
            container.classList.add('switching');
        }

        // Load messages
        try {
            var messages = await _api('GET', '/channels/' + channel.id + '/messages');
            _renderMessages(messages || []);
            // Animate in
            if (container) {
                requestAnimationFrame(function () {
                    container.classList.add('active');
                    setTimeout(function () {
                        container.classList.remove('switching', 'active');
                    }, 250);
                });
            }

            // Mark as read + load read receipts
            if (messages && messages.length > 0) {
                var maxSeq = messages[messages.length - 1].seq;
                _oldestSeq = messages[0].seq;
                _api('PUT', '/channels/' + channel.id + '/read', { seq: maxSeq });

                // Load read receipts and mark own messages
                _loadReadReceipts(channel.id);

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

        // Check if user has active mute in this channel (covers page reload)
        _checkAndShowMuteOverlay();
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
        var isBot = msg.isBot || msg.username === 'openclaw';
        var isGuardian = msg.isBot && msg.username === 'guardian' || msg.username === 'guardian';
        if (isGuardian) isBot = true;
        var emojiOnly = !msg.deletedAt && msg.content && _isOnlyEmoji(msg.content);

        // Feature 3: Time-based gradient class
        var timeClass = '';
        if (isOwn) {
            var h = new Date(msg.createdAt).getHours();
            if (h >= 6 && h < 12) timeClass = ' time-morning';
            else if (h >= 18 && h < 22) timeClass = ' time-evening';
            else if (h >= 22 || h < 6) timeClass = ' time-night';
        }

        // Feature 10: Role-based class
        var roleClass = '';
        if (msg.role === 'admin' || msg.role === 'owner') roleClass = ' role-admin-msg';
        else if (msg.role === 'animator') roleClass = ' role-animator-msg';
        else if (msg.role === 'cashier') roleClass = ' role-cashier-msg';

        var el = document.createElement('div');
        el.className = 'chat-message' + (isOwn ? ' own' : '') + (isGrouped ? ' grouped' : '') + (emojiOnly ? ' emoji-only' : '') + (isBot ? ' bot' : '') + (isGuardian ? ' guardian' : '') + timeClass + roleClass;
        el.dataset.messageId = msg.id;
        el.dataset.seq = msg.seq;
        el.dataset.userId = msg.userId;

        // Feature 17: Emoji avatars (park mascots)
        var EMOJI_AVATARS = ['🦕', '🦖', '🦎', '🐊', '🦴', '🌴', '🌋', '🥚'];
        var userEmojiAvatar = !isBot && !isGuardian ? EMOJI_AVATARS[_colorIdx(msg.userId)] : null;
        var initial = isGuardian ? '🛡️' : isBot ? '🦀' : userEmojiAvatar || (msg.displayName || msg.username || '?').charAt(0).toUpperCase();
        var time = new Date(msg.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        var content = msg.deletedAt ? '<em style="color:var(--gray-400)">Повідомлення видалено</em>' : (isBot ? _formatBotContent(msg.content) : _formatContent(msg.content));
        var editedHtml = msg.editedAt && !msg.deletedAt ? '<span class="chat-bubble-edited">(ред.)</span>' : '';
        var readCheckHtml = '';
        if (isOwn && !msg.deletedAt) {
            readCheckHtml = '<span class="chat-read-check sent" title="Відправлено">✓</span>';
        }

        var avatarColorClass = isGuardian ? 'chat-avatar-guardian' : isBot ? 'chat-avatar-bot' : 'chat-avatar-color-' + _colorIdx(msg.userId);
        var usernameColorClass = isGuardian ? 'chat-username-guardian' : isBot ? 'chat-username-bot' : 'chat-username-color-' + _colorIdx(msg.userId);
        // Feature 17: Add emoji-avatar class for park mascots
        if (userEmojiAvatar) avatarColorClass += ' emoji-avatar';

        var replyHtml = '';
        if (msg.replyTo && msg.replyContent) {
            replyHtml = '<div class="chat-reply-block">' +
                '<div class="chat-reply-block-user">' + _esc(msg.replyUsername || '') + '</div>' +
                '<div class="chat-reply-block-text">' + _esc(_truncate(msg.replyContent, 60)) + '</div>' +
                '</div>';
        }

        var reactionsHtml = _renderReactions(msg);

        // Feature 10: Role badge HTML
        var roleBadgeHtml = '';
        if (!isBot && !isGuardian && msg.role) {
            if (msg.role === 'admin' || msg.role === 'owner') roleBadgeHtml = '<span class="chat-role-badge admin">адмін</span>';
            else if (msg.role === 'animator') roleBadgeHtml = '<span class="chat-role-badge animator">аніматор</span>';
            else if (msg.role === 'cashier') roleBadgeHtml = '<span class="chat-role-badge cashier">касир</span>';
        }

        // Feature 10: Role-based username class
        var roleUsernameClass = '';
        if (!isBot && !isGuardian && msg.role) {
            if (msg.role === 'admin' || msg.role === 'owner') roleUsernameClass = ' role-admin';
            else if (msg.role === 'animator') roleUsernameClass = ' role-animator';
            else if (msg.role === 'cashier') roleUsernameClass = ' role-cashier';
        }

        // Feature 1: Online dot
        var onlineDotHtml = '<span class="chat-online-dot" data-user-id="' + msg.userId + '"></span>';

        el.innerHTML =
            '<div class="chat-avatar ' + avatarColorClass + '">' + initial + onlineDotHtml + '</div>' +
            '<div class="chat-bubble">' +
                '<div class="chat-bubble-header">' +
                    '<span class="chat-bubble-username ' + usernameColorClass + roleUsernameClass + '">' + _esc(msg.displayName || msg.username) + '</span>' +
                    (isGuardian ? '<span class="chat-bot-badge guardian-badge">GUARD</span>' : (isBot ? '<span class="chat-bot-badge">BOT</span>' : roleBadgeHtml)) +
                    editedHtml +
                    '<span class="chat-bubble-time">' + time + readCheckHtml + '</span>' +
                '</div>' +
                replyHtml +
                _renderFileAttachment(msg) +
                '<div class="chat-bubble-content">' + content + '</div>' +
                _renderLinkPreview(msg) +
                (msg.threadReplyCount > 0 ? '<button class="chat-thread-badge" data-thread-id="' + msg.id + '">' + msg.threadReplyCount + ' відп.</button>' : '') +
                reactionsHtml +
                '<div class="chat-msg-actions">' +
                    '<button class="chat-msg-action-btn" data-action="reply" title="Відповісти">↩</button>' +
                    '<button class="chat-msg-action-btn" data-action="react" title="Реакція">😊</button>' +
                    '<button class="chat-msg-action-btn" data-action="translate" title="Перекласти">🌐</button>' +
                '</div>' +
            '</div>' +
            '<span class="chat-swipe-reply-icon">↩</span>';

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

        var translateBtn = el.querySelector('[data-action="translate"]');
        if (translateBtn) {
            translateBtn.addEventListener('click', function () {
                _translateMessage(msg, el);
            });
        }

        // Reaction chip clicks
        el.querySelectorAll('.chat-reaction-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                _toggleReaction(msg.id, chip.dataset.emoji);
            });
        });

        // Thread badge click
        var threadBadge = el.querySelector('.chat-thread-badge');
        if (threadBadge) {
            threadBadge.addEventListener('click', function () {
                _openThread(msg.id, el);
            });
        }

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
            var count = groups[emoji].length;
            var isOwn = groups[emoji].some(function (r) { return String(r.userId) === _currentUserId; });
            var names = groups[emoji].map(function (r) { return r.username || ''; }).join(', ');
            // Feature 19: Combo classes
            var comboClass = count >= 5 ? ' combo-5' : count >= 3 ? ' combo-3' : '';
            var hotBadge = count >= 5 ? '<span class="chat-reaction-hot-badge">HOT</span>' : '';
            html += '<button class="chat-reaction-chip' + (isOwn ? ' own' : '') + comboClass + '" data-emoji="' + emoji + '" title="' + _esc(names) + '">' +
                emoji + ' <span class="chat-reaction-count">' + count + '</span>' + hotBadge + '</button>';
        }
        html += '</div>';
        return html;
    }

    function _isOnlyEmoji(text) {
        // Check if text contains only emoji (1-3) with optional whitespace
        var emojiRegex = /^[\s]*(?:[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{27BF}]|[\u{2300}-\u{23FF}]|[\u{2702}-\u{27B0}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{200D}]|[\u{20E3}]|[\u{FE0F}]|[\u{E0020}-\u{E007F}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F171}]|[\u{1F17E}-\u{1F17F}]|[\u{1F18E}]|[\u{1F191}-\u{1F19A}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F201}-\u{1F202}]|[\u{1F21A}]|[\u{1F22F}]|[\u{1F232}-\u{1F23A}]|[\u{1F250}-\u{1F251}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]|[\u{00A9}]|[\u{00AE}]|[\u{203C}]|[\u{2049}]|[\u{2122}]|[\u{2139}]|[\u{2194}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{1F385}]|[\u{1FAF0}-\u{1FAF8}])+[\s]*$/u;
        var trimmed = text.trim();
        if (trimmed.length > 12) return false;
        try { return emojiRegex.test(trimmed); } catch (e) { return false; }
    }

    function _formatContent(text) {
        var safe = _esc(text);

        // --- Markdown formatting ---
        // Code blocks (```) — must be before inline code
        safe = safe.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
            return '<pre class="chat-codeblock" data-lang="' + (lang || '') + '"><code>' + code.replace(/\n$/, '') + '</code></pre>';
        });
        // Inline code (`)
        safe = safe.replace(/`([^`\n]+)`/g, '<code class="chat-inline-code">$1</code>');
        // Bold (**text**)
        safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic (*text*)
        safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Strikethrough (~~text~~)
        safe = safe.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // Blockquote (> text) — at line start
        safe = safe.replace(/(?:^|(?<=\n))&gt; ?(.+)/g, '<blockquote class="chat-blockquote">$1</blockquote>');

        // Format @mentions
        safe = safe.replace(/\B@(\w+)/g, '<span class="chat-mention">@$1</span>');
        // Format URLs
        safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary-dark);text-decoration:underline">$1</a>');
        // Newlines to <br> (outside of pre blocks)
        safe = safe.replace(/\n/g, '<br>');
        // Wrap emojis with animated span for hover wobble
        safe = safe.replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2702}-\u{27B0}\u{2764}\u{2728}\u{2705}\u{274C}\u{2B50}][\u{FE0F}\u{200D}]?)/gu, '<span class="chat-animated-emoji">$1</span>');
        return safe;
    }

    /** Render file/image attachment from metadata */
    function _renderFileAttachment(msg) {
        // GIF content type
        if (msg.contentType === 'gif' && msg.content && msg.content.startsWith('http')) {
            return '<div class="chat-gif-message"><img src="' + _esc(msg.content) + '" alt="GIF" class="chat-attached-gif" loading="lazy"></div>';
        }
        // Sticker content type
        if (msg.contentType === 'sticker') {
            if (msg.content && msg.content.startsWith('http')) {
                return '<div class="chat-sticker-message"><img src="' + _esc(msg.content) + '" alt="sticker" class="chat-sticker-img"></div>';
            }
            return '<div class="chat-sticker-message"><span class="chat-sticker-emoji">' + _esc(msg.content) + '</span></div>';
        }
        var meta = msg.metadata;
        if (!meta || !meta.file) return '';
        var f = meta.file;
        if (f.type === 'image') {
            return '<div class="chat-file-attachment chat-image-attachment">' +
                '<img src="' + _esc(f.url) + '" alt="' + _esc(f.name) + '" class="chat-attached-image" loading="lazy" onclick="window.open(this.src,\'_blank\')">' +
            '</div>';
        }
        // Audio/voice message
        if (/\.(webm|ogg|mp3|wav)$/i.test(f.name)) {
            return '<div class="chat-voice-player">' +
                '<audio controls preload="metadata" class="chat-audio-element"><source src="' + _esc(f.url) + '" type="' + _esc(f.mimeType || 'audio/webm') + '"></audio>' +
            '</div>';
        }
        // File attachment
        var icon = '📄';
        if (/\.pdf$/i.test(f.name)) icon = '📕';
        else if (/\.(doc|docx)$/i.test(f.name)) icon = '📝';
        else if (/\.(xls|xlsx)$/i.test(f.name)) icon = '📊';
        else if (/\.(zip|rar|7z)$/i.test(f.name)) icon = '🗜️';
        else if (/\.(mp3|wav|ogg)$/i.test(f.name)) icon = '🎵';
        else if (/\.(mp4|webm)$/i.test(f.name)) icon = '🎬';

        var sizeStr = f.size ? ' (' + (f.size < 1024*1024 ? (f.size/1024).toFixed(1)+' КБ' : (f.size/(1024*1024)).toFixed(1)+' МБ') + ')' : '';
        return '<a class="chat-file-attachment" href="' + _esc(f.url) + '" target="_blank" rel="noopener" download>' +
            '<span class="chat-file-icon">' + icon + '</span>' +
            '<div class="chat-file-info">' +
                '<div class="chat-file-name">' + _esc(f.name) + '</div>' +
                '<div class="chat-file-size">' + sizeStr + '</div>' +
            '</div>' +
        '</a>';
    }

    /** Render link preview card from metadata */
    function _renderLinkPreview(msg) {
        var meta = msg.metadata;
        if (!meta || !meta.linkPreview) return '';
        var lp = meta.linkPreview;
        if (!lp.title && !lp.description) return '';

        var imageHtml = lp.image ? '<img class="chat-link-preview-img" src="' + _esc(lp.image) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '';
        return '<a class="chat-link-preview" href="' + _esc(lp.url) + '" target="_blank" rel="noopener">' +
            imageHtml +
            '<div class="chat-link-preview-text">' +
                '<div class="chat-link-preview-site">' + _esc(lp.siteName || '') + '</div>' +
                '<div class="chat-link-preview-title">' + _esc(lp.title || '') + '</div>' +
                (lp.description ? '<div class="chat-link-preview-desc">' + _esc(lp.description) + '</div>' : '') +
            '</div>' +
        '</a>';
    }

    /** Format bot messages — allow safe HTML tags (<b>, <i>, <br>, <li>, <ul>) */
    function _formatBotContent(text) {
        if (!text) return '';
        // First escape everything
        var safe = _esc(text);
        // Then restore safe HTML tags that bots use
        safe = safe.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
        safe = safe.replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>');
        safe = safe.replace(/&lt;br\s*\/?&gt;/g, '<br>');
        safe = safe.replace(/&lt;li&gt;/g, '<li>').replace(/&lt;\/li&gt;/g, '</li>');
        safe = safe.replace(/&lt;ul&gt;/g, '<ul>').replace(/&lt;\/ul&gt;/g, '</ul>');
        safe = safe.replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');
        // Format @mentions
        safe = safe.replace(/\B@(\w+)/g, '<span class="chat-mention">@$1</span>');
        // Format URLs
        safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary-dark);text-decoration:underline">$1</a>');
        // Newlines to <br>
        safe = safe.replace(/\n/g, '<br>');
        // Wrap emojis
        safe = safe.replace(/([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2702}-\u{27B0}\u{2764}\u{2728}\u{2705}\u{274C}\u{2B50}][\u{FE0F}\u{200D}]?)/gu, '<span class="chat-animated-emoji">$1</span>');
        return safe;
    }

    // ==========================================
    // SEND MESSAGE
    // ==========================================

    async function _sendMessage() {
        // If there's a pending file, upload it instead
        if (_pendingFile) {
            await _uploadFile();
            return;
        }

        var input = document.getElementById('chatInput');
        if (!input) return;
        var content = input.value.trim();
        if (!content || !_currentChannel) return;

        // Close emoji panel on send
        if (_emojiPanelOpen) _toggleEmojiPanel();

        // Handle easter egg commands (before other processing)
        var contentLower = content.toLowerCase();
        if (_easterEggCommands && _easterEggCommands[contentLower]) {
            var cmd = _easterEggCommands[contentLower];
            input.value = '';
            if (typeof _autoGrow === 'function') _autoGrow(input);
            cmd();
            return;
        }

        // Handle /guardian command — invite guardian to channel
        if (content === '/guardian' || content === '/охоронець') {
            input.value = '';
            _autoGrow(input);
            try {
                await _api('POST', '/channels/' + _currentChannel.id + '/members', { username: 'guardian' });
                _appendSystemMessage('🛡️ Guardian додано до каналу! Тепер AI-охоронець слідкує за порядком.');
            } catch (err) {
                _appendSystemMessage('🛡️ Guardian вже є в цьому каналі або не вдалось додати.');
            }
            return;
        }

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

        // Animate send button
        var sendBtn = document.querySelector('.chat-send-btn');
        if (sendBtn) {
            sendBtn.classList.add('sending');
            setTimeout(function () { sendBtn.classList.remove('sending'); }, 300);
        }

        try {
            var msg = await _api('POST', '/channels/' + _currentChannel.id + '/messages', msgData);
            if (msg) {
                _appendMessage(msg);
                _playSoundAlways('message-sent');
            }
        } catch (err) {
            console.error('[Chat] Send error:', err);
            _playSoundAlways('error');
            // If blocked by Guardian (muted) — show mute overlay with appeal
            var errMsg = err.message || '';
            if (errMsg.includes('🛡️') || errMsg.includes('заблоковані') || errMsg.includes('Нецензурна')) {
                _checkAndShowMuteOverlay();
            } else {
                input.value = content;
                _autoGrow(input);
            }
        }
    }

    function _appendSystemMessage(text) {
        var container = document.getElementById('chatMessages');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'chat-system-message guardian-system-msg';
        el.innerHTML = '<div class="chat-system-text">' + text + '</div>';
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
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
                _playSoundAlways('message-sent');
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

    // ==========================================
    // TRANSLATE
    // ==========================================
    async function _translateMessage(msg, el) {
        if (!msg.content) return;
        var contentEl = el.querySelector('.chat-bubble-content');
        if (!contentEl) return;

        // Check if already has translation
        var existing = el.querySelector('.chat-translation');
        if (existing) {
            existing.remove();
            return;
        }

        // Detect language: if mostly Cyrillic → translate to English, otherwise to Ukrainian
        var cyrillicCount = (msg.content.match(/[а-яіїєґ]/gi) || []).length;
        var targetLang = cyrillicCount > msg.content.length * 0.3 ? 'en' : 'uk';

        var loadingEl = document.createElement('div');
        loadingEl.className = 'chat-translation loading';
        loadingEl.textContent = 'Перекладаю...';
        contentEl.after(loadingEl);

        try {
            var result = await _api('POST', '/translate', { text: msg.content, targetLang: targetLang });
            loadingEl.classList.remove('loading');
            loadingEl.innerHTML = '<span class="chat-translation-label">🌐 ' + (targetLang === 'en' ? 'EN' : 'UK') + ':</span> ' + _esc(result.translated || msg.content);
        } catch (err) {
            loadingEl.remove();
            console.error('[Chat] Translate error:', err);
        }
    }

    // ==========================================
    // STICKERS
    // ==========================================
    var _stickerBtn = document.getElementById('chatStickerBtn');
    var _stickerPanel = null;
    var _stickerPanelOpen = false;

    if (_stickerBtn) {
        _stickerBtn.addEventListener('click', _toggleStickerPanel);
    }

    function _toggleStickerPanel() {
        _stickerPanelOpen = !_stickerPanelOpen;
        if (!_stickerPanel) {
            _stickerPanel = document.createElement('div');
            _stickerPanel.className = 'chat-sticker-panel';
            var inputArea = document.querySelector('.chat-input-area');
            if (inputArea) inputArea.appendChild(_stickerPanel);
            _loadStickers();
        }
        _stickerPanel.style.display = _stickerPanelOpen ? 'flex' : 'none';
    }

    async function _loadStickers() {
        if (!_stickerPanel) return;
        try {
            var packs = await _api('GET', '/stickers');
            _stickerPanel.innerHTML = '';

            (packs || []).forEach(function (pack) {
                var packDiv = document.createElement('div');
                packDiv.className = 'chat-sticker-pack';
                packDiv.innerHTML = '<div class="chat-sticker-pack-name">' + _esc(pack.name) + '</div>';

                var grid = document.createElement('div');
                grid.className = 'chat-sticker-grid';

                (pack.stickers || []).forEach(function (s) {
                    var btn = document.createElement('button');
                    btn.className = 'chat-sticker-item';
                    if (s.url) {
                        btn.innerHTML = '<img src="' + _esc(s.url) + '" alt="' + _esc(s.altText || s.emoji) + '">';
                    } else {
                        btn.textContent = s.emoji;
                    }
                    btn.title = s.altText || s.emoji;
                    btn.addEventListener('click', function () {
                        _sendSticker(s);
                    });
                    grid.appendChild(btn);
                });

                packDiv.appendChild(grid);
                _stickerPanel.appendChild(packDiv);
            });
        } catch (err) {
            console.error('[Chat] Stickers error:', err);
        }
    }

    async function _sendSticker(sticker) {
        if (!_currentChannel) return;
        _stickerPanelOpen = false;
        if (_stickerPanel) _stickerPanel.style.display = 'none';

        var content = sticker.url ? sticker.url : sticker.emoji;
        try {
            await _api('POST', '/channels/' + _currentChannel.id + '/messages', {
                content: content,
                contentType: 'sticker'
            });
        } catch (err) {
            console.error('[Chat] Send sticker error:', err);
        }
    }

    // ==========================================
    // GIF SEARCH
    // ==========================================
    var _gifBtn = document.getElementById('chatGifBtn');
    var _gifPanel = null;
    var _gifPanelOpen = false;

    if (_gifBtn) {
        _gifBtn.addEventListener('click', _toggleGifPanel);
    }

    function _toggleGifPanel() {
        _gifPanelOpen = !_gifPanelOpen;
        if (!_gifPanel) {
            _gifPanel = document.createElement('div');
            _gifPanel.className = 'chat-gif-panel';
            _gifPanel.innerHTML = '<div class="chat-gif-search-row">' +
                '<input class="chat-gif-search" placeholder="Шукати GIF..." type="text">' +
                '</div>' +
                '<div class="chat-gif-grid" id="chatGifGrid"></div>';
            var inputArea = document.querySelector('.chat-input-area');
            if (inputArea) inputArea.appendChild(_gifPanel);

            var searchInput = _gifPanel.querySelector('.chat-gif-search');
            var debounce;
            searchInput.addEventListener('input', function () {
                clearTimeout(debounce);
                var q = this.value.trim();
                debounce = setTimeout(function () {
                    _searchGifs(q || 'funny');
                }, 400);
            });

            // Load trending
            _searchGifs('trending');
        }
        _gifPanel.style.display = _gifPanelOpen ? 'flex' : 'none';
    }

    async function _searchGifs(query) {
        var grid = document.getElementById('chatGifGrid');
        if (!grid) return;

        try {
            var results = await _api('GET', '/gifs?q=' + encodeURIComponent(query));
            grid.innerHTML = '';
            (results || []).forEach(function (gif) {
                var img = document.createElement('img');
                img.className = 'chat-gif-item';
                img.src = gif.preview;
                img.alt = gif.title || 'GIF';
                img.loading = 'lazy';
                img.addEventListener('click', function () {
                    _sendGif(gif.url);
                });
                grid.appendChild(img);
            });
            if (!results || results.length === 0) {
                grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400)">Нічого не знайдено</div>';
            }
        } catch (err) {
            console.error('[Chat] GIF search error:', err);
            grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400)">GIF API не налаштовано</div>';
        }
    }

    async function _sendGif(gifUrl) {
        if (!_currentChannel) return;
        _gifPanelOpen = false;
        if (_gifPanel) _gifPanel.style.display = 'none';

        try {
            await _api('POST', '/channels/' + _currentChannel.id + '/messages', {
                content: gifUrl,
                contentType: 'gif'
            });
        } catch (err) {
            console.error('[Chat] Send GIF error:', err);
        }
    }

    // ==========================================
    // VOICE MESSAGES
    // ==========================================
    var _voiceBtn = document.getElementById('chatVoiceBtn');
    var _voiceRecording = document.getElementById('chatVoiceRecording');
    var _voiceTimer = document.getElementById('chatVoiceTimer');
    var _voiceCancel = document.getElementById('chatVoiceCancel');
    var _voiceSend = document.getElementById('chatVoiceSend');
    var _mediaRecorder = null;
    var _audioChunks = [];
    var _voiceInterval = null;
    var _voiceStart = 0;

    if (_voiceBtn) {
        _voiceBtn.addEventListener('click', _startVoiceRecording);
    }
    if (_voiceCancel) {
        _voiceCancel.addEventListener('click', _cancelVoiceRecording);
    }
    if (_voiceSend) {
        _voiceSend.addEventListener('click', _sendVoiceMessage);
    }

    async function _startVoiceRecording() {
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            _audioChunks = [];

            _mediaRecorder.ondataavailable = function (e) {
                if (e.data.size > 0) _audioChunks.push(e.data);
            };

            _mediaRecorder.start();
            _voiceStart = Date.now();

            // Show recording UI
            if (_voiceRecording) _voiceRecording.style.display = 'flex';
            if (_voiceBtn) _voiceBtn.style.display = 'none';
            if (_sendBtn) _sendBtn.style.display = 'none';

            _voiceInterval = setInterval(function () {
                var secs = Math.floor((Date.now() - _voiceStart) / 1000);
                if (_voiceTimer) _voiceTimer.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
            }, 1000);
        } catch (err) {
            console.error('[Chat] Mic access error:', err);
            alert('Немає доступу до мікрофону');
        }
    }

    function _cancelVoiceRecording() {
        if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            _mediaRecorder.stop();
            _mediaRecorder.stream.getTracks().forEach(function (t) { t.stop(); });
        }
        _mediaRecorder = null;
        _audioChunks = [];
        clearInterval(_voiceInterval);
        if (_voiceRecording) _voiceRecording.style.display = 'none';
        if (_voiceBtn) _voiceBtn.style.display = '';
        if (_sendBtn) _sendBtn.style.display = '';
    }

    function _sendVoiceMessage() {
        if (!_mediaRecorder || !_currentChannel) return;

        _mediaRecorder.onstop = async function () {
            _mediaRecorder.stream.getTracks().forEach(function (t) { t.stop(); });
            clearInterval(_voiceInterval);
            if (_voiceRecording) _voiceRecording.style.display = 'none';
            if (_voiceBtn) _voiceBtn.style.display = '';
            if (_sendBtn) _sendBtn.style.display = '';

            var blob = new Blob(_audioChunks, { type: 'audio/webm' });
            var duration = Math.floor((Date.now() - _voiceStart) / 1000);
            var file = new File([blob], 'voice-' + Date.now() + '.webm', { type: 'audio/webm' });

            var formData = new FormData();
            formData.append('file', file);
            formData.append('caption', '🎙 Голосове (' + duration + 'с)');

            try {
                var token = localStorage.getItem('token');
                await fetch('/api/chat/channels/' + _currentChannel.id + '/upload', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token },
                    body: formData
                });
            } catch (err) {
                console.error('[Chat] Voice upload error:', err);
            }

            _audioChunks = [];
            _mediaRecorder = null;
        };

        _mediaRecorder.stop();
    }

    // ==========================================
    // SLASH COMMAND TEMPLATES
    // ==========================================
    var _templates = [];
    var _slashPopup = null;

    async function _loadTemplates() {
        try {
            _templates = await _api('GET', '/templates') || [];
        } catch (e) { _templates = []; }
    }
    _loadTemplates();

    function _handleSlashCommand(input) {
        var val = input.value;
        if (!val.startsWith('/') || val.includes(' ')) {
            _closeSlashPopup();
            return;
        }
        var query = val.slice(1).toLowerCase();
        var matches = _templates.filter(function (t) {
            return t.shortcut.toLowerCase().startsWith(query);
        });

        // Also add built-in commands
        var builtins = [
            { shortcut: 'шаблон', content: '⚙️ Створити новий шаблон', builtin: 'create' }
        ];
        if ('шаблон'.startsWith(query) || 'shablon'.startsWith(query)) {
            matches = matches.concat(builtins);
        }

        if (matches.length === 0) {
            _closeSlashPopup();
            return;
        }

        if (!_slashPopup) {
            _slashPopup = document.createElement('div');
            _slashPopup.className = 'chat-slash-popup';
            var inputArea = document.querySelector('.chat-input-area');
            if (inputArea) inputArea.appendChild(_slashPopup);
        }

        _slashPopup.innerHTML = '<div class="chat-slash-header">Шаблони</div>';
        _slashPopup.style.display = 'block';

        matches.slice(0, 8).forEach(function (t) {
            var item = document.createElement('div');
            item.className = 'chat-slash-item';
            item.innerHTML = '<span class="chat-slash-cmd">/' + _esc(t.shortcut) + '</span>' +
                '<span class="chat-slash-preview">' + _esc((t.content || '').slice(0, 50)) + '</span>';
            item.addEventListener('click', function () {
                if (t.builtin === 'create') {
                    _showCreateTemplate();
                } else {
                    input.value = t.content;
                    if (typeof _autoGrow === 'function') _autoGrow(input);
                }
                _closeSlashPopup();
            });
            _slashPopup.appendChild(item);
        });
    }

    function _closeSlashPopup() {
        if (_slashPopup) _slashPopup.style.display = 'none';
    }

    function _showCreateTemplate() {
        var shortcut = prompt('Шорткат (наприклад: ціна)');
        if (!shortcut) return;
        var content = prompt('Текст шаблону');
        if (!content) return;
        _api('POST', '/templates', { shortcut: shortcut, content: content }).then(function () {
            _loadTemplates();
        });
    }

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
            case 'chat:link-preview':
                _onLinkPreview(payload);
                break;
            case 'chat:thread-reply':
                _onThreadReply(payload);
                break;
            case 'chat:mention':
                _playSoundAlways('mention');
                break;
            case 'chat:channel-invite':
                _playSoundAlways('mention');
                _loadChannels();
                break;
            case 'chat:message-edited':
                _onMessageEdited(payload);
                break;
            case 'chat:user-muted':
                _onUserMuted(payload);
                break;
            case 'guardian:mood':
                _onGuardianMood(payload);
                break;
            case 'guardian:event':
                _onGuardianEvent(payload);
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
        var hasGuardianTyping = names.includes('guardian');
        var hasOpenclawTyping = names.includes('openclaw');

        // Feature 8: Build avatar + name pairs
        var EMOJI_AVATARS = ['🦕', '🦖', '🦎', '🐊', '🦴', '🌴', '🌋', '🥚'];
        var avatarHtml = '';
        var displayNames = names.map(function (n) {
            if (n === 'guardian') return '🛡️ Guardian';
            if (n === 'openclaw') return '🦀 OpenClaw';
            // Find user to get avatar
            var user = _chatUsers.find(function (u) { return u.username === n; });
            if (user) {
                var colorClass = 'chat-avatar-color-' + _colorIdx(user.id || 0);
                var emoji = EMOJI_AVATARS[_colorIdx(user.id || 0)];
                avatarHtml += '<span class="chat-typing-mini-avatar ' + colorClass + '">' + emoji + '</span>';
            }
            return n;
        });
        var text = displayNames.length === 1
            ? displayNames[0] + ' пише'
            : displayNames.slice(0, 2).join(', ') + ' пишуть';
        var extraClass = hasGuardianTyping ? ' guardian-typing' : hasOpenclawTyping ? ' bot-typing' : '';

        // Feature 4: Wave animation instead of dots
        var waveHtml = '<span class="chat-typing-wave"><span></span><span></span><span></span><span></span><span></span></span>';
        el.innerHTML = '<span class="chat-typing-text' + extraClass + '"><span class="chat-typing-avatar">' + avatarHtml + '</span> ' + text + ' ' + waveHtml + '</span>';
    }

    function _onReadReceipt(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var readSeq = payload.seq;
        if (!readSeq) return;

        // Update cached receipts
        if (!_readReceipts) _readReceipts = {};
        _readReceipts[payload.userId] = readSeq;

        // Mark own messages with seq <= readSeq as read
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

        // Update read count badges in channels
        _updateReadCountBadges();
    }

    function _onThreadReply(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        // Update thread badge on root message
        var rootEl = document.querySelector('[data-message-id="' + payload.rootMessageId + '"]');
        if (rootEl) {
            var badge = rootEl.querySelector('.chat-thread-badge');
            if (badge) {
                var count = parseInt(badge.textContent) + 1;
                badge.textContent = count + ' відп.';
            } else {
                var reactionsEl = rootEl.querySelector('.chat-reactions');
                var insertPoint = reactionsEl || rootEl.querySelector('.chat-msg-actions');
                if (insertPoint) {
                    insertPoint.insertAdjacentHTML('beforebegin',
                        '<button class="chat-thread-badge" data-thread-id="' + payload.rootMessageId + '">1 відп.</button>');
                }
            }
        }
        // If thread panel is open for this thread, add reply
        if (_currentThreadId === payload.rootMessageId && _threadMessages && payload.message) {
            var r = payload.message;
            var div = document.createElement('div');
            div.className = 'chat-thread-msg' + (String(r.userId) === _currentUserId ? ' own' : '');
            div.innerHTML = '<span class="chat-thread-msg-user">' + _esc(r.displayName || r.username) + '</span> ' +
                '<span class="chat-thread-msg-text">' + _formatContent(r.content) + '</span>' +
                '<span class="chat-thread-msg-time">' + new Date(r.createdAt).toLocaleTimeString('uk-UA', {hour:'2-digit',minute:'2-digit'}) + '</span>';
            _threadMessages.appendChild(div);
            _threadMessages.scrollTop = _threadMessages.scrollHeight;
        }
    }

    function _onLinkPreview(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.messageId + '"]');
        if (!msgEl) return;
        var contentEl = msgEl.querySelector('.chat-bubble-content');
        if (!contentEl) return;
        // Insert preview after content
        var existing = msgEl.querySelector('.chat-link-preview');
        if (existing) return; // already rendered
        var fakeMsg = { metadata: { linkPreview: payload.linkPreview } };
        var html = _renderLinkPreview(fakeMsg);
        if (html) contentEl.insertAdjacentHTML('afterend', html);
    }

    var _readReceipts = {};
    var _channelMemberCount = 0;

    /** Load read receipts for a channel and update checkmarks */
    async function _loadReadReceipts(channelId) {
        try {
            var receipts = await _api('GET', '/channels/' + channelId + '/read-receipts');
            if (!receipts || !Array.isArray(receipts)) return;

            _readReceipts = {};
            var currentUserId = _currentUserId;
            var otherReadSeqs = [];

            receipts.forEach(function (r) {
                _readReceipts[r.userId] = r.lastReadSeq;
                if (r.userId !== currentUserId) {
                    otherReadSeqs.push(r.lastReadSeq);
                }
            });

            _channelMemberCount = receipts.length;

            if (otherReadSeqs.length === 0) return;

            // For DMs: any other user read = double check
            // For channels: show read count
            var maxOtherRead = Math.max.apply(null, otherReadSeqs);
            var isDm = _currentChannel && _currentChannel.isDm;

            document.querySelectorAll('.chat-message.own').forEach(function (el) {
                var msgSeq = parseInt(el.dataset.seq, 10);
                var check = el.querySelector('.chat-read-check');
                if (!check) return;

                if (isDm) {
                    // DM: simple double checkmark
                    if (msgSeq <= maxOtherRead) {
                        check.classList.remove('sent');
                        check.classList.add('read');
                        check.textContent = '✓✓';
                        check.title = 'Прочитано';
                    }
                } else {
                    // Channel: count how many read this message
                    var readBy = otherReadSeqs.filter(function (s) { return s >= msgSeq; }).length;
                    if (readBy > 0) {
                        check.classList.remove('sent');
                        check.classList.add('read');
                        check.textContent = '✓✓';
                        check.title = 'Прочитано: ' + readBy + '/' + otherReadSeqs.length;
                    }
                }
            });
        } catch (err) {
            console.error('[Chat] Load read receipts error:', err);
        }
    }

    function _updateReadCountBadges() {
        // Refresh read status for visible own messages
        if (_currentChannel) {
            _loadReadReceipts(_currentChannel.id);
        }
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

        // Special emoji animation on reaction (visible to all users)
        if (payload.emoji) {
            _triggerEmojiEffect(msgEl, payload.emoji);
            _playSoundAlways('message-sent');
        }
    }

    // ==========================================
    // SPECIAL EMOJI ANIMATIONS
    // ==========================================

    var EMOJI_EFFECTS = {
        '🔥': { type: 'fire', particles: ['🔥', '🟠', '🟡', '✨'], count: 10, layers: true },
        '❤️': { type: 'hearts', particles: ['❤️', '💕', '💗', '💖', '💘'], count: 8, layers: true },
        '😂': { type: 'laugh', particles: ['😂', '🤣', '😆', '💀'], count: 5 },
        '👍': { type: 'thumbs', particles: ['👍', '✨', '⭐'], count: 4 },
        '🎉': { type: 'party', particles: ['🎉', '🎊', '✨', '🎈', '🥳', '🎀'], count: 10, layers: true },
        '💯': { type: 'hundred', particles: ['💯', '🔥', '✨', '⚡'], count: 6 },
        '⚡': { type: 'lightning', particles: ['⚡', '💥', '✨', '🔮'], count: 7, layers: true },
        '👀': { type: 'eyes', particles: ['👀', '👁️', '🔍'], count: 4 },
        '💀': { type: 'skull', particles: ['💀', '☠️', '👻', '🖤'], count: 8, layers: true },
        '❄️': { type: 'snow', particles: ['❄️', '🌨️', '⛄', '✨', '💎'], count: 10, layers: true },
        '🌪️': { type: 'tornado', particles: ['🌪️', '💨', '🍃', '🌀'], count: 8, layers: true },
        '💥': { type: 'explosion', particles: ['💥', '🔥', '💫', '✨', '🟠'], count: 12, layers: true },
        '🌈': { type: 'rainbow', particles: ['🌈', '✨', '⭐', '🦄', '💫'], count: 8, layers: true },
        '💎': { type: 'diamond', particles: ['💎', '✨', '🔹', '🔷', '💠'], count: 8, layers: true }
    };

    function _spawnParticle(container, effect, idx, extraClass) {
        var particle = document.createElement('span');
        particle.className = 'emoji-particle emoji-effect-' + effect.type + (extraClass ? ' ' + extraClass : '');
        particle.textContent = effect.particles[idx % effect.particles.length];
        particle.style.left = (Math.random() * 100) + '%';
        particle.style.animationDelay = (Math.random() * 0.3) + 's';

        var dx, dy;
        switch (effect.type) {
            case 'fire':
                dx = ((Math.random() - 0.5) * 70) + 'px';
                dy = (-50 - Math.random() * 90) + 'px';
                break;
            case 'hearts':
                dx = ((Math.random() - 0.5) * 90) + 'px';
                dy = (-70 - Math.random() * 70) + 'px';
                break;
            case 'snow':
                dx = ((Math.random() - 0.5) * 120) + 'px';
                dy = (20 + Math.random() * 60) + 'px';
                break;
            case 'tornado':
                dx = ((Math.random() - 0.5) * 60) + 'px';
                dy = (-40 - Math.random() * 80) + 'px';
                break;
            case 'explosion':
                var angle = Math.random() * Math.PI * 2;
                var dist = 60 + Math.random() * 80;
                dx = (Math.cos(angle) * dist) + 'px';
                dy = (Math.sin(angle) * dist) + 'px';
                break;
            case 'skull':
                dx = ((Math.random() - 0.5) * 80) + 'px';
                dy = (-30 - Math.random() * 70) + 'px';
                break;
            case 'rainbow':
                dx = ((Math.random() - 0.5) * 120) + 'px';
                dy = (-50 - Math.random() * 60) + 'px';
                break;
            case 'diamond':
                dx = ((Math.random() - 0.5) * 100) + 'px';
                dy = (-40 - Math.random() * 70) + 'px';
                break;
            default:
                dx = ((Math.random() - 0.5) * 100) + 'px';
                dy = (-30 - Math.random() * 60) + 'px';
        }
        particle.style.setProperty('--dx', dx);
        particle.style.setProperty('--dy', dy);
        container.appendChild(particle);
    }

    function _spawnSubLayers(container, effect) {
        switch (effect.type) {
            case 'fire':
                // Ember sparks
                for (var e = 0; e < 6; e++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'fire', particles: ['🟡', '🟠', '✨'] }, i, 'ember-layer');
                        }, i * 80 + 100);
                    })(e);
                }
                // Heat shimmer
                setTimeout(function() {
                    _spawnParticle(container, { type: 'fire', particles: ['🔥'] }, 0, 'heat-shimmer');
                }, 50);
                // Smoke
                for (var s = 0; s < 3; s++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'fire', particles: ['🌫️', '💨'] }, i, 'smoke-layer');
                        }, i * 120 + 300);
                    })(s);
                }
                break;
            case 'hearts':
                for (var h = 0; h < 4; h++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'hearts', particles: ['💗', '💕', '✨'] }, i, 'heart-trail');
                        }, i * 100 + 150);
                    })(h);
                }
                break;
            case 'party':
                // Confetti pieces
                var confetti = ['🟥', '🟦', '🟩', '🟨', '🟪', '🟧'];
                for (var c = 0; c < 8; c++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'party', particles: confetti }, i, 'confetti-piece');
                        }, i * 40 + 80);
                    })(c);
                }
                break;
            case 'lightning':
                // Flash overlay
                setTimeout(function() {
                    var flash = document.createElement('div');
                    flash.className = 'emoji-particle emoji-effect-lightning lightning-flash';
                    container.appendChild(flash);
                }, 0);
                // Afterglow sparks
                for (var l = 0; l < 4; l++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'lightning', particles: ['✨', '🔮', '💫'] }, i, 'afterglow');
                        }, i * 60 + 200);
                    })(l);
                }
                break;
            case 'skull':
                // Soul wisps
                for (var w = 0; w < 5; w++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'skull', particles: ['👻', '🖤', '💜'] }, i, 'soul-wisp');
                        }, i * 90 + 120);
                    })(w);
                }
                break;
            case 'snow':
                // Sparkle flakes
                for (var f = 0; f < 6; f++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'snow', particles: ['✨', '💫', '⚪'] }, i, 'snowflake-sparkle');
                        }, i * 100 + 100);
                    })(f);
                }
                break;
            case 'tornado':
                // Flying debris
                for (var d = 0; d < 5; d++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'tornado', particles: ['🍃', '🌿', '📄', '🧢'] }, i, 'debris');
                        }, i * 70 + 100);
                    })(d);
                }
                break;
            case 'explosion':
                // Shockwave ring
                setTimeout(function() {
                    var sw = document.createElement('span');
                    sw.className = 'emoji-particle emoji-effect-explosion shockwave';
                    sw.style.left = '50%';
                    sw.style.bottom = '50%';
                    sw.style.marginLeft = '-10px';
                    container.appendChild(sw);
                }, 0);
                // Debris chunks
                for (var b = 0; b < 6; b++) {
                    (function(i) {
                        setTimeout(function() {
                            var angle = (i / 6) * Math.PI * 2;
                            var dist = 70 + Math.random() * 60;
                            var p = document.createElement('span');
                            p.className = 'emoji-particle emoji-effect-explosion debris-chunk';
                            p.textContent = ['🟫', '🟧', '⬛', '🟥'][i % 4];
                            p.style.left = '50%';
                            p.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
                            p.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
                            container.appendChild(p);
                        }, i * 30 + 50);
                    })(b);
                }
                break;
            case 'rainbow':
                for (var r = 0; r < 5; r++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'rainbow', particles: ['✨', '⭐', '💫'] }, i, 'rainbow-sparkle');
                        }, i * 80 + 100);
                    })(r);
                }
                break;
            case 'diamond':
                for (var g = 0; g < 5; g++) {
                    (function(i) {
                        setTimeout(function() {
                            _spawnParticle(container, { type: 'diamond', particles: ['✨', '💫', '⚪'] }, i, 'facet-flash');
                        }, i * 70 + 80);
                    })(g);
                }
                break;
        }
    }

    function _triggerEmojiEffect(targetEl, emoji) {
        var effect = EMOJI_EFFECTS[emoji];
        if (!effect) return;

        var rect = targetEl.getBoundingClientRect();
        var container = document.createElement('div');
        container.className = 'emoji-effect-container';
        container.style.position = 'fixed';
        container.style.left = rect.left + 'px';
        container.style.top = rect.top + 'px';
        container.style.width = rect.width + 'px';
        container.style.height = rect.height + 'px';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '500';
        document.body.appendChild(container);

        // Main particles
        for (var i = 0; i < effect.count; i++) {
            (function (idx) {
                setTimeout(function () {
                    _spawnParticle(container, effect, idx);
                }, idx * 50);
            })(i);
        }

        // Sub-layers for complex effects
        if (effect.layers) {
            _spawnSubLayers(container, effect);
        }

        // Cleanup after all animations complete
        setTimeout(function () { container.remove(); }, 3000);
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

    function _onMessageEdited(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        var msgEl = document.querySelector('[data-message-id="' + payload.messageId + '"]');
        if (!msgEl) return;
        var contentEl = msgEl.querySelector('.chat-bubble-content');
        if (contentEl) {
            var isBot = msgEl.classList.contains('bot') || msgEl.classList.contains('guardian');
            contentEl.innerHTML = isBot ? _formatBotContent(payload.content) : _formatContent(payload.content);
        }
        // Add edited indicator
        var header = msgEl.querySelector('.chat-bubble-header');
        if (header && !header.querySelector('.chat-bubble-edited')) {
            var edited = document.createElement('span');
            edited.className = 'chat-bubble-edited';
            edited.textContent = '(ред.)';
            header.insertBefore(edited, header.querySelector('.chat-bubble-time'));
        }
    }

    var _muteTimerInterval = null;

    /**
     * Check if current user has active mute and show overlay.
     * Called on channel load and on 403 send error.
     */
    async function _checkAndShowMuteOverlay() {
        if (!_currentChannel || !_currentUserId) return;
        try {
            var mutes = await _fetchJson('/api/guardian/mutes/active');
            if (mutes && mutes.length > 0) {
                var myMute = mutes.find(function (m) {
                    return String(m.userId) === _currentUserId && String(m.channelId) === String(_currentChannel.id);
                });
                if (myMute) {
                    _showMuteCountdown(myMute.mutedUntil, myMute.reason);
                    return;
                }
            }
        } catch (e) {
            console.error('[Chat] Failed to check mutes:', e);
        }
    }

    function _onUserMuted(payload) {
        if (!_currentChannel || payload.channelId !== _currentChannel.id) return;
        // If it's us who got muted, show countdown timer
        if (String(payload.userId) === _currentUserId) {
            _showMuteCountdown(payload.mutedUntil, payload.reason);
        }
    }

    function _showMuteCountdown(mutedUntil, reason) {
        var chatMain = document.querySelector('.chat-main');
        if (!chatMain) return;

        // Clear previous
        if (_muteTimerInterval) clearInterval(_muteTimerInterval);
        var old = document.getElementById('chatMuteOverlay');
        if (old) old.remove();

        var endTime = new Date(mutedUntil).getTime();
        var totalDuration = endTime - Date.now();
        if (totalDuration <= 0) return;

        // SVG ring params
        var R = 58, C = 2 * Math.PI * R;

        var overlay = document.createElement('div');
        overlay.className = 'chat-mute-overlay';
        overlay.id = 'chatMuteOverlay';
        overlay.innerHTML =
            '<div class="mute-card">' +
                '<div class="mute-card-glow"></div>' +
                '<div class="mute-ring-wrap">' +
                    '<svg class="mute-ring-svg" viewBox="0 0 132 132">' +
                        '<circle cx="66" cy="66" r="' + R + '" class="mute-ring-bg"/>' +
                        '<circle cx="66" cy="66" r="' + R + '" class="mute-ring-progress" id="muteRingProgress" ' +
                            'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="0"/>' +
                    '</svg>' +
                    '<div class="mute-ring-center">' +
                        '<span class="mute-ring-time" id="chatMuteTimer">--:--</span>' +
                    '</div>' +
                '</div>' +
                '<div class="mute-card-body">' +
                    '<div class="mute-card-icon">🛡️</div>' +
                    '<div class="mute-card-title">Тимчасове блокування</div>' +
                    '<div class="mute-card-reason">' + _esc(reason || 'Порушення правил чату') + '</div>' +
                '</div>' +
                '<button class="mute-appeal-btn" id="chatMuteAppeal">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>' +
                    '<span>Подати апеляцію</span>' +
                '</button>' +
                '<div class="mute-card-hint">Апеляція миттєво знімає блокування</div>' +
            '</div>';

        chatMain.appendChild(overlay);

        // Disable input
        var input = document.getElementById('chatInput');
        var sendBtn = document.getElementById('chatSendBtn');
        if (input) input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;

        var timerEl = document.getElementById('chatMuteTimer');
        var ringEl = document.getElementById('muteRingProgress');

        function clearMute() {
            clearInterval(_muteTimerInterval);
            _muteTimerInterval = null;
            overlay.classList.add('mute-out');
            setTimeout(function () { overlay.remove(); }, 400);
            if (input) { input.disabled = false; input.placeholder = 'Написати повідомлення...'; }
            if (sendBtn) sendBtn.disabled = false;
        }

        function updateTimer() {
            var remaining = endTime - Date.now();
            if (remaining <= 0) { clearMute(); return; }
            var min = Math.floor(remaining / 60000);
            var sec = Math.floor((remaining % 60000) / 1000);
            if (timerEl) timerEl.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
            // Update ring progress
            if (ringEl) {
                var fraction = remaining / totalDuration;
                ringEl.setAttribute('stroke-dashoffset', String(C * (1 - fraction)));
            }
        }

        // Appeal button
        var appealBtn = document.getElementById('chatMuteAppeal');
        if (appealBtn) {
            appealBtn.addEventListener('click', async function () {
                appealBtn.disabled = true;
                appealBtn.querySelector('span').textContent = 'Обробка...';
                appealBtn.classList.add('mute-appeal-loading');
                try {
                    var mutes = await _fetchJson('/api/guardian/mutes/active');
                    if (mutes && mutes.length > 0) {
                        var myMute = mutes.find(function (m) {
                            return String(m.userId) === _currentUserId && String(m.channelId) === String(_currentChannel.id);
                        });
                        if (myMute) {
                            var resp = await fetch('/api/guardian/mutes/' + myMute.id, {
                                method: 'DELETE',
                                headers: _headers()
                            });
                            if (resp.ok) { clearMute(); return; }
                        }
                    }
                    clearMute();
                } catch (e) {
                    clearMute();
                }
            });
        }

        updateTimer();
        _muteTimerInterval = setInterval(updateTimer, 1000);
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

    // ==========================================
    // GUARDIAN WATCHING UI
    // ==========================================

    var _guardianWatchBar = document.getElementById('guardianWatchBar');
    var _guardianMoodEmoji = document.getElementById('guardianMoodEmoji');
    var _guardianMoodLabel = document.getElementById('guardianMoodLabel');
    var _guardianLogBtn = document.getElementById('guardianLogBtn');
    var _guardianLogPanel = document.getElementById('guardianLogPanel');
    var _guardianLogEntries = document.getElementById('guardianLogEntries');

    // ==========================================
    // GUARDIAN DIGEST (available to ALL users)
    // ==========================================
    var _digestPanel = document.getElementById('guardianDigestPanel');
    var _digestBtn = document.getElementById('guardianDigestBtn');
    var _digestContent = document.getElementById('guardianDigestContent');
    var _digestDate = document.getElementById('guardianDigestDate');
    var _digestClose = document.getElementById('guardianDigestClose');
    var _digestPrev = document.getElementById('guardianDigestPrev');
    var _digestNext = document.getElementById('guardianDigestNext');
    var _digestOpen = false;
    var _digestCurrentDate = new Date();

    if (_digestBtn) {
        _digestBtn.addEventListener('click', function () {
            console.log('[Guardian] Digest button clicked, panel:', !!_digestPanel);
            _digestOpen = !_digestOpen;
            _digestBtn.classList.toggle('active', _digestOpen);
            if (_digestPanel) _digestPanel.style.display = _digestOpen ? 'block' : 'none';
            if (_digestOpen) {
                _digestCurrentDate = new Date();
                _loadDigest(_digestCurrentDate);
            }
        });
    } else {
        console.warn('[Guardian] Digest button #guardianDigestBtn not found in DOM');
    }
    if (_digestClose) {
        _digestClose.addEventListener('click', function () {
            _digestOpen = false;
            if (_digestPanel) _digestPanel.style.display = 'none';
        });
    }
    if (_digestPrev) {
        _digestPrev.addEventListener('click', function () {
            _digestCurrentDate.setDate(_digestCurrentDate.getDate() - 1);
            _loadDigest(_digestCurrentDate);
        });
    }
    if (_digestNext) {
        _digestNext.addEventListener('click', function () {
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            if (_digestCurrentDate < tomorrow) {
                _digestCurrentDate.setDate(_digestCurrentDate.getDate() + 1);
                _loadDigest(_digestCurrentDate);
            }
        });
    }

    async function _generateDigest(date) {
        if (!_digestContent) return;
        var dateStr = date.toLocaleDateString('sv-SE');
        _digestContent.innerHTML = '<div class="guardian-digest-empty">⏳ Генерація звіту...</div>';
        try {
            var body = { date: dateStr };
            if (_currentChannel) body.channelId = _currentChannel.id;
            var resp = await fetch('/api/guardian/reports/generate', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, _headers()),
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                console.error('[Guardian] Generate digest failed:', resp.status);
                _digestContent.innerHTML = '<div class="guardian-digest-empty">❌ Помилка генерації (HTTP ' + resp.status + ')</div>';
                return;
            }
            // Reload after generation
            await _loadDigest(date);
        } catch (e) {
            console.error('[Guardian] Generate digest error:', e);
            _digestContent.innerHTML = '<div class="guardian-digest-empty">❌ Помилка генерації дайджесту</div>';
        }
    }

    async function _loadDigest(date) {
        if (!_digestContent || !_digestDate) {
            console.warn('[Guardian] Digest content or date element missing');
            return;
        }
        var dateStr = date.toLocaleDateString('sv-SE'); // YYYY-MM-DD
        var displayDate = date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
        _digestDate.textContent = displayDate;
        _digestContent.innerHTML = '<div class="guardian-digest-empty">Завантаження...</div>';

        try {
            var channelParam = _currentChannel ? '&channelId=' + _currentChannel.id : '';
            console.log('[Guardian] Loading digest for', dateStr, channelParam ? 'channel ' + _currentChannel.id : 'all channels');
            var resp = await fetch('/api/guardian/reports?limit=10' + channelParam, { headers: _headers() });
            if (!resp.ok) {
                console.error('[Guardian] Digest fetch failed:', resp.status, resp.statusText);
                _digestContent.innerHTML = '<div class="guardian-digest-empty">❌ Помилка завантаження (HTTP ' + resp.status + ')<br>' +
                    '<button class="guardian-digest-generate-btn" onclick="void(0)">🔄 Згенерувати зараз</button></div>';
                _digestContent.querySelector('.guardian-digest-generate-btn')?.addEventListener('click', function () { _generateDigest(date); });
                return;
            }
            var reports = await resp.json();
            console.log('[Guardian] Reports received:', reports ? reports.length : 'null');
            if (!reports || reports.length === 0) {
                _digestContent.innerHTML = '<div class="guardian-digest-empty">📭 Дайджест ще не згенеровано.<br><small>Guardian створює звіт щовечора о 23:00</small><br>' +
                    '<button class="guardian-digest-generate-btn" onclick="void(0)">🔄 Згенерувати зараз</button></div>';
                _digestContent.querySelector('.guardian-digest-generate-btn')?.addEventListener('click', function () { _generateDigest(date); });
                return;
            }

            // Find report for the selected date
            var report = reports.find(function (r) {
                return r.reportDate && r.reportDate.substring(0, 10) === dateStr;
            });

            if (!report) {
                // Show the latest available report
                report = reports[0];
                if (report && report.reportDate) {
                    var rd = new Date(report.reportDate);
                    _digestDate.textContent = rd.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
                    _digestCurrentDate = rd;
                }
            }

            if (!report) {
                _digestContent.innerHTML = '<div class="guardian-digest-empty">📭 Немає звіту за цей день<br>' +
                    '<button class="guardian-digest-generate-btn" onclick="void(0)">🔄 Згенерувати зараз</button></div>';
                _digestContent.querySelector('.guardian-digest-generate-btn')?.addEventListener('click', function () { _generateDigest(date); });
                return;
            }

            // Stats bar
            var statsHtml = '<div class="guardian-digest-stats">' +
                '<div class="guardian-digest-stat"><span class="guardian-digest-stat-value">' + (report.conflictsDetected || 0) + '</span><span class="guardian-digest-stat-label">Блокувань</span></div>' +
                '<div class="guardian-digest-stat"><span class="guardian-digest-stat-value">' + (report.sensitiveMasked || 0) + '</span><span class="guardian-digest-stat-label">Замасковано</span></div>' +
                '</div>';

            // Format summary — allow safe HTML tags
            var summary = report.summary || 'Немає даних';
            // Restore safe HTML tags from guardian reports
            summary = summary.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
            summary = summary.replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>');
            summary = summary.replace(/&lt;br\s*\/?&gt;/g, '<br>');
            summary = summary.replace(/&lt;li&gt;/g, '<li>').replace(/&lt;\/li&gt;/g, '</li>');
            summary = summary.replace(/&lt;ul&gt;/g, '<ul>').replace(/&lt;\/ul&gt;/g, '</ul>');
            summary = summary.replace(/\n/g, '<br>');

            _digestContent.innerHTML = statsHtml + '<div class="guardian-digest-body">' + summary + '</div>';
        } catch (e) {
            console.error('[Guardian] Digest load error:', e);
            _digestContent.innerHTML = '<div class="guardian-digest-empty">❌ Помилка завантаження дайджесту<br>' +
                '<button class="guardian-digest-generate-btn" onclick="void(0)">🔄 Згенерувати зараз</button></div>';
            _digestContent.querySelector('.guardian-digest-generate-btn')?.addEventListener('click', function () { _generateDigest(date); });
        }
    }
    var _guardianLogBadge = document.getElementById('guardianLogBadge');
    var _guardianLogClose = document.getElementById('guardianLogClose');
    var _guardianEvents = [];
    var _guardianLogOpen = false;
    var _guardianUnreadCount = 0;
    var _isAdmin = false;

    function _initGuardianUI() {
        console.log('[Guardian] Initializing guardian UI');
        // Check if user is admin
        try {
            var token = localStorage.getItem('pzp_token');
            if (token) {
                var payload = JSON.parse(atob(token.split('.')[1]));
                _isAdmin = payload.role === 'admin' || payload.role === 'creator' || payload.role === 'director';
            }
        } catch (e) { /* ignore */ }

        // Show guardian bar when channel is selected
        if (_guardianWatchBar) {
            _guardianWatchBar.style.display = 'flex';
        }

        // Fetch initial mood
        _fetchJson('/api/guardian/mood').then(function (mood) {
            if (mood && mood.emoji) {
                _updateGuardianMood(mood.emoji, mood.label);
            }
        }).catch(function () { /* ignore */ });

        // Log button — only for admins
        if (_guardianLogBtn) {
            if (!_isAdmin) {
                _guardianLogBtn.style.display = 'none';
            }
            _guardianLogBtn.addEventListener('click', function () {
                _guardianLogOpen = !_guardianLogOpen;
                if (_guardianLogPanel) {
                    _guardianLogPanel.style.display = _guardianLogOpen ? 'block' : 'none';
                }
                if (_guardianLogOpen) {
                    _guardianUnreadCount = 0;
                    if (_guardianLogBadge) _guardianLogBadge.style.display = 'none';
                    // Load recent events from API
                    _loadGuardianEvents();
                }
            });
        }

        if (_guardianLogClose) {
            _guardianLogClose.addEventListener('click', function () {
                _guardianLogOpen = false;
                if (_guardianLogPanel) _guardianLogPanel.style.display = 'none';
            });
        }
    }

    function _updateGuardianMood(emoji, label) {
        if (_guardianMoodEmoji) {
            _guardianMoodEmoji.classList.add('changing');
            setTimeout(function () {
                _guardianMoodEmoji.textContent = emoji;
                _guardianMoodEmoji.classList.remove('changing');
            }, 150);
        }
        if (_guardianMoodLabel) {
            _guardianMoodLabel.textContent = label || '';
        }
    }

    function _onGuardianMood(payload) {
        if (!payload) return;
        _updateGuardianMood(payload.emoji, payload.label);
    }

    function _onGuardianEvent(payload) {
        if (!payload) return;

        // Skip scan events (too noisy for UI)
        if (payload.type === 'scan') return;

        _guardianEvents.unshift(payload);
        if (_guardianEvents.length > 100) _guardianEvents = _guardianEvents.slice(0, 100);

        // Update badge counter
        if (!_guardianLogOpen && _isAdmin) {
            _guardianUnreadCount++;
            if (_guardianLogBadge) {
                _guardianLogBadge.textContent = _guardianUnreadCount > 9 ? '9+' : String(_guardianUnreadCount);
                _guardianLogBadge.style.display = 'flex';
            }
        }

        // Prepend to log panel if open
        if (_guardianLogOpen && _guardianLogEntries) {
            var emptyEl = _guardianLogEntries.querySelector('.guardian-log-empty');
            if (emptyEl) emptyEl.remove();
            _guardianLogEntries.insertBefore(_buildLogEntry(payload), _guardianLogEntries.firstChild);
        }
    }

    function _buildLogEntry(ev) {
        var el = document.createElement('div');
        el.className = 'guardian-log-entry severity-' + (ev.severity || 'info');

        var icon = '🔍';
        if (ev.type === 'mask') icon = '🛡️';
        else if (ev.type === 'mute') icon = '🚨';
        else if (ev.type === 'warn') icon = '⚠️';
        else if (ev.type === 'scan') icon = '👁️';

        var time = '';
        try {
            time = new Date(ev.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) { time = ''; }

        el.innerHTML =
            '<div class="guardian-log-entry-icon">' + icon + '</div>' +
            '<div class="guardian-log-entry-body">' +
                '<div class="guardian-log-entry-text"><b>@' + _esc(ev.username || '?') + '</b> — ' + _esc(ev.details || ev.type) + '</div>' +
                '<div class="guardian-log-entry-time">' + time + '</div>' +
            '</div>';
        return el;
    }

    async function _loadGuardianEvents() {
        if (!_isAdmin || !_guardianLogEntries) return;
        try {
            var actions = await _fetchJson('/api/guardian/actions?limit=20');
            if (actions && actions.length > 0) {
                _guardianLogEntries.innerHTML = '';
                actions.forEach(function (a) {
                    var ev = {
                        type: a.actionType,
                        username: a.targetUsername || (a.details && a.details.username) || '?',
                        details: (a.details && a.details.reason) || (a.details && a.details.types && ('Замасковано: ' + a.details.types.join(', '))) || a.actionType,
                        severity: a.actionType === 'mute' ? 'danger' : a.actionType === 'mask' ? 'warning' : 'info',
                        timestamp: a.createdAt
                    };
                    _guardianLogEntries.appendChild(_buildLogEntry(ev));
                });
            }
        } catch (e) { /* ignore */ }
    }

    // Direct fetch for non-chat APIs (guardian, etc.)
    async function _fetchJson(url) {
        var resp = await fetch(url, { headers: _headers() });
        if (!resp.ok) return null;
        return resp.json();
    }

    // Initialize guardian UI when channel is selected
    var _origSelectChannel = _selectChannel;
    // Override init — show guardian bar on page load
    setTimeout(function () {
        _initGuardianUI();
    }, 500);

    // ==========================================
    // FEATURE 5: SOUND EFFECTS FOR REACTIONS
    // ==========================================
    var _origToggleReaction = _toggleReaction;
    // Reaction sounds are played via existing _playSoundAlways in _toggleReaction

    // ==========================================
    // FEATURE 9: SWIPE-TO-REPLY (MOBILE)
    // ==========================================
    (function initSwipeToReply() {
        var container = document.getElementById('chatMessages');
        if (!container) return;

        var startX = 0;
        var currentEl = null;
        var swiping = false;
        var THRESHOLD = 60;

        container.addEventListener('touchstart', function (e) {
            var msgEl = e.target.closest('.chat-message');
            if (!msgEl) return;
            startX = e.touches[0].clientX;
            currentEl = msgEl;
            swiping = false;
        }, { passive: true });

        container.addEventListener('touchmove', function (e) {
            if (!currentEl) return;
            var dx = e.touches[0].clientX - startX;
            var isOwn = currentEl.classList.contains('own');
            var swipeDir = isOwn ? -dx : dx;

            if (swipeDir > 10) {
                swiping = true;
                currentEl.classList.add('swiping');
                var offset = Math.min(swipeDir, 80);
                currentEl.style.transform = isOwn ? 'translateX(-' + offset + 'px)' : 'translateX(' + offset + 'px)';

                var icon = currentEl.querySelector('.chat-swipe-reply-icon');
                if (icon) {
                    if (swipeDir >= THRESHOLD) {
                        icon.classList.add('ready');
                    } else {
                        icon.classList.remove('ready');
                    }
                }
            }
        }, { passive: true });

        container.addEventListener('touchend', function () {
            if (!currentEl) return;
            if (swiping) {
                var icon = currentEl.querySelector('.chat-swipe-reply-icon');
                if (icon && icon.classList.contains('ready')) {
                    var msgId = currentEl.dataset.messageId;
                    // Find message data and trigger reply
                    var usernameEl = currentEl.querySelector('.chat-bubble-username');
                    var contentEl = currentEl.querySelector('.chat-bubble-content');
                    if (msgId && contentEl) {
                        _startReply({
                            id: msgId,
                            displayName: usernameEl ? usernameEl.textContent : '',
                            username: usernameEl ? usernameEl.textContent : '',
                            content: contentEl.textContent
                        });
                        _playSoundAlways('message-sent');
                    }
                }
                currentEl.classList.remove('swiping');
                currentEl.style.transform = '';
                if (icon) icon.classList.remove('ready');
            }
            currentEl = null;
            swiping = false;
        }, { passive: true });
    })();

    // ==========================================
    // FEATURE 11: CONFETTI + ACHIEVEMENT
    // ==========================================
    function _showConfetti() {
        var container = document.createElement('div');
        container.className = 'chat-confetti-container';
        document.body.appendChild(container);

        var colors = ['#EF4444', '#F97316', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'];
        for (var i = 0; i < 60; i++) {
            var piece = document.createElement('div');
            piece.className = 'chat-confetti-piece';
            piece.style.left = (Math.random() * 100) + '%';
            piece.style.animationDelay = (Math.random() * 1.5) + 's';
            piece.style.animationDuration = (2 + Math.random() * 2) + 's';
            piece.style.background = colors[i % colors.length];
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            container.appendChild(piece);
        }

        setTimeout(function () { container.remove(); }, 4000);
    }

    function _showAchievementToast(icon, title, desc) {
        _showConfetti();
        _playSoundAlways('mention');

        var toast = document.createElement('div');
        toast.className = 'chat-achievement-toast';
        toast.innerHTML =
            '<div class="chat-achievement-icon">' + icon + '</div>' +
            '<div class="chat-achievement-text">' +
                '<div class="chat-achievement-title">' + _esc(title) + '</div>' +
                '<div class="chat-achievement-desc">' + _esc(desc) + '</div>' +
            '</div>';

        document.body.appendChild(toast);

        // Click to dismiss
        toast.addEventListener('click', function () {
            toast.style.transition = 'all 0.3s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-20px) scale(0.8)';
            setTimeout(function () { toast.remove(); }, 300);
        });

        // Auto-dismiss after 5s
        setTimeout(function () {
            if (toast.parentNode) {
                toast.style.transition = 'all 0.5s ease';
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(-20px) scale(0.8)';
                setTimeout(function () { toast.remove(); }, 500);
            }
        }, 5000);
    }

    // Listen for achievement events from WebSocket
    document.addEventListener('parkws', function (e) {
        if (e.detail && e.detail.eventType === 'achievement:unlocked') {
            var p = e.detail.payload;
            _showAchievementToast(p.icon || '🏆', p.title || 'Досягнення!', p.description || '');
        }
    });

    // ==========================================
    // FEATURE 14: LINK PREVIEW (CLIENT-SIDE)
    // ==========================================
    // Simple domain extraction for link previews
    function _addLinkPreviews(el) {
        var links = el.querySelectorAll('.chat-bubble-content a[href]');
        links.forEach(function (link) {
            var url = link.href;
            if (!url || link.closest('.chat-link-preview')) return;
            try {
                var domain = new URL(url).hostname.replace('www.', '');
                var preview = document.createElement('a');
                preview.className = 'chat-link-preview';
                preview.href = url;
                preview.target = '_blank';
                preview.rel = 'noopener';
                preview.innerHTML =
                    '<div class="chat-link-preview-body">' +
                        '<div class="chat-link-preview-title">' + _esc(url.split('/').slice(3).join('/').substring(0, 50) || domain) + '</div>' +
                        '<div class="chat-link-preview-domain">🔗 ' + _esc(domain) + '</div>' +
                    '</div>';
                var bubble = link.closest('.chat-bubble-content');
                if (bubble) bubble.parentNode.insertBefore(preview, bubble.nextSibling);
            } catch (e) { /* ignore invalid URLs */ }
        });
    }

    // Hook into message rendering
    var _origAppendMessage = _appendMessage;
    _appendMessage = function (msg) {
        _origAppendMessage(msg);
        // Add link previews to last message
        var container = document.getElementById('chatMessages');
        if (container) {
            var lastMsg = container.querySelector('.chat-message:last-child');
            if (lastMsg) _addLinkPreviews(lastMsg);
        }
    };

    // ==========================================
    // FEATURE 15: PINNED MESSAGES BAR
    // ==========================================
    function _updatePinnedBar(channel) {
        var bar = document.getElementById('chatPinnedBar');
        if (!bar) {
            // Create pinned bar dynamically
            var chatMain = document.querySelector('.chat-main');
            var header = document.querySelector('.chat-header');
            if (chatMain && header) {
                bar = document.createElement('div');
                bar.className = 'chat-pinned-bar';
                bar.id = 'chatPinnedBar';
                bar.innerHTML =
                    '<span class="chat-pinned-bar-icon">📌</span>' +
                    '<span class="chat-pinned-bar-text" id="chatPinnedText"></span>' +
                    '<button class="chat-pinned-bar-close" id="chatPinnedClose">✕</button>';
                header.after(bar);

                document.getElementById('chatPinnedClose').addEventListener('click', function (e) {
                    e.stopPropagation();
                    bar.classList.remove('visible');
                });
            }
        }
        if (!bar) return;

        // Check if channel has pinned message
        if (channel && channel.pinnedMessage) {
            document.getElementById('chatPinnedText').textContent = channel.pinnedMessage;
            bar.classList.add('visible');
        } else {
            bar.classList.remove('visible');
        }
    }

    // ==========================================
    // FEATURE 16: MOOD GRADIENT BACKGROUND
    // ==========================================
    function _updateMoodGradient(moodEmoji) {
        var container = document.getElementById('chatMessages');
        if (!container) return;

        // Remove old mood classes
        container.classList.remove('mood-positive', 'mood-neutral', 'mood-serious', 'mood-angry');

        // Map Guardian mood emoji to mood class
        var moodMap = {
            '😊': 'mood-positive', '😄': 'mood-positive', '😎': 'mood-positive',
            '🤔': 'mood-neutral', '😐': 'mood-neutral', '🙂': 'mood-neutral',
            '😤': 'mood-angry', '😠': 'mood-angry', '🚨': 'mood-angry',
            '🧐': 'mood-serious', '😶': 'mood-serious', '🤖': 'mood-serious'
        };

        var moodClass = moodMap[moodEmoji] || 'mood-neutral';
        container.classList.add(moodClass);
    }

    // Hook into guardian mood update
    var _origUpdateGuardianMood = _updateGuardianMood;
    _updateGuardianMood = function (emoji, label) {
        _origUpdateGuardianMood(emoji, label);
        _updateMoodGradient(emoji);
    };

    // ==========================================
    // FEATURE 18: AUTO NIGHT MODE
    // ==========================================
    function _checkAutoNightMode() {
        var hour = new Date().getHours();
        var isNight = (hour >= 22 || hour < 7);
        var darkMode = localStorage.getItem('pzp_darkMode') === 'true';
        var autoNight = localStorage.getItem('pzp_autoNight') !== 'false'; // Default enabled

        if (autoNight && isNight && !darkMode) {
            document.body.classList.add('dark-mode');
            document.body.setAttribute('data-theme', 'dark');
            document.body.classList.add('night-auto');
        } else if (autoNight && !isNight && !darkMode) {
            document.body.classList.remove('night-auto');
            // Only remove dark mode if it was auto-applied
            if (document.body.classList.contains('night-auto')) {
                document.body.classList.remove('dark-mode');
                document.body.removeAttribute('data-theme');
            }
        }
    }

    // Check on init and every 5 minutes
    _checkAutoNightMode();
    setInterval(_checkAutoNightMode, 5 * 60 * 1000);

    // ==========================================
    // FEATURE 21: AI SUMMARY BUTTON
    // ==========================================
    var _summaryBtn = document.getElementById('chatSummaryBtn');
    if (_summaryBtn) {
        _summaryBtn.addEventListener('click', async function () {
            if (!_currentChannel) return;
            _summaryBtn.disabled = true;
            _summaryBtn.style.opacity = '0.5';
            _appendSystemMessage('🧠 Генерую резюме розмови...');

            try {
                var token = localStorage.getItem('token');
                var r = await fetch('/api/summary/channel/' + _currentChannel.id + '?hours=24', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var resp = await r.json();
                if (resp.summary) {
                    var costText = resp.cost > 0 ? ' (вартість: $' + resp.cost.toFixed(4) + ')' : '';
                    _appendSystemMessage('📋 **Резюме** (' + (resp.messagesCount || '?') + ' повідомлень)' + costText + ':\n\n' + resp.summary);
                    if (resp.needsDecision) {
                        _appendSystemMessage('⚠️ Є питання що потребують рішення керівника!');
                    }
                } else {
                    _appendSystemMessage('❌ Не вдалось згенерувати резюме.');
                }
            } catch (err) {
                _appendSystemMessage('❌ Помилка: ' + (err.message || 'OpenRouter недоступний'));
            }

            _summaryBtn.disabled = false;
            _summaryBtn.style.opacity = '';
        });
    }

    // ==========================================
    // FEATURE 20: EASTER EGG COMMANDS
    // ==========================================
    _easterEggCommands = {
        '/rain': _easterRain,
        '/дощ': _easterRain,
        '/party': _easterParty,
        '/вечірка': _easterParty,
        '/snow': _easterSnow,
        '/сніг': _easterSnow,
        '/confetti': function () { _showConfetti(); _appendSystemMessage('🎊 Конфетті!'); }
    };

    function _easterRain() {
        var container = document.createElement('div');
        container.className = 'chat-easter-effect';
        document.body.appendChild(container);

        var DINO_EMOJIS = ['🦕', '🦖', '🦎', '🐊', '🦴', '🥚'];
        for (var i = 0; i < 30; i++) {
            var drop = document.createElement('span');
            drop.className = 'easter-rain-drop';
            drop.textContent = DINO_EMOJIS[i % DINO_EMOJIS.length];
            drop.style.left = (Math.random() * 100) + '%';
            drop.style.setProperty('--fall-duration', (2 + Math.random() * 3) + 's');
            drop.style.setProperty('--delay', (Math.random() * 2) + 's');
            drop.style.fontSize = (20 + Math.random() * 16) + 'px';
            container.appendChild(drop);
        }

        _appendSystemMessage('🦕 Динозаври йдуть!');
        _playSoundAlways('mention');
        setTimeout(function () { container.remove(); }, 6000);
    }

    function _easterParty() {
        var container = document.createElement('div');
        container.className = 'chat-easter-effect';
        container.innerHTML =
            '<div class="easter-disco-ball">🪩</div>' +
            '<div class="easter-party-light"></div>';
        document.body.appendChild(container);

        _showConfetti();
        _appendSystemMessage('🪩 Вечірка в Парку Закревського Періоду!');
        _playSoundAlways('connect');
        setTimeout(function () { container.remove(); }, 6000);
    }

    function _easterSnow() {
        var container = document.createElement('div');
        container.className = 'chat-easter-effect';
        document.body.appendChild(container);

        var SNOW = ['❄️', '❅', '❆', '✿', '✻', '❃'];
        for (var i = 0; i < 40; i++) {
            var flake = document.createElement('span');
            flake.className = 'easter-snowflake';
            flake.textContent = SNOW[i % SNOW.length];
            flake.style.left = (Math.random() * 100) + '%';
            flake.style.setProperty('--fall-duration', (3 + Math.random() * 4) + 's');
            flake.style.setProperty('--delay', (Math.random() * 3) + 's');
            flake.style.setProperty('--sway', ((Math.random() - 0.5) * 60) + 'px');
            flake.style.fontSize = (12 + Math.random() * 14) + 'px';
            container.appendChild(flake);
        }

        _appendSystemMessage('❄️ Сніг у парку!');
        _playSoundAlways('mention');
        setTimeout(function () { container.remove(); }, 8000);
    }

    // Easter egg commands are now handled inside _sendMessage() directly

    // ==========================================
    // FEATURE 1: ONLINE STATUS TRACKING
    // ==========================================
    var _onlineUsers = {};

    function _updateOnlineDots() {
        document.querySelectorAll('.chat-online-dot').forEach(function (dot) {
            var userId = dot.dataset.userId;
            if (_onlineUsers[userId]) {
                dot.classList.add('online');
                dot.classList.remove('away');
            } else {
                dot.classList.remove('online');
            }
        });
    }

    // Listen for presence events
    document.addEventListener('parkws', function (e) {
        if (e.detail && e.detail.eventType === 'user:online') {
            _onlineUsers[e.detail.payload.userId] = true;
            _updateOnlineDots();
        }
        if (e.detail && e.detail.eventType === 'user:offline') {
            delete _onlineUsers[e.detail.payload.userId];
            _updateOnlineDots();
        }
    });

    // Mark current user as online
    if (_currentUserId) _onlineUsers[_currentUserId] = true;

    // ==========================================
    // FEATURE 17: EMOJI AVATAR BLINK
    // ==========================================
    setInterval(function () {
        var avatars = document.querySelectorAll('.chat-avatar.emoji-avatar');
        if (avatars.length === 0) return;
        var randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
        randomAvatar.classList.add('blink');
        setTimeout(function () { randomAvatar.classList.remove('blink'); }, 300);
    }, 5000);

})();
