'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { requireAction } = require('../middleware/auth');
const { businessContextCatalog } = require('../services/businessContext');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');
const lifecycle = require('../services/organizationLifecycle');
const { lockOrganizationOwnership } = require('../services/organizationOwnership');
const { applyReservedCutover, prepareReservedCutover } = require('../services/businessCutover');
const { applyCatalogOwnershipCutover, prepareCatalogOwnershipCutover } = require('../services/catalogOwnershipCutover');
const { recordCompatibilityTelemetrySafe } = require('../services/businessCutover');

function text(value, max = 160) {
    return String(value || '').trim().slice(0, max);
}

function slug(value) {
    const normalized = text(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.length >= 3 ? normalized : '';
}

function lifecycleError(res, error, fallbackCode) {
    const status = error.status || (error.code === '23505' ? 409 : 500);
    return res.status(status).json({ error: error.status ? error.message : 'Organization lifecycle operation failed', code: error.status ? error.code : fallbackCode });
}

router.get('/members', async (req, res) => {
    try {
        res.json({ success: true, ...await lifecycle.listOrganizationMembers(pool, req.user) });
    } catch (error) { lifecycleError(res, error, 'organization_members_unavailable'); }
});

router.get('/members/:userId/access-profile', async (req, res) => {
    try {
        const accessProfile = await lifecycle.getMemberAccessProfile(pool, req.user, req.params.userId);
        res.json({ success: true, accessProfile });
    } catch (error) { lifecycleError(res, error, 'business_member_access_unavailable'); }
});

router.get('/management', async (req, res) => {
    try {
        res.json({ success: true, ...await lifecycle.getOrganizationManagement(pool, req.user) });
    } catch (error) { lifecycleError(res, error, 'organization_management_unavailable'); }
});

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
    if (req.user?.platformRole !== 'creator') return res.status(403).json({ error: 'Platform creator access is required', code: 'organization_bootstrap_denied' });
    const name = text(req.body?.name, 160);
    const organizationSlug = slug(req.body?.slug || name);
    if (!name || !organizationSlug) return res.status(400).json({ error: 'Organization name and slug are required', code: 'organization_invalid' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await lockOrganizationOwnership(client);
        // Locking an empty SELECT does not serialize the first bootstrap.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:organization-bootstrap'))");
        const account = await client.query('SELECT role, is_active FROM users WHERE id = $1', [req.user.id]);
        if (account.rows[0]?.role !== 'creator' || !account.rows[0]?.is_active) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Permanent platform creator access is required', code: 'organization_bootstrap_denied' });
        }
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
        await recordAccountSecurityEvent({ actor: req.user, target: req.user, eventType: 'organization_bootstrapped', details: { organizationId, contexts: ['event_genix', 'dar'] }, req, client, strict: true });
        await client.query('COMMIT');
        res.status(201).json({ success: true, organization: organization.rows[0], contexts: ['event_genix', 'dar'] });
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        res.status(error.code === '23505' ? 409 : 500).json({ error: 'Organization bootstrap failed', code: 'organization_bootstrap_failed' });
    } finally { client.release(); }
});

// This creates review-bound journal evidence only. It intentionally does not
// create a reserved business, membership, owner, default, or data mapping.
router.post('/cutovers/prepare', requireAction('manage_accounts'), async (req, res) => {
    try {
        const cutover = await prepareReservedCutover(pool, req.user, req.body || {});
        recordCompatibilityTelemetrySafe(pool, { businessContext: cutover.contextKey, entryFamily: 'operator',
            decisionStage: 'execution', authoritySource: 'membership', outcome: 'allowed' });
        res.status(cutover.replay ? 200 : 201).json({ success: true, cutover });
    } catch (error) { lifecycleError(res, error, 'cutover_prepare_failed'); }
});

// Red-scope operational cutover. The endpoint is inert without an approved,
// hash-bound mapping body and a matching journal/source fingerprint.
router.post('/cutovers/apply', requireAction('manage_accounts'), async (req, res) => {
    try {
        const cutover = await applyReservedCutover(pool, req.user, req.body || {});
        recordCompatibilityTelemetrySafe(pool, { businessContext: cutover.contextKey, entryFamily: 'operator',
            decisionStage: 'execution', authoritySource: 'membership', outcome: 'allowed' });
        res.status(cutover.replay ? 200 : 201).json({ success: true, cutover });
    } catch (error) { lifecycleError(res, error, 'cutover_apply_failed'); }
});

router.post('/catalog-cutovers/prepare', requireAction('manage_accounts'), async (req, res) => {
    try {
        const cutover = await prepareCatalogOwnershipCutover(pool, req.user, req.body || {});
        recordCompatibilityTelemetrySafe(pool, { businessContext: 'event_genix', entryFamily: 'operator',
            decisionStage: 'execution', authoritySource: 'membership', outcome: 'allowed' });
        res.status(cutover.replay ? 200 : 201).json({ success: true, cutover });
    } catch (error) { lifecycleError(res, error, 'catalog_cutover_prepare_failed'); }
});

router.post('/catalog-cutovers/apply', requireAction('manage_accounts'), async (req, res) => {
    try {
        const cutover = await applyCatalogOwnershipCutover(pool, req.user, req.body || {});
        recordCompatibilityTelemetrySafe(pool, { businessContext: 'event_genix', entryFamily: 'operator',
            decisionStage: 'execution', authoritySource: 'membership', outcome: 'allowed' });
        res.status(cutover.replay ? 200 : 201).json({ success: true, cutover });
    } catch (error) { lifecycleError(res, error, 'catalog_cutover_apply_failed'); }
});

router.post('/:organizationId/businesses', async (req, res) => {
    try {
        const business = await lifecycle.createBusiness(pool, req.user, req.params.organizationId, req.body || {}, req);
        res.status(201).json({ success: true, business });
    } catch (error) { lifecycleError(res, error, 'business_create_failed'); }
});

router.patch('/businesses/:businessId', async (req, res) => {
    try {
        const business = await lifecycle.setBusinessStatus(pool, req.user, req.params.businessId, req.body?.status, req);
        res.json({ success: true, business });
    } catch (error) { lifecycleError(res, error, 'business_status_update_failed'); }
});

router.patch('/businesses/:businessId/configuration', async (req, res) => {
    try {
        const business = await lifecycle.updateBusinessConfiguration(pool, req.user, req.params.businessId, req.body, req);
        res.json({ success: true, business });
    } catch (error) { lifecycleError(res, error, 'business_configuration_update_failed'); }
});

router.post('/businesses/:businessId/initialize-resources', async (req, res) => {
    try {
        const initialization = await lifecycle.initializeBusinessResources(pool, req.user, req.params.businessId, req.body || {}, req);
        res.json({ success: true, initialization });
    } catch (error) { lifecycleError(res, error, 'business_resources_initialization_failed'); }
});

router.put('/:organizationId/members/:userId', async (req, res) => {
    try {
        const membership = await lifecycle.updateBusinessMembership(pool, req.user, req.params.organizationId, req.params.userId, req.body, req);
        res.json({ success: true, membership });
    } catch (error) { lifecycleError(res, error, 'business_membership_update_failed'); }
});

router.delete('/:organizationId/members/:userId/:businessId', async (req, res) => {
    try {
        await lifecycle.deactivateBusinessMembership(pool, req.user, req.params.organizationId, req.params.userId, req.params.businessId, req);
        res.json({ success: true });
    } catch (error) { lifecycleError(res, error, 'business_membership_deactivation_failed'); }
});

module.exports = router;
