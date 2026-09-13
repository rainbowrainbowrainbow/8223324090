# D06 orphan and conflict matrix

Source: actual local server.js → disposable PostgreSQL → real HTTP/browser. Run: `d06_1789241525527_7d4a50`.

This is local synthetic acceptance, not live QA or production ownership evidence. Exact observations: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json).

Both snapshots use read-only collection, before and after the API/browser mutation scenarios. Deliberately poisoned local sentinel links are detector inputs, not newly created application defects. Missing ownership is never inferred as Park. Completeness applies to the declared finite table/edge list only.

```json
{
  "definition": {
    "source": "ACTUAL_LOCAL_APP_DISPOSABLE_POSTGRESQL",
    "ownerTables": [
      "bookings",
      "customers",
      "leads",
      "lead_customer_links",
      "tasks",
      "products",
      "timeline_resources",
      "finance_transactions",
      "finance_accounts",
      "finance_categories",
      "warehouse_stock",
      "warehouse_locations",
      "warehouse_history",
      "warehouse_stock_movements",
      "graduation_settings",
      "graduation_services",
      "graduation_packages",
      "graduation_package_items",
      "graduation_quotes",
      "graduation_child_packs",
      "graduation_children",
      "graduation_diploma_templates",
      "graduation_diploma_exports",
      "graduation_automation_state"
    ],
    "relationshipIds": [
      "booking_customer",
      "booking_product",
      "booking_linked_parent",
      "customer_lead",
      "lead_booking",
      "lead_product",
      "lead_link_lead",
      "lead_link_customer",
      "finance_booking",
      "finance_account",
      "finance_category",
      "stock_location",
      "stock_history",
      "stock_movement",
      "graduation_package_item_package",
      "graduation_package_item_service",
      "graduation_pack_quote",
      "graduation_child_quote",
      "graduation_child_pack",
      "graduation_export_quote"
    ],
    "transaction": "REPEATABLE READ READ ONLY; explicit ROLLBACK",
    "unknownOwnerPolicy": "Observe NULL/empty and unregistered contexts; never coalesce an owner to Park.",
    "limitations": [
      "Fixture rows and application seeds are synthetic; counts are not a production inventory or an owner approval.",
      "This finite relationship list does not inspect embedded JSON, external assets, provider jobs or every operational join.",
      "Missing table/column, permission denial or RLS produces NOT_TESTABLE rather than a zero count.",
      "MD compatibility permits some opaque external product codes; missing product counts alone do not prove a service defect.",
      "Staff/payroll/certificate allocation and amounts are not inferred from membership or row counts.",
      "Background workers and outbound providers are held by the parent harness; their usage/delivery cannot be measured here."
    ]
  },
  "sentinelSetup": {
    "source": "DELIBERATE_DISPOSABLE_SENTINELS",
    "marker": "D06_READINESS_2fc0a8fc42",
    "rows": {
      "staff": {
        "status": "SEEDED",
        "id": 98
      },
      "certificate": {
        "status": "SEEDED",
        "id": 1
      },
      "art": {
        "status": "SEEDED",
        "id": 14
      },
      "unregisteredProduct": {
        "status": "SEEDED",
        "id": "d06_orphan_product_2fc0a8fc42"
      },
      "crossContextLead": {
        "status": "SEEDED",
        "id": 4
      },
      "crossContextCustomer": {
        "status": "SEEDED",
        "id": 4
      },
      "crossContextLink": {
        "status": "SEEDED",
        "id": 4
      },
      "nullOwnerProduct": {
        "status": "NOT_TESTABLE",
        "code": "23502",
        "column": "business_context"
      },
      "orphanLeadLink": {
        "status": "NOT_TESTABLE",
        "code": "23503",
        "column": null
      }
    },
    "constraints": {
      "nullProductOwner": {
        "status": "NOT_TESTABLE",
        "reason": "EXISTING_CONSTRAINT_OR_SCHEMA_REJECTED_SENTINEL",
        "code": "23502",
        "column": "business_context"
      },
      "missingLeadParent": {
        "status": "NOT_TESTABLE",
        "reason": "EXISTING_CONSTRAINT_OR_SCHEMA_REJECTED_SENTINEL",
        "code": "23503"
      }
    },
    "baseline": {
      "unregisteredProductRows": 2,
      "crossContextCustomerLinks": 0
    },
    "certificateCode": "D062FC0A8FC42"
  },
  "before": {
    "source": "ACTUAL_LOCAL_APP_DISPOSABLE_POSTGRESQL",
    "collectionStatus": "COMPLETE",
    "readOnly": true,
    "tables": {
      "bookings": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "customers": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 4,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "leads": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 4,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "lead_customer_links": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 4,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "tasks": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "products": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 170,
          "missingContextRows": 0,
          "unregisteredContextRows": 3,
          "inactiveOwnerRows": 0
        }
      },
      "timeline_resources": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 26,
          "missingContextRows": 0,
          "unregisteredContextRows": 1,
          "inactiveOwnerRows": 0
        }
      },
      "finance_transactions": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "finance_accounts": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 19,
          "missingContextRows": 0,
          "unregisteredContextRows": 8,
          "inactiveOwnerRows": 0
        }
      },
      "finance_categories": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 51,
          "missingContextRows": 0,
          "unregisteredContextRows": 24,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_stock": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 5,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_locations": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 9,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_history": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_stock_movements": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_settings": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 5,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_services": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 28,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_packages": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 10,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_package_items": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 33,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_quotes": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_child_packs": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_children": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_diploma_templates": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 1,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_diploma_exports": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_automation_state": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      }
    },
    "relationships": {
      "booking_customer": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "booking_product": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "booking_linked_parent": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "customer_lead": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_booking": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_product": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_link_lead": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 4,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_link_customer": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 4,
          "orphanRows": 0,
          "crossContextRows": 1,
          "unknownContextRows": 0
        }
      },
      "finance_booking": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "finance_account": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "finance_category": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_location": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 5,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_history": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_movement": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_package_item_package": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 33,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_package_item_service": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 33,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_pack_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_child_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_child_pack": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_export_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      }
    },
    "membership": {
      "duplicateBusinessMemberships": {
        "status": "OBSERVED",
        "counts": {
          "duplicateKeys": 0
        }
      },
      "activeWithoutOrganizationMembership": {
        "status": "OBSERVED",
        "counts": {
          "rows": 0
        }
      }
    },
    "limitations": [
      "Fixture rows and application seeds are synthetic; counts are not a production inventory or an owner approval.",
      "This finite relationship list does not inspect embedded JSON, external assets, provider jobs or every operational join.",
      "Missing table/column, permission denial or RLS produces NOT_TESTABLE rather than a zero count.",
      "MD compatibility permits some opaque external product codes; missing product counts alone do not prove a service defect.",
      "Staff/payroll/certificate allocation and amounts are not inferred from membership or row counts.",
      "Background workers and outbound providers are held by the parent harness; their usage/delivery cannot be measured here."
    ]
  },
  "after": {
    "source": "ACTUAL_LOCAL_APP_DISPOSABLE_POSTGRESQL",
    "collectionStatus": "COMPLETE",
    "readOnly": true,
    "tables": {
      "bookings": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "customers": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 7,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "leads": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 4,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "lead_customer_links": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 4,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "tasks": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "products": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 173,
          "missingContextRows": 0,
          "unregisteredContextRows": 3,
          "inactiveOwnerRows": 0
        }
      },
      "timeline_resources": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 26,
          "missingContextRows": 0,
          "unregisteredContextRows": 1,
          "inactiveOwnerRows": 0
        }
      },
      "finance_transactions": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 6,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "finance_accounts": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 19,
          "missingContextRows": 0,
          "unregisteredContextRows": 8,
          "inactiveOwnerRows": 0
        }
      },
      "finance_categories": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 51,
          "missingContextRows": 0,
          "unregisteredContextRows": 24,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_stock": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 8,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_locations": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 9,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_history": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "warehouse_stock_movements": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_settings": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 5,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_services": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 28,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_packages": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 10,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_package_items": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 33,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_quotes": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 3,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_child_packs": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_children": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_diploma_templates": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 1,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_diploma_exports": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      },
      "graduation_automation_state": {
        "status": "OBSERVED",
        "counts": {
          "totalRows": 0,
          "missingContextRows": 0,
          "unregisteredContextRows": 0,
          "inactiveOwnerRows": 0
        }
      }
    },
    "relationships": {
      "booking_customer": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "booking_product": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "booking_linked_parent": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "customer_lead": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_booking": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_product": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 3,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_link_lead": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 4,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "lead_link_customer": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 4,
          "orphanRows": 0,
          "crossContextRows": 1,
          "unknownContextRows": 0
        }
      },
      "finance_booking": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 6,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "finance_account": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 6,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "finance_category": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 6,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_location": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 8,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_history": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "stock_movement": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_package_item_package": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 33,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_package_item_service": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 33,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_pack_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_child_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_child_pack": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      },
      "graduation_export_quote": {
        "status": "OBSERVED",
        "counts": {
          "linkedRows": 0,
          "orphanRows": 0,
          "crossContextRows": 0,
          "unknownContextRows": 0
        }
      }
    },
    "membership": {
      "duplicateBusinessMemberships": {
        "status": "OBSERVED",
        "counts": {
          "duplicateKeys": 0
        }
      },
      "activeWithoutOrganizationMembership": {
        "status": "OBSERVED",
        "counts": {
          "rows": 0
        }
      }
    },
    "limitations": [
      "Fixture rows and application seeds are synthetic; counts are not a production inventory or an owner approval.",
      "This finite relationship list does not inspect embedded JSON, external assets, provider jobs or every operational join.",
      "Missing table/column, permission denial or RLS produces NOT_TESTABLE rather than a zero count.",
      "MD compatibility permits some opaque external product codes; missing product counts alone do not prove a service defect.",
      "Staff/payroll/certificate allocation and amounts are not inferred from membership or row counts.",
      "Background workers and outbound providers are held by the parent harness; their usage/delivery cannot be measured here."
    ]
  },
  "comparison": {
    "id": "D06-OWNERSHIP-AFTER-SCENARIOS",
    "domain": "ownership_collection",
    "status": "PASS",
    "expected": "No new orphan/cross-context relationships across the declared edges after acceptance mutations",
    "observed": {
      "collectionStatus": "COMPLETE",
      "regressions": [],
      "scope": "Declared SQL edges only; intentional pre-existing sentinels retained"
    }
  }
}
```
