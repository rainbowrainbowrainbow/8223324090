/**
 * settings-afisha.js - Afisha (event schedule) management helpers
 * Load after settings.js in index.html
 *
 * Provides: window.SettingsAfisha = { init, render, create, update, remove, shift, autoPosition }
 */

window.SettingsAfisha = {
    /**
     * Initialize and show afisha modal (delegates to showAfishaModal)
     */
    async init() {
        if (typeof showAfishaModal === 'function') {
            await showAfishaModal();
        }
    },

    /**
     * Render afisha list (delegates to renderAfishaList)
     */
    async render() {
        if (typeof renderAfishaList === 'function') {
            await renderAfishaList();
        }
    },

    /**
     * Create new afisha item (delegates to addAfishaItem)
     */
    async create() {
        if (typeof addAfishaItem === 'function') {
            await addAfishaItem();
        }
    },

    /**
     * Update afisha item (delegates to handleAfishaEditSubmit)
     * @param {Event} e - Form submit event
     */
    async update(e) {
        if (typeof handleAfishaEditSubmit === 'function') {
            await handleAfishaEditSubmit(e);
        }
    },

    /**
     * Delete afisha item
     * @param {string} id - Afisha item ID
     */
    async remove(id) {
        if (typeof deleteAfishaItem === 'function') {
            await deleteAfishaItem(id);
        }
    },

    /**
     * Shift afisha time by delta minutes
     * @param {string} id - Afisha item ID
     * @param {number} deltaMinutes - Minutes to shift (positive or negative)
     */
    async shift(id, deltaMinutes) {
        if (typeof shiftAfishaItem === 'function') {
            await shiftAfishaItem(id, deltaMinutes);
        }
    },

    /**
     * Auto-position afisha items (delegates to autoPositionAfisha)
     */
    async autoPosition() {
        if (typeof autoPositionAfisha === 'function') {
            await autoPositionAfisha();
        }
    },

    /**
     * Generate tasks for afisha item
     * @param {string} id - Afisha item ID
     */
    async generateTasks(id) {
        if (typeof generateTasksForAfisha === 'function') {
            await generateTasksForAfisha(id);
        }
    },

    /**
     * Export afisha in bulk (delegates to exportAfishaBulk)
     */
    async exportBulk() {
        if (typeof exportAfishaBulk === 'function') {
            await exportAfishaBulk();
        }
    },

    /**
     * Import afisha in bulk (delegates to importAfishaBulk)
     */
    async importBulk() {
        if (typeof importAfishaBulk === 'function') {
            await importAfishaBulk();
        }
    }
};
