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
    const leadsCss = readRepoFile('css', 'pages-leads.css');
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
        assert.match(leadsRoute, /LEAD_WORKSPACE_CONTRACT/);
        assert.match(leadsRoute, /sourceOrder: Object\.freeze\(\[\s*'customer\.children',\s*'lead\.celebrants',\s*'customer\.childName'/);
        assert.match(leadsRoute, /mergePolicy: 'render_as_separate_sections'/);
        assert.match(leadsRoute, /function loadWorkspaceCustomerChildren/);
        assert.match(leadsRoute, /FROM customer_children[\s\S]*WHERE customer_id = \$1[\s\S]*AND business_context = \$2/);
        assert.match(leadsRoute, /function applyWorkspaceCustomerChildren/);
        assert.match(leadsRoute, /customerChildrenNameDisplay\(children\)/);
        assert.match(leadsRoute, /customerChildrenBirthdayDisplay\(children\)/);
        assert.match(leadsPage, /function parseCelebrantsInput/);
        assert.match(leadsPage, /function renderCelebrantsEditor/);
        assert.match(leadsPage, /function getCelebrantsPayload/);
        assert.match(leadsPage, /function isCelebrantsEditorDirty/);
        assert.match(leadsPage, /function renderCelebrantsValue/);
        assert.match(leadsPage, /function renderWorkspaceCustomerChildren/);
        assert.match(leadsPage, /function workspaceCustomerChildRows/);
        assert.match(leadsPage, /source: 'customer\.children'/);
        assert.match(leadsPage, /source: 'lead\.celebrants'/);
        assert.match(leadsPage, /source: 'customer\.childName'/);
        assert.ok(
            leadsPage.indexOf("source: 'customer.children'") < leadsPage.indexOf("source: 'customer.childName'"),
            'lead workspace must prefer canonical customer.children before legacy customer.childName'
        );
        assert.doesNotMatch(leadsPage, /<dt>Дитина<\/dt><dd>\$\{workspaceText\(customer\.childName\)\}<\/dd>/);
        assert.match(leadsPage, /const birthday = child\.birthday \? workspaceDate\(child\.birthday\) :/);
        assert.match(leadsPage, /const note = child\.note \|\|/);
        assert.match(leadsPage, /workspace-child-note/);
        assert.match(leadsPage, /workspace-row workspace-child-row/);
        assert.match(leadsPage, /Діти \/ іменинники/);
        assert.match(leadsPage, /function workspaceStripLeadAutoNoteBlock/);
        assert.match(leadsPage, /function workspaceCustomerVisibleNotes/);
        assert.match(leadsPage, /function workspaceNoteRows/);
        assert.match(leadsPage, /function renderWorkspaceInteractionRow/);
        assert.match(leadsPage, /Нотатки клієнта/);
        assert.match(leadsPage, /data-note-source=/);
        assert.match(leadsPage, /function leadWorkspaceChildSourceOrder/);
        assert.match(leadsPage, /function leadWorkspaceNotesContract/);
        assert.match(leadsPage, /data-child-source-order/);
        assert.match(leadsPage, /data-notes-merge-policy/);
        assert.match(leadsCss, /\.workspace-child-list/);
        assert.match(leadsHtml, /body\.dark-mode \.workspace-row/);
        assert.match(leadsCss, /\.workspace-note-text[\s\S]*white-space: pre-wrap/);
        assert.match(leadsCss, /\.workspace-note-row/);
        assert.match(leadsPage, /leadCelebrants/);
        assert.match(leadsHtml, /id="leadCelebrants" hidden/);
        assert.match(leadsHtml, /id="ccCelebrants" hidden/);
        assert.match(leadsHtml, /id="leadCelebrantsRows"/);
        assert.match(leadsHtml, /id="ccCelebrantsRows"/);
        assert.doesNotMatch(leadsHtml, /<textarea[^>]*id="leadCelebrants"[^>]*placeholder=/);
        assert.doesNotMatch(leadsHtml, /<textarea[^>]*id="ccCelebrants"[^>]*placeholder=/);
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
