const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('operations flow v2 comprehensive contracts', () => {
    const migration = readRepoFile('db', 'migrations', '178_operations_flow_v2_comprehensive.sql');
    const tasksRoute = readRepoFile('routes', 'tasks.js');
    const chatRoute = readRepoFile('routes', 'chat.js');
    const kleshnyaService = readRepoFile('services', 'kleshnya.js');
    const leadsRoute = readRepoFile('routes', 'leads.js');
    const customersRoute = readRepoFile('routes', 'customers.js');
    const analyticsRoute = readRepoFile('routes', 'analytics.js');
    const leadsPage = readRepoFile('js', 'leads-page.js');
    const leadsHtml = readRepoFile('leads.html');
    const customersPage = readRepoFile('js', 'customers-page.js');
    const customersHtml = readRepoFile('customers.html');

    it('adds only additive legacy-safe schema for identity and celebrant context', () => {
        assert.match(migration, /MIGRATION_KIND:\s*schema/);
        assert.match(migration, /SAFETY:/);
        assert.match(migration, /ROLLBACK:/);
        assert.match(migration, /ALTER TABLE customers[\s\S]*ADD COLUMN IF NOT EXISTS social_identities JSONB/);
        assert.match(migration, /customers_social_identities_array_check/);
        assert.match(migration, /ALTER TABLE leads[\s\S]*ADD COLUMN IF NOT EXISTS celebrants JSONB/);
        assert.match(migration, /leads_celebrants_array_check/);
        assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
    });

    it('keeps canonical task ownership and suppresses no-op bulk assignment notifications', () => {
        assert.match(tasksRoute, /canonicalOwnerField: 'tasks\.owner_user_id'/);
        assert.match(tasksRoute, /supportedChatSources: \['chat_message', 'chat_channel', 'chat_command'\]/);
        assert.match(tasksRoute, /notificationTrigger: 'services\/kleshnya\.notifyTaskAssigned'/);
        assert.match(tasksRoute, /IS DISTINCT FROM/);
        assert.match(tasksRoute, /COALESCE\(t\.assigned_to, ''\) IS DISTINCT FROM COALESCE/);
        assert.doesNotMatch(tasksRoute, /TaskEngineV2|taskRoutingV2|autoRouteChatTask/i);
    });

    it('keeps task create sources typed-owner aware instead of silently creating invisible legacy tasks', () => {
        assert.match(kleshnyaService, /async function resolveTaskOwnerSnapshot/);
        assert.match(kleshnyaService, /owner_user_id: ownerSnapshot\.owner_user_id/);
        assert.match(kleshnyaService, /ownerSnapshot\.assigned_to, ownerSnapshot\.owner/);
        assert.match(chatRoute, /owner_user_id/);
        assert.match(chatRoute, /created_by_user_id/);
        assert.match(chatRoute, /'personal', 'reminder', 'private', 'inbox'/);
        assert.match(tasksRoute, /task: normalizeTaskPayload\((?:task|responseTask)\)/);
        assert.match(tasksRoute, /const ownerUserId = parseInt\(task\.owner_user_id/);
        assert.match(tasksRoute, /const FILTERABLE_STATUSES = \[\.\.\.VALID_STATUSES, 'archived', 'cancelled', 'overdue'\]/);
    });

    it('stores multi-celebrant lead data without breaking legacy single-child rows', () => {
        assert.match(leadsRoute, /function normalizeCelebrants/);
        assert.match(leadsRoute, /source: 'legacy_single_child'/);
        assert.match(leadsRoute, /INSERT INTO leads[\s\S]*celebrants\)/);
        assert.match(leadsRoute, /celebrants = \$\$\{params\.length\}::jsonb/);
        assert.match(leadsPage, /function parseCelebrantsInput/);
        assert.match(leadsPage, /function renderCelebrantsValue/);
        assert.match(leadsPage, /leadCelebrants/);
        assert.match(leadsHtml, /id="leadCelebrants"/);
        assert.match(leadsHtml, /id="ccCelebrants"/);
    });

    it('keeps lead/customer linking explicit while preserving cross-channel identity evidence', () => {
        assert.match(leadsRoute, /mergePolicy: 'suggest_only'/);
        assert.match(leadsRoute, /function leadSocialIdentities/);
        assert.match(leadsRoute, /function mergeLeadSocialIdentities/);
        assert.match(leadsRoute, /function buildLeadCustomerNotes/);
        assert.match(leadsRoute, /function appendUniqueLeadCustomerNote/);
        assert.match(leadsRoute, /notes = \$6,[\s\S]*social_identities = \$7::jsonb/);
        assert.match(leadsRoute, /INSERT INTO customers[\s\S]*social_identities/);
        assert.doesNotMatch(leadsRoute, /autoMerge|mergeAutomatically|blindMerge/i);
    });

    it('makes customer social identities durable and searchable without replacing explicit merge', () => {
        assert.match(customersRoute, /function normalizeSocialIdentities/);
        assert.match(customersRoute, /socialIdentities: normalizeSocialIdentities/);
        assert.match(customersRoute, /INSERT INTO customers[\s\S]*social_identities/);
        assert.match(customersRoute, /UPDATE customers SET[\s\S]*social_identities=\$8::jsonb/);
        assert.match(customersRoute, /social_identities::text ILIKE/);
        assert.match(customersRoute, /function canSearchCustomerSocialIdentities/);
        assert.match(customersRoute, /function isMissingCustomerSocialIdentitiesColumnError/);
        assert.match(customersRoute, /function isCustomerSocialIdentitiesStorageError/);
        assert.match(customersRoute, /jsonb\|json\|type\|cast/);
        assert.match(customersRoute, /function ensureCustomerSocialIdentitiesColumn/);
        assert.match(customersRoute, /function omitCustomerSocialIdentities/);
        assert.match(customersRoute, /retrying legacy customer insert/);
        assert.match(customersRoute, /retrying legacy customer update/);
        assert.match(customersRoute, /function isCustomerDuplicateError/);
        assert.match(customersRoute, /status\(409\)/);
        assert.match(customersRoute, /customer_duplicate/);
        assert.match(customersRoute, /Соц\. ідентичності/);
        assert.match(customersPage, /function parseSocialIdentitiesInput/);
        assert.match(customersPage, /renderSocialIdentities/);
        assert.match(customersHtml, /id="editSocialIdentities"/);
        assert.match(customersRoute, /router\.post\('\/:primaryId\/merge'/);
    });

    it('keeps reporting semantics explicit and duplicate-safe for accepted-vs-closed deals', () => {
        assert.match(analyticsRoute, /COUNT\(DISTINCT l\.id\) FILTER \(WHERE \$\{acceptedPredicate\}\)/);
        assert.match(analyticsRoute, /COUNT\(DISTINCT lead_days\.id\) FILTER/);
        assert.match(analyticsRoute, /reportability: 'snapshot-only'/);
        assert.match(analyticsRoute, /duplicateProtection: 'COUNT\(DISTINCT leads\.id\)'/);
        assert.match(analyticsRoute, /stageTimestampTruth: 'missing'/);
    });

    it('keeps lead workspace booking-derived customer aggregates scoped to canonical booking visibility', () => {
        assert.match(leadsRoute, /const customerBookingScope = getVisibleBookingScope\(req\.user, customerLookupParams, 'b'\)/);
        assert.match(leadsRoute, /FROM bookings b[\s\S]*\$\{customerBookingScope\.sql\}/);
        assert.match(leadsRoute, /socialIdentities: parseJsonArray\(row\.social_identities\)/);
    });
});
