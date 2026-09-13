'use strict';

class BookingLinkOwnershipError extends Error {
    constructor(code) {
        super('Linked booking must belong to the active business.');
        this.name = 'BookingLinkOwnershipError';
        this.code = code;
        this.statusCode = 422;
        this.publicMessage = 'Пов’язане бронювання недоступне в цьому бізнесі.';
    }
}

function linkedBookingId(value) {
    if (value === null || value === undefined) return null;
    const id = String(value).trim();
    return id || null;
}

// Generic booking writes store a string link rather than a foreign key. The caller
// holds its write transaction while this locks the target row against deletion.
async function assertBookingLinkedParent(client, { childId, linkedTo, businessContext }) {
    const parentId = linkedBookingId(linkedTo);
    if (!parentId) return null;
    if (String(childId || '').trim() === parentId) {
        throw new BookingLinkOwnershipError('linked_booking_parent_self');
    }

    const result = await client.query(
        'SELECT id, business_context FROM bookings WHERE id = $1 FOR KEY SHARE',
        [parentId]
    );
    const parent = result.rows[0];
    if (!parent || String(parent.business_context || '') !== String(businessContext || '')) {
        throw new BookingLinkOwnershipError('linked_booking_parent_unavailable');
    }
    return parent;
}

module.exports = { BookingLinkOwnershipError, assertBookingLinkedParent, linkedBookingId };
