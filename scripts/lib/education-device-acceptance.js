'use strict';
const PRODUCT_FILES = Object.freeze(['index.html','css/education-schedule.css','js/booking.js','js/booking-form.js','js/education-groups.js','js/education-attendance.js','js/education-schedule.js','js/timeline-settings-page.js']);
const CASES = Object.freeze([
    ['D01','П’ять вкладок, portrait/landscape, light/dark','Усі вкладки читабельні; довгі українські назви не закривають controls.'],
    ['D02','Група, пошук і учасник','Створити власну групу, призначити викладача, знайти/зарахувати fictional дитину; reload зберігає склад.'],
    ['D03','Створення й редагування заняття','Create через UI;45 хв, тема/викладач/група/кабінет збережені після edit/reload/картки.'],
    ['D04','Перенесення лише дати','Native date picker переносить заняття; решта полів незмінна, Today/day/week показують нову дату.'],
    ['D05','Серія й скасування','Два елементи серії; переноситься лише вибраний; confirm/cancel зрозумілі, інший елемент незмінний.'],
    ['D06','Журнал, очищення й історія','present/absent/excused/невідмічено; save/reload/refresh показують фактичні відмітки й автора/час.'],
    ['D07','Звіт і date-фільтри','Historical range/незалежні суми з manifest; фільтр/reset/reload узгоджені.'],
    ['D08','Налаштування education','Прочитати чинні кабінети/підписи; тимчасову scoped зміну зберегти через UI й відновити.'],
    ['D09','Екранна клавіатура','Тема/назва/search: field і sticky Save видимі,16px font не створює небажаний autozoom; клавіатуру можна закрити.'],
    ['D10','Native date/select picker','Відкрити OS date/select для форми й report; confirm/cancel не гублять draft і правильну дату.'],
    ['D11','Scroll, sticky actions, notch/safe area','Scroll/rotation із клавіатурою й без: жодна critical дія/поле не сховані browser chrome/notch/home indicator.'],
    ['D12','Реальний zoom200%','Browser/pinch zoom дозволений; дані/дії доступні, deliberate таблиці скроляться всередині контейнера.'],
    ['D13','VoiceOver/TalkBack поля та помилки','Gesture navigation оголошує label/value/action; invalid date/duration повідомляється, focus приходить на поле. Записати фактичну вимову.'],
    ['D14','VoiceOver/TalkBack діалоги','Відкрити/закрити card/edit/series/confirm: назва діалогу, focus усередині, close доступний, focus повертається до trigger.']
]);
const DEVICES = Object.freeze([
    {id:'iphone',expectedOS:'iOS',expectedBrowser:'Safari',screenReader:'VoiceOver'},
    {id:'ipad',expectedOS:'iPadOS',expectedBrowser:'Safari',screenReader:'VoiceOver'},
    {id:'android',expectedOS:'Android',expectedBrowser:'Chrome',screenReader:'TalkBack'}
]);
function template({anchorDate,sourceHashes}) {
    return {task:'EDU-READY-08C',classification:'PHYSICAL_DEVICE_ACCEPTANCE',generatedAt:new Date().toISOString(),anchorDate,sourceHashes,
        devices:DEVICES.map(device=>({...device,model:null,osName:null,osVersion:null,browserName:null,browserVersion:null,operator:null,physicalConfirmed:null,observedAt:null,
            checks:CASES.map(([id,title,expected])=>({id,title,expected,status:'BLOCKED_DEVICE',actual:null,steps:null,orientation:null,theme:null,spokenOutput:null,evidence:[]}))}))};
}
function evaluate(report, verifyEvidence) {
    const checks=[];
    for(const required of DEVICES){const device=report.devices?.find(row=>row.id===required.id);
        const real=device?.physicalConfirmed===true&&device.osName===required.expectedOS&&device.browserName===required.expectedBrowser&&['model','osVersion','browserVersion','operator','observedAt'].every(key=>typeof device[key]==='string'&&device[key].trim())&&Number.isFinite(Date.parse(device.observedAt));
        for(const [id]of CASES){const item=device?.checks?.find(row=>row.id===id);let status='BLOCKED_DEVICE',reason='No confirmed physical-device/operator session';
            if(real){status=item?.status||'BLOCKED_EVIDENCE';reason=item?.actual||'No actual observation';
                if(status==='PASS'){
                    if(!item.actual?.trim()||!item.steps?.trim()||!item.orientation?.trim()||!item.theme?.trim()||!Array.isArray(item.evidence)||!item.evidence.length||(id==='D13'&&!item.spokenOutput?.trim())){status='BLOCKED_EVIDENCE';reason='PASS lacks observations/device evidence';}
                    else{try{for(const file of item.evidence)verifyEvidence(file,device);reason='Operator observation and evidence present';}catch(error){status='BLOCKED_EVIDENCE';reason=error.message;}}
                }else if(!['FAIL','BLOCKED_DEVICE','BLOCKED_EVIDENCE','NOT_RUN'].includes(status)){status='BLOCKED_EVIDENCE';reason='Unknown result status';}
            }
            checks.push({device:required.id,id,status,reason});
        }
    }
    const failed=checks.filter(row=>row.status==='FAIL').length;const passed=checks.filter(row=>row.status==='PASS').length;
    return {status:failed?'FAIL':passed===checks.length?'PASS':'BLOCKED_DEVICE',counts:{total:checks.length,passed,failed,unverified:checks.length-passed-failed},exitCode:failed?1:passed===checks.length?0:2,checks};
}
module.exports={CASES,DEVICES,PRODUCT_FILES,template,evaluate};
