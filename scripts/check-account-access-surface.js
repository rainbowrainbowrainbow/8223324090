#!/usr/bin/env node
/**
 * Static guard for account-management authorization surfaces.
 *
 * This intentionally focuses on routes that mutate CRM account links or
 * account credentials outside the canonical /api/users Account Center.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function fail(message) {
    failures.push(message);
}

function expect(file, pattern, message) {
    const source = read(file);
    if (!pattern.test(source)) fail(`${file}: ${message}`);
}

function expectNot(file, pattern, message) {
    const source = read(file);
    if (pattern.test(source)) fail(`${file}: ${message}`);
}

function listJsFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listJsFiles(fullPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
    });
}

function repoPath(fullPath) {
    return path.relative(ROOT, fullPath).replace(/\\/g, '/');
}

function expectOnlyAccountLinkingImporters() {
    const allowed = new Set(['routes/users.js', 'routes/staff.js', 'routes/employees.js']);
    for (const fullPath of listJsFiles(path.join(ROOT, 'routes'))) {
        const file = repoPath(fullPath);
        const source = fs.readFileSync(fullPath, 'utf8');
        if (/services\/accountLinking|services\\accountLinking|\.\.\/services\/accountLinking/.test(source) && !allowed.has(file)) {
            fail(`${file}: accountLinking service import must be added to the account access guardrail before use`);
        }
    }
}

expectOnlyAccountLinkingImporters();

expect(
    'routes/users.js',
    /router\.use\(authenticateToken\)[\s\S]*router\.get\('\/', requireAction\('manage_accounts'\)/,
    'canonical account list must remain behind authenticateToken + manage_accounts'
);
expect(
    'routes/users.js',
    /router\.post\('\/', requireAction\('manage_accounts'\)/,
    'canonical account creation must remain behind manage_accounts'
);
expect(
    'routes/users.js',
    /function actorCanManageRoleSet[\s\S]*ACCOUNT_MANAGER_ROLES\.includes\(actor\.role\)/,
    'canonical account role ceiling must use primary account-manager roles'
);

expect(
    'routes/staff.js',
    /router\.post\('\/:id\/link', requireAction\('manage_accounts'\)/,
    'staff account link endpoint must use manage_accounts'
);
expect(
    'routes/staff.js',
    /router\.post\('\/:id\/unlink', requireAction\('manage_accounts'\)/,
    'staff account unlink endpoint must use manage_accounts'
);
expect(
    'routes/staff.js',
    /router\.post\('\/bulk-create-accounts', requireAction\('manage_accounts'\)/,
    'staff bulk account creation must use manage_accounts'
);
expect(
    'routes/staff.js',
    /function canActorManageAccountRoleSet[\s\S]*ACCOUNT_MANAGER_PRIMARY_ROLES\.has\(actor\.role\)/,
    'staff bulk account creation must enforce primary-role account ceilings'
);
expect(
    'routes/staff.js',
    /function getLinkedAccountsForStaffManagement[\s\S]*FOR UPDATE OF ep, u/,
    'staff unlink must lock and inspect all linked accounts before unlinking'
);
expectNot(
    'routes/staff.js',
    /router\.post\('\/(?:\:id\/(?:link|unlink)|bulk-create-accounts|bulk-pdf)', requireRole\(/,
    'staff account bridge endpoints must not fall back to requireRole'
);

expect(
    'routes/employees.js',
    /canUseAction\(actor, 'manage_accounts'\)/,
    'employee profile account-link mutations must check manage_accounts'
);
expect(
    'routes/employees.js',
    /await ensureActorCanManageAccountId\(client, req\.user, user_id\)/,
    'employee profile create/update must inspect target user_id before linking'
);
expect(
    'routes/employees.js',
    /await ensureActorCanManageAccountId\(client, req\.user, current\.rows\[0\]\.user_id\)/,
    'employee profile unlink must inspect the currently linked account before unlinking'
);
expect(
    'routes/employees.js',
    /router\.post\('\/auto-link', requireAction\('manage_accounts'\)/,
    'employee auto-link must use manage_accounts'
);

expect(
    'routes/hr.js',
    /canUseAction\(actor, 'manage_accounts'\)/,
    'HR offboarding account disable path must require manage_accounts capability'
);
expect(
    'routes/hr.js',
    /function accountOffboardingBlockReason[\s\S]*requires_manage_accounts/,
    'HR offboarding readiness must expose manage_accounts blockers'
);
expect(
    'routes/hr.js',
    /function staffOffboardingDisableError[\s\S]*requires_manage_accounts/,
    'HR offboarding disable errors must distinguish manage_accounts failures'
);
expect(
    'routes/hr.js',
    /disable_requires_manage_accounts: accounts\.length > 0/,
    'HR offboarding readiness must identify account-disable permission requirements'
);
expect(
    'routes/hr.js',
    /accountAction === 'disable' && !readiness\.disable_available[\s\S]*res\.status\(403\)/,
    'HR offboarding must return a forbidden response before disabling accounts without manage_accounts'
);
expect(
    'routes/hr.js',
    /function accountRehireBlockReason[\s\S]*requires_manage_accounts/,
    'HR rehire readiness must expose manage_accounts blockers before account activation'
);
expect(
    'routes/hr.js',
    /actorCanReactivateStaffAccount\(req\.user, account\)/,
    'HR rehire account activation must filter linked accounts through account-management policy'
);
expect(
    'routes/hr.js',
    /account_reactivation_blocked: accountReactivationBlockers\.length > 0/,
    'HR rehire response must surface skipped account reactivation'
);

expect(
    'routes/telegram.js',
    /UPDATE users SET telegram_chat_id = \$1 WHERE telegram_username = \$2 AND telegram_chat_id IS NULL/,
    'Telegram webhook auto-bind must not overwrite an existing user telegram_chat_id'
);
expect(
    'services/bot.js',
    /UPDATE users SET telegram_chat_id = \$1 WHERE telegram_username = \$2 AND telegram_chat_id IS NULL/,
    'Telegram bot /start auto-bind must not overwrite an existing user telegram_chat_id'
);
expect(
    'services/kleshnya.js',
    /UPDATE users SET telegram_chat_id = \$1 WHERE username = \$2 AND telegram_chat_id IS NULL/,
    'Kleshnya Telegram helper must not overwrite an existing user telegram_chat_id'
);
expect(
    'routes/personal-accounts.js',
    /function getUserTgId\(req\)[\s\S]*req\.user\?\.telegram_chat_id[\s\S]*req\.user\?\.telegramChatId/,
    'personal account JWT access must read Telegram ownership from authenticated user payload'
);
expect(
    'routes/personal-accounts.js',
    /router\.get\('\/my', optionalJwt[\s\S]*if \(isBotAuth\(req\)\)[\s\S]*req\.query\.telegram_id[\s\S]*else if \(req\.user\)[\s\S]*tgId = getUserTgId\(req\)/,
    'personal account JWT /my lookup must not trust query telegram_id'
);
expect(
    'routes/personal-accounts.js',
    /async function verifyOwnership[\s\S]*const userTgId = getUserTgId\(req\)/,
    'personal account grant/revoke ownership must use authenticated Telegram id'
);
expect(
    'routes/personal-accounts.js',
    /async function verifyAccess[\s\S]*const userTgId = getUserTgId\(req\)/,
    'personal account transaction access must use authenticated Telegram id'
);
expect(
    'middleware/auth.js',
    /telegram_chat_id: user\.telegram_chat_id \|\| user\.telegramChatId \|\| null[\s\S]*telegramChatId: user\.telegram_chat_id \|\| user\.telegramChatId \|\| null/,
    'auth payload must preserve telegram_chat_id for owner-scoped personal account checks'
);
expect(
    'middleware/auth.js',
    /default_business_context, name, telegram_chat_id, is_active/,
    'token rehydration must refresh telegram_chat_id from current users row'
);
expect(
    'routes/auth.js',
    /u\.name, u\.telegram_chat_id, u\.is_active/,
    'login token payload must include telegram_chat_id'
);

if (failures.length) {
    console.error('Account access surface check failed:');
    failures.forEach(item => console.error(`- ${item}`));
    process.exit(1);
}

console.log('Account access surface check passed: canonical account, staff bridge, employee link, HR offboarding, HR rehire, Telegram binding, and personal account guards are enforced.');
