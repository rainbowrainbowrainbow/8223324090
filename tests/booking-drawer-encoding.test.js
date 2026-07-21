const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const escapedAssetVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = value => JSON.parse(JSON.stringify(value));

const mojibakeMarkers = [
    'Рџ', 'РЎ', 'Рќ', 'Рљ', 'Рђ', 'Р†', 'Р ', 'Р‘', 'Р’', 'Р“', 'Р”', 'Р—', 'Рњ', 'Р©',
    'СЏ', 'С–', 'СЋ', 'СЊ', 'С‡', 'С€',
    'вЂ', 'вњ', 'рџ', 'В·'
];

function assertCleanEncoding(surfaceName, content) {
    const found = mojibakeMarkers.filter(marker => content.includes(marker));
    assert.deepEqual(found, [], `${surfaceName} contains mojibake markers: ${found.join(', ')}`);
}

test('booking drawer frontend sources do not contain mojibake markers', () => {
    assertCleanEncoding('js/booking.js', read('js', 'booking.js'));
    assertCleanEncoding('js/booking-form.js', read('js', 'booking-form.js'));

    const html = read('index.html');
    const start = html.indexOf('<aside id="bookingPanel"');
    const end = html.indexOf('</aside>', start);
    assert.ok(start >= 0, 'booking panel markup exists');
    assert.ok(end > start, 'booking panel slice end exists');
    assertCleanEncoding('index.html booking panel', html.slice(start, end + '</aside>'.length));
});

test('booking create payload supports existing and new customer flows', () => {
    const bookingJs = read('js', 'booking.js');

    const helperStart = bookingJs.indexOf('function bookingCustomerDraftFromForm');
    const helperEnd = bookingJs.indexOf('function getSmartBookingValidationState', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'customer payload helper block exists');
    const helperBlock = bookingJs.slice(helperStart, helperEnd);
    assert.match(helperBlock, /search: document\.getElementById\('customerSearch'\)\?\.value\?\.trim\(\) \|\| ''/);
    assert.match(helperBlock, /name: document\.getElementById\('customerName'\)\?\.value\?\.trim\(\) \|\| ''/);
    assert.match(helperBlock, /function bookingNewCustomerDraftIsValid\(draft = bookingCustomerDraftFromForm\(\)\)/);
    assert.match(helperBlock, /return Boolean\(String\(draft\?\.name \|\| ''\)\.trim\(\)\);/);
    assert.match(helperBlock, /if \(draft\.phone\) customer\.phone = draft\.phone;/);
    assert.match(helperBlock, /if \(draft\.instagram\) customer\.instagram = draft\.instagram;/);
    assert.match(helperBlock, /if \(draft\.childName\) customer\.childName = draft\.childName;/);
    assert.match(helperBlock, /if \(draft\.childBirthday\) customer\.childBirthday = draft\.childBirthday;/);
    assert.match(helperBlock, /if \(draft\.source\) customer\.source = draft\.source;/);

    const validationStart = bookingJs.indexOf('function getSmartBookingValidationState');
    const validationEnd = bookingJs.indexOf('function formatBookingValidationList', validationStart);
    assert.ok(validationStart >= 0 && validationEnd > validationStart, 'customer validation block exists');
    const validationBlock = bookingJs.slice(validationStart, validationEnd);
    assert.match(validationBlock, /const hasSelectedCustomer = Boolean\(document\.getElementById\('selectedCustomerId'\)\?\.value\);/);
    assert.match(validationBlock, /const customerDraft = bookingCustomerDraftFromForm\(\);/);
    assert.match(validationBlock, /const hasNewCustomer = !hasSelectedCustomer\s*&& BookingDrawerState\.clientMode === 'new'\s*&& bookingNewCustomerDraftIsValid\(customerDraft\);/);
    assert.match(validationBlock, /const hasClient = hasSelectedCustomer \|\| hasNewCustomer;/);
    assert.match(validationBlock, /const hasSearchOnly = Boolean\(customerDraft\.search && !customerDraft\.name\);/);
    assert.ok(
        /invalidFields\.push\(hasSearchOnly \? 'customerName' : 'customerSearch'\);/.test(validationBlock)
        || /addBookingValidationIssue\(state, 'client',[\s\S]*\[hasSearchOnly \? 'customerName' : 'customerSearch'\]\);/.test(validationBlock),
        'customer validation marks search-only and empty client fields'
    );

    const payloadStart = bookingJs.indexOf('function buildBookingObject');
    const payloadEnd = bookingJs.indexOf('function shouldCreateEducationLessonSeries', payloadStart);
    assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'booking payload block exists');
    const payloadBlock = bookingJs.slice(payloadStart, payloadEnd);
    assert.match(payloadBlock, /const existingId = document\.getElementById\('selectedCustomerId'\)\?\.value;/);
    assert.match(payloadBlock, /if \(existingId\) \{[\s\S]*obj\.customerId = parseInt\(existingId, 10\);[\s\S]*\} else if \(BookingDrawerState\.clientMode === 'new'\) \{[\s\S]*const customer = bookingCustomerPayloadFromDraft\(\);[\s\S]*if \(customer\) obj\.customer = customer;[\s\S]*\}/);
});

test('booking customer validation and payload distinguish existing, new, search-only, and empty states', () => {
    const bookingJs = read('js', 'booking.js');
    const helperStart = bookingJs.indexOf('function bookingCustomerDraftFromForm');
    const validationStart = bookingJs.indexOf('function getSmartBookingValidationState', helperStart);
    const validationEnd = bookingJs.indexOf('function formatBookingValidationList', validationStart);
    assert.ok(helperStart >= 0 && validationStart > helperStart && validationEnd > validationStart, 'customer validation helper slice exists');

    const fields = new Map();
    const ensureField = id => {
        if (!fields.has(id)) fields.set(id, { value: '' });
        return fields.get(id);
    };
    [
        'selectedCustomerId',
        'customerSearch',
        'customerName',
        'customerPhone',
        'customerInstagram',
        'customerChildName',
        'customerChildBirthday',
        'customerSource',
        'educationLessonTitle'
    ].forEach(ensureField);

    const context = {
        document: { getElementById: id => ensureField(id) },
        window: {
            TimelineBusinessContext: {
                presentation: () => ({ mode: 'park' })
            }
        },
        AppState: { selectedDate: '2099-02-10' },
        BookingDrawerState: { clientMode: 'search' },
        getBookingFormData: () => ({ time: '12:00', room: 'Room A', programId: 'bubble' }),
        bookingBoundaryWarningsForFormData: () => [],
        isOptionalTimelineRoomBookingMode: () => false,
        getBookingWorkspaceHasEvent: () => true
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(helperStart, validationEnd)}
        this.__bookingCustomerHooks = {
            bookingCustomerPayloadFromDraft,
            getSmartBookingValidationState
        };
    `, context, { filename: 'js/booking.js' });

    const setFields = values => {
        for (const field of fields.values()) field.value = '';
        for (const [id, value] of Object.entries(values)) ensureField(id).value = value;
    };
    const hooks = context.__bookingCustomerHooks;

    setFields({ selectedCustomerId: '42' });
    context.BookingDrawerState.clientMode = 'existing';
    assert.equal(hooks.getSmartBookingValidationState().canSubmit, true, 'selected existing customer is valid');
    assert.equal(hooks.bookingCustomerPayloadFromDraft(), null, 'empty draft does not create a customer payload');

    setFields({
        customerSearch: 'Test Customer',
        customerName: 'Test Customer',
        customerPhone: '+380000000000',
        customerInstagram: 'test_customer',
        customerChildName: 'Test Child',
        customerChildBirthday: '2099-01-02',
        customerSource: 'instagram'
    });
    context.BookingDrawerState.clientMode = 'new';
    assert.equal(hooks.getSmartBookingValidationState().canSubmit, true, 'new customer with a name is valid');
    assert.deepEqual(plain(hooks.bookingCustomerPayloadFromDraft()), {
        name: 'Test Customer',
        phone: '+380000000000',
        instagram: 'test_customer',
        childName: 'Test Child',
        childBirthday: '2099-01-02',
        source: 'instagram'
    });

    setFields({ customerSearch: 'Typed search text' });
    context.BookingDrawerState.clientMode = 'search';
    const searchOnly = hooks.getSmartBookingValidationState();
    assert.equal(searchOnly.canSubmit, false, 'search-only text is not enough to create a customer');
    assert.deepEqual(plain(searchOnly.invalidFields), ['customerName']);
    assert.equal(hooks.bookingCustomerPayloadFromDraft(), null);

    setFields({});
    context.BookingDrawerState.clientMode = 'search';
    const empty = hooks.getSmartBookingValidationState();
    assert.equal(empty.canSubmit, false, 'empty customer state is invalid');
    assert.deepEqual(plain(empty.invalidFields), ['customerSearch']);
    assert.equal(hooks.bookingCustomerPayloadFromDraft(), null);
});

test('selected customer card renders manager context without mutating booking notes', () => {
    const bookingJs = read('js', 'booking.js');
    const renderStart = bookingJs.indexOf('function bookingCustomerCleanText');
    const renderEnd = bookingJs.indexOf('function renderBookingCustomerSearchState', renderStart);
    assert.ok(renderStart >= 0 && renderEnd > renderStart, 'selected customer render helper slice exists');

    const card = {
        innerHTML: '',
        classList: {
            added: [],
            removed: [],
            add(value) { this.added.push(value); },
            remove(value) { this.removed.push(value); }
        }
    };
    const customerSection = {
        classList: {
            added: [],
            removed: [],
            add(value) { this.added.push(value); },
            remove(value) { this.removed.push(value); }
        }
    };
    const context = {
        document: {
            getElementById: id => {
                if (id === 'bookingSelectedCustomerCard') return card;
                if (id === 'customerDataSection') return customerSection;
                return null;
            }
        },
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(renderStart, renderEnd)}
        this.__selectedCustomerCardHooks = { renderSelectedCustomerCard };
    `, context, { filename: 'js/booking.js' });

    context.__selectedCustomerCardHooks.renderSelectedCustomerCard({
        name: 'Client <X>',
        phone: '+380000000000',
        instagram: '@ice',
        notes: 'allergy <nuts>',
        totalBookings: 22,
        children: [
            { name: 'Bohdan', ageSnapshot: 6, note: 'без горіхів <alert>', dietaryTags: ['nuts', 'lactose'], dietaryNote: 'no dairy <milk>' },
            { name: 'Sofia', birthday: '2020-03-04', note: 'посадити поруч з мамою' }
        ]
    });

    assert.match(card.innerHTML, /booking-selected-customer__header/);
    assert.match(card.innerHTML, /Client &lt;X&gt;/);
    assert.match(card.innerHTML, /22 візити/);
    assert.match(card.innerHTML, /Важливо для кухні/);
    assert.match(card.innerHTML, /booking-selected-customer__kitchen-row is-priority/);
    assert.match(card.innerHTML, /Примітки клієнта/);
    assert.match(card.innerHTML, /allergy &lt;nuts&gt;/);
    assert.match(card.innerHTML, /Bohdan · 6 р\./);
    assert.match(card.innerHTML, /booking-selected-customer__dietary-tag/);
    assert.match(card.innerHTML, /no dairy &lt;milk&gt;/);
    assert.match(card.innerHTML, /без горіхів &lt;alert&gt;/);
    assert.match(card.innerHTML, /посадити поруч з мамою/);
    assert.doesNotMatch(card.innerHTML, /<alert>|<nuts>|<X>/);
    assert.doesNotMatch(card.innerHTML, /bookingMenuNote|bookingNotes|data-menu|data-booking-kitchen-context-add|data-booking-note-toggle/);
    assert.deepEqual(card.classList.removed, ['hidden']);
    assert.deepEqual(customerSection.classList.added, ['has-selected-customer']);

    context.__selectedCustomerCardHooks.renderSelectedCustomerCard({ name: 'No Kids' });
    assert.match(card.innerHTML, /Діти не вказані/);
    assert.doesNotMatch(card.innerHTML, /bookingNotes/);

    context.__selectedCustomerCardHooks.renderSelectedCustomerCard(null);
    assert.deepEqual(customerSection.classList.removed, ['has-selected-customer']);
});

test('selected customer kitchen action appends child notes only after explicit click', () => {
    const bookingJs = read('js', 'booking.js');
    const renderStart = bookingJs.indexOf('function bookingCustomerCleanText');
    const renderEnd = bookingJs.indexOf('function renderBookingCustomerSearchState', renderStart);
    assert.ok(renderStart >= 0 && renderEnd > renderStart, 'selected customer render helper slice exists');

    const notesInput = {
        tagName: 'TEXTAREA',
        value: 'Попередній коментар',
        events: [],
        dispatchEvent(event) {
            this.events.push(event.type);
        }
    };
    const status = { textContent: '' };
    const button = {
        listeners: {},
        attributes: {},
        classNames: new Set(),
        classList: {
            toggle(value, enabled) {
                if (enabled) button.classNames.add(value);
                else button.classNames.delete(value);
            }
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        closest() {
            return {
                querySelector: () => status
            };
        },
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        }
    };
    const card = {
        innerHTML: '',
        classList: {
            add() {},
            remove() {}
        },
        querySelector(selector) {
            return selector === '[data-booking-kitchen-context-add]' && this.innerHTML.includes('data-booking-kitchen-context-add')
                ? button
                : null;
        }
    };
    const context = {
        document: {
            getElementById: id => {
                if (id === 'bookingSelectedCustomerCard') return card;
                if (id === 'bookingNotes') return notesInput;
                return null;
            }
        },
        Event: function Event(type, options = {}) {
            this.type = type;
            this.bubbles = Boolean(options.bubbles);
        },
        isBookingKitchenEnabled: () => true,
        renderBookingPackageSummary() {},
        updateBookingContextHeaderSummary() {},
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(renderStart, renderEnd)}
        this.__selectedCustomerKitchenHooks = {
            renderSelectedCustomerCard,
            bookingSelectedCustomerKitchenNoteBlock
        };
    `, context, { filename: 'js/booking.js' });

    const customer = {
        name: 'Kitchen Customer',
        children: [
            { name: 'Nut Child', note: 'nut allergy, no peanuts' },
            { name: 'Structured Child', dietaryTags: ['dairy'], dietaryNote: 'separate dairy-free plate' },
            { name: 'Seat Child', note: 'seat near mother' }
        ]
    };
    const expectedBlock = context.__selectedCustomerKitchenHooks.bookingSelectedCustomerKitchenNoteBlock(customer);
    assert.match(expectedBlock, /Structured Child/);
    assert.match(expectedBlock, /separate dairy-free plate/);

    context.__selectedCustomerKitchenHooks.renderSelectedCustomerCard(customer);
    assert.match(card.innerHTML, /data-booking-kitchen-context-add/);
    assert.match(card.innerHTML, /Додати в примітки кухні/);
    assert.equal(notesInput.value, 'Попередній коментар', 'render must not mutate booking notes');
    assert.equal(typeof button.listeners.click, 'function', 'kitchen add button listener is wired');

    button.listeners.click({ currentTarget: button });
    assert.equal(notesInput.value, `Попередній коментар\n\n${expectedBlock}`);
    assert.equal(status.textContent, 'Додано');
    assert.equal(button.attributes['aria-pressed'], 'true');
    assert.equal(button.classNames.has('is-added'), true);
    assert.deepEqual(notesInput.events, ['input', 'change']);

    button.listeners.click({ currentTarget: button });
    assert.equal(notesInput.value, `Попередній коментар\n\n${expectedBlock}`, 'second click must not duplicate notes');
    assert.deepEqual(notesInput.events, ['input', 'change'], 'duplicate click must not dispatch change events');
});

test('selected customer long notes expand inline with aria state', () => {
    const bookingJs = read('js', 'booking.js');
    const renderStart = bookingJs.indexOf('function bookingCustomerCleanText');
    const renderEnd = bookingJs.indexOf('function renderBookingCustomerSearchState', renderStart);
    assert.ok(renderStart >= 0 && renderEnd > renderStart, 'selected customer render helper slice exists');

    const noteClasses = new Set(['is-clamped']);
    const targetNote = {
        classList: {
            toggle(value, enabled) {
                if (enabled) noteClasses.add(value);
                else noteClasses.delete(value);
            }
        }
    };
    const toggleButton = {
        listeners: {},
        attributes: {
            'aria-controls': 'booking-selected-customer-note-customer',
            'aria-expanded': 'false'
        },
        dataset: {
            expandLabel: 'Показати повністю',
            collapseLabel: 'Згорнути'
        },
        textContent: 'Показати повністю',
        getAttribute(name) {
            return this.attributes[name] || '';
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        }
    };
    const card = {
        innerHTML: '',
        classList: {
            add() {},
            remove() {}
        },
        querySelector() {
            return null;
        },
        querySelectorAll(selector) {
            return selector === '[data-booking-note-toggle]' && this.innerHTML.includes('data-booking-note-toggle')
                ? [toggleButton]
                : [];
        }
    };
    const customerSection = {
        classList: {
            add() {},
            remove() {}
        }
    };
    const context = {
        document: {
            getElementById: id => {
                if (id === 'bookingSelectedCustomerCard') return card;
                if (id === 'customerDataSection') return customerSection;
                if (id === 'booking-selected-customer-note-customer') return targetNote;
                return null;
            }
        },
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(renderStart, renderEnd)}
        this.__selectedCustomerExpandHooks = { renderSelectedCustomerCard };
    `, context, { filename: 'js/booking.js' });

    const longCustomerNote = 'Попросили дуже детально врахувати сценарій зустрічі, посадку гостей, час виходу аніматора, контакт мами і кілька окремих побажань для команди.';
    const longChildNote = 'Дитина швидко втомлюється від шуму, просить не садити біля колонок, дати місце поруч з мамою і попередити кухню про чутливість до горіхів.';
    context.__selectedCustomerExpandHooks.renderSelectedCustomerCard({
        name: 'Long Notes',
        notes: longCustomerNote,
        children: [
            { name: 'Long Child', note: longChildNote },
            { name: 'Short Child', note: 'ок' }
        ]
    });

    const toggleCount = (card.innerHTML.match(/data-booking-note-toggle/g) || []).length;
    assert.equal(toggleCount, 2, 'only long customer and child notes get expand controls');
    assert.match(card.innerHTML, /aria-expanded="false"/);
    assert.match(card.innerHTML, /Показати повністю/);
    assert.match(card.innerHTML, /booking-selected-customer-note-customer/);
    assert.match(card.innerHTML, /booking-selected-customer-note-child-0/);
    assert.equal(typeof toggleButton.listeners.click, 'function', 'expand button listener is wired');

    toggleButton.listeners.click({ currentTarget: toggleButton });
    assert.equal(toggleButton.attributes['aria-expanded'], 'true');
    assert.equal(toggleButton.textContent, 'Згорнути');
    assert.equal(noteClasses.has('is-expanded'), true);
    assert.equal(noteClasses.has('is-clamped'), false);

    toggleButton.listeners.click({ currentTarget: toggleButton });
    assert.equal(toggleButton.attributes['aria-expanded'], 'false');
    assert.equal(toggleButton.textContent, 'Показати повністю');
    assert.equal(noteClasses.has('is-expanded'), false);
    assert.equal(noteClasses.has('is-clamped'), true);
});

test('created booking recovery rejects wrong timeline-view projections before cache merge', () => {
    const bookingJs = read('js', 'booking.js');
    const projectionStart = bookingJs.indexOf('function createdBookingTimelineProjection');
    const projectionEnd = bookingJs.indexOf('function createdBookingVisibilityMessage', projectionStart);
    assert.ok(projectionStart >= 0 && projectionEnd > projectionStart, 'created booking projection helper slice exists');

    let context;
    context = {
        currentTimelineView: 'rooms',
        window: {
            TimelineView: {
                current: () => context.currentTimelineView
            },
            TimelineBusinessContext: {
                state: () => ({ activeBusinessContext: 'event_genix' }),
                current: () => ({ apiValue: 'event_genix' })
            }
        },
        AppState: { selectedDate: '2099-02-10' },
        formatDate: value => String(value || '').slice(0, 10),
        normalizeBookingDateKey: value => String(value || '').slice(0, 10),
        timelineBookingResourceIdentity: booking => ({
            resourceId: booking.resourceId || booking.resource_id || booking.lineId || booking.line_id || booking.timelineProjection?.resourceId || ''
        })
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(projectionStart, projectionEnd)}
        this.__createdBookingProjectionHooks = {
            createdBookingProjectionMatchesCurrentSlice
        };
    `, context, { filename: 'js/booking.js' });

    const matches = booking => context.__createdBookingProjectionHooks.createdBookingProjectionMatchesCurrentSlice(booking, '2099-02-10');
    const baseBooking = {
        id: 'BK-2099-ROOM',
        date: '2099-02-10',
        resourceId: 'Room A',
        timelineProjection: {
            date: '2099-02-10',
            businessContext: 'event_genix',
            resourceId: 'Room A',
            visible: true
        }
    };

    assert.equal(matches({ ...baseBooking, timelineProjection: { ...baseBooking.timelineProjection, timelineView: 'rooms' } }), true);
    assert.equal(matches({ ...baseBooking, timelineProjection: { ...baseBooking.timelineProjection, timelineView: 'animators' } }), false);
    assert.equal(matches(baseBooking), true, 'legacy projections without timelineView keep old compatibility');
    assert.equal(matches({ ...baseBooking, date: '2099-02-11', timelineProjection: { ...baseBooking.timelineProjection, date: '2099-02-11', timelineView: 'rooms' } }), false);

    context.currentTimelineView = 'animators';
    assert.equal(matches({ ...baseBooking, timelineProjection: { ...baseBooking.timelineProjection, timelineView: 'animators' } }), true);
});

test('booking details can open from current visible timeline block when cache and id fetch miss', () => {
    const bookingJs = read('js', 'booking.js');
    const projectionStart = bookingJs.indexOf('function createdBookingTimelineProjection');
    const resolverEnd = bookingJs.indexOf('async function showBookingDetails', projectionStart);
    assert.ok(projectionStart >= 0 && resolverEnd > projectionStart, 'booking detail resolver helper slice exists');

    const context = {
        window: {
            TimelineView: {
                current: () => 'rooms'
            },
            TimelineBusinessContext: {
                state: () => ({ activeBusinessContext: 'event_genix' }),
                current: () => ({ apiValue: 'event_genix' })
            }
        },
        AppState: { selectedDate: '2099-02-10' },
        formatDate: value => String(value || '').slice(0, 10),
        normalizeBookingDateKey: value => String(value || '').slice(0, 10),
        timelineBookingResourceIdentity: booking => ({
            resourceId: booking.resourceId || booking.resource_id || booking.lineId || booking.line_id || booking.timelineProjection?.resourceId || ''
        }),
        timelineBookingMatchKeys: booking => new Set([
            booking.resourceId,
            booking.resource_id,
            booking.lineId,
            booking.line_id,
            booking.extraData?.timelineIdentity?.resourceName,
            booking.extra_data?.timeline_identity?.resource_name
        ].map(value => String(value || '').trim()).filter(Boolean)),
        getBookingsForDate: async () => [],
        apiGetBookingById: async () => ({ success: false, status: 404, error: 'Booking not found' })
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(projectionStart, resolverEnd)}
        this.__detailResolverHooks = {
            resolveBookingDetailsRecord,
            bookingDetailsFallbackMatchesCurrentSlice
        };
    `, context, { filename: 'js/booking.js' });

    const fallbackBooking = {
        id: 'BK-STANDALONE-ACTIVITY',
        date: '2099-02-10',
        businessContext: 'event_genix',
        resourceId: 'Room A',
        timelineProjection: {
            date: '2099-02-10',
            businessContext: 'event_genix',
            timelineView: 'rooms',
            resourceId: 'Room A',
            visible: true
        }
    };
    assert.equal(
        context.__detailResolverHooks.bookingDetailsFallbackMatchesCurrentSlice(fallbackBooking, 'BK-STANDALONE-ACTIVITY', '2099-02-10'),
        true
    );

    const metadataMatchedFallbackBooking = {
        id: 'BK-METADATA-ACTIVITY',
        date: '2099-02-10',
        businessContext: 'event_genix',
        extraData: {
            timelineIdentity: {
                resourceName: 'Animator 1'
            }
        }
    };
    assert.equal(
        context.__detailResolverHooks.bookingDetailsFallbackMatchesCurrentSlice(metadataMatchedFallbackBooking, 'BK-METADATA-ACTIVITY', '2099-02-10'),
        true,
        'visible blocks matched by timeline metadata can open when detail fetch misses'
    );
    assert.equal(
        context.__detailResolverHooks.bookingDetailsFallbackMatchesCurrentSlice({
            ...metadataMatchedFallbackBooking,
            timelineProjection: {
                date: '2099-02-10',
                businessContext: 'event_genix',
                timelineView: 'animators'
            }
        }, 'BK-METADATA-ACTIVITY', '2099-02-10'),
        false,
        'wrong-view fallback is still rejected'
    );

    return context.__detailResolverHooks.resolveBookingDetailsRecord('BK-STANDALONE-ACTIVITY', { fallbackBooking })
        .then(result => {
            assert.equal(result.source, 'visible-block-fallback');
            assert.equal(result.status, 404);
            assert.equal(result.booking.id, 'BK-STANDALONE-ACTIVITY');
            assert.deepEqual(plain(result.bookings.map(item => item.id)), ['BK-STANDALONE-ACTIVITY']);
        });
});

test('booking detail scenario row is hidden only for kitchen bookings', () => {
    const bookingJs = read('js', 'booking.js');
    const helperStart = bookingJs.indexOf('function shouldHideBookingWorkspaceScenarioDetail');
    const helperEnd = bookingJs.indexOf('function renderBookingWorkspaceDetail', helperStart);
    assert.ok(helperStart >= 0, 'kitchen scenario visibility helper exists');
    assert.ok(helperEnd > helperStart, 'helper block has a stable end');
    const helperBlock = bookingJs.slice(helperStart, helperEnd);
    assert.match(helperBlock, /scenario === 'kitchen_only'/);
    assert.match(helperBlock, /programCode === 'KITCHEN'/);
    assert.match(helperBlock, /programName === 'kitchen' \|\| programName === 'кухня'/);

    const renderEnd = bookingJs.indexOf('function initBookingPackageWorkspace', helperEnd);
    assert.ok(renderEnd > helperEnd, 'workspace detail block has a stable end');
    const renderBlock = bookingJs.slice(helperEnd, renderEnd);
    assert.match(renderBlock, /const activityScenarioLabel = bookingDetailActivityScenarioLabel\(booking, workspace\);/);
    assert.match(renderBlock, /const scenarioLabel = activityScenarioLabel \|\| meta\.label;/);
    assert.match(renderBlock, /const scenarioRowHtml = shouldHideBookingWorkspaceScenarioDetail\(booking\)\s*\?\s*''\s*:/);
    assert.match(renderBlock, /<span class="label">Сценарій:<\/span><span class="value">\$\{escapeHtml\(scenarioLabel\)\}<\/span>/);
    assert.match(renderBlock, /\$\{scenarioRowHtml\}/);
});

test('booking detail title removes redundant kitchen prefix only for kitchen bookings', () => {
    const bookingJs = read('js', 'booking.js');
    const helperStart = bookingJs.indexOf('function bookingDetailIsKitchenTitleToken');
    const helperEnd = bookingJs.indexOf('function renderBookingWorkspaceDetail', helperStart);
    assert.ok(helperStart >= 0, 'kitchen title token helper exists');
    assert.ok(helperEnd > helperStart, 'title helper block has a stable end');
    const helperBlock = bookingJs.slice(helperStart, helperEnd);
    assert.match(helperBlock, /text\.toUpperCase\(\) === 'KITCHEN' \|\| text\.toLowerCase\(\) === 'кухня'/);
    assert.match(helperBlock, /function bookingDetailModalTitle\(booking = \{\}, fallback = 'Бронювання'\)/);
    assert.match(helperBlock, /if \(shouldHideBookingWorkspaceScenarioDetail\(booking\)\)/);
    assert.match(helperBlock, /\[programName, label, booking\.room, booking\.id\]/);
    assert.match(helperBlock, /!bookingDetailIsKitchenTitleToken\(value\)/);
    assert.match(helperBlock, /return \[label \|\| programCode, programName\]\.filter\(Boolean\)\.join\(': '\) \|\| fallback;/);

    const modalStart = bookingJs.indexOf('async function showBookingDetails');
    const modalEnd = bookingJs.indexOf('const bookingChildrenCount', modalStart);
    assert.ok(modalStart >= 0 && modalEnd > modalStart, 'booking detail modal title block exists');
    const modalBlock = bookingJs.slice(modalStart, modalEnd);
    assert.match(modalBlock, /const bookingDetailTitle = bookingDetailModalTitle\(booking, roomFirstServiceBooking \? 'Кімнатна бронь' : 'Бронювання'\);/);
    assert.doesNotMatch(modalBlock, /const bookingDetailTitle = \[booking\.label \|\| booking\.programCode, booking\.programName\]/);
});

test('booking detail summary action is labeled banquet sheet without changing preview route', () => {
    const bookingJs = read('js', 'booking.js');
    const actionStart = bookingJs.indexOf('const editControls = isViewer()');
    const actionEnd = bookingJs.indexOf('const bookingDetailIdLabel', actionStart);
    assert.ok(actionStart >= 0 && actionEnd > actionStart, 'booking detail action block exists');
    const actionBlock = bookingJs.slice(actionStart, actionEnd);
    assert.match(actionBlock, /summaryPreviewHref/);
    assert.match(actionBlock, /class="booking-detail-action booking-detail-action--secondary booking-summary-action">Банкетний лист<\/a>/);
    assert.match(actionBlock, /booking-actions--legacy-replacement/);
    assert.match(actionBlock, /createLegacyBanquetReplacement/);
    assert.doesNotMatch(actionBlock, /booking-summary-action">Вижимка<\/a>/);
    assert.match(bookingJs, /function bookingSummaryPreviewUrl/);
    assert.match(bookingJs, /\/booking-summary\.html\?/);
});

test('booking detail keeps canonical stale-banquet deposit visible and blocks ordinary edit controls', () => {
    const bookingJs = read('js', 'booking.js');
    const depositStart = bookingJs.indexOf('async function loadBanquetDepositStatusForDetails');
    const depositEnd = bookingJs.indexOf('function bookingDetailBanquetArrival', depositStart);
    assert.ok(depositStart >= 0 && depositEnd > depositStart, 'deposit detail loader exists');
    const depositBlock = bookingJs.slice(depositStart, depositEnd);
    const canonicalIndex = depositBlock.indexOf('const canonicalProjection = banquetSnapshot?.deposit');
    const fallbackApiIndex = depositBlock.indexOf('apiGetBanquetDepositByGroup');
    assert.ok(canonicalIndex >= 0, 'canonical snapshot deposit is inspected');
    assert.ok(fallbackApiIndex > canonicalIndex, 'separate deposit API remains a fallback only');
    assert.match(
        depositBlock,
        /canonicalProjection[\s\S]*renderBanquetDepositStatusSection[\s\S]*return;/,
        'canonical deposit renders without being replaced by a second request'
    );

    const guardStart = bookingJs.indexOf('function banquetSnapshotEditIntegrityIssue');
    const guardEnd = bookingJs.indexOf('function renderLegacyBanquetEditIntegrityGuard', guardStart);
    assert.ok(guardStart >= 0 && guardEnd > guardStart, 'stale banquet edit guard exists');
    const guardBlock = bookingJs.slice(guardStart, guardEnd);
    assert.match(guardBlock, /groupStatus === 'active'/);
    assert.match(guardBlock, /primaryStatus === 'cancelled'/);
    assert.match(guardBlock, /incomplete_historical_banquet_record|INCOMPLETE_HISTORICAL_BANQUET_WARNING_CODE/);

    const actionStart = bookingJs.indexOf('const editControls = isViewer()');
    const actionEnd = bookingJs.indexOf('const bookingDetailIdLabel', actionStart);
    const actionBlock = bookingJs.slice(actionStart, actionEnd);
    assert.match(actionBlock, /banquetEditIntegrityIssue[\s\S]*createLegacyBanquetReplacement/);
    assert.match(actionBlock, /:\s*`[\s\S]*btn-edit-booking/);
});

test('booking drawer controls keep reliable hit targets and footer spacing', () => {
    const html = read('index.html');
    const bookingJs = read('js', 'booking.js');
    const appJs = read('js', 'app.js');
    const kitchenMenuImagesJs = read('js', 'kitchen-menu-images.js');
    const panelCss = read('css', 'panel.css');
    const responsiveCss = read('css', 'responsive.css');
    const panelStart = html.indexOf('<aside id="bookingPanel"');
    const panelEnd = html.indexOf('</aside>', panelStart);
    const bookingPanelHtml = panelStart >= 0 && panelEnd > panelStart
        ? html.slice(panelStart, panelEnd + '</aside>'.length)
        : html;

    [
        'bookingMenuAddBtn',
        'bookingMenuCatalogOpenBtn',
        'bookingMenuCatalogPanel',
        'bookingMenuCatalogSearch',
        'bookingMenuCatalogTabs',
        'bookingMenuCatalogList',
        'bookingMenuCatalogCart',
        'bookingMenuCatalogCartList',
        'bookingMenuInsightPanel',
        'bookingMenuInsightTitle',
        'bookingMenuInsightBody',
        'bookingMenuCatalogMobileCartBtn',
        'bookingSubmitBtn'
    ].forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists in booking drawer`));
    assert.match(html, /id="bookingMenuCatalogPanel" class="booking-menu-catalog-panel booking-menu-catalog-overlay hidden" hidden aria-hidden="true" role="dialog" aria-modal="true"/);
    assert.match(bookingPanelHtml, /id="bookingPanelEdgeClose" class="booking-panel-edge-close" type="button" title="[^"]+" aria-label="[^"]+" data-booking-panel-close/);
    assert.doesNotMatch(bookingPanelHtml, /booking-panel-edge-close-label/);
    assert.match(bookingPanelHtml, /id="closePanel" class="btn-close booking-panel-close" type="button" title="Закрити панель бронювання" aria-label="Закрити панель бронювання"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingMenuCatalogPanel/);
    assert.match(html, new RegExp(`js/kitchen-menu-images\\.js\\?v=${escapedAssetVersion}`));
    assert.ok(html.indexOf('js/kitchen-menu-images.js') < html.indexOf('js/config.js'), 'kitchen menu image manifest loads before config');
    assert.match(kitchenMenuImagesJs, /window\.KITCHEN_MENU_IMAGES/);
    assert.match(kitchenMenuImagesJs, /basePath:\s*'\/images\/kitchen-menu\/'/);
    assert.match(kitchenMenuImagesJs, /"menu_2026_021_item":\s*"products\/menu-998\.png"/);
    assert.match(kitchenMenuImagesJs, /"menu_2026_026_item":\s*"products\/menu-999\.png"/);
    assert.match(kitchenMenuImagesJs, /"menu_2026_064_item":\s*"products\/menu-997\.png"/);
    assert.match(kitchenMenuImagesJs, /"menu_2026_073_item":\s*"products\/menu-999\.png"/);
    assert.match(kitchenMenuImagesJs, /"MENU-026":\s*"products\/menu-026\.jpg"/);
    assert.match(kitchenMenuImagesJs, /"CAKE-06":\s*"products\/cake-06\.jpg"/);
    assert.doesNotMatch(kitchenMenuImagesJs, /"menu_2026_031_item"\s*:/);
    assert.doesNotMatch(kitchenMenuImagesJs, /"MENU-031"\s*:/);
    assert.doesNotMatch(kitchenMenuImagesJs, /products\/menu-031\.jpg/);
    assert.match(html, /id="bookingHasEventToggle" checked hidden aria-hidden="true"/);
    assert.match(html, /id="bookingKitchenToggle" hidden aria-hidden="true"/);
    assert.match(html, /id="bookingLeadDetailsToggle" hidden aria-hidden="true"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingModeSelector/);
    assert.doesNotMatch(bookingPanelHtml, /Що входить у бронювання/);
    assert.match(html, /bookingCreateCustomerBtn/);
    assert.match(html, /Знайдіть існуючу картку або створіть нового клієнта перед збереженням бронювання/);
    assert.match(bookingPanelHtml, /id="bookingCustomerContextPanel" class="booking-customer-context-panel"/);
    assert.match(bookingPanelHtml, /id="bookingSelectedCustomerCard" class="booking-selected-customer hidden"/);
    assert.ok(
        bookingPanelHtml.indexOf('id="customerDataSection"') < bookingPanelHtml.indexOf('id="bookingHasEventToggle"'),
        'customer context stays before scenario toggles'
    );
    assert.ok(
        bookingPanelHtml.indexOf('id="bookingCustomerContextPanel"') < bookingPanelHtml.indexOf('id="bookingEventFields"'),
        'customer context is not inside event-only fields'
    );
    assert.ok(
        bookingPanelHtml.indexOf('id="bookingCustomerContextPanel"') < bookingPanelHtml.indexOf('id="banquetFields"'),
        'customer context is not inside kitchen-only fields'
    );
    assert.match(html, /id="bookingPrimaryAnimatorSelect"/);

    assert.match(bookingJs, /const BOOKING_PROGRAM_ONLY_WORKSPACE = true/);
    assert.match(bookingJs, /if \(isRoomFirstTimelineView\(\)\) return false;/);
    assert.match(bookingJs, /return true;/);
    assert.match(bookingJs, /return isRoomFirstTimelineView\(\) && timelineKitchenEnabled\(\);/);
    assert.match(bookingJs, /function isBookingLeadDetailsEnabled\(\) \{\s*return false;/);
    assert.match(bookingJs, /ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(bookingJs, /const hasEvent = roomFirst \? false : true;/);
    assert.match(bookingJs, /eventFields\.hidden = roomFirst;/);
    assert.match(bookingJs, /prefillRoomFirstCustomerFromRoomLine/);
    assert.match(bookingJs, /openAnimationBookingInAnimatorView/);
    assert.match(bookingJs, /Оберіть програму події/);
    assert.doesNotMatch(bookingJs, /bookingHasEventToggle'\)\?\.addEventListener\('change'/);
    assert.doesNotMatch(bookingJs, /bookingKitchenToggle'\)\?\.addEventListener\('change'/);
    assert.doesNotMatch(bookingJs, /bookingLeadDetailsToggle'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingMenuAddBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /function initBookingMenuCatalogOpenControl/);
    assert.match(bookingJs, /menuCatalogOpenDelegatedBound/);
    assert.match(bookingJs, /closest\?\.\('#bookingMenuCatalogOpenBtn'\)/);
    assert.match(bookingJs, /addEventListener\('pointerdown'/);
    assert.match(bookingJs, /bookingMenuCatalogSearch'\)\?\.addEventListener\('input'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('keydown'/);
    assert.match(bookingJs, /bookingMenuCatalogMobileCartBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogCartCloseBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /data-menu-catalog-quantity-input/);
    assert.match(bookingJs, /data-menu-catalog-price-input/);
    assert.match(bookingJs, /data-menu-catalog-note-input/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_INSIGHT_MODES/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED = false/);
    assert.match(bookingJs, /data-menu-catalog-insight/);
    assert.match(bookingJs, /function bookingMenuCatalogPromptFor/);
    assert.match(bookingJs, /function renderBookingMenuCatalogInsight/);
    assert.match(bookingJs, /function generateBookingMenuCatalogInsightDraft/);
    assert.match(bookingJs, /function saveBookingMenuCatalogInsightDraft/);
    assert.match(bookingJs, /function approveBookingMenuCatalogInsightPrompt/);
    assert.match(bookingJs, /apiGenerateProductMenuAiDraft/);
    assert.match(bookingJs, /apiSaveProductMenuAiDraft/);
    assert.match(bookingJs, /data-menu-insight-generate/);
    assert.match(bookingJs, /data-menu-insight-save/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS/);
    assert.match(bookingJs, /section:pizza/);
    assert.match(bookingJs, /section:cake-decorations/);
    assert.match(bookingJs, /Оформлення торта/);
    assert.match(bookingJs, /aliases: \['оформлення торта', 'оформлення', 'декор', 'декор торта'\]/);
    assert.match(bookingJs, /Холодні закуски/);
    assert.match(bookingJs, /Холодні напої/);
    assert.doesNotMatch(bookingJs, /key:\s*'food'/);
    assert.doesNotMatch(bookingJs, /key:\s*'drink'/);
    assert.match(bookingJs, /function bookingMenuImageManifestUrl/);
    assert.match(bookingJs, /window\.KITCHEN_MENU_IMAGES/);
    assert.match(bookingJs, /bookingMenuCatalogHandleImageError/);
    assert.match(bookingJs, /upsertBookingMenuCatalogProduct/);
    assert.match(bookingJs, /renderBookingMenuCatalogCart/);
    assert.match(bookingJs, /setBookingMenuCatalogCartOpen/);
    assert.match(bookingJs, /isBookingMenuCatalogMobileCartLayout/);
    assert.match(bookingJs, /preferCart/);
    assert.match(bookingJs, /commitBookingMenuCatalogInlineInput/);
    assert.match(bookingJs, /document\.body\?\.classList\.toggle\('booking-menu-catalog-active', nextOpen\)/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /cart\.setAttribute\('inert'/);
    assert.match(bookingJs, /window\.addEventListener\('resize'/);
    assert.match(bookingJs, /event\.key !== 'Escape'/);
    assert.match(bookingJs, /document\.createElement\('button'\)/);
    assert.match(bookingJs, /icon\.type = 'button'/);
    assert.match(bookingJs, /aria-pressed/);
    assert.match(appJs, /document\.querySelectorAll\('\[data-booking-panel-close\]'\)/);

    assert.match(panelCss, /--booking-footer-space:\s*calc\(28px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(panelCss, /--booking-panel-width:\s*clamp\(560px,\s*44vw,\s*760px\)/);
    assert.match(panelCss, /scroll-padding-bottom:\s*var\(--booking-footer-space\)/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*position:\s*static;/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*width:\s*100%;/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*max-width:\s*none;/);
    assert.match(panelCss, /\.booking-summary-note--error/);
    assert.match(panelCss, /\.btn-submit\.btn-submit--needs-input/);
    assert.doesNotMatch(panelCss, /bottom:\s*calc\(0px - 18px\)/);
    assert.doesNotMatch(panelCss, /margin:\s*20px -24px -18px/);
    assert.doesNotMatch(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*position:\s*sticky;/);
    assert.doesNotMatch(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*calc\(var\(--booking-panel-pad-x\) \* -1\)/);
    assert.match(panelCss, /\.panel-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
    assert.match(panelCss, /\.booking-panel-close\s*\{[\s\S]*min-width:\s*44px;[\s\S]*border-radius:\s*999px;/);
    assert.match(panelCss, /\.booking-panel-edge-close\s*\{[\s\S]*position:\s*fixed;[\s\S]*right:\s*calc\(min\(var\(--booking-panel-width\),\s*100vw\) \+ 10px\);[\s\S]*width:\s*38px;[\s\S]*background:\s*#0f766e;[\s\S]*transform:\s*translateY\(0\);/);
    assert.match(responsiveCss, /\.booking-panel-close-label\s*\{\s*display:\s*none;\s*\}/);
    assert.match(responsiveCss, /\.booking-panel-edge-close\s*\{[\s\S]*right:\s*12px;[\s\S]*border-radius:\s*999px;[\s\S]*transform:\s*none;/);

    assert.match(panelCss, /\.btn-submit:disabled/);
    assert.match(panelCss, /\.booking-mode-card:focus-within/);
    assert.match(panelCss, /\.booking-menu-add-btn:focus-visible/);
    assert.match(panelCss, /\.booking-menu-catalog-panel/);
    assert.match(panelCss, /\.booking-menu-catalog-overlay/);
    assert.match(panelCss, /\.booking-menu-catalog-open\s*\{[\s\S]*pointer-events:\s*auto;/);
    assert.match(panelCss, /\.booking-menu-catalog-entry-summary\s*\{[\s\S]*pointer-events:\s*none;/);
    assert.match(panelCss, /body\.booking-menu-catalog-active/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*position:\s*fixed;/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*inset:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(280px,\s*330px\)[\s\S]*overflow:\s*hidden;/);
    assert.match(panelCss, /\.booking-menu-catalog-browser\s*\{[\s\S]*isolation:\s*isolate;[\s\S]*contain:\s*paint;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-search,\s*\.booking-menu-catalog-tabs,\s*\.booking-menu-catalog-list\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*2;[\s\S]*isolation:\s*isolate;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(224px,\s*1fr\)\);[\s\S]*justify-content:\s*start;/);
    assert.match(panelCss, /\.booking-menu-catalog-tabs\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*overflow-x:\s*visible;/);
    assert.doesNotMatch(panelCss, /\.booking-menu-catalog-tabs\s*\{[\s\S]*overflow-x:\s*auto;/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*padding:\s*0 10px calc\(96px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*scroll-padding-top:\s*48px;/);
    assert.match(panelCss, /\.booking-menu-catalog-list > \*\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*3;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*328px;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-item:hover,\s*\.booking-menu-catalog-item:focus-within\s*\{[\s\S]*transform:\s*translate3d\(0,\s*-2px,\s*0\);/);
    assert.match(panelCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.booking-menu-catalog-item:hover,[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*auto;[\s\S]*aspect-ratio:\s*3 \/ 2;[\s\S]*min-height:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-stepper\s*\{[\s\S]*grid-template-columns:\s*32px minmax\(44px,\s*1fr\) 32px 32px 32px;[\s\S]*flex:\s*0 0 auto;[\s\S]*width:\s*100%;[\s\S]*min-height:\s*32px;[\s\S]*max-width:\s*none;[\s\S]*margin-top:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-content\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 78px;/);
    assert.match(panelCss, /\.booking-menu-catalog-action\s*\{[\s\S]*min-height:\s*20px;[\s\S]*font-size:\s*9\.5px;/);
    assert.match(panelCss, /@media \(max-height:\s*820px\), \(max-width:\s*1440px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(260px,\s*300px\)[\s\S]*min-height:\s*312px;[\s\S]*aspect-ratio:\s*3 \/ 2;/);
    assert.match(panelCss, /\.booking-menu-catalog-action--allergens\s*\{[\s\S]*border-color:\s*rgba\(245,\s*158,\s*11,\s*0\.16\);/);
    const minimumCatalogCardWidth = 224;
    const catalogCardHorizontalPadding = 18;
    const minimumStepperColumnsWidth = 32 + 44 + 32 + 32 + 32;
    const minimumStepperGapWidth = 4 * 4;
    assert.ok(
        minimumStepperColumnsWidth + minimumStepperGapWidth <= minimumCatalogCardWidth - catalogCardHorizontalPadding,
        'menu catalog stepper must fit the minimum card width without hiding buttons'
    );
    const catalogItemMarkupStart = bookingJs.indexOf('booking-menu-catalog-item');
    const thumbMarkupIndex = bookingJs.indexOf('bookingMenuCatalogVisualHtml(product, title)', catalogItemMarkupStart);
    const stepperMarkupIndex = bookingJs.indexOf('booking-menu-catalog-stepper', catalogItemMarkupStart);
    const mainMarkupIndex = bookingJs.indexOf('booking-menu-catalog-main', catalogItemMarkupStart);
    assert.ok(
        thumbMarkupIndex > catalogItemMarkupStart && thumbMarkupIndex < stepperMarkupIndex && stepperMarkupIndex < mainMarkupIndex,
        'menu catalog controls must render directly after the photo, before lower text metadata'
    );
    assert.match(panelCss, /\.booking-menu-catalog-thumb img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.uses-fallback-image img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.has-image span/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.is-image-missing img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb--cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-mobile-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart-open \.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-stepper/);
    assert.match(panelCss, /\.booking-menu-catalog-actions/);
    assert.match(panelCss, /\.booking-menu-catalog-action--allergens/);
    assert.match(panelCss, /\.booking-menu-insight-panel/);
    assert.match(panelCss, /\.booking-menu-insight-prompt/);
    assert.match(panelCss, /\.booking-menu-insight-result/);
    assert.match(panelCss, /\.booking-menu-insight-status\.success/);
    assert.match(panelCss, /\.booking-menu-insight-card\.is-nudged/);
    assert.match(bookingJs, /function nudgeBookingMenuCatalogInsightCard/);
    assert.match(panelCss, /\.booking-menu-catalog-group-heading\s*\{[\s\S]*isolation:\s*isolate;[\s\S]*margin:\s*0 -10px 2px;[\s\S]*box-shadow:\s*0 14px 28px/);
    assert.match(panelCss, /\.booking-menu-catalog-group-heading::before\s*\{[\s\S]*inset:\s*0 -100vw 0 0;[\s\S]*background:\s*inherit;[\s\S]*box-shadow:\s*inherit;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\.selected/);
    assert.match(panelCss, /\.booking-menu-catalog-inline-input/);
    assert.match(panelCss, /\.booking-menu-catalog-note-editor/);
    assert.match(panelCss, /@media \(max-width:\s*900px\)/);
    assert.match(panelCss, /\.booking-menu-catalog-panel::after/);
    assert.match(panelCss, /\.program-icon:focus-visible/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-mode-section/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-filler-section select/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-service-section input/);
    assert.match(responsiveCss, /--booking-footer-space:\s*calc\(32px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(responsiveCss, /width:\s*min\(92vw,\s*680px\)/);
});

test('booking costume selector filters operationally inactive records and preserves saved custom value', () => {
    const appJs = read('js', 'app.js');
    const helperStart = appJs.indexOf('function normalizeCostumeOptionName');
    const helperEnd = appJs.indexOf('async function initializeCostumes', helperStart);
    assert.ok(helperStart >= 0, 'costume helper block start exists');
    assert.ok(helperEnd > helperStart, 'costume helper block end exists');

    const select = {
        children: [],
        dataset: {},
        value: '',
        set innerHTML(value) {
            this.children = [];
        },
        get innerHTML() {
            return this.children.map(child => child.textContent).join('');
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        }
    };
    const document = {
        getElementById(id) {
            return id === 'costumeSelect' ? select : null;
        },
        createElement() {
            return { value: '', textContent: '' };
        }
    };
    const helpers = vm.runInNewContext(
        `${appJs.slice(helperStart, helperEnd)}
        ({ bookingCostumeSelectOptions, renderCostumeOptions });`,
        { document }
    );

    const costumes = [
        { name: ' Elsa ', condition: 'good' },
        { name: 'Anna', condition: 'new', assigned_name: 'Animator Anna' },
        { name: 'Duplicate', condition: 'good' },
        { name: 'duplicate', condition: 'good' },
        { name: 'Broken', condition: 'damaged' },
        { name: 'Retired', condition: 'retired' },
        { name: 'Deleted', condition: 'good', deleted_at: '2026-06-01T00:00:00.000Z' },
        { name: 'Flagged', condition: 'good', is_deleted: true },
        { name: '', condition: 'good' }
    ];

    const activeOptions = helpers.bookingCostumeSelectOptions(costumes);
    assert.deepEqual(
        Array.from(activeOptions, option => option.value),
        ['Elsa', 'Anna', 'Duplicate'],
        'selector keeps active costumes only and de-duplicates by name'
    );
    assert.deepEqual(
        Array.from(activeOptions, option => option.label),
        ['Elsa', 'Anna — assigned to Animator Anna', 'Duplicate'],
        'assigned costume keeps value but displays assignee status'
    );

    const renderedOptions = helpers.renderCostumeOptions(costumes, { selectedValue: 'Archived Custom Costume' });
    assert.deepEqual(
        Array.from(renderedOptions, option => option.value),
        ['Elsa', 'Anna', 'Duplicate', 'Archived Custom Costume'],
        'saved custom value remains selectable even when Warehouse does not return it'
    );
    assert.equal(select.value, 'Archived Custom Costume');
    assert.deepEqual(
        Array.from(select.children, child => child.textContent),
        [
            'Без костюма',
            'Elsa',
            'Anna — assigned to Animator Anna',
            'Duplicate',
            'Archived Custom Costume — saved on booking'
        ]
    );
});

test('timeline caches are scoped by business and display mode before booking visibility checks', () => {
    const timelineJs = read('js', 'timeline.js');
    const timelineCacheJs = read('js', 'timeline-cache.js');
    const bookingJs = read('js', 'booking.js');

    assert.match(timelineCacheJs, /function timelineCacheScopeKey/);
    assert.match(timelineCacheJs, /function timelineCacheKeyForDate/);
    assert.match(timelineJs, /getTimelineCacheEntry\(AppState\.cachedLines/);
    assert.match(timelineJs, /getTimelineCacheEntry\(AppState\.cachedBookings/);
    assert.match(timelineCacheJs, /window\.invalidateTimelineDateCache = invalidateTimelineDateCache/);
    assert.doesNotMatch(timelineJs, /AppState\.cachedBookings\[dateStr\]/);
    assert.doesNotMatch(timelineJs, /AppState\.cachedLines\[dateStr\]/);
    assert.match(bookingJs, /createdBookingVisibilityDiagnostics/);
    assert.match(bookingJs, /waitForCreatedBookingBlocks/);
    assert.match(bookingJs, /лінія \$\{lineId\} не відкрита в поточному таймлайні/);
    assert.match(bookingJs, /поза видимим діапазоном/);
    assert.match(bookingJs, /тривалість запису 0 хв/);
    assert.match(bookingJs, /refreshCreatedBookingTimelineSnapshot/);
    assert.match(bookingJs, /previousCachedBookings/);
    assert.match(bookingJs, /preservedBookings/);
    assert.match(bookingJs, /mergedBookingsById/);
    assert.match(bookingJs, /invalidateBookingTimelineDateCache\(currentDate, \{ bookings: false \}\)/);
    assert.match(bookingJs, /getLinesForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /function createdBookingTimelineProjection/);
    assert.match(bookingJs, /function createdBookingProjectionMatchesCurrentSlice/);
    assert.match(bookingJs, /function currentCreatedBookingTimelineView/);
    assert.match(bookingJs, /function createdBookingProjectionTimelineView/);
    assert.match(bookingJs, /projection\?\.timelineView\s*\|\|\s*projection\?\.timeline_view\s*\|\|\s*projection\?\.view/);
    assert.match(bookingJs, /const expectedTimelineView = currentCreatedBookingTimelineView\(\)/);
    assert.match(bookingJs, /const projectedTimelineView = createdBookingProjectionTimelineView\(projection\)/);
    assert.match(bookingJs, /if \(projectedTimelineView && expectedTimelineView && projectedTimelineView !== expectedTimelineView\) return false/);
    assert.doesNotMatch(bookingJs, /if \(projection && projection\.visible === false\) return false/);
    assert.match(bookingJs, /lineId \|\| projection\?\.visible === true/);
    assert.match(bookingJs, /серверна проекція не бачить запис/);
    assert.match(bookingJs, /projectionRecoveredIds/);
    assert.match(bookingJs, /setTimelineCacheEntry\(AppState\.cachedBookings, currentDate, snapshot\.bookings\)/);
    assert.match(bookingJs, /bookings: changedDateKey !== selectedDateKey/);
    assert.match(bookingJs, /серверний список дня не повернув запис/);
    assert.match(bookingJs, /createdBookingVisibilityMessage\(createdBookings, timelineSnapshot\)/);
    assert.match(bookingJs, /Details target not found[\s\S]*timelineView: currentCreatedBookingTimelineView\(\)[\s\S]*businessContext:/);
});

test('booking detail miss diagnostics stay scoped and avoid customer data', () => {
    const bookingJs = read('js', 'booking.js');
    const warningStart = bookingJs.indexOf("console.warn('[booking] Details target not found'");
    const warningEnd = bookingJs.indexOf('return false;', warningStart);
    assert.ok(warningStart >= 0 && warningEnd > warningStart, 'booking detail miss diagnostic block exists');
    const warningBlock = bookingJs.slice(warningStart, warningEnd);

    assert.match(warningBlock, /bookingId: cleanBookingId/);
    assert.match(warningBlock, /source: options\.source \|\| 'unknown'/);
    assert.match(warningBlock, /date: AppState\.selectedDate/);
    assert.match(warningBlock, /timelineView: currentCreatedBookingTimelineView\(\)/);
    assert.match(warningBlock, /businessContext:/);
    assert.match(warningBlock, /lookupSource: detailRecord\.source/);
    assert.match(warningBlock, /status: detailRecord\.status \|\| null/);
    assert.match(warningBlock, /error: detailRecord\.error \|\| null/);
    assert.doesNotMatch(
        warningBlock,
        /customer(?:Id|Name|Phone|Instagram|Email)|child(?:Name|Birthday)|phone|instagram|authorization|bearer|token|password|secret/i
    );
});

test('created booking visibility diagnostics avoid customer data', () => {
    const bookingJs = read('js', 'booking.js');
    const helperStart = bookingJs.indexOf('function createdBookingDiagnosticSummary');
    const helperEnd = bookingJs.indexOf('function createdBookingProjectionMatchesCurrentSlice', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'created booking diagnostic summary helper exists');
    const helperBlock = bookingJs.slice(helperStart, helperEnd);
    assert.match(helperBlock, /id: booking\?\.id \|\| booking\?\.bookingId \|\| null/);
    assert.match(helperBlock, /date: normalizeBookingDateKey\(projection\?\.date \|\| booking\?\.date\) \|\| null/);
    assert.match(helperBlock, /status: booking\?\.status \|\| null/);
    assert.match(helperBlock, /businessContext:/);
    assert.match(helperBlock, /timelineView: createdBookingProjectionTimelineView\(projection\) \|\| currentCreatedBookingTimelineView\(\)/);
    assert.match(helperBlock, /lineId:/);
    assert.doesNotMatch(
        helperBlock,
        /customer(?:Id|Name|Phone|Instagram|Email)|child(?:Name|Birthday)|phone|instagram|authorization|bearer|token|password|secret/i
    );

    const errorStart = bookingJs.indexOf("console.error('Created booking is not visible after timeline refresh'");
    const errorEnd = bookingJs.indexOf('await waitForCreatedBookingBlocks', errorStart);
    assert.ok(errorStart >= 0 && errorEnd > errorStart, 'created booking visibility error diagnostic exists');
    const errorBlock = bookingJs.slice(errorStart, errorEnd);
    assert.match(errorBlock, /createdBookings: createdBookings\.map\(createdBookingDiagnosticSummary\)/);
    assert.doesNotMatch(errorBlock, /createdBookings,\s*$/m);
});

test('booking lifecycle actions force fresh day snapshots before mutating the server', () => {
    const bookingJs = read('js', 'booking.js');
    const uiJs = read('js', 'ui.js');
    const apiJs = read('js', 'api.js');
    const changeStatusStart = uiJs.indexOf('async function changeBookingStatus');
    const changeStatusEnd = uiJs.indexOf('// ==========================================', changeStatusStart + 1);
    const changeStatusSource = changeStatusStart >= 0 && changeStatusEnd > changeStatusStart
        ? uiJs.slice(changeStatusStart, changeStatusEnd)
        : '';

    assert.match(bookingJs, /async function deleteBooking\(bookingId\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /async function shiftBookingTime\(bookingId, minutes\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /async function switchBookingLine\(bookingId, targetLineId\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(uiJs, /async function changeBookingStatus\(bookingId, newStatus\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(apiJs, /async function apiMarkBookingPreliminary\(id, payload = \{\}\)[\s\S]*\/preliminary/);
    assert.match(changeStatusSource, /apiConfirmBooking\(bookingId, \{ source: 'booking_panel' \}\)/);
    assert.match(changeStatusSource, /apiMarkBookingPreliminary\(bookingId, \{ source: 'booking_panel' \}\)/);
    assert.doesNotMatch(changeStatusSource, /apiUpdateBooking/);
    assert.match(bookingJs, /invalidateBookingTimelineDateCache\(AppState\.selectedDate, \{ lines: false \}\)/);
    assert.match(uiJs, /invalidateTimelineDateCache\(AppState\.selectedDate, \{ lines: false \}\)/);
});

test('booking customer copy actions keep dynamic values out of inline JavaScript', async () => {
    const bookingJs = read('js', 'booking.js');
    const helperStart = bookingJs.indexOf('function renderBookingCustomerCopyAction(value, label)');
    const helperEnd = bookingJs.indexOf('function bookingDetailSafeRender', helperStart);
    const customerBlockStart = bookingJs.indexOf('if (booking.customerId) {', helperEnd);
    const customerBlockEnd = bookingJs.indexOf('function selectedBanquetCandidateRole', customerBlockStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'customer copy helpers exist before the protected booking detail block');
    assert.ok(customerBlockStart >= 0 && customerBlockEnd > customerBlockStart, 'customer detail block exists');

    const customerBlock = bookingJs.slice(customerBlockStart, customerBlockEnd);
    assert.match(customerBlock, /renderBookingCustomerCopyAction\(customer\.name/);
    assert.match(customerBlock, /renderBookingCustomerCopyAction\(customer\.phone/);
    assert.match(customerBlock, /renderBookingCustomerCopyAction\(`@\$\{igName\}`/);
    assert.match(customerBlock, /bindBookingCustomerCopyActions\(block\)/);
    assert.doesNotMatch(customerBlock, /onclick="navigator\.clipboard\.writeText/);

    const dom = new JSDOM('<!doctype html><html><body><div id="customer"></div></body></html>', {
        runScripts: 'outside-only'
    });
    const { window } = dom;
    const copied = [];
    window.escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    window.showNotification = () => {};
    window.setTimeout = () => 0;
    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async value => copied.push(value)
        }
    });

    vm.runInContext(`
        ${bookingJs.slice(helperStart, helperEnd)}
        this.__bookingCustomerCopyHooks = {
            renderBookingCustomerCopyAction,
            bindBookingCustomerCopyActions
        };
    `, dom.getInternalVMContext(), { filename: 'js/booking.js' });

    const values = [
        "O'Connor",
        '"quoted"\n<script>alert(1)</script>',
        "');window.__injected=true;//"
    ];
    const container = window.document.getElementById('customer');
    container.innerHTML = values
        .map((value, index) => window.__bookingCustomerCopyHooks.renderBookingCustomerCopyAction(value, `Copy ${index + 1}`))
        .join('');
    window.__bookingCustomerCopyHooks.bindBookingCustomerCopyActions(container);
    window.__bookingCustomerCopyHooks.bindBookingCustomerCopyActions(container);

    const buttons = [...container.querySelectorAll('[data-booking-customer-copy]')];
    assert.equal(buttons.length, values.length);
    assert.equal(container.querySelector('script'), null);
    assert.equal(window.__injected, undefined);
    buttons.forEach(button => {
        assert.equal(button.getAttribute('onclick'), null);
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(copied, values);

    buttons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.deepEqual(copied, [...values, values[0]], 'the delegated listener is bound only once');
    dom.window.close();
});

test('booking drawer keeps readable Ukrainian labels for manager-facing controls', () => {
    const bookingJs = read('js', 'booking.js');
    const bookingHtml = read('index.html');

    assert.match(bookingJs, /label: 'Усі'/);
    assert.match(bookingJs, /label: 'Анімація'/);
    assert.match(bookingJs, /label: 'Квести'/);
    assert.match(bookingJs, /label: 'Піньяти'/);
    assert.doesNotMatch(bookingJs, /detail-copy-summary-btn/);
    assert.doesNotMatch(bookingJs, /Скопіювати всю інформацію/);
    assert.match(bookingJs, /Редагувати бронювання/);
    assert.match(bookingJs, /Не вдалося скопіювати/);

    assert.match(bookingHtml, /Оберіть позицію з меню/);
    assert.match(bookingHtml, /Кухня \/ меню/);
    assert.match(bookingHtml, /Додати позицію/);
    assert.match(bookingHtml, /Пошук програми/);
});
