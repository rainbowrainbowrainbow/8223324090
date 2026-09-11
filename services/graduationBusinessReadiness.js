'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextCatalog,
    businessContextHasModule,
    normalizeKnownBusinessContext
} = require('./businessContext');

const BUSINESS_SPECIFIC_TERM_PATTERNS = Object.freeze([
    /парк/iu,
    /закревськ/iu,
    /\bpark\b/iu
]);
const DEFAULT_GRADUATION_SETTINGS_SEED = Object.freeze([
    { key: 'coefficient', value: 6.0, label: 'Коефіцієнт ціноутворення' },
    { key: 'markup', value: 1.15, label: 'Надбавка (×1.15 = +15%)' },
    { key: 'min_price_per_child', value: 599, label: 'Мінімальна ціна за дитину' },
    { key: 'kickback_rate', value: 0.10, label: 'Відсоток відкату (10%)' },
    { key: 'mk_external_rate', value: 0.80, label: 'МК: % зовнішньому підряднику' }
]);
const SERVICE_COST_COLUMN_BY_KEY = Object.freeze({
    host: 'cost_host',
    costume: 'cost_costume',
    balloons_per_kid: 'cost_balloons_per_kid',
    aquagrim_per_kid: 'cost_aquagrim_per_kid',
    print_per_kid: 'cost_print_per_kid',
    design_per_kid: 'cost_design_per_kid',
    delivery: 'cost_delivery',
    ice: 'cost_ice',
    other: 'cost_other',
    box: 'cost_box',
    markers: 'cost_markers',
    solution: 'cost_solution',
    cleaning: 'cost_cleaning',
    drinks_per_kid: 'cost_drinks_per_kid'
});
const SERVICE_SEED_COLUMNS = Object.freeze([
    'business_context',
    'sort_order',
    'name',
    'description',
    'duration_min',
    'price_park',
    'price_per_child',
    'price_type',
    'cost_host',
    'cost_costume',
    'cost_balloons_per_kid',
    'cost_aquagrim_per_kid',
    'cost_print_per_kid',
    'cost_design_per_kid',
    'cost_delivery',
    'cost_ice',
    'cost_other',
    'cost_box',
    'cost_markers',
    'cost_solution',
    'cost_cleaning',
    'cost_drinks_per_kid',
    'cost_type',
    'category',
    'min_kids',
    'max_kids',
    'entry_rule',
    'is_active',
    'catalog_description',
    'timeline_visible',
    'operation_kind',
    'automation_flags'
]);
const KNOWN_SEED_DRIFT_RULES = Object.freeze([
    {
        code: 'entry_price_below_current_floor',
        source: 'db/migrations/088_fix_entry_price.sql',
        serviceName: 'Вхід',
        field: 'price_per_child',
        minValue: 10,
        message: 'graduation-services.json has "Вхід" price_per_child below the current migration floor.'
    }
]);

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadGraduationSeedFiles(rootDir = path.join(__dirname, '..')) {
    return {
        services: readJsonFile(path.join(rootDir, 'data', 'graduation-services.json')),
        packages: readJsonFile(path.join(rootDir, 'data', 'graduation-packages.json'))
    };
}

function graduationBusinessCatalogEntry(businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const normalized = normalizeKnownBusinessContext(businessContext);
    if (!normalized) return null;
    return businessContextCatalog().find(item => item.key === normalized) || null;
}

function hasBusinessSpecificTerms(value) {
    const text = String(value || '');
    return BUSINESS_SPECIFIC_TERM_PATTERNS.some(pattern => pattern.test(text));
}

function businessSpecificServiceFields(service = {}) {
    const fields = [];
    if (hasBusinessSpecificTerms(service.name)) fields.push('name');
    if (hasBusinessSpecificTerms(service.description)) fields.push('description');
    if (Object.prototype.hasOwnProperty.call(service, 'price_park')) fields.push('price_park');
    return fields;
}

function sqlLiteral(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJsonbLiteral(value) {
    if (value === null || value === undefined) return 'NULL';
    return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function numericSeedValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function inferGraduationOperationKind(service = {}) {
    const name = String(service.name || '').toLowerCase();
    if (name.includes('диплом')) return 'diploma';
    if (name.includes('капсула')) return 'capsule_time';
    return 'service';
}

function normalizeServiceSeedRecord(service = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const costs = service.costs && typeof service.costs === 'object' && !Array.isArray(service.costs)
        ? service.costs
        : {};
    const record = {
        business_context: businessContext,
        sort_order: numericSeedValue(service.sort_order, 0),
        name: String(service.name || '').trim(),
        description: service.description || null,
        duration_min: numericSeedValue(service.duration_min, 0),
        price_park: numericSeedValue(service.price_park, 0),
        price_per_child: numericSeedValue(service.price_per_child, 0),
        price_type: service.price_type || 'fixed',
        cost_type: service.cost_type || 'standard',
        category: service.category || 'main',
        min_kids: numericSeedValue(service.min_kids, 0),
        max_kids: numericSeedValue(service.max_kids, 0),
        entry_rule: service.entry_rule || null,
        is_active: service.is_active !== false,
        catalog_description: service.catalog_description || null,
        timeline_visible: service.timeline_visible !== false,
        operation_kind: service.operation_kind || inferGraduationOperationKind(service),
        automation_flags: service.automation_flags || {}
    };
    Object.entries(SERVICE_COST_COLUMN_BY_KEY).forEach(([costKey, column]) => {
        record[column] = numericSeedValue(costs[costKey], 0);
    });
    return record;
}

function normalizePackageSeedRecord(pkg = {}, businessContext = DEFAULT_BUSINESS_CONTEXT, sortOrder = 0) {
    return {
        business_context: businessContext,
        name: String(pkg.name || '').trim(),
        slug: String(pkg.slug || '').trim(),
        sort_order: numericSeedValue(pkg.sort_order, sortOrder),
        is_active: pkg.is_active !== false,
        min_kids: numericSeedValue(pkg.min_kids, 7),
        max_kids: numericSeedValue(pkg.max_kids, 50),
        image_url: pkg.image_url || null,
        description: pkg.description || null
    };
}

function formatInsertValues(record, columns) {
    return `(${columns.map(column => {
        if (column === 'entry_rule' || column === 'automation_flags') return sqlJsonbLiteral(record[column]);
        return sqlLiteral(record[column]);
    }).join(', ')})`;
}

function serviceNameSet(services = []) {
    return new Set(services.map(service => String(service?.name || '').trim()).filter(Boolean));
}

function missingPackageServices(packages = [], availableServices = new Set()) {
    return packages.flatMap(pkg => {
        const services = Array.isArray(pkg?.services) ? pkg.services : [];
        return services
            .filter(serviceName => !availableServices.has(String(serviceName || '').trim()))
            .map(serviceName => ({
                packageSlug: pkg?.slug || null,
                packageName: pkg?.name || null,
                serviceName
            }));
    });
}

function detectGraduationSeedSourceDrift(services = []) {
    const drifts = [];
    KNOWN_SEED_DRIFT_RULES.forEach(rule => {
        const service = services.find(item => String(item?.name || '').trim() === rule.serviceName);
        if (!service) return;
        const actual = numericSeedValue(service[rule.field], 0);
        if (actual >= rule.minValue) return;
        drifts.push({
            code: rule.code,
            source: rule.source,
            serviceName: rule.serviceName,
            field: rule.field,
            expected: `>= ${rule.minValue}`,
            actual,
            message: rule.message
        });
    });
    return drifts;
}

function auditGraduationBusinessReadiness(options = {}) {
    const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
    const catalogEntry = graduationBusinessCatalogEntry(businessContext);
    if (!catalogEntry) {
        return {
            status: 'BLOCKED',
            code: 'unknown_business_context',
            businessContext,
            errors: [`Unknown business context: ${businessContext}`],
            warnings: []
        };
    }

    const services = Array.isArray(options.services) ? options.services : [];
    const packages = Array.isArray(options.packages) ? options.packages : [];
    const availableServices = serviceNameSet(services);
    const missingServices = missingPackageServices(packages, availableServices);
    const seedSourceDrift = detectGraduationSeedSourceDrift(services);
    const businessSpecificServices = services
        .map(service => ({
            name: service?.name || '',
            fields: businessSpecificServiceFields(service)
        }))
        .filter(item => item.fields.length > 0);
    const formulaServices = services.filter(service => service?.price_type === 'formula');
    const warnings = [];

    if (!businessContextHasModule(catalogEntry.key, 'graduation')) {
        warnings.push('Graduation module is not enabled for this business context.');
    }
    if (businessSpecificServices.length) {
        warnings.push('Seed data contains Park-specific wording or price_park fields and needs owner review before reuse.');
    }
    if (formulaServices.length) {
        warnings.push('Formula-priced services depend on current graduation coefficient/markup settings.');
    }

    const errors = [];
    if (missingServices.length) {
        errors.push('Some package service references are missing from graduation-services.json.');
    }
    if (seedSourceDrift.length) {
        errors.push('Graduation seed source is stale compared with later migration corrections.');
    }

    return {
        status: errors.length ? 'BLOCKED' : (warnings.length ? 'NEEDS_REVIEW' : 'READY'),
        code: seedSourceDrift.length
            ? 'seed_source_drift'
            : (missingServices.length ? 'seed_reference_mismatch' : (warnings.length ? 'owner_review_required' : 'ready')),
        businessContext: catalogEntry.key,
        businessLabel: catalogEntry.label || catalogEntry.shortLabel || catalogEntry.key,
        moduleEnabled: businessContextHasModule(catalogEntry.key, 'graduation'),
        counts: {
            services: services.length,
            packages: packages.length,
            formulaServices: formulaServices.length,
            businessSpecificServices: businessSpecificServices.length,
            missingPackageServices: missingServices.length,
            seedSourceDrift: seedSourceDrift.length
        },
        missingServices,
        seedSourceDrift,
        businessSpecificServices,
        warnings,
        errors
    };
}

function auditGraduationBusinessSeedFiles(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..');
    const seed = loadGraduationSeedFiles(rootDir);
    return auditGraduationBusinessReadiness({
        businessContext: options.businessContext,
        services: seed.services,
        packages: seed.packages
    });
}

function formatGraduationBusinessSeedSql(seed = {}, report = {}) {
    if (report.status === 'BLOCKED') return '';
    const businessContext = report.businessContext || DEFAULT_BUSINESS_CONTEXT;
    const services = Array.isArray(seed.services) ? seed.services : [];
    const packages = Array.isArray(seed.packages) ? seed.packages : [];
    const settingsRows = DEFAULT_GRADUATION_SETTINGS_SEED.map(item => ({
        business_context: businessContext,
        key: item.key,
        value: item.value,
        label: item.label
    }));
    const serviceRows = services.map(service => normalizeServiceSeedRecord(service, businessContext));
    const packageRows = packages.map((pkg, index) => normalizePackageSeedRecord(pkg, businessContext, index + 1));
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];

    const lines = [
        '-- Generated graduation seed preview.',
        '-- Review this SQL before applying it. It intentionally does not enable the graduation module for any business.',
        '-- Requires migration 355_graduation_business_context.sql to be applied first.',
        `-- Target business_context: ${businessContext}`,
        `-- Readiness status: ${report.status || 'UNKNOWN'} (${report.code || 'unknown'})`
    ];
    warnings.forEach(warning => lines.push(`-- WARNING: ${warning}`));
    lines.push('', 'BEGIN;', '');

    if (settingsRows.length) {
        lines.push(
            'INSERT INTO graduation_settings (business_context, key, value, label)',
            `VALUES\n${settingsRows.map(row => formatInsertValues(row, ['business_context', 'key', 'value', 'label'])).join(',\n')}`,
            'ON CONFLICT (business_context, key) DO NOTHING;',
            ''
        );
    }

    if (serviceRows.length) {
        lines.push(
            `INSERT INTO graduation_services (${SERVICE_SEED_COLUMNS.join(', ')})`,
            `VALUES\n${serviceRows.map(row => formatInsertValues(row, SERVICE_SEED_COLUMNS)).join(',\n')}`,
            'ON CONFLICT (business_context, name) DO NOTHING;',
            ''
        );
    }

    if (packageRows.length) {
        const packageColumns = ['business_context', 'name', 'slug', 'sort_order', 'is_active', 'min_kids', 'max_kids', 'image_url', 'description'];
        lines.push(
            `INSERT INTO graduation_packages (${packageColumns.join(', ')})`,
            `VALUES\n${packageRows.map(row => formatInsertValues(row, packageColumns)).join(',\n')}`,
            'ON CONFLICT (business_context, slug) DO NOTHING;',
            ''
        );
    }

    packages.forEach(pkg => {
        const serviceNames = Array.isArray(pkg?.services) ? pkg.services.map(item => String(item || '').trim()).filter(Boolean) : [];
        const slug = String(pkg?.slug || '').trim();
        if (!slug || !serviceNames.length) return;
        lines.push(
            'INSERT INTO graduation_package_items (business_context, package_id, service_id)',
            'SELECT',
            `    ${sqlLiteral(businessContext)} AS business_context,`,
            '    p.id AS package_id,',
            '    s.id AS service_id',
            'FROM graduation_packages p',
            'JOIN graduation_services s',
            `  ON s.business_context = ${sqlLiteral(businessContext)}`,
            ` AND s.name IN (${serviceNames.map(sqlLiteral).join(', ')})`,
            `WHERE p.business_context = ${sqlLiteral(businessContext)}`,
            `  AND p.slug = ${sqlLiteral(slug)}`,
            'ON CONFLICT DO NOTHING;',
            ''
        );
    });

    lines.push('COMMIT;', '');
    return lines.join('\n');
}

function buildGraduationBusinessSeedSql(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..');
    const seed = loadGraduationSeedFiles(rootDir);
    const report = auditGraduationBusinessReadiness({
        businessContext: options.businessContext,
        services: seed.services,
        packages: seed.packages
    });
    return {
        report,
        sql: formatGraduationBusinessSeedSql(seed, report)
    };
}

function formatGraduationBusinessReadinessMarkdown(report = {}) {
    const lines = [
        `# Graduation business readiness: ${report.businessLabel || report.businessContext || 'unknown'}`,
        '',
        `Status: **${report.status || 'UNKNOWN'}**`,
        `Business context: \`${report.businessContext || 'unknown'}\``,
        `Graduation module enabled: ${report.moduleEnabled ? 'yes' : 'no'}`,
        '',
        '## Counts',
        '',
        `- Services: ${report.counts?.services || 0}`,
        `- Packages: ${report.counts?.packages || 0}`,
        `- Formula services: ${report.counts?.formulaServices || 0}`,
        `- Business-specific services: ${report.counts?.businessSpecificServices || 0}`,
        `- Missing package service references: ${report.counts?.missingPackageServices || 0}`,
        `- Seed source drift findings: ${report.counts?.seedSourceDrift || 0}`
    ];

    if (Array.isArray(report.warnings) && report.warnings.length) {
        lines.push('', '## Warnings', '');
        report.warnings.forEach(item => lines.push(`- ${item}`));
    }
    if (Array.isArray(report.errors) && report.errors.length) {
        lines.push('', '## Errors', '');
        report.errors.forEach(item => lines.push(`- ${item}`));
    }
    if (Array.isArray(report.businessSpecificServices) && report.businessSpecificServices.length) {
        lines.push('', '## Owner review required', '');
        report.businessSpecificServices.slice(0, 20).forEach(item => {
            lines.push(`- ${item.name}: ${item.fields.join(', ')}`);
        });
        if (report.businessSpecificServices.length > 20) {
            lines.push(`- ...and ${report.businessSpecificServices.length - 20} more`);
        }
    }
    if (Array.isArray(report.missingServices) && report.missingServices.length) {
        lines.push('', '## Missing service references', '');
        report.missingServices.forEach(item => {
            lines.push(`- ${item.packageSlug || item.packageName || 'package'} → ${item.serviceName}`);
        });
    }
    if (Array.isArray(report.seedSourceDrift) && report.seedSourceDrift.length) {
        lines.push('', '## Seed source drift', '');
        report.seedSourceDrift.forEach(item => {
            lines.push(`- ${item.code}: ${item.serviceName}.${item.field} is ${item.actual}, expected ${item.expected}. Source: ${item.source}`);
        });
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    auditGraduationBusinessReadiness,
    auditGraduationBusinessSeedFiles,
    businessSpecificServiceFields,
    buildGraduationBusinessSeedSql,
    detectGraduationSeedSourceDrift,
    formatGraduationBusinessSeedSql,
    formatGraduationBusinessReadinessMarkdown,
    loadGraduationSeedFiles,
    missingPackageServices
};
