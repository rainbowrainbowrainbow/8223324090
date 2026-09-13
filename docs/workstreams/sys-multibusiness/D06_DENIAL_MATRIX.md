# D06 denial matrix

Source: actual local server.js → disposable PostgreSQL → real HTTP/browser. Run: `d06_1789241525527_7d4a50`.

This is local synthetic acceptance, not live QA or production ownership evidence. Exact observations: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json).

Expected forbidden probes returning 200 are failures even when a module is hidden in the UI. Payroll 200 is a containment failure; no financial amount disclosure is inferred.

| Scenario | Actor | Context | Method/path | HTTP | Code/outcome | Result |
| --- | --- | --- | --- | --- | --- | --- |
| domain.event_genix.bookings.direct_id | owner | event_genix | GET /api/bookings/detail/d06_2fc0a8fc42_dar_booking | 404 |  | PASS |
| domain.event_genix.bookings.direct_id | owner | event_genix | GET /api/bookings/detail/d06_2fc0a8fc42_other_booking | 404 |  | PASS |
| domain.event_genix.customers.direct_id | owner | event_genix | GET /api/customers/2 | 404 |  | PASS |
| domain.event_genix.customers.direct_id | owner | event_genix | GET /api/customers/3 | 404 |  | PASS |
| domain.event_genix.leads.direct_id | owner | event_genix | GET /api/leads/2/booking-context | 404 |  | PASS |
| domain.event_genix.leads.direct_id | owner | event_genix | GET /api/leads/3/booking-context | 404 |  | PASS |
| domain.event_genix.tasks.direct_id | owner | event_genix | GET /api/tasks/2 | 404 |  | PASS |
| domain.event_genix.tasks.direct_id | owner | event_genix | GET /api/tasks/3 | 404 |  | PASS |
| domain.event_genix.warehouse.direct_id | owner | event_genix | GET /api/warehouse/4 | 404 |  | PASS |
| domain.event_genix.warehouse.direct_id | owner | event_genix | GET /api/warehouse/5 | 404 |  | PASS |
| domain.event_genix.products.direct_id | owner | event_genix | GET /api/products/d06_2fc0a8fc42_dar_product | 404 |  | PASS |
| domain.event_genix.products.direct_id | owner | event_genix | GET /api/products/d06_2fc0a8fc42_other_product | 404 |  | PASS |
| domain.dar.bookings.direct_id | owner | dar | GET /api/bookings/detail/d06_2fc0a8fc42_park_booking | 404 |  | PASS |
| domain.dar.bookings.direct_id | owner | dar | GET /api/bookings/detail/d06_2fc0a8fc42_other_booking | 404 |  | PASS |
| domain.dar.customers.direct_id | owner | dar | GET /api/customers/1 | 404 |  | PASS |
| domain.dar.customers.direct_id | owner | dar | GET /api/customers/3 | 404 |  | PASS |
| domain.dar.leads.direct_id | owner | dar | GET /api/leads/1/booking-context | 404 |  | PASS |
| domain.dar.leads.direct_id | owner | dar | GET /api/leads/3/booking-context | 404 |  | PASS |
| domain.dar.tasks.direct_id | owner | dar | GET /api/tasks/1 | 404 |  | PASS |
| domain.dar.tasks.direct_id | owner | dar | GET /api/tasks/3 | 404 |  | PASS |
| domain.dar.warehouse.direct_id | owner | dar | GET /api/warehouse/3 | 404 |  | PASS |
| domain.dar.warehouse.direct_id | owner | dar | GET /api/warehouse/5 | 404 |  | PASS |
| domain.dar.products.direct_id | owner | dar | GET /api/products/d06_2fc0a8fc42_park_product | 404 |  | PASS |
| domain.dar.products.direct_id | owner | dar | GET /api/products/d06_2fc0a8fc42_other_product | 404 |  | PASS |
| domain.d06_other.bookings.direct_id | otherOrg | d06_other | GET /api/bookings/detail/d06_2fc0a8fc42_park_booking | 404 |  | PASS |
| domain.d06_other.bookings.direct_id | otherOrg | d06_other | GET /api/bookings/detail/d06_2fc0a8fc42_dar_booking | 404 |  | PASS |
| domain.d06_other.customers.direct_id | otherOrg | d06_other | GET /api/customers/1 | 404 |  | PASS |
| domain.d06_other.customers.direct_id | otherOrg | d06_other | GET /api/customers/2 | 404 |  | PASS |
| domain.d06_other.leads.direct_id | otherOrg | d06_other | GET /api/leads/1/booking-context | 404 |  | PASS |
| domain.d06_other.leads.direct_id | otherOrg | d06_other | GET /api/leads/2/booking-context | 404 |  | PASS |
| domain.d06_other.tasks.direct_id | otherOrg | d06_other | GET /api/tasks/1 | 404 |  | PASS |
| domain.d06_other.tasks.direct_id | otherOrg | d06_other | GET /api/tasks/2 | 404 |  | PASS |
| domain.d06_other.warehouse.direct_id | otherOrg | d06_other | GET /api/warehouse/3 | 404 |  | PASS |
| domain.d06_other.warehouse.direct_id | otherOrg | d06_other | GET /api/warehouse/4 | 404 |  | PASS |
| domain.d06_other.products.direct_id | otherOrg | d06_other | GET /api/products/d06_2fc0a8fc42_park_product | 404 |  | PASS |
| domain.d06_other.products.direct_id | otherOrg | d06_other | GET /api/products/d06_2fc0a8fc42_dar_product | 404 |  | PASS |
| domain.event_genix.graduation | owner | event_genix | GET /api/graduation/packages/d06_2fc0a8fc42_dar_package | 404 |  | PASS |
| domain.event_genix.graduation | owner | event_genix | GET /api/graduation/quotes/2 | 404 |  | PASS |
| domain.event_genix.graduation | owner | event_genix | GET /api/graduation/packages/d06_2fc0a8fc42_other_package | 404 |  | PASS |
| domain.event_genix.graduation | owner | event_genix | GET /api/graduation/quotes/3 | 404 |  | PASS |
| domain.dar.graduation | owner | dar | GET /api/graduation/packages/d06_2fc0a8fc42_park_package | 404 |  | PASS |
| domain.dar.graduation | owner | dar | GET /api/graduation/quotes/1 | 404 |  | PASS |
| domain.dar.graduation | owner | dar | GET /api/graduation/packages/d06_2fc0a8fc42_other_package | 404 |  | PASS |
| domain.dar.graduation | owner | dar | GET /api/graduation/quotes/3 | 404 |  | PASS |
| domain.d06_other.graduation | otherOrg | d06_other | GET /api/graduation/packages | 403 | graduation_business_context_unavailable | PASS |
| domain.d06_other.graduation | otherOrg |  | GET /api/graduation/packages | 403 | graduation_business_context_unavailable | PASS |
| domain.event_genix.bookings.foreign_write | owner | event_genix | PUT /api/bookings/d06_2fc0a8fc42_dar_booking | 404 |  | PASS |
| domain.event_genix.bookings.foreign_write | owner | event_genix | PUT /api/bookings/d06_2fc0a8fc42_other_booking | 404 |  | PASS |
| domain.event_genix.customers.foreign_write | owner | event_genix | PUT /api/customers/2 | 404 |  | PASS |
| domain.event_genix.customers.foreign_write | owner | event_genix | PUT /api/customers/3 | 404 |  | PASS |
| domain.event_genix.leads.foreign_write | owner | event_genix | PATCH /api/leads/2 | 404 |  | PASS |
| domain.event_genix.leads.foreign_write | owner | event_genix | PATCH /api/leads/3 | 404 |  | PASS |
| domain.event_genix.tasks.foreign_write | owner | event_genix | PUT /api/tasks/2 | 404 |  | PASS |
| domain.event_genix.tasks.foreign_write | owner | event_genix | PUT /api/tasks/3 | 404 |  | PASS |
| domain.event_genix.finance.foreign_write | owner | event_genix | PUT /api/finance/transactions/2 | 404 |  | PASS |
| domain.event_genix.finance.foreign_write | owner | event_genix | PUT /api/finance/transactions/3 | 404 |  | PASS |
| domain.event_genix.warehouse.foreign_write | owner | event_genix | PUT /api/warehouse/4 | 404 |  | PASS |
| domain.event_genix.warehouse.foreign_write | owner | event_genix | PUT /api/warehouse/5 | 404 |  | PASS |
| domain.event_genix.products.foreign_write | owner | event_genix | PUT /api/products/d06_2fc0a8fc42_dar_product | 404 |  | PASS |
| domain.event_genix.products.foreign_write | owner | event_genix | PUT /api/products/d06_2fc0a8fc42_other_product | 404 |  | PASS |
| domain.event_genix.graduation.foreign_write | owner | event_genix | PUT /api/graduation/quotes/2 | 404 |  | PASS |
| domain.event_genix.graduation.foreign_write | owner | event_genix | PUT /api/graduation/quotes/3 | 404 |  | PASS |
| domain.dar.bookings.foreign_write | owner | dar | PUT /api/bookings/d06_2fc0a8fc42_park_booking | 404 |  | PASS |
| domain.dar.bookings.foreign_write | owner | dar | PUT /api/bookings/d06_2fc0a8fc42_other_booking | 404 |  | PASS |
| domain.dar.customers.foreign_write | owner | dar | PUT /api/customers/1 | 404 |  | PASS |
| domain.dar.customers.foreign_write | owner | dar | PUT /api/customers/3 | 404 |  | PASS |
| domain.dar.leads.foreign_write | owner | dar | PATCH /api/leads/1 | 404 |  | PASS |
| domain.dar.leads.foreign_write | owner | dar | PATCH /api/leads/3 | 404 |  | PASS |
| domain.dar.tasks.foreign_write | owner | dar | PUT /api/tasks/1 | 404 |  | PASS |
| domain.dar.tasks.foreign_write | owner | dar | PUT /api/tasks/3 | 404 |  | PASS |
| domain.dar.finance.foreign_write | owner | dar | PUT /api/finance/transactions/1 | 404 |  | PASS |
| domain.dar.finance.foreign_write | owner | dar | PUT /api/finance/transactions/3 | 404 |  | PASS |
| domain.dar.warehouse.foreign_write | owner | dar | PUT /api/warehouse/3 | 404 |  | PASS |
| domain.dar.warehouse.foreign_write | owner | dar | PUT /api/warehouse/5 | 404 |  | PASS |
| domain.dar.products.foreign_write | owner | dar | PUT /api/products/d06_2fc0a8fc42_park_product | 404 |  | PASS |
| domain.dar.products.foreign_write | owner | dar | PUT /api/products/d06_2fc0a8fc42_other_product | 404 |  | PASS |
| domain.dar.graduation.foreign_write | owner | dar | PUT /api/graduation/quotes/1 | 404 |  | PASS |
| domain.dar.graduation.foreign_write | owner | dar | PUT /api/graduation/quotes/3 | 404 |  | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 |  | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 |  | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 |  | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 |  | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH /api/leads/1 | 404 | lead_related_record_not_found | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH /api/leads/1 | 404 | lead_related_record_not_found | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH /api/leads/1 | 404 | lead_related_record_not_found | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH /api/leads/1 | 404 | lead_related_record_not_found | PASS |
| domain.event_genix.warehouse.foreign_location | owner | event_genix | POST /api/warehouse | 400 |  | PASS |
| domain.event_genix.warehouse.foreign_location | owner | event_genix | POST /api/warehouse | 400 |  | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 |  | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 |  | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 |  | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 |  | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH /api/leads/2 | 404 | lead_related_record_not_found | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH /api/leads/2 | 404 | lead_related_record_not_found | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH /api/leads/2 | 404 | lead_related_record_not_found | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH /api/leads/2 | 404 | lead_related_record_not_found | PASS |
| domain.dar.warehouse.foreign_location | owner | dar | POST /api/warehouse | 400 |  | PASS |
| domain.dar.warehouse.foreign_location | owner | dar | POST /api/warehouse | 400 |  | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 |  | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 |  | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 |  | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 |  | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST /api/finance/transactions | 400 | finance_booking_not_found | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH /api/leads/3 | 404 | lead_related_record_not_found | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH /api/leads/3 | 404 | lead_related_record_not_found | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH /api/leads/3 | 404 | lead_related_record_not_found | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH /api/leads/3 | 404 | lead_related_record_not_found | PASS |
| domain.d06_other.warehouse.foreign_location | otherOrg | d06_other | POST /api/warehouse | 400 |  | PASS |
| domain.d06_other.warehouse.foreign_location | otherOrg | d06_other | POST /api/warehouse | 400 |  | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_service_context_mismatch | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_package_context_mismatch | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_customer_context_mismatch | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_service_context_mismatch | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_package_context_mismatch | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT /api/graduation/quotes/1 | 400 | graduation_customer_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_service_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_package_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_customer_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_service_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_package_context_mismatch | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT /api/graduation/quotes/2 | 400 | graduation_customer_context_mismatch | PASS |
| aggregate.permissions_and_organizations | worker | event_genix | GET /api/products?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | business_scope_permissions_mismatch | PASS |
| aggregate.permissions_and_organizations | multiOrg | event_genix | GET /api/products?businessScope=multi&businessContexts=event_genix,d06_other | 403 | business_scope_organization_mismatch | PASS |
| aggregate.write.POST | owner | event_genix | POST /api/customers?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | business_scope_read_only | PASS |
| aggregate.write.PUT | owner | event_genix | PUT /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | business_scope_read_only | PASS |
| aggregate.write.PATCH | owner | event_genix | PATCH /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | business_scope_read_only | PASS |
| aggregate.write.DELETE | owner | event_genix | DELETE /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | business_scope_read_only | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/bookings/2026-09-16 | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/timeline/resources?type=cabinet | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/customers?limit=100 | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/leads?limit=100 | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/tasks?date=2026-09-16&limit=100 | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/finance/transactions?from=2026-09-16&to=2026-09-16&limit=200 | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/warehouse | 403 | business_context_unavailable | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET /api/products | 403 | business_context_unavailable | PASS |
| auth.default_and_role_isolation | worker | dar | GET /api/finance/accounts | 403 |  | PASS |
| lifecycle.last_owner | owner | event_genix | PUT /api/organizations/1/members/5 | 409 | organization_last_owner | PASS |
| lifecycle.management_boundaries | worker | event_genix | PUT /api/organizations/1/members/7 | 403 | organization_management_denied | PASS |
| lifecycle.management_boundaries | owner | event_genix | PATCH /api/organizations/businesses/3/configuration | 403 | organization_management_denied | PASS |
| lifecycle.management_boundaries | admin | event_genix | POST /api/organizations/1/businesses | 403 | organization_management_denied | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET /api/products | 403 | business_module_disabled | PASS |
| lifecycle.owner_custom_business | owner | event_genix | PATCH /api/organizations/businesses/4/configuration | 400 | business_module_not_supported | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET /api/products | 403 | business_context_unavailable | PASS |
| containment.event_genix.catalogs_not_migrated.read | owner | event_genix | GET /api/catalogs | 403 | catalogs_not_migrated | PASS |
| containment.event_genix.booking_templates_not_migrated.read | owner | event_genix | GET /api/booking-templates | 403 | booking_templates_not_migrated | PASS |
| containment.event_genix.recurring_not_migrated.read | owner | event_genix | GET /api/recurring | 403 | recurring_not_migrated | PASS |
| containment.event_genix.warehouse_photo_intake_not_migrated.status | owner | event_genix | GET /api/warehouse/photo-intake/status | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.event_genix.warehouse_photo_intake_not_migrated.read | owner | event_genix | GET /api/warehouse/photo-intake | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.event_genix.chat_not_migrated.read | owner | event_genix | GET /api/chat/channels | 403 | chat_not_migrated | PASS |
| containment.event_genix.kleshnya_not_migrated.read | owner | event_genix | GET /api/kleshnya/sessions | 403 | kleshnya_not_migrated | PASS |
| containment.event_genix.finance_salary_not_migrated.read | owner | event_genix | GET /api/finance/report/salary | 403 | finance_salary_not_migrated | PASS |
| containment.dar.catalogs_not_migrated.read | owner | dar | GET /api/catalogs | 403 | catalogs_not_migrated | PASS |
| containment.dar.booking_templates_not_migrated.read | owner | dar | GET /api/booking-templates | 403 | booking_templates_not_migrated | PASS |
| containment.dar.recurring_not_migrated.read | owner | dar | GET /api/recurring | 403 | recurring_not_migrated | PASS |
| containment.dar.warehouse_photo_intake_not_migrated.status | owner | dar | GET /api/warehouse/photo-intake/status | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.dar.warehouse_photo_intake_not_migrated.read | owner | dar | GET /api/warehouse/photo-intake | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.dar.chat_not_migrated.read | owner | dar | GET /api/chat/channels | 403 | chat_not_migrated | PASS |
| containment.dar.kleshnya_not_migrated.read | owner | dar | GET /api/kleshnya/sessions | 403 | kleshnya_not_migrated | PASS |
| containment.dar.finance_salary_not_migrated.read | owner | dar | GET /api/finance/report/salary | 403 | finance_salary_not_migrated | PASS |
| containment.d06_other.catalogs_not_migrated.read | otherOrg | d06_other | GET /api/catalogs | 403 | catalogs_not_migrated | PASS |
| containment.d06_other.booking_templates_not_migrated.read | otherOrg | d06_other | GET /api/booking-templates | 403 | booking_templates_not_migrated | PASS |
| containment.d06_other.recurring_not_migrated.read | otherOrg | d06_other | GET /api/recurring | 403 | recurring_not_migrated | PASS |
| containment.d06_other.warehouse_photo_intake_not_migrated.status | otherOrg | d06_other | GET /api/warehouse/photo-intake/status | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.d06_other.warehouse_photo_intake_not_migrated.read | otherOrg | d06_other | GET /api/warehouse/photo-intake | 403 | warehouse_photo_intake_not_migrated | PASS |
| containment.d06_other.chat_not_migrated.read | otherOrg | d06_other | GET /api/chat/channels | 403 | chat_not_migrated | PASS |
| containment.d06_other.kleshnya_not_migrated.read | otherOrg | d06_other | GET /api/kleshnya/sessions | 403 | kleshnya_not_migrated | PASS |
| containment.d06_other.finance_salary_not_migrated.read | otherOrg | d06_other | GET /api/finance/report/salary | 403 | finance_salary_not_migrated | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET /api/finance/accounts | 403 |  | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET /api/products | 403 | business_context_unavailable | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET /api/auth/business-profile | 403 | business_context_unavailable | PASS |
| enabled_extra.event_genix.omni.context | owner | event_genix | GET /api/omni/conversations/2/context | 404 |  | PASS |
| enabled_extra.event_genix.omni.context | owner | event_genix | GET /api/omni/conversations/3/context | 404 |  | PASS |
| enabled_extra.dar.omni.context | owner | dar | GET /api/omni/conversations/1/context | 404 |  | PASS |
| enabled_extra.dar.omni.context | owner | dar | GET /api/omni/conversations/3/context | 404 |  | PASS |
| enabled_extra.d06_other.omni.context | otherOrg | d06_other | GET /api/omni/conversations/1/context | 404 |  | PASS |
| enabled_extra.d06_other.omni.context | otherOrg | d06_other | GET /api/omni/conversations/2/context | 404 |  | PASS |
| enabled_extra.dashboard.inaccessible_organization | otherOrg | event_genix | GET /api/dashboard/widgets/tasks | 403 | business_context_unavailable | PASS |
| enabled_extra.dashboard.inaccessible_organization | owner | d06_other | GET /api/dashboard/widgets/tasks | 403 | business_context_unavailable | PASS |
| enabled_extra.dashboard.inaccessible_organization | otherOrg | event_genix | GET /api/dashboard/widgets/leads_new | 403 | business_context_unavailable | PASS |
| enabled_extra.dashboard.inaccessible_organization | owner | d06_other | GET /api/dashboard/widgets/leads_new | 403 | business_context_unavailable | PASS |
| enabled_extra.settings.inaccessible_organization | otherOrg | event_genix | GET /api/business/cabinet | 403 | business_context_unavailable | PASS |
| enabled_extra.settings.inaccessible_organization | owner | d06_other | GET /api/business/cabinet | 403 | business_context_unavailable | PASS |
| enabled_extra.settings.inaccessible_organization | otherOrg | event_genix | GET /api/settings/timeline-display | 403 | business_context_unavailable | PASS |
| enabled_extra.settings.inaccessible_organization | owner | d06_other | GET /api/settings/timeline-display | 403 | business_context_unavailable | PASS |
| enabled_extra.omni.inaccessible_organization | otherOrg | event_genix | GET /api/omni/conversations | 403 | business_context_unavailable | PASS |
| enabled_extra.omni.inaccessible_organization | owner | d06_other | GET /api/omni/conversations | 403 | business_context_unavailable | PASS |
| enabled_extra.omni.inaccessible_organization | otherOrg | event_genix | GET /api/omni/conversations/1/context | 403 | business_context_unavailable | PASS |
| enabled_extra.omni.inaccessible_organization | owner | d06_other | GET /api/omni/conversations/1/context | 403 | business_context_unavailable | PASS |
| warehouse_residual.event_genix.contractors.unassigned_list | owner | event_genix | GET /api/contractors | 200 |  | FAIL |
| warehouse_residual.event_genix.procurement.unassigned_list | owner | event_genix | GET /api/procurement | 200 |  | FAIL |
| warehouse_residual.dar.contractors.unassigned_list | owner | dar | GET /api/contractors | 200 |  | FAIL |
| warehouse_residual.dar.procurement.unassigned_list | owner | dar | GET /api/procurement | 200 |  | FAIL |
| warehouse_residual.d06_other.contractors.unassigned_list | otherOrg | d06_other | GET /api/contractors | 200 |  | FAIL |
| warehouse_residual.d06_other.procurement.unassigned_list | otherOrg | d06_other | GET /api/procurement | 200 |  | FAIL |
| warehouse_residual.dar.event_genix.direct_stock | owner | dar | GET /api/contractors/2/order-context?stockItemId=3 | 200 |  | FAIL |
| warehouse_residual.dar.event_genix.procurement_stock | owner | dar | GET /api/contractors/2/order-context?procurementItemId=1 | 200 |  | FAIL |
| warehouse_residual.d06_other.event_genix.direct_stock | otherOrg | d06_other | GET /api/contractors/2/order-context?stockItemId=3 | 200 |  | FAIL |
| warehouse_residual.d06_other.event_genix.procurement_stock | otherOrg | d06_other | GET /api/contractors/2/order-context?procurementItemId=1 | 200 |  | FAIL |
| warehouse_residual.event_genix.dar.direct_stock | owner | event_genix | GET /api/contractors/3/order-context?stockItemId=4 | 200 |  | FAIL |
| warehouse_residual.event_genix.dar.procurement_stock | owner | event_genix | GET /api/contractors/3/order-context?procurementItemId=2 | 200 |  | FAIL |
| warehouse_residual.d06_other.dar.direct_stock | otherOrg | d06_other | GET /api/contractors/3/order-context?stockItemId=4 | 200 |  | FAIL |
| warehouse_residual.d06_other.dar.procurement_stock | otherOrg | d06_other | GET /api/contractors/3/order-context?procurementItemId=2 | 200 |  | FAIL |
| D06-READINESS-PROTECTED-staff-dar | owner | dar | GET /api/staff | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-certificates-dar | owner | dar | GET /api/certificates | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-art-dar | owner | dar | GET /api/art-director/brand | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-payroll-dar | owner | dar | GET /api/payroll/settlement?month=2026-09 | 200 | UNMIGRATED_ENDPOINT_NOT_DEMONSTRABLY_CONTAINED | FAIL |
| D06-READINESS-PROTECTED-staff-d06_other | otherOrg | d06_other | GET /api/staff | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-certificates-d06_other | otherOrg | d06_other | GET /api/certificates | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-art-d06_other | otherOrg | d06_other | GET /api/art-director/brand | 200 | UNOWNED_SYNTHETIC_RECORD_EXPOSED | FAIL |
| D06-READINESS-PROTECTED-payroll-d06_other | otherOrg | d06_other | GET /api/payroll/settlement?month=2026-09 | 200 | UNMIGRATED_ENDPOINT_NOT_DEMONSTRABLY_CONTAINED | FAIL |
