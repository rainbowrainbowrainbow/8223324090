# Omni browser QA

Run the deterministic interaction and screenshot suite with:

```sh
npm run test:browser:omni
```

It uses synthetic conversations, a fixed browser clock, loaded Inter fonts, real
clicks, and JavaScript. It does not use production credentials, provider APIs, or
real customer data. Screenshots, layout measurements, the JSON run report, the
visual acceptance matrix, and the Playwright trace are written to
`output/playwright/omni-completion/`.

Run native browser zoom separately with:

```sh
npm run test:browser:omni:zoom
```

The zoom check launches a disposable Chromium profile and uses
`chrome.tabs.setZoom()` at 100%, 125%, and 150% for 1366x768 and 1024x600 browser
windows. Its effective viewport measurements are stored in `native-zoom.json`.
CSS scale, `deviceScaleFactor`, and viewport resizing are not substitutes for
this command.

The compact visual acceptance matrix covers:

- desktop list in dark theme;
- desktop conversation in light theme;
- expanded filters at 1024x600;
- mobile list in light theme;
- mobile conversation with a long name, multiline draft, attachment, and delivery error;
- the mobile additional-actions menu.

Review every `visual-*.png` after a UI change. Check typography, spacing,
overlaps, active states, usable history area, composer/actions, and duplicated
service information. Automated geometry checks and a newly generated screenshot
do not constitute visual approval. Record what was automatically checked,
visually reviewed, and not checked in the task report.
