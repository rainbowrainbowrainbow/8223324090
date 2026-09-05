'use strict';

const crypto = require('node:crypto');

const SOURCE_TYPE = 'catalog_sale';
const ITEM_TYPE = 'catalog_sale';
const PROVIDER = 'checkbox';
const APPLY_CONFIRM_ENV = 'EVENTGENIX_ALLOW_CATALOG_MAPPING_APPLY';

const CATALOG_SCOPES = Object.freeze([
    Object.freeze({
        businessContext: 'event_genix',
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        expectedCatalogCount: 140,
        expectedAdmissionCount: 6,
        requiredUpdatedBy: null
    }),
    Object.freeze({
        businessContext: 'dar',
        crmProfileKey: 'dar',
        locationAlias: 'dar',
        registerAlias: 'dar',
        expectedCatalogCount: 21,
        expectedAdmissionCount: 0,
        requiredUpdatedBy: 'migration_347_dar_catalog'
    })
]);

const CATALOG_ROUTE_SCOPES = Object.freeze([
    Object.freeze({ ...CATALOG_SCOPES[0], routeOptionId: 'park_production', mode: 'production' }),
    Object.freeze({ ...CATALOG_SCOPES[0], routeOptionId: 'park_test', mode: 'test' }),
    Object.freeze({ ...CATALOG_SCOPES[1], routeOptionId: 'dar_production', mode: 'production' }),
    Object.freeze({ ...CATALOG_SCOPES[1], routeOptionId: 'dar_test', mode: 'test' })
]);

class CatalogSaleMappingConfigError extends Error {
    constructor(code, message, details = null) {
        super(message || code);
        this.name = 'CatalogSaleMappingConfigError';
        this.code = code;
        this.details = details;
    }
}

function integer(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
}

function cleanText(value) {
    return String(value == null ? '' : value).trim();
}

function classifyCatalogRows(rows, scope) {
    const eligible = [];
    const excluded = {
        inactive: [],
        unavailable: [],
        missingPriceRule: [],
        nonPositivePrice: [],
        ambiguousPrice: [],
        invalidIdentity: [],
        ownershipDrift: []
    };
    const seen = new Set();

    for (const row of rows || []) {
        const itemCode = cleanText(row.id);
        const name = cleanText(row.name);
        const ruleCount = integer(row.price_rule_count);
        const positiveRuleCount = integer(row.positive_price_rule_count);

        if (!itemCode || !name || seen.has(itemCode)) {
            excluded.invalidIdentity.push(itemCode || '(missing)');
            continue;
        }
        seen.add(itemCode);
        if (row.is_active !== true) {
            excluded.inactive.push(itemCode);
            continue;
        }
        if (cleanText(row.availability_status || 'active') !== 'active') {
            excluded.unavailable.push(itemCode);
            continue;
        }
        if (scope.requiredUpdatedBy && cleanText(row.updated_by) !== scope.requiredUpdatedBy) {
            excluded.ownershipDrift.push(itemCode);
            continue;
        }
        if (ruleCount === 0) {
            excluded.missingPriceRule.push(itemCode);
            continue;
        }
        if (ruleCount > 1) {
            excluded.ambiguousPrice.push(itemCode);
            continue;
        }
        if (positiveRuleCount !== 1) {
            excluded.nonPositivePrice.push(itemCode);
            continue;
        }
        eligible.push({
            crmProfileKey: scope.crmProfileKey,
            sourceType: SOURCE_TYPE,
            itemType: ITEM_TYPE,
            itemCode,
            fiscalItemName: name,
            provider: PROVIDER,
            providerTaxId: null,
            taxCode: null,
            taxRateBps: null,
            taxMode: 'untaxed',
            status: 'active'
        });
    }

    eligible.sort((left, right) => left.itemCode.localeCompare(right.itemCode));
    for (const values of Object.values(excluded)) values.sort();
    return { eligible, excluded };
}

function sameNullable(left, right) {
    if (right == null) return left == null;
    return left === right;
}

function mappingMatches(row, desired) {
    return cleanText(row.crm_profile_key) === desired.crmProfileKey
        && cleanText(row.business_context || row.crm_profile_key) === desired.businessContext
        && cleanText(row.source_type) === desired.sourceType
        && cleanText(row.item_type) === desired.itemType
        && cleanText(row.item_code) === desired.itemCode
        && cleanText(row.fiscal_item_name) === desired.fiscalItemName
        && cleanText(row.provider) === desired.provider
        && sameNullable(row.provider_tax_id, desired.providerTaxId)
        && sameNullable(row.tax_code, desired.taxCode)
        && sameNullable(row.tax_rate_bps, desired.taxRateBps)
        && cleanText(row.tax_mode) === desired.taxMode
        && cleanText(row.status) === desired.status;
}

function diffMappings(desiredMappings, existingRows) {
    const existingByCode = new Map();
    const duplicateCodes = [];
    for (const row of existingRows || []) {
        const code = cleanText(row.item_code);
        if (existingByCode.has(code)) duplicateCodes.push(code);
        else existingByCode.set(code, row);
    }

    const inserts = [];
    const updates = [];
    const noOps = [];
    for (const desired of desiredMappings) {
        const existing = existingByCode.get(desired.itemCode);
        if (!existing) inserts.push(desired);
        else if (mappingMatches(existing, desired)) noOps.push(desired.itemCode);
        else updates.push(desired);
        existingByCode.delete(desired.itemCode);
    }

    return {
        inserts,
        updates,
        noOps: noOps.sort(),
        staleCodes: [...existingByCode.keys()].filter(Boolean).sort(),
        duplicateCodes: [...new Set(duplicateCodes)].sort()
    };
}

async function loadScopeTarget(client, scope) {
    if (scope.routeOptionId) {
        const result = await client.query(
            `/* catalog-sale-config:route-target */
             SELECT fsr.route_option_id,
                    fsr.business_context,
                    fsr.mode,
                    fsr.expected_is_test,
                    fsr.status AS route_status,
                    fsr.feature_enabled AS route_feature_enabled,
                    fsr.acceptance_enabled AS route_acceptance_enabled,
                    fsr.shared_register_group,
                    fp.id AS fiscal_profile_id,
                    fp.crm_profile_key,
                    fl.id AS fiscal_location_id,
                    fr.id AS fiscal_register_id,
                    fp.status AS profile_status,
                    fl.status AS location_status,
                    fr.status AS register_status,
                    fr.feature_enabled,
                    (NULLIF(BTRIM(COALESCE(fr.provider_license_ref, '')), '') IS NOT NULL) AS register_reference_configured
               FROM fiscal_sale_routes fsr
               JOIN fiscal_profiles fp ON fp.id = fsr.fiscal_profile_id
               JOIN fiscal_locations fl
                 ON fl.id = fsr.fiscal_location_id
                AND fl.fiscal_profile_id = fp.id
               JOIN fiscal_registers fr
                 ON fr.id = fsr.fiscal_register_id
                AND fr.fiscal_profile_id = fp.id
                AND fr.fiscal_location_id = fl.id
              WHERE fsr.route_option_id = $1
                AND fsr.business_context = $2
                AND fsr.mode = $3
                AND fr.provider = $4
              ORDER BY fp.id, fr.id`,
            [scope.routeOptionId, scope.businessContext, scope.mode, PROVIDER]
        );
        return result.rows;
    }
    const result = await client.query(
        `/* catalog-sale-config:target */
         SELECT fp.id AS fiscal_profile_id,
                fp.crm_profile_key,
                fl.id AS fiscal_location_id,
                fr.id AS fiscal_register_id,
                fp.status AS profile_status,
                fl.status AS location_status,
                fr.status AS register_status,
                fr.feature_enabled,
                (NULLIF(BTRIM(COALESCE(fr.provider_license_ref, '')), '') IS NOT NULL) AS register_reference_configured
           FROM fiscal_profiles fp
           JOIN fiscal_locations fl
             ON fl.fiscal_profile_id = fp.id
            AND fl.crm_profile_key = fp.crm_profile_key
            AND fl.location_alias = $2
           JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.fiscal_location_id = fl.id
            AND fr.crm_profile_key = fp.crm_profile_key
            AND fr.register_alias = $3
            AND fr.provider = $4
          WHERE fp.crm_profile_key = $1
            AND fp.provider = $4
          ORDER BY fp.id, fr.id`,
        [scope.crmProfileKey, scope.locationAlias, scope.registerAlias, PROVIDER]
    );
    return result.rows;
}

async function loadCatalogRows(client, scope) {
    const result = await client.query(
        `/* catalog-sale-config:products */
         SELECT p.id, p.name, p.is_active, p.availability_status, p.updated_by,
                COUNT(pr.id)::integer AS price_rule_count,
                COUNT(pr.id) FILTER (WHERE pr.value > 0)::integer AS positive_price_rule_count
           FROM products p
           LEFT JOIN price_rules pr ON pr.product_id = p.id
          WHERE p.business_context = $1
          GROUP BY p.id, p.name, p.is_active, p.availability_status, p.updated_by
          ORDER BY p.id`,
        [scope.businessContext]
    );
    return result.rows;
}

async function loadExistingMappings(client, target, businessContext) {
    const result = await client.query(
        `/* catalog-sale-config:existing-mappings */
         SELECT crm_profile_key, business_context, source_type, item_type, item_code, fiscal_item_name,
                provider, provider_tax_id, tax_code, tax_rate_bps, tax_mode, status
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND source_type = $3
            AND item_type = $4
            AND provider = $5
            AND COALESCE(business_context, crm_profile_key) = $6
          ORDER BY item_code`,
        [target.fiscal_profile_id, target.fiscal_register_id, SOURCE_TYPE, ITEM_TYPE, PROVIDER, businessContext]
    );
    return result.rows;
}

async function loadCrossScopeMappingCodes(client, target, businessContext, itemCodes) {
    if (!itemCodes.length) return [];
    const result = await client.query(
        `/* catalog-sale-config:cross-scope */
         SELECT DISTINCT item_code
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND COALESCE(business_context, crm_profile_key) <> $6
            AND source_type = $3
            AND item_type = $4
            AND provider = $5
            AND status = 'active'
            AND item_code = ANY($7::text[])
          ORDER BY item_code`,
        [target.fiscal_profile_id, target.fiscal_register_id, SOURCE_TYPE, ITEM_TYPE, PROVIDER, businessContext, itemCodes]
    );
    return result.rows.map(row => cleanText(row.item_code)).filter(Boolean);
}

async function loadAdmissionCodes(client, target) {
    const result = await client.query(
        `/* catalog-sale-config:admission-mappings */
         SELECT item_code
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND COALESCE(business_context, crm_profile_key) = $4
            AND source_type = 'admission_ticket'
            AND item_type = 'admission_ticket'
            AND provider = $3
            AND status = 'active'
          ORDER BY item_code`,
        [target.fiscal_profile_id, target.fiscal_register_id, PROVIDER, target.business_context]
    );
    return result.rows.map(row => cleanText(row.item_code)).filter(Boolean);
}

async function loadCashierReferenceStatus(client, target) {
    const result = await client.query(
        `/* catalog-sale-config:cashier-status */
         SELECT COUNT(*) FILTER (WHERE status = 'active')::integer AS active_count,
                COUNT(*) FILTER (
                    WHERE status = 'active'
                      AND NULLIF(BTRIM(COALESCE(provider_cashier_login_ref, '')), '') IS NOT NULL
                )::integer AS configured_count
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND provider = $3`,
        [target.fiscal_profile_id, target.fiscal_register_id, PROVIDER]
    );
    return result.rows[0] || { active_count: 0, configured_count: 0 };
}

function conflict(type, scope, itemCodes = []) {
    return {
        type,
        businessContext: scope.businessContext,
        itemCodes: [...new Set(itemCodes.filter(Boolean))].sort()
    };
}

async function planScope(client, scope) {
    const targets = await loadScopeTarget(client, scope);
    if (targets.length !== 1) {
        return {
            scope,
            target: null,
            desiredMappings: [],
            excluded: {},
            diff: { inserts: [], updates: [], noOps: [], staleCodes: [], duplicateCodes: [] },
            admissionCodes: [],
            cashierReferenceStatus: { active_count: 0, configured_count: 0 },
            conflicts: [conflict(targets.length ? 'ambiguous_fiscal_target' : 'missing_fiscal_target', scope)]
        };
    }

    const target = targets[0];
    const rows = await loadCatalogRows(client, scope);
    const classified = classifyCatalogRows(rows, scope);
    classified.eligible = classified.eligible.map(mapping => ({
        ...mapping,
        crmProfileKey: target.crm_profile_key,
        businessContext: scope.businessContext
    }));
    target.business_context = scope.businessContext;
    const existing = await loadExistingMappings(client, target, scope.businessContext);
    const mappingDiff = diffMappings(classified.eligible, existing);
    const itemCodes = classified.eligible.map(item => item.itemCode);
    const crossScopeCodes = await loadCrossScopeMappingCodes(client, target, scope.businessContext, itemCodes);
    const admissionCodes = await loadAdmissionCodes(client, target);
    const cashierReferenceStatus = await loadCashierReferenceStatus(client, target);
    const conflicts = [];

    if (classified.eligible.length !== scope.expectedCatalogCount) {
        conflicts.push(conflict('audited_catalog_count_mismatch', scope, itemCodes));
    }
    if (scope.requiredUpdatedBy) {
        const migrationOwnedCodes = rows
            .filter(row => cleanText(row.updated_by) === scope.requiredUpdatedBy)
            .map(row => cleanText(row.id))
            .filter(Boolean);
        if (migrationOwnedCodes.length !== scope.expectedCatalogCount) {
            conflicts.push(conflict('catalog_seed_row_count_mismatch', scope, migrationOwnedCodes));
        }
    }
    if (mappingDiff.duplicateCodes.length) conflicts.push(conflict('duplicate_catalog_mapping', scope, mappingDiff.duplicateCodes));
    if (mappingDiff.staleCodes.length) conflicts.push(conflict('stale_catalog_mapping', scope, mappingDiff.staleCodes));
    if (crossScopeCodes.length) conflicts.push(conflict('cross_register_catalog_mapping', scope, crossScopeCodes));
    if (admissionCodes.length !== scope.expectedAdmissionCount || new Set(admissionCodes).size !== admissionCodes.length) {
        conflicts.push(conflict('admission_ticket_mapping_count_mismatch', scope, admissionCodes));
    }
    if (scope.requiredUpdatedBy && classified.excluded.ownershipDrift.length) {
        conflicts.push(conflict('catalog_seed_ownership_drift', scope, classified.excluded.ownershipDrift));
    }

    return {
        scope,
        target,
        desiredMappings: classified.eligible,
        excluded: classified.excluded,
        diff: mappingDiff,
        admissionCodes,
        cashierReferenceStatus,
        conflicts
    };
}

function summarizeExcluded(excluded = {}) {
    return Object.fromEntries(Object.entries(excluded).map(([key, values]) => [key, values.length]));
}

function safeScopeOutput(scopePlan) {
    const target = scopePlan.target;
    const activeCashiers = integer(scopePlan.cashierReferenceStatus.active_count);
    const configuredCashiers = integer(scopePlan.cashierReferenceStatus.configured_count);
    return {
        businessContext: scopePlan.scope.businessContext,
        routeOptionId: scopePlan.scope.routeOptionId || null,
        mode: scopePlan.scope.mode || 'production',
        scope: `${scopePlan.scope.crmProfileKey} / ${scopePlan.scope.locationAlias} / ${scopePlan.scope.registerAlias}`,
        expectedCatalogCount: scopePlan.scope.expectedCatalogCount,
        desiredCatalogCount: scopePlan.desiredMappings.length,
        stableItemCodes: scopePlan.desiredMappings.map(item => item.itemCode),
        changes: {
            insert: scopePlan.diff.inserts.length,
            update: scopePlan.diff.updates.length,
            noOp: scopePlan.diff.noOps.length,
            conflict: scopePlan.conflicts.length
        },
        excluded: summarizeExcluded(scopePlan.excluded),
        register: target ? {
            status: cleanText(target.register_status),
            featureEnabled: target.feature_enabled === true,
            referenceConfigured: target.register_reference_configured === true
        } : { status: 'missing', featureEnabled: false, referenceConfigured: false },
        cashiers: {
            active: activeCashiers,
            referencesConfigured: configuredCashiers,
            allActiveReferencesConfigured: activeCashiers > 0 && activeCashiers === configuredCashiers
        },
        admissionTicket: {
            expectedCount: scopePlan.scope.expectedAdmissionCount,
            activeCount: scopePlan.admissionCodes.length,
            unchanged: true
        },
        conflicts: scopePlan.conflicts
    };
}

function buildSafeDryRun(plan, mode = 'dry-run') {
    const scopes = plan.scopes.map(safeScopeOutput);
    return {
        mode,
        ready: plan.conflicts.length === 0,
        totals: {
            desired: plan.scopes.reduce((sum, item) => sum + item.desiredMappings.length, 0),
            insert: plan.scopes.reduce((sum, item) => sum + item.diff.inserts.length, 0),
            update: plan.scopes.reduce((sum, item) => sum + item.diff.updates.length, 0),
            noOp: plan.scopes.reduce((sum, item) => sum + item.diff.noOps.length, 0),
            conflict: plan.conflicts.length
        },
        scopes
    };
}

function selectCatalogScopes(options = {}) {
    const requested = Array.isArray(options.businessContexts)
        ? options.businessContexts.map(cleanText).filter(Boolean)
        : [];
    const routeOptionIds = Array.isArray(options.routeOptionIds)
        ? options.routeOptionIds.map(cleanText).filter(Boolean)
        : [];
    const sourceScopes = options.includeTestRoutes || routeOptionIds.length
        ? CATALOG_ROUTE_SCOPES
        : CATALOG_SCOPES;
    if (!requested.length && !routeOptionIds.length) return sourceScopes;

    const allowed = new Set(CATALOG_SCOPES.map(scope => scope.businessContext));
    const unknown = requested.filter(value => !allowed.has(value));
    if (unknown.length) {
        throw new CatalogSaleMappingConfigError(
            'catalog_mapping_business_context_invalid',
            `Unsupported catalog-sale business context: ${unknown.join(', ')}`
        );
    }
    const unknownRoutes = routeOptionIds.filter(value => !CATALOG_ROUTE_SCOPES.some(scope => scope.routeOptionId === value));
    if (unknownRoutes.length) {
        throw new CatalogSaleMappingConfigError(
            'catalog_mapping_route_option_invalid',
            `Unsupported fiscal sale route: ${unknownRoutes.join(', ')}`
        );
    }
    return sourceScopes.filter(scope => (
        (!requested.length || requested.includes(scope.businessContext))
        && (!routeOptionIds.length || routeOptionIds.includes(scope.routeOptionId))
    ));
}

async function planCatalogSaleMappings(client, options = {}) {
    const scopes = [];
    for (const scope of selectCatalogScopes(options)) scopes.push(await planScope(client, scope));
    return { scopes, conflicts: scopes.flatMap(item => item.conflicts) };
}

async function upsertMapping(client, scopePlan, mapping) {
    await client.query(
        `/* catalog-sale-config:upsert */
         INSERT INTO fiscal_item_mappings (
             fiscal_profile_id, fiscal_register_id, crm_profile_key, business_context, source_type, item_type,
             item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps,
             tax_mode, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL, 'untaxed', 'active')
         ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider)
         DO UPDATE SET
             crm_profile_key = EXCLUDED.crm_profile_key,
             business_context = EXCLUDED.business_context,
             fiscal_item_name = EXCLUDED.fiscal_item_name,
             provider_tax_id = NULL,
             tax_code = NULL,
             tax_rate_bps = NULL,
             tax_mode = 'untaxed',
             status = 'active',
             updated_at = NOW()`,
        [
            scopePlan.target.fiscal_profile_id,
            scopePlan.target.fiscal_register_id,
            mapping.crmProfileKey,
            mapping.businessContext,
            mapping.sourceType,
            mapping.itemType,
            mapping.itemCode,
            mapping.fiscalItemName,
            mapping.provider
        ]
    );
}

async function applyCatalogSaleMappings(client, env = process.env, options = {}) {
    if (String(env[APPLY_CONFIRM_ENV] || '').trim().toLowerCase() !== 'true') {
        throw new CatalogSaleMappingConfigError('catalog_mapping_apply_not_authorized', `Set ${APPLY_CONFIRM_ENV}=true only for an authorized local apply`);
    }

    await client.query('BEGIN');
    try {
        const lockKey = crypto.createHash('sha256').update('eventgenix-catalog-sale-mapping-v1').digest('hex');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
        const before = await planCatalogSaleMappings(client, options);
        if (before.conflicts.length) {
            throw new CatalogSaleMappingConfigError('catalog_mapping_conflict', 'Catalog mapping drift is ambiguous; apply refused', {
                conflicts: before.conflicts
            });
        }

        for (const scopePlan of before.scopes) {
            for (const mapping of [...scopePlan.diff.inserts, ...scopePlan.diff.updates]) {
                await upsertMapping(client, scopePlan, mapping);
            }
        }

        const after = await planCatalogSaleMappings(client, options);
        if (after.conflicts.length || after.scopes.some(item => item.diff.inserts.length || item.diff.updates.length)) {
            throw new CatalogSaleMappingConfigError('catalog_mapping_apply_verification_failed', 'Catalog mapping apply did not converge to an idempotent state');
        }
        await client.query('COMMIT');
        return {
            ...buildSafeDryRun(after, 'apply'),
            applied: buildSafeDryRun(before).totals
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

module.exports = {
    APPLY_CONFIRM_ENV,
    CATALOG_SCOPES,
    CATALOG_ROUTE_SCOPES,
    CatalogSaleMappingConfigError,
    buildSafeDryRun,
    classifyCatalogRows,
    diffMappings,
    selectCatalogScopes,
    planCatalogSaleMappings,
    applyCatalogSaleMappings
};
