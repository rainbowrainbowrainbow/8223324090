const test = require('node:test');
const assert = require('node:assert/strict');

const {
    PilotConfigError,
    parseArgs,
    publicPlan,
    run
} = require('../scripts/configure-checkbox-park-pilot');

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
    '--integration-owner', 'eventgenix-checkbox',
    '--item', 'regular_child|Park child admission|7|1|0'
];

test('park pilot config CLI is dry-run by default and never enables register feature flag', () => {
    const plan = parseArgs(baseArgs);
    const output = publicPlan(plan);
    assert.equal(output.mode, 'dry-run');
    assert.equal(output.crmProfileKey, 'event_genix');
    assert.equal(output.registerAlias, 'middle');
    assert.equal(output.featureEnabled, false);
    assert.equal(output.itemMappings[0].providerTaxId, '7');
    assert.equal(output.actionPinRequired, false);
    assert.equal(output.providerCashierId, 'cashier-50');
    assert.equal(output.integrationOwner, 'eventgenix-checkbox');
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

test('park pilot config rejects preschool or non-middle activation', () => {
    assert.throws(
        () => parseArgs([...baseArgs, '--crm-profile', 'preschool']),
        error => error instanceof PilotConfigError
    );
});

test('park pilot config supports explicit preflight/status/enable/disable modes', () => {
    assert.equal(parseArgs(['preflight', ...baseArgs]).mode, 'preflight');
    assert.equal(parseArgs(['--enable-register', ...baseArgs]).mode, 'enable-register');
    assert.equal(parseArgs(['--disable-register', '--legal-entity-key', 'park_fop']).mode, 'disable-register');
    assert.equal(parseArgs(['status', '--legal-entity-key', 'park_fop']).mode, 'status');
});

class FakePilotConfigDb {
    constructor() {
        this.profiles = new Map();
        this.locations = new Map();
        this.registers = new Map();
        this.bindings = new Map();
        this.items = new Map();
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
        if (normalized.startsWith('SELECT id, username, name, role')) {
            return {
                rows: params[0].map(id => ({
                    id,
                    username: `user-${id}`,
                    name: `User ${id}`,
                    role: 'admin',
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
        if (normalized.startsWith('SELECT fim.item_code')) {
            return {
                rows: [...this.db.items.values()]
                    .filter(item => item.status === 'active')
                    .map(item => ({ item_code: item.item_code, count: 1 }))
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
                feature_enabled: false,
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
                status: 'active'
            });
            return { rows: [] };
        }
        throw new Error(`Unhandled fake query: ${normalized}`);
    }

    release() {}
}

test('park pilot config apply is explicit and idempotent', async () => {
    await assert.rejects(
        () => run(['--apply', ...baseArgs], { env: {}, dbPool: new FakePilotConfigDb() }),
        error => error.code === 'pilot_config_apply_not_allowed'
    );

    const db = new FakePilotConfigDb();
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    const first = await run(['--apply', ...baseArgs], { env, dbPool: db });
    const second = await run(['--apply', ...baseArgs], { env, dbPool: db });
    assert.equal(first.applied, true);
    assert.equal(second.applied, true);
    assert.equal(db.profiles.size, 1);
    assert.equal(db.locations.size, 1);
    assert.equal(db.registers.size, 1);
    assert.equal(db.bindings.size, 1);
    assert.equal(db.items.size, 1);
    assert.equal([...db.registers.values()][0].feature_enabled, false);
    assert.equal([...db.bindings.values()][0].crm_profile_key, 'event_genix');
    assert.equal([...db.bindings.values()][0].fiscal_location_id, 2);
    assert.equal([...db.bindings.values()][0].provider_cashier_id, 'cashier-50');
});
