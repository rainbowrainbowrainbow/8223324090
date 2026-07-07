/**
 * booking-banquet-detail.js - shared renderer for booking details banquet sections.
 * Keeps full banquet detail HTML generation out of the large booking.js lifecycle file.
 */
(function initBookingBanquetDetail(root) {
    'use strict';

    let missingPackageRendererWarned = false;

    function renderBookingPackageDetailSafe(booking = {}, options = {}) {
        const renderer = root && root.BookingPackageRenderer;
        if (renderer && typeof renderer.renderBookingPackageDetail === 'function') {
            return renderer.renderBookingPackageDetail(booking, options);
        }
        if (typeof renderBookingPackageDetail === 'function') {
            return renderBookingPackageDetail(booking, options);
        }
        if (!missingPackageRendererWarned) {
            missingPackageRendererWarned = true;
            console.warn('[BookingBanquetDetail] BookingPackageRenderer.renderBookingPackageDetail is unavailable');
        }
        return '';
    }

function renderBanquetDepositStatusSection(anchorBooking = {}, snapshot = null, projection = { loading: true }) {
    const primaryBooking = banquetSnapshotPrimaryBooking(snapshot, anchorBooking) || anchorBooking;
    const anchorId = bookingDetailId(anchorBooking);
    const primaryBookingId = bookingDetailId(primaryBooking) || anchorId;
    const groupId = bookingDetailBanquetGroupId(anchorBooking, snapshot);
    const tone = bookingDetailDepositTone(projection);
    const deposit = projection?.deposit || null;
    const display = projection?.display || {};
    const canViewMoney = bookingDetailCanViewDepositMoney();
    const detailRows = [];
    if (projection?.loading) {
        detailRows.push(['Стан', 'Завантажуємо з бухгалтерського запису']);
    } else if (projection?.success === false) {
        detailRows.push(['Помилка', projection.error || 'Не вдалося завантажити завдаток']);
    } else if (deposit && canViewMoney) {
        const amount = display.amount ?? deposit.paidAmount ?? deposit.expectedAmount ?? deposit.amount;
        const receivedDate = bookingDetailDepositDateLabel(bookingDetailDepositReceivedDate(deposit));
        const method = bookingDetailDepositPaymentLabel(display.paymentMethod || deposit.paymentMethod);
        const dueDate = bookingDetailDepositDateLabel(display.dueDate || deposit.dueDate);
        const managerStatus = display.managerStatus || deposit.managerStatus || '';
        if (amount !== null && amount !== undefined && amount !== '') detailRows.push(['Сума', formatPrice(amount)]);
        if (receivedDate) detailRows.push(['Дата отримання', receivedDate]);
        if (managerStatus) detailRows.push(['Статус менеджера', managerStatus]);
        if (dueDate) detailRows.push(['Дедлайн', dueDate]);
        if (method) detailRows.push(['Спосіб', method]);
    } else if (deposit && !canViewMoney) {
        detailRows.push(['Деталі', 'Фінансові дані приховані для вашої ролі']);
    } else {
        detailRows.push(['Стан', 'Canonical запис завдатку ще не створено']);
    }
    const warnings = bookingDetailDepositWarnings(anchorBooking, snapshot, projection);
    return `
        <div id="bookingBanquetDepositStatus"
             class="booking-banquet-deposit booking-banquet-deposit--${escapeHtml(tone)}"
             data-banquet-deposit-status
             data-booking-id="${escapeHtml(primaryBookingId || '')}"
             data-anchor-booking-id="${escapeHtml(anchorId || '')}"
             data-group-id="${escapeHtml(groupId || '')}">
            <div class="booking-banquet-deposit__main">
                <div>
                    <div class="booking-banquet-deposit__label">Завдаток</div>
                    <div class="booking-banquet-deposit__status">${escapeHtml(bookingDetailDepositStatusLabel(projection))}</div>
                </div>
                <span class="booking-banquet-deposit__pill">${escapeHtml(groupId ? `Група #${groupId}` : `Бронь #${primaryBookingId || '-'}`)}</span>
            </div>
            <div class="booking-banquet-deposit__grid">
                ${detailRows.map(([label, value]) => `
                    <div class="booking-banquet-deposit__item">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(String(value || '-'))}</strong>
                    </div>
                `).join('')}
            </div>
            ${warnings.length ? `<div class="booking-banquet-deposit__warnings">${warnings.map(message => `<div>${escapeHtml(message)}</div>`).join('')}</div>` : ''}
        </div>
    `;
}

function renderBanquetMemberCard(member = {}, roleOverride = null, options = {}) {
    const booking = member.booking || member;
    const bookingId = bookingDetailId(booking);
    if (!bookingId) return '';
    const role = roleOverride || member.role || (member.isPrimary ? 'primary' : 'manual');
    const technicalChildren = member.technicalChildren || [];
    const showTechnicalMeta = Boolean(options.showTechnicalMeta);
    const showRoleBadge = options.showRoleBadge ?? showTechnicalMeta;
    const showPackage = options.showPackage ?? (role === 'kitchen' || bookingDetailIsKitchenCandidate(booking));
    const showTechnicalChildren = options.showTechnicalChildren ?? showTechnicalMeta;
    const packageHtml = showPackage
        ? renderBookingPackageDetailSafe(booking, { title: 'Меню цієї броні', compact: true })
        : '';
    const childrenHtml = showTechnicalChildren && technicalChildren.length ? `
        <div class="booking-banquet-children">
            <div class="booking-banquet-subtitle">Технічні записи</div>
            ${technicalChildren.map(child => `
                <div class="booking-banquet-child">
                    <span>${escapeHtml(bookingDetailTitle(child))}</span>
                    <small>${escapeHtml(bookingDetailStatusLabel(child))}${child.price ? ` · ${escapeHtml(formatPrice(child.price))}` : ''}</small>
                </div>
            `).join('')}
        </div>
    ` : '';
    const metaParts = [
        showTechnicalMeta ? `#${bookingId}` : '',
        booking.room ? booking.room : '',
        booking.customerName ? booking.customerName : ''
    ].filter(Boolean);
    return `
        <div class="booking-banquet-member booking-banquet-member--${escapeHtml(role)}${showTechnicalMeta ? ' booking-banquet-member--technical' : ''}">
            <div class="booking-banquet-member-main">
                <div>
                    <div class="booking-banquet-member-title">${escapeHtml(bookingDetailTitle(booking))}</div>
                    ${metaParts.length ? `<div class="booking-banquet-member-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
                </div>
                <div class="booking-banquet-member-badges">
                    ${showRoleBadge ? `<span class="booking-banquet-role">${escapeHtml(bookingDetailRoleLabel(role))}</span>` : ''}
                    <span class="booking-banquet-status">${escapeHtml(bookingDetailStatusLabel(booking))}</span>
                    ${booking.price ? `<span class="booking-banquet-price">${escapeHtml(formatPrice(booking.price))}</span>` : ''}
                </div>
            </div>
            ${packageHtml}
            ${childrenHtml}
        </div>
    `;
}

function renderBanquetMemberSection(title, members, emptyText) {
    const rows = (members || []).filter(Boolean);
    return `
        <div class="booking-banquet-section">
            <div class="booking-banquet-section-title">${escapeHtml(title)}</div>
            ${rows.length
                ? rows.map(member => renderBanquetMemberCard(member)).join('')
                : `<div class="booking-banquet-empty">${escapeHtml(emptyText)}</div>`}
        </div>
    `;
}

function renderBanquetWorkSection(title, bodyHtml, modifier = '') {
    const content = String(bodyHtml || '').trim();
    if (!content) return '';
    return `
        <div class="booking-banquet-section booking-banquet-section--work${modifier ? ` booking-banquet-section--${escapeHtml(modifier)}` : ''}">
            <div class="booking-banquet-section-title">${escapeHtml(title)}</div>
            ${content}
        </div>
    `;
}

function renderBanquetMenuSection(packageBooking, entertainmentMembers = []) {
    const entertainmentRows = bookingDetailEntertainmentRowsFromMembers(entertainmentMembers, packageBooking);
    if ((!packageBooking || !bookingDetailHasMenuOverview(packageBooking)) && !entertainmentRows.length) return '';
    return renderBanquetWorkSection(
        'Меню',
        renderBookingPackageDetailSafe(packageBooking || {}, {
            title: 'Меню',
            compact: true,
            includeServiceEvents: false,
            showPackageHeader: false,
            showHeaderSummary: false,
            showServingTitles: false,
            showEntertainmentTitle: false,
            showEntertainmentTableHead: false,
            showEntertainmentKindBadge: false,
            entertainmentRows
        }),
        'menu'
    );
}

function renderBanquetServiceSection(packageBooking, serviceManualMembers = []) {
    const bookingPackage = packageBooking ? getBookingPackageFromBooking(packageBooking) : null;
    const serviceEvents = bookingPackage?.serviceEvents || [];
    const eventRows = serviceEvents.map(event => `
        <div class="booking-banquet-service-row booking-banquet-service-row--checklist">
            <span class="booking-banquet-service-check" aria-hidden="true"></span>
            <div class="booking-banquet-service-main">
                <strong>${event.time ? `${escapeHtml(event.time)} · ` : ''}${escapeHtml(event.title || BOOKING_SERVICE_EVENT_TYPES[event.type] || 'Сервіс')}</strong>
                ${event.note ? `<small>${escapeHtml(event.note)}</small>` : ''}
            </div>
        </div>
    `).join('');
    const manualRows = (serviceManualMembers || [])
        .map(member => renderBanquetMemberCard(member, member.role || 'service', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        }))
        .join('');
    return renderBanquetWorkSection(
        'Подачі / сервіс',
        `${eventRows}${manualRows}`,
        'service'
    );
}

function renderBanquetActivitiesSection(activityMembers = []) {
    const rows = (activityMembers || [])
        .map(member => renderBanquetMemberCard(member, 'activity', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        }))
        .join('');
    return renderBanquetWorkSection('Активності', rows, 'activities');
}

function renderFullBanquetCommentsSection(context = {}) {
    const comments = fullBanquetDetailCommentItems(context);
    if (!comments.length) return '';
    const rows = comments.map(comment => `
        <div class="booking-banquet-comment-row booking-banquet-comment-row--${escapeHtml(comment.type)}">
            <strong>${escapeHtml(comment.label)}</strong>
            <span>${escapeHtml(comment.text)}</span>
        </div>
    `).join('');
    return renderBanquetWorkSection('Примітки', `<div class="booking-banquet-comments booking-banquet-comments--compact">${rows}</div>`, 'comments');
}

function renderBanquetWarningsSection(warnings = []) {
    const rows = (warnings || [])
        .filter(Boolean)
        .map(message => `<div class="booking-banquet-warning">⚠ ${escapeHtml(message)}</div>`)
        .join('');
    return renderBanquetWorkSection('Попередження', rows, 'warnings');
}

function renderBanquetTechnicalSection({
    snapshot,
    members = [],
    technicalChildren = [],
    controlsHtml = '',
    hasGroup = false,
    isLegacy = false
} = {}) {
    const groupId = snapshot?.group?.id || snapshot?.groupId;
    const source = snapshot?.source || (isLegacy ? 'legacy_booking_banquet_links' : '');
    const memberRows = (members || []).map(member => {
        const booking = member.booking || member;
        const bookingId = bookingDetailId(booking);
        if (!bookingId) return '';
        const role = member.role || (member.isPrimary ? 'primary' : 'manual');
        return `
            <div class="booking-banquet-technical-row">
                <span>${escapeHtml(bookingId)}</span>
                <span>${escapeHtml(bookingDetailRoleLabel(role))}</span>
                <span>${escapeHtml(bookingDetailTitle(booking))}</span>
            </div>
        `;
    }).join('');
    const childRows = (technicalChildren || []).map(child => `
        <div class="booking-banquet-technical-row booking-banquet-technical-row--muted">
            <span>${escapeHtml(bookingDetailId(child) || '-')}</span>
            <span>Технічний запис</span>
            <span>${escapeHtml(bookingDetailTitle(child))}</span>
        </div>
    `).join('');
    const metaRows = [
        groupId ? ['groupId', groupId] : null,
        source ? ['source', source] : null,
        snapshot?.group?.status ? ['status', snapshot.group.status] : null
    ].filter(Boolean).map(([label, value]) => `
        <div class="booking-banquet-technical-meta-row">
            <span>${escapeHtml(label)}</span>
            <code>${escapeHtml(String(value))}</code>
        </div>
    `).join('');
    const body = `${metaRows}${memberRows || childRows ? `<div class="booking-banquet-technical-grid">${memberRows}${childRows}</div>` : ''}${controlsHtml}`;
    if (!body.trim() && !hasGroup) return '';
    return `
        <details class="booking-banquet-technical">
            <summary>Технічне</summary>
            <div class="booking-banquet-technical-body">
                ${body}
            </div>
        </details>
    `;
}

function renderBanquetCreateAction(anchorBooking = {}) {
    if (isViewer() || !bookingDetailIsRoot(anchorBooking)) return '';
    return `
        <div class="booking-banquet-action-row">
            <button type="button"
                    class="btn-secondary btn-sm booking-banquet-create-btn"
                    onclick="createBanquetGroupFromBookingDetails('${escapeHtml(bookingDetailId(anchorBooking))}')">
                Створити банкетну групу
            </button>
            <span>Створення нічого не обʼєднує автоматично. Інші броні додаються вручну.</span>
        </div>
    `;
}

function renderBanquetAttachCandidates(snapshot, anchorBooking = {}, allBookings = []) {
    const groupId = snapshot?.groupId || snapshot?.group?.id;
    if (isViewer() || !groupId) return '';
    const anchorId = bookingDetailId(anchorBooking);
    const anchorContext = bookingDetailContext(anchorBooking);
    const anchorDate = bookingDetailDate(anchorBooking);
    const anchorCustomerId = bookingDetailCustomerId(anchorBooking);
    const memberIds = banquetSnapshotMemberIds(snapshot);
    const candidates = (allBookings || [])
        .filter(candidate => {
            const candidateId = bookingDetailId(candidate);
            if (!candidateId || candidateId === anchorId) return false;
            if (!bookingDetailIsRoot(candidate)) return false;
            if (memberIds.has(candidateId)) return false;
            if (bookingDetailContext(candidate) !== anchorContext) return false;
            if (bookingDetailDate(candidate) !== anchorDate) return false;
            if (String(candidate.status || '').toLowerCase() === 'cancelled') return false;
            return true;
        })
        .sort((a, b) => {
            const aSameCustomer = anchorCustomerId && bookingDetailCustomerId(a) === anchorCustomerId ? 0 : 1;
            const bSameCustomer = anchorCustomerId && bookingDetailCustomerId(b) === anchorCustomerId ? 0 : 1;
            if (aSameCustomer !== bSameCustomer) return aSameCustomer - bSameCustomer;
            return `${a.time || ''}${a.id || ''}`.localeCompare(`${b.time || ''}${b.id || ''}`);
        })
        .slice(0, 12);
    if (!candidates.length) {
        return '';
    }
    return `
        <div class="booking-banquet-candidates">
            <div class="booking-banquet-section-title">Додати бронь до банкету</div>
            <div class="booking-banquet-candidate-hint">Кандидати підібрані тільки за тим самим бізнес-контекстом і датою. Збіг клієнта підсвічено, але менеджер додає бронь вручну.</div>
            ${candidates.map(candidate => {
                const candidateId = bookingDetailId(candidate);
                const defaultRole = bookingDetailDefaultAttachRole(candidate);
                const sameCustomer = anchorCustomerId && bookingDetailCustomerId(candidate) === anchorCustomerId;
                const label = candidate.groupName || candidate.label || candidate.programName || candidate.room || candidateId;
                return `
                    <div class="booking-banquet-candidate">
                        <div class="booking-banquet-candidate-main">
                            <strong>${escapeHtml(bookingDetailTitle(candidate))}</strong>
                            <small>${escapeHtml(label)} · ${escapeHtml(bookingDetailStatusLabel(candidate))}${candidate.price ? ` · ${escapeHtml(formatPrice(candidate.price))}` : ''}</small>
                            <span class="booking-banquet-candidate-badge booking-banquet-candidate-badge--${sameCustomer ? 'match' : 'manual'}">${sameCustomer ? 'той самий клієнт' : 'перевірити клієнта'}</span>
                        </div>
                        <select class="booking-banquet-candidate-role" data-banquet-candidate-role="${escapeHtml(candidateId)}">
                            <option value="kitchen" ${defaultRole === 'kitchen' ? 'selected' : ''}>Кухня</option>
                            <option value="activity" ${defaultRole === 'activity' ? 'selected' : ''}>Активність</option>
                            <option value="service" ${defaultRole === 'service' ? 'selected' : ''}>Сервіс</option>
                            <option value="manual" ${defaultRole === 'manual' ? 'selected' : ''}>Manual</option>
                        </select>
                        <button type="button"
                                class="btn-secondary btn-sm"
                                onclick="attachBookingToBanquetGroupFromDetails('${escapeHtml(String(groupId))}', '${escapeHtml(candidateId)}', '${escapeHtml(anchorId)}')">
                            Додати
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderFullBanquetDetail(anchorBooking = {}, allBookings = [], snapshot = null) {
    const hasGroup = banquetSnapshotHasGroup(snapshot);
    const isLegacy = snapshot?.legacyFallback || snapshot?.source === 'legacy_booking_banquet_links';
    const isSingle = snapshot?.source === 'single_booking' || !snapshot;
    const members = Array.isArray(snapshot?.members) ? snapshot.members : [];
    const hasExplicitLinks = [
        anchorBooking?.bookingLinks,
        anchorBooking?.banquetLinks,
        anchorBooking?.sharedRoomLinks
    ].some(items => Array.isArray(items) && items.length > 0);
    const hasStandaloneBanquetSurface = bookingDetailIsKitchenCandidate(anchorBooking)
        || bookingDetailHasServiceOverview(anchorBooking)
        || hasExplicitLinks;
    const shouldShow = hasGroup
        || isLegacy
        || hasStandaloneBanquetSurface
        || members.length > 1;
    if (!shouldShow) return '';

    const primaryMembers = members.filter(member => member.isPrimary);
    const primaryIds = new Set(primaryMembers.map(member => String(member.bookingId)));
    const kitchenMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && (member.role === 'kitchen' || member.isKitchenCandidate));
    const activityMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && member.role === 'activity' && !member.isKitchenCandidate);
    const entertainmentMembers = bookingDetailEntertainmentMembers(primaryMembers, activityMembers);
    const entertainmentIds = new Set(entertainmentMembers.map(member => bookingDetailId(member.booking || member)).filter(Boolean).map(String));
    const visiblePrimaryMembers = primaryMembers.filter(member => {
        const bookingId = String(member.bookingId || bookingDetailId(member.booking || member) || '');
        return !bookingId || !entertainmentIds.has(bookingId);
    });
    const visibleActivityMembers = activityMembers.filter(member => {
        const bookingId = String(member.bookingId || bookingDetailId(member.booking || member) || '');
        return !bookingId || !entertainmentIds.has(bookingId);
    });
    const serviceManualMembers = members.filter(member => !primaryIds.has(String(member.bookingId)) && ['service', 'manual'].includes(member.role) && !member.isKitchenCandidate);
    const technicalChildren = members.flatMap(member => (member.technicalChildren || []).map(child => ({ ...child, parentId: member.bookingId })));
    const packageBooking = banquetPackageBookingFromMembers(anchorBooking, primaryMembers, kitchenMembers, members);
    const warnings = buildBanquetDetailWarnings(snapshot, anchorBooking)
        .filter(message => hasGroup || isLegacy || message !== banquetWarningText({ code: 'kitchen_booking_missing' }));
    const sourceLabel = hasGroup
        ? 'Обʼєднано в банкетну групу'
        : (isLegacy ? 'Показано старі звʼязки банкету' : 'Банкетна група ще не створена');
    const groupMeta = hasGroup && snapshot.group
        ? [
            snapshot.group.groupName,
            snapshot.group.date,
            snapshot.group.room,
            snapshot.group.status
        ].filter(Boolean).join(' · ')
        : '';
    const primaryBody = visiblePrimaryMembers.length
        ? visiblePrimaryMembers.map(member => renderBanquetMemberCard(member, 'primary', {
            showPackage: false,
            showRoleBadge: false,
            showTechnicalMeta: false,
            showTechnicalChildren: false
        })).join('')
        : (isSingle ? '<div class="booking-banquet-summary-note">Група ще не створена. Ця бронь показана як основа банкету.</div>' : '');
    const technicalControls = [
        !hasGroup ? renderBanquetCreateAction(anchorBooking) : '',
        hasGroup ? renderBanquetAttachCandidates(snapshot, anchorBooking, allBookings) : '',
        !hasGroup ? renderBookingBanquetLinksDetail(anchorBooking, allBookings) : ''
    ].filter(Boolean).join('');
    return `
        <div class="booking-banquet-full-detail">
            <div class="booking-banquet-full-header">
                <div>
                    <div class="booking-banquet-full-title">Банкет</div>
                    <div class="booking-banquet-full-source">${escapeHtml(sourceLabel)}${groupMeta ? ` · ${escapeHtml(groupMeta)}` : ''}</div>
                </div>
                ${hasGroup ? `<span class="booking-banquet-group-pill">Активний</span>` : `<span class="booking-banquet-group-pill booking-banquet-group-pill--muted">${isLegacy ? 'Legacy' : 'Потребує групи'}</span>`}
            </div>
            ${renderBanquetDepositStatusSection(anchorBooking, snapshot)}
            ${renderBanquetWorkSection('Банкет', primaryBody, 'summary')}
            ${renderFullBanquetCommentsSection({ anchorBooking, primaryMembers, kitchenMembers, activityMembers, serviceManualMembers, members })}
            ${renderBanquetMenuSection(packageBooking, entertainmentMembers)}
            ${renderBanquetServiceSection(packageBooking, serviceManualMembers)}
            ${renderBanquetActivitiesSection(visibleActivityMembers)}
            ${renderBanquetWarningsSection(warnings)}
            ${renderBanquetTechnicalSection({
                snapshot,
                members,
                technicalChildren,
                controlsHtml: technicalControls,
                hasGroup,
                isLegacy
            })}
        </div>
    `;
}

    const api = {
        renderBanquetDepositStatusSection,
        renderBanquetMemberCard,
        renderBanquetMemberSection,
        renderBanquetWorkSection,
        renderBanquetMenuSection,
        renderBanquetServiceSection,
        renderBanquetActivitiesSection,
        renderFullBanquetCommentsSection,
        renderBanquetWarningsSection,
        renderBanquetTechnicalSection,
        renderBanquetCreateAction,
        renderBanquetAttachCandidates,
        renderFullBanquetDetail
    };

    root.BookingBanquetDetail = Object.assign(root.BookingBanquetDetail || {}, api);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.BookingBanquetDetail;
    }
})(typeof window !== 'undefined' ? window : globalThis);
