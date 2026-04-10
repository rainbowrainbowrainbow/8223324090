const content = {
  painCards: [
    {
      title: 'Тривога і напруга',
      text: 'Коли ніби все тримається, але всередині постійний шум, страх і перенавантаження.'
    },
    {
      title: 'Вигорання',
      text: 'Коли сил дедалі менше, а вимог до себе дедалі більше.'
    },
    {
      title: 'Емоційне виснаження',
      text: 'Коли ви довго були сильними — і більше не можете витримувати той самий режим.'
    },
    {
      title: 'Стосунки, самотність, сенс',
      text: 'Коли питання вже не тільки «що зі мною?», а «хто я зараз?» і «куди я йду?». '
    }
  ],
  changes: [
    'краще розуміти свій стан і причини внутрішньої напруги',
    'вийти з автоматичних сценаріїв виснаження',
    'відновити контакт із собою, межами і потребами',
    'повернути собі внутрішню опору',
    'рухатись до змін не хаотично, а усвідомлено'
  ],
  pricing: [
    { name: 'Разова сесія', meta: '90 хв', price: '2400 грн', text: 'Перший крок, прояснення стану і подальшого шляху.' },
    { name: 'Цикл «Фокус»', meta: '4 сесії', price: '9400 грн', text: 'Стабілізація стану і старт системних змін.' },
    { name: 'Цикл «Опора»', meta: '8 сесій', price: '18400 грн', text: 'Глибша робота і стійка внутрішня перебудова.' },
    { name: 'Цикл «Глибина»', meta: '12 сесій', price: '27000 грн', text: 'Повна трансформація, а не лише зняття симптому.' }
  ],
  steps: [
    'Ви залишаєте заявку й коротко описуєте запит.',
    'Ми погоджуємо формат: разова сесія або цикл.',
    'Оплата проходить офіційно через інвойс / реквізити / QR.',
    'Проводимо онлайн-сесію у погоджений час.',
    'За потреби продовжуємо системну роботу з цілями і фокусом.'
  ],
  safety: [
    'Конфіденційно',
    'Онлайн-формат для України та діаспори',
    'Офіційна безготівкова оплата',
    'Обережна, але ефективна робота',
    'Фокус на реальних змінах'
  ],
  faq: [
    { q: 'Чи підходить цей формат, якщо я ніколи не працювала з психологом?', a: 'Так. Важлива не підготовка, а ваш реальний запит.' },
    { q: 'Чи можна працювати онлайн, якщо я не в Україні?', a: 'Так. Онлайн-робота з українцями за кордоном передбачена.' },
    { q: 'Який формат краще обрати?', a: 'Разова сесія — для першого кроку. Цикли — для глибших і триваліших змін.' },
    { q: 'Чи все конфіденційно?', a: 'Так. Конфіденційність — обов’язкова частина формату.' },
    { q: 'Як відбувається оплата?', a: 'Офіційно, безготівково, через інвойс/реквізити/QR на умовах публічної оферти.' }
  ]
};

const mountCards = (id, items) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(item => `<article class="card"><h3>${item.title}</h3><p>${item.text}</p></article>`).join('');
};

const mountList = (id, items) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(item => `<li>${item}</li>`).join('');
};

const mountPricing = () => {
  const el = document.getElementById('pricingCards');
  if (!el) return;
  el.innerHTML = content.pricing.map(item => `
    <article class="price-card">
      <h3>${item.name}</h3>
      <p class="meta">${item.meta}</p>
      <p class="price">${item.price}</p>
      <p>${item.text}</p>
      <a class="btn btn--ghost" href="#contact">Обрати формат</a>
    </article>
  `).join('');
};

const mountFaq = () => {
  const el = document.getElementById('faqItems');
  if (!el) return;
  el.innerHTML = content.faq.map(({ q, a }) => `
    <article class="faq-item">
      <button class="faq-q" type="button">${q}</button>
      <div class="faq-a">${a}</div>
    </article>
  `).join('');

  el.querySelectorAll('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.faq-item')?.classList.toggle('open');
    });
  });
};

const init = () => {
  mountCards('painCards', content.painCards);
  mountList('changesList', content.changes);
  mountPricing();
  mountList('timelineList', content.steps);
  mountList('safetyList', content.safety);
  mountFaq();

  const form = document.querySelector('.form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    alert('Дякуємо! Заявку отримано. Ми зв’яжемося з вами найближчим часом.');
    form.reset();
  });
};

document.addEventListener('DOMContentLoaded', init);
