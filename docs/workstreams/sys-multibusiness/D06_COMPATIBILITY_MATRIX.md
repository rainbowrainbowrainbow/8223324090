# D06 compatibility matrix

Source: actual local server.js → disposable PostgreSQL → real HTTP/browser. Run: `d06_1789241525527_7d4a50`.

This is local synthetic acceptance, not live QA or production ownership evidence. Exact observations: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json).

Observed synthetic requests do not establish production traffic volume or zero usage. Background jobs were held; provider credentials were not loaded.

```json
{
  "source": "MEASURED_FIXTURE_PROFILE_REQUESTS_ONLY",
  "membershipRequests": 5,
  "compatibilityRequests": 1,
  "failedRequests": 0,
  "runtimeTelemetry": {
    "status": "NOT_AVAILABLE",
    "authoritativeUsage": null,
    "observationWindow": null,
    "coverage": "Profile probes only; API audit excludes reads and ordinary403; no complete mode/ingress counter.",
    "backgroundWorkers": "HELD_BY_PARENT_HARNESS",
    "outboundProviders": "FORBIDDEN",
    "zeroUsageEstablished": false
  }
}
```

Maysternya doli and CRM remain NOT_MIGRATED. Neither compatibility removal nor historical ownership assignment is authorized by these counts.
