/**
 * settings-dashboard.js - Revenue dashboard helpers
 * Load after settings.js in index.html
 *
 * Provides: window.SettingsDashboard = { init, refresh, formatCurrency, getPeriodLabel }
 */

window.SettingsDashboard = {
    currentPeriod: 'month',

    /**
     * Initialize dashboard (delegates to showDashboard)
     */
    async init() {
        if (typeof showDashboard === 'function') {
            await showDashboard();
        }
    },

    /**
     * Refresh dashboard data for current period
     */
    async refresh() {
        if (typeof loadDashboardData === 'function') {
            await loadDashboardData(this.currentPeriod);
        }
    },

    /**
     * Switch dashboard period and reload
     */
    async switchPeriod(period) {
        this.currentPeriod = period;
        if (typeof switchDashboardPeriod === 'function') {
            await switchDashboardPeriod(period);
        }
    },

    /**
     * Format currency in Ukrainian style: "12 500 ₴"
     * @param {number} amount
     * @returns {string}
     */
    formatCurrency(amount) {
        if (typeof formatPrice === 'function') return formatPrice(amount);
        const num = Math.round(amount || 0);
        return num.toLocaleString('uk-UA') + ' ₴';
    },

    /**
     * Get human-readable period label
     * @param {string} period - week|month|quarter|year
     * @returns {string}
     */
    getPeriodLabel(period) {
        const labels = {
            week: 'Тиждень',
            month: 'Місяць',
            quarter: 'Квартал',
            year: 'Рік'
        };
        return labels[period] || period;
    },

    /**
     * Calculate percentage change between two values
     * @param {number} current
     * @param {number} previous
     * @returns {string} e.g. "+15%" or "-3%"
     */
    calcChange(current, previous) {
        if (!previous || previous === 0) return current > 0 ? '+∞' : '0%';
        const change = ((current - previous) / previous * 100).toFixed(0);
        return (change > 0 ? '+' : '') + change + '%';
    }
};
