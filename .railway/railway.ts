import { defineRailway, project, service } from "railway/iac";

// This isolated worker tree must never be deployed as the main CRM.
export const partial = "eg-tasker-outbox-readonly";

export default defineRailway((ctx) => {
    if (ctx.projectId !== "bc28b46c-d4bc-491c-893a-d8401c633668"
        || ctx.environmentId !== "d9f9b984-d54d-4620-a8bf-c48882ad5158") {
        throw new Error("Only the existing production outbox observer may be managed.");
    }
    if (!ctx.features?.includes("variables-policy")) {
        throw new Error("Use the reviewed Railway CLI with variables-policy support.");
    }

    return project("fortunate-appreciation", {
        // Never read, adopt, clear, or write service variables through this file.
        variables: { managed: false },
        resources: [service("eg-tasker-outbox-readonly", {
            build: { builder: "NIXPACKS" },
            deploy: {
                startCommand: "npm run hermes:outbox:worker -- --mode=read_only_loop --include-stats=1 --batch-enabled=1 --batch-owner-ids=4 --active-owner-ids=4",
                restartPolicyType: "ON_FAILURE",
                restartPolicyMaxRetries: 3,
            },
        })],
    });
});
