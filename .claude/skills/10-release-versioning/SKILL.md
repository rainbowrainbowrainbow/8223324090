# Skill: Release & Versioning

## Description
Manages semantic versioning, changelog generation, release notes, git tags, and deployment workflows for the booking system. Ensures consistent and traceable releases.

## Activation
Use this skill when:
- Preparing a new release
- Updating version numbers
- Writing changelog entries
- Creating git tags
- Publishing release notes
- Setting up CI/CD release pipeline

## Versioning Strategy: Semantic Versioning (SemVer)

```
MAJOR.MINOR.PATCH
  │      │     │
  │      │     └── Bug fixes, patches (no API changes)
  │      └──────── New features (backward compatible)
  └─────────────── Breaking changes
```

### Version Examples for Booking System
```
0.1.0  — MVP: basic event listing + booking form
0.2.0  — Add payment integration (LiqPay)
0.3.0  — Add Telegram bot
0.4.0  — Add admin panel
0.5.0  — Add notification system
1.0.0  — Production-ready release
1.1.0  — Add promo codes
1.1.1  — Fix booking capacity calculation bug
1.2.0  — Add CSV export
2.0.0  — API v2 (breaking changes)
```

## Changelog Format (Keep a Changelog)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Promo code system with discount tracking

### Fixed
- Hold expiry not triggering for UTC+2 timezone

## [1.0.0] - 2025-07-01

### Added
- Event management (CRUD) with admin panel
- Booking workflow with state machine (draft → hold → confirmed → paid → completed)
- Client management with CRM features
- Telegram bot integration (client commands + manager notifications)
- LiqPay payment integration with deposit system
- Email + Telegram notification orchestrator with templates
- Admin dashboard with KPI metrics
- CSV/Excel export for bookings
- Playwright E2E test suite
- Lighthouse performance monitoring

### Security
- JWT authentication with role-based access control
- LiqPay webhook signature verification
- Rate limiting on public endpoints
- Input sanitization for all forms

## [0.5.0] - 2025-06-15

### Added
- Notification system with Telegram + Email channels
- Scheduled reminders (24h, 3h before event)
- Manager daily summary reports
- Notification retry with exponential backoff

### Changed
- Booking confirmation now requires deposit payment
- Default hold time increased from 15 to 30 minutes

### Fixed
- Duplicate booking prevention for same client + event
- Phone number normalization for Ukrainian formats
```

## Release Process

### Step-by-step

```bash
# 1. Ensure you're on main/develop and up to date
git checkout main && git pull origin main

# 2. Run all checks
npm run lint
npm run typecheck
npm run test
npm run test:e2e

# 3. Update version
npm version minor  # or major / patch
# This automatically:
# - Updates package.json version
# - Creates git commit "vX.Y.Z"
# - Creates git tag "vX.Y.Z"

# 4. Update CHANGELOG.md
# Move items from [Unreleased] to new version section
# Add date

# 5. Amend commit with changelog
git add CHANGELOG.md
git commit --amend --no-edit

# 6. Push with tags
git push origin main --follow-tags

# 7. Create GitHub Release
gh release create v1.0.0 \
  --title "v1.0.0 — Production Release" \
  --notes-file release-notes.md
```

### Automated Release Script

```typescript
// scripts/release.ts
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const RELEASE_TYPE = process.argv[2]; // major | minor | patch
if (!['major', 'minor', 'patch'].includes(RELEASE_TYPE)) {
  console.error('Usage: npx ts-node scripts/release.ts <major|minor|patch>');
  process.exit(1);
}

// 1. Check clean working directory
const status = execSync('git status --porcelain').toString().trim();
if (status) {
  console.error('Working directory is not clean. Commit or stash changes first.');
  process.exit(1);
}

// 2. Run tests
console.log('Running tests...');
execSync('npm run test', { stdio: 'inherit' });
execSync('npm run lint', { stdio: 'inherit' });

// 3. Bump version
console.log(`Bumping ${RELEASE_TYPE} version...`);
execSync(`npm version ${RELEASE_TYPE} --no-git-tag-version`);

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;
const date = new Date().toISOString().split('T')[0];

// 4. Update CHANGELOG
console.log('Updating CHANGELOG...');
let changelog = readFileSync('CHANGELOG.md', 'utf-8');
changelog = changelog.replace(
  '## [Unreleased]',
  `## [Unreleased]\n\n## [${version}] - ${date}`
);
writeFileSync('CHANGELOG.md', changelog);

// 5. Commit and tag
execSync(`git add -A`);
execSync(`git commit -m "release: ${tag}"`);
execSync(`git tag -a ${tag} -m "Release ${tag}"`);

// 6. Push
execSync('git push origin main --follow-tags');

// 7. Create GitHub release
console.log('Creating GitHub release...');
execSync(`gh release create ${tag} --title "${tag}" --generate-notes`);

console.log(`✅ Released ${tag}`);
```

## Git Branch Strategy

```
main (production)
  │
  ├── develop (staging)
  │     │
  │     ├── feature/booking-promo-codes
  │     ├── feature/telegram-inline-mode
  │     ├── fix/hold-expiry-timezone
  │     └── chore/update-dependencies
  │
  └── hotfix/critical-payment-bug (branches from main)
```

### Branch Naming
```
feature/<short-description>   # New features
fix/<short-description>        # Bug fixes
hotfix/<short-description>     # Critical production fixes
chore/<short-description>      # Maintenance, deps, configs
docs/<short-description>       # Documentation only
refactor/<short-description>   # Code refactoring
```

## Commit Message Convention (Conventional Commits)

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types
| Type | When |
|------|------|
| feat | New feature |
| fix | Bug fix |
| docs | Documentation |
| style | Formatting (no logic change) |
| refactor | Code refactoring |
| perf | Performance improvement |
| test | Adding/fixing tests |
| chore | Maintenance, deps, build |
| ci | CI/CD changes |
| revert | Reverting a commit |

### Scopes (for booking system)
```
booking, event, client, payment, notification,
telegram, admin, auth, api, db, seo, e2e, config
```

### Examples
```
feat(booking): add promo code validation to booking form
fix(notification): correct timezone offset for scheduled reminders
perf(seo): add WebP images with lazy loading
chore(deps): update prisma to v5.x
test(e2e): add mobile booking flow tests
docs(api): update OpenAPI spec for v1.2
```

## GitHub Actions Release Workflow

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - run: npm ci
      - run: npm run build
      - run: npm run test

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

      - name: Deploy to production
        run: |
          # Your deployment command
          echo "Deploying ${{ github.ref_name }}..."
```
