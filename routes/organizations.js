'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { requireAction, canUseAction } = require('../middleware/auth');
const { ROLE_HIERARCHY, normalizeActionOverrideList, normalizePageAllowlist, normalizePageDenylist } = require('../services/accountAccessPolicy');
const { businessContextCatalog, normalizeBusinessContext } = require('../services/businessContext');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');

const ORGANIZATION_ROLES = new Set(['owner', 'admin', 'member']);
const BUSINESS_STATUSES = new Set(['active', 'inactive']);

function text(value, max = 160) {
    return String(value || '').trim().slice(0, max);
}

function slug(value) {
    const normalized = text(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.length >= 3 ? normalized : '';
}

function role(value) {
    const result = text(value, 64);
    return ROLE_HIERARCHY.includes(result) ? result : '';
}

function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => text(item, 200)).filter(Boolean))];
}

async function organizationAccess(db, userId, organizationId) {
    const result = await db.query(
        `SELECT role, is_active FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId]
    );
    return result.rows[0] || null;
}

async function requireOrganizationManager(req, res, next) {
    const organizationId = Number(req.params.organizationId || req.body?.organizationId);
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        return res.status(400).json({ error: 'Valid organizationId is required', code: 'organization_id_invalid' });
    }
    if (canUseAction(req.user, 'manage_accounts') && req.user?.role === 'creator') {
        req.organizationId = organizationId;
        return next();
    }
    const membership = await organizationAccess(pool, req.user.id, organizationId);
    if (!membership?.is_active || !['owner', 'admin'].includes(membership.role)) {
        return res.status(403).json({ error: 'Organization management access is required', code: 'organization_management_denied' });
    }
    req.organizationId = organizationId;
    return next();
}

router.get('/', async (req, res) => {
    const result = await pool.query(
        `SELECT o.id, o.slug, o.name, o.status, om.role AS organization_role,
                b.id AS business_id, b.context_key, b.label, b.short_label, b.status AS business_status,
                b.access_mode, b.modules
         FROM organization_memberships om
         JOIN organizations o ON o.id = om.organization_id
         LEFT JOIN businesses b ON b.organization_id = o.id
         WHERE om.user_id = $1 AND om.is_active IS TRUE AND o.status = 'active'
         ORDER BY o.id, b.id`,
        [req.user.id]
    );
    const organizations = new Map();
    result.rows.forEach(row => {
        if (!organizations.has(row.id)) organizations.set(row.id, {
            id: row.id, slug: row.slug, name: row.name, status: row.status, role: row.organization_role, businesses: []
        });
        if (row.business_id) organizations.get(row.id).businesses.push({
            id: row.business_id, contextKey: row.context_key, label: row.label, shortLabel: row.short_label,
            status: row.business_status, accessMode: row.access_mode, modules: row.modules || []
        });
    });
    res.json({ success: true, organizations: [...organizations.values()] });
});

router.post('/bootstrap', requireAction('manage_accounts'), async (req, res) => {
    if (req.user?.role !== 'creator') return res.status(403).json({ error: 'Platform creator access is required', code: 'organization_bootstrap_denied' });
    const name = text(req.body?.name, 160);
    const organizationSlug = slug(req.body?.slug || name);
    if (!name || !organizationSlug) return res.status(400).json({ error: 'Organization name and slug are required', code: 'organization_invalid' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id FROM organizations LIMIT 1 FOR UPDATE');
        if (existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Bootstrap is already complete', code: 'organization_bootstrap_complete' });
        }
        const organization = await client.query(
            `INSERT INTO organizations (slug, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id, slug, name`,
            [organizationSlug, name, req.user.id]
        );
        const organizationId = organization.rows[0].id;
        await client.query(
            `INSERT INTO organization_memberships (organization_id, user_id, role, created_by_user_id)
             VALUES ($1, $2, 'owner', $2)`, [organizationId, req.user.id]
        );
        const catalog = new Map(businessContextCatalog().map(item => [item.key, item]));
        for (const key of ['event_genix', 'dar']) {
            const entry = catalog.get(key);
            const business = await client.query(
                `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, created_by_user_id)
                 VALUES ($1, $2, $3, $4, 'membership', $5::jsonb, $6) RETURNING id, context_key`,
                [organizationId, key, entry.label, entry.shortLabel, JSON.stringify(entry.modules), req.user.id]
            );
            const members = await client.query(
                `SELECT id, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist,
                        default_business_context
                 FROM users
                 WHERE is_active IS TRUE AND $1 = ANY(COALESCE(business_contexts, '{}'::text[]))`, [key]
            );
            if (!members.rows.some(member => Number(member.id) === Number(req.user.id))) {
                members.rows.push({
                    id: req.user.id,
                    role: req.user.role,
                    extra_roles: req.user.extra_roles || [],
                    page_allowlist: req.user.page_allowlist || [],
                    page_denylist: req.user.page_denylist || [],
                    action_allowlist: req.user.action_allowlist || [],
                    action_denylist: req.user.action_denylist || [],
                    default_business_context: req.user.default_business_context || 'event_genix'
                });
            }
            for (const member of members.rows) {
                await client.query(
                    `INSERT INTO organization_memberships (organization_id, user_id, role, created_by_user_id)
                     VALUES ($1, $2, 'member', $3) ON CONFLICT (organization_id, user_id) DO NOTHING`,
                    [organizationId, member.id, req.user.id]
                );
                await client.query(
                    `INSERT INTO business_memberships
                         (business_id, organization_id, user_id, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, is_default, created_by_user_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (business_id, user_id) DO NOTHING`,
                    [business.rows[0].id, organizationId, member.id, member.role, member.extra_roles || [], member.page_allowlist || [], member.page_denylist || [], member.action_allowlist || [], member.action_denylist || [], member.default_business_context === key, req.user.id]
                );
            }
        }
        await client.query('COMMIT');
        await recordAccountSecurityEvent({ actor: req.user, target: req.user, eventType: 'organization_bootstrapped', details: { organizationId, contexts: ['event_genix', 'dar'] }, req });
        res.status(201).json({ success: true, organization: organization.rows[0], contexts: ['event_genix', 'dar'] });
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        res.status(error.code === '23505' ? 409 : 500).json({ error: 'Organization bootstrap failed', code: 'organization_bootstrap_failed' });
    } finally { client.release(); }
});

router.post('/:organizationId/businesses', requireOrganizationManager, async (req, res) => {
    const contextKey = normalizeBusinessContext(req.body?.contextKey || req.body?.businessContext);
    const rawContext = text(req.body?.contextKey || req.body?.businessContext, 64);
    const label = text(req.body?.label, 160);
    const shortLabel = text(req.body?.shortLabel || label, 80);
    if (!rawContext || contextKey !== rawContext || !label || !shortLabel) return res.status(400).json({ error: 'Valid contextKey, label and shortLabel are required', code: 'business_invalid' });
    const modules = stringList(req.body?.modules);
    const result = await pool.query(
        `INSERT INTO businesses (organization_id, context_key, label, short_label, modules, access_mode, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'membership', $6) RETURNING id, organization_id, context_key, label, short_label, status, access_mode, modules`,
        [req.organizationId, contextKey, label, shortLabel, JSON.stringify(modules), req.user.id]
    );
    await recordAccountSecurityEvent({ actor: req.user, target: req.user, eventType: 'business_created', details: { organizationId: req.organizationId, businessId: result.rows[0].id, contextKey }, req });
    res.status(201).json({ success: true, business: result.rows[0] });
});

router.patch('/businesses/:businessId', async (req, res) => {
    const businessId = Number(req.params.businessId);
    const lookup = await pool.query('SELECT organization_id FROM businesses WHERE id = $1', [businessId]);
    if (!lookup.rows[0]) return res.status(404).json({ error: 'Business not found', code: 'business_not_found' });
    req.body = { ...(req.body || {}), organizationId: lookup.rows[0].organization_id };
    return requireOrganizationManager(req, res, async () => {
        const status = text(req.body?.status, 16);
        if (!BUSINESS_STATUSES.has(status)) return res.status(400).json({ error: 'Valid status is required', code: 'business_status_invalid' });
        const result = await pool.query('UPDATE businesses SET status = $1 WHERE id = $2 RETURNING id, context_key, status', [status, businessId]);
        await recordAccountSecurityEvent({ actor: req.user, target: req.user, eventType: 'business_status_changed', details: { businessId, status }, req });
        return res.json({ success: true, business: result.rows[0] });
    });
});

router.put('/:organizationId/members/:userId', requireOrganizationManager, async (req, res) => {
    const targetUserId = Number(req.params.userId);
    const businessId = Number(req.body?.businessId);
    const membershipRole = role(req.body?.role);
    if (!Number.isInteger(targetUserId) || !Number.isInteger(businessId) || !membershipRole) return res.status(400).json({ error: 'Valid userId, businessId and role are required', code: 'business_membership_invalid' });
    const business = await pool.query('SELECT id FROM businesses WHERE id = $1 AND organization_id = $2 AND status = \'active\'', [businessId, req.organizationId]);
    if (!business.rows[0]) return res.status(404).json({ error: 'Active business not found in organization', code: 'business_not_found' });
    const organizationRole = text(req.body?.organizationRole || 'member', 16);
    if (!ORGANIZATION_ROLES.has(organizationRole)) return res.status(400).json({ error: 'Invalid organization role', code: 'organization_role_invalid' });
    const extraRoles = stringList(req.body?.extraRoles);
    const pageAllowlist = normalizePageAllowlist(req.body?.pageAllowlist || []);
    const pageDenylist = normalizePageDenylist(req.body?.pageDenylist || []);
    const actionAllowlist = normalizeActionOverrideList(req.body?.actionAllowlist || []);
    const actionDenylist = normalizeActionOverrideList(req.body?.actionDenylist || []);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO organization_memberships (organization_id, user_id, role, is_active, created_by_user_id)
             VALUES ($1, $2, $3, true, $4)
             ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true`,
            [req.organizationId, targetUserId, organizationRole, req.user.id]
        );
        if (req.body?.isDefault === true) await client.query('UPDATE business_memberships SET is_default = false WHERE user_id = $1 AND organization_id = $2', [targetUserId, req.organizationId]);
        const result = await client.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, is_default, is_active, created_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
             ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role, extra_roles = EXCLUDED.extra_roles, page_allowlist = EXCLUDED.page_allowlist, page_denylist = EXCLUDED.page_denylist, action_allowlist = EXCLUDED.action_allowlist, action_denylist = EXCLUDED.action_denylist, is_default = EXCLUDED.is_default, is_active = true
             RETURNING business_id, user_id, role, is_default, is_active`,
            [businessId, req.organizationId, targetUserId, membershipRole, extraRoles, pageAllowlist, pageDenylist, actionAllowlist, actionDenylist, req.body?.isDefault === true, req.user.id]
        );
        await client.query('UPDATE users SET session_revoked_at = clock_timestamp() WHERE id = $1', [targetUserId]);
        await client.query('COMMIT');
        await recordAccountSecurityEvent({ actor: req.user, target: { id: targetUserId }, eventType: 'business_membership_updated', details: { organizationId: req.organizationId, businessId, membershipRole, organizationRole }, req });
        res.json({ success: true, membership: result.rows[0] });
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        res.status(500).json({ error: 'Business membership update failed', code: 'business_membership_update_failed' });
    } finally { client.release(); }
});

router.delete('/:organizationId/members/:userId/:businessId', requireOrganizationManager, async (req, res) => {
    const targetUserId = Number(req.params.userId);
    const businessId = Number(req.params.businessId);
    const result = await pool.query(
        `UPDATE business_memberships SET is_active = false, is_default = false
         WHERE organization_id = $1 AND user_id = $2 AND business_id = $3 RETURNING business_id`,
        [req.organizationId, targetUserId, businessId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Business membership not found', code: 'business_membership_not_found' });
    await pool.query('UPDATE users SET session_revoked_at = clock_timestamp() WHERE id = $1', [targetUserId]);
    await recordAccountSecurityEvent({ actor: req.user, target: { id: targetUserId }, eventType: 'business_membership_deactivated', details: { organizationId: req.organizationId, businessId }, req });
    res.json({ success: true });
});

module.exports = router;
