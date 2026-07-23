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

function bookingPackagePreorderWarningGroups(bookingPackage = {}) {
    const status = bookingPackage?.banquetPreorderStatus
        || bookingPackage?.banquet_preorder_status
        || null;
    const warnings = Array.isArray(status?.warnings) ? status.warnings : [];
    const workflow = bookingPackageMenuWorkflowOf(bookingPackage);
    const groups = {
        menu: [],
        deposit: [],
        other: []
    };
    for (const warning of warnings) {
        const code = String(warning?.code || '').trim();
        const message = String(warning?.message || warning?.code || warning || '').trim();
        if (!message) continue;
        if (code.startsWith('banquet_deposit_')) {
            groups.deposit.push(message);
        } else if (code.startsWith('banquet_menu_') || code === 'banquet_place_type_unknown') {
            if (workflow?.mode !== 'actual') groups.menu.push(message);
        } else {
            groups.other.push(message);
        }
    }
    return groups;
}

function bookingPackagePreorderWarnings(bookingPackage = {}) {
    const groups = bookingPackagePreorderWarningGroups(bookingPackage);
    return [...groups.menu, ...groups.deposit, ...groups.other];
}

function renderBookingPackagePreorderWarning(bookingPackage = {}) {
    const groups = bookingPackagePreorderWarningGroups(bookingPackage);
    return [
        ['menu', 'Передзамовлення'],
        ['deposit', 'Завдаток'],
        ['other', 'Перевірка бронювання']
    ].map(([key, title]) => {
        const warnings = groups[key];
        if (!warnings.length) return '';
        return `
            <div class="booking-summary-note booking-summary-note--warning booking-preorder-warning booking-preorder-warning--${key}">
                <strong>${title}</strong>
                <ul>${warnings.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>
            </div>
        `;
    }).join('');
}

function bookingPackageMenuWorkflowOf(bookingPackage = {}) {
    const workflow = bookingPackage?.menuWorkflow || bookingPackage?.menu_workflow || null;
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return null;
    const mode = String(workflow.mode || '').trim();
    if (!mode) return null;
    const status = String(workflow.status || '').trim() || (mode === 'actual' ? 'awaiting_actual' : '');
    const snapshot = workflow.minimumSnapshot || workflow.minimum_snapshot || {};
    const finalization = workflow.finalization || {};
    const exception = workflow.creatorException || workflow.creator_exception || null;
    const positionsSubtotal = bookingPackageMoneyValue(bookingPackage.positionsSubtotal ?? bookingPackage.positions_subtotal ?? workflow.positionsSubtotal ?? workflow.positions_subtotal ?? 0);
    const minimumAmount = bookingPackageMoneyValue(snapshot.minimumAmount ?? snapshot.minimum_amount ?? workflow.minimumAmount ?? workflow.minimum_amount ?? 0);
    const adjustment = bookingPackage.menuMinimumAdjustment || bookingPackage.menu_minimum_adjustment || {};
    const adjustmentAmount = bookingPackageMoneyValue(adjustment.amount ?? finalization.adjustmentAmount ?? finalization.adjustment_amount ?? Math.max(0, minimumAmount - positionsSubtotal));
    const chargedSubtotal = bookingPackageMoneyValue(bookingPackage.menuChargedSubtotal ?? bookingPackage.menu_charged_subtotal ?? workflow.chargedSubtotal ?? workflow.charged_subtotal ?? positionsSubtotal + adjustmentAmount);
    return {
        mode,
        status,
        statusLabel: workflow.statusLabel || workflow.status_label || (mode === 'actual'
            ? (status === 'finalized' ? 'Меню по факту · закрито' : 'Меню по факту · очікує закриття')
            : 'Передзамовлення'),
        minimumAmount,
        positionsSubtotal,
        adjustmentAmount,
        chargedSubtotal,
        finalizedAt: workflow.finalizedAt || workflow.finalized_at || finalization.finalizedAt || finalization.finalized_at || null,
        finalizedBy: workflow.finalizedBy || workflow.finalized_by || finalization.finalizedBy || finalization.finalized_by || null,
        exceptionReason: exception && typeof exception === 'object' ? String(exception.reason || '').trim() : null
    };
}

function bookingPackageActorLabel(actor) {
    if (!actor) return '';
    if (typeof actor === 'string') return actor.trim();
    if (typeof actor !== 'object') return '';
    return String(actor.name || actor.username || actor.id || '').trim();
}

function bookingPackageDateTimeLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('uk-UA', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderBookingPackageMenuWorkflow(bookingPackage = {}) {
    const workflow = bookingPackageMenuWorkflowOf(bookingPackage);
    if (!workflow || workflow.mode !== 'actual') return '';
    const rows = [
        ['Мінімум меню', formatPrice(workflow.minimumAmount)],
        ['Попередня сума', formatPrice(workflow.positionsSubtotal)],
        ['Різниця до мінімуму', formatPrice(workflow.adjustmentAmount)],
        ['Сума меню до оплати', formatPrice(workflow.chargedSubtotal)]
    ];
    if (workflow.status === 'finalized') {
        const finalizedParts = [bookingPackageActorLabel(workflow.finalizedBy), bookingPackageDateTimeLabel(workflow.finalizedAt)].filter(Boolean).join(' · ');
        rows.push(['Закрито', finalizedParts || 'Так']);
    }
    if (workflow.exceptionReason) {
        rows.push(['Причина винятку', workflow.exceptionReason]);
    }
    const rowHtml = rows.map(([label, value]) => '<li><span>' + escapeHtml(label) + ':</span> ' + escapeHtml(value) + '</li>').join('');
    return '\n        <div class="booking-summary-note booking-menu-actual-status' + (workflow.status === 'awaiting_actual' ? ' booking-menu-actual-status--attention' : '') + '">\n            <strong>' + escapeHtml(workflow.statusLabel) + '</strong>\n            <small>Контрольна задача: Закрити меню по факту</small>\n            <ul>' + rowHtml + '</ul>\n        </div>\n    ';
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

function bookingPackageTicketLines(bookingPackage = {}) {
    if (!bookingPackage || typeof bookingPackage !== 'object') return [];
    const rawLines = bookingPackage.ticketLines || bookingPackage.ticket_lines;
    return (Array.isArray(rawLines) ? rawLines : [])
        .map(line => ({
            code: String(line?.ticketTypeCode || line?.ticket_type_code || '').trim(),
            name: String(line?.ticketTypeName || line?.ticket_type_name || line?.ticketTypeCode || '').trim(),
            audience: String(line?.audience || '').trim(),
            quantity: Number(line?.quantity || 0),
            unitPrice: bookingPackageMoneyValue(line?.unitPriceUah ?? line?.unit_price_uah),
            subtotal: bookingPackageMoneyValue(line?.subtotalUah ?? line?.subtotal_uah)
        }))
        .filter(line => line.code && Number.isInteger(line.quantity) && line.quantity >= 0);
}

function renderBookingPackageTicketRows(bookingPackage = {}) {
    const lines = bookingPackageTicketLines(bookingPackage).filter(line => line.quantity > 0);
    if (!lines.length) return '';
    return `
        <div class="booking-detail-package-serving-group booking-detail-package-serving-group--tickets">
            <div class="booking-detail-package-serving-title">
                <span>Квитки</span>
                <small>Серверний тарифний snapshot</small>
            </div>
            <div class="booking-detail-package-table" role="table" aria-label="Квитки">
                <div class="booking-detail-package-table-head" role="row">
                    <span role="columnheader">Тип</span>
                    <span role="columnheader">К-сть</span>
                    <span role="columnheader">Ціна</span>
                    <span role="columnheader">Сума</span>
                </div>
                ${lines.map(line => `
                    <div class="booking-detail-package-table-row booking-detail-package-table-row--ticket" role="row">
                        <div class="booking-detail-package-item" role="cell">
                            <span class="booking-menu-position-kind">КВИТОК</span>${escapeHtml(line.name || line.code)}
                        </div>
                        <span role="cell">${escapeHtml(`${line.quantity} ${line.audience === 'adult' ? 'дорослих' : 'дітей'}`)}</span>
                        <span class="booking-detail-package-money" role="cell">${escapeHtml(formatPrice(line.unitPrice))}</span>
                        <strong class="booking-detail-package-money booking-detail-package-money--subtotal" role="cell">${escapeHtml(formatPrice(line.subtotal))}</strong>
                    </div>
                `).join('')}
            </div>
        </div>`;
}

function bookingPackageBusinessRowsSummary({ menuCount = 0, legacyMenu = false, entryCharge = null, ticketLines = [], entertainmentRows = [] } = {}) {
    const parts = [];
    const normalizedMenuCount = Number(menuCount);
    const normalizedEntertainmentCount = Array.isArray(entertainmentRows) ? entertainmentRows.length : 0;
    if (Number.isFinite(normalizedMenuCount) && normalizedMenuCount > 0) {
        parts.push(`Меню: ${normalizedMenuCount}`);
    } else if (legacyMenu) {
        parts.push('Меню');
    }
    if (entryCharge) parts.push('Вхід');
    if (Array.isArray(ticketLines) && ticketLines.length) parts.push(`Квитки: ${ticketLines.length}`);
    if (normalizedEntertainmentCount > 0) parts.push(`Розваги: ${normalizedEntertainmentCount}`);
    return parts.join(' · ');
}

function renderBookingPackageDetail(booking, options = {}) {
    const bookingPackage = getBookingPackageFromBooking(booking);
    const positions = Array.isArray(bookingPackage?.menuPositions) ? bookingPackage.menuPositions : [];
    const serviceEvents = Array.isArray(bookingPackage?.serviceEvents) ? bookingPackage.serviceEvents : [];
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
    const ticketLines = bookingPackageTicketLines(bookingPackage);
    const ticketRows = renderBookingPackageTicketRows(bookingPackage);
    const preorderWarning = renderBookingPackagePreorderWarning(bookingPackage);
    const menuWorkflowStatus = renderBookingPackageMenuWorkflow(bookingPackage);
    const entryCharge = ticketLines.length ? null : bookingPackageEntryChargeFromPackage(bookingPackage);
    const entryRow = entryCharge ? renderBookingPackageEntryRow(bookingPackage) : '';
    const businessRowsSummary = showHeaderSummary
        ? bookingPackageBusinessRowsSummary({
            menuCount: positions.length,
            legacyMenu: !positions.length && Boolean(booking?.banquetMenu),
            entryCharge,
            ticketLines,
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
            ${menuWorkflowStatus}
            ${preorderWarning}
            ${rows}
            ${entertainmentHtml}
            ${ticketRows}
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
        bookingPackageTicketLines,
        renderBookingPackageTicketRows,
        bookingPackagePreorderWarningGroups,
        bookingPackagePreorderWarnings,
        renderBookingPackagePreorderWarning,
        bookingPackageBusinessRowsSummary,
        renderBookingPackageDetail
    };

    root.BookingPackageRenderer = Object.assign(root.BookingPackageRenderer || {}, api);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.BookingPackageRenderer;
    }
})(typeof window !== 'undefined' ? window : globalThis);
