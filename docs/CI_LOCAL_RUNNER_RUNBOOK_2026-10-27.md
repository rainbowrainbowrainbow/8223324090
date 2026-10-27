# Isolated local CI worker — 2026-10-27

Status: implementation under verification; a prepared script is not a passing CI run.

## Purpose and delivery boundary

Run the existing Linux/Docker checks without GitHub-hosted compute or new GitHub artifact storage. The repository remains private. This setup does not change Railway, release guards, billing, application code, database ownership or memberships.

The initial routing is deliberately limited to trusted pushes on `codex/ci-local-runner-20261027`. Other refs retain hosted routing. Moving this policy to another candidate or production requires a reviewed routing change; this feature's green run must not be misreported as green CI for another SHA/ref.

## Host and guest

- Dedicated Hyper-V VM: `EventGenix-CI`; 4 logical CPUs, 8 GiB fixed RAM, 45 GiB dynamic guest disk; automatic VM startup and automatic checkpoints disabled.
- Use the existing Default Switch. No host folder mounts, existing WSL distributions, host Docker socket, production secrets or historical evidence archives are exposed to the guest.
- Ubuntu 24.04 image provenance: official dated cloud image `noble/20261017/noble-server-cloudimg-amd64-azure.vhd.tar.gz`; SHA-256 `cde3ca6a5aabe89702456cc5af69e2336600ce13c18898aba27e7212e3474e3f`.
- Official checksum signature verified against fingerprint `D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81`; preserve private installation receipts.
- This VHD has Azure-only datasource defaults. The new guest disk is explicitly configured for local NoCloud initialization before bootstrap. If offline customization is necessary, verify the exact new VHD and filesystem identity, detach it in `finally`, and never modify existing WSL distribution disks. Do not wait for or imitate production Azure services.
- Official Linux x64 runner 2.338.0; SHA-256 `af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32`; reverify official metadata before a future installation.
- Docker and Node 22/npm 10 run inside the guest. Disposable PostgreSQL only. One job per JIT runner, one guest job at a time. Restore the clean offline checkpoint before every job; never use a previously executed job disk as the next base.

The guest is an isolation measure, not a promise that hostile CI code is safe. Repository runner labels are scheduling labels, not security controls. Never run fork/unreviewed PR code or inject production credentials. A pre-job hook must validate repository, exact SHA, branch, push event, workflow ref, run and attempt before checkout/test steps.

## Evidence gate

All seven original artifact sites keep their names, paths and missing-file policies. Hosted runners continue using `actions/upload-artifact@v7`. The local composite action transports original bytes in a versioned gzip/JSONL bundle; no screenshot resizing, trace filtering, source-inventory reduction or assertion removal.

`scripts/ci-local-evidence.cjs` creates per-file SHA-256/size records and a manifest digest. Hidden files remain excluded as in the existing upload default. Symlinks, path traversal, Windows device/ADS names, case collisions and oversized archives fail closed.

The Windows controller checks the request against the approved GitHub run and active job, retrieves the complete bundle, independently verifies and reconstructs each original file under a new private archive outside Git/Temp, flushes evidence, then signs a receipt. The private signing key never enters the VM. A preservation step waits for the matching signed receipt; timeout, source mismatch, corruption or missing required evidence fails the step. Original GitHub workflow logs remain on GitHub.

Private paths, SSH keys, signing keys, JIT configuration, account credentials and full raw diagnostics must never be committed. Archive manifests and receipts identify Git commits/runs/jobs, not production users or staff. Local evidence is not downloadable as a GitHub artifact; an operator must provide redacted proof or retrieve it from the private host archive for review.

## Operator sequence

1. Verify active bounded setup authorization, Windows servicing complete, exact VM identity and sufficient free disk. Do not automatically reboot or change global networking.
2. Bootstrap the official guest; verify Linux/Node/npm/Docker and public archive-verification key installation. Shut down cleanly and create the one named clean checkpoint.
3. Review only CI/scripts/tests/docs diff; validate YAML and focused transport/controller tests. Commit/push only the feature branch after the environment is ready.
4. Read exact push run identity. Configure the host controller privately with the approved SHA/run, deadline, root and archive directory. Start the exact-VM manager with the same deadline.
5. First run only `Certificate redemption regression`, covering real disposable PostgreSQL/browser behavior and a verified archive. If it fails, keep proof and stop before wider execution.
6. Only after pilot success run all 23 existing jobs sequentially, preserving their names/matrix/assertions. A failed job, missing evidence, quota-dependent dependency, source drift or expiry stops execution.
7. Stop the new guest and confirm no newly registered runner remains. Keep the VM base/checkpoint and all evidence for the next explicitly approved run. Do not clean unrelated VMs, WSL, Docker, historical archives or Git state.

The controller is operator-run, not an automatically installed Windows startup service. Power loss, sleep or shutdown interrupts CI; it does not stop the existing live CRM. Do not silently change the owner's power plan. Disk use must be checked before each run; do not delete evidence automatically when space runs low.

## Verification commands

```text
npm run check:runtime
node --test tests/ci-local-evidence.test.js tests/ci-local-runner-controller.test.js
node --check scripts/ci-local-evidence.cjs
node --check scripts/ci-local-runner-controller.cjs
```

Real workflow verification, pilot result, source SHA, private archive integrity and final runner retirement must be recorded separately after execution. Unit tests alone do not prove VM isolation, JIT registration, a green workflow, or a completed HR release.
