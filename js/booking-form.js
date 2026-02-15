/**
 * booking-form.js - Booking form validation, data preparation, and reset
 * Load after booking.js in index.html
 *
 * Provides: window.BookingForm = { validate, prepare, reset, getFormData }
 */

window.BookingForm = {
    /**
     * Validate booking form fields before submission
     * @returns {{ valid: boolean, error?: string }}
     */
    validate() {
        const programId = document.getElementById('selectedProgram')?.value;
        const room = document.getElementById('roomSelect')?.value;

        if (!programId) return { valid: false, error: 'Оберіть програму' };
        if (!room) return { valid: false, error: 'Оберіть кімнату' };

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

        const kidsCountSection = document.getElementById('kidsCountSection');
        if (kidsCountSection) kidsCountSection.classList.add('hidden');
        const kidsCountInput = document.getElementById('kidsCountInput');
        if (kidsCountInput) kidsCountInput.value = '';
    }
};
