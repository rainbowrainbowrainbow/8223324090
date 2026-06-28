# Local Runtime Setup

Event Genix verification is representative only on Node 22.x with npm 10.x.
The pins live in `package.json` `engines`, `.nvmrc`, and `.node-version`.

## Check The Active Runtime

```bash
npm run check:runtime
```

Expected result:

```text
Runtime baseline check passed: Node 22.x / npm 10.x.
```

If this fails because your host shell is on another Node or npm major, do not
trust direct `npm test`, install, build, or deploy results from that shell.

## Run Commands Through The Canonical Runtime

Use `npx` to run the same repo commands under Node 22/npm 10:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Use the same wrapper for focused checks:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "node --test tests/<file>.test.js"
```

## What Not To Do

- Do not report Node 18, Node 20, Node 24, or npm 11 results as representative.
- Do not change runtime pins as part of product work.
- Do not add toolchain managers or dependency changes without explicit
  confirmation.

## When To Use Full Baseline

Run the full baseline after non-trivial code changes, release-marker changes,
or shared surface changes:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```
