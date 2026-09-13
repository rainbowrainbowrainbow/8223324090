# D06 access matrix

Source: actual local server.js → disposable PostgreSQL → real HTTP/browser. Run: `d06_1789241525527_7d4a50`.

This is local synthetic acceptance, not live QA or production ownership evidence. Exact observations: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json).

Profiles and effective roles are collected from the actual business-profile endpoint. HTTP rows retain actual response status; scenario PASS can mean an expected denial.

```json
[
  {
    "actor": "owner",
    "context": "event_genix",
    "httpStatus": 200,
    "code": null,
    "activeContext": "event_genix",
    "membershipMode": "membership",
    "role": "director",
    "roles": [
      "director"
    ],
    "modulesSource": "business_registry",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "customers",
      "leads",
      "finance",
      "programs",
      "warehouse",
      "settings",
      "omni",
      "graduation"
    ],
    "modules": [
      {
        "key": "dashboard",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "timeline",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "tasks",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "customers",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "leads",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "finance",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "programs",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "warehouse",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "settings",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "omni",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "graduation",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "chat",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "reports",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "copilot",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "staff",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "hr",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "training",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "checkin",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kitchen",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "catalogs",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "content",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "art",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "sound",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "afisha",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "certificates",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kleshnya",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "guardian",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "center",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "game",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "demo",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payroll",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "telegram",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payments",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      }
    ]
  },
  {
    "actor": "owner",
    "context": "dar",
    "httpStatus": 200,
    "code": null,
    "activeContext": "dar",
    "membershipMode": "membership",
    "role": "director",
    "roles": [
      "director"
    ],
    "modulesSource": "business_registry",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "customers",
      "leads",
      "finance",
      "programs",
      "warehouse",
      "settings",
      "omni",
      "graduation"
    ],
    "modules": [
      {
        "key": "dashboard",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "timeline",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "tasks",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "customers",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "leads",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "finance",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "programs",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "warehouse",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "settings",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "omni",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "graduation",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "chat",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "reports",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "copilot",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "staff",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "hr",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "training",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "checkin",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kitchen",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "catalogs",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "content",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "art",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "sound",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "afisha",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "certificates",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kleshnya",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "guardian",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "center",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "game",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "demo",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payroll",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "telegram",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payments",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      }
    ]
  },
  {
    "actor": "multiOrg",
    "context": "event_genix",
    "httpStatus": 200,
    "code": null,
    "activeContext": "event_genix",
    "membershipMode": "membership",
    "role": "director",
    "roles": [
      "director"
    ],
    "modulesSource": "business_registry",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "customers",
      "leads",
      "finance",
      "programs",
      "warehouse",
      "settings",
      "omni",
      "graduation"
    ],
    "modules": [
      {
        "key": "dashboard",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "timeline",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "tasks",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "customers",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "leads",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "finance",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "programs",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "warehouse",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "settings",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "omni",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "graduation",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "chat",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "reports",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "copilot",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "staff",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "hr",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "training",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "checkin",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kitchen",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "catalogs",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "content",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "art",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "sound",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "afisha",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "certificates",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kleshnya",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "guardian",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "center",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "game",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "demo",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payroll",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "telegram",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payments",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      }
    ]
  },
  {
    "actor": "multiOrg",
    "context": "d06_other",
    "httpStatus": 200,
    "code": null,
    "activeContext": "d06_other",
    "membershipMode": "membership",
    "role": "manager",
    "roles": [
      "manager"
    ],
    "modulesSource": "business_registry",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "customers",
      "leads",
      "finance",
      "programs",
      "warehouse",
      "settings",
      "omni"
    ],
    "modules": [
      {
        "key": "dashboard",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "timeline",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "tasks",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "customers",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "leads",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "finance",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "programs",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "warehouse",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "settings",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "omni",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "graduation",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "chat",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "reports",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "copilot",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "staff",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "hr",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "training",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "checkin",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kitchen",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "catalogs",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "content",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "art",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "sound",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "afisha",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "certificates",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kleshnya",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "guardian",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "center",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "game",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "demo",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payroll",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "telegram",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payments",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      }
    ]
  },
  {
    "actor": "otherOrg",
    "context": "d06_other",
    "httpStatus": 200,
    "code": null,
    "activeContext": "d06_other",
    "membershipMode": "membership",
    "role": "director",
    "roles": [
      "director"
    ],
    "modulesSource": "business_registry",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "customers",
      "leads",
      "finance",
      "programs",
      "warehouse",
      "settings",
      "omni"
    ],
    "modules": [
      {
        "key": "dashboard",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "timeline",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "tasks",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "customers",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "leads",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "finance",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "programs",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "warehouse",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "settings",
        "status": "supported",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "omni",
        "status": "limited",
        "canEnable": true,
        "enabled": true
      },
      {
        "key": "graduation",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "chat",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "reports",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "copilot",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "staff",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "hr",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "training",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "checkin",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kitchen",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "catalogs",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "content",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "art",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "sound",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "afisha",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "certificates",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "kleshnya",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "guardian",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "center",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "game",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "demo",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payroll",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "telegram",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      },
      {
        "key": "payments",
        "status": "not_migrated",
        "canEnable": false,
        "enabled": false
      }
    ]
  },
  {
    "actor": "compatibility",
    "context": "maysternya_doli",
    "httpStatus": 200,
    "code": null,
    "activeContext": "maysternya_doli",
    "membershipMode": "compatibility",
    "role": "director",
    "roles": [
      "director"
    ],
    "modulesSource": "business_operating_profile",
    "enabledModules": [
      "dashboard",
      "timeline",
      "tasks",
      "chat",
      "customers",
      "leads",
      "omni",
      "reports",
      "finance",
      "content",
      "kleshnya",
      "settings"
    ],
    "modules": []
  }
]
```

| Scenario | Actor | Context | Method | Path | HTTP | Scenario result |
| --- | --- | --- | --- | --- | --- | --- |
| domain.event_genix.bookings.list | owner | event_genix | GET | /api/bookings/2026-09-16 | 200 | PASS |
| domain.event_genix.timeline.list | owner | event_genix | GET | /api/timeline/resources?type=cabinet | 200 | PASS |
| domain.event_genix.customers.list | owner | event_genix | GET | /api/customers?limit=100 | 200 | PASS |
| domain.event_genix.leads.list | owner | event_genix | GET | /api/leads?limit=100 | 200 | PASS |
| domain.event_genix.tasks.list | owner | event_genix | GET | /api/tasks?date=2026-09-16&limit=100 | 200 | PASS |
| domain.event_genix.finance.list | owner | event_genix | GET | /api/finance/transactions?from=2026-09-16&to=2026-09-16&limit=200 | 200 | PASS |
| domain.event_genix.warehouse.list | owner | event_genix | GET | /api/warehouse | 200 | PASS |
| domain.event_genix.products.list | owner | event_genix | GET | /api/products | 200 | PASS |
| domain.dar.bookings.list | owner | dar | GET | /api/bookings/2026-09-16 | 200 | PASS |
| domain.dar.timeline.list | owner | dar | GET | /api/timeline/resources?type=cabinet | 200 | PASS |
| domain.dar.customers.list | owner | dar | GET | /api/customers?limit=100 | 200 | PASS |
| domain.dar.leads.list | owner | dar | GET | /api/leads?limit=100 | 200 | PASS |
| domain.dar.tasks.list | owner | dar | GET | /api/tasks?date=2026-09-16&limit=100 | 200 | PASS |
| domain.dar.finance.list | owner | dar | GET | /api/finance/transactions?from=2026-09-16&to=2026-09-16&limit=200 | 200 | PASS |
| domain.dar.warehouse.list | owner | dar | GET | /api/warehouse | 200 | PASS |
| domain.dar.products.list | owner | dar | GET | /api/products | 200 | PASS |
| domain.d06_other.bookings.list | otherOrg | d06_other | GET | /api/bookings/2026-09-16 | 200 | PASS |
| domain.d06_other.timeline.list | otherOrg | d06_other | GET | /api/timeline/resources?type=cabinet | 200 | PASS |
| domain.d06_other.customers.list | otherOrg | d06_other | GET | /api/customers?limit=100 | 200 | PASS |
| domain.d06_other.leads.list | otherOrg | d06_other | GET | /api/leads?limit=100 | 200 | PASS |
| domain.d06_other.tasks.list | otherOrg | d06_other | GET | /api/tasks?date=2026-09-16&limit=100 | 200 | PASS |
| domain.d06_other.finance.list | otherOrg | d06_other | GET | /api/finance/transactions?from=2026-09-16&to=2026-09-16&limit=200 | 200 | PASS |
| domain.d06_other.warehouse.list | otherOrg | d06_other | GET | /api/warehouse | 200 | PASS |
| domain.d06_other.products.list | otherOrg | d06_other | GET | /api/products | 200 | PASS |
| domain.event_genix.bookings.direct_id | owner | event_genix | GET | /api/bookings/detail/d06_2fc0a8fc42_park_booking | 200 | PASS |
| domain.event_genix.bookings.direct_id | owner | event_genix | GET | /api/bookings/detail/d06_2fc0a8fc42_dar_booking | 404 | PASS |
| domain.event_genix.bookings.direct_id | owner | event_genix | GET | /api/bookings/detail/d06_2fc0a8fc42_other_booking | 404 | PASS |
| domain.event_genix.customers.direct_id | owner | event_genix | GET | /api/customers/1 | 200 | PASS |
| domain.event_genix.customers.direct_id | owner | event_genix | GET | /api/customers/2 | 404 | PASS |
| domain.event_genix.customers.direct_id | owner | event_genix | GET | /api/customers/3 | 404 | PASS |
| domain.event_genix.leads.direct_id | owner | event_genix | GET | /api/leads/1/booking-context | 200 | PASS |
| domain.event_genix.leads.direct_id | owner | event_genix | GET | /api/leads/2/booking-context | 404 | PASS |
| domain.event_genix.leads.direct_id | owner | event_genix | GET | /api/leads/3/booking-context | 404 | PASS |
| domain.event_genix.tasks.direct_id | owner | event_genix | GET | /api/tasks/1 | 200 | PASS |
| domain.event_genix.tasks.direct_id | owner | event_genix | GET | /api/tasks/2 | 404 | PASS |
| domain.event_genix.tasks.direct_id | owner | event_genix | GET | /api/tasks/3 | 404 | PASS |
| domain.event_genix.warehouse.direct_id | owner | event_genix | GET | /api/warehouse/3 | 200 | PASS |
| domain.event_genix.warehouse.direct_id | owner | event_genix | GET | /api/warehouse/4 | 404 | PASS |
| domain.event_genix.warehouse.direct_id | owner | event_genix | GET | /api/warehouse/5 | 404 | PASS |
| domain.event_genix.products.direct_id | owner | event_genix | GET | /api/products/d06_2fc0a8fc42_park_product | 200 | PASS |
| domain.event_genix.products.direct_id | owner | event_genix | GET | /api/products/d06_2fc0a8fc42_dar_product | 404 | PASS |
| domain.event_genix.products.direct_id | owner | event_genix | GET | /api/products/d06_2fc0a8fc42_other_product | 404 | PASS |
| domain.dar.bookings.direct_id | owner | dar | GET | /api/bookings/detail/d06_2fc0a8fc42_dar_booking | 200 | PASS |
| domain.dar.bookings.direct_id | owner | dar | GET | /api/bookings/detail/d06_2fc0a8fc42_park_booking | 404 | PASS |
| domain.dar.bookings.direct_id | owner | dar | GET | /api/bookings/detail/d06_2fc0a8fc42_other_booking | 404 | PASS |
| domain.dar.customers.direct_id | owner | dar | GET | /api/customers/2 | 200 | PASS |
| domain.dar.customers.direct_id | owner | dar | GET | /api/customers/1 | 404 | PASS |
| domain.dar.customers.direct_id | owner | dar | GET | /api/customers/3 | 404 | PASS |
| domain.dar.leads.direct_id | owner | dar | GET | /api/leads/2/booking-context | 200 | PASS |
| domain.dar.leads.direct_id | owner | dar | GET | /api/leads/1/booking-context | 404 | PASS |
| domain.dar.leads.direct_id | owner | dar | GET | /api/leads/3/booking-context | 404 | PASS |
| domain.dar.tasks.direct_id | owner | dar | GET | /api/tasks/2 | 200 | PASS |
| domain.dar.tasks.direct_id | owner | dar | GET | /api/tasks/1 | 404 | PASS |
| domain.dar.tasks.direct_id | owner | dar | GET | /api/tasks/3 | 404 | PASS |
| domain.dar.warehouse.direct_id | owner | dar | GET | /api/warehouse/4 | 200 | PASS |
| domain.dar.warehouse.direct_id | owner | dar | GET | /api/warehouse/3 | 404 | PASS |
| domain.dar.warehouse.direct_id | owner | dar | GET | /api/warehouse/5 | 404 | PASS |
| domain.dar.products.direct_id | owner | dar | GET | /api/products/d06_2fc0a8fc42_dar_product | 200 | PASS |
| domain.dar.products.direct_id | owner | dar | GET | /api/products/d06_2fc0a8fc42_park_product | 404 | PASS |
| domain.dar.products.direct_id | owner | dar | GET | /api/products/d06_2fc0a8fc42_other_product | 404 | PASS |
| domain.d06_other.bookings.direct_id | otherOrg | d06_other | GET | /api/bookings/detail/d06_2fc0a8fc42_other_booking | 200 | PASS |
| domain.d06_other.bookings.direct_id | otherOrg | d06_other | GET | /api/bookings/detail/d06_2fc0a8fc42_park_booking | 404 | PASS |
| domain.d06_other.bookings.direct_id | otherOrg | d06_other | GET | /api/bookings/detail/d06_2fc0a8fc42_dar_booking | 404 | PASS |
| domain.d06_other.customers.direct_id | otherOrg | d06_other | GET | /api/customers/3 | 200 | PASS |
| domain.d06_other.customers.direct_id | otherOrg | d06_other | GET | /api/customers/1 | 404 | PASS |
| domain.d06_other.customers.direct_id | otherOrg | d06_other | GET | /api/customers/2 | 404 | PASS |
| domain.d06_other.leads.direct_id | otherOrg | d06_other | GET | /api/leads/3/booking-context | 200 | PASS |
| domain.d06_other.leads.direct_id | otherOrg | d06_other | GET | /api/leads/1/booking-context | 404 | PASS |
| domain.d06_other.leads.direct_id | otherOrg | d06_other | GET | /api/leads/2/booking-context | 404 | PASS |
| domain.d06_other.tasks.direct_id | otherOrg | d06_other | GET | /api/tasks/3 | 200 | PASS |
| domain.d06_other.tasks.direct_id | otherOrg | d06_other | GET | /api/tasks/1 | 404 | PASS |
| domain.d06_other.tasks.direct_id | otherOrg | d06_other | GET | /api/tasks/2 | 404 | PASS |
| domain.d06_other.warehouse.direct_id | otherOrg | d06_other | GET | /api/warehouse/5 | 200 | PASS |
| domain.d06_other.warehouse.direct_id | otherOrg | d06_other | GET | /api/warehouse/3 | 404 | PASS |
| domain.d06_other.warehouse.direct_id | otherOrg | d06_other | GET | /api/warehouse/4 | 404 | PASS |
| domain.d06_other.products.direct_id | otherOrg | d06_other | GET | /api/products/d06_2fc0a8fc42_other_product | 200 | PASS |
| domain.d06_other.products.direct_id | otherOrg | d06_other | GET | /api/products/d06_2fc0a8fc42_park_product | 404 | PASS |
| domain.d06_other.products.direct_id | otherOrg | d06_other | GET | /api/products/d06_2fc0a8fc42_dar_product | 404 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/packages | 200 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/packages/d06_2fc0a8fc42_dar_package | 404 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/quotes/2 | 404 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/packages/d06_2fc0a8fc42_other_package | 404 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/quotes/3 | 404 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/packages/d06_2fc0a8fc42_park_package | 200 | PASS |
| domain.event_genix.graduation | owner | event_genix | GET | /api/graduation/quotes/1 | 200 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/packages | 200 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/packages/d06_2fc0a8fc42_park_package | 404 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/quotes/1 | 404 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/packages/d06_2fc0a8fc42_other_package | 404 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/quotes/3 | 404 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/packages/d06_2fc0a8fc42_dar_package | 200 | PASS |
| domain.dar.graduation | owner | dar | GET | /api/graduation/quotes/2 | 200 | PASS |
| domain.d06_other.graduation | otherOrg | d06_other | GET | /api/graduation/packages | 403 | PASS |
| domain.d06_other.graduation | otherOrg |  | GET | /api/graduation/packages | 403 | PASS |
| domain.event_genix.timeline_get_no_insert | owner | event_genix | GET | /api/timeline/resources | 200 | PASS |
| domain.event_genix.timeline_get_no_insert | owner | event_genix | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.event_genix.timeline_get_no_insert | owner | event_genix | GET | /api/timeline/resources | 200 | PASS |
| domain.event_genix.timeline_get_no_insert | owner | event_genix | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.dar.timeline_get_no_insert | owner | dar | GET | /api/timeline/resources | 200 | PASS |
| domain.dar.timeline_get_no_insert | owner | dar | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.dar.timeline_get_no_insert | owner | dar | GET | /api/timeline/resources | 200 | PASS |
| domain.dar.timeline_get_no_insert | owner | dar | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.d06_other.timeline_get_no_insert | otherOrg | d06_other | GET | /api/timeline/resources | 200 | PASS |
| domain.d06_other.timeline_get_no_insert | otherOrg | d06_other | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.d06_other.timeline_get_no_insert | otherOrg | d06_other | GET | /api/timeline/resources | 200 | PASS |
| domain.d06_other.timeline_get_no_insert | otherOrg | d06_other | GET | /api/timeline/resources/availability?type=cabinet&date=2026-09-16&time=12:00&duration=30 | 200 | PASS |
| domain.event_genix.bookings.foreign_write | owner | event_genix | PUT | /api/bookings/d06_2fc0a8fc42_dar_booking | 404 | PASS |
| domain.event_genix.bookings.foreign_write | owner | event_genix | PUT | /api/bookings/d06_2fc0a8fc42_other_booking | 404 | PASS |
| domain.event_genix.customers.foreign_write | owner | event_genix | PUT | /api/customers/2 | 404 | PASS |
| domain.event_genix.customers.foreign_write | owner | event_genix | PUT | /api/customers/3 | 404 | PASS |
| domain.event_genix.leads.foreign_write | owner | event_genix | PATCH | /api/leads/2 | 404 | PASS |
| domain.event_genix.leads.foreign_write | owner | event_genix | PATCH | /api/leads/3 | 404 | PASS |
| domain.event_genix.tasks.foreign_write | owner | event_genix | PUT | /api/tasks/2 | 404 | PASS |
| domain.event_genix.tasks.foreign_write | owner | event_genix | PUT | /api/tasks/3 | 404 | PASS |
| domain.event_genix.finance.foreign_write | owner | event_genix | PUT | /api/finance/transactions/2 | 404 | PASS |
| domain.event_genix.finance.foreign_write | owner | event_genix | PUT | /api/finance/transactions/3 | 404 | PASS |
| domain.event_genix.warehouse.foreign_write | owner | event_genix | PUT | /api/warehouse/4 | 404 | PASS |
| domain.event_genix.warehouse.foreign_write | owner | event_genix | PUT | /api/warehouse/5 | 404 | PASS |
| domain.event_genix.products.foreign_write | owner | event_genix | PUT | /api/products/d06_2fc0a8fc42_dar_product | 404 | PASS |
| domain.event_genix.products.foreign_write | owner | event_genix | PUT | /api/products/d06_2fc0a8fc42_other_product | 404 | PASS |
| domain.event_genix.graduation.foreign_write | owner | event_genix | PUT | /api/graduation/quotes/2 | 404 | PASS |
| domain.event_genix.graduation.foreign_write | owner | event_genix | PUT | /api/graduation/quotes/3 | 404 | PASS |
| domain.dar.bookings.foreign_write | owner | dar | PUT | /api/bookings/d06_2fc0a8fc42_park_booking | 404 | PASS |
| domain.dar.bookings.foreign_write | owner | dar | PUT | /api/bookings/d06_2fc0a8fc42_other_booking | 404 | PASS |
| domain.dar.customers.foreign_write | owner | dar | PUT | /api/customers/1 | 404 | PASS |
| domain.dar.customers.foreign_write | owner | dar | PUT | /api/customers/3 | 404 | PASS |
| domain.dar.leads.foreign_write | owner | dar | PATCH | /api/leads/1 | 404 | PASS |
| domain.dar.leads.foreign_write | owner | dar | PATCH | /api/leads/3 | 404 | PASS |
| domain.dar.tasks.foreign_write | owner | dar | PUT | /api/tasks/1 | 404 | PASS |
| domain.dar.tasks.foreign_write | owner | dar | PUT | /api/tasks/3 | 404 | PASS |
| domain.dar.finance.foreign_write | owner | dar | PUT | /api/finance/transactions/1 | 404 | PASS |
| domain.dar.finance.foreign_write | owner | dar | PUT | /api/finance/transactions/3 | 404 | PASS |
| domain.dar.warehouse.foreign_write | owner | dar | PUT | /api/warehouse/3 | 404 | PASS |
| domain.dar.warehouse.foreign_write | owner | dar | PUT | /api/warehouse/5 | 404 | PASS |
| domain.dar.products.foreign_write | owner | dar | PUT | /api/products/d06_2fc0a8fc42_park_product | 404 | PASS |
| domain.dar.products.foreign_write | owner | dar | PUT | /api/products/d06_2fc0a8fc42_other_product | 404 | PASS |
| domain.dar.graduation.foreign_write | owner | dar | PUT | /api/graduation/quotes/1 | 404 | PASS |
| domain.dar.graduation.foreign_write | owner | dar | PUT | /api/graduation/quotes/3 | 404 | PASS |
| domain.event_genix.products.create | owner | event_genix | POST | /api/products | 201 | PASS |
| domain.event_genix.products.create | owner | event_genix | GET | /api/products/n6p_1789241607864 | 200 | PASS |
| domain.event_genix.tasks.priority | owner | event_genix | PATCH | /api/tasks/1/priority | 200 | PASS |
| domain.event_genix.customers.create | owner | event_genix | POST | /api/customers | 200 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 201 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.finance.own_and_foreign_references | owner | event_genix | POST | /api/finance/transactions | 400 | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH | /api/leads/1 | 200 | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH | /api/leads/1 | 404 | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH | /api/leads/1 | 404 | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH | /api/leads/1 | 404 | PASS |
| domain.event_genix.leads.foreign_references | owner | event_genix | PATCH | /api/leads/1 | 404 | PASS |
| domain.event_genix.warehouse.foreign_location | owner | event_genix | POST | /api/warehouse | 201 | PASS |
| domain.event_genix.warehouse.foreign_location | owner | event_genix | POST | /api/warehouse | 400 | PASS |
| domain.event_genix.warehouse.foreign_location | owner | event_genix | POST | /api/warehouse | 400 | PASS |
| domain.dar.products.create | owner | dar | POST | /api/products | 201 | PASS |
| domain.dar.products.create | owner | dar | GET | /api/products/n6d_1789241608267 | 200 | PASS |
| domain.dar.tasks.priority | owner | dar | PATCH | /api/tasks/2/priority | 200 | PASS |
| domain.dar.customers.create | owner | dar | POST | /api/customers | 200 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 201 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.finance.own_and_foreign_references | owner | dar | POST | /api/finance/transactions | 400 | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH | /api/leads/2 | 200 | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH | /api/leads/2 | 404 | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH | /api/leads/2 | 404 | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH | /api/leads/2 | 404 | PASS |
| domain.dar.leads.foreign_references | owner | dar | PATCH | /api/leads/2 | 404 | PASS |
| domain.dar.warehouse.foreign_location | owner | dar | POST | /api/warehouse | 201 | PASS |
| domain.dar.warehouse.foreign_location | owner | dar | POST | /api/warehouse | 400 | PASS |
| domain.dar.warehouse.foreign_location | owner | dar | POST | /api/warehouse | 400 | PASS |
| domain.d06_other.products.create | otherOrg | d06_other | POST | /api/products | 201 | PASS |
| domain.d06_other.products.create | otherOrg | d06_other | GET | /api/products/n6o_1789241608606 | 200 | PASS |
| domain.d06_other.tasks.priority | otherOrg | d06_other | PATCH | /api/tasks/3/priority | 200 | PASS |
| domain.d06_other.customers.create | otherOrg | d06_other | POST | /api/customers | 200 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 201 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.finance.own_and_foreign_references | otherOrg | d06_other | POST | /api/finance/transactions | 400 | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH | /api/leads/3 | 200 | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH | /api/leads/3 | 404 | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH | /api/leads/3 | 404 | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH | /api/leads/3 | 404 | PASS |
| domain.d06_other.leads.foreign_references | otherOrg | d06_other | PATCH | /api/leads/3 | 404 | PASS |
| domain.d06_other.warehouse.foreign_location | otherOrg | d06_other | POST | /api/warehouse | 201 | PASS |
| domain.d06_other.warehouse.foreign_location | otherOrg | d06_other | POST | /api/warehouse | 400 | PASS |
| domain.d06_other.warehouse.foreign_location | otherOrg | d06_other | POST | /api/warehouse | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.event_genix.graduation.foreign_references | owner | event_genix | PUT | /api/graduation/quotes/1 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| domain.dar.graduation.foreign_references | owner | dar | PUT | /api/graduation/quotes/2 | 400 | PASS |
| aggregate.customers.same_org | owner | event_genix | GET | /api/customers?limit=100&businessScope=multi&businessContexts=event_genix%2Cdar | 200 | PASS |
| aggregate.leads.same_org | owner | event_genix | GET | /api/leads?limit=100&businessScope=multi&businessContexts=event_genix%2Cdar | 200 | PASS |
| aggregate.tasks.same_org | owner | event_genix | GET | /api/tasks?date=2026-09-16&limit=100&businessScope=multi&businessContexts=event_genix%2Cdar | 200 | PASS |
| aggregate.products.same_org | owner | event_genix | GET | /api/products?businessScope=multi&businessContexts=event_genix%2Cdar | 200 | PASS |
| aggregate.permissions_and_organizations | worker | event_genix | GET | /api/products?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | PASS |
| aggregate.permissions_and_organizations | multiOrg | event_genix | GET | /api/products?businessScope=multi&businessContexts=event_genix,d06_other | 403 | PASS |
| aggregate.write.POST | owner | event_genix | POST | /api/customers?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | PASS |
| aggregate.write.PUT | owner | event_genix | PUT | /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | PASS |
| aggregate.write.PATCH | owner | event_genix | PATCH | /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | PASS |
| aggregate.write.DELETE | owner | event_genix | DELETE | /api/customers/1?businessScope=multi&businessContexts=event_genix%2Cdar | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/bookings/2026-09-16 | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/timeline/resources?type=cabinet | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/customers?limit=100 | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/leads?limit=100 | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/tasks?date=2026-09-16&limit=100 | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/finance/transactions?from=2026-09-16&to=2026-09-16&limit=200 | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/warehouse | 403 | PASS |
| auth.explicit_foreign_context | owner | d06_other | GET | /api/products | 403 | PASS |
| auth.default_and_role_isolation | worker | event_genix | GET | /api/auth/business-profile | 200 | PASS |
| auth.default_and_role_isolation | worker | dar | GET | /api/auth/business-profile | 200 | PASS |
| auth.default_and_role_isolation | worker | event_genix | GET | /api/finance/accounts | 200 | PASS |
| auth.default_and_role_isolation | worker | dar | GET | /api/finance/accounts | 403 | PASS |
| auth.default_and_role_isolation | owner |  | GET | /api/auth/business-profile | 200 | PASS |
| auth.default_and_role_isolation | otherOrg |  | GET | /api/auth/business-profile | 200 | PASS |
| lifecycle.last_owner | owner | event_genix | PUT | /api/organizations/1/members/5 | 409 | PASS |
| lifecycle.management_boundaries | worker | event_genix | PUT | /api/organizations/1/members/7 | 403 | PASS |
| lifecycle.management_boundaries | owner | event_genix | PATCH | /api/organizations/businesses/3/configuration | 403 | PASS |
| lifecycle.management_boundaries | admin | event_genix | POST | /api/organizations/1/businesses | 403 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | POST | /api/organizations/1/businesses | 201 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | PUT | /api/organizations/1/members/5 | 200 | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET | /api/products | 403 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | PATCH | /api/organizations/businesses/4/configuration | 200 | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET | /api/auth/business-profile | 200 | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET | /api/products | 200 | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET | /api/timeline/resources | 200 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | POST | /api/organizations/businesses/4/initialize-resources | 200 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | POST | /api/organizations/businesses/4/initialize-resources | 200 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | PATCH | /api/organizations/businesses/4/configuration | 400 | PASS |
| lifecycle.owner_custom_business | owner | event_genix | PATCH | /api/organizations/businesses/4 | 200 | PASS |
| lifecycle.owner_custom_business | owner | d06_2fc0a8fc42_cabinet | GET | /api/products | 403 | PASS |
| containment.event_genix.catalogs_not_migrated.read | owner | event_genix | GET | /api/catalogs | 403 | PASS |
| containment.event_genix.booking_templates_not_migrated.read | owner | event_genix | GET | /api/booking-templates | 403 | PASS |
| containment.event_genix.recurring_not_migrated.read | owner | event_genix | GET | /api/recurring | 403 | PASS |
| containment.event_genix.warehouse_photo_intake_not_migrated.status | owner | event_genix | GET | /api/warehouse/photo-intake/status | 403 | PASS |
| containment.event_genix.warehouse_photo_intake_not_migrated.read | owner | event_genix | GET | /api/warehouse/photo-intake | 403 | PASS |
| containment.event_genix.chat_not_migrated.read | owner | event_genix | GET | /api/chat/channels | 403 | PASS |
| containment.event_genix.kleshnya_not_migrated.read | owner | event_genix | GET | /api/kleshnya/sessions | 403 | PASS |
| containment.event_genix.finance_salary_not_migrated.read | owner | event_genix | GET | /api/finance/report/salary | 403 | PASS |
| containment.dar.catalogs_not_migrated.read | owner | dar | GET | /api/catalogs | 403 | PASS |
| containment.dar.booking_templates_not_migrated.read | owner | dar | GET | /api/booking-templates | 403 | PASS |
| containment.dar.recurring_not_migrated.read | owner | dar | GET | /api/recurring | 403 | PASS |
| containment.dar.warehouse_photo_intake_not_migrated.status | owner | dar | GET | /api/warehouse/photo-intake/status | 403 | PASS |
| containment.dar.warehouse_photo_intake_not_migrated.read | owner | dar | GET | /api/warehouse/photo-intake | 403 | PASS |
| containment.dar.chat_not_migrated.read | owner | dar | GET | /api/chat/channels | 403 | PASS |
| containment.dar.kleshnya_not_migrated.read | owner | dar | GET | /api/kleshnya/sessions | 403 | PASS |
| containment.dar.finance_salary_not_migrated.read | owner | dar | GET | /api/finance/report/salary | 403 | PASS |
| containment.d06_other.catalogs_not_migrated.read | otherOrg | d06_other | GET | /api/catalogs | 403 | PASS |
| containment.d06_other.booking_templates_not_migrated.read | otherOrg | d06_other | GET | /api/booking-templates | 403 | PASS |
| containment.d06_other.recurring_not_migrated.read | otherOrg | d06_other | GET | /api/recurring | 403 | PASS |
| containment.d06_other.warehouse_photo_intake_not_migrated.status | otherOrg | d06_other | GET | /api/warehouse/photo-intake/status | 403 | PASS |
| containment.d06_other.warehouse_photo_intake_not_migrated.read | otherOrg | d06_other | GET | /api/warehouse/photo-intake | 403 | PASS |
| containment.d06_other.chat_not_migrated.read | otherOrg | d06_other | GET | /api/chat/channels | 403 | PASS |
| containment.d06_other.kleshnya_not_migrated.read | otherOrg | d06_other | GET | /api/kleshnya/sessions | 403 | PASS |
| containment.d06_other.finance_salary_not_migrated.read | otherOrg | d06_other | GET | /api/finance/report/salary | 403 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/finance/accounts | 200 | PASS |
| auth.same_jwt_role_and_revoke | owner | event_genix | PUT | /api/organizations/1/members/9 | 200 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/finance/accounts | 403 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/auth/business-profile | 200 | PASS |
| auth.same_jwt_role_and_revoke | owner | event_genix | DELETE | /api/organizations/1/members/9/1 | 200 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/products | 403 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/auth/business-profile | 403 | PASS |
| auth.same_jwt_role_and_revoke | owner | event_genix | PUT | /api/organizations/1/members/9 | 200 | PASS |
| auth.same_jwt_role_and_revoke | same_jwt_snapshot | event_genix | GET | /api/finance/accounts | 200 | PASS |
| enabled_extra.event_genix.dashboard.tasks | owner | event_genix | GET | /api/dashboard/widgets/tasks | 200 | PASS |
| enabled_extra.event_genix.dashboard.leads_new | owner | event_genix | GET | /api/dashboard/widgets/leads_new | 200 | PASS |
| enabled_extra.event_genix.settings.cabinet | owner | event_genix | GET | /api/business/cabinet | 200 | PASS |
| enabled_extra.event_genix.settings.timeline_display | owner | event_genix | GET | /api/settings/timeline-display | 200 | PASS |
| enabled_extra.event_genix.omni.list | owner | event_genix | GET | /api/omni/conversations?limit=100 | 200 | PASS |
| enabled_extra.event_genix.omni.context | owner | event_genix | GET | /api/omni/conversations/1/context | 200 | PASS |
| enabled_extra.event_genix.omni.context | owner | event_genix | GET | /api/omni/conversations/2/context | 404 | PASS |
| enabled_extra.event_genix.omni.context | owner | event_genix | GET | /api/omni/conversations/3/context | 404 | PASS |
| enabled_extra.event_genix.omni.messages | owner | event_genix | GET | /api/omni/conversations/1/messages | 200 | PASS |
| enabled_extra.event_genix.omni.messages | owner | event_genix | GET | /api/omni/conversations/2/messages | 200 | PASS |
| enabled_extra.event_genix.omni.messages | owner | event_genix | GET | /api/omni/conversations/3/messages | 200 | PASS |
| enabled_extra.dar.dashboard.tasks | owner | dar | GET | /api/dashboard/widgets/tasks | 200 | PASS |
| enabled_extra.dar.dashboard.leads_new | owner | dar | GET | /api/dashboard/widgets/leads_new | 200 | PASS |
| enabled_extra.dar.settings.cabinet | owner | dar | GET | /api/business/cabinet | 200 | PASS |
| enabled_extra.dar.settings.timeline_display | owner | dar | GET | /api/settings/timeline-display | 200 | PASS |
| enabled_extra.dar.omni.list | owner | dar | GET | /api/omni/conversations?limit=100 | 200 | PASS |
| enabled_extra.dar.omni.context | owner | dar | GET | /api/omni/conversations/2/context | 200 | PASS |
| enabled_extra.dar.omni.context | owner | dar | GET | /api/omni/conversations/1/context | 404 | PASS |
| enabled_extra.dar.omni.context | owner | dar | GET | /api/omni/conversations/3/context | 404 | PASS |
| enabled_extra.dar.omni.messages | owner | dar | GET | /api/omni/conversations/2/messages | 200 | PASS |
| enabled_extra.dar.omni.messages | owner | dar | GET | /api/omni/conversations/1/messages | 200 | PASS |
| enabled_extra.dar.omni.messages | owner | dar | GET | /api/omni/conversations/3/messages | 200 | PASS |
| enabled_extra.d06_other.dashboard.tasks | otherOrg | d06_other | GET | /api/dashboard/widgets/tasks | 200 | PASS |
| enabled_extra.d06_other.dashboard.leads_new | otherOrg | d06_other | GET | /api/dashboard/widgets/leads_new | 200 | PASS |
| enabled_extra.d06_other.settings.cabinet | otherOrg | d06_other | GET | /api/business/cabinet | 200 | PASS |
| enabled_extra.d06_other.settings.timeline_display | otherOrg | d06_other | GET | /api/settings/timeline-display | 200 | PASS |
| enabled_extra.d06_other.omni.list | otherOrg | d06_other | GET | /api/omni/conversations?limit=100 | 200 | PASS |
| enabled_extra.d06_other.omni.context | otherOrg | d06_other | GET | /api/omni/conversations/3/context | 200 | PASS |
| enabled_extra.d06_other.omni.context | otherOrg | d06_other | GET | /api/omni/conversations/1/context | 404 | PASS |
| enabled_extra.d06_other.omni.context | otherOrg | d06_other | GET | /api/omni/conversations/2/context | 404 | PASS |
| enabled_extra.d06_other.omni.messages | otherOrg | d06_other | GET | /api/omni/conversations/3/messages | 200 | PASS |
| enabled_extra.d06_other.omni.messages | otherOrg | d06_other | GET | /api/omni/conversations/1/messages | 200 | PASS |
| enabled_extra.d06_other.omni.messages | otherOrg | d06_other | GET | /api/omni/conversations/2/messages | 200 | PASS |
| enabled_extra.dashboard.inaccessible_organization | otherOrg | event_genix | GET | /api/dashboard/widgets/tasks | 403 | PASS |
| enabled_extra.dashboard.inaccessible_organization | owner | d06_other | GET | /api/dashboard/widgets/tasks | 403 | PASS |
| enabled_extra.dashboard.inaccessible_organization | otherOrg | event_genix | GET | /api/dashboard/widgets/leads_new | 403 | PASS |
| enabled_extra.dashboard.inaccessible_organization | owner | d06_other | GET | /api/dashboard/widgets/leads_new | 403 | PASS |
| enabled_extra.settings.inaccessible_organization | otherOrg | event_genix | GET | /api/business/cabinet | 403 | PASS |
| enabled_extra.settings.inaccessible_organization | owner | d06_other | GET | /api/business/cabinet | 403 | PASS |
| enabled_extra.settings.inaccessible_organization | otherOrg | event_genix | GET | /api/settings/timeline-display | 403 | PASS |
| enabled_extra.settings.inaccessible_organization | owner | d06_other | GET | /api/settings/timeline-display | 403 | PASS |
| enabled_extra.omni.inaccessible_organization | otherOrg | event_genix | GET | /api/omni/conversations | 403 | PASS |
| enabled_extra.omni.inaccessible_organization | owner | d06_other | GET | /api/omni/conversations | 403 | PASS |
| enabled_extra.omni.inaccessible_organization | otherOrg | event_genix | GET | /api/omni/conversations/1/context | 403 | PASS |
| enabled_extra.omni.inaccessible_organization | owner | d06_other | GET | /api/omni/conversations/1/context | 403 | PASS |
| warehouse_residual.event_genix.contractors.unassigned_list | owner | event_genix | GET | /api/contractors | 200 | FAIL |
| warehouse_residual.event_genix.procurement.unassigned_list | owner | event_genix | GET | /api/procurement | 200 | FAIL |
| warehouse_residual.dar.contractors.unassigned_list | owner | dar | GET | /api/contractors | 200 | FAIL |
| warehouse_residual.dar.procurement.unassigned_list | owner | dar | GET | /api/procurement | 200 | FAIL |
| warehouse_residual.d06_other.contractors.unassigned_list | otherOrg | d06_other | GET | /api/contractors | 200 | FAIL |
| warehouse_residual.d06_other.procurement.unassigned_list | otherOrg | d06_other | GET | /api/procurement | 200 | FAIL |
| warehouse_residual.dar.event_genix.direct_stock | owner | dar | GET | /api/contractors/2/order-context?stockItemId=3 | 200 | FAIL |
| warehouse_residual.dar.event_genix.procurement_stock | owner | dar | GET | /api/contractors/2/order-context?procurementItemId=1 | 200 | FAIL |
| warehouse_residual.d06_other.event_genix.direct_stock | otherOrg | d06_other | GET | /api/contractors/2/order-context?stockItemId=3 | 200 | FAIL |
| warehouse_residual.d06_other.event_genix.procurement_stock | otherOrg | d06_other | GET | /api/contractors/2/order-context?procurementItemId=1 | 200 | FAIL |
| warehouse_residual.event_genix.dar.direct_stock | owner | event_genix | GET | /api/contractors/3/order-context?stockItemId=4 | 200 | FAIL |
| warehouse_residual.event_genix.dar.procurement_stock | owner | event_genix | GET | /api/contractors/3/order-context?procurementItemId=2 | 200 | FAIL |
| warehouse_residual.d06_other.dar.direct_stock | otherOrg | d06_other | GET | /api/contractors/3/order-context?stockItemId=4 | 200 | FAIL |
| warehouse_residual.d06_other.dar.procurement_stock | otherOrg | d06_other | GET | /api/contractors/3/order-context?procurementItemId=2 | 200 | FAIL |
