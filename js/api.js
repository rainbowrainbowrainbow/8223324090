/**
 * api.js - Всі API функції (PostgreSQL + localStorage fallback)
 * v5.0: JWT auth token in all requests
 */

const API_BASE = '/api';

function getAuthHeaders() {
    const token = localStorage.getItem('pzp_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

function getAuthHeadersGet() {
    const token = localStorage.getItem('pzp_token');
    if (token) return { 'Authorization': `Bearer ${token}` };
    return {};
}

// v5.0: Handle 401/403 — redirect to login
function handleAuthError(response) {
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        localStorage.removeItem(CONFIG.STORAGE.SESSION);
        if (typeof showLoginScreen === 'function') showLoginScreen();
        return true;
    }
    return false;
}

async function apiGetBookings(date) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${date}`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBookings error:', err);
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        return bookings.filter(b => b.date === date);
    }
}

async function apiCreateBooking(booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(booking)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE',
            headers: getAuthHeadersGet()
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiUpdateBooking(id, booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(booking)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API updateBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getLines error:', err);
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        if (linesByDate[date]) return linesByDate[date];
        return [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
    }
}

async function apiSaveLines(date, lines) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(lines)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API saveLines error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getHistory error:', err);
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
    }
}

async function apiAddHistory(action, user, data) {
    try {
        const response = await fetch(`${API_BASE}/history`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, user, data })
        });
        if (handleAuthError(response)) return;
        if (!response.ok) throw new Error('API error');
    } catch (err) {
        console.error('API addHistory error:', err);
        const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        history.unshift({ id: Date.now(), action, user, data, timestamp: new Date().toISOString() });
        if (history.length > 500) history.pop();
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
    }
}

async function apiGetStats(dateFrom, dateTo) {
    try {
        const response = await fetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStats error:', err);
        return [];
    }
}

async function apiTelegramNotify(text) {
    try {
        const response = await fetch(`${API_BASE}/telegram/notify`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ text })
        });
        return await response.json();
    } catch (err) {
        console.error('Telegram notify error:', err);
        return { success: false, reason: 'network_error' };
    }
}

async function apiTelegramAskAnimator(date, note) {
    try {
        const response = await fetch(`${API_BASE}/telegram/ask-animator`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ date, note })
        });
        return await response.json();
    } catch (err) {
        console.error('Telegram ask-animator error:', err);
    }
}

async function apiCheckAnimatorStatus(requestId) {
    try {
        const response = await fetch(`${API_BASE}/telegram/animator-status/${requestId}`, { headers: getAuthHeadersGet() });
        return await response.json();
    } catch (err) {
        console.error('Check animator status error:', err);
        return { status: 'error' };
    }
}

async function apiGetSetting(key) {
    try {
        const response = await fetch(`${API_BASE}/settings/${key}`, { headers: getAuthHeadersGet() });
        const data = await response.json();
        return data.value;
    } catch (err) {
        console.error('getSetting error:', err);
        return null;
    }
}

async function apiSaveSetting(key, value) {
    try {
        await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ key, value })
        });
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

// v5.0: Auth API
async function apiLogin(username, password) {
    const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Login failed');
    }
    return await response.json();
}

async function apiVerifyToken() {
    const token = localStorage.getItem('pzp_token');
    if (!token) return null;
    try {
        const response = await fetch(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.user;
    } catch {
        return null;
    }
}
