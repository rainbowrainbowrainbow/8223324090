// v5.20: Invite page logic (extracted from inline script for CSP compliance)
(function() {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date');
    const time = params.get('time');
    const program = params.get('program');
    const room = params.get('room');

    if (date || time || program) {
        const header = document.querySelector('.invite-header');
        if (header) {
            const detailsDiv = document.createElement('div');
            detailsDiv.style.cssText = 'background:rgba(255,255,255,0.15);border-radius:12px;padding:12px 16px;margin-top:12px;text-align:left;';
            if (date) detailsDiv.innerHTML += `<div style="font-size:14px;margin-bottom:4px;">📅 <strong>${date}</strong></div>`;
            if (time) detailsDiv.innerHTML += `<div style="font-size:14px;margin-bottom:4px;">🕐 <strong>${time}</strong></div>`;
            if (program) detailsDiv.innerHTML += `<div style="font-size:14px;margin-bottom:4px;">🎉 <strong>${program}</strong></div>`;
            if (room) detailsDiv.innerHTML += `<div style="font-size:14px;">📍 <strong>${room}</strong></div>`;
            header.appendChild(detailsDiv);
        }
    }

    function shareInvite() {
        const text = program && date
            ? `Запрошуємо на ${program} ${date}! Парк Закревського Періоду — вул. Закревського 31/2, 3 поверх`
            : 'Запрошуємо на свято! Парк Закревського Періоду — вул. Закревського 31/2, 3 поверх';
        if (navigator.share) {
            navigator.share({ title: 'Парк Закревського Періоду', text, url: window.location.href });
        } else {
            copyLink();
        }
    }

    function copyLink() {
        navigator.clipboard.writeText(window.location.href).then(() => {
            alert('Посилання скопійовано!');
        });
    }

    document.getElementById('btnShareInvite')?.addEventListener('click', shareInvite);
    document.getElementById('btnCopyLink')?.addEventListener('click', copyLink);
})();
