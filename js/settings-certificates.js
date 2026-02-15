/**
 * settings-certificates.js - Certificate management helpers
 * Load after settings.js in index.html
 *
 * Provides: window.SettingsCertificates = { init, render, create, updateStatus, generateImage, search }
 */

window.SettingsCertificates = {
    /**
     * Initialize certificates panel (delegates to openCertificatesPanel)
     */
    init() {
        if (typeof openCertificatesPanel === 'function') {
            openCertificatesPanel();
        }
    },

    /**
     * Close certificates panel
     */
    close() {
        if (typeof closeCertificatesPanel === 'function') {
            closeCertificatesPanel();
        }
    },

    /**
     * Load and render certificates list (delegates to loadCertificates)
     */
    async render() {
        if (typeof loadCertificates === 'function') {
            await loadCertificates();
        }
    },

    /**
     * Open create certificate modal (delegates to showCreateCertificateModal)
     */
    create() {
        if (typeof showCreateCertificateModal === 'function') {
            showCreateCertificateModal();
        }
    },

    /**
     * Open batch certificate modal
     */
    createBatch() {
        if (typeof showBatchCertificateModal === 'function') {
            showBatchCertificateModal();
        }
    },

    /**
     * Submit certificate form (delegates to handleCertificateSubmit)
     * @param {Event} event - Form submit event
     */
    async submit(event) {
        if (typeof handleCertificateSubmit === 'function') {
            await handleCertificateSubmit(event);
        }
    },

    /**
     * Change certificate status
     * @param {string} id - Certificate ID
     * @param {string} newStatus - New status (used, revoked, blocked, active)
     */
    async updateStatus(id, newStatus) {
        if (typeof changeCertStatus === 'function') {
            await changeCertStatus(id, newStatus);
        }
    },

    /**
     * Show certificate details
     * @param {string} id - Certificate ID
     */
    async showDetail(id) {
        if (typeof showCertDetail === 'function') {
            await showCertDetail(id);
        }
    },

    /**
     * Delete certificate
     * @param {string} id - Certificate ID
     */
    async remove(id) {
        if (typeof deleteCertificate === 'function') {
            await deleteCertificate(id);
        }
    },

    /**
     * Generate and download certificate image
     * @param {string} certId - Certificate ID
     */
    async generateImage(certId) {
        if (typeof downloadCertificateImage === 'function') {
            await downloadCertificateImage(certId);
        }
    },

    /**
     * Trigger search with debounce (delegates to debounceCertSearch)
     */
    search() {
        if (typeof debounceCertSearch === 'function') {
            debounceCertSearch();
        }
    },

    /**
     * Copy certificate code to clipboard
     * @param {string} code - Certificate code
     */
    copyCode(code) {
        if (typeof copyCertCode === 'function') {
            copyCertCode(code);
        }
    }
};
