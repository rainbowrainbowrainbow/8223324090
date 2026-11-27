'use strict';

const { validateTime } = require('./booking');
const { shiftCalendarDate } = require('../utils/financeReporting');

const localDateTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const dateTimeWithOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset'
});

function offsetMilliseconds(instant) {
    const { value } = dateTimeWithOffset.formatToParts(instant).find(part => part.type === 'timeZoneName');
    const [, sign, hours, minutes] = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value);
    return (sign === '+' ? 1 : -1) * (Number(hours) * 60 + Number(minutes || 0)) * 60_000;
}

function kyivInstant(date, time) {
    const wallClock = Date.parse(date + 'T' + time + ':00Z');
    const before = wallClock - offsetMilliseconds(wallClock - 86_400_000);
    const after = wallClock - offsetMilliseconds(wallClock + 86_400_000);
    if (before === after) return before;

    // Use the first occurrence when clocks repeat, and shift forward when
    // the requested wall-clock time does not exist.
    const label = date + ' ' + time;
    const matching = [before, after].filter(candidate => localDateTime.format(candidate) === label);
    return matching.length ? Math.min(...matching) : Math.max(before, after);
}

function monthStartAfter(date) {
    const next = new Date(date.slice(0, 7) + '-01T12:00:00Z');
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next.toISOString().slice(0, 10);
}

function buildSlot(kind, date, time) {
    const endExclusive = kind === 'monthly' ? monthStartAfter(date) : shiftCalendarDate(date, 1);
    return {
        kind,
        key: kind + ':' + date,
        from: date,
        to: shiftCalendarDate(endExclusive, -1),
        scheduledAt: kyivInstant(date, time),
        expiresAt: kyivInstant(shiftCalendarDate(date, 1), '00:00')
    };
}

function automaticAnnouncementSlots(recipient, now = new Date()) {
    const due = [];
    const upcoming = [];
    if (!recipient.active) return { due, upcoming };
    const today = localDateTime.format(now).slice(0, 10);
    const rules = [];
    if (recipient.afishaMode === 'monthly' && validateTime(recipient.monthlyTime)) {
        rules.push(['monthly', recipient.monthlyTime, recipient.monthlyEnabledAt]);
    }
    if ((recipient.eventsToday || recipient.promotionsToday) && validateTime(recipient.dailyTime)) {
        rules.push(['daily', recipient.dailyTime, recipient.dailyEnabledAt]);
    }

    for (const [kind, time, enabledAt] of rules) {
        const enabled = enabledAt == null ? NaN : new Date(enabledAt).getTime();
        if (!Number.isFinite(enabled) || enabled > now.getTime()) continue;
        if (kind === 'daily' || today.endsWith('-01')) {
            const slot = buildSlot(kind, today, time);
            if (slot.scheduledAt >= enabled && slot.scheduledAt <= now.getTime() && now.getTime() < slot.expiresAt) due.push(slot);
            if (slot.scheduledAt > now.getTime()) {
                upcoming.push(slot);
                continue;
            }
        }
        const next = kind === 'monthly' ? monthStartAfter(today) : shiftCalendarDate(today, 1);
        upcoming.push(buildSlot(kind, next, time));
    }
    upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt);
    return { due, upcoming };
}

module.exports = { automaticAnnouncementSlots };
