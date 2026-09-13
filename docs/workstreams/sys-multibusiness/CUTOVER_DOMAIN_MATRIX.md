# SYS-MB-FINISH-02 domain matrix

Statuses describe production-cutover readiness, not menu visibility or a local fixture result. `PREPARED` means the read-only collector and release package have a runnable path; it does not grant authority or turn a module on.

| Domain / entry family | MD | CRM | Current action | Cutover gate |
| --- | --- | --- | --- | --- |
| Registry, membership, defaults | PREPARED | PREPARED | Journal binds context, source snapshot, mapping and target organization | OWN-01/02/03 plus real preflight |
| Profile, HTTP context admission | PREPARED | PREPARED | Aggregate compatibility telemetry is durable after migration 363 | Exact source mapping and production telemetry deployment |
| Timeline / resources | BLOCKED_POLICY | NOT_REQUIRED_UNTIL_MODULE_DECISION | MD creator-only delegation is unresolved | OWN-07 |
| Bookings / external program IDs | BLOCKED_POLICY | NOT_REQUIRED_UNTIL_MODULE_DECISION | Preserve opaque MD codes; no synthetic product mapping | OWN-07 and protected booking scope |
| Products, customers, leads, tasks | PREPARED_FOR_INVENTORY | PREPARED_FOR_INVENTORY | Context/foreign-root counts collected only | Approved historical mapping and domain acceptance |
| Finance, warehouse | PREPARED_FOR_INVENTORY | BLOCKED_PROTECTED | No pricing/formula or financial-data change | OWN-08 and separate finance contract |
| Catalogs / templates | BLOCKED_OWNER_MAPPING | BLOCKED_OWNER_MAPPING | Roots and children now appear in preflight counts | OWN-04 |
| Recurring / generated bookings | BLOCKED_OWNER_MAPPING | BLOCKED_OWNER_MAPPING | Templates/skips counted; scheduler remains unchanged | OWN-04/06, recurring owner/retry design |
| Public catalog links / images | BLOCKED_PUBLIC_POLICY | BLOCKED_PUBLIC_POLICY | Catalog/asset roots counted; no link/image serving change | OWN-05 |
| Actorless jobs / provider retries | BLOCKED_DESTINATION_POLICY | BLOCKED_DESTINATION_POLICY | Hermes jobs counted; no provider call/configuration change | OWN-06 |
| Chat, Omni, Kleshnya | BLOCKED_EXISTING_CONTAINMENT | BLOCKED_EXISTING_CONTAINMENT | Existing denial path stays in place | Stored principal/destination and revoke evidence |
| Staff, certificates, payroll, HR | OUT_OF_SCOPE_PROTECTED | OUT_OF_SCOPE_PROTECTED | No role inference, salary access or formula change | Separate approved people/payroll contract |
| Art, payments, Telegram | OUT_OF_SCOPE_PROTECTED | OUT_OF_SCOPE_PROTECTED | No provider destination or real side effect | Separate ownership/provider release |
| Compatibility removal | HOLD_NOT_MEASURED | HOLD_NOT_MEASURED | Hourly telemetry schema/service prepared | Both cutovers + observation gate |

No required module was disabled by this task. Existing containment remains active where ownership is not proven.
