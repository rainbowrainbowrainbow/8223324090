const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
    generateOneTimePassword,
    verifyIssuedCredential
} = require('../services/accountLinking');

function credentialClient(row, onQuery = () => {}) {
    return {
        async query(sql, params) {
            onQuery(sql, params);
            return { rows: row ? [row] : [] };
        }
    };
}

describe('issued account credentials', () => {
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
