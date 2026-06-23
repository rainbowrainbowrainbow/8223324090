# BUG CUSTOMER CHILDREN 1 - Child Note Low Contrast In Dark Mode

Production impact: yes.

Status: fixed in `css/pages-customers.css` before the `Customer Children Card Fix` release.

## Symptom

In the customer detail card, a child note inside `.customer-child-note` is present but nearly unreadable in dark mode.

## Expected

Child notes should be readable in the dark customer card with sufficient contrast, matching the rest of the children section.

## Actual

The note text appears very dark on the dark `.customer-child-card` background. The data is not lost, but the user can easily miss it.

## Reproduction

1. Open `output/playwright/customer-children-manual-qa/harness.html?case=three`.
2. Check the second child card.
3. The note `без горіхів` is barely visible.
4. Open `output/playwright/customer-children-manual-qa/harness.html?case=long`.
5. The long child note is also low contrast.

## Evidence

- `output/playwright/customer-children-manual-qa/desktop-three-children-full.png`
- `output/playwright/customer-children-manual-qa/desktop-long-contact-full.png`
- `output/playwright/customer-children-manual-qa/narrow-three-children-full.png`

## Likely Cause

`.customer-child-note` has no explicit dark-mode color in `css/pages-customers.css`. It does not inherit the same readable color rules as `.customer-child-facts dd`.

## Suggested Fix Task

Do:
- Add explicit base and dark-mode styles for `.customer-child-note`.
- Use readable muted text color in dark mode, for example `#CBD5E1`.
- Keep wrapping safe with `overflow-wrap: anywhere`.
- Add/update `tests/ui-check.js` guard that `.customer-child-note` has dark-mode coverage.

Acceptance:
- Child notes are readable in dark mode on desktop and narrow width.
- No overlap or clipping in children cards.
- `npm run test:ui` passes.
