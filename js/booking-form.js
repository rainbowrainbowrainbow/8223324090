/**
 * booking-form.js - Booking form validation, data preparation, and reset
 * Load after booking.js in index.html
 *
 * Provides: window.BookingForm = { validate, prepare, reset, getFormData }
 */

window.BookingForm = {
    _dirty: false,

    /**
     * v20.11.0: Initialize form validation listeners
     */
    init() {
        const fields = ['roomSelect', 'selectedProgram', 'bookingNotes', 'bookingGroupName',
            'costumeSelect', 'kidsCountInput', 'customerName', 'customerPhone'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => { BookingForm._dirty = true; });
                el.addEventListener('input', () => { BookingForm._dirty = true; });
            }
        });

        // v20.11.0: Unsaved changes warning
        window.addEventListener('beforeunload', (e) => {
            if (BookingForm._dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    },

    isDirty() { return this._dirty; },
    markClean() {
        this._dirty = false;
        // Clear aria-invalid from all fields
        document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
            el.setAttribute('aria-invalid', 'false');
        });
    },

    /**
     * v20.11.0: Validate single field on blur
     */
    validateField(fieldId) {
        const el = document.getElementById(fieldId);
        if (!el) return;
        const isEmpty = !el.value;
        const isRequired = el.hasAttribute('aria-required');
        if (isRequired && isEmpty) {
            el.setAttribute('aria-invalid', 'true');
        } else {
            el.setAttribute('aria-invalid', 'false');
        }
    },

    /**
     * Validate booking form fields before submission
     * @returns {{ valid: boolean, error?: string }}
     */
    validate() {
        const programId = document.getElementById('selectedProgram')?.value;
        const room = document.getElementById('roomSelect')?.value;

        if (!programId) {
            document.getElementById('selectedProgram')?.setAttribute('aria-invalid', 'true');
            return { valid: false, error: 'Оберіть програму' };
        }
        if (!room) {
            document.getElementById('roomSelect')?.setAttribute('aria-invalid', 'true');
            return { valid: false, error: 'Оберіть кімнату' };
        }

        const program = getProductsSync().find(p => p.id === programId);
        if (!program) return { valid: false, error: 'Програму не знайдено' };

        if (program.hasFiller) {
            const filler = document.getElementById('pinataFillerSelect')?.value;
            if (!filler) return { valid: false, error: 'Оберіть наповнювач для піньяти' };
        }

        if (program.hosts > 1) {
            const secondAnimator = document.getElementById('secondAnimatorSelect')?.value;
            if (!secondAnimator) return { valid: false, error: 'Оберіть другого аніматора — ця програма потребує 2 ведучих' };
        }

        // v15.1: CRM — validate customer name if toggle is on
        const customerToggle = document.getElementById('customerDataToggle');
        if (customerToggle && customerToggle.checked) {
            const customerName = document.getElementById('customerName')?.value?.trim();
            if (!customerName) return { valid: false, error: "Вкажіть ім'я клієнта або вимкніть розділ «Дані клієнта»" };
        }

        return { valid: true };
    },

    /**
     * Get current form data (delegates to getBookingFormData)
     */
    getFormData() {
        return typeof getBookingFormData === 'function' ? getBookingFormData() : null;
    },

    /**
     * Prepare booking object from form data (delegates to buildBookingObject)
     */
    prepare(formData, program) {
        return typeof buildBookingObject === 'function' ? buildBookingObject(formData, program) : null;
    },

    /**
     * Reset booking form to initial state
     */
    reset() {
        document.getElementById('roomSelect').value = '';
        document.getElementById('selectedProgram').value = '';
        document.getElementById('bookingNotes').value = '';

        const groupInput = document.getElementById('bookingGroupName');
        if (groupInput) groupInput.value = '';

        document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));

        const programSearch = document.getElementById('programSearch');
        if (programSearch) {
            programSearch.value = '';
            if (typeof filterPrograms === 'function') filterPrograms();
        }

        document.getElementById('programDetails')?.classList.add('hidden');
        document.getElementById('hostsWarning')?.classList.add('hidden');
        document.getElementById('customProgramSection')?.classList.add('hidden');
        document.getElementById('secondAnimatorSection')?.classList.add('hidden');
        document.getElementById('pinataFillerSection')?.classList.add('hidden');

        const extraHostToggle = document.getElementById('extraHostToggle');
        if (extraHostToggle) {
            extraHostToggle.checked = false;
            document.getElementById('extraHostAnimatorSection')?.classList.add('hidden');
        }

        const costumeSelect = document.getElementById('costumeSelect');
        if (costumeSelect) costumeSelect.value = '';

        const statusRadio = document.querySelector('input[name="bookingStatus"][value="confirmed"]');
        if (statusRadio) statusRadio.checked = true;

        const skipNotif = document.getElementById('skipNotificationToggle');
        if (skipNotif) skipNotif.checked = false;

        const kidsCountSection = document.getElementById('kidsCountSection');
        if (kidsCountSection) kidsCountSection.classList.add('hidden');
        const kidsCountInput = document.getElementById('kidsCountInput');
        if (kidsCountInput) kidsCountInput.value = '';

        // v15.1: Reset CRM customer fields
        const customerToggle = document.getElementById('customerDataToggle');
        if (customerToggle) customerToggle.checked = false;
        document.getElementById('customerDataSection')?.classList.add('hidden');
        if (typeof clearCustomerFields === 'function') clearCustomerFields();
    }
};
