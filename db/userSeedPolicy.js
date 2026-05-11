'use strict';

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isProductionLikeEnv(env = process.env) {
    return env.NODE_ENV === 'production'
        || Boolean(env.RAILWAY_ENVIRONMENT)
        || Boolean(env.RAILWAY_PROJECT_ID)
        || Boolean(env.RAILWAY_SERVICE_ID);
}

function isDevSeedAllowed(env = process.env) {
    return isTruthy(env.ALLOW_DEV_USER_SEED) && !isProductionLikeEnv(env);
}

function getDevSeedUser(env = process.env) {
    if (isTruthy(env.ALLOW_DEV_USER_SEED) && isProductionLikeEnv(env)) {
        return {
            enabled: false,
            error: 'ALLOW_DEV_USER_SEED is blocked in production-like environments'
        };
    }

    if (!isDevSeedAllowed(env)) {
        return { enabled: false };
    }

    const password = env.DEV_SEED_ADMIN_PASSWORD || '';
    if (password.length < 8) {
        return {
            enabled: false,
            error: 'ALLOW_DEV_USER_SEED requires DEV_SEED_ADMIN_PASSWORD with at least 8 characters'
        };
    }

    return {
        enabled: true,
        username: env.DEV_SEED_ADMIN_USERNAME || 'admin',
        password,
        role: env.DEV_SEED_ADMIN_ROLE || 'creator',
        name: env.DEV_SEED_ADMIN_NAME || 'Local Admin'
    };
}

function getBootstrapCreator(env = process.env) {
    const username = (env.BOOTSTRAP_CREATOR_USERNAME || '').trim();
    const password = env.BOOTSTRAP_CREATOR_PASSWORD || '';
    const name = (env.BOOTSTRAP_CREATOR_NAME || username || 'Bootstrap Creator').trim();

    if (!username && !password) {
        return { enabled: false };
    }

    if (!username || !password) {
        return {
            enabled: false,
            error: 'BOOTSTRAP_CREATOR_USERNAME and BOOTSTRAP_CREATOR_PASSWORD must be set together'
        };
    }

    const minLength = isProductionLikeEnv(env) ? 12 : 8;
    if (password.length < minLength) {
        return {
            enabled: false,
            error: `BOOTSTRAP_CREATOR_PASSWORD must be at least ${minLength} characters`
        };
    }

    return {
        enabled: true,
        username,
        password,
        role: 'creator',
        name
    };
}

function legacyPasswordResetAllowed(env = process.env) {
    return isTruthy(env.ALLOW_LEGACY_USER_PASSWORD_RESET) && !isProductionLikeEnv(env);
}

function openclawBootstrapUser(env = process.env) {
    const password = env.OPENCLAW_BOOTSTRAP_PASSWORD || '';
    if (!password) {
        return { enabled: false };
    }

    const minLength = isProductionLikeEnv(env) ? 12 : 8;
    if (password.length < minLength) {
        return {
            enabled: false,
            error: `OPENCLAW_BOOTSTRAP_PASSWORD must be at least ${minLength} characters`
        };
    }

    return {
        enabled: true,
        username: 'openclaw',
        password,
        role: 'user',
        name: 'OpenClaw'
    };
}

module.exports = {
    isProductionLikeEnv,
    isDevSeedAllowed,
    getDevSeedUser,
    getBootstrapCreator,
    legacyPasswordResetAllowed,
    openclawBootstrapUser
};
