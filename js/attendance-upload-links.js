(function(){
    'use strict';
    let initialized=false;
    window.CrmAttendanceUploadLinks={async init(panel){
        if(initialized)return;initialized=true;
        async function request(path,body){const response=await apiFetchWithAuthRetry('/api/hr/attendance/ocr/'+path,
            body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            if(!response)throw Error('Unavailable');const value=await response.json();if(!response.ok)throw Object.assign(Error('Unavailable'),{code:value.code});return value;}
        let initial;try{initial=await request('uploads');}catch{return;}
        if(initial.enabled!==true)return;
        const section=document.createElement('section');section.id='attendanceUploadLinks';
        const title=document.createElement('h3');title.textContent='Додати лист через працівника';
        const help=document.createElement('p');help.textContent='Створіть захищене посилання за датою документа. Воно діє 24 години й дозволяє до 3 фото. Результат перевіряєте ви. Оригінал фото доступний вам 7 днів; розпізнані дані та історія зберігаються.';
        const form=document.createElement('form'),label=document.createElement('label'),date=document.createElement('input');
        label.textContent='Дата на листі';date.type='date';date.required=true;date.id='attendanceUploadLinkDate';date.value=document.getElementById('attendanceOcrDate').value;label.append(date);
        const create=document.createElement('button');create.type='submit';create.className='btn-page-secondary';create.textContent='Створити посилання';create.id='attendanceUploadLinkCreate';
        form.append(label,create);
        const linkLabel=document.createElement('label');linkLabel.textContent='Посилання для працівника';linkLabel.hidden=true;
        const link=document.createElement('input');link.type='text';link.readOnly=true;link.id='attendanceUploadLinkValue';link.setAttribute('data-clarity-mask','true');linkLabel.append(link);
        const note=document.createElement('p');note.setAttribute('role','status');note.id='attendanceUploadLinkStatus';
        const refresh=document.createElement('button');refresh.type='button';refresh.className='btn-page-secondary';refresh.textContent='Оновити надіслані листи';refresh.id='attendanceUploadInboxRefresh';
        const list=document.createElement('div');list.id='attendanceUploadInbox';
        section.append(title,help,form,linkLabel,note,refresh,list);panel.append(section);
        let busy=false;
        function sync(){section.setAttribute('aria-busy',String(busy));for(const button of section.querySelectorAll('button'))button.disabled=busy;date.disabled=busy;}
        async function work(action){if(busy)return;busy=true;sync();try{await action();}catch(error){note.textContent=error.code==='CRM_UPLOAD_LINK_LIMIT'?'Ліміт створення посилань вичерпано: до 3 за 24 години.':'Не вдалося підтвердити дію. Оновіть список; не створюйте повторне посилання навмання.';}finally{busy=false;sync();}}
        async function photo(id){
            const response=await apiFetchWithAuthRetry('/api/hr/attendance/ocr/uploads/'+id+'/photo');
            if(!response?.ok)throw Error('Photo unavailable');
            const url=URL.createObjectURL(await response.blob()),dialog=document.createElement('dialog'),image=document.createElement('img'),close=document.createElement('button');
            dialog.className='attendance-upload-photo';dialog.setAttribute('aria-label','Оригінал листа приходу й виходу');dialog.setAttribute('data-clarity-mask','true');
            image.src=url;image.alt='Завантажений оригінал листа для звірки розпізнаних рядків';
            close.type='button';close.className='btn-page-secondary';close.textContent='Закрити фото';close.addEventListener('click',()=>dialog.close());
            dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});
            dialog.append(close,image);document.body.append(dialog);dialog.showModal();close.focus();
        }
        function render(value){list.replaceChildren();const groups=new Map();for(const item of value.items){if(!groups.has(item.id))groups.set(item.id,[]);groups.get(item.id).push(item);}
            if(!groups.size){const empty=document.createElement('p');empty.textContent='Надісланих листів ще немає.';list.append(empty);}
            for(const [id,items] of groups){const item=items[0],card=document.createElement('article');card.className='attendance-ocr-row';
                const heading=document.createElement('p');heading.textContent=`Лист за ${item.document_date} · ${item.revoked_at?'посилання відкликано':new Date(item.expires_at)<=new Date()?'строк минув':'посилання діє'}`;card.append(heading);
                for(const entry of items.filter(row=>row.submission_id)){
                    const row=document.createElement('p');row.textContent=entry.status==='ready'?'Отримано лист для перевірки. ':'Стан обробки потребує перевірки. ';
                    if(entry.preview_id){const open=document.createElement('a');open.href='/hr?attendancePreview='+encodeURIComponent(entry.preview_id)+'#today';open.textContent='Перевірити рядки';row.append(open);}
                    else{const recover=document.createElement('button');recover.type='button';recover.className='btn-page-secondary';recover.textContent='Перевірити збережений результат';recover.addEventListener('click',()=>work(async()=>{await request('uploads/'+entry.submission_id+'/recover',{});render(await request('uploads'));}));row.append(recover);}
                    card.append(row);
                    if(entry.photo_available){const source=document.createElement('button');source.type='button';source.className='btn-page-secondary';source.textContent='Переглянути оригінал фото';source.addEventListener('click',()=>work(()=>photo(entry.submission_id)));card.append(source);}
                }
                if(!item.revoked_at && new Date(item.expires_at)>new Date()){const revoke=document.createElement('button');revoke.type='button';revoke.className='btn-page-secondary';revoke.textContent='Відкликати посилання';revoke.addEventListener('click',()=>work(async()=>{await request('upload-links/'+id+'/revoke',{});if(link.dataset.linkId===id){link.value='';linkLabel.hidden=true;}render(await request('uploads'));note.textContent='Нові завантаження за посиланням заблоковані. Уже розпочата обробка може завершитися.';}));card.append(revoke);}
                list.append(card);
            }
        }
        form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;work(async()=>{
            const value=await request('upload-links',{documentDate:date.value});link.value=location.origin+value.path;link.dataset.linkId=value.id;linkLabel.hidden=false;
            note.textContent='Скопіюйте посилання й передайте працівнику. Воно показується лише зараз; після втрати можна відкликати його й створити нове.';render(await request('uploads'));link.focus();link.select();
        });});
        refresh.addEventListener('click',()=>work(async()=>{render(await request('uploads'));note.textContent='Список оновлено без нового розпізнавання.';}));
        render(initial);sync();
    }};
})();
