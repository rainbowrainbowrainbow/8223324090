#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const APPLY_CONFIRMATION = 'ATTACH_CONFIRMED_PINATAS';
const DETACH_CONFIRMATION = 'DETACH_CONFIRMED_PINATAS';
const RECOVERY_ACTOR = 'banquet-pinata-recovery';
const BANQUET_RELATION_TYPE = 'banquet_activity';
const SAFE_QA_CLEANUP_BOOKING_IDS = Object.freeze(
    Array.from({ length: 7 }, (_, index) => `BK-2026-${String(662 + index).padStart(4, '0')}`)
);

function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

function argValue(args, name, fallback = null) {
    const exact = args.find(arg => arg.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const index = args.indexOf(name);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return fallback;
}

function normalizeBusinessContext(value) {
    const normalized = String(value || DEFAULT_BUSINESS_CONTEXT).trim().toLowerCase();
    return ['park_zakrevsky', 'park', 'pzp'].includes(normalized)
        ? DEFAULT_BUSINESS_CONTEXT
        : (normalized || DEFAULT_BUSINESS_CONTEXT);
}

function contextSql(alias, placeholder) {
    return `CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(${alias}.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
             IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(${alias}.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
    END = ${placeholder}`;
}

function activeSql(alias) {
    return `LOWER(COALESCE(NULLIF(BTRIM(${alias}.status), ''), 'confirmed')) <> 'cancelled'`;
}

function pinataSql(alias) {
    return `(
        LOWER(COALESCE(NULLIF(BTRIM(${alias}.category), ''), '')) = 'pinata'
        OR LOWER(COALESCE(NULLIF(BTRIM(${alias}.program_id), ''), '')) = 'pinata'
        OR LOWER(COALESCE(NULLIF(BTRIM(${alias}.program_code), ''), '')) IN ('pin', 'pinata')
    )`;
}

function validateDateArg(value, name) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
        throw new Error(`${name} must be YYYY-MM-DD`);
    }
}

function parseAuditOptions(argv = []) {
    const from = argValue(argv, '--from');
    const to = argValue(argv, '--to', from);
    const businessContext = normalizeBusinessContext(
        argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT))
    );
    validateDateArg(from, '--from');
    validateDateArg(to, '--to');
    if (from > to) throw new Error('--from must be before or equal to --to');
    return {
        command: 'audit',
        from,
        to,
        businessContext,
        json: argv.includes('--json'),
        strict: argv.includes('--strict')
    };
}

function cleanTechnicalId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.length > 100 || /[\s,:]/.test(id)) {
        throw new Error(`${label} must be a non-empty technical id without spaces, commas, or colons`);
    }
    return id;
}

function parseRecoveryPairs(value) {
    const rawPairs = String(value || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (!rawPairs.length) {
        throw new Error('Recovery requires --pairs=<pinata-booking-id:banquet-group-id,...>');
    }
    const byBookingId = new Map();
    for (const rawPair of rawPairs) {
        const parts = rawPair.split(':');
        if (parts.length !== 2) {
            throw new Error(`Invalid recovery pair: ${rawPair}`);
        }
        const bookingId = cleanTechnicalId(parts[0], 'pinata booking id');
        const groupId = cleanTechnicalId(parts[1], 'banquet group id');
        const existing = byBookingId.get(bookingId);
        if (existing && existing.groupId !== groupId) {
            throw new Error(`Pinata booking ${bookingId} is allowlisted for more than one group`);
        }
        byBookingId.set(bookingId, { bookingId, groupId });
    }
    return [...byBookingId.values()]
        .sort((left, right) => left.bookingId.localeCompare(right.bookingId) || left.groupId.localeCompare(right.groupId));
}

function parseRecoveryOptions(argv = []) {
    const apply = argv.includes('--apply');
    const options = {
        command: 'recover',
        apply,
        json: argv.includes('--json'),
        businessContext: normalizeBusinessContext(
            argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT))
        ),
        confirmation: String(argValue(argv, '--confirm', '') || '').trim(),
        pairs: parseRecoveryPairs(argValue(argv, '--pairs', ''))
    };
    if (apply && options.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
    }
    return options;
}

function parseDetachOptions(argv = []) {
    const apply = argv.includes('--apply');
    const options = {
        command: 'detach',
        apply,
        json: argv.includes('--json'),
        businessContext: normalizeBusinessContext(
            argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT))
        ),
        confirmation: String(argValue(argv, '--confirm', '') || '').trim(),
        pairs: parseRecoveryPairs(argValue(argv, '--pairs', ''))
    };
    if (apply && options.confirmation !== DETACH_CONFIRMATION) {
        throw new Error(`Detach apply requires --confirm=${DETACH_CONFIRMATION}`);
    }
    return options;
}

function parseBookingIdList(value, label = 'booking id') {
    const ids = String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => cleanTechnicalId(item, label));
    if (!ids.length) throw new Error(`${label} list must contain at least one id`);
    return [...new Set(ids)].sort();
}

function parseQaCleanupOptions(argv = []) {
    if (argv.includes('--apply')) {
        throw new Error('QA cleanup supports read-only dry-run only; production deletion requires a separate approved implementation path');
    }
    const bookingIds = parseBookingIdList(
        argValue(argv, '--bookings', SAFE_QA_CLEANUP_BOOKING_IDS.join(',')),
        'QA booking id'
    );
    const allowed = new Set(SAFE_QA_CLEANUP_BOOKING_IDS);
    const refused = bookingIds.filter(id => !allowed.has(id));
    if (refused.length) {
        throw new Error(
            `QA cleanup is allowlisted only for ${SAFE_QA_CLEANUP_BOOKING_IDS.join(',')}; refused ${refused.join(',')}`
        );
    }
    return {
        command: 'qa-cleanup',
        apply: false,
        json: argv.includes('--json'),
        businessContext: normalizeBusinessContext(
            argValue(argv, '--business-context', argValue(argv, '--context', DEFAULT_BUSINESS_CONTEXT))
        ),
        bookingIds
    };
}

function parseArgs(argv = process.argv.slice(2)) {
    const command = String(argv[0] || '').trim().toLowerCase();
    if (command === 'audit') return parseAuditOptions(argv.slice(1));
    if (command === 'recover') return parseRecoveryOptions(argv.slice(1));
    if (command === 'detach' || command === 'rollback') return parseDetachOptions(argv.slice(1));
    if (command === 'qa-cleanup') return parseQaCleanupOptions(argv.slice(1));
    throw new Error('First argument must be audit, recover, detach, or qa-cleanup');
}

function matchFingerprint(row = {}) {
    return crypto.createHash('sha256').update([
        normalizeBusinessContext(row.business_context || row.businessContext),
        String(row.date || '').slice(0, 10),
        String(row.room || '').trim(),
        String(row.customer_id ?? row.customerId ?? '')
    ].join('\u0001')).digest('hex').slice(0, 16);
}

function normalizedGroupIds(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '')
            .replace(/^\{|\}$/g, '')
            .split(',');
    return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))].sort();
}

function normalizedTechnicalArray(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort();
    }
    return [...new Set(String(value || '')
        .replace(/^\{|\}$/g, '')
        .split(',')
        .map(item => String(item || '').trim().replace(/^"|"$/g, ''))
        .filter(Boolean))].sort();
}

async function loadUngroupedPinataAuditRows(db, options) {
    const result = await db.query(
        `WITH ungrouped_pinatas AS (
            SELECT p.id,
                   CASE
                       WHEN LOWER(COALESCE(NULLIF(BTRIM(p.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                            IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
                       ELSE LOWER(COALESCE(NULLIF(BTRIM(p.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                   END AS business_context,
                   p.date,
                   p.room,
                   p.customer_id
              FROM bookings p
             WHERE p.date >= $1
               AND p.date <= $2
               AND ${contextSql('p', '$3')}
               AND ${activeSql('p')}
               AND NULLIF(COALESCE(p.linked_to, ''), '') IS NULL
               AND p.customer_id IS NOT NULL
               AND NULLIF(BTRIM(COALESCE(p.room, '')), '') IS NOT NULL
               AND ${pinataSql('p')}
               AND NOT EXISTS (
                   SELECT 1
                     FROM banquet_group_bookings current_membership
                    WHERE current_membership.booking_id = p.id
                      AND ${contextSql('current_membership', '$3')}
               )
        ),
        active_group_primaries AS (
            SELECT bg.id AS group_id,
                   bg.primary_booking_id,
                   CASE
                       WHEN LOWER(COALESCE(NULLIF(BTRIM(bg.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                            IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
                       ELSE LOWER(COALESCE(NULLIF(BTRIM(bg.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                   END AS business_context,
                   primary_booking.date,
                   primary_booking.room,
                   primary_booking.customer_id
              FROM banquet_groups bg
              JOIN bookings primary_booking
                ON primary_booking.id = bg.primary_booking_id
               AND ${contextSql('primary_booking', '$3')}
               AND ${activeSql('primary_booking')}
             WHERE ${contextSql('bg', '$3')}
               AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
        )
        SELECT pinata.id AS pinata_booking_id,
               pinata.business_context,
               pinata.date,
               pinata.room,
               pinata.customer_id,
               candidate.group_id AS candidate_group_id,
               candidate.primary_booking_id AS candidate_primary_booking_id
          FROM ungrouped_pinatas pinata
          LEFT JOIN active_group_primaries candidate
            ON candidate.business_context = pinata.business_context
           AND candidate.date = pinata.date
           AND BTRIM(candidate.room) = BTRIM(pinata.room)
           AND candidate.customer_id = pinata.customer_id
         ORDER BY pinata.business_context, pinata.date, pinata.room, pinata.id, candidate.group_id`,
        [options.from, options.to, options.businessContext]
    );
    return result.rows || [];
}

async function loadMissingDepositAuditRows(db, options) {
    const result = await db.query(
        `SELECT bg.id AS group_id,
                bg.primary_booking_id,
                CASE
                    WHEN LOWER(COALESCE(NULLIF(BTRIM(bg.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                         IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
                    ELSE LOWER(COALESCE(NULLIF(BTRIM(bg.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                END AS business_context,
                primary_booking.date,
                primary_booking.room,
                primary_booking.customer_id
           FROM banquet_groups bg
           JOIN bookings primary_booking
             ON primary_booking.id = bg.primary_booking_id
            AND ${contextSql('primary_booking', '$3')}
          WHERE primary_booking.date >= $1
            AND primary_booking.date <= $2
            AND ${contextSql('bg', '$3')}
            AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
            AND NOT EXISTS (
                SELECT 1
                  FROM banquet_deposits deposit
                 WHERE ${contextSql('deposit', '$3')}
                   AND deposit.status <> 'cancelled'
                   AND (
                       deposit.banquet_group_id = bg.id
                       OR deposit.primary_booking_id = bg.primary_booking_id
                   )
            )
          ORDER BY business_context, primary_booking.date, bg.id`,
        [options.from, options.to, options.businessContext]
    );
    return result.rows || [];
}

async function loadPinataIntegrityAuditRows(db, options) {
    const result = await db.query(
        `SELECT pinata.id AS pinata_booking_id,
                ARRAY_AGG(membership.group_id ORDER BY membership.group_id) AS group_ids,
                COUNT(*)::integer AS membership_count,
                BOOL_OR(
                    CASE
                        WHEN group_row.primary_booking_id = pinata.id THEN membership.role <> 'primary'
                        ELSE membership.role <> 'activity'
                    END
                ) AS role_mismatch,
                BOOL_OR(
                    group_row.primary_booking_id <> pinata.id
                    AND (
                        primary_booking.customer_id IS DISTINCT FROM pinata.customer_id
                        OR primary_booking.date IS DISTINCT FROM pinata.date
                        OR BTRIM(COALESCE(primary_booking.room, '')) IS DISTINCT FROM BTRIM(COALESCE(pinata.room, ''))
                    )
                ) AS exact_key_mismatch
           FROM bookings pinata
           JOIN banquet_group_bookings membership
             ON membership.booking_id = pinata.id
            AND ${contextSql('membership', '$3')}
           JOIN banquet_groups group_row
             ON group_row.id = membership.group_id
            AND ${contextSql('group_row', '$3')}
           JOIN bookings primary_booking
             ON primary_booking.id = group_row.primary_booking_id
            AND ${contextSql('primary_booking', '$3')}
          WHERE pinata.date >= $1
            AND pinata.date <= $2
            AND ${contextSql('pinata', '$3')}
            AND ${pinataSql('pinata')}
          GROUP BY pinata.id
         HAVING COUNT(*) > 1
             OR BOOL_OR(
                 CASE
                     WHEN group_row.primary_booking_id = pinata.id THEN membership.role <> 'primary'
                     ELSE membership.role <> 'activity'
                 END
             )
             OR BOOL_OR(
                 group_row.primary_booking_id <> pinata.id
                 AND (
                     primary_booking.customer_id IS DISTINCT FROM pinata.customer_id
                     OR primary_booking.date IS DISTINCT FROM pinata.date
                     OR BTRIM(COALESCE(primary_booking.room, '')) IS DISTINCT FROM BTRIM(COALESCE(pinata.room, ''))
                 )
             )
          ORDER BY pinata.id`,
        [options.from, options.to, options.businessContext]
    );
    return result.rows || [];
}

function buildAuditReport(pinataRows = [], depositRows = [], integrityRows = [], options = {}) {
    const pinatas = new Map();
    for (const row of pinataRows) {
        const bookingId = String(row.pinata_booking_id || '').trim();
        if (!bookingId) continue;
        if (!pinatas.has(bookingId)) {
            pinatas.set(bookingId, {
                pinataBookingId: bookingId,
                businessContext: normalizeBusinessContext(row.business_context),
                date: String(row.date || '').slice(0, 10),
                room: String(row.room || '').trim(),
                matchFingerprint: matchFingerprint(row),
                candidateGroupIds: []
            });
        }
        const groupId = String(row.candidate_group_id || '').trim();
        if (groupId) pinatas.get(bookingId).candidateGroupIds.push(groupId);
    }

    const exactMatches = [];
    const ambiguous = [];
    const standalone = [];
    for (const item of pinatas.values()) {
        item.candidateGroupIds = [...new Set(item.candidateGroupIds)].sort();
        if (item.candidateGroupIds.length === 1) {
            exactMatches.push({
                ...item,
                candidateGroupId: item.candidateGroupIds[0],
                candidateGroupIds: undefined
            });
        } else if (item.candidateGroupIds.length > 1) {
            ambiguous.push(item);
        } else {
            standalone.push({
                ...item,
                candidateGroupIds: undefined
            });
        }
    }

    const depositsForManualReview = depositRows.map(row => ({
        groupId: String(row.group_id || '').trim(),
        primaryBookingId: String(row.primary_booking_id || '').trim(),
        businessContext: normalizeBusinessContext(row.business_context),
        date: String(row.date || '').slice(0, 10),
        room: String(row.room || '').trim(),
        matchFingerprint: matchFingerprint(row),
        reason: 'canonical_deposit_missing_manual_review_required'
    }));
    const integrityIssues = integrityRows.map(row => ({
        pinataBookingId: String(row.pinata_booking_id || '').trim(),
        groupIds: normalizedGroupIds(row.group_ids),
        membershipCount: Number(row.membership_count || 0),
        roleMismatch: row.role_mismatch === true,
        exactKeyMismatch: row.exact_key_mismatch === true
    }));

    return {
        readOnly: true,
        businessContext: options.businessContext || DEFAULT_BUSINESS_CONTEXT,
        range: {
            from: options.from || null,
            to: options.to || null
        },
        summary: {
            ungroupedPinatas: pinatas.size,
            exactMatchPinatas: exactMatches.length,
            ambiguousPinatas: ambiguous.length,
            standalonePinatas: standalone.length,
            groupsMissingCanonicalDeposit: depositsForManualReview.length,
            pinataIntegrityIssues: integrityIssues.length
        },
        pinatas: {
            exactMatches,
            ambiguous,
            standalone
        },
        depositsForManualReview,
        integrityIssues
    };
}

async function runAudit(db, options) {
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const pinataRows = await loadUngroupedPinataAuditRows(db, options);
        const depositRows = await loadMissingDepositAuditRows(db, options);
        const integrityRows = await loadPinataIntegrityAuditRows(db, options);
        const report = buildAuditReport(pinataRows, depositRows, integrityRows, options);
        await db.query('ROLLBACK');
        return report;
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function loadQaCleanupRows(db, options) {
    const result = await db.query(
        `SELECT b.id AS booking_id,
                CASE
                    WHEN LOWER(COALESCE(NULLIF(BTRIM(b.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                         IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
                    ELSE LOWER(COALESCE(NULLIF(BTRIM(b.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
                END AS business_context,
                b.date,
                b.room,
                b.status,
                b.linked_to,
                b.category,
                b.program_id,
                b.program_code,
                COALESCE(
                    ARRAY_AGG(DISTINCT (bgb.group_id || ':' || bgb.role))
                        FILTER (WHERE bgb.group_id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS banquet_memberships,
                COALESCE(
                    ARRAY_AGG(DISTINCT (
                        link.id::text || ':' ||
                        CASE WHEN link.booking_a_id = b.id THEN link.booking_b_id ELSE link.booking_a_id END ||
                        ':' || link.relation_type
                    )) FILTER (WHERE link.id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS banquet_links,
                COALESCE(
                    ARRAY_AGG(DISTINCT deposit.id::text)
                        FILTER (WHERE deposit.id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS deposit_ids
           FROM bookings b
           LEFT JOIN banquet_group_bookings bgb
             ON bgb.booking_id = b.id
            AND ${contextSql('bgb', '$2')}
           LEFT JOIN booking_banquet_links link
             ON (link.booking_a_id = b.id OR link.booking_b_id = b.id)
            AND ${contextSql('link', '$2')}
           LEFT JOIN banquet_deposits deposit
             ON ${contextSql('deposit', '$2')}
            AND LOWER(COALESCE(NULLIF(BTRIM(deposit.status), ''), 'manager_reported')) <> 'cancelled'
            AND (
                deposit.primary_booking_id = b.id
                OR deposit.banquet_group_id = bgb.group_id
            )
          WHERE b.id = ANY($1::text[])
            AND ${contextSql('b', '$2')}
          GROUP BY b.id
          ORDER BY b.id`,
        [options.bookingIds, options.businessContext]
    );
    return result.rows || [];
}

function buildQaCleanupReport(rows = [], options = {}) {
    const byId = new Map();
    for (const row of rows) {
        const bookingId = String(row.booking_id || '').trim();
        if (!bookingId) continue;
        byId.set(bookingId, row);
    }
    const records = (options.bookingIds || []).map(bookingId => {
        const row = byId.get(bookingId);
        if (!row) {
            return {
                bookingId,
                status: 'missing'
            };
        }
        return {
            bookingId,
            status: 'found',
            businessContext: normalizeBusinessContext(row.business_context),
            date: String(row.date || '').slice(0, 10),
            room: String(row.room || '').trim(),
            bookingStatus: String(row.status || '').trim() || null,
            linkedTo: String(row.linked_to || '').trim() || null,
            category: String(row.category || '').trim() || null,
            programId: String(row.program_id || '').trim() || null,
            programCode: String(row.program_code || '').trim() || null,
            banquetMemberships: normalizedTechnicalArray(row.banquet_memberships),
            banquetLinks: normalizedTechnicalArray(row.banquet_links),
            depositIds: normalizedTechnicalArray(row.deposit_ids)
        };
    });
    return {
        mode: 'qa-cleanup-dry-run',
        readOnly: true,
        businessContext: options.businessContext || DEFAULT_BUSINESS_CONTEXT,
        allowlist: [...SAFE_QA_CLEANUP_BOOKING_IDS],
        records,
        summary: {
            requested: records.length,
            found: records.filter(item => item.status === 'found').length,
            missing: records.filter(item => item.status === 'missing').length,
            banquetMemberships: records.reduce((total, item) => total + (item.banquetMemberships?.length || 0), 0),
            banquetLinks: records.reduce((total, item) => total + (item.banquetLinks?.length || 0), 0),
            depositRows: records.reduce((total, item) => total + (item.depositIds?.length || 0), 0)
        }
    };
}

async function runQaCleanupDryRun(db, options) {
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const rows = await loadQaCleanupRows(db, options);
        const report = buildQaCleanupReport(rows, options);
        await db.query('ROLLBACK');
        return report;
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

function isActiveRow(row = {}) {
    return String(row.status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function isPinataRow(row = {}) {
    const category = String(row.category || '').trim().toLowerCase();
    const programId = String(row.program_id || '').trim().toLowerCase();
    const programCode = String(row.program_code || '').trim().toLowerCase();
    return category === 'pinata' || programId === 'pinata' || ['pin', 'pinata'].includes(programCode);
}

function exactMatch(left = {}, right = {}) {
    return left.customer_id != null
        && right.customer_id != null
        && Number(left.customer_id) === Number(right.customer_id)
        && String(left.date || '').slice(0, 10) === String(right.date || '').slice(0, 10)
        && String(left.room || '').trim() !== ''
        && String(left.room || '').trim() === String(right.room || '').trim();
}

async function loadRecoveryTarget(db, pair, businessContext, forUpdate) {
    const result = await db.query(
        `SELECT pinata.id AS pinata_booking_id,
                pinata.business_context AS pinata_business_context,
                pinata.date AS pinata_date,
                pinata.room AS pinata_room,
                pinata.customer_id AS pinata_customer_id,
                pinata.category AS pinata_category,
                pinata.program_id AS pinata_program_id,
                pinata.program_code AS pinata_program_code,
                pinata.status AS pinata_status,
                pinata.linked_to AS pinata_linked_to,
                group_row.id AS group_id,
                group_row.status AS group_status,
                group_row.group_name,
                group_row.primary_booking_id,
                primary_booking.date AS primary_date,
                primary_booking.room AS primary_room,
                primary_booking.customer_id AS primary_customer_id,
                primary_booking.status AS primary_status
           FROM bookings pinata
           JOIN banquet_groups group_row
             ON group_row.id = $2
            AND ${contextSql('group_row', '$3')}
           JOIN bookings primary_booking
             ON primary_booking.id = group_row.primary_booking_id
            AND ${contextSql('primary_booking', '$3')}
          WHERE pinata.id = $1
            AND ${contextSql('pinata', '$3')}
          ${forUpdate ? 'FOR UPDATE OF pinata, group_row, primary_booking' : ''}`,
        [pair.bookingId, pair.groupId, businessContext]
    );
    return result.rows?.[0] || null;
}

async function loadRecoveryMemberships(db, bookingId, businessContext, forUpdate) {
    const result = await db.query(
        `SELECT membership.group_id, membership.booking_id, membership.role
           FROM banquet_group_bookings membership
          WHERE membership.booking_id = $1
            AND ${contextSql('membership', '$2')}
          ORDER BY membership.group_id
          ${forUpdate ? 'FOR UPDATE OF membership' : ''}`,
        [bookingId, businessContext]
    );
    return result.rows || [];
}

async function loadExactCandidateGroupIds(db, target, businessContext, forUpdate) {
    const result = await db.query(
        `SELECT group_row.id AS group_id
           FROM banquet_groups group_row
           JOIN bookings primary_booking
             ON primary_booking.id = group_row.primary_booking_id
            AND ${contextSql('primary_booking', '$4')}
            AND ${activeSql('primary_booking')}
          WHERE ${contextSql('group_row', '$4')}
            AND LOWER(COALESCE(NULLIF(BTRIM(group_row.status), ''), 'active')) = 'active'
            AND primary_booking.customer_id = $1
            AND primary_booking.date = $2
            AND BTRIM(primary_booking.room) = $3
          ORDER BY group_row.id
          ${forUpdate ? 'FOR UPDATE OF group_row, primary_booking' : ''}`,
        [
            target.pinata_customer_id,
            String(target.pinata_date || '').slice(0, 10),
            String(target.pinata_room || '').trim(),
            businessContext
        ]
    );
    return (result.rows || []).map(row => String(row.group_id || '').trim()).filter(Boolean);
}

function recoveryTargetAsRows(target = {}) {
    return {
        pinata: {
            id: target.pinata_booking_id,
            business_context: target.pinata_business_context,
            date: target.pinata_date,
            room: target.pinata_room,
            customer_id: target.pinata_customer_id,
            category: target.pinata_category,
            program_id: target.pinata_program_id,
            program_code: target.pinata_program_code,
            status: target.pinata_status,
            linked_to: target.pinata_linked_to
        },
        primary: {
            id: target.primary_booking_id,
            date: target.primary_date,
            room: target.primary_room,
            customer_id: target.primary_customer_id,
            status: target.primary_status
        },
        group: {
            id: target.group_id,
            status: target.group_status,
            group_name: target.group_name,
            primary_booking_id: target.primary_booking_id
        }
    };
}

function classifyRecoveryInspection(pair, target, memberships, candidateGroupIds, businessContext) {
    const base = {
        pinataBookingId: pair.bookingId,
        groupId: pair.groupId,
        businessContext,
        status: 'blocked',
        reason: null,
        matchFingerprint: null
    };
    if (!target) return { ...base, reason: 'booking_or_group_not_found' };
    const rows = recoveryTargetAsRows(target);
    base.matchFingerprint = matchFingerprint(rows.pinata);
    if (!isPinataRow(rows.pinata)) return { ...base, reason: 'booking_is_not_pinata' };
    if (!isActiveRow(rows.pinata)) return { ...base, reason: 'pinata_not_active' };
    if (String(rows.pinata.linked_to || '').trim()) return { ...base, reason: 'pinata_is_linked_child' };
    if (String(rows.group.status || 'active').trim().toLowerCase() !== 'active') {
        return { ...base, reason: 'group_not_active' };
    }
    if (!isActiveRow(rows.primary)) return { ...base, reason: 'primary_not_active' };
    if (String(rows.primary.id) === String(rows.pinata.id)) return { ...base, reason: 'pinata_is_group_primary' };
    if (!exactMatch(rows.pinata, rows.primary)) return { ...base, reason: 'exact_key_mismatch' };

    const uniqueCandidateGroupIds = [...new Set((candidateGroupIds || []).map(String))].sort();
    if (uniqueCandidateGroupIds.length !== 1 || uniqueCandidateGroupIds[0] !== pair.groupId) {
        return {
            ...base,
            reason: uniqueCandidateGroupIds.length > 1 ? 'multiple_exact_groups' : 'target_not_unique_exact_group',
            candidateGroupIds: uniqueCandidateGroupIds
        };
    }
    if (memberships.length > 1) {
        return {
            ...base,
            reason: 'duplicate_memberships',
            existingGroupIds: normalizedGroupIds(memberships.map(row => row.group_id))
        };
    }
    if (memberships.length === 1) {
        const membership = memberships[0];
        if (String(membership.group_id) === pair.groupId && String(membership.role) === 'activity') {
            return { ...base, status: 'already_applied', reason: null };
        }
        return {
            ...base,
            reason: 'existing_membership_conflict',
            existingGroupIds: [String(membership.group_id)]
        };
    }
    return { ...base, status: 'ready', reason: null };
}

async function inspectRecoveryPair(db, pair, businessContext, { forUpdate = false } = {}) {
    const target = await loadRecoveryTarget(db, pair, businessContext, forUpdate);
    if (!target) {
        return {
            result: classifyRecoveryInspection(pair, null, [], [], businessContext),
            target: null
        };
    }
    const memberships = await loadRecoveryMemberships(db, pair.bookingId, businessContext, forUpdate);
    const candidateGroupIds = await loadExactCandidateGroupIds(db, target, businessContext, forUpdate);
    return {
        result: classifyRecoveryInspection(pair, target, memberships, candidateGroupIds, businessContext),
        target
    };
}

function normalizeLinkPair(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b || a === b) throw new Error('Compatibility link requires two different booking ids');
    return a < b ? [a, b] : [b, a];
}

async function persistRecoveryPair(db, inspection, businessContext) {
    const result = inspection.result;
    const target = inspection.target;
    if (result.status !== 'ready' || !target) {
        throw new Error(`Recovery pair is not ready: ${result.pinataBookingId}:${result.groupId}`);
    }
    const membership = await db.query(
        `INSERT INTO banquet_group_bookings
            (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
         VALUES ($1, $2, $3, 'activity', 100, NULL, $4)
         ON CONFLICT DO NOTHING
         RETURNING booking_id, group_id, role`,
        [result.groupId, businessContext, result.pinataBookingId, RECOVERY_ACTOR]
    );
    if (membership.rowCount !== 1) {
        throw new Error(`Membership insert was not applied: ${result.pinataBookingId}:${result.groupId}`);
    }

    const pair = normalizeLinkPair(target.primary_booking_id, result.pinataBookingId);
    await db.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND booking_a_id = $3
            AND booking_b_id = $2
            AND relation_type = $4`,
        [businessContext, pair[0], pair[1], BANQUET_RELATION_TYPE]
    );
    await db.query(
        `INSERT INTO booking_banquet_links
            (business_context, booking_a_id, booking_b_id, relation_type, label, created_by_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6)
         ON CONFLICT (business_context, booking_a_id, booking_b_id, relation_type)
         DO UPDATE SET label = COALESCE(EXCLUDED.label, booking_banquet_links.label),
                       updated_at = NOW()`,
        [
            businessContext,
            pair[0],
            pair[1],
            BANQUET_RELATION_TYPE,
            String(target.group_name || '').trim() || null,
            RECOVERY_ACTOR
        ]
    );
    await db.query(
        `UPDATE banquet_groups
            SET updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
            AND ${contextSql('banquet_groups', '$2')}`,
        [result.groupId, businessContext, RECOVERY_ACTOR]
    );
    await db.query(
        `INSERT INTO history (business_context, action, username, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
            businessContext,
            'banquet_pinata_membership_recovered',
            RECOVERY_ACTOR,
            JSON.stringify({
                group_id: result.groupId,
                primary_booking_id: target.primary_booking_id,
                booking_id: result.pinataBookingId,
                role: 'activity',
                match_rule: 'business_context_customer_date_room',
                match_fingerprint: result.matchFingerprint,
                source: RECOVERY_ACTOR
            })
        ]
    );
    return {
        pinataBookingId: result.pinataBookingId,
        groupId: result.groupId,
        role: 'activity',
        status: 'applied',
        matchFingerprint: result.matchFingerprint
    };
}

async function runRecoveryDryRun(db, options, dependencies = {}) {
    const inspect = dependencies.inspectRecoveryPair || inspectRecoveryPair;
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const inspections = [];
        for (const pair of options.pairs) {
            inspections.push(await inspect(db, pair, options.businessContext, { forUpdate: false }));
        }
        await db.query('ROLLBACK');
        return {
            mode: 'dry-run',
            readOnly: true,
            businessContext: options.businessContext,
            pairs: inspections.map(item => item.result),
            summary: {
                requested: inspections.length,
                ready: inspections.filter(item => item.result.status === 'ready').length,
                alreadyApplied: inspections.filter(item => item.result.status === 'already_applied').length,
                blocked: inspections.filter(item => item.result.status === 'blocked').length
            }
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function runRecoveryApply(db, options, dependencies = {}) {
    if (!options.apply || options.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --apply --confirm=${APPLY_CONFIRMATION}`);
    }
    const inspect = dependencies.inspectRecoveryPair || inspectRecoveryPair;
    const persist = dependencies.persistRecoveryPair || persistRecoveryPair;
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        const before = [];
        for (const pair of options.pairs) {
            before.push(await inspect(db, pair, options.businessContext, { forUpdate: true }));
        }
        const blocked = before.filter(item => item.result.status === 'blocked');
        if (blocked.length) {
            const labels = blocked.map(item => (
                `${item.result.pinataBookingId}:${item.result.groupId}:${item.result.reason}`
            ));
            throw new Error(`Recovery blocked by preflight: ${labels.join(',')}`);
        }

        const applied = [];
        for (const inspection of before) {
            if (inspection.result.status === 'ready') {
                applied.push(await persist(db, inspection, options.businessContext));
            }
        }

        const after = [];
        for (const pair of options.pairs) {
            after.push(await inspect(db, pair, options.businessContext, { forUpdate: false }));
        }
        const invalidAfter = after.filter(item => item.result.status !== 'already_applied');
        if (invalidAfter.length) {
            const labels = invalidAfter.map(item => (
                `${item.result.pinataBookingId}:${item.result.groupId}:${item.result.reason || item.result.status}`
            ));
            throw new Error(`Post-recovery verification failed: ${labels.join(',')}`);
        }

        await db.query('COMMIT');
        return {
            mode: 'apply',
            readOnly: false,
            businessContext: options.businessContext,
            before: before.map(item => item.result),
            applied,
            after: after.map(item => item.result),
            summary: {
                requested: options.pairs.length,
                applied: applied.length,
                alreadyApplied: before.filter(item => item.result.status === 'already_applied').length,
                blocked: 0,
                verifiedAfter: after.length
            }
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function loadDetachTarget(db, pair, businessContext, forUpdate) {
    const result = await db.query(
        `SELECT pinata.id AS pinata_booking_id,
                pinata.business_context AS pinata_business_context,
                pinata.date AS pinata_date,
                pinata.room AS pinata_room,
                pinata.customer_id AS pinata_customer_id,
                pinata.category AS pinata_category,
                pinata.program_id AS pinata_program_id,
                pinata.program_code AS pinata_program_code,
                pinata.status AS pinata_status,
                pinata.linked_to AS pinata_linked_to,
                membership.group_id,
                membership.role AS membership_role,
                group_row.status AS group_status,
                group_row.group_name,
                group_row.primary_booking_id,
                primary_booking.date AS primary_date,
                primary_booking.room AS primary_room,
                primary_booking.customer_id AS primary_customer_id,
                primary_booking.status AS primary_status
           FROM banquet_group_bookings membership
           JOIN bookings pinata
             ON pinata.id = membership.booking_id
            AND ${contextSql('pinata', '$3')}
           JOIN banquet_groups group_row
             ON group_row.id = membership.group_id
            AND ${contextSql('group_row', '$3')}
           LEFT JOIN bookings primary_booking
             ON primary_booking.id = group_row.primary_booking_id
            AND ${contextSql('primary_booking', '$3')}
          WHERE membership.booking_id = $1
            AND membership.group_id = $2
            AND ${contextSql('membership', '$3')}
          ${forUpdate ? 'FOR UPDATE OF membership, pinata, group_row' : ''}`,
        [pair.bookingId, pair.groupId, businessContext]
    );
    return result.rows?.[0] || null;
}

function detachTargetAsRows(target = {}) {
    return {
        pinata: {
            id: target.pinata_booking_id,
            business_context: target.pinata_business_context,
            date: target.pinata_date,
            room: target.pinata_room,
            customer_id: target.pinata_customer_id,
            category: target.pinata_category,
            program_id: target.pinata_program_id,
            program_code: target.pinata_program_code,
            status: target.pinata_status,
            linked_to: target.pinata_linked_to
        },
        primary: {
            id: target.primary_booking_id,
            date: target.primary_date,
            room: target.primary_room,
            customer_id: target.primary_customer_id,
            status: target.primary_status
        }
    };
}

function classifyDetachInspection(pair, target, businessContext) {
    const base = {
        pinataBookingId: pair.bookingId,
        groupId: pair.groupId,
        businessContext,
        status: 'blocked',
        reason: null,
        matchFingerprint: null
    };
    if (!target) return { ...base, status: 'already_detached' };
    const rows = detachTargetAsRows(target);
    base.matchFingerprint = matchFingerprint(rows.pinata);
    if (!isPinataRow(rows.pinata)) return { ...base, reason: 'booking_is_not_pinata' };
    if (String(target.membership_role || '').trim().toLowerCase() !== 'activity') {
        return {
            ...base,
            reason: 'not_activity_membership',
            existingRole: String(target.membership_role || '').trim() || null
        };
    }
    if (String(rows.primary.id || '').trim() && String(rows.primary.id) === String(rows.pinata.id)) {
        return { ...base, reason: 'pinata_is_group_primary' };
    }
    return {
        ...base,
        status: 'ready',
        existingRole: 'activity'
    };
}

async function inspectDetachPair(db, pair, businessContext, { forUpdate = false } = {}) {
    const target = await loadDetachTarget(db, pair, businessContext, forUpdate);
    return {
        result: classifyDetachInspection(pair, target, businessContext),
        target
    };
}

async function persistDetachPair(db, inspection, businessContext) {
    const result = inspection.result;
    const target = inspection.target;
    if (result.status !== 'ready' || !target) {
        throw new Error(`Detach pair is not ready: ${result.pinataBookingId}:${result.groupId}`);
    }
    const membership = await db.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id = $1
            AND booking_id = $2
            AND ${contextSql('banquet_group_bookings', '$3')}
            AND role = 'activity'
          RETURNING booking_id, group_id, role`,
        [result.groupId, result.pinataBookingId, businessContext]
    );
    if (membership.rowCount !== 1) {
        throw new Error(`Activity membership detach was not applied: ${result.pinataBookingId}:${result.groupId}`);
    }

    let deletedCompatibilityLinks = 0;
    const primaryBookingId = String(target.primary_booking_id || '').trim();
    if (primaryBookingId && primaryBookingId !== result.pinataBookingId) {
        const pair = normalizeLinkPair(primaryBookingId, result.pinataBookingId);
        const linkDelete = await db.query(
            `DELETE FROM booking_banquet_links
              WHERE business_context = $1
                AND relation_type = $4
                AND (
                    (booking_a_id = $2 AND booking_b_id = $3)
                    OR (booking_a_id = $3 AND booking_b_id = $2)
                )
              RETURNING id`,
            [businessContext, pair[0], pair[1], BANQUET_RELATION_TYPE]
        );
        deletedCompatibilityLinks = Number(linkDelete.rowCount || 0);
    }

    await db.query(
        `UPDATE banquet_groups
            SET updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
            AND ${contextSql('banquet_groups', '$2')}`,
        [result.groupId, businessContext, RECOVERY_ACTOR]
    );
    await db.query(
        `INSERT INTO history (business_context, action, username, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
            businessContext,
            'banquet_pinata_membership_detached',
            RECOVERY_ACTOR,
            JSON.stringify({
                group_id: result.groupId,
                primary_booking_id: primaryBookingId || null,
                booking_id: result.pinataBookingId,
                role: 'activity',
                relation_type: BANQUET_RELATION_TYPE,
                match_fingerprint: result.matchFingerprint,
                source: RECOVERY_ACTOR
            })
        ]
    );
    return {
        pinataBookingId: result.pinataBookingId,
        groupId: result.groupId,
        role: 'activity',
        status: 'detached',
        deletedCompatibilityLinks,
        matchFingerprint: result.matchFingerprint
    };
}

async function runDetachDryRun(db, options, dependencies = {}) {
    const inspect = dependencies.inspectDetachPair || inspectDetachPair;
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const inspections = [];
        for (const pair of options.pairs) {
            inspections.push(await inspect(db, pair, options.businessContext, { forUpdate: false }));
        }
        await db.query('ROLLBACK');
        return {
            mode: 'detach-dry-run',
            readOnly: true,
            businessContext: options.businessContext,
            pairs: inspections.map(item => item.result),
            summary: {
                requested: inspections.length,
                ready: inspections.filter(item => item.result.status === 'ready').length,
                alreadyDetached: inspections.filter(item => item.result.status === 'already_detached').length,
                blocked: inspections.filter(item => item.result.status === 'blocked').length
            }
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function runDetachApply(db, options, dependencies = {}) {
    if (!options.apply || options.confirmation !== DETACH_CONFIRMATION) {
        throw new Error(`Detach apply requires --apply --confirm=${DETACH_CONFIRMATION}`);
    }
    const inspect = dependencies.inspectDetachPair || inspectDetachPair;
    const persist = dependencies.persistDetachPair || persistDetachPair;
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        const before = [];
        for (const pair of options.pairs) {
            before.push(await inspect(db, pair, options.businessContext, { forUpdate: true }));
        }
        const blocked = before.filter(item => item.result.status === 'blocked');
        if (blocked.length) {
            const labels = blocked.map(item => (
                `${item.result.pinataBookingId}:${item.result.groupId}:${item.result.reason}`
            ));
            throw new Error(`Detach blocked by preflight: ${labels.join(',')}`);
        }

        const detached = [];
        for (const inspection of before) {
            if (inspection.result.status === 'ready') {
                detached.push(await persist(db, inspection, options.businessContext));
            }
        }

        const after = [];
        for (const pair of options.pairs) {
            after.push(await inspect(db, pair, options.businessContext, { forUpdate: false }));
        }
        const invalidAfter = after.filter(item => item.result.status !== 'already_detached');
        if (invalidAfter.length) {
            const labels = invalidAfter.map(item => (
                `${item.result.pinataBookingId}:${item.result.groupId}:${item.result.reason || item.result.status}`
            ));
            throw new Error(`Post-detach verification failed: ${labels.join(',')}`);
        }

        await db.query('COMMIT');
        return {
            mode: 'detach-apply',
            readOnly: false,
            businessContext: options.businessContext,
            before: before.map(item => item.result),
            detached,
            after: after.map(item => item.result),
            summary: {
                requested: options.pairs.length,
                detached: detached.length,
                alreadyDetached: before.filter(item => item.result.status === 'already_detached').length,
                blocked: 0,
                verifiedAfter: after.length
            }
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

function printAuditReport(report) {
    console.log('Banquet production recovery audit (read-only)');
    console.log(`context=${report.businessContext} range=${report.range.from}..${report.range.to}`);
    console.log(
        `ungroupedPinatas=${report.summary.ungroupedPinatas} exact=${report.summary.exactMatchPinatas} `
        + `ambiguous=${report.summary.ambiguousPinatas} standalone=${report.summary.standalonePinatas}`
    );
    console.log(
        `depositManualReview=${report.summary.groupsMissingCanonicalDeposit} `
        + `pinataIntegrityIssues=${report.summary.pinataIntegrityIssues}`
    );
    for (const item of report.pinatas.exactMatches) {
        console.log(
            `exact pinata=${item.pinataBookingId} group=${item.candidateGroupId} date=${item.date} `
            + `room=${item.room} fingerprint=${item.matchFingerprint}`
        );
    }
    for (const item of report.pinatas.ambiguous) {
        console.log(
            `ambiguous pinata=${item.pinataBookingId} groups=${item.candidateGroupIds.join(',')} date=${item.date} `
            + `room=${item.room} fingerprint=${item.matchFingerprint}`
        );
    }
    for (const item of report.pinatas.standalone) {
        console.log(
            `standalone pinata=${item.pinataBookingId} date=${item.date} room=${item.room} `
            + `fingerprint=${item.matchFingerprint}`
        );
    }
    for (const item of report.depositsForManualReview) {
        console.log(
            `deposit-review group=${item.groupId} primary=${item.primaryBookingId} date=${item.date} `
            + `room=${item.room} fingerprint=${item.matchFingerprint}`
        );
    }
    for (const item of report.integrityIssues) {
        console.log(
            `integrity pinata=${item.pinataBookingId} groups=${item.groupIds.join(',') || '-'} `
            + `memberships=${item.membershipCount} roleMismatch=${item.roleMismatch ? 'yes' : 'no'} `
            + `exactKeyMismatch=${item.exactKeyMismatch ? 'yes' : 'no'}`
        );
    }
}

function printRecoveryReport(report) {
    console.log(`Banquet pinata recovery (${report.mode})`);
    console.log(`context=${report.businessContext}`);
    const rows = report.mode === 'apply' ? report.after : report.pairs;
    for (const item of rows) {
        console.log(
            `pinata=${item.pinataBookingId} group=${item.groupId} status=${item.status} `
            + `reason=${item.reason || '-'} fingerprint=${item.matchFingerprint || '-'}`
        );
    }
    console.log(
        `requested=${report.summary.requested} applied=${report.summary.applied || 0} `
        + `alreadyApplied=${report.summary.alreadyApplied} blocked=${report.summary.blocked}`
    );
    if (report.mode === 'dry-run') {
        console.log(`dry-run only: add --apply --confirm=${APPLY_CONFIRMATION} after operator review.`);
    }
}

function printDetachReport(report) {
    console.log(`Banquet pinata detach (${report.mode})`);
    console.log(`context=${report.businessContext}`);
    const rows = report.mode === 'detach-apply' ? report.after : report.pairs;
    for (const item of rows) {
        console.log(
            `pinata=${item.pinataBookingId} group=${item.groupId} status=${item.status} `
            + `reason=${item.reason || '-'} fingerprint=${item.matchFingerprint || '-'}`
        );
    }
    console.log(
        `requested=${report.summary.requested} detached=${report.summary.detached || 0} `
        + `alreadyDetached=${report.summary.alreadyDetached} blocked=${report.summary.blocked}`
    );
    if (report.mode === 'detach-dry-run') {
        console.log(`dry-run only: add --apply --confirm=${DETACH_CONFIRMATION} after separate production approval.`);
    }
}

function printQaCleanupReport(report) {
    console.log('Banquet QA cleanup inventory (read-only)');
    console.log(`context=${report.businessContext}`);
    for (const item of report.records) {
        if (item.status === 'missing') {
            console.log(`booking=${item.bookingId} status=missing`);
            continue;
        }
        console.log(
            `booking=${item.bookingId} status=${item.bookingStatus || '-'} date=${item.date || '-'} `
            + `room=${item.room || '-'} memberships=${item.banquetMemberships.length} `
            + `links=${item.banquetLinks.length} deposits=${item.depositIds.length}`
        );
    }
    console.log(
        `requested=${report.summary.requested} found=${report.summary.found} missing=${report.summary.missing} `
        + `memberships=${report.summary.banquetMemberships} links=${report.summary.banquetLinks} `
        + `deposits=${report.summary.depositRows}`
    );
    console.log('dry-run only: no bookings, groups, links, or deposits were deleted.');
}

async function main(argv = process.argv.slice(2)) {
    loadEnvFile();
    const options = parseArgs(argv);
    const { pool } = require('../db');
    const client = await pool.connect();
    try {
        let report;
        if (options.command === 'audit') {
            report = await runAudit(client, options);
        } else if (options.command === 'recover') {
            report = options.apply
                ? await runRecoveryApply(client, options)
                : await runRecoveryDryRun(client, options);
        } else if (options.command === 'detach') {
            report = options.apply
                ? await runDetachApply(client, options)
                : await runDetachDryRun(client, options);
        } else {
            report = await runQaCleanupDryRun(client, options);
        }
        if (options.json) console.log(JSON.stringify(report, null, 2));
        else if (options.command === 'audit') printAuditReport(report);
        else if (options.command === 'recover') printRecoveryReport(report);
        else if (options.command === 'detach') printDetachReport(report);
        else printQaCleanupReport(report);
        if (options.command === 'audit' && options.strict && (
            report.summary.ambiguousPinatas > 0
            || report.summary.pinataIntegrityIssues > 0
        )) {
            process.exitCode = 1;
        }
        return report;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Banquet production recovery failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    APPLY_CONFIRMATION,
    DETACH_CONFIRMATION,
    RECOVERY_ACTOR,
    SAFE_QA_CLEANUP_BOOKING_IDS,
    argValue,
    buildAuditReport,
    buildQaCleanupReport,
    classifyDetachInspection,
    classifyRecoveryInspection,
    detachTargetAsRows,
    exactMatch,
    inspectDetachPair,
    inspectRecoveryPair,
    isPinataRow,
    loadDetachTarget,
    loadExactCandidateGroupIds,
    loadMissingDepositAuditRows,
    loadPinataIntegrityAuditRows,
    loadQaCleanupRows,
    loadRecoveryMemberships,
    loadRecoveryTarget,
    loadUngroupedPinataAuditRows,
    main,
    matchFingerprint,
    normalizeBusinessContext,
    parseArgs,
    parseAuditOptions,
    parseBookingIdList,
    parseDetachOptions,
    parseQaCleanupOptions,
    parseRecoveryOptions,
    parseRecoveryPairs,
    persistDetachPair,
    persistRecoveryPair,
    printAuditReport,
    printDetachReport,
    printQaCleanupReport,
    printRecoveryReport,
    runAudit,
    runDetachApply,
    runDetachDryRun,
    runQaCleanupDryRun,
    runRecoveryApply,
    runRecoveryDryRun
};
