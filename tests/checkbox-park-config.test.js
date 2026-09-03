const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    ACTION_PIN_ENV,
    actionPinEnvNameForUser,
    actionPinHashesByUser,
    capabilitiesForUser,
    DEFAULT_CAPABILITIES,
    PilotConfigError,
    parseArgs,
    pilotConfigTargetLockKey,
    publicPlan,
    run
} = require('../scripts/configure-checkbox-park-pilot');
const { verifyActionPin } = require('../services/payments/fiscalApprovals');

const SIX_TICKET_CODES = Object.freeze([
    'regular_child',
    'under_3_child',
    'discounted_child',
    'birthday_child',
    'adult_companion',
    'adult_game'
]);

const baseArgs = [
    '--legal-entity-key', 'park_fop',
    '--legal-entity-name', 'Park FOP',
    '--tax-identifier', '1234567890',
    '--provider-organization-id', 'org-1',
    '--location-name', 'Park',
    '--provider-outlet-id', 'outlet-1',
    '--register-name', 'Middle register',
    '--provider-register-id', 'register-1',
    '--provider-license-ref', 'park-middle',
    '--cashier-user-id', '50',
    '--provider-cashier-id', 'cashier-50',
    '--cashier-login-ref', 'park-middle',
    '--integration-owner', '50',
    '--expected-is-test', 'true',
    '--item', 'regular_child|Park child admission|taxed|7|1|0'
];
const mutationArgs = [...baseArgs, '--reason', 'test pilot config change'];
const authorizedMutationArgs = [...mutationArgs, '--actor-user-id', '50'];

function writeTempConfig(config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-checkbox-config-'));
    const file = path.join(dir, 'checkbox-park-test.config.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
}

function testConfig(overrides = {}) {
    return {
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        registerDisplayName: 'Middle test',
        legalEntityKey: 'park_test_fop',
        legalEntityName: 'Park Test FOP',
        taxIdentifier: '1234567890',
        provider: 'checkbox',
        registerCredentialRef: 'park_middle_test',
        cashierCredentialRef: 'park_middle_test',
        expectedIsTest: true,
        providerOrganizationId: 'org-test',
        providerOutletId: '',
        providerRegisterId: 'register-test',
        providerCashierId: 'cashier-test',
        integrationOwnerUserId: 4,
        cashierUserIds: [3, 4, 47],
        priceSource: 'EventGenix admission tariff immutable snapshot',
        items: SIX_TICKET_CODES.map(code => ({
            itemCode: code,
            fiscalItemName: `Fiscal ${code}`,
            taxMode: 'untaxed',
            providerTaxId: null
        })),
        eventGenixUsers: {
            primaryTestCashierUserId: 3,
            primaryTestCashierName: 'Наталія Василівна',
            cashierUserIds: [3, 4, 47],
            integrationOwnerUserIds: [4]
        },
        ...overrides
    };
}

function withoutItemArgs(args) {
    const output = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--item') {
            index += 1;
            continue;
        }
        output.push(args[index]);
    }
    return output;
}

test('park pilot config CLI is dry-run by default and never enables register feature flag', () => {
    const plan = parseArgs(baseArgs);
    const output = publicPlan(plan);
    assert.equal(output.mode, 'dry-run');
    assert.equal(output.crmProfileKey, 'event_genix');
    assert.equal(output.registerAlias, 'middle');
    assert.equal(output.featureEnabled, false);
    assert.equal(output.itemMappings[0].providerTaxId, '7');
    assert.equal(output.actionPinRequired, false);
    assert.equal(output.providerCashierIdConfigured, true);
    assert.equal(output.providerRegisterIdConfigured, true);
    assert.equal(output.providerOrganizationIdConfigured, true);
    assert.equal('providerCashierId' in output, false);
    assert.equal('providerRegisterId' in output, false);
    assert.equal('providerOrganizationId' in output, false);
    assert.equal(output.integrationOwner, 50);
    assert.equal(output.expectedIsTest, true);
    assert.equal(output.itemMappings[0].taxMode, 'taxed');
});

test('park pilot config grants Phase-1 shift close only to the exact integration owner binding', () => {
    const plan = parseArgs([
        ...baseArgs,
        '--cashier-user-id', '51',
        '--capabilities', 'payments.view,payments.create,payments.confirm_received,fiscal.shift.open,fiscal.shift.close'
    ]);
    assert.equal(capabilitiesForUser(plan, 50).includes('fiscal.shift.close'), true);
    assert.equal(capabilitiesForUser(plan, 51).includes('fiscal.shift.close'), false);
    const snapshot = require('../scripts/configure-checkbox-park-pilot').desiredSnapshot(plan);
    assert.equal(snapshot.bindings.find(binding => binding.userId === 50).capabilityScope.includes('fiscal.shift.close'), true);
    assert.equal(snapshot.bindings.find(binding => binding.userId === 51).capabilityScope.includes('fiscal.shift.close'), false);
});

test('park pilot config requires an exact integration owner user with a binding in the plan', () => {
    const replaceOwner = replacement => baseArgs.map((value, index, list) => (
        index > 0 && list[index - 1] === '--integration-owner' ? replacement : value
    ));
    assert.throws(
        () => parseArgs(replaceOwner('owner-label')),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_integration_owner_invalid'
    );
    assert.throws(
        () => parseArgs(replaceOwner('999')),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_integration_owner_binding_required'
    );
});

test('park pilot config accepts missing provider outlet without inventing an identifier', () => {
    const args = [];
    for (let index = 0; index < baseArgs.length; index += 1) {
        if (baseArgs[index] === '--provider-outlet-id') {
            index += 1;
            continue;
        }
        args.push(baseArgs[index]);
    }
    const plan = parseArgs(args);
    assert.equal(plan.providerOutletId, null);
    assert.equal(publicPlan(plan).providerOutletIdConfigured, false);
});

test('park pilot config rejects raw secret-like CLI arguments', () => {
    assert.throws(
        () => parseArgs([...baseArgs, '--password', 'plain']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_arg_forbidden'
    );
    assert.throws(
        () => parseArgs([...baseArgs, '--pin', 'forbidden-pin-value']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_arg_forbidden'
    );
});

test('park pilot config loads non-secret local config files and stays dry-run by default', () => {
    const file = writeTempConfig(testConfig());
    const plan = parseArgs(['--config-file', file]);
    const output = publicPlan(plan);
    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.crmProfileKey, 'event_genix');
    assert.equal(plan.locationAlias, 'park');
    assert.equal(plan.registerAlias, 'middle');
    assert.equal(plan.legalEntityKey, 'park_test_fop');
    assert.equal(plan.providerOutletId, null);
    assert.equal(plan.providerLicenseRef, 'park_middle_test');
    assert.equal(plan.cashierLoginRef, 'park_middle_test');
    assert.deepEqual(plan.cashierUserIds, [3, 4, 47]);
    assert.equal(plan.primaryTestCashierUserId, 3);
    assert.equal(plan.items.length, 6);
    assert.deepEqual(plan.items.map(item => item.itemCode), SIX_TICKET_CODES);
    assert.equal(output.providerOrganizationIdConfigured, true);
    assert.equal(output.providerRegisterIdConfigured, true);
    assert.equal(output.providerCashierIdConfigured, true);
    assert.doesNotMatch(JSON.stringify(output), /org-test|register-test|cashier-test/);
});

test('park pilot config supports CHECKBOX_PILOT_CONFIG_FILE env fallback', () => {
    const file = writeTempConfig(testConfig({ legalEntityKey: 'env_fop' }));
    const plan = parseArgs([], { CHECKBOX_PILOT_CONFIG_FILE: file });
    assert.equal(plan.legalEntityKey, 'env_fop');
    assert.equal(plan.mode, 'dry-run');
});

test('park pilot config supports npm 10 Windows-safe --config-file=<path> handoff', () => {
    const file = writeTempConfig(testConfig({ legalEntityKey: 'npm_config_fop' }));
    const plan = parseArgs([], {
        npm_lifecycle_event: 'configure:checkbox:park',
        npm_config_config_file: file
    });
    assert.equal(plan.legalEntityKey, 'npm_config_fop');
    assert.equal(plan.mode, 'dry-run');
    assert.throws(
        () => parseArgs([], { npm_config_config_file: file }),
        error => error instanceof PilotConfigError && error.code === 'legal_entity_key'
    );
});

test('park pilot config CLI --help exits successfully with canonical npm 10 Windows syntax', () => {
    const script = path.resolve(__dirname, '..', 'scripts', 'configure-checkbox-park-pilot.js');
    const result = spawnSync(process.execPath, [script, '--help'], {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /dry-run by default/i);
    assert.match(result.stdout, /--config-file="C:\\Users\\Plotva\\\.eventgenix\\checkbox-park-test\.config\.json"/);
    assert.match(result.stdout, /keep --config-file=<path> as one argument/i);
    assert.doesNotMatch(result.stdout, /pilot_config_arg_value_missing/);
});

test('park pilot config file rejects secrets and price overrides', () => {
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({ password: 'secret' }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_field_forbidden'
    );
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({ licenseKey: 'secret' }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_field_forbidden'
    );
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({ items: [{ itemCode: 'regular_child', fiscalItemName: 'Ticket', taxMode: 'untaxed', providerTaxId: null, priceOverride: 100 }] }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_price_override_forbidden'
    );
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({ priceSource: 'manual override' }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_price_source_invalid'
    );
});

test('park pilot config file enforces test-only QA user and unique item mappings', () => {
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({ expectedIsTest: false }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_qa_user_test_only'
    );
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(testConfig({
            items: [
                { itemCode: 'regular_child', fiscalItemName: 'One', taxMode: 'untaxed', providerTaxId: null },
                { itemCode: 'regular_child', fiscalItemName: 'Two', taxMode: 'untaxed', providerTaxId: null }
            ]
        }))]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_item_duplicate'
    );
});

test('park pilot config rejects preschool or non-middle activation', () => {
    assert.throws(
        () => parseArgs([...baseArgs, '--crm-profile', 'preschool']),
        error => error instanceof PilotConfigError
    );
});

test('park pilot config supports explicit preflight/status/enable/disable modes', () => {
    assert.equal(parseArgs(['preflight', ...baseArgs]).mode, 'preflight');
    assert.equal(parseArgs(['--enable-register', ...mutationArgs, '--actor-user-id', '50']).mode, 'enable-register');
    assert.equal(parseArgs(['--disable-register', '--legal-entity-key', 'park_fop', '--reason', 'test disable', '--actor-user-id', '50']).mode, 'disable-register');
    assert.equal(parseArgs(['status', '--legal-entity-key', 'park_fop']).mode, 'status');
    assert.equal(parseArgs(['diff', ...baseArgs]).mode, 'diff');
    assert.equal(parseArgs(['--replace-tax-mapping', ...mutationArgs, '--actor-user-id', '50']).mode, 'replace-tax-mapping');
    assert.equal(parseArgs(['--rotate-binding', ...mutationArgs, '--actor-user-id', '50']).mode, 'rotate-binding');
    assert.equal(parseArgs(['--change-owner', ...mutationArgs, '--actor-user-id', '50']).mode, 'change-owner');
});

test('park pilot config enforces explicit taxed/untaxed item mapping rules', () => {
    const untaxed = parseArgs([...baseArgs.slice(0, -2), '--item', 'regular_child|Park child admission|untaxed|||0']).items[0];
    assert.equal(untaxed.taxMode, 'untaxed');
    assert.equal(untaxed.providerTaxId, null);
    assert.throws(
        () => parseArgs([...baseArgs.slice(0, -2), '--item', 'regular_child|Park child admission|untaxed|7|1|0']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_item_tax_forbidden'
    );
    assert.throws(
        () => parseArgs([...baseArgs.slice(0, -2), '--item', 'regular_child|Park child admission|taxed|admission_tariff:1|1|0']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_item_tax_invalid'
    );
});

class FakePilotConfigDb {
    constructor() {
        this.profiles = new Map();
        this.locations = new Map();
        this.registers = new Map();
        this.bindings = new Map();
        this.items = new Map();
        this.audits = [];
        this.next = 1;
        this.queries = [];
    }

    async connect() {
        return new FakePilotConfigClient(this);
    }
}

class FakePilotConfigClient {
    constructor(db) {
        this.db = db;
    }

    async query(sql, params = []) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        this.db.queries.push({ sql: normalized, params });
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
        if (normalized.startsWith('SELECT fp.id AS fiscal_profile_id')) {
            const row = this.db.profiles.get(`${params[0]}:${params[1]}`);
            if (!row) return { rows: [] };
            const location = this.db.locations.get(`${row.id}:${params[2]}`) || {};
            const register = this.db.registers.get(`${row.id}:${params[3]}`) || {};
            return {
                rows: [{
                    fiscal_profile_id: row.id,
                    crm_profile_key: row.crm_profile_key,
                    legal_entity_key: row.legal_entity_key,
                    legal_entity_name: row.legal_entity_name,
                    tax_identifier: row.tax_identifier,
                    provider_organization_id: row.provider_organization_id,
                    fiscal_location_id: location.id,
                    location_alias: location.location_alias,
                    location_name: location.display_name,
                    provider_outlet_id: location.provider_outlet_id,
                    fiscal_register_id: register.id,
                    register_alias: register.register_alias,
                    register_name: register.display_name,
                    provider_register_id: register.provider_register_id,
                    provider_license_ref: register.provider_license_ref,
                    feature_enabled: register.feature_enabled,
                    register_status: register.status,
                    metadata: register.metadata || {}
                }]
            };
        }
        if (normalized.startsWith('SELECT fp.legal_entity_key')) return { rows: [] };
        if (normalized.startsWith('SELECT provider_license_ref AS credential_ref')) {
            return {
                rows: [
                    ...[...this.db.registers.values()].map(register => ({ credential_ref: register.provider_license_ref })),
                    ...[...this.db.bindings.values()].map(binding => ({ credential_ref: binding.provider_cashier_login_ref }))
                ].filter(row => row.credential_ref)
            };
        }
        if (normalized.startsWith('SELECT id, username, name, role') && normalized.includes('WHERE id = $1')) {
            return {
                rows: [{
                    id: params[0],
                    username: `actor-${params[0]}`,
                    name: `Actor ${params[0]}`,
                    role: 'creator',
                    extra_roles: [],
                    action_allowlist: [],
                    action_denylist: [],
                    is_active: true
                }]
            };
        }
        if (normalized.startsWith('SELECT id, username, name, role')) {
            return {
                rows: params[0].map(id => ({
                    id,
                    username: `user-${id}`,
                    name: Number(id) === 3 ? 'Наталія Василівна' : `User ${id}`,
                    role: 'creator',
                    extra_roles: [],
                    action_allowlist: [],
                    action_denylist: [],
                    is_active: true
                }))
            };
        }
        if (normalized.startsWith('SELECT code FROM admission_ticket_types')) {
            return { rows: [{ code: 'regular_child' }] };
        }
        if (normalized.startsWith('SELECT user_id, provider_cashier_id')) {
            return {
                rows: [...this.db.bindings.values()]
                    .filter(binding => binding.fiscal_profile_id === params[0] && binding.fiscal_register_id === params[1] && binding.status === 'active')
                    .sort((a, b) => Number(a.user_id) - Number(b.user_id))
                    .map(binding => ({
                        user_id: binding.user_id,
                        provider_cashier_id: binding.provider_cashier_id,
                        provider_cashier_login_ref: binding.provider_cashier_login_ref,
                        capability_scope: binding.capability_scope,
                        status: binding.status,
                        has_action_pin: Boolean(binding.action_pin_hash)
                    }))
            };
        }
        if (normalized.startsWith('SELECT id FROM fiscal_cashier_bindings')) {
            const binding = this.db.bindings.get(`${params[0]}:${params[1]}:${params[2]}`);
            return { rows: binding?.status === 'active' ? [{ id: 1 }] : [] };
        }
        if (normalized.startsWith('SELECT fim.item_code')) {
            return {
                rows: [...this.db.items.values()]
                    .filter(item => item.status === 'active')
                    .map(item => ({
                        item_code: item.item_code,
                        fiscal_item_name: item.fiscal_item_name,
                        tax_mode: item.tax_mode || 'taxed',
                        provider_tax_id: item.provider_tax_id,
                        tax_code: item.tax_code,
                        tax_rate_bps: item.tax_rate_bps,
                        count: 1
                    }))
            };
        }
        if (normalized.startsWith('INSERT INTO fiscal_profiles')) {
            const key = `${params[0]}:${params[1]}`;
            const row = this.db.profiles.get(key) || { id: this.db.next++ };
            Object.assign(row, {
                crm_profile_key: params[0],
                legal_entity_key: params[1],
                legal_entity_name: params[2],
                tax_identifier: params[3],
                provider: params[4],
                provider_organization_id: params[5],
                status: 'active'
            });
            this.db.profiles.set(key, row);
            return { rows: [row] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_locations')) {
            const key = `${params[0]}:${params[2]}`;
            const row = this.db.locations.get(key) || { id: this.db.next++ };
            Object.assign(row, { fiscal_profile_id: params[0], crm_profile_key: params[1], location_alias: params[2], display_name: params[3], provider_outlet_id: params[4], status: 'active' });
            this.db.locations.set(key, row);
            return { rows: [row] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_registers')) {
            const key = `${params[0]}:${params[3]}`;
            const row = this.db.registers.get(key) || { id: this.db.next++ };
            Object.assign(row, {
                fiscal_profile_id: params[0],
                fiscal_location_id: params[1],
                crm_profile_key: params[2],
                register_alias: params[3],
                display_name: params[4],
                provider: params[5],
                provider_register_id: params[6],
                provider_license_ref: params[7],
                status: 'active',
                feature_enabled: row.feature_enabled === true ? true : false,
                metadata: JSON.parse(params[8])
            });
            this.db.registers.set(key, row);
            return { rows: [row] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_cashier_bindings')) {
            this.db.bindings.set(`${params[0]}:${params[1]}:${params[4]}`, {
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                fiscal_location_id: params[2],
                crm_profile_key: params[3],
                user_id: params[4],
                provider: params[5],
                provider_cashier_id: params[6],
                provider_cashier_login_ref: params[7],
                capability_scope: params[8],
                action_pin_hash: params[9],
                status: 'active'
            });
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_item_mappings')) {
            this.db.items.set(`${params[0]}:${params[1]}:${params[5]}`, {
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                crm_profile_key: params[2],
                source_type: params[3],
                item_type: params[4],
                item_code: params[5],
                fiscal_item_name: params[6],
                provider: params[7],
                provider_tax_id: params[8],
                tax_code: params[9],
                tax_rate_bps: params[10],
                tax_mode: params[11],
                status: 'active'
            });
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE fiscal_item_mappings SET status =')) {
            const keep = new Set(params[5]);
            for (const item of this.db.items.values()) {
                if (item.fiscal_profile_id === params[0] && item.fiscal_register_id === params[1] && item.source_type === params[2] && item.item_type === params[3] && item.provider === params[4] && !keep.has(item.item_code)) {
                    item.status = 'archived';
                }
            }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE fiscal_cashier_bindings SET status =')) {
            for (const binding of this.db.bindings.values()) {
                if (binding.fiscal_profile_id === params[0] && binding.fiscal_register_id === params[1] && binding.status === 'active') binding.status = 'suspended';
            }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE fiscal_cashier_bindings SET capability_scope = CASE')) {
            for (const binding of this.db.bindings.values()) {
                if (binding.fiscal_profile_id !== params[0] || binding.fiscal_register_id !== params[1] || binding.status !== 'active') continue;
                const withoutClose = binding.capability_scope.filter(capability => capability !== 'fiscal.shift.close');
                binding.capability_scope = Number(binding.user_id) === Number(params[2])
                    ? [...new Set([...withoutClose, 'fiscal.shift.close'])]
                    : withoutClose;
            }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE fiscal_registers SET metadata =')) {
            for (const register of this.db.registers.values()) {
                if (register.id === params[1] && register.fiscal_profile_id === params[2] && register.register_alias === params[3]) {
                    register.metadata = { ...(register.metadata || {}), integration_owner: params[0] };
                }
            }
            return { rows: [] };
        }
        if (normalized.startsWith('UPDATE fiscal_registers SET feature_enabled =')) {
            for (const register of this.db.registers.values()) {
                if (register.id === params[1] && register.fiscal_profile_id === params[2] && register.register_alias === params[3]) {
                    register.feature_enabled = params[0] === true;
                    return { rows: [{ id: register.id, feature_enabled: register.feature_enabled }] };
                }
            }
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_configuration_audit')) {
            this.db.audits.push({
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                actor_user_id: params[2],
                actor_label: params[3],
                command: params[4],
                reason: params[5],
                before_hash: params[6],
                after_hash: params[7],
                before_snapshot: JSON.parse(params[8]),
                after_snapshot: JSON.parse(params[9])
            });
            return { rows: [] };
        }
        throw new Error(`Unhandled fake query: ${normalized}`);
    }

    release() {}
}

class SixTicketPilotConfigDb extends FakePilotConfigDb {}
class SixTicketPilotConfigClient extends FakePilotConfigClient {
    async query(sql, params = []) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT code FROM admission_ticket_types')) {
            return { rows: SIX_TICKET_CODES.map(code => ({ code })) };
        }
        return super.query(sql, params);
    }
}
SixTicketPilotConfigDb.prototype.connect = async function connect() { return new SixTicketPilotConfigClient(this); };

test('park pilot config apply is explicit and idempotent', async () => {
    await assert.rejects(
        () => run(['--apply', ...authorizedMutationArgs], { env: {}, dbPool: new FakePilotConfigDb() }),
        error => error.code === 'pilot_config_apply_not_allowed'
    );

    const db = new FakePilotConfigDb();
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    const first = await run(['--apply', ...authorizedMutationArgs], { env, dbPool: db });
    const second = await run(['--apply', ...authorizedMutationArgs], { env, dbPool: db });
    assert.equal(first.applied, true);
    assert.equal(second.applied, true);
    assert.equal(second.noChange, true);
    assert.equal(db.profiles.size, 1);
    assert.equal(db.locations.size, 1);
    assert.equal(db.registers.size, 1);
    assert.equal(db.bindings.size, 1);
    assert.equal(db.items.size, 1);
    assert.equal([...db.registers.values()][0].feature_enabled, false);
    assert.equal([...db.bindings.values()][0].crm_profile_key, 'event_genix');
    assert.equal([...db.bindings.values()][0].fiscal_location_id, 2);
    assert.equal([...db.bindings.values()][0].provider_cashier_id, 'cashier-50');
    assert.equal([...db.items.values()][0].tax_mode, 'taxed');
    assert.equal(db.audits.length, 1);
});

test('park pilot config rejects ambiguous legacy credentialRef', () => {
    const config = testConfig({ credentialRef: 'legacy_shared_ref' });
    delete config.registerCredentialRef;
    delete config.cashierCredentialRef;
    assert.throws(
        () => parseArgs(['--config-file', writeTempConfig(config)]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_credential_ref_ambiguous'
    );
});

test('park pilot config locks the canonical target before status, preflight, and apply reads', async () => {
    const basePlan = parseArgs(['apply', ...authorizedMutationArgs]);
    const changedProviderPlan = parseArgs([
        'apply',
        ...authorizedMutationArgs.flatMap((arg, index, list) => {
            if (arg === '--provider-register-id') return ['--provider-register-id', 'register-2'];
            return index > 0 && list[index - 1] === '--provider-register-id' ? [] : [arg];
        })
    ]);
    const otherFopPlan = parseArgs([
        'apply',
        ...authorizedMutationArgs.flatMap((arg, index, list) => {
            if (arg === '--legal-entity-key') return ['--legal-entity-key', 'other_fop'];
            return index > 0 && list[index - 1] === '--legal-entity-key' ? [] : [arg];
        })
    ]);
    assert.equal(
        pilotConfigTargetLockKey(basePlan),
        pilotConfigTargetLockKey(changedProviderPlan),
        'provider values must not split the canonical target lock'
    );
    assert.notEqual(pilotConfigTargetLockKey(basePlan), pilotConfigTargetLockKey(otherFopPlan));

    const cases = [
        ['status', ['status', '--legal-entity-key', 'park_fop'], {}],
        ['preflight', ['preflight', ...baseArgs], {}],
        ['apply', ['apply', ...authorizedMutationArgs], { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' }]
    ];
    for (const [mode, args, env] of cases) {
        const db = new FakePilotConfigDb();
        await run(args, { env, dbPool: db });
        const beginIndex = db.queries.findIndex(query => query.sql === 'BEGIN');
        const lockIndex = db.queries.findIndex(query => query.sql.includes('checkbox_pilot_config_target_lock'));
        const firstTargetReadIndex = db.queries.findIndex(query => query.sql.startsWith('SELECT fp.id AS fiscal_profile_id'));
        const commitIndex = db.queries.findIndex(query => query.sql === 'COMMIT');
        assert.ok(beginIndex >= 0 && beginIndex < lockIndex, `${mode} must acquire its target lock inside a transaction`);
        assert.ok(lockIndex < firstTargetReadIndex, `${mode} must re-read the target only after locking`);
        assert.ok(firstTargetReadIndex < commitIndex, `${mode} target read must remain in the lock transaction`);
    }
});

test('park pilot config file preflight verifies six active CRM ticket mappings and user capabilities', async () => {
    const file = writeTempConfig(testConfig());
    const result = await run(['preflight', '--config-file', file], { dbPool: new SixTicketPilotConfigDb() });
    assert.equal(result.ok, true);
    assert.equal(result.preflight.checks.find(check => check.code === 'item_mappings_complete').ok, true);
    assert.equal(result.preflight.checks.find(check => check.code === 'users_have_capabilities').ok, true);
    assert.equal(result.preflight.checks.find(check => check.code === 'primary_test_cashier_confirmed').ok, true);
    assert.equal(result.plan.itemMappings.length, 6);
});

test('park pilot config file preflight reports missing active CRM ticket mappings', async () => {
    const config = testConfig({ items: testConfig().items.filter(item => item.itemCode !== 'adult_game') });
    const result = await run(['preflight', '--config-file', writeTempConfig(config)], { dbPool: new SixTicketPilotConfigDb() });
    assert.equal(result.ok, false);
    const missing = result.preflight.checks.find(check => check.code === 'item_mappings_complete');
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.details.missingMappings, ['adult_game']);
});

test('park pilot config generic apply fails closed on drift and diff explains changes', async () => {
    const db = new FakePilotConfigDb();
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    await run(['--apply', ...authorizedMutationArgs], { env, dbPool: db });
    const changed = authorizedMutationArgs.flatMap((arg, index, list) => {
        if (arg === '--provider-register-id') return ['--provider-register-id', 'register-2'];
        return index > 0 && list[index - 1] === '--provider-register-id' ? [] : [arg];
    });
    const diff = await run(['diff', ...changed], { dbPool: db });
    assert.equal(diff.diff.found, true);
    assert.ok(diff.diff.changes.some(change => change.field === 'providerRegisterId'));
    await assert.rejects(
        () => run(['--apply', ...changed], { env, dbPool: db }),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_drift_requires_explicit_command'
    );
});

test('park pilot config explicit commands mutate with audit and keep register state intentional', async () => {
    const db = new FakePilotConfigDb();
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    await run(['--apply', ...authorizedMutationArgs], { env, dbPool: db });
    await run(['--enable-register', ...authorizedMutationArgs, '--reason', 'test enable after preflight'], { env, dbPool: db });
    assert.equal([...db.registers.values()][0].feature_enabled, true);
    await run(['--replace-tax-mapping', ...withoutItemArgs(authorizedMutationArgs), '--item', 'regular_child|Park child admission|taxed|8|1|0', '--reason', 'test tax mapping rotation'], { env, dbPool: db });
    assert.equal([...db.items.values()].find(item => item.item_code === 'regular_child').provider_tax_id, '8');
    const originalBinding = [...db.bindings.values()][0];
    db.bindings.set(`${originalBinding.fiscal_profile_id}:${originalBinding.fiscal_register_id}:51`, {
        ...originalBinding,
        user_id: 51,
        capability_scope: [...DEFAULT_CAPABILITIES]
    });
    await run([
        '--change-owner',
        ...authorizedMutationArgs,
        '--cashier-user-id', '51',
        '--integration-owner', '51',
        '--reason', 'test owner change'
    ], { env, dbPool: db });
    assert.equal([...db.registers.values()][0].metadata.integration_owner, 51);
    assert.equal([...db.bindings.values()].find(binding => Number(binding.user_id) === 50).capability_scope.includes('fiscal.shift.close'), false);
    assert.equal([...db.bindings.values()].find(binding => Number(binding.user_id) === 51).capability_scope.includes('fiscal.shift.close'), true);
    assert.ok(db.audits.length >= 4);
});

test('park pilot config rejects mutating commands without authenticated fiscal.configure actor and reason', async () => {
    assert.throws(
        () => parseArgs(['--apply', ...mutationArgs]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_actor_user_required'
    );
    assert.throws(
        () => parseArgs(['--apply', ...baseArgs, '--actor-user-id', '50']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_reason_required'
    );
    class InactiveActorDb extends FakePilotConfigDb {}
    class InactiveActorClient extends FakePilotConfigClient {
        async query(sql, params = []) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            if (normalized.startsWith('SELECT id, username, name, role') && normalized.includes('WHERE id = $1')) {
                return { rows: [{ id: params[0], username: 'inactive', role: 'creator', extra_roles: [], action_allowlist: [], action_denylist: [], is_active: false }] };
            }
            return super.query(sql, params);
        }
    }
    InactiveActorDb.prototype.connect = async function connect() { return new InactiveActorClient(this); };
    await assert.rejects(
        () => run(['--apply', ...authorizedMutationArgs], { env: { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' }, dbPool: new InactiveActorDb() }),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_actor_user_inactive'
    );
});

test('park pilot config rejects credential refs that collide to the same env prefix', () => {
    assert.throws(
        () => parseArgs([
            ...baseArgs.flatMap((arg, index, list) => {
                if (arg === '--cashier-login-ref') return ['--cashier-login-ref', 'park_middle'];
                return index > 0 && list[index - 1] === '--cashier-login-ref' ? [] : [arg];
            })
        ]),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_credential_ref_collision'
    );
});

test('park pilot config thin MVP bindings do not require action PIN', async () => {
    const hashes = await actionPinHashesByUser({}, ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open'], [50]);
    assert.equal(hashes.size, 0);
});

test('park pilot config uses runtime-compatible bcrypt action PIN hashes for future PRO bindings', async () => {
    const pin = String(crypto.randomInt(100000, 1000000));
    const wrongPin = pin === '999999' ? '100000' : String(Number(pin) + 1).padStart(6, '0');
    const hashes = await actionPinHashesByUser(
        { [ACTION_PIN_ENV]: pin },
        ['payments.view', 'fiscal.service_out.approve'],
        [50]
    );
    const hash = hashes.get(50);
    assert.match(hash, /^\$2[aby]\$/);
    assert.equal(await verifyActionPin(pin, hash), true);
    assert.equal(await verifyActionPin(wrongPin, hash), false);
});

test('park pilot config requires per-user distinct action PINs for future multi-user PRO bindings', async () => {
    const proCapabilities = ['payments.view', 'fiscal.service_out.approve'];
    const firstPin = String(crypto.randomInt(100000, 1000000));
    let secondPin = String(crypto.randomInt(100000, 1000000));
    while (secondPin === firstPin) secondPin = String(crypto.randomInt(100000, 1000000));
    await assert.rejects(
        () => actionPinHashesByUser(
            { [ACTION_PIN_ENV]: firstPin },
            proCapabilities,
            [50, 60]
        ),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_shared_action_pin_forbidden'
    );
    await assert.rejects(
        () => actionPinHashesByUser(
            {
                [actionPinEnvNameForUser(50)]: firstPin,
                [actionPinEnvNameForUser(60)]: firstPin
            },
            proCapabilities,
            [50, 60]
        ),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_shared_action_pin_forbidden'
    );
    const hashes = await actionPinHashesByUser(
        {
            [actionPinEnvNameForUser(50)]: firstPin,
            [actionPinEnvNameForUser(60)]: secondPin
        },
        proCapabilities,
        [50, 60]
    );
    assert.equal(hashes.size, 2);
    assert.equal(await verifyActionPin(firstPin, hashes.get(50)), true);
    assert.equal(await verifyActionPin(secondPin, hashes.get(60)), true);
    assert.notEqual(hashes.get(50), hashes.get(60));
});
