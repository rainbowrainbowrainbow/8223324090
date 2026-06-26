const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const eventCardsHelper = require('../../js/event-cards');
const inviteConfig = require('../../js/invite-config');
const inviteShare = require('../../js/invite-share');

function runInviteChecks(context) {
    const {
        JSDOM,
        ROOT,
        check,
        fileText,
        cssTextWithImports,
        cssRuleText,
        cssRuleIncludingSelectorText,
        getHtmlScripts,
        scriptIndex,
        htmlScriptLoadsBefore,
        getInlineScripts
    } = context;

const eventCardSmokeDom = new JSDOM(`<main>${eventCardsHelper.renderEventCardImage({ title: 'Treasure quest' })}</main>`);
const eventCardSmokeImage = eventCardSmokeDom.window.document.querySelector('.event-card-visual img');
const eventCardPagesCss = cssTextWithImports('css/pages.css');
const eventCardVisualRule = cssRuleText(eventCardPagesCss, '.event-card-visual');
const eventCardImageRule = cssRuleText(eventCardPagesCss, '.event-card-visual img');
const inviteHtml = fileText('invite.html');
const inviteConfigCode = fileText('js/invite-config.js');
const inviteShareCode = fileText('js/invite-share.js');
const inviteBrowserSmokeCode = fileText('tests/browser/invite-browser-smoke.js');
const inviteDom = new JSDOM(inviteHtml);
const inviteHeroImage = inviteDom.window.document.querySelector('#inviteHeroImage');
const inviteLogoImage = inviteDom.window.document.querySelector('.logo-img');
const inviteSkipLink = inviteDom.window.document.querySelector('.skip-link');
const inviteExpectedCardKeys = ['holiday-party', 'show-program', 'family-event', 'workshop', 'private-party', 'quest'];
const inviteHeroWrapRule = cssRuleText(inviteHtml, '.invite-hero-wrap');
const inviteHeroImageRule = cssRuleText(inviteHtml, '.invite-hero');
const inviteLogoImageRule = cssRuleText(inviteHtml, '.logo-img');
const inviteDetailRowRule = cssRuleText(inviteHtml, '.event-detail-row');
const inviteDetailLabelRule = cssRuleText(inviteHtml, '.event-detail-label');
const inviteDetailValueRule = cssRuleText(inviteHtml, '.event-detail-value');
const inviteLocationMapRule = cssRuleText(inviteHtml, '.invite-section--location .map-link');
const inviteVisitRowRule = cssRuleText(inviteHtml, '.invite-section--visit .invite-info-row');
const inviteFooterRule = cssRuleText(inviteHtml, '.invite-footer');
const inviteShareButtonsRule = cssRuleText(inviteHtml, '.share-buttons');
const inviteShareButtonRule = cssRuleText(inviteHtml, '.share-btn');
const inviteSkipLinkRule = cssRuleText(inviteHtml, '.skip-link');
const inviteSkipLinkFocusRule = cssRuleIncludingSelectorText(inviteHtml, '.skip-link:focus-visible');

function renderInviteSmokeDom(query) {
    const dom = new JSDOM(inviteHtml, {
        url: `http://localhost:3000/invite${query}`,
        runScripts: 'outside-only'
    });
    dom.window.EventCards = eventCardsHelper;
    dom.window.InviteConfig = inviteConfig;
    getInlineScripts(inviteHtml).forEach(script => dom.window.eval(script));
    return dom;
}

function inviteVisitTipValues(dom) {
    return [...dom.window.document.querySelectorAll('[data-visit-tip] .value')]
        .map(node => node.textContent.trim());
}

const inviteShowProgramDom = renderInviteSmokeDom('?date=2026-06-25&time=15:00&end=15:30&program=Паперове%20Неон-шоу&room=Поні&card=show-program');
const inviteQuestDom = renderInviteSmokeDom('?date=2026-06-25&time=15:00&end=16:00&program=Квест&room=Карта&card=quest');
const inviteInvalidCardDom = renderInviteSmokeDom('?date=2026-06-25&time=15:00&program=Невідома%20подія&room=Поні&card=broken-card');
const inviteShowProgramTips = inviteVisitTipValues(inviteShowProgramDom);
const inviteQuestTips = inviteVisitTipValues(inviteQuestDom);
const inviteInvalidCardTips = inviteVisitTipValues(inviteInvalidCardDom);
const inviteShareSmokePayload = inviteShare.buildInviteSharePayload({
    date: '2026-06-25',
    time: '15:00',
    end: '15:30',
    program: 'Паперове Неон-шоу',
    room: 'Поні',
    card: 'show-program',
    phone: '+380000000000',
    comment: 'internal note'
}, inviteConfig, 'https://crm.example');
const inviteDetailsSmokeModel = inviteShare.buildBookingDetailsInviteModel({
    booking: {
        date: '2026-06-25',
        time: '15:00',
        programName: 'Паперове Неон-шоу',
        label: 'Internal fallback label',
        room: 'Поні',
        phone: '+380000000000',
        comment: 'private note',
        price: 9999,
        status: 'confirmed'
    },
    eventCardRecord: { title: 'Show program' },
    endTimeLabel: '15:30'
}, inviteConfig, 'https://crm.example', {
    resolveEventCardKey: () => 'show-program',
    EVENT_CARDS: { 'show-program': { key: 'show-program' } }
});

check('Event card visual smoke is static, ordered, and DB-free',
    htmlScriptLoadsBefore('index.html', 'js/event-cards.js', 'js/invite-config.js')
    && htmlScriptLoadsBefore('index.html', 'js/invite-config.js', 'js/invite-share.js')
    && htmlScriptLoadsBefore('index.html', 'js/invite-share.js', 'js/booking.js')
    && htmlScriptLoadsBefore('programs.html', 'js/event-cards.js', 'js/programs-page.js')
    && htmlScriptLoadsBefore('leads.html', 'js/event-cards.js', 'js/leads-page.js')
    && htmlScriptLoadsBefore('afisha.html', 'js/event-cards.js', 'js/afisha-page.js')
    && eventCardSmokeImage?.closest('.event-card-visual')
    && eventCardSmokeImage?.getAttribute('src')?.startsWith('/images/event-cards/')
    && eventCardVisualRule.includes('aspect-ratio: 16 / 9')
    && eventCardImageRule.includes('object-fit: cover'));
eventCardSmokeDom.window.close();
check('Invite page uses dynamic event-card header contract',
    scriptIndex(getHtmlScripts(inviteHtml), 'js/event-cards.js') >= 0
    && scriptIndex(getHtmlScripts(inviteHtml), 'js/invite-config.js') >= 0
    && htmlScriptLoadsBefore('invite.html', 'js/event-cards.js', 'js/invite-config.js')
    && inviteHeroImage?.getAttribute('src') === '/images/event-cards/event-card-holiday-party.png'
    && inviteHeroImage?.getAttribute('src')?.startsWith('/images/event-cards/')
    && inviteHeroImage?.getAttribute('alt') === 'Зображення типу заходу'
    && !inviteHtml.includes('images/banners/banner-invite-v2.png')
    && inviteHtml.includes("const end = params.get('end');")
    && inviteHtml.includes("const arrival = params.get('arrival') || params.get('guestTime') || params.get('guest_time');")
    && inviteHtml.includes("const eventType = params.get('type');")
    && inviteHtml.includes("const category = params.get('category');")
    && inviteHtml.includes("const requested = String(params.get('card') || '').trim();")
    && inviteHtml.includes("new Set(['holiday-party', 'show-program', 'family-event', 'workshop', 'private-party', 'quest'])")
    && inviteHtml.includes("const fallback = cards['holiday-party']")
    && inviteHtml.includes("src: '/images/event-cards/event-card-holiday-party.png'")
    && inviteHtml.includes('window.EventCards?.resolveEventCardKey?.({')
    && inviteHtml.includes('return allowedKeys.has(resolved) && cards[resolved] ? cards[resolved] : fallback;')
    && inviteHtml.includes("hero.dataset.card = card.key")
    && inviteHtml.includes('const INVITE_CONFIG = window.InviteConfig || DEFAULT_INVITE_CONFIG;')
    && inviteHtml.includes('renderInviteLocation();')
    && inviteHtml.includes("title.textContent = program || 'Запрошення'")
    && inviteHtml.includes('renderInviteContact();')
    && inviteHtml.includes('formatInviteTimeRange(time, end)')
    && inviteHtml.includes('onclick="shareInvite(event)"')
    && inviteHtml.includes('onclick="copyLink(event)"')
    && inviteHtml.includes('function writeClipboardText(text)')
    && inviteHtml.includes('function fallbackCopy()')
    && inviteHtml.includes('const shareTitle = inviteConfigText(INVITE_CONFIG.shareTitle')
    && inviteHtml.includes('const address = inviteLocationAddress();')
    && inviteHtml.includes('navigator.share({ title: shareTitle, text: text, url: window.location.href })')
    && !inviteHtml.includes('Парк Закревського Періоду — вул. Закревського 31/2, 3 поверх')
    && inviteHtml.includes('navigator.clipboard && typeof navigator.clipboard.writeText === \'function\'')
    && inviteHtml.includes('Promise.race([clipboardWrite, clipboardTimeout]).catch(fallbackCopy)')
    && inviteHtml.includes("new Error('Clipboard timeout')")
    && inviteHtml.includes('document.execCommand(\'copy\')')
    && inviteHeroWrapRule.includes('aspect-ratio: 16 / 9')
    && inviteHeroImageRule.includes('object-fit: cover'));
check('Invite share helper builds safe public URL and config-based share payload',
    typeof inviteShare.buildInviteParams === 'function'
    && typeof inviteShare.buildInviteUrl === 'function'
    && typeof inviteShare.buildInviteSharePayload === 'function'
    && typeof inviteShare.buildBookingDetailsInviteModel === 'function'
    && inviteShareCode.includes("const SAFE_INVITE_KEYS = Object.freeze(['date', 'time', 'end', 'program', 'room', 'card'])")
    && inviteShareSmokePayload.fullInviteUrl === 'https://crm.example/invite?date=2026-06-25&time=15%3A00&end=15%3A30&program=%D0%9F%D0%B0%D0%BF%D0%B5%D1%80%D0%BE%D0%B2%D0%B5+%D0%9D%D0%B5%D0%BE%D0%BD-%D1%88%D0%BE%D1%83&room=%D0%9F%D0%BE%D0%BD%D1%96&card=show-program'
    && inviteShareSmokePayload.inviteUrl.startsWith('/invite?date=2026-06-25&time=15%3A00&end=15%3A30')
    && inviteShareSmokePayload.messengerText.includes(inviteConfig.location.rows[0].value)
    && inviteShareSmokePayload.shareTitle === inviteConfig.shareTitle
    && !inviteShareSmokePayload.fullInviteUrl.includes('phone')
    && !inviteShareSmokePayload.fullInviteUrl.includes('comment')
    && !inviteShareSmokePayload.messengerText.includes('internal note')
    && !inviteShareSmokePayload.shortText.includes('+380000000000')
    && inviteDetailsSmokeModel.cardKey === 'show-program'
    && inviteDetailsSmokeModel.payload.fullInviteUrl === inviteShareSmokePayload.fullInviteUrl
    && inviteDetailsSmokeModel.previewChips.includes('Паперове Неон-шоу')
    && inviteDetailsSmokeModel.previewChips.includes('15:00 - 15:30')
    && inviteDetailsSmokeModel.publicData.card === 'show-program'
    && !inviteDetailsSmokeModel.payload.fullInviteUrl.includes('phone')
    && !inviteDetailsSmokeModel.payload.fullInviteUrl.includes('comment')
    && !inviteDetailsSmokeModel.payload.fullInviteUrl.includes('price')
    && !inviteDetailsSmokeModel.payload.fullInviteUrl.includes('status'));
check('Invite event details use labeled rows for date, activity time, program, and room',
    inviteHtml.includes("const hasDistinctArrival = Boolean(arrival && normalizeInviteTime(arrival) !== normalizeInviteTime(time));")
    && inviteHtml.includes("renderEventDetailRow('📅', 'Дата', date)")
    && inviteHtml.includes("renderEventDetailRow('🕐', 'Прихід гостей', arrival)")
    && inviteHtml.includes("renderEventDetailRow('⏱', 'Час активності', timeRange)")
    && inviteHtml.includes("renderEventDetailRow('🎉', 'Активність', program)")
    && inviteHtml.includes("renderEventDetailRow('📍', 'Кімната', room)")
    && inviteHtml.includes('function renderEventDetailRow(icon, label, value)')
    && inviteDetailRowRule.includes('display: grid')
    && inviteDetailRowRule.includes('grid-template-columns: 28px minmax(0, 1fr)')
    && inviteDetailRowRule.includes('border-radius: 16px')
    && inviteDetailLabelRule.includes('text-transform: uppercase')
    && inviteDetailValueRule.includes('display: block')
    && inviteDetailValueRule.includes('overflow-wrap: anywhere')
    && !inviteHtml.includes('<div class="event-detail-row">📅 <strong>')
    && !inviteHtml.includes('<div class="event-detail-row">🕐 <strong>')
    && !inviteHtml.includes('<div class="event-detail-row">⏱ <strong>')
    && !inviteHtml.includes("if (timeRange) html += '<div class=\"event-detail-row\">"));
check('Invite page uses Event Genix company logo instead of legacy mascot avatar',
    inviteLogoImage?.getAttribute('src') === 'images/brand/event-genix-logo.png'
    && inviteLogoImage?.getAttribute('alt') === 'Логотип Event Genix'
    && fs.existsSync(path.join(ROOT, 'images', 'brand', 'event-genix-logo.png'))
    && inviteLogoImageRule.includes('object-fit: contain')
    && inviteLogoImageRule.includes('object-position: center')
    && inviteLogoImageRule.includes('background: #FFFFFF')
    && !inviteHtml.includes('src="images/logo-new.png"')
    && !inviteHtml.includes('images/branding/event-genix-logo.png')
    && !inviteHtml.includes('dinosaur')
    && !inviteHtml.includes('Динозавр'));
check('Invite lower flow focuses on guest visit details instead of generic service marketing',
    inviteExpectedCardKeys.every(key => Array.isArray(inviteConfig.visit?.tips?.[key]) && inviteConfig.visit.tips[key].length >= 1)
    && inviteConfig.brandName === 'Event Genix'
    && inviteConfig.location?.rows?.some(row => row.label === 'Адреса' && row.value.includes('Закревського'))
    && inviteConfig.location?.rows?.some(row => row.label === 'Орієнтир' && row.value.includes('Лісова'))
    && inviteConfig.location?.mapUrl?.startsWith('https://maps.google.com/')
    && inviteConfig.contact?.rows?.some(row => row.label === 'Контакт' && row.value === 'Зв\'яжіться з нами' && !row.href)
    && !inviteConfigCode.includes('tel:+380XXXXXXXXX')
    && !inviteHtml.includes('tel:+380XXXXXXXXX')
    && inviteHtml.includes('id="inviteLocationSection"')
    && inviteHtml.includes('id="inviteVisitSection"')
    && inviteHtml.includes('id="inviteContactSection"')
    && inviteHtml.includes('function renderInviteLocation()')
    && inviteHtml.includes('function renderInviteContact()')
    && inviteHtml.includes('function renderInviteInfoRow(item, attributes)')
    && inviteHtml.includes('renderInviteVisitTips(card.key)')
    && inviteHtml.includes('const configTips = INVITE_CONFIG.visit?.tips || {};')
    && inviteHtml.includes("const tips = configTips[cardKey] || configTips['holiday-party'] || fallbackTips['holiday-party'];")
    && !inviteHtml.includes('const INVITE_VISIT_TIPS = {')
    && !inviteHtml.includes('м. Лісова / м. Чернігівська')
    && !inviteHtml.includes('вул. Закревського 31/2, 3 поверх')
    && inviteShowProgramDom.window.document.querySelector('#inviteLocationSection')?.textContent.includes('Як нас знайти')
    && inviteShowProgramDom.window.document.querySelector('#inviteLocationSection')?.textContent.includes('вул. Закревського 31/2, 3 поверх')
    && inviteShowProgramDom.window.document.querySelector('#inviteLocationSection .map-link')?.getAttribute('href') === inviteConfig.location.mapUrl
    && inviteShowProgramDom.window.document.querySelector('#inviteVisitSection')?.textContent.includes('Перед візитом')
    && inviteShowProgramDom.window.document.querySelector('#inviteContactSection')?.textContent.includes('Контакти')
    && inviteHtml.includes('Поділитися запрошенням')
    && inviteHtml.includes('onclick="shareInvite(event)"')
    && inviteHtml.includes('onclick="copyLink(event)"')
    && inviteLocationMapRule.includes('margin-top: 12px')
    && inviteVisitRowRule.includes('align-items: flex-start')
    && inviteFooterRule.includes('padding: 16px 30px 20px')
    && inviteShareButtonsRule.includes('flex-wrap: wrap')
    && inviteShareButtonRule.includes('min-height: 40px')
    && !inviteHtml.includes('Що вас чекає')
    && !inviteHtml.includes('features-list')
    && !inviteHtml.includes('feature-item')
    && !inviteHtml.includes('images/icon-quest.png')
    && !inviteHtml.includes('images/icon-animation.png')
    && !inviteHtml.includes('images/icon-show.png')
    && !inviteHtml.includes('images/icon-masterclass.png')
    && !inviteHtml.includes('images/icon-photo.png')
    && !inviteHtml.includes('images/icon-pinata.png'));
check('Invite personalized guest tips render by card and fall back safely',
    inviteShowProgramDom.window.document.querySelector('#inviteHeroImage')?.dataset.card === 'show-program'
    && inviteShowProgramTips.some(text => text.includes('до початку шоу'))
    && inviteShowProgramTips.some(text => text.includes('плануєте зйомку'))
    && inviteQuestDom.window.document.querySelector('#inviteHeroImage')?.dataset.card === 'quest'
    && inviteQuestTips.some(text => text.includes('короткого інструктажу'))
    && inviteQuestTips.some(text => text.includes('проходити завдання'))
    && inviteInvalidCardDom.window.document.querySelector('#inviteHeroImage')?.dataset.card === 'holiday-party'
    && inviteInvalidCardTips.some(text => text.includes('до початку події'))
    && inviteInvalidCardDom.window.document.querySelector('#inviteTitle')?.textContent.includes('Невідома подія')
    && inviteInvalidCardDom.window.document.querySelector('#inviteVisitSection')?.querySelectorAll('[data-visit-tip]').length >= 2);
check('Invite browser smoke covers real public invite render without joining npm test',
    pkg.scripts?.['test:browser:invite'] === 'npx --yes --package playwright node tests/browser/invite-browser-smoke.js'
    && pkg.scripts?.test === 'npm run verify'
    && !pkg.scripts?.verify?.includes('test:browser:invite')
    && inviteBrowserSmokeCode.includes("const INVITE_PATH = '/invite?date=2026-06-25&time=15:00&end=15:30&program=")
    && inviteBrowserSmokeCode.includes('card=show-program')
    && inviteBrowserSmokeCode.includes("if (relativePath === 'invite') relativePath = 'invite.html';")
    && inviteBrowserSmokeCode.includes("page.setViewportSize({ width: 390, height: 844 })")
    && inviteBrowserSmokeCode.includes('assertNoHorizontalOverflow(page)')
    && inviteBrowserSmokeCode.includes("page.locator('.logo-img')")
    && inviteBrowserSmokeCode.includes('event-card-show-program.png')
    && inviteBrowserSmokeCode.includes('const labels = labelText.map(item => item.trim());')
    && inviteBrowserSmokeCode.includes('date label is visible')
    && inviteBrowserSmokeCode.includes('activity label is visible')
    && inviteBrowserSmokeCode.includes('room label is visible')
    && inviteBrowserSmokeCode.includes('generic service grid title is absent')
    && inviteBrowserSmokeCode.includes("const shareButtons = page.locator('.share-btn')")
    && inviteBrowserSmokeCode.includes('assertSkipLinkHiddenByDefault(page)'));
inviteShowProgramDom.window.close();
inviteQuestDom.window.close();
inviteInvalidCardDom.window.close();
check('Invite skip link stays accessible without showing as a broken page link',
    inviteSkipLink?.getAttribute('href') === '#invite-details'
    && inviteHtml.includes('id="invite-details"')
    && inviteSkipLinkRule.includes('position: fixed')
    && inviteSkipLinkRule.includes('width: 1px')
    && inviteSkipLinkRule.includes('height: 1px')
    && inviteSkipLinkRule.includes('clip-path: inset(50%)')
    && inviteSkipLinkRule.includes('overflow: hidden')
    && inviteSkipLinkRule.includes('z-index: 1000')
    && inviteSkipLinkFocusRule.includes('width: auto')
    && inviteSkipLinkFocusRule.includes('height: auto')
    && inviteSkipLinkFocusRule.includes('clip-path: none')
    && inviteSkipLinkFocusRule.includes('background: #FFFFFF')
    && inviteSkipLinkFocusRule.includes('outline: 3px solid'));
inviteDom.window.close();
}

module.exports = {
    runInviteChecks
};
