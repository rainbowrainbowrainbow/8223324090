#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

loadEnvFile();

const { pool, generateBookingNumber } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const { insertHistory } = require('../services/historyLog');

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--') && !arg.includes('=')));

function argValue(name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

const FIX = flags.has('--fix');
const STRICT = flags.has('--strict');
const CONTEXT = argValue('--context', DEFAULT_BUSINESS_CONTEXT);
const FROM = argValue('--from');
const TO = argValue('--to');
const LIMIT = Math.max(0, parseInt(argValue('--limit', '0'), 10) || 0);

const PARK_FALLBACK_LINE_COLORS = ['#10B981', '#3B82F6', '#F97316', '#06B6D4', '#84CC16', '#EC4899', '#64748B', '#8B5CF6'];

function fallbackLineColor(value) {
    const numeric = Math.abs(parseInt(value, 10) || 0);
    return PARK_FALLBACK_LINE_COLORS[numeric % PARK_FALLBACK_LINE_COLORS.length];
}

function staffAnimatorWhere(alias = 's') {
    return `(
        ${alias}.role_type = 'animator'
        OR ${alias}.department = 'animators'
        OR LOWER(COALESCE(${alias}.position, '')) LIKE '%animator%'
        OR LOWER(COALESCE(${alias}.position, '')) LIKE '%аніматор%'
    )`;
}

function parseExtraData(raw) {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
    if (typeof raw !== 'string' || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function linkedTimelineIdentityMismatch(existing, line) {
    const extra = parseExtraData(existing.extra_data);
    const identity = extra.timelineIdentity || extra.timeline_identity || {};
    const resourceId = identity.resourceId || identity.resource_id || null;
    if (!resourceId) return false;
    return String(resourceId) !== String(line.lineId || '');
}

function linkedLineMismatch(existing, line) {
    return String(existing.line_id || '') !== String(line.lineId || '');
}

function linkedTimelineIdentityExtra(existing, booking, line, source) {
    const extra = parseExtraData(existing.extra_data);
    extra.timelineIdentity = {
        ...(extra.timelineIdentity || {}),
        businessContext: CONTEXT,
        resourceId: String(line.lineId),
        lineId: String(line.lineId),
        resourceType: 'animator',
        resourceName: line.name || booking.second_animator || existing.second_animator || null,
        source
    };
    return extra;
}

async function resolveSecondAnimatorLine(client, booking, { createLine = false } = {}) {
    const date = String(booking.date || '').trim();
    const name = String(booking.second_animator || '').trim();
    if (!date || !name) return null;

    const existing = await client.query(
        `SELECT line_id, name, color
           FROM lines_by_date
          WHERE date = $1
            AND COALESCE(business_context, $2) = $2
            AND LOWER(BTRIM(name)) = LOWER(BTRIM($3))
          ORDER BY line_id
          LIMIT 1`,
        [date, CONTEXT, name]
    );
    if (existing.rows[0]) {
        return {
            lineId: String(existing.rows[0].line_id),
            name: existing.rows[0].name,
            color: existing.rows[0].color,
            source: 'lines_by_date'
        };
    }

    const staff = await client.query(
        `SELECT id, name, display_name, color
           FROM staff s
          WHERE s.is_active = true
            AND ${staffAnimatorWhere('s')}
            AND (
                LOWER(BTRIM(s.name)) = LOWER(BTRIM($1))
                OR LOWER(BTRIM(COALESCE(s.display_name, ''))) = LOWER(BTRIM($1))
            )
          ORDER BY s.name
          LIMIT 1`,
        [name]
    );
    const staffRow = staff.rows[0];
    if (!staffRow) return null;

    const line = {
        lineId: String(staffRow.id),
        name: staffRow.display_name || staffRow.name,
        color: staffRow.color || fallbackLineColor(staffRow.id),
        source: createLine ? 'staff_inserted_line' : 'staff_candidate',
        wouldCreateLine: !createLine
    };

    if (createLine) {
        await client.query(
            `INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
             VALUES ($1, $2, $3, $4, $5, false)
             ON CONFLICT (business_context, date, line_id)
             DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
            [CONTEXT, date, line.lineId, line.name, line.color]
        );
    }

    return line;
}

async function loadCandidateBookings(client) {
    const params = [CONTEXT];
    const filters = [
        `COALESCE(b.business_context, $1) = $1`,
        `b.linked_to IS NULL`,
        `COALESCE(b.status, 'confirmed') <> 'cancelled'`,
        `COALESCE(b.hosts, 0) > 1`,
        `NULLIF(BTRIM(b.second_animator), '') IS NOT NULL`
    ];
    if (FROM) {
        params.push(FROM);
        filters.push(`b.date >= $${params.length}`);
    }
    if (TO) {
        params.push(TO);
        filters.push(`b.date <= $${params.length}`);
    }

    const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const result = await client.query(
        `SELECT b.id, b.business_context, b.date, b.time, b.line_id, b.program_id, b.program_code,
                b.label, b.program_name, b.category, b.duration, b.hosts, b.second_animator,
                b.pinata_filler, b.pinata_mode, b.pinata_number, b.pinata_filler_number,
                b.client_pinata_service_price, b.client_pinata_service_note, b.costume, b.room,
                b.notes, b.created_by, b.status, b.kids_count, b.group_name
           FROM bookings b
          WHERE ${filters.join('\n            AND ')}
          ORDER BY b.date, b.time, b.id
          ${limitSql}`,
        params
    );
    return result.rows;
}

async function existingLinkedSecondAnimator(client, booking, line) {
    const result = await client.query(
        `SELECT id, line_id, second_animator, extra_data
           FROM bookings
          WHERE linked_to = $1
            AND COALESCE(business_context, $2) = $2
            AND COALESCE(status, 'confirmed') <> 'cancelled'
            AND (
                line_id = $3
                OR LOWER(BTRIM(COALESCE(second_animator, ''))) = LOWER(BTRIM($4))
                OR LOWER(BTRIM(COALESCE(second_animator, ''))) = LOWER(BTRIM($5))
            )
          ORDER BY id
          LIMIT 1`,
        [booking.id, CONTEXT, line.lineId, booking.second_animator || '', line.name || '']
    );
    return result.rows[0] || null;
}

async function insertLinkedSecondAnimator(client, booking, line) {
    const linkedId = await generateBookingNumber(client);
    await client.query(
        `INSERT INTO bookings (
            id, business_context, date, time, line_id, program_id, program_code, label,
            program_name, category, duration, price, hosts, second_animator, pinata_filler,
            pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price,
            client_pinata_service_note, costume, room, notes, created_by, linked_to, status,
            kids_count, group_name, extra_data, skip_notification
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$17,$18,$19,
            $20,$21,$22,$23,$24,$25,$26,$27,$28,true
        )`,
        [
            linkedId,
            CONTEXT,
            booking.date,
            booking.time,
            line.lineId,
            booking.program_id,
            booking.program_code,
            booking.label,
            booking.program_name,
            booking.category,
            booking.duration,
            booking.hosts,
            line.name,
            booking.pinata_filler,
            booking.pinata_mode,
            booking.pinata_number,
            booking.pinata_filler_number,
            booking.client_pinata_service_price,
            booking.client_pinata_service_note,
            booking.costume || null,
            booking.room,
            booking.notes,
            booking.created_by,
            booking.id,
            booking.status || 'confirmed',
            booking.kids_count || null,
            booking.group_name || null,
            JSON.stringify({
                timelineIdentity: {
                    businessContext: CONTEXT,
                    resourceId: line.lineId,
                    lineId: line.lineId,
                    resourceType: 'animator',
                    resourceName: line.name,
                    source: 'second_animator_repair'
                },
                secondAnimatorRepair: {
                    source: 'scripts/audit-second-animator-links',
                    repairedAt: new Date().toISOString(),
                    mainBookingId: booking.id
                }
            })
        ]
    );
    await insertHistory(client, {
        businessContext: CONTEXT,
        action: 'repair_second_animator_link',
        username: 'system',
        data: { mainBookingId: booking.id, linkedBookingId: linkedId, secondAnimator: line.name }
    });
    return linkedId;
}

async function repairLinkedTimelineIdentity(client, booking, existing, line) {
    const extra = linkedTimelineIdentityExtra(existing, booking, line, 'second_animator_identity_repair');
    await client.query(
        `UPDATE bookings
            SET extra_data = $1
          WHERE id = $2
            AND COALESCE(business_context, $3) = $3`,
        [JSON.stringify(extra), existing.id, CONTEXT]
    );
    await insertHistory(client, {
        businessContext: CONTEXT,
        action: 'repair_second_animator_identity',
        username: 'system',
        data: {
            mainBookingId: booking.id,
            linkedBookingId: existing.id,
            secondAnimator: line.name,
            lineId: existing.line_id || line.lineId
        }
    });
}

async function repairLinkedTimelineLine(client, booking, existing, line) {
    const extra = linkedTimelineIdentityExtra(existing, booking, line, 'second_animator_line_repair');
    await client.query(
        `UPDATE bookings
            SET line_id = $1,
                second_animator = $2,
                extra_data = $3
          WHERE id = $4
            AND COALESCE(business_context, $5) = $5`,
        [line.lineId, line.name || booking.second_animator || existing.second_animator || null, JSON.stringify(extra), existing.id, CONTEXT]
    );
    await insertHistory(client, {
        businessContext: CONTEXT,
        action: 'repair_second_animator_line',
        username: 'system',
        data: {
            mainBookingId: booking.id,
            linkedBookingId: existing.id,
            secondAnimator: line.name,
            oldLineId: existing.line_id || null,
            newLineId: line.lineId
        }
    });
}

async function main() {
    const client = await pool.connect();
    const missing = [];
    const unresolved = [];
    const identityMismatches = [];
    const lineMismatches = [];
    const repaired = [];
    const alreadyLinked = [];

    try {
        const candidates = await loadCandidateBookings(client);
        for (const booking of candidates) {
            let line = await resolveSecondAnimatorLine(client, booking, { createLine: false });
            if (!line) {
                unresolved.push(booking);
                continue;
            }
            const existing = await existingLinkedSecondAnimator(client, booking, line);
            if (existing) {
                const hasLineMismatch = linkedLineMismatch(existing, line);
                const hasIdentityMismatch = linkedTimelineIdentityMismatch(existing, line);
                if (!hasLineMismatch && !hasIdentityMismatch) {
                    alreadyLinked.push({ booking, existing });
                    continue;
                }
                if (hasLineMismatch) lineMismatches.push({ booking, existing, line });
                if (hasIdentityMismatch) identityMismatches.push({ booking, existing, line });
                if (!FIX) continue;

                await client.query('BEGIN');
                try {
                    if (hasLineMismatch) {
                        await repairLinkedTimelineLine(client, booking, existing, line);
                    } else {
                        await repairLinkedTimelineIdentity(client, booking, existing, line);
                    }
                    await client.query('COMMIT');
                    repaired.push({ booking, line, linkedId: existing.id, identityOnly: !hasLineMismatch, lineOnly: hasLineMismatch });
                } catch (err) {
                    await client.query('ROLLBACK').catch(() => {});
                    throw err;
                }
                continue;
            }
            missing.push({ booking, line });

            if (!FIX) continue;

            await client.query('BEGIN');
            try {
                line = await resolveSecondAnimatorLine(client, booking, { createLine: true });
                const duplicateCheck = await existingLinkedSecondAnimator(client, booking, line);
                if (duplicateCheck) {
                    const hasLineMismatch = linkedLineMismatch(duplicateCheck, line);
                    const hasIdentityMismatch = linkedTimelineIdentityMismatch(duplicateCheck, line);
                    if (hasLineMismatch || hasIdentityMismatch) {
                        if (hasLineMismatch) {
                            await repairLinkedTimelineLine(client, booking, duplicateCheck, line);
                        } else {
                            await repairLinkedTimelineIdentity(client, booking, duplicateCheck, line);
                        }
                        await client.query('COMMIT');
                        if (hasLineMismatch) lineMismatches.push({ booking, existing: duplicateCheck, line });
                        if (hasIdentityMismatch) identityMismatches.push({ booking, existing: duplicateCheck, line });
                        repaired.push({ booking, line, linkedId: duplicateCheck.id, identityOnly: !hasLineMismatch, lineOnly: hasLineMismatch });
                        continue;
                    }
                    await client.query('ROLLBACK');
                    alreadyLinked.push({ booking, existing: duplicateCheck });
                    continue;
                }
                const linkedId = await insertLinkedSecondAnimator(client, booking, line);
                await client.query('COMMIT');
                repaired.push({ booking, line, linkedId });
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                throw err;
            }
        }
    } finally {
        client.release();
        await pool.end();
    }

    const mismatchKeys = new Set([...identityMismatches, ...lineMismatches]
        .map(item => `${item.booking.id}:${item.existing.id}`));

    console.log(`Second animator link audit (${FIX ? 'fix' : 'dry-run'})`);
    console.log(`context=${CONTEXT} from=${FROM || '*'} to=${TO || '*'} candidates=${missing.length + alreadyLinked.length + unresolved.length + mismatchKeys.size}`);
    console.log(`ok=${alreadyLinked.length} missing=${missing.length} line_mismatch=${lineMismatches.length} identity_mismatch=${identityMismatches.length} unresolved=${unresolved.length} repaired=${repaired.length}`);

    const sample = missing.slice(0, 50);
    for (const item of sample) {
        const note = item.line.wouldCreateLine ? 'missing linked; line can be created from staff' : 'missing linked';
        console.log(`MISSING ${item.booking.id} ${item.booking.date} ${item.booking.time} second="${item.booking.second_animator}" line=${item.line.lineId} ${note}`);
    }
    for (const booking of unresolved.slice(0, 50)) {
        console.log(`UNRESOLVED ${booking.id} ${booking.date} ${booking.time} second="${booking.second_animator}"`);
    }
    for (const item of identityMismatches.slice(0, 50)) {
        console.log(`MISMATCH ${item.booking.id} -> ${item.existing.id} ${item.booking.date} ${item.booking.time} second="${item.booking.second_animator}" line=${item.existing.line_id}`);
    }
    for (const item of lineMismatches.slice(0, 50)) {
        console.log(`LINE_MISMATCH ${item.booking.id} -> ${item.existing.id} ${item.booking.date} ${item.booking.time} second="${item.booking.second_animator}" old_line=${item.existing.line_id || '*'} expected_line=${item.line.lineId}`);
    }
    for (const item of repaired) {
        const mode = item.lineOnly ? 'line' : (item.identityOnly ? 'identity' : 'linked');
        console.log(`REPAIRED ${mode} ${item.booking.id} -> ${item.linkedId} second="${item.line.name}" line=${item.line.lineId}`);
    }

    if ((STRICT || FIX) && unresolved.length > 0) process.exitCode = 1;
    if (STRICT && (missing.length + mismatchKeys.size) > repaired.length) process.exitCode = 1;
}

function friendlyDbError(err) {
    if (err?.code === 'ECONNREFUSED' || err?.errors?.some(item => item?.code === 'ECONNREFUSED')) {
        return 'Database connection unavailable. Set DATABASE_URL or run this script on a machine with access to PostgreSQL.';
    }
    return err?.message || String(err);
}

main().catch(err => {
    console.error(friendlyDbError(err));
    process.exitCode = 1;
});
