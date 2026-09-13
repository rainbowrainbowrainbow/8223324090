# Vitalina Test PIN V1 Integration

Integrated local PIN diff on `1e1f0915e9ea4dba91a25bd450b1f7939fdcf990` (`codex/eventgenix-production`, v0.81.148).

Source reviewed: `codex/vitalina-test-pin-manage-20260912`.
The delivered PARK/DAR PIN and service-out package is already contained in the base. Its later uncommitted discount changes were excluded because they have no matching handoff and are outside this task.

The integrated work adds the narrow delegable `fiscal.test.pin.manage` permission, server-verified shared-test PIN enrollment, self-only PIN verification, PIN-only test-route state, stale readiness protection, and matching permission/route contracts.

No production write, commit, push, deploy, production cashier configuration, or live PIN operation was performed.

Remaining: V2 negative/concurrency PIN coverage, V3 live test-register readiness/history QA, then V4 delivery and separately approved permission activation.
