const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    GUARDIAN_DIRECTOR_DM_SLUG,
    provisionGuardianDirectorDm
} = require('../services/guardianDmProvisioning');

let state;

function resetState() {
    state = {
        nextChannelId: 200,
        channels: [],
        memberships: new Set(),
        tx: [],
        queries: [],
        releases: 0
    };
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function cloneChannel(channel) {
    return channel ? { ...channel } : null;
}

function createFakePool({ failMemberInsert = false } = {}) {
    function makeClient() {
        const pendingChannels = [];
        const pendingMemberships = new Set();

        function visibleChannels() {
            return [...state.channels, ...pendingChannels];
        }

        function hasMembership(channelId, userId) {
            return state.memberships.has(`${channelId}:${userId}`) ||
                pendingMemberships.has(`${channelId}:${userId}`);
        }

        return {
            query: async (sql, params = []) => {
                const text = normalizeSql(sql);
                state.queries.push({ text, params });

                if (text === 'BEGIN') {
                    state.tx.push('BEGIN');
                    return { rows: [], rowCount: 0 };
                }
                if (text === 'COMMIT') {
                    state.tx.push('COMMIT');
                    state.channels.push(...pendingChannels.map(cloneChannel));
                    for (const member of pendingMemberships) state.memberships.add(member);
                    return { rows: [], rowCount: 0 };
                }
                if (text === 'ROLLBACK') {
                    state.tx.push('ROLLBACK');
                    return { rows: [], rowCount: 0 };
                }

                if (/FROM chat_channels WHERE slug = \$1/i.test(text)) {
                    const channel = visibleChannels().find(row =>
                        row.slug === params[0] &&
                        row.is_archived !== true
                    );
                    return { rows: channel ? [cloneChannel(channel)] : [], rowCount: channel ? 1 : 0 };
                }

                if (/FROM chat_channels c JOIN chat_channel_members m1/i.test(text)) {
                    const [guardianId, directorId] = params;
                    const channel = visibleChannels().find(row =>
                        row.is_dm === true &&
                        row.is_archived !== true &&
                        hasMembership(row.id, guardianId) &&
                        hasMembership(row.id, directorId)
                    );
                    return { rows: channel ? [cloneChannel(channel)] : [], rowCount: channel ? 1 : 0 };
                }

                if (/UPDATE chat_channels SET is_dm = true,/i.test(text)) {
                    const [channelId, dmUserIds] = params;
                    const channel = visibleChannels().find(row => row.id === channelId);
                    if (!channel) return { rows: [], rowCount: 0 };
                    channel.is_dm = true;
                    channel.dm_user_ids ||= dmUserIds;
                    return { rows: [cloneChannel(channel)], rowCount: 1 };
                }

                if (/INSERT INTO chat_channels \(name, slug, description, is_default, is_dm, dm_user_ids, created_by\)/i.test(text)) {
                    const [name, slug, description, dmUserIds, createdBy] = params;
                    let channel = visibleChannels().find(row => row.slug === slug);
                    const inserted = !channel;
                    if (!channel) {
                        channel = {
                            id: state.nextChannelId++,
                            name,
                            slug,
                            description,
                            is_default: false,
                            is_dm: true,
                            dm_user_ids: dmUserIds,
                            created_by: createdBy,
                            is_archived: false
                        };
                        pendingChannels.push(channel);
                    } else {
                        channel.name ||= name;
                        channel.description ||= description;
                        channel.is_dm = true;
                        channel.dm_user_ids ||= dmUserIds;
                    }
                    return { rows: [{ ...channel, inserted }], rowCount: 1 };
                }

                if (/INSERT INTO chat_channel_members \(channel_id, user_id\) VALUES/i.test(text)) {
                    if (failMemberInsert) throw new Error('simulated member insert failure');
                    const [channelId, guardianId, directorId] = params;
                    pendingMemberships.add(`${channelId}:${guardianId}`);
                    pendingMemberships.add(`${channelId}:${directorId}`);
                    return { rows: [], rowCount: 2 };
                }

                throw new Error(`Unexpected query: ${text}`);
            },
            release: () => {
                state.releases += 1;
            }
        };
    }

    return {
        connect: async () => makeClient()
    };
}

describe('Guardian director DM provisioning', () => {
    beforeEach(() => {
        resetState();
    });

    it('creates one deterministic DM and reuses it on repeated provisioning', async () => {
        const pool = createFakePool();

        const first = await provisionGuardianDirectorDm({ pool, guardianId: 11, directorId: 22 });
        const second = await provisionGuardianDirectorDm({ pool, guardianId: 11, directorId: 22 });

        assert.equal(first.isNew, true);
        assert.equal(second.isNew, false);
        assert.equal(second.existingBySlug, true);
        assert.equal(first.channelId, second.channelId);
        assert.equal(state.channels.length, 1);
        assert.equal(state.channels[0].slug, GUARDIAN_DIRECTOR_DM_SLUG);
        assert.deepEqual(state.channels[0].dm_user_ids, [11, 22]);
        assert.equal(state.memberships.has(`${first.channelId}:11`), true);
        assert.equal(state.memberships.has(`${first.channelId}:22`), true);
        assert.equal(state.queries.some(q => /ON CONFLICT \(slug\) DO UPDATE/i.test(q.text)), true);
    });

    it('reuses a legacy DM channel already connecting Guardian and director', async () => {
        state.channels.push({
            id: 77,
            slug: 'legacy-guardian-director',
            name: 'Legacy Guardian DM',
            is_dm: true,
            is_archived: false
        });
        state.memberships.add('77:11');
        state.memberships.add('77:22');

        const result = await provisionGuardianDirectorDm({
            pool: createFakePool(),
            guardianId: 11,
            directorId: 22
        });

        assert.equal(result.channelId, 77);
        assert.equal(result.isNew, false);
        assert.equal(result.existingByMembers, true);
        assert.equal(state.channels.length, 1);
        assert.equal(state.channels[0].slug, 'legacy-guardian-director');
    });

    it('repairs deterministic slug shells by initializing both members transactionally', async () => {
        state.channels.push({
            id: 88,
            slug: GUARDIAN_DIRECTOR_DM_SLUG,
            name: 'Guardian shell',
            is_dm: false,
            is_archived: false
        });

        const result = await provisionGuardianDirectorDm({
            pool: createFakePool(),
            guardianId: 11,
            directorId: 22
        });

        assert.equal(result.channelId, 88);
        assert.equal(result.isNew, false);
        assert.equal(result.existingBySlug, true);
        assert.equal(state.channels.length, 1);
        assert.equal(state.channels[0].is_dm, true);
        assert.deepEqual(state.channels[0].dm_user_ids, [11, 22]);
        assert.equal(state.memberships.has('88:11'), true);
        assert.equal(state.memberships.has('88:22'), true);
    });

    it('rolls back channel creation if member initialization fails', async () => {
        await assert.rejects(
            () => provisionGuardianDirectorDm({
                pool: createFakePool({ failMemberInsert: true }),
                guardianId: 11,
                directorId: 22
            }),
            /simulated member insert failure/
        );

        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.channels.length, 0);
        assert.equal(state.memberships.size, 0);
        assert.equal(state.releases, 1);
    });
});
