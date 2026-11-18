# Park Training namespace

Owner policy recorded 2026-11-18: courses 1–31 and their existing learning data
belong exclusively to Park. Other businesses remain unavailable. Park already
configures the Training module; no production flag or ownership backfill is
needed for this exclusive namespace. A future additional owner requires a new
migration and explicit policy, not a module toggle.

Every Training HTTP route now requires a server-resolved active Park membership,
configured module and effective page permission. Aggregate/foreign contexts fail
closed. Management uses `training.manage`, including explicit denials, instead
of role rank or an unrelated accountant read exception.

Knowledge reads, quiz attempts, badges and progress use the unique active
employee-profile/staff bridge. Writes fail with a specific 409 when the bridge
is missing or inactive. No account-ID fallback or historical remapping occurs.
The course path retains its canonical checklist/enrollment semantics; ordinary
learners do not receive checklist staff notes or completion-author fields.

Homework retains its historical account-ID API/storage contract (despite legacy
column names). Non-managers see only assigned/public assignments and their own
submissions. Recipient lists and review counts are omitted from their DTOs.
Submissions atomically require an active assigned/public parent. Assignment
creation and review validate targets against fresh Park module/page eligibility.
Weekly input cannot impersonate another staff member without management access,
and obtains the Telegram identity from the staff record rather than the body.

Telegram prompts/responses require an active staff bridge and current Park
module/page eligibility. Private weekly summaries also require the recipient's
current management capability before selecting inputs. Existing delivery
configuration is unchanged; tests use synthetic mocked delivery only.

## Proof

- Node 22.23.4/npm 10.9.9 focused tests: 28/28, no skips, including all 26 roles,
  invalid/duplicate membership identities, explicit denials, target freshness,
  canonical course behavior and notification revocation.
- Fully migrated disposable PostgreSQL with the actual running application,
  real login and HTTP requests: 4/4, no skips,
  `output/park-training-actual-api-final.log`. Staff/account IDs intentionally differ;
  database assertions prove the correct progress/attempt owner. Foreign/aggregate
  scopes, revoked membership, disabled module, page/action denials, private
  homework and other people's answers are rejected. Initial fixture used an
  incorrect profile column; corrected to the canonical schema before passing.
- Full npm test on0.84.4 passed, exit0 (output/park-training-npm-test.log), including unit4036/4036, MyDay338/338, automation54/54 and all repository/post-verify checks. The additional final focused28/28 and authenticated API4/4 reruns passed.
- No production data, credentials, sessions or external messages were changed.
  Full-candidate browser/readiness, exact-SHA CI and authorized live QA remain
  separate release gates. Chat remains disabled until its file/recipient/socket
  perimeter is complete.
