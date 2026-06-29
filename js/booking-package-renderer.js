/**
 * booking-package-renderer.js - shared renderer for booking package/menu details.
 * Keeps package HTML generation out of the large booking.js lifecycle file.
 */
(function initBookingPackageRenderer(root) {
    'use strict';

function bookingServingTimeLabel(value) {
    return value || 'Час видачі не вказано';
}

function groupedBookingMenuPositions(positions = []) {
    const groups = new Map();
    positions.forEach(item => {
        const key = item.servingTime || '__missing__';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                servingTime: item.servingTime || null,
                items: []
            });
        }
        groups.get(key).items.push(item);
    });
    return Array.from(groups.values()).sort((a, b) => {
        if (!a.servingTime && !b.servingTime) return 0;
        if (!a.servingTime) return 1;
        if (!b.servingTime) return -1;
        return a.servingTime.localeCompare(b.servingTime);
    });
}

function renderBookingPackageMenuRows(positions = [], options = {}) {
    if (!positions.length) return '';
    const showServingTitles = options.showServingTitles !== false;
    const tableHead = `
                <div class="booking-detail-package-table-head" role="row">
                    <span role="columnheader">Позиція</span>
                    <span role="columnheader">К-сть</span>
                    <span role="columnheader">Ціна</span>
                    <span role="columnheader">Сума</span>
                </div>
    `;
    const rowHtml = item => `
                <div class="booking-detail-package-table-row" role="row">
                    <div class="booking-detail-package-item" role="cell">
                        <span class="booking-menu-position-kind">${escapeHtml(bookingKitchenTypeLabel(item.kitchenType))}</span>${escapeHtml(item.title)}
                        ${item.note || item.servingNote ? `<small>${item.note ? escapeHtml(item.note) : ''}${item.note && item.servingNote ? ' · ' : ''}${item.servingNote ? escapeHtml(item.servingNote) : ''}</small>` : ''}
                    </div>
                    <span role="cell">${escapeHtml(formatBookingMenuPositionQuantity(item))}</span>
                    <span class="booking-detail-package-money" role="cell">${escapeHtml(formatPrice(item.unitPrice || 0))}</span>
                    <strong class="booking-detail-package-money booking-detail-package-money--subtotal" role="cell">${escapeHtml(formatPrice(item.subtotal || 0))}</strong>
                </div>
    `;
    const groups = groupedBookingMenuPositions(positions);
    if (!showServingTitles) {
        return `
        <div class="booking-detail-package-serving-group">
            <div class="booking-detail-package-table" role="table" aria-label="Позиції меню">
                ${tableHead}
                ${groups.flatMap(group => group.items).map(rowHtml).join('')}
            </div>
        </div>
        `;
    }
    return groups.map(group => `
        <div class="booking-detail-package-serving-group${group.servingTime ? '' : ' booking-detail-package-serving-group--missing'}">
            ${showServingTitles ? `
            <div class="booking-detail-package-serving-title">
                <span>${escapeHtml(bookingServingTimeLabel(group.servingTime))}</span>
                <small>Позиції меню</small>
            </div>
            ` : ''}
            <div class="booking-detail-package-table" role="table" aria-label="Позиції меню ${escapeHtml(bookingServingTimeLabel(group.servingTime))}">
                ${tableHead}
                ${group.items.map(rowHtml).join('')}
            </div>
        </div>
    `).join('');
}

function normalizeBookingPackageEntertainmentRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row, index) => {
            const title = String(row?.title || row?.label || row?.programName || row?.program_name || row?.bookingId || '').trim();
            if (!title) return null;
            const subtotal = bookingPackageMoneyValue(row.subtotal ?? row.price ?? row.amount ?? 0);
            const unitPrice = bookingPackageMoneyValue(row.unitPrice ?? row.unit_price ?? subtotal);
            return {
                id: String(row.id || row.bookingId || row.booking_id || `entertainment:${index + 1}`),
                title,
                time: String(row.time || '').trim(),
                room: String(row.room || '').trim(),
                durationLabel: String(row.durationLabel || row.duration_label || '').trim(),
                quantityLabel: String(row.quantityLabel || row.quantity_label || '').trim(),
                unitPriceLabel: String(row.unitPriceLabel || row.unit_price_label || '').trim(),
                subtotalLabel: String(row.subtotalLabel || row.subtotal_label || '').trim(),
                unitPrice,
                subtotal,
                includedInPackage: row.includedInPackage === true || row.included_in_package === true
            };
        })
        .filter(Boolean);
}

function formatBookingPackageMoneyLabel(value, fallbackValue = 0, options = {}) {
    const raw = String(value ?? '').trim();
    const suffix = options.perChild || /\/\s*дит/i.test(raw) ? '/дит' : '';
    const amount = raw ? bookingPackageMoneyValue(raw) : bookingPackageMoneyValue(fallbackValue);
    if (amount > 0) return `${formatPrice(amount)}${suffix}`;
    return raw || '—';
}

function renderBookingPackageEntertainmentRows(rows = [], options = {}) {
    const entertainmentRows = normalizeBookingPackageEntertainmentRows(rows);
    if (!entertainmentRows.length) return '';
    const showEntertainmentTitle = options.showEntertainmentTitle !== false;
    const showEntertainmentTableHead = options.showEntertainmentTableHead !== false;
    const showEntertainmentKindBadge = options.showEntertainmentKindBadge !== false;
    return `
        <div class="booking-detail-package-serving-group booking-detail-package-serving-group--entertainment">
            ${showEntertainmentTitle ? `
            <div class="booking-detail-package-serving-title">
                <span>Розваги</span>
                <small>Розважальні позиції</small>
            </div>
            ` : ''}
            <div class="booking-detail-package-table" role="table" aria-label="Розважальні позиції">
                ${showEntertainmentTableHead ? `
                <div class="booking-detail-package-table-head" role="row">
                    <span role="columnheader">Позиція</span>
                    <span role="columnheader">К-сть</span>
                    <span role="columnheader">Ціна</span>
                    <span role="columnheader">Сума</span>
                </div>
                ` : ''}
                ${entertainmentRows.map(row => {
                    const meta = [row.time, row.room, row.durationLabel].filter(Boolean).join(' · ');
                    const quantityLabel = row.quantityLabel || '1 програма';
                    const priceLabel = formatBookingPackageMoneyLabel(row.unitPriceLabel, row.unitPrice);
                    const subtotalLabel = formatBookingPackageMoneyLabel(row.subtotalLabel, row.subtotal);
                    return `
                        <div class="booking-detail-package-table-row booking-detail-package-table-row--entertainment" role="row">
                            <div class="booking-detail-package-item" role="cell">
                                ${showEntertainmentKindBadge ? '<span class="booking-menu-position-kind booking-menu-position-kind--entertainment">РОЗВАГИ</span>' : ''}${escapeHtml(row.title)}
                                ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
                            </div>
                            <span role="cell">${escapeHtml(quantityLabel)}</span>
                            <span class="booking-detail-package-money" role="cell">${escapeHtml(priceLabel)}</span>
                            <strong class="booking-detail-package-money booking-detail-package-money--subtotal" role="cell">${escapeHtml(subtotalLabel)}</strong>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function formatBookingEntryQuantityLabel(quantity) {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) return '';
    return `${formatBookingMenuQuantityNumber(value)} дітей`;
}

function bookingPackageMoneyValue(value) {
    const normalized = typeof value === 'string'
        ? value.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
        : value;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.round(amount * 100) / 100;
}

function bookingPackageEntryChargeFromPackage(bookingPackage = {}) {
    if (!bookingPackage || typeof bookingPackage !== 'object') return null;
    const raw = bookingPackage.entryCharge || bookingPackage.entry_charge || null;
    const entrySubtotal = bookingPackageMoneyValue(
        bookingPackage.entrySubtotal
        ?? bookingPackage.entry_subtotal
        ?? (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw.subtotal ?? raw.entrySubtotal ?? raw.entry_subtotal) : 0)
    );
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const subtotal = bookingPackageMoneyValue(raw.subtotal ?? raw.entrySubtotal ?? raw.entry_subtotal ?? entrySubtotal);
        if (subtotal <= 0) return null;
        return {
            title: raw.title || 'Вхід',
            quantity: raw.quantity ?? raw.qty ?? null,
            unitPrice: raw.unitPrice ?? raw.unit_price ?? null,
            subtotal,
            ruleCode: raw.ruleCode || raw.rule_code || null,
            dateType: raw.dateType || raw.date_type || null,
            fallback: false
        };
    }
    if (entrySubtotal <= 0) return null;
    return {
        title: 'Вхід',
        quantity: null,
        unitPrice: null,
        subtotal: entrySubtotal,
        ruleCode: null,
        dateType: null,
        fallback: true
    };
}

function formatBookingPackageEntryAmount(entryCharge = {}) {
    const subtotal = bookingPackageMoneyValue(entryCharge.subtotal || 0);
    const quantityLabel = formatBookingEntryQuantityLabel(entryCharge.quantity);
    const unitPrice = bookingPackageMoneyValue(entryCharge.unitPrice ?? entryCharge.unit_price ?? 0);
    if (quantityLabel && unitPrice > 0) {
        return `${quantityLabel} × ${formatPrice(unitPrice)} = ${formatPrice(subtotal)}`;
    }
    return formatPrice(subtotal);
}

function renderBookingPackageEntryRow(bookingPackage = {}) {
    const entryCharge = bookingPackageEntryChargeFromPackage(bookingPackage);
    if (!entryCharge) return '';
    const label = formatBookingPackageEntryAmount(entryCharge);
    const details = entryCharge.fallback
        ? 'Деталі кількості та ціни не збережені у пакеті.'
        : label;
    return `
        <div class="booking-detail-package-row booking-detail-package-entry-row">
            <div><span class="booking-detail-package-entry-title">${escapeHtml(entryCharge.title || 'Вхід')}</span><small>${escapeHtml(details)}</small></div>
            <strong class="booking-detail-package-money booking-detail-package-money--subtotal">${escapeHtml(formatPrice(entryCharge.subtotal))}</strong>
        </div>
    `;
}

function bookingPackageBusinessRowsSummary({ menuCount = 0, legacyMenu = false, entryCharge = null, entertainmentRows = [] } = {}) {
    const parts = [];
    const normalizedMenuCount = Number(menuCount);
    const normalizedEntertainmentCount = Array.isArray(entertainmentRows) ? entertainmentRows.length : 0;
    if (Number.isFinite(normalizedMenuCount) && normalizedMenuCount > 0) {
        parts.push(`Меню: ${normalizedMenuCount}`);
    } else if (legacyMenu) {
        parts.push('Меню');
    }
    if (entryCharge) parts.push('Вхід');
    if (normalizedEntertainmentCount > 0) parts.push(`Розваги: ${normalizedEntertainmentCount}`);
    return parts.join(' · ');
}

function renderBookingPackageDetail(booking, options = {}) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    const positions = bookingPackage?.menuPositions || [];
    const serviceEvents = bookingPackage?.serviceEvents || [];
    const entertainmentRows = normalizeBookingPackageEntertainmentRows(options.entertainmentRows || options.entertainment_rows || []);
    if (!bookingPackage && !booking?.banquetMenu && !entertainmentRows.length) return '';
    const title = options.title || 'Меню / сервісні позиції';
    const modifier = options.compact ? ' booking-detail-package--compact' : '';
    const includeServiceEvents = options.includeServiceEvents !== false;
    const showPackageHeader = options.showPackageHeader !== false;
    const showHeaderSummary = options.showHeaderSummary !== false;
    const missingServingTimes = bookingMenuMissingServingTimeCount(positions);
    const rows = positions.length
        ? renderBookingPackageMenuRows(positions, {
            showServingTitles: options.showServingTitles !== false
        })
        : (booking?.banquetMenu ? `<div class="booking-detail-package-row"><div>${escapeHtml(booking.banquetMenu)}</div><strong>—</strong></div>` : '');
    const entertainmentHtml = renderBookingPackageEntertainmentRows(entertainmentRows, {
        showEntertainmentTitle: options.showEntertainmentTitle !== false,
        showEntertainmentTableHead: options.showEntertainmentTableHead !== false,
        showEntertainmentKindBadge: options.showEntertainmentKindBadge !== false
    });
    const entryCharge = bookingPackageEntryChargeFromPackage(bookingPackage);
    const entryRow = entryCharge ? renderBookingPackageEntryRow(bookingPackage) : '';
    const businessRowsSummary = showHeaderSummary
        ? bookingPackageBusinessRowsSummary({
            menuCount: positions.length,
            legacyMenu: !positions.length && Boolean(booking?.banquetMenu),
            entryCharge,
            entertainmentRows
        })
        : '';
    const entertainmentSubtotal = entertainmentRows.reduce((total, row) => (
        row.includedInPackage ? total : total + bookingPackageMoneyValue(row.subtotal)
    ), 0);
    const packageTotal = bookingPackage?.finalTotal ?? booking.price ?? 0;
    const displayTotal = bookingPackageMoneyValue(packageTotal) + bookingPackageMoneyValue(entertainmentSubtotal);
    const eventRows = includeServiceEvents && serviceEvents.length
        ? `
            <div class="booking-detail-package-subtitle">Подачі / сервіс</div>
            <div class="booking-detail-package-service-list">
            ${serviceEvents.map(event => `
                <div class="booking-detail-package-service-row">
                    <span class="booking-detail-package-service-dot" aria-hidden="true"></span>
                    <div>
                        <strong>${event.time ? `${escapeHtml(event.time)} · ` : ''}${escapeHtml(event.title || BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Подія')}</strong>
                        ${event.note ? `<small>${escapeHtml(event.note)}</small>` : ''}
                    </div>
                </div>
            `).join('')}
            </div>
        `
        : '';
    return `
        <div class="booking-detail-package${modifier}">
            ${showPackageHeader ? `
            <div class="booking-detail-package-header">
                <span>${escapeHtml(title)}</span>
                ${businessRowsSummary ? `<small>${escapeHtml(businessRowsSummary)}</small>` : ''}
            </div>
            ` : ''}
            ${missingServingTimes ? `<div class="booking-summary-note">Не вказано час видачі для ${escapeHtml(String(missingServingTimes))} позицій.</div>` : ''}
            ${rows}
            ${entertainmentHtml}
            ${entryRow}
            ${eventRows}
            <div class="booking-detail-package-row booking-detail-package-total">
                <div>Загальна сума</div>
                <strong class="booking-detail-package-money booking-detail-package-money--total">${escapeHtml(formatPrice(displayTotal))}</strong>
            </div>
        </div>
    `;
}

    const api = {
        renderBookingPackageSummary: function renderBookingPackageSummaryBridge() {
            const fn = root && root.renderBookingPackageSummary;
            if (typeof fn === 'function' && fn !== api.renderBookingPackageSummary) {
                return fn.apply(root, arguments);
            }
            return '';
        },
        bookingServingTimeLabel,
        groupedBookingMenuPositions,
        renderBookingPackageMenuRows,
        normalizeBookingPackageEntertainmentRows,
        renderBookingPackageEntertainmentRows,
        formatBookingEntryQuantityLabel,
        bookingPackageMoneyValue,
        bookingPackageEntryChargeFromPackage,
        formatBookingPackageEntryAmount,
        renderBookingPackageEntryRow,
        bookingPackageBusinessRowsSummary,
        renderBookingPackageDetail
    };

    root.BookingPackageRenderer = Object.assign(root.BookingPackageRenderer || {}, api);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.BookingPackageRenderer;
    }
})(typeof window !== 'undefined' ? window : globalThis);
