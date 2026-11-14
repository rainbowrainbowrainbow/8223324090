'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cli = process.argv.find(arg => /@playwright[\\/]test[\\/]cli\.js$/i.test(arg));
function playwrightTest() {
    if (cli) return require(path.dirname(cli));
    const entry = require.main?.filename || process.argv[1] || '';
    const marker = `${path.sep}node_modules${path.sep}playwright${path.sep}`;
    const index = entry.indexOf(marker);
    if (index >= 0) return require(path.join(entry.slice(0,index), 'node_modules/@playwright/test'));
    return require('@playwright/test');
}
const { test, expect } = playwrightTest();
const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(root,'js/telegram-crm-profile.js'),'utf8');
const css = fs.readFileSync(path.join(root,'css/telegram-crm-profile.css'),'utf8');

async function setup(page, { mobile=false, disabled=false, connected=false, botUsername='d1wdd_bot' } = {}) {
    if (mobile) await page.setViewportSize({width:375,height:812});
    let status = connected ? 'connected' : 'preassigned', claimed = false;
    const calls = [];
    await page.route('https://fixture.example/**', async route => {
        const url = new URL(route.request().url());
        if (!url.pathname.startsWith('/api/')) return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="uk"><head><title>Telegram CRM profile fixture</title></head><body><main><section id="panel" data-telegram-crm-profile></section></main></body></html>'});
        const body = route.request().postDataJSON(); calls.push({path:url.pathname,body});
        const result = {success:true};
        if (url.pathname.endsWith('/link')) {
            if (status === 'connected' && body.password !== 'fixture-password') return route.fulfill({status:401,json:{success:false,code:'TELEGRAM_REAUTH_REQUIRED',error:'Підтвердьте поточний пароль CRM.'}});
            Object.assign(result,{requestId:'f8324453-fdc3-4b5d-b92b-4f7f98baafbb',browserProof:'q'.repeat(43),url:'https://t.me/FixtureBot?start=crm_'+'x'.repeat(43)});
        } else if (url.pathname.endsWith('/link/status')) {
            claimed=true; Object.assign(result,{status:'awaiting_confirmation',telegramId:'10001',username:'fixture_user'});
        } else if (url.pathname.endsWith('/link/confirm')) {
            expect(claimed).toBe(true); status='connected';
        } else if (url.pathname.endsWith('/disconnect')) {
            expect(body.password).toBe('fixture-password'); status='disconnected';
        } else Object.assign(result,{status,mode:disabled?'off':'write',pilotEnabled:true,botUsername,telegramId:status==='connected'?'10001':null,proposedTelegramId:status==='preassigned'?'10001':null,username:status==='connected'?'fixture_user':null});
        return route.fulfill({json:result});
    });
    await page.goto('https://fixture.example/profile');
    await page.addStyleTag({content:css});
    await page.evaluate(()=>{ window.AppState={currentUser:{id:1}}; window.getAuthHeaders=()=>({'Content-Type':'application/json',Authorization:'Bearer fixture'}); });
    await page.addScriptTag({content:script});
    await page.evaluate(()=>window.TelegramCrmProfile.mount(document.getElementById('panel')));
    return calls;
}

test('mobile keyboard flow requires CRM and Telegram confirmation then allows immediate disconnect',async({page})=>{
    const calls=await setup(page,{mobile:true});
    await expect(page.getByText('Попередньо внесено — потрібне підтвердження')).toBeVisible();
    await page.getByRole('button',{name:'Підключити Telegram',exact:true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link',{name:'Відкрити Telegram'})).toBeVisible();
    await expect(page.getByLabel('Поточний пароль CRM (обов’язково)')).toHaveCount(0);
    expect(calls.some(call=>call.path.endsWith('/confirm'))).toBe(false);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'Це мій Telegram — підключити'})).toBeVisible();
    expect(calls.some(call=>call.path.endsWith('/confirm'))).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:'../telegram-profile-link-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Це мій Telegram — підключити'}).click();
    await expect(page.getByText('Підтверджено',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Telegram ID',{exact:true})).toHaveValue('10001');
    await expect(page.getByText('@fixture_user',{exact:true})).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({path:'../telegram-profile-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Змінити Telegram',exact:true}).click();
    await expect(page.getByLabel('Поточний пароль CRM (обов’язково)')).toBeFocused();
    await page.getByLabel('Поточний пароль CRM (обов’язково)').fill('wrong');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Підтвердьте');
    await page.getByRole('button',{name:'Скасувати',exact:true}).click();
    await page.getByRole('button',{name:'Від’єднати Telegram',exact:true}).click();
    await page.getByLabel('Поточний пароль CRM (обов’язково)').fill('fixture-password');
    await page.getByRole('button',{name:'Від’єднати Telegram зараз'}).click();
    await expect(page.getByText('Не підключено',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('qqqqq');
});

test('connected mobile account opens the current bot without another binding or password',async({page})=>{
    const calls=await setup(page,{mobile:true,connected:true});
    const open=page.getByRole('link',{name:'Мої задачі в Telegram',exact:true});
    await expect(open).toHaveAttribute('href','https://t.me/d1wdd_bot?start=crm_tasks');
    await expect(page.getByText(/повторна прив’язка не потрібна/)).toBeVisible();
    await open.focus();
    await expect(open).toBeFocused();
    expect(await open.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.context().route('https://t.me/**', route=>route.fulfill({contentType:'text/html',body:'<p>Telegram fixture</p>'}));
    const popupPromise=page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup=await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://t.me/d1wdd_bot?start=crm_tasks');
    expect(calls.every(call=>call.body===null)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:'../telegram-easy-connected-mobile.png',fullPage:true});
});

test('untrusted or unavailable bot names cannot become navigation links',async({page})=>{
    await setup(page,{connected:true,botUsername:'evil.example/path'});
    await expect(page.getByRole('link',{name:'Мої задачі в Telegram'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Змінити Telegram',exact:true})).toBeVisible();
});

test('off switch still allows disconnect and never renders untrusted text as markup',async({page})=>{
    await setup(page,{disabled:true});
    await expect(page.getByRole('button',{name:'Підключити Telegram',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Від’єднати Telegram',exact:true})).toBeVisible();
    await page.screenshot({path:'../telegram-profile-desktop.png',fullPage:true});
});

test('optional onboarding can be skipped without changing account or navigating',async({page})=>{
    await setup(page);
    await page.evaluate(()=>document.getElementById('panel').remove());
    await page.evaluate(()=>window.TelegramCrmProfile.offer());
    await expect(page.getByRole('link',{name:'Підключити Telegram у профілі'})).toBeVisible();
    await page.getByRole('button',{name:'Поки пропустити'}).click();
    await page.evaluate(()=>window.TelegramCrmProfile.offer());
    await expect(page.getByRole('button',{name:'Поки пропустити'})).toHaveCount(0);
    expect(page.url()).toBe('https://fixture.example/profile');
});
