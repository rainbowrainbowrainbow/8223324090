/**
 * settings-history.js - History tab helpers
 * Load after settings.js in index.html
 *
 * Provides: window.SettingsHistory = { init, render, search, nextPage, prevPage, exportCSV }
 */

window.SettingsHistory = {
    /**
     * Initialize history panel (delegates to showHistory)
     */
    async init() {
        if (typeof showHistory === 'function') {
            await showHistory();
        }
    },

    /**
     * Render current history page (delegates to loadHistoryPage)
     */
    async render() {
        if (typeof loadHistoryPage === 'function') {
            await loadHistoryPage();
        }
    },

    /**
     * Apply search/filter and reload
     */
    async search() {
        if (typeof historyCurrentOffset !== 'undefined') {
            historyCurrentOffset = 0;
        }
        await this.render();
    },

    /**
     * Go to next history page
     */
    async nextPage() {
        if (typeof historyCurrentOffset !== 'undefined' && typeof HISTORY_PAGE_SIZE !== 'undefined') {
            historyCurrentOffset += HISTORY_PAGE_SIZE;
            await this.render();
        }
    },

    /**
     * Go to previous history page
     */
    async prevPage() {
        if (typeof historyCurrentOffset !== 'undefined' && typeof HISTORY_PAGE_SIZE !== 'undefined') {
            historyCurrentOffset = Math.max(0, historyCurrentOffset - HISTORY_PAGE_SIZE);
            await this.render();
        }
    },

    /**
     * Get current filter values
     * @returns {Object}
     */
    getFilters() {
        return typeof getHistoryFilters === 'function' ? getHistoryFilters() : {};
    },

    /**
     * Export history to CSV (basic implementation)
     * @param {Array} items - History items to export
     */
    exportCSV(items) {
        if (!items || items.length === 0) return;

        const header = 'Дата,Дія,Користувач,Деталі\n';
        const rows = items.map(item => {
            const date = new Date(item.timestamp).toLocaleString('uk-UA');
            const action = item.action || '';
            const user = item.user || '';
            const details = JSON.stringify(item.data || {}).replace(/"/g, '""');
            return `"${date}","${action}","${user}","${details}"`;
        }).join('\n');

        const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `history_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};
