'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    auditGraduationBusinessReadiness,
    auditGraduationBusinessSeedFiles,
    businessSpecificServiceFields,
    buildGraduationBusinessSeedSql,
    formatGraduationBusinessReadinessMarkdown,
    formatGraduationBusinessSeedSql,
    missingPackageServices
} = require('../services/graduationBusinessReadiness');

test('graduation business readiness audits real seed files without enabling Dar', () => {
    const report = auditGraduationBusinessSeedFiles({ businessContext: 'dar' });

    assert.equal(report.businessContext, 'dar');
    assert.equal(report.businessLabel, 'Дар');
    assert.equal(report.moduleEnabled, false);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.code, 'seed_source_drift');
    assert.equal(report.counts.packages, 7);
    assert.ok(report.counts.services >= 25);
    assert.equal(report.counts.missingPackageServices, 0);
    assert.equal(report.counts.seedSourceDrift, 1);
    assert.ok(report.counts.formulaServices > 0);
    assert.ok(report.counts.businessSpecificServices > 0);
    assert.match(report.warnings.join('\n'), /Graduation module is not enabled/);
    assert.match(report.warnings.join('\n'), /Park-specific wording or price_park/);
    assert.match(report.errors.join('\n'), /seed source is stale/);
    assert.match(formatGraduationBusinessReadinessMarkdown(report), /entry_price_below_current_floor/);
});

test('graduation business readiness keeps Event Genix enabled but still flags owner-review seed assumptions', () => {
    const report = auditGraduationBusinessSeedFiles({ businessContext: 'event_genix' });

    assert.equal(report.businessContext, 'event_genix');
    assert.equal(report.businessLabel, 'Парк Закревського');
    assert.equal(report.moduleEnabled, true);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.code, 'seed_source_drift');
    assert.equal(report.counts.missingPackageServices, 0);
    assert.match(formatGraduationBusinessReadinessMarkdown(report), /Owner review required/);
});

test('graduation business readiness blocks unknown businesses and package reference drift', () => {
    const unknown = auditGraduationBusinessReadiness({
        businessContext: 'unknown-company',
        services: [],
        packages: []
    });
    assert.equal(unknown.status, 'BLOCKED');
    assert.equal(unknown.code, 'unknown_business_context');

    const missing = missingPackageServices(
        [{ name: 'Package', slug: 'pkg', services: ['Known service', 'Missing service'] }],
        new Set(['Known service'])
    );
    assert.deepEqual(missing, [{
        packageSlug: 'pkg',
        packageName: 'Package',
        serviceName: 'Missing service'
    }]);

    const drift = auditGraduationBusinessReadiness({
        businessContext: 'event_genix',
        services: [{ name: 'Known service', description: 'Neutral', price_type: 'fixed' }],
        packages: [{ name: 'Package', slug: 'pkg', services: ['Missing service'] }]
    });
    assert.equal(drift.status, 'BLOCKED');
    assert.equal(drift.code, 'seed_reference_mismatch');
});

test('graduation business readiness identifies business-specific service fields', () => {
    assert.deepEqual(
        businessSpecificServiceFields({
            name: 'Neutral name',
            description: 'Свято у парку',
            price_park: 1200
        }),
        ['description', 'price_park']
    );
});

test('graduation business seed SQL preview is scoped, idempotent, and does not enable modules', () => {
    const seed = {
        services: [
            { name: 'Капсула часу', sort_order: 1, description: 'Neutral', duration_min: 30, price_per_child: 280, price_type: 'fixed' },
            { name: 'Видача дипломів', sort_order: 2, description: 'Neutral', duration_min: 30, price_per_child: 210, price_type: 'fixed' }
        ],
        packages: [
            { name: 'Package', slug: 'pkg', services: ['Капсула часу', 'Видача дипломів'] }
        ]
    };
    const report = auditGraduationBusinessReadiness({
        businessContext: 'event_genix',
        services: seed.services,
        packages: seed.packages
    });
    const sql = formatGraduationBusinessSeedSql(seed, report);

    assert.equal(report.status, 'READY');
    assert.match(sql, /Target business_context: event_genix/);
    assert.match(sql, /INSERT INTO graduation_settings \(business_context, key, value, label\)/);
    assert.match(sql, /INSERT INTO graduation_services \(business_context, sort_order, name/);
    assert.match(sql, /INSERT INTO graduation_packages \(business_context, name, slug/);
    assert.match(sql, /INSERT INTO graduation_package_items \(business_context, package_id, service_id\)/);
    assert.match(sql, /ON CONFLICT \(business_context, key\) DO NOTHING/);
    assert.match(sql, /ON CONFLICT \(business_context, name\) DO NOTHING/);
    assert.match(sql, /ON CONFLICT \(business_context, slug\) DO NOTHING/);
    assert.match(sql, /p\.business_context = 'event_genix'/);
    assert.match(sql, /s\.business_context = 'event_genix'/);
    assert.match(sql, /'capsule_time'/);
    assert.match(sql, /'diploma'/);
    assert.doesNotMatch(sql, /UPDATE\s+users/i);
    assert.doesNotMatch(sql, /businessContextHasModule|modules:\s*\[/);
    assert.doesNotMatch(sql, /INSERT INTO bookings/i);
});

test('graduation business seed SQL preview refuses blocked audits', () => {
    const { report, sql } = buildGraduationBusinessSeedSql({ businessContext: 'dar' });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.code, 'seed_source_drift');
    assert.equal(sql, '');

    const unknown = buildGraduationBusinessSeedSql({ businessContext: 'ghost' });
    assert.equal(unknown.report.status, 'BLOCKED');
    assert.equal(unknown.report.code, 'unknown_business_context');
    assert.equal(unknown.sql, '');
});

test('graduation business readiness detects seed drift against later migration corrections', () => {
    const report = auditGraduationBusinessReadiness({
        businessContext: 'event_genix',
        services: [{ name: 'Вхід', price_per_child: 5, description: 'Вхід до парку' }],
        packages: []
    });

    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.code, 'seed_source_drift');
    assert.deepEqual(report.seedSourceDrift, [{
        code: 'entry_price_below_current_floor',
        source: 'db/migrations/088_fix_entry_price.sql',
        serviceName: 'Вхід',
        field: 'price_per_child',
        expected: '>= 10',
        actual: 5,
        message: 'graduation-services.json has "Вхід" price_per_child below the current migration floor.'
    }]);
});
