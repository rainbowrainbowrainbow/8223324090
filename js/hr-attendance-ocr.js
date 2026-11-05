(function () {
    'use strict';
    const state = { busy:false, enabled:false, preview:null, source:null, paidBlocked:false, initialized:false };
    const el = name => document.getElementById('attendanceOcr'+name);
    const labels = {
        ready_for_confirmed_apply:'Готовий до підтвердження', empty_unknown:'Порожньо — даних немає',
        incomplete_pair:'Бракує приходу або виходу', invalid_time:'Некоректний час', uncertain:'Потрібна перевірка написання',
        document_date_requires_review:'Перевірте дату документа', overnight_or_interval_requires_review:'Інтервал потребує окремої перевірки',
        ambiguous_staff:'Знайдено кількох працівників', staff_not_found:'Працівника не знайдено', duplicate_target:'Повтор працівника',
        existing_attendance_requires_review:'Відвідуваність уже є — потрібна окрема перевірка', schedule_conflict:'Конфлікт із плановим графіком',
        compensation_requires_review:'Умови обліку часу потребують перевірки'
    };
    function message(text) { el('Status').textContent=text; }
    function sync() {
        const panel=el('Panel'); panel.setAttribute('aria-busy',String(state.busy));
        for(const input of el('Form').querySelectorAll('input')) input.disabled=state.busy || !state.enabled;
        el('Preview').disabled=state.busy || !state.enabled || state.paidBlocked || !!state.preview;
        el('Recover').disabled=state.busy || !state.enabled || !el('File').files.length;
        el('Refresh').disabled=state.busy || !state.enabled || !state.preview || state.preview.applied;
        const usable=state.preview?.applyAllowed && !state.preview.applied && new Date(state.preview.expiresAt).valueOf()>Date.now();
        for(const input of el('Rows').querySelectorAll('input')) input.disabled=state.busy || !usable || input.dataset.blocked==='true';
        el('ApplyConfirm').disabled=state.busy || !usable;
        el('Apply').disabled=state.busy || !usable || !el('ApplyConfirm').checked || !el('Rows').querySelector('input:checked');
    }
    function remember(id) {
        const url=new URL(location.href);
        if(id)url.searchParams.set('attendancePreview',id);else url.searchParams.delete('attendancePreview');
        history.replaceState(null,'',url.pathname+url.search+url.hash);
    }
    function show(preview) {
        state.preview=preview; state.paidBlocked=true; el('Review').hidden=false; el('ApplyConfirm').checked=false;
        el('Date').value=preview.documentDate;
        el('Summary').textContent=`Дата ${preview.documentDate}. ${preview.rows.length} видимих рядків. Порожні клітинки не означають відсутність. Інші сторінки не враховано.`;
        el('Rows').replaceChildren();
        for(const row of preview.rows) {
            const card=document.createElement('article'),label=document.createElement('label'),check=document.createElement('input');
            card.className='attendance-ocr-row'; check.type='checkbox'; check.dataset.ordinal=String(row.sourceRowOrdinal);
            check.dataset.blocked=String(row.classification!=='ready_for_confirmed_apply');
            label.append(check,document.createTextNode(` Рядок ${row.sourceRowOrdinal}: ${row.ocrName || 'Ім’я не розпізнано'}`));
            const times=document.createElement('p'); times.textContent=`Прихід: ${row.rawArrivalTime || '—'} · Вихід: ${row.rawDepartureTime || '—'}`;
            const status=document.createElement('p');status.textContent=labels[row.classification] || 'Потрібна перевірка';
            card.append(label,times,status);el('Rows').append(card);
        }
        remember(preview.previewId);
        message(preview.applied?'Цей перегляд уже застосовано.':preview.expired?'Термін перегляду минув. Оновіть його без нового розпізнавання.':'Перевірте дату, працівників і обидва часи. Виберіть лише підтверджені рядки.');
        sync();
    }
    async function request(path,body) {
        const options=body===undefined?{}:{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)};
        if(body!==undefined && !(body instanceof FormData))options.headers={'Content-Type':'application/json'};
        const response=await (typeof apiFetchWithAuthRetry==='function'?apiFetchWithAuthRetry('/api/hr/attendance/ocr/'+path,options):fetch('/api/hr/attendance/ocr/'+path,options));
        let value;try{value=await response.json();}catch{throw Object.assign(new Error('Invalid response'),{code:'NETWORK_UNKNOWN'});}
        if(!response.ok || value.success===false)throw Object.assign(new Error('Attendance OCR request failed'),{code:value.code || 'NETWORK_UNKNOWN'});
        return value;
    }
    function failure(error) {
        const code=error.code || 'NETWORK_UNKNOWN';
        if(state.preview && /STALE|EXPIRED|PERIOD_CLOSED|HISTORY_LOCKED|ALREADY_APPLIED|ROWS_REQUIRE_REVIEW|TIME_REQUIRES_REVIEW|FUTURE_DATE/.test(code))state.preview.applyAllowed=false;
        if(code==='CRM_EXECUTION_DISABLED'){state.enabled=false;message('Розпізнавання листів приходу/виходу ще не активоване.');}
        else if(/PERIOD_CLOSED|HISTORY_LOCKED/.test(code))message('Цей період або нарахування вже закрито чи погоджено. Застосування заблоковано.');
        else if(/STALE|EXPIRED/.test(code))message('Дані змінилися або термін перегляду минув. Оновіть перегляд і перевірте рядки ще раз.');
        else if(/ALREADY_APPLIED/.test(code))message('Для цього фото вже було застосування. Відкрийте збережений перегляд.');
        else if(code==='CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND')message('Збережений результат не знайдено для цього користувача, фото й дати. Нове розпізнавання не запускалось.');
        else if(/CONTEXT_FORBIDDEN|CAPABILITY_REQUIRED|FORBIDDEN/.test(code))message('Немає доступу до цього перегляду або керування відвідуваністю.');
        else if(/TIME_REQUIRES_REVIEW|FUTURE_DATE|ROWS_REQUIRE_REVIEW/.test(code))message('Вибрані рядки або час потребують окремої перевірки. Записів не змінено.');
        else if(code==='CRM_PROVIDER_BUSY')message('Інша операція виконується або є запити з невідомим результатом. Нове розпізнавання не розпочато.');
        else if(/LIMIT_|IMAGE_|DATE_|APPLY_INVALID/.test(code))message('Перевірте дату документа та PNG/JPEG розміром до 4 МБ.');
        else message('Результат потребує перевірки. Не запускайте розпізнавання повторно: скористайтеся перевіркою збереженого результату.');
    }
    async function busy(work) {
        if(state.busy)return;state.busy=true;sync();
        try{await work();}catch(error){failure(error);}finally{state.busy=false;sync();}
    }
    async function source() {
        const file=el('File').files[0];
        if(!file || !['image/png','image/jpeg'].includes(file.type) || file.size>4*1024*1024 || !el('Date').value)throw Object.assign(new Error('Invalid image'),{code:'CRM_IMAGE_INVALID'});
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),value=>value.toString(16).padStart(2,'0')).join('');
        state.source={documentDate:el('Date').value,imageSha256:hash};return file;
    }
    async function init(options={}) {
        const panel=el('Panel');if(!panel)return;
        panel.hidden=options.canManage!==true;if(panel.hidden || state.initialized)return;state.initialized=true;
        el('Date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        el('Form').addEventListener('submit',event=>{
            event.preventDefault();if(el('Preview').disabled || !el('Form').reportValidity())return;
            busy(async()=>{
                const file=await source(),body=new FormData();body.append('file',file);body.append('documentDate',state.source.documentDate);body.append('confirmed','true');
                state.paidBlocked=true;message('Розпізнаємо фото. Відвідуваність ще не змінюється.');show(await request('preview',body));
            });
        });
        el('Form').addEventListener('change',event=>{
            if(['attendanceOcrFile','attendanceOcrDate'].includes(event.target.id)) {
                state.preview=null;state.source=null;state.paidBlocked=false;el('Review').hidden=true;el('Rows').replaceChildren();el('PaidConfirm').checked=false;remember(null);message('');sync();
            }
        });
        el('Recover').addEventListener('click',()=>busy(async()=>{await source();message('Перевіряємо збережений результат без нового платного запиту…');show(await request('recover',state.source));}));
        el('Refresh').addEventListener('click',()=>busy(async()=>{show(await request('previews/'+state.preview.previewId+'/refresh',{}));}));
        el('Review').addEventListener('change',sync);
        el('Apply').addEventListener('click',()=>{
            if(el('Apply').disabled)return;
            const selectedRowOrdinals=[...el('Rows').querySelectorAll('input:checked')].map(input=>Number(input.dataset.ordinal));
            busy(async()=>{
                const value=await request('apply',{previewId:state.preview.previewId,previewHash:state.preview.previewHash,selectedRowOrdinals,confirmed:true});
                state.preview.applied=true;state.preview.applyAllowed=false;message(`Застосовано рядків: ${value.attendanceWrites}. Прихід і вихід збережено.`);
                try{if(options.afterApply)await options.afterApply();}catch{/* The committed write remains successful. */}
            });
        });
        sync();
        await busy(async()=>{
            state.enabled=(await request('status')).enabled===true;
            if(!state.enabled){message('Розпізнавання листів приходу/виходу ще не активоване.');return;}
            const id=new URL(location.href).searchParams.get('attendancePreview');
            if(id){panel.open=true;show(await request('previews/'+encodeURIComponent(id)));}
        });
    }
    window.CrmAttendanceOcrUi={init};
})();
