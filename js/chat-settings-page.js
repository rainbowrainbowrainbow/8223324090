(function () {
    'use strict';

    var _state = {
        chatAi: null,
        guardian: null,
        integrations: null,
        modelOptions: null,
        defaultModels: null
    };

    var FALLBACK_MODEL_OPTIONS = {
        auto: [{ value: '', label: 'Автоматично за provider' }],
        openai: [
            { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
            { value: 'gpt-5.5', label: 'GPT-5.5' },
            { value: 'gpt-5.4', label: 'GPT-5.4' },
            { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
            { value: 'gpt-5-mini', label: 'GPT-5 mini' },
            { value: 'gpt-5-nano', label: 'GPT-5 nano' },
            { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' }
        ],
        anthropic: [
            { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
            { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' }
        ],
        openrouter: [
            { value: 'openai/gpt-5.4-mini', label: 'OpenAI GPT-5.4 mini' },
            { value: 'openai/gpt-5.5', label: 'OpenAI GPT-5.5' },
            { value: 'openai/gpt-5.4-nano', label: 'OpenAI GPT-5.4 nano' },
            { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
            { value: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5' }
        ]
    };

    function $(id) {
        return document.getElementById(id);
    }

    function _authToken() {
        return localStorage.getItem('pzp_token') || localStorage.getItem('authToken') || '';
    }

    function _headers() {
        var token = _authToken();
        return Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}
        );
    }

    function _isAuthError(err) {
        return err && (err.status === 401 || err.status === 403);
    }

    function _handleAuthRequired() {
        if (typeof handleAuthError === 'function') {
            handleAuthError({ status: 401 });
            return;
        }
        window.location.href = '/';
    }

    async function _request(method, path, body) {
        var resp = await fetch(path, {
            method: method,
            headers: _headers(),
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        var data = null;
        try { data = await resp.json(); } catch (e) { data = {}; }
        if (!resp.ok) {
            var err = new Error(data.error || data.message || 'Request failed');
            err.status = resp.status;
            err.data = data;
            if (_isAuthError(err) && typeof handleAuthError === 'function') {
                handleAuthError(resp);
            }
            throw err;
        }
        return data;
    }

    function _notify(message, type) {
        var alert = $('chatSettingsAlert');
        if (alert) {
            alert.hidden = false;
            alert.textContent = message;
            alert.className = 'chat-settings-alert chat-settings-alert--' + (type || 'info');
            clearTimeout(alert._hideTimer);
            alert._hideTimer = setTimeout(function () { alert.hidden = true; }, 4500);
        }
        if (typeof showNotification === 'function') showNotification(message, type || 'info');
    }

    function _setStatus(el, config) {
        if (!el || !config) return;
        var label = 'Невідомо';
        var tone = 'neutral';
        if (config.status === 'ok') {
            label = (config.provider || 'AI') + ' · ' + (config.model || 'default');
            tone = 'ok';
        } else if (config.status === 'disabled') {
            label = 'Вимкнено';
            tone = 'muted';
        } else if (config.status === 'missing_key') {
            label = 'Немає shared key';
            tone = 'warning';
        } else if (config.status === 'error') {
            label = config.message || 'Помилка';
            tone = 'warning';
        }
        el.textContent = label;
        el.dataset.tone = tone;
    }

    function _setLoadFailedStatus(message) {
        var config = { status: 'error', message: message || 'Помилка завантаження' };
        _setStatus($('chatAiStatus'), config);
        _setStatus($('guardianAiStatus'), config);
    }

    function _fillCheckbox(id, value) {
        var el = $(id);
        if (el) el.checked = value !== false;
    }

    function _fillValue(id, value) {
        var el = $(id);
        if (el) el.value = value || '';
    }

    function _providerFor(id, fallback) {
        return $(id)?.value || fallback || 'openai';
    }

    function _modelOptions(provider) {
        var options = _state.modelOptions || FALLBACK_MODEL_OPTIONS;
        return options[provider] || options.auto || FALLBACK_MODEL_OPTIONS.auto;
    }

    function _defaultModel(provider) {
        var defaults = _state.defaultModels || {};
        if (provider === 'auto') return '';
        return defaults[provider] || (_modelOptions(provider).find(function (item) { return item.value; }) || {}).value || '';
    }

    function _fillModelSelect(id, provider, value) {
        var el = $(id);
        if (!el) return;
        var normalizedProvider = provider || 'openai';
        var options = _modelOptions(normalizedProvider);
        var selected = value || _defaultModel(normalizedProvider);
        el.innerHTML = options.map(function (item) {
            var optionValue = item.value || '';
            var label = item.label || optionValue || 'Автоматично';
            var desc = item.description ? ' title="' + _escapeAttr(item.description) + '"' : '';
            return '<option value="' + _escapeAttr(optionValue) + '"' + desc + '>' + _escapeHtml(label) + '</option>';
        }).join('');
        if (!options.some(function (item) { return (item.value || '') === selected; })) selected = _defaultModel(normalizedProvider);
        el.value = selected || '';
    }

    function _syncModelSelect(providerId, modelId, preferredModel) {
        _fillModelSelect(modelId, _providerFor(providerId), preferredModel);
    }

    function _escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _escapeAttr(value) {
        return _escapeHtml(value).replace(/'/g, '&#39;');
    }

    function _render(data) {
        _state.chatAi = data.chatAi || {};
        _state.guardian = data.guardian || {};
        _state.integrations = data.integrations || {};
        _state.modelOptions = data.modelOptions || FALLBACK_MODEL_OPTIONS;
        _state.defaultModels = data.defaultModels || {};

        _fillCheckbox('chatAiEnabled', _state.chatAi.enabled);
        _fillValue('chatAiProvider', _state.chatAi.requestedProvider || _state.chatAi.provider || 'auto');
        _fillModelSelect('chatAiModel', _providerFor('chatAiProvider'), _state.chatAi.model || '');
        if ($('chatAiKeySource')) $('chatAiKeySource').textContent = _state.chatAi.keySource || data.keySource || 'crm_ai_default';
        _setStatus($('chatAiStatus'), _state.chatAi);

        _fillCheckbox('chatIntegrationChannels', _state.integrations.channels);
        _fillCheckbox('chatIntegrationSummary', _state.integrations.summary);
        _fillCheckbox('chatIntegrationGuardian', _state.integrations.guardian);
        _fillCheckbox('chatIntegrationNotifications', _state.integrations.notifications);

        _fillCheckbox('guardianEnabled', _state.guardian.enabled);
        _fillCheckbox('guardianDigestEnabled', _state.guardian.digestEnabled);
        _fillCheckbox('guardianSecurityLogEnabled', _state.guardian.securityLogEnabled);
        _fillCheckbox('guardianAnalyticsEnabled', _state.guardian.analyticsEnabled);
        _fillValue('guardianProvider', _state.guardian.provider || 'auto');
        _fillModelSelect('guardianModel', _providerFor('guardianProvider'), _state.guardian.model || _state.guardian.ai?.model || '');
        _setStatus($('guardianAiStatus'), _state.guardian.ai || {});
    }

    async function _load() {
        if (!_authToken()) {
            _handleAuthRequired();
            return;
        }
        try {
            var data = await _request('GET', '/api/settings/chat');
            _render(data);
            _revealShell();
        } catch (err) {
            if (_isAuthError(err)) return;
            console.error('[ChatSettings] load failed', err);
            _setLoadFailedStatus('Не вдалося завантажити');
            _revealShell();
            _notify('Не вдалось завантажити налаштування чату', 'error');
        }
    }

    async function _saveChatAi() {
        try {
            var data = await _request('PUT', '/api/settings/chat/ai', {
                enabled: $('chatAiEnabled')?.checked !== false,
                provider: $('chatAiProvider')?.value || 'auto',
                model: $('chatAiModel')?.value || ''
            });
            _state.chatAi = data;
            _setStatus($('chatAiStatus'), data);
            _notify('AI налаштування чату збережено', 'success');
        } catch (err) {
            if (_isAuthError(err)) return;
            console.error('[ChatSettings] save AI failed', err);
            _notify('Не вдалось зберегти AI налаштування', 'error');
        }
    }

    async function _testChatAi() {
        var btn = $('chatAiTestBtn');
        if (btn) btn.disabled = true;
        try {
            var result = await _request('POST', '/api/settings/chat/ai/test', { live: true });
            _setStatus($('chatAiStatus'), result);
            _notify(result.message || 'AI підключення працює', 'success');
        } catch (err) {
            if (_isAuthError(err)) return;
            var result = err.data || {};
            _setStatus($('chatAiStatus'), result);
            _notify(result.message || 'AI підключення не пройшло перевірку', 'warning');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function _saveIntegrations() {
        try {
            _state.integrations = await _request('PUT', '/api/settings/chat/integrations', {
                channels: $('chatIntegrationChannels')?.checked !== false,
                summary: $('chatIntegrationSummary')?.checked !== false,
                guardian: $('chatIntegrationGuardian')?.checked !== false,
                notifications: $('chatIntegrationNotifications')?.checked !== false
            });
            _notify('Інтеграції чату збережено', 'success');
        } catch (err) {
            if (_isAuthError(err)) return;
            console.error('[ChatSettings] save integrations failed', err);
            _notify('Не вдалось зберегти інтеграції', 'error');
        }
    }

    async function _saveGuardian() {
        try {
            var data = await _request('PUT', '/api/settings/chat/guardian', {
                enabled: $('guardianEnabled')?.checked !== false,
                digestEnabled: $('guardianDigestEnabled')?.checked !== false,
                securityLogEnabled: $('guardianSecurityLogEnabled')?.checked !== false,
                analyticsEnabled: $('guardianAnalyticsEnabled')?.checked !== false,
                provider: $('guardianProvider')?.value || 'auto',
                model: $('guardianModel')?.value || ''
            });
            _state.guardian = data;
            _setStatus($('guardianAiStatus'), data.ai || {});
            _notify('Guardian налаштування збережено', 'success');
        } catch (err) {
            if (_isAuthError(err)) return;
            console.error('[ChatSettings] save Guardian failed', err);
            _notify('Не вдалось зберегти Guardian налаштування', 'error');
        }
    }

    function _bind() {
        $('chatAiSaveBtn')?.addEventListener('click', _saveChatAi);
        $('chatAiTestBtn')?.addEventListener('click', _testChatAi);
        $('chatIntegrationsSaveBtn')?.addEventListener('click', _saveIntegrations);
        $('guardianSaveBtn')?.addEventListener('click', _saveGuardian);
        $('chatAiProvider')?.addEventListener('change', function () {
            _syncModelSelect('chatAiProvider', 'chatAiModel');
        });
        $('guardianProvider')?.addEventListener('change', function () {
            _syncModelSelect('guardianProvider', 'guardianModel');
        });
    }

    function _revealShell() {
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _bind();
            _load();
        });
    } else {
        _bind();
        _load();
    }
})();
