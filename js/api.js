/**
 * api.js - Всі API функції (PostgreSQL + localStorage fallback)
 */

const API_BASE = '/api';

async function apiGetBookings(date) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${date}`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(booking)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings.push(booking);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true, id: booking.id };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings = bookings.filter(b => b.id !== id && b.linkedTo !== id);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true };
    }
}

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lines)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API saveLines error:', err);
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        linesByDate[date] = lines;
        localStorage.setItem(CONFIG.STORAGE.LINES_BY_DATE, JSON.stringify(linesByDate));
        return { success: true };
    }
}

async function apiGetHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, user, data })
        });
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
        const response = await fetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        return await response.json();
    } catch (err) {
        console.error('Telegram notify error:', err);
    }
}

async function apiGetSetting(key) {
    try {
        const response = await fetch(`${API_BASE}/settings/${key}`);
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}
