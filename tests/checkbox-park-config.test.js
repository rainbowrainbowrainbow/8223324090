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
    '--provider-organization-id', 'org-1',
    '--location-name', 'Park',
    '--provider-outlet-id', 'outlet-1',
    '--register-name', 'Middle register',
    '--provider-register-id', 'register-1',
    '--provider-license-ref', 'park-middle',
    '--cashier-user-id', '50',
    '--cashier-login-ref', 'park-middle',
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
});

test('park pilot config rejects raw secret-like CLI arguments', () => {
    assert.throws(
        () => parseArgs([...baseArgs, '--password', 'plain']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_arg_forbidden'
    );
    assert.throws(
        () => parseArgs([...baseArgs, '--pin', '1234']),
        error => error instanceof PilotConfigError && error.code === 'pilot_config_secret_arg_forbidden'
    );
});

test('park pilot config rejects preschool or non-middle activation', () => {
    assert.throws(
        () => parseArgs([...baseArgs, '--crm-profile', 'preschool']),
        error => error instanceof PilotConfigError
    );
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
        if (normalized.startsWith('INSERT INTO fiscal_profiles')) {
            const key = `${params[0]}:${params[1]}`;
            const row = this.db.profiles.get(key) || { id: this.db.next++ };
            Object.assign(row, {
                crm_profile_key: params[0],
                legal_entity_key: params[1],
                legal_entity_name: params[2],
                tax_identifier: params[3],
                provider_organization_id: params[4],
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
                provider_register_id: params[5],
                provider_license_ref: params[6],
                status: 'active',
                feature_enabled: false
            });
            this.db.registers.set(key, row);
            return { rows: [row] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_cashier_bindings')) {
            this.db.bindings.set(`${params[0]}:${params[1]}:${params[3]}`, {
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                fiscal_location_id: params[2],
                user_id: params[3],
                provider_cashier_login_ref: params[4],
                capability_scope: params[5],
                status: 'active'
            });
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_item_mappings')) {
            this.db.items.set(`${params[0]}:${params[1]}:${params[3]}`, {
                fiscal_profile_id: params[0],
                fiscal_register_id: params[1],
                crm_profile_key: params[2],
                item_code: params[3],
                fiscal_item_name: params[4],
                provider_tax_id: params[5],
                tax_code: params[6],
                tax_rate_bps: params[7],
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
});
