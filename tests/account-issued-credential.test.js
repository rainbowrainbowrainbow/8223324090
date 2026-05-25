const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
    generateOneTimePassword,
    verifyIssuedCredential
} = require('../services/accountLinking');
const {
    extractCredentialBlock,
    normalizeCredentialPassword,
    normalizeLoginCredentialPayload,
    uniquePasswordCandidates
} = require('../services/credentialInput');

function credentialClient(row, onQuery = () => {}) {
    return {
        async query(sql, params) {
            onQuery(sql, params);
            return { rows: row ? [row] : [] };
        }
    };
}

describe('issued account credentials', () => {
    it('parses copied login/password blocks for login payloads', () => {
        const block = 'Логін: Zhenya\nПароль: SafePass234';
        const extracted = extractCredentialBlock(block);
        assert.deepEqual(extracted, {
            username: 'Zhenya',
            password: 'SafePass234',
            hasCredentialBlock: true
        });

        const payload = normalizeLoginCredentialPayload({ username: block, password: '' });
        assert.equal(payload.username, 'Zhenya');
        assert.equal(payload.password, 'SafePass234');
        assert.equal(payload.parsedCredentialBlock, true);
        assert.ok(payload.passwordCandidates.includes('SafePass234'));
    });

    it('normalizes manual password copy-paste wrappers and invisible characters', () => {
        assert.equal(normalizeCredentialPassword(' Пароль: SafePass234 \n'), 'SafePass234');
        assert.equal(normalizeCredentialPassword('\u200BSafePass234\uFEFF'), 'SafePass234');
        const candidates = uniquePasswordCandidates(' SafePass234 ', 'Пароль: SafePass234');
        assert.equal(candidates[0], 'SafePass234');
        assert.ok(candidates.includes('Пароль: SafePass234'));
    });

    it('generates one-time passwords without visually ambiguous characters', () => {
        for (let i = 0; i < 250; i += 1) {
            const password = generateOneTimePassword(32);
            assert.equal(password.length, 32);
            assert.doesNotMatch(password, /[ILO0l1]/, `ambiguous character in ${password}`);
        }
    });

    it('verifies issued credentials through the same login identity contract', async () => {
        const password = 'SafePass234';
        const hash = await bcrypt.hash(password, 4);
        let normalizedLogin = '';
        const result = await verifyIssuedCredential({
            client: credentialClient({
                id: 15,
                username: 'Zhenya',
                password_hash: hash,
                is_active: true
            }, (sql, params) => {
                assert.match(sql, /FROM users u/);
                assert.match(sql, /u\.login_aliases/);
                assert.match(sql, /ORDER BY CASE WHEN LOWER\(u\.username\) = \$1 THEN 0 ELSE 1 END/);
                normalizedLogin = params[0];
            }),
            username: '  Zhenya  ',
            password
        });

        assert.equal(normalizedLogin, 'zhenya');
        assert.equal(result.loginReady, true);
        assert.equal(result.reason, 'ready');
        assert.equal(result.username, 'Zhenya');
        assert.equal(result.isActive, true);
    });

    it('verifies issued credentials when the password is pasted as a labeled block', async () => {
        const password = 'SafePass234';
        const hash = await bcrypt.hash(password, 4);
        const result = await verifyIssuedCredential({
            client: credentialClient({
                id: 15,
                username: 'Zhenya',
                password_hash: hash,
                is_active: true
            }),
            username: 'Zhenya',
            password: 'Пароль: SafePass234'
        });

        assert.equal(result.loginReady, true);
        assert.equal(result.reason, 'ready');
    });

    it('fails closed for wrong, inactive, missing, or empty issued credentials', async () => {
        const hash = await bcrypt.hash('SafePass234', 4);

        const wrongPassword = await verifyIssuedCredential({
            client: credentialClient({ username: 'Zhenya', password_hash: hash, is_active: true }),
            username: 'Zhenya',
            password: 'WrongPass234'
        });
        assert.equal(wrongPassword.loginReady, false);
        assert.equal(wrongPassword.reason, 'password_mismatch');

        const inactive = await verifyIssuedCredential({
            client: credentialClient({ username: 'Zhenya', password_hash: hash, is_active: false }),
            username: 'Zhenya',
            password: 'SafePass234'
        });
        assert.equal(inactive.loginReady, false);
        assert.equal(inactive.reason, 'inactive_account');

        const missing = await verifyIssuedCredential({
            client: credentialClient(null),
            username: 'Zhenya',
            password: 'SafePass234'
        });
        assert.equal(missing.loginReady, false);
        assert.equal(missing.reason, 'user_not_found');

        const empty = await verifyIssuedCredential({
            client: credentialClient(null),
            username: '',
            password: ''
        });
        assert.equal(empty.loginReady, false);
        assert.equal(empty.reason, 'missing_login_or_password');
    });
});
