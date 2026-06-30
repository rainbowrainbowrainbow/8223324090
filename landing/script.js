const landingContent = {
  pain: [
    {
      title: 'Тривога і напруга',
      text: 'Коли ніби все тримається, але всередині постійний шум, страх, перенавантаження і немає відчуття опори.'
    },
    {
      title: 'Вигорання',
      text: 'Коли сил дедалі менше, а вимог до себе — дедалі більше. Зовні ніби все нормально, а всередині порожньо.'
    },
    {
      title: 'Емоційне виснаження',
      text: 'Коли ви довго були сильними, відповідальними і зібраними — і більше не можете витримувати цей режим.'
    },
    {
      title: 'Стосунки, самотність, втрата сенсу',
      text: 'Коли питання вже не тільки «що зі мною?», а «хто я зараз?» і «чому так важко?». '
    }
  ],
  changes: [
    'Краще розуміти свій стан і причини внутрішньої напруги.',
    'Вийти з автоматичних сценаріїв виснаження.',
    'Відновити контакт із собою, межами і потребами.',
    'Повернути собі внутрішню опору.',
    'Рухатись до змін не хаотично, а усвідомлено.'
  ],
  pricing: [
    {
      name: 'Разова сесія',
      meta: '90 хвилин',
      price: '2400 грн',
      description: 'Підійде, щоб почати, прояснити стан, побачити ключовий вузол напруги та визначити подальший шлях.'
    },
    {
      name: 'Цикл «Фокус»',
      meta: '4 сесії',
      price: '9400 грн',
      description: 'Коли потрібно зібратися, стабілізувати стан і почати системні зміни.'
    },
    {
      name: 'Цикл «Опора»',
      meta: '8 сесій',
      price: '18400 грн',
      description: 'Для глибшої роботи, коли точкового втручання вже недостатньо.'
    },
    {
      name: 'Цикл «Глибина»',
      meta: '12 сесій',
      price: '27000 грн',
      description: 'Для серйозної внутрішньої роботи і повної трансформації, а не лише зняття симптомів.'
    }
  ],
  steps: [
    'Ви залишаєте заявку та коротко описуєте свій запит.',
    'Узгоджуємо формат: разова сесія або цикл роботи.',
    'Оплата проходить офіційно через інвойс / реквізити / QR.',
    'Проводимо онлайн-сесію у погоджений час.',
    'За потреби продовжуємо системну роботу з логікою і чітким фокусом.'
  ],
  safety: [
    'Конфіденційність як базовий стандарт.',
    'Онлайн-формат для України і діаспори.',
    'Офіційна безготівкова оплата, ФОП-модель.',
    'Обережний та відповідальний підхід без агресивних обіцянок.',
    'Робота спрямована на реальні зміни, а не разове «полегшення на вечір». '
  ],
  faq: [
    {
      question: 'Чи підходить цей формат, якщо я ніколи не працювала з психологом?',
      answer: 'Так. Важлива не підготовка, а ваш реальний запит і готовність почати рух до змін.'
    },
    {
      question: 'Чи можна працювати онлайн, якщо я не в Україні?',
      answer: 'Так, онлайн-робота з українцями за кордоном передбачена.'
    },
    {
      question: 'Що краще обрати: разову сесію чи пакет?',
      answer: 'Разова сесія — для першого кроку і прояснення. Якщо запит давній або глибокий, краще одразу дивитися в бік циклів.'
    },
    {
      question: 'Як відбувається оплата?',
      answer: 'Оплата офіційна, безготівкова, через інвойс/реквізити/QR, на умовах публічної оферти.'
    }
  ]
};

function renderCards(id, items) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = items
    .map((item) => `<article class="card"><h3>${item.title}</h3><p>${item.text}</p></article>`)
    .join('');
}

function renderList(id, items) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
}

function renderPricing(id, items) {
  const node = document.getElementById(id);
  if (!node) return;
  node.innerHTML = items
    .map(
      (item) => `
      <article class="price">
        <h3>${item.name}</h3>
        <p class="price__meta">${item.meta}</p>
        <p class="price__tag">${item.price}</p>
        <p>${item.description}</p>
        <a class="btn btn--line" href="#contact">Обрати формат</a>
      </article>`
    )
    .join('');
}

function renderFaq(id, items) {
  const node = document.getElementById(id);
  if (!node) return;

  node.innerHTML = items
    .map(
      (item) => `
      <article class="faq-item">
        <button class="faq-q" type="button" aria-expanded="false">${item.question}</button>
        <div class="faq-a">${item.answer}</div>
      </article>`
    )
    .join('');

  node.querySelectorAll('.faq-q').forEach((button) => {
    button.addEventListener('click', () => {
      const parent = button.closest('.faq-item');
      const isOpen = parent.classList.toggle('open');
      button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });
}

function setupForm() {
  const form = document.getElementById('leadForm');
  const statusNode = document.getElementById('formStatus');
  if (!form || !statusNode) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      statusNode.textContent = 'Будь ласка, заповніть обовʼязкові поля і підтвердьте згоду з умовами.';
      form.reportValidity();
      return;
    }

    statusNode.textContent = 'Дякуємо! Заявку отримано. Ми зв’яжемося з вами найближчим часом.';
    form.reset();
  });
}

function setupMobileMenu() {
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function initLanding() {
  renderCards('painCards', landingContent.pain);
  renderList('changesList', landingContent.changes);
  renderPricing('pricingCards', landingContent.pricing);
  renderList('stepsList', landingContent.steps);
  renderList('safetyList', landingContent.safety);
  renderFaq('faqList', landingContent.faq);
  setupForm();
  setupMobileMenu();

  const yearNode = document.getElementById('year');
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());
}

document.addEventListener('DOMContentLoaded', initLanding);
