// Static guidebook material shared by the Art workspace and read-only Designer.
const GuidebookMaterials = (() => {
    const content = {
        brand: `
            <div class="designer-section">
                <h2>Brand Book Event Genix</h2>
                <p class="designer-section-lead">Event Genix звучить як робочий інструмент для команди: ясно, спокійно, без зайвої магії в тексті. Візуально бренд може бути яскравим, але інтерфейс має лишатися зручним для щоденної роботи.</p>
                <div class="designer-grid">
                    <div class="designer-card">
                        <h3>Призначення</h3>
                        <p>CRM збирає операційні матеріали, бронювання, каталоги, задачі та рекламні assets в одному місці для команд подій і сервісних бізнесів.</p>
                    </div>
                    <div class="designer-card">
                        <h3>Голос</h3>
                        <p>Тексти короткі, конкретні й корисні. Пояснюємо результат дії, не продаємо через тиск і не обіцяємо те, що система не підтверджує даними.</p>
                    </div>
                    <div class="designer-card">
                        <h3>Візуальний принцип</h3>
                        <p>Одна сильна фотографія або ілюстрація, чиста зона для тексту, мозаїчна палітра як акцент і зрозумілий CTA.</p>
                    </div>
                    <div class="designer-card">
                        <h3>Для клієнтських брендів</h3>
                        <p>ДАР, Майстерня долі й Парк мають окремий голос і палітри. У CRM вони мають бути позначені як матеріали конкретної компанії.</p>
                    </div>
                </div>
            </div>
            <div class="designer-section">
                <h2>Приклади голосу</h2>
                <div class="brand-example-grid">
                    <div class="brand-example">
                        <h3>Event Genix</h3>
                        <p>Готовий макет для афіші збережено в Design Board. Перевірте текст, дату й компанію перед публікацією.</p>
                        <button type="button" class="guide-copy-btn" data-guide-copy="Готовий макет для афіші збережено в Design Board. Перевірте текст, дату й компанію перед публікацією.">Копіювати текст</button>
                    </div>
                    <div class="brand-example">
                        <h3>Дитячий Активний Розвиток</h3>
                        <p>Теплий освітній тон: прості формулювання, багато повітря, біле тло, зелений як основний акцент.</p>
                        <button type="button" class="guide-copy-btn" data-guide-copy="Теплий освітній тон: прості формулювання, багато повітря, біле тло, зелений як основний акцент.">Копіювати текст</button>
                    </div>
                    <div class="brand-example">
                        <h3>Майстерня долі</h3>
                        <p>Спокійний рефлексивний тон: без гарантій результату, без тиску, з м'яким запрошенням до діалогу.</p>
                        <button type="button" class="guide-copy-btn" data-guide-copy="Спокійний рефлексивний тон: без гарантій результату, без тиску, з м'яким запрошенням до діалогу.">Копіювати текст</button>
                    </div>
                </div>
            </div>
        `,
        templates: `
            <div class="designer-section">
                <h2>Шаблони дизайнів</h2>
                <p class="designer-section-lead">Це реальні demo-шаблони у SVG: їх можна завантажити, відкрити в редакторі та використати як стартову композицію для рекламного матеріалу.</p>
                <div class="template-grid">
                    <div class="template-card">
                        <img loading="lazy" src="/images/brand/guidebook/templates/event-genix-post-template.svg" alt="Instagram post template preview">
                        <div class="template-card-content">
                            <h3>Instagram post 1080×1080</h3>
                            <p>Квадратний формат, один заголовок, логотип у верхній зоні, CTA внизу.</p>
                            <a class="template-download" href="/images/brand/guidebook/templates/event-genix-post-template.svg" download>Завантажити SVG</a>
                        </div>
                    </div>
                    <div class="template-card">
                        <img loading="lazy" src="/images/brand/guidebook/templates/event-genix-stories-template.svg" alt="Stories template preview">
                        <div class="template-card-content">
                            <h3>Stories 1080×1920</h3>
                            <p>Вертикальний макет із чистим центром, датою події та одним коротким CTA.</p>
                            <a class="template-download" href="/images/brand/guidebook/templates/event-genix-stories-template.svg" download>Завантажити SVG</a>
                        </div>
                    </div>
                    <div class="template-card">
                        <img loading="lazy" src="/images/brand/guidebook/templates/event-genix-cover-template.svg" alt="Catalog cover template preview">
                        <div class="template-card-content">
                            <h3>Каталог A4</h3>
                            <p>Обкладинка з одним hero-зображенням, назвою добірки та службовою датою версії.</p>
                            <a class="template-download" href="/images/brand/guidebook/templates/event-genix-cover-template.svg" download>Завантажити SVG</a>
                        </div>
                    </div>
                </div>
            </div>
        `
    };

    function render(visible) {
        document.querySelectorAll('[data-guide-material]').forEach(host => {
            if (visible && !host.childElementCount) host.innerHTML = content[host.dataset.guideMaterial];
            if (!visible) host.replaceChildren();
        });
    }

    function artRole(role) {
        return ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'art_director', 'marketer'].includes(role);
    }
    return { render, artRole };
})();

async function copyGuideText(text) {
    if (!text) return;
    try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('clipboard_unavailable');
        }
        await navigator.clipboard.writeText(text);
        if (typeof showNotification === 'function') showNotification('Скопійовано', 'success');
    } catch {
        if (typeof showNotification === 'function') showNotification('Копіювання недоступне в цьому браузері', 'warning');
    }
}
document.addEventListener('click', function(event) {
    var button = event.target.closest('[data-guide-copy]');
    if (!button) return;
    copyGuideText(button.dataset.guideCopy || '');
});
