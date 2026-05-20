const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isProductionLikeEnv,
    getDevSeedUser,
    getBootstrapCreator,
    legacyPasswordResetAllowed,
    openclawBootstrapUser
} = require('../db/userSeedPolicy');
const {
    LOGIN_IDENTITY_WHERE_SQL,
    normalizeLoginAliases,
    normalizeLoginIdentifier
} = require('../services/authIdentity');

describe('user seed policy', () => {
    it('treats Railway and NODE_ENV production as production-like', () => {
        assert.equal(isProductionLikeEnv({ NODE_ENV: 'production' }), true);
        assert.equal(isProductionLikeEnv({ RAILWAY_ENVIRONMENT: 'production' }), true);
        assert.equal(isProductionLikeEnv({ RAILWAY_PROJECT_ID: 'project-id' }), true);
        assert.equal(isProductionLikeEnv({ NODE_ENV: 'development' }), false);
    });

    it('blocks dev default seeding in production-like environments', () => {
        const devSeed = getDevSeedUser({
            NODE_ENV: 'production',
            ALLOW_DEV_USER_SEED: 'true',
            DEV_SEED_ADMIN_PASSWORD: 'private-local-password'
        });
        assert.equal(devSeed.enabled, false);
        assert.match(devSeed.error, /blocked/);
    });

    it('requires an explicit private local password for dev seeding', () => {
        const missingPassword = getDevSeedUser({
            NODE_ENV: 'development',
            ALLOW_DEV_USER_SEED: 'true'
        });
        assert.equal(missingPassword.enabled, false);
        assert.match(missingPassword.error, /DEV_SEED_ADMIN_PASSWORD/);

        const seededUser = getDevSeedUser({
            NODE_ENV: 'development',
            ALLOW_DEV_USER_SEED: 'true',
            DEV_SEED_ADMIN_PASSWORD: 'private-local-password'
        });
        assert.equal(seededUser.enabled, true);
        assert.equal(seededUser.username, 'admin');
        assert.equal(seededUser.password, 'private-local-password');
        assert.equal(seededUser.role, 'creator');
    });

    it('requires explicit bootstrap username and password together', () => {
        const partial = getBootstrapCreator({ BOOTSTRAP_CREATOR_USERNAME: 'owner' });
        assert.equal(partial.enabled, false);
        assert.match(partial.error, /must be set together/);

        const bootstrap = getBootstrapCreator({
            NODE_ENV: 'production',
            BOOTSTRAP_CREATOR_USERNAME: 'owner',
            BOOTSTRAP_CREATOR_PASSWORD: 'long-private-password',
            BOOTSTRAP_CREATOR_NAME: 'Owner'
        });
        assert.equal(bootstrap.enabled, true);
        assert.equal(bootstrap.username, 'owner');
        assert.equal(bootstrap.role, 'creator');
        assert.equal(bootstrap.name, 'Owner');
    });

    it('blocks legacy password reset flags in production-like environments', () => {
        assert.equal(legacyPasswordResetAllowed({
            NODE_ENV: 'development',
            ALLOW_LEGACY_USER_PASSWORD_RESET: 'true'
        }), true);
        assert.equal(legacyPasswordResetAllowed({
            NODE_ENV: 'production',
            ALLOW_LEGACY_USER_PASSWORD_RESET: 'true'
        }), false);
    });

    it('requires explicit OpenClaw password instead of a repository default', () => {
        assert.equal(openclawBootstrapUser({}).enabled, false);

        const shortPassword = openclawBootstrapUser({
            NODE_ENV: 'production',
            OPENCLAW_BOOTSTRAP_PASSWORD: 'short'
        });
        assert.equal(shortPassword.enabled, false);
        assert.match(shortPassword.error, /at least 12/);

        const user = openclawBootstrapUser({
            NODE_ENV: 'production',
            OPENCLAW_BOOTSTRAP_PASSWORD: 'long-private-password'
        });
        assert.equal(user.enabled, true);
        assert.equal(user.username, 'openclaw');
        assert.equal(user.password, 'long-private-password');
    });

    it('supports explicit login aliases without changing password truth', () => {
        assert.equal(normalizeLoginIdentifier('  Zhenia  '), 'zhenia');
        assert.deepEqual(normalizeLoginAliases(['Zhenia', ' zhenia ', 'Женя', '']), ['Zhenia', 'Женя']);
        assert.match(LOGIN_IDENTITY_WHERE_SQL, /u\.username/);
        assert.match(LOGIN_IDENTITY_WHERE_SQL, /u\.login_aliases/);
        assert.match(LOGIN_IDENTITY_WHERE_SQL, /unnest/);
    });
});
