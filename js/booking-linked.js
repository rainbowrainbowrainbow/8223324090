/**
 * booking-linked.js - Linked booking management helpers
 * Load after booking.js in index.html
 *
 * Provides: window.BookingLinked = { build, getRelated, moveAll }
 */

window.BookingLinked = {
    /**
     * Build linked bookings for a main booking (delegates to buildLinkedBookings)
     * @param {Object} booking - Main booking object
     * @param {Object} program - Program details
     * @returns {Promise<Array>} Array of linked booking objects
     */
    async build(booking, program) {
        return typeof buildLinkedBookings === 'function'
            ? buildLinkedBookings(booking, program)
            : [];
    },

    /**
     * Find all related bookings (main + linked) for a given booking ID
     * @param {string} bookingId - Booking ID to find relations for
     * @param {Array} allBookings - All bookings for the date
     * @returns {{ main: Object|null, linked: Array }}
     */
    getRelated(bookingId, allBookings) {
        const booking = allBookings.find(b => b.id === bookingId);
        if (!booking) return { main: null, linked: [] };

        let mainId = bookingId;
        if (booking.linkedTo) {
            mainId = booking.linkedTo;
        }

        const main = allBookings.find(b => b.id === mainId) || null;
        const linked = allBookings.filter(b => b.linkedTo === mainId);

        return { main, linked };
    },

    /**
     * Calculate new positions for all linked bookings after moving main
     * @param {Object} mainBooking - Main booking with new time/lineId
     * @param {Array} linkedBookings - Linked bookings to recalculate
     * @param {number} timeDeltaMinutes - Time shift in minutes
     * @returns {Array} Updated linked bookings with new times
     */
    moveAll(mainBooking, linkedBookings, timeDeltaMinutes) {
        return linkedBookings.map(linked => ({
            ...linked,
            time: typeof addMinutesToTime === 'function'
                ? addMinutesToTime(linked.time, timeDeltaMinutes)
                : linked.time
        }));
    },

    /**
     * Validate that all linked bookings can be placed without conflicts
     * @param {Array} linkedBookings - Linked bookings with new positions
     * @param {Array} allBookings - All bookings for conflict check
     * @returns {{ valid: boolean, conflicts: Array }}
     */
    validatePositions(linkedBookings, allBookings) {
        const conflicts = [];

        for (const linked of linkedBookings) {
            const start = typeof timeToMinutes === 'function' ? timeToMinutes(linked.time) : 0;
            const end = start + linked.duration;

            const lineBookings = allBookings.filter(
                b => b.lineId === linked.lineId && b.id !== linked.id && b.linkedTo !== linked.linkedTo
            );

            for (const other of lineBookings) {
                const oStart = typeof timeToMinutes === 'function' ? timeToMinutes(other.time) : 0;
                const oEnd = oStart + other.duration;

                if (start < oEnd && end > oStart) {
                    conflicts.push({
                        linked,
                        conflictsWith: other,
                        message: `Конфлікт на лінії ${linked.lineId}: ${linked.time} - ${other.label || other.programCode} о ${other.time}`
                    });
                }
            }
        }

        return { valid: conflicts.length === 0, conflicts };
    }
};
