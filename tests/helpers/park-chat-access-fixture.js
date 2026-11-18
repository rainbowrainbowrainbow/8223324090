'use strict';

// Explicit Park membership fixtures for focused Chat route tests. Runtime never
// restores legacy authorization when the membership schema is unavailable.
function parkChatFixtureQuery(sql, params, { isMember = () => false,
    channelById = id => ({ id }), bookingById = () => null } = {}) {
    const row = { organization_id: 1, business_id: 2, context_key: 'event_genix',
        business_status: 'active', organization_status: 'active', access_mode: 'membership',
        role: 'creator', business_modules: ['chat', 'timeline', 'tasks', 'warehouse'], is_default: true };
    let rows;
    if (sql.includes('FROM organization_memberships om')) rows = [row];
    else if (sql.includes('FROM businesses b JOIN organizations')) rows = [row];
    else if (sql.includes('FROM chat_channels c JOIN chat_channel_members member')) {
        const channel = isMember(Number(params[0]), Number(params[1])) && channelById(Number(params[0]));
        rows = channel ? [channel] : [];
    } else if (sql.startsWith('SELECT b.id FROM bookings b WHERE b.id = $1')) {
        const booking = bookingById(params[0]); rows = booking ? [booking] : [];
    } else return null;
    return { rows, rowCount: rows.length };
}

module.exports = { parkChatFixtureQuery };
