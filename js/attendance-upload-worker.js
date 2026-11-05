(function(){
    'use strict';
    window.initAttendanceWorkerUpload=async function(token){
        const panel=document.getElementById('attendanceOcrPanel');
        document.querySelector('.access-note').hidden=true;
        document.querySelector('.intro').textContent='Додайте фото листа. Відповідальний перевірить розпізнані дані перед записом годин.';
        document.querySelector('footer').textContent='Посилання особисте: не публікуйте його. Імена й години інших працівників тут не показуються. Оригінал фото доступний відповідальному 7 днів для перевірки.';
        panel.replaceChildren();panel.hidden=false;
        const title=document.createElement('h2');title.textContent='Додати лист приходу й виходу';
        const details=document.createElement('p'),form=document.createElement('form'),status=document.createElement('p');
        status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.id='workerUploadStatus';
        const fileLabel=document.createElement('label');fileLabel.textContent='Фото листа (PNG або JPEG, до 4 МБ)';
        const file=document.createElement('input');file.type='file';file.accept='image/jpeg,image/png';file.required=true;file.id='workerUploadFile';fileLabel.append(file);
        const consentLabel=document.createElement('label');consentLabel.className='confirmation';
        const consent=document.createElement('input');consent.type='checkbox';consent.required=true;consent.id='workerUploadConsent';
        consentLabel.append(consent,document.createTextNode('Погоджую розпізнавання через AI та передавання цього фото провайдеру KIE.'));
        const buttons=document.createElement('div');buttons.className='attendance-ocr-actions';
        const send=document.createElement('button');send.type='submit';send.className='primary';send.textContent='Надіслати лист';send.id='workerUploadSend';
        const recover=document.createElement('button');recover.type='button';recover.textContent='Перевірити надісланий лист';recover.id='workerUploadRecover';
        buttons.append(send,recover);form.append(fileLabel,consentLabel,buttons);panel.append(title,details,form,status);
        let busy=false,blocked=false,available=false,source=null;
        function sync(){panel.setAttribute('aria-busy',String(busy));file.disabled=consent.disabled=busy||!available;send.disabled=busy||!available||blocked;recover.disabled=busy||!available||!file.files.length;}
        async function request(path,body){
            const response=await fetch('/api/attendance-upload/'+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',
                headers:{'X-Attendance-Upload-Key':token,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},
                ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
            const result=await response.json();if(!response.ok)throw Object.assign(Error('Upload failed'),{code:result.code});return result;
        }
        async function image(){const selected=file.files[0];if(!selected||!['image/png','image/jpeg'].includes(selected.type)||selected.size>4*1024*1024)throw Object.assign(Error('Image invalid'),{code:'IMAGE_INVALID'});
            source=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await selected.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');return selected;}
        function show(result){status.textContent=result.status==='submitted_for_review'?'Лист надіслано відповідальному для перевірки. Години автоматично не записуються.':'Стан розпізнавання потребує перевірки відповідальним. Не надсилайте це фото повторно.';}
        function failure(error){
            if(/LINK_UNAVAILABLE|EXECUTION_DISABLED/.test(error.code||'')){available=false;status.textContent='Посилання недоступне або строк його дії минув. Попросіть відповідального перевірити доступ.';}
            else if(/IMAGE|LIMIT_FILE|FIELDS_INVALID/.test(error.code||''))status.textContent='Виберіть PNG або JPEG до 4 МБ.';
            else if(error.code==='CRM_UPLOAD_PAGE_LIMIT')status.textContent='Ліміт сторінок вичерпано. Зверніться до відповідального.';
            else if(error.code==='CRM_UPLOAD_NOT_FOUND')status.textContent='Збережений лист ще не знайдено. Перевірка не запускала нового розпізнавання.';
            else status.textContent='Не вдалося підтвердити результат. Перевірте надісланий лист перед новою спробою.';
        }
        async function work(action){if(busy)return;busy=true;sync();try{await action();}catch(error){failure(error);}finally{busy=false;sync();}}
        form.addEventListener('submit',event=>{event.preventDefault();if(send.disabled||!form.reportValidity())return;work(async()=>{
            const selected=await image(),body=new FormData();body.append('file',selected);body.append('confirmed','true');blocked=true;
            status.textContent='Обробляємо лист…';show(await request('photo',body));
        });});
        file.addEventListener('change',()=>{blocked=false;source=null;consent.checked=false;status.textContent='';sync();});
        recover.addEventListener('click',()=>work(async()=>{await image();show(await request('recover',{imageSha256:source}));}));
        sync();await work(async()=>{const info=await request('status');available=true;
            details.textContent=`Дата документа: ${info.documentDate}. Одне посилання дозволяє до 3 фото. Один лист — одне фото.`;});
    };
})();
