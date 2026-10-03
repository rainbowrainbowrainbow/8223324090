# Customer Birthday Segments

Production impact: yes, after release. No schema changes or historical tag backfill are part of this change.

- `services/customerBirthdaySegments.js` owns the birthday taxonomy, SQL source, tag filter, and current tag projection.
- List, dropdown/tag selections, full-segment counts, and read-only preview select explicit birthdays of all current children in the customer's business context.
- Both `manual_review.superseded = true` and `manual_review.status = superseded` exclude a replaced record. The existing camel-case payload variant is also recognized.
- A legacy customer birthday is eligible only when no canonical child records exist in that business. Canonical records with cleared dates or only replaced records suppress legacy fallback.
- One customer record represents one family for these counts. Multiple children never duplicate the customer; each matching child contributes to the separate child count. Existing duplicate customers are not silently merged.
- February 29 belongs to February in a month segment. This does not decide an annual reminder date in a non-leap year.
- Stored birthday tags are not membership evidence. Current system tags and catalog counts are derived at read time; reads do not rewrite historical tags.
- Reserved birthday labels and their `birthday_month_MM` keys resolve to the same filter. Other tags retain existing matching behavior. Mixed API tag selections retain OR semantics; matching children are the union of selected birthday months.
- Manual tags, including a collision with a reserved birthday label, remain stored with their original metadata. The reserved label still selects the birthday segment.
- Single-family saves synchronize all distinct current month tags in the existing save transaction and preserve manual tags. The generic birthday tag appears once.
- Birthday preview substitutes only matching children's names/dates. An unnamed matching child produces a neutral greeting rather than another child's name. A family admitted through another tag with no matching birthday gets a neutral family greeting.
- Family and child counts cover the whole matching segment, even when pagination or the 20-family preview limit truncates rendered rows.
- Preview remains read-only and bulk delivery remains blocked by the reused KL-01 implementation.

## Historical Reconciliation

The existing daily scheduler called the all-customer reconciliation even after its marker was set. `syncBirthdayTagsForAllCustomers` now refuses before pool acquisition or SQL unless `allowReconciliation === true` is explicitly supplied. The unchanged scheduler does not supply it, so it cannot rewrite tags or mark the reconciliation complete.

An operator reconciliation requires separate approval, a business-scoped preflight report, and an approved record boundary. The opt-in flag is a technical safeguard, not authorization or a ready-made operator workflow. Do not invoke it as part of this task.

## Verification

- `node --test tests/customer-birthday-segments.test.js tests/customer-birthday-tags.test.js tests/customer-children.test.js tests/customer-bulk-preview.test.js`
- `npm run test:integration:customer-birthdays:isolated` uses a disposable database and session-local fixtures. `DATABASE_URL` is never its fallback.
- Browser QA: tag click and Enter/Space without a card opening; dropdown parity; full family/child counts; selected-month and neutral preview; stale preview invalidation; API error; desktop and 390px layout.
- Live QA after the authorized release uses only safe registered test families and sends no messages. Local fixture QA does not establish production/PostgreSQL correctness.
