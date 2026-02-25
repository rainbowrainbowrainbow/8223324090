---
name: version-bump
description: Bump the project version following the 5-step versioning workflow
user_invocable: true
args:
  - name: version
    description: "New version number (e.g. 4.15)"
    required: true
---

# Version Bump

Bump the project version to `{{version}}` following the 5-step versioning workflow from CLAUDE.md.

## Steps (all 5 are required):

1. **package.json** — Update the `"version"` field to `{{version}}`

2. **index.html CSS/JS tags** — Update ALL `?v=X.XX` query strings on CSS and JS `<link>` / `<script>` tags to `?v={{version}}`

3. **index.html tagline** — Update the tagline text that displays the version

4. **index.html changelog button** — Update the changelog button text to show the new version

5. **index.html changelog modal** — Add a new changelog entry in the modal for version `{{version}}`

After all 5 steps, show a summary of all changes made.
