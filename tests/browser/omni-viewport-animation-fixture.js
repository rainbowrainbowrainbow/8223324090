'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkViewportAnimation(page, outputDir) {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('body.shell-ready .omni-workspace-shell').waitFor({ state: 'visible' });
    const measurements = await page.evaluate(async () => {
        const main = document.getElementById('mainContent');
        const shell = document.querySelector('.omni-workspace-shell');
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const snapshot = () => ({
            shell: shell.getBoundingClientRect().toJSON(),
            main: main.getBoundingClientRect().toJSON(),
            layoutHeight: main.clientHeight,
            transform: getComputedStyle(main).transform,
            assignedHeight: shell.style.getPropertyValue('--omni-shell-height'),
            viewport: { width: innerWidth, height: innerHeight }
        });
        const results = [];
        for (let cycle = 0; cycle < 3; cycle++) {
            // Restart the real shared-shell CSS animation, then let the actual
            // viewport and ResizeObserver handlers measure its overshoot frame.
            main.style.animationName = 'none';
            void main.offsetHeight;
            main.style.removeProperty('animation-name');
            const entrance = main.getAnimations({ subtree: false }).find(animation => animation.animationName === 'ptBounceIn');
            if (!entrance) throw new Error('Expected the real system-shell entrance animation');
            entrance.pause();
            entrance.currentTime = entrance.effect.getComputedTiming().duration * 0.6;
            window.dispatchEvent(new Event('resize'));
            await frame();
            const during = snapshot();
            entrance.finish();
            await entrance.finished;
            await frame();
            results.push({ cycle, during, after: snapshot() });
        }
        return results;
    });
    fs.writeFileSync(path.join(outputDir, 'viewport-animation-report.json'), JSON.stringify(measurements, null, 2));
    await page.screenshot({ path: path.join(outputDir, 'viewport-animation-320x640.png') });
    for (const { during, after } of measurements) {
        assert.notEqual(during.transform, 'none', 'the fixture must measure the scaled animation frame');
        assert.ok(after.shell.bottom <= after.viewport.height + 2,
            `animation completion must reconcile the viewport height: ${JSON.stringify({ during, after })}`);
        assert.ok(after.shell.height >= after.viewport.height - after.shell.top - 2,
            'the completed animation must not leave an undersized workspace');
    }
    return { viewport: [320, 640], cycles: measurements.length, measurements };
};
