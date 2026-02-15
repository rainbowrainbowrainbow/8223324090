/**
 * api.js - Всі API функції (PostgreSQL + localStorage fallback)
 * v5.0: JWT auth token in all requests
 */

const API_BASE = '/api';

function getAuthHeaders(withContentType = true) {
    const token = localStorage.getItem('pzp_token');
    const headers = {};
    if (withContentType) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
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
        const response = await fetch(`${API_BASE}/bookings/${date}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBookings error:', err);
        // v7.0.1: Return null on error so cache layer can preserve existing data
        return null;
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
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

// v5.7: Create booking with linked bookings in one transaction
async function apiCreateBookingFull(main, linked) {
    try {
        const response = await fetch(`${API_BASE}/bookings/full`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ main, linked })
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API createBookingFull error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
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
        // Optimistic locking: 409 with conflict field
        if (response.status === 409) {
            const body = await response.json().catch(() => ({}));
            return {
                success: false,
                conflict: body.conflict || false,
                error: body.error || 'Конфлікт даних',
                currentData: body.currentData || null
            };
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API updateBooking error:', err);
        return { success: false, error: err.message, offline: true };
    }
}

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getLines error:', err);
        // v7.0.1: Return null on error so cache layer can preserve existing data
        return null;
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

// v5.16: support filter params
async function apiGetHistory(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.action) params.set('action', filters.action);
        if (filters.user) params.set('user', filters.user);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.search) params.set('search', filters.search);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const url = `${API_BASE}/history${qs ? '?' + qs : ''}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        // Backward compat: if server returns array (old format)
        if (Array.isArray(data)) return { items: data, total: data.length };
        return data;
    } catch (err) {
        console.error('API getHistory error:', err);
        const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        return { items, total: items.length };
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
        const response = await fetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStats error:', err);
        return [];
    }
}

// v9.0: Enhanced stats API (server-side aggregation)
async function apiGetStatsRevenue(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        const url = `${API_BASE}/stats/revenue${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsRevenue error:', err);
        return null;
    }
}

async function apiGetStatsPrograms(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        if (params.limit) qs.set('limit', params.limit);
        const url = `${API_BASE}/stats/programs${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsPrograms error:', err);
        return null;
    }
}

async function apiGetStatsLoad(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.period) qs.set('period', params.period);
        if (params.from) qs.set('from', params.from);
        if (params.to) qs.set('to', params.to);
        const url = `${API_BASE}/stats/load${qs.toString() ? '?' + qs.toString() : ''}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsLoad error:', err);
        return null;
    }
}

async function apiGetStatsTrends(period = 'month') {
    try {
        const url = `${API_BASE}/stats/trends?period=${encodeURIComponent(period)}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStatsTrends error:', err);
        return null;
    }
}

async function apiTelegramNotify(text) {
    try {
        const response = await fetch(`${API_BASE}/telegram/notify`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ text })
        });
        if (handleAuthError(response)) return { success: false, reason: 'auth_error' };
        if (!response.ok) return { success: false, reason: 'server_error' };
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
        const response = await fetch(`${API_BASE}/telegram/animator-status/${requestId}`, { headers: getAuthHeaders(false) });
        return await response.json();
    } catch (err) {
        console.error('Check animator status error:', err);
        return { status: 'error' };
    }
}

async function apiGetSetting(key) {
    try {
        const response = await fetch(`${API_BASE}/settings/${key}`, { headers: getAuthHeaders(false) });
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

// v7.0: Products catalog API
async function apiGetProducts(activeOnly = true) {
    try {
        const qs = activeOnly ? '?active=true' : '';
        const response = await fetch(`${API_BASE}/products${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProducts error:', err);
        return null; // caller should fallback to PROGRAMS
    }
}

async function apiGetProduct(id) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProduct error:', err);
        return null;
    }
}

// v7.1: Products CRUD API
async function apiCreateProduct(product) {
    try {
        const response = await fetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API createProduct error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateProduct(id, product) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(product)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const data = await response.json();
        return { success: true, product: data };
    } catch (err) {
        console.error('API updateProduct error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteProduct(id) {
    try {
        const response = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteProduct error:', err);
        return { success: false, error: err.message };
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
        let errMsg = 'Login failed';
        try { const err = await response.json(); errMsg = err.error || errMsg; } catch {}
        throw new Error(errMsg);
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

// v10.4: Personal cabinet profile
async function apiGetProfile() {
    try {
        const response = await fetch(`${API_BASE}/auth/profile`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getProfile error:', err);
        return null;
    }
}

// v10.4: Change password
async function apiChangePassword(currentPassword, newPassword) {
    try {
        const response = await fetch(`${API_BASE}/auth/password`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ currentPassword, newPassword })
        });
        if (handleAuthError(response)) return { success: false };
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error || 'API error' };
        return { success: true };
    } catch (err) {
        console.error('API changePassword error:', err);
        return { success: false, error: err.message };
    }
}

// v10.6: Quick task status from profile
async function apiQuickTaskStatus(taskId, status) {
    try {
        const response = await fetch(`${API_BASE}/auth/tasks/${taskId}/quick-status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return { success: false };
        const data = await response.json();
        if (!response.ok) return { success: false, error: data.error || 'API error' };
        return { success: true, ...data };
    } catch (err) {
        console.error('API quickTaskStatus error:', err);
        return { success: false, error: err.message };
    }
}

// v10.6: Log user UI action
async function apiLogAction(action, target, meta) {
    try {
        fetch(`${API_BASE}/auth/log-action`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ action, target, meta })
        }); // fire-and-forget
    } catch { /* ignore */ }
}

// v10.6: Get achievements definitions
async function apiGetAchievements() {
    try {
        const response = await fetch(`${API_BASE}/auth/achievements`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return {};
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getAchievements error:', err);
        return {};
    }
}

// v10.6: Get user action log
async function apiGetActionLog(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.user) params.set('user', filters.user);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const response = await fetch(`${API_BASE}/auth/action-log${qs ? '?' + qs : ''}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getActionLog error:', err);
        return { items: [], total: 0 };
    }
}

// v10.4: Profile activity with pagination
async function apiGetProfileActivity(filters = {}) {
    try {
        const params = new URLSearchParams();
        params.set('user', AppState.currentUser.username);
        if (filters.action) params.set('action', filters.action);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const url = `${API_BASE}/history?${params.toString()}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        if (Array.isArray(data)) return { items: data, total: data.length };
        return data;
    } catch (err) {
        console.error('API getProfileActivity error:', err);
        return { items: [], total: 0 };
    }
}

// v8.4: Certificates API
async function apiGetCertificates(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.search) params.set('search', filters.search);
        if (filters.limit) params.set('limit', filters.limit);
        if (filters.offset) params.set('offset', filters.offset);
        const qs = params.toString();
        const url = `${API_BASE}/certificates${qs ? '?' + qs : ''}`;
        const response = await fetch(url, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return { items: [], total: 0 };
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getCertificates error:', err);
        return { items: [], total: 0 };
    }
}

async function apiCreateCertificate(data) {
    try {
        const response = await fetch(`${API_BASE}/certificates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API createCertificate error:', err);
        return { success: false, error: err.message };
    }
}

async function apiBatchCreateCertificates(data) {
    try {
        const response = await fetch(`${API_BASE}/certificates/batch`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API batchCreateCertificates error:', err);
        return { success: false, error: err.message };
    }
}

async function apiGetCertificateByCode(code) {
    try {
        const response = await fetch(`${API_BASE}/certificates/code/${encodeURIComponent(code)}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('API getCertificateByCode error:', err);
        return null;
    }
}

async function apiUpdateCertificateStatus(id, status, reason) {
    try {
        const response = await fetch(`${API_BASE}/certificates/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status, reason })
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API updateCertificateStatus error:', err);
        return { success: false, error: err.message };
    }
}

async function apiUpdateCertificate(id, data) {
    try {
        const response = await fetch(`${API_BASE}/certificates/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        const cert = await response.json();
        return { success: true, certificate: cert };
    } catch (err) {
        console.error('API updateCertificate error:', err);
        return { success: false, error: err.message };
    }
}

async function apiDeleteCertificate(id) {
    try {
        const response = await fetch(`${API_BASE}/certificates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return { success: false };
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return { success: false, error: body.error || 'API error' };
        }
        return await response.json();
    } catch (err) {
        console.error('API deleteCertificate error:', err);
        return { success: false, error: err.message };
    }
}
