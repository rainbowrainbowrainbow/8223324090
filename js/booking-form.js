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
        const fields = ['bookingHasEventToggle', 'roomSelect', 'selectedProgram', 'bookingNotes', 'bookingGroupName',
            'costumeSelect', 'kidsCountInput', 'customerName', 'customerPhone',
            'educationLessonTitle', 'educationLessonTeacher', 'educationLessonGroup',
            'educationLessonCourse', 'educationLessonSeriesSize', 'educationLessonRepeatEvery', 'educationLessonType',
            'pinataMode', 'pinataNumber', 'pinataFillerNumber', 'pinataFillerSelect',
            'clientPinataServicePrice', 'clientPinataServiceNote', 'bookingMenuProductSelect',
            'bookingMenuQuantity', 'bookingMenuUnitPrice', 'bookingMenuNote', 'banquetMenu',
            'banquetGuests', 'banquetAdults', 'banquetTables', 'bookingLeadSource', 'bookingLeadStatus',
            'bookingLeadInterestDate', 'bookingLeadBudget', 'bookingLeadChildrenInfo', 'bookingLeadNotes',
            'maysternyaSlotCloseDuration'];
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
        if (typeof getSmartBookingValidationState === 'function') {
            const validation = getSmartBookingValidationState();
            return {
                valid: validation.valid,
                error: validation.error,
                errors: validation.errors || [],
                issues: validation.issues || [],
                invalidFields: validation.invalidFields || [],
                warnings: validation.warnings || []
            };
        }
        const formData = typeof getBookingFormData === 'function' ? getBookingFormData() : null;
        const hasEvent = !!formData?.hasEvent;
        const programId = formData?.programId || '';
        const room = formData?.room || '';
        const isMaysternya = typeof isMaysternyaBookingContext === 'function' && isMaysternyaBookingContext();
        const presentation = window.TimelineBusinessContext?.presentation?.() || { mode: 'park' };
        const isNonParkTimelineMode = presentation.mode && presentation.mode !== 'park';
        const isMaysternyaSimple = isMaysternya && presentation.mode === 'simple';
        const isEducation = presentation.mode === 'education';
        const lessonTitle = document.getElementById('educationLessonTitle')?.value?.trim() || '';
        const roomOptional = Boolean(presentation.defaultBookingRoom)
            || isMaysternyaSimple
            || presentation.mode === 'simple'
            || presentation.mode === 'specialist'
            || presentation.resourceModel === 'online'
            || presentation.resourceType === 'online';

        if (!room) {
            if (!roomOptional) {
                document.getElementById('roomSelect')?.setAttribute('aria-invalid', 'true');
                return { valid: false, error: presentation.mode === 'education' ? 'Оберіть кабінет' : 'Оберіть кімнату' };
            }
        }
        if (hasEvent && !programId) {
            if (!(isEducation && lessonTitle)) {
                document.getElementById('selectedProgram')?.setAttribute('aria-invalid', 'true');
                const error = isMaysternyaSimple
                    ? 'Оберіть тип консультації'
                    : (presentation.mode === 'education' ? 'Оберіть заняття' : presentation.mode === 'park' ? 'Оберіть програму' : 'Оберіть послугу');
                return { valid: false, error };
            }
        }

        const program = hasEvent ? getProductsSync().find(p => p.id === programId) : null;
        if (hasEvent && !program && !(isEducation && lessonTitle)) return { valid: false, error: 'Програму не знайдено' };

        if (isMaysternyaSimple || isNonParkTimelineMode) {
            return { valid: true };
        }

        const pinataMode = document.getElementById('pinataMode')?.value || 'none';
        if (hasEvent && program.hasFiller && pinataMode === 'park') {
            const filler = document.getElementById('pinataFillerSelect')?.value;
            if (!filler) return { valid: false, error: 'Оберіть наповнювач для піньяти' };
        }

        if (hasEvent && program.hosts > 1) {
            const secondAnimator = document.getElementById('secondAnimatorSelect')?.value;
            if (!secondAnimator) return { valid: false, error: 'Оберіть другого аніматора — ця програма потребує 2 ведучих' };
        }

        const selectedCustomerId = document.getElementById('selectedCustomerId')?.value;
        const customerName = document.getElementById('customerName')?.value?.trim();
        if (hasEvent && !selectedCustomerId && !customerName) {
            document.getElementById('customerName')?.setAttribute('aria-invalid', 'true');
            return { valid: false, error: "Вкажіть клієнта або оберіть існуючу картку" };
        }

        if (!hasEvent) {
            const hasCustomerIdentity = !!(selectedCustomerId || customerName
                || document.getElementById('customerPhone')?.value?.trim()
                || document.getElementById('customerInstagram')?.value?.trim());
            const hasLeadDetails = typeof hasBookingLeadDetails === 'function' && hasBookingLeadDetails();
            const hasKitchen = (formData?.menuPositions || []).length > 0 || !!document.getElementById('banquetMenu')?.value?.trim();
            const hasCoreNotes = !!(document.getElementById('bookingGroupName')?.value?.trim()
                || document.getElementById('bookingNotes')?.value?.trim());
            if (!hasCustomerIdentity && !hasLeadDetails && !hasKitchen && !hasCoreNotes) {
                document.getElementById('customerName')?.setAttribute('aria-invalid', 'true');
                return { valid: false, error: 'Додайте клієнта, лід-деталі, нотатку або кухонну позицію' };
            }
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

        // v33.3: Reset tags and payment method
        document.querySelectorAll('.booking-tag-option.active').forEach(t => t.classList.remove('active'));
        const pmSel = document.getElementById('bookingPaymentMethod');
        if (pmSel) pmSel.value = '';

        const groupInput = document.getElementById('bookingGroupName');
        if (groupInput) groupInput.value = '';

        if (typeof setSelectedActivityPrograms === 'function') {
            setSelectedActivityPrograms([], { renderSummary: false, renderPackage: false, markDirty: false });
        }
        if (typeof resetSelectedActivityScheduleState === 'function') {
            resetSelectedActivityScheduleState();
        }
        document.querySelectorAll('.program-icon').forEach(i => {
            i.classList.remove('selected', 'is-primary-activity');
            i.setAttribute('aria-pressed', 'false');
        });

        const programSearch = document.getElementById('programSearch');
        if (programSearch) {
            programSearch.value = '';
            if (typeof filterPrograms === 'function') filterPrograms();
        }

        if (typeof renderSelectedProgramSummary === 'function') renderSelectedProgramSummary(null);
        document.getElementById('hostsWarning')?.classList.add('hidden');
        document.getElementById('customProgramSection')?.classList.add('hidden');
        document.getElementById('secondAnimatorSection')?.classList.add('hidden');
        if (typeof resetPinataModeFields === 'function') {
            resetPinataModeFields();
        } else {
            document.getElementById('pinataModeSection')?.classList.add('hidden');
            document.getElementById('pinataSharedFields')?.classList.add('hidden');
            document.getElementById('pinataFillerSection')?.classList.add('hidden');
            document.getElementById('clientPinataServiceFields')?.classList.add('hidden');
        }
        if (typeof setBookingWorkspaceHasEvent === 'function') setBookingWorkspaceHasEvent(false, { markDirty: false });

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
        if (typeof resetEducationLessonFields === 'function') resetEducationLessonFields();

        // v15.1: Reset CRM customer fields
        const customerToggle = document.getElementById('customerDataToggle');
        if (customerToggle) customerToggle.checked = true;
        document.getElementById('customerDataSection')?.classList.remove('hidden');
        if (typeof clearCustomerFields === 'function') clearCustomerFields();
        if (typeof resetBookingLeadDetails === 'function') resetBookingLeadDetails();
        if (typeof resetBookingPackageWorkspace === 'function') resetBookingPackageWorkspace();
    }
};

// ==========================================
// v30.3: BOOKING TEMPLATES
// ==========================================

(function() {
    let _templates = [];

    function bookingTemplateAuthHeaders(withContentType = false) {
        return typeof getAuthHeaders === 'function' ? getAuthHeaders(withContentType) : {};
    }

    async function loadTemplates() {
        try {
            const res = await fetch('/api/booking-templates', {
                headers: bookingTemplateAuthHeaders(false)
            });
            if (!res.ok) return;
            _templates = await res.json();
            renderTemplateDropdown();
        } catch (e) { /* ignore */ }
    }

    function renderTemplateDropdown() {
        const sel = document.getElementById('templateSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Завантажити шаблон...</option>';
        _templates.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.isFavorite ? '⭐ ' : ''}${t.name}${t.productName ? ' — ' + t.productName : ''}`;
            sel.appendChild(opt);
        });
    }

    function applyTemplate(templateId) {
        const t = _templates.find(x => x.id === parseInt(templateId));
        if (!t) return;

        // Fill form fields
        if (t.room) {
            const roomSel = document.getElementById('roomSelect');
            if (roomSel) {
                const option = Array.from(roomSel.options || []).find(item =>
                    (t.roomResourceId && item.dataset.resourceId === t.roomResourceId)
                    || item.value === t.room
                );
                roomSel.value = option?.value || '';
            }
        }
        if (t.productId) {
            const progSel = document.getElementById('selectedProgram');
            if (progSel) {
                progSel.value = t.productId;
                progSel.dispatchEvent(new Event('change'));
            }
            // Click program icon if available
            const icon = document.querySelector(`.program-icon[data-id="${t.productId}"]`);
            if (icon) icon.click();
        }
        if (t.kidsCount) {
            const ki = document.getElementById('kidsCountInput');
            if (ki) ki.value = t.kidsCount;
            const ks = document.getElementById('kidsCountSection');
            if (ks) ks.classList.remove('hidden');
        }
        if (t.costume) {
            const cs = document.getElementById('costumeSelect');
            if (cs) cs.value = t.costume;
        }
        if (t.notes) {
            const n = document.getElementById('bookingNotes');
            if (n) n.value = t.notes;
        }

        // Increment usage count
        fetch(`/api/booking-templates/${t.id}/use`, {
            method: 'POST',
            headers: bookingTemplateAuthHeaders(false)
        }).catch(() => {});

        if (typeof showNotification === 'function') {
            showNotification(`Шаблон "${t.name}" завантажено`, 'success');
        }
    }

    let _savingTemplate = false;
    async function saveTemplate() {
        if (_savingTemplate) return;
        const formData = BookingForm.getFormData ? BookingForm.getFormData() : null;
        const programSel = document.getElementById('selectedProgram');
        const roomSel = document.getElementById('roomSelect');

        const name = await promptModal('Назва шаблону:', { placeholder: 'Наприклад: День народження стандарт' });
        if (!name || !name.trim()) return;
        if (_savingTemplate) return;
        _savingTemplate = true;
        const saveBtn = document.getElementById('saveTemplateBtn');
        if (saveBtn) saveBtn.disabled = true;

        const body = {
            name: name.trim(),
            productId: programSel?.value || null,
            room: roomSel?.value || null,
            roomResourceId: roomSel?.selectedOptions?.[0]?.dataset?.resourceId || null,
            kidsCount: document.getElementById('kidsCountInput')?.value || null,
            costume: document.getElementById('costumeSelect')?.value || null,
            notes: document.getElementById('bookingNotes')?.value || null
        };

        // Get product details if selected
        if (body.productId && typeof getProductsSync === 'function') {
            const prods = getProductsSync();
            const p = prods.find(x => String(x.id) === String(body.productId));
            if (p) {
                body.productCode = p.code;
                body.productName = p.name;
                body.category = p.category;
                body.duration = p.duration;
                body.price = p.price;
                body.hosts = p.hosts;
            }
        }

        try {
            const res = await fetch('/api/booking-templates', {
                method: 'POST',
                headers: bookingTemplateAuthHeaders(true),
                body: JSON.stringify(body)
            });
            if (res.ok) {
                if (typeof showNotification === 'function') {
                    showNotification(`Шаблон "${name}" збережено`, 'success');
                }
                await loadTemplates();
            }
        } catch (e) {
            if (typeof showNotification === 'function') {
                showNotification('Помилка збереження шаблону', 'error');
            }
        } finally {
            _savingTemplate = false;
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const sel = document.getElementById('templateSelect');
        if (sel) sel.addEventListener('change', (e) => {
            if (e.target.value) applyTemplate(e.target.value);
            e.target.value = ''; // Reset dropdown
        });

        const saveBtn = document.getElementById('saveTemplateBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveTemplate);

        // Load templates when panel opens
        const panel = document.getElementById('bookingPanel');
        if (panel) {
            const observer = new MutationObserver(() => {
                if (!panel.classList.contains('hidden')) loadTemplates();
            });
            observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
        }
    });

    window.BookingTemplates = { load: loadTemplates, save: saveTemplate };
})();
