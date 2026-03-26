/**
 * Event Genix — AI First CRM
 * config.js - Константи, конфігурація та глобальний стан
 */

// ==========================================
// UTILITIES
// ==========================================

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ==========================================
// ПРОГРАМИ (з тривалістю в назві)
// ==========================================

const PROGRAMS = [
    // Квести
    { id: 'kv1', code: 'КВ1', label: 'КВ1(60)', name: 'Легендарний тренд', icon: '🎭', category: 'quest', duration: 60, price: 2200, hosts: 1, age: '5-10р', kids: '4-10', description: 'Сучасна блогерська пригода на 60 хвилин: діти проходять серію веселих челенджів, знімають короткі відео «як у TikTok/YouTube», навчаються простим зйомкам і працюють у команді з ведучим-блогером. Наприкінці отримуєте змонтований ролик до 1 хв для пам\'яті, ролік робить до 2 тижнів.' },
    { id: 'kv4', code: 'КВ4', label: 'КВ4(60)', name: 'Шпигунська історія', icon: '🕵️', category: 'quest', duration: 60, price: 2800, hosts: 2, age: '5-12р', kids: '4-10', description: 'Детективна історія про викрадену картину: за 60 хвилин діти вчаться помічати деталі, працюють із простими шифрами, збирають «докази» та організовують спостереження за підозрюваним. Кульмінація — командне розкриття справи та короткий брифінг від ведучого.' },
    { id: 'kv5', code: 'КВ5', label: 'КВ5(60)', name: 'Щенячий патруль', icon: '🐕', category: 'quest', duration: 60, price: 2700, hosts: 2, age: '3-7р', kids: '3-10', description: 'У Парку зникла улюблена іграшка — Гусак. Команду очолюють знайомі дітям герої Чейз і Скай. На учасників чекає польовий іспит: пошук стендів-лап по території, дешифрування A5-вставками, збір «збирачок» із літерами та фінальна загадка в УФ-кімнаті. Завдання прокачують турботу, координацію й уважність до деталей. У фіналі — повернення Гусака та вручення Посвідчень рятувальників кожній дитині.' },
    { id: 'kv6', code: 'КВ6', label: 'КВ6(90)', name: 'Лісова Академія', icon: '🌲', category: 'quest', duration: 90, price: 2100, hosts: 1, age: '4-10р', kids: '4-10', description: 'Магічна пригода з Мавкою на 90 хвилин: діти проходять 4 іспити стихій (Земля, Вода, Вогонь, Повітря), збирають таємничі амулети, розгадують загадки лісу та відкривають Скриньку Гармонії з УФ-кодами. Фінал — творчий майстер-клас: кожна дитина створює власну гру "Хрестики-нолики" з розмальованих камінців у тканевому мішечку, яку забирає додому. Ведуча в образі Мавки проводить урочисту посвяту в Хранителі Гармонії та вручає дипломи.' },
    { id: 'kv7', code: 'КВ7', label: 'КВ7(60)', name: 'Гра в Кальмара', icon: '🦑', category: 'quest', duration: 60, price: 3300, hosts: 2, age: '5-12р', kids: '5-16', description: 'Командний квест, натхнений оригінальною франшизою. Ведучі в інтерактивних костюмах створюють впізнавану атмосферу без «жорстких» моментів. Етапи програми: стрілецький рубіж, мега-лабіринт із контрольними точками, зона реакції зі світло- та звуковими сигналами, кімната з пошуком підказок і складанням послідовності, естафета точності. Фінал — командний спринт через три міні-станції, підсумкове табло результатів і вручення стікерів.' },
    { id: 'kv8', code: 'КВ8', label: 'КВ8(60)', name: 'MineCraft 2', icon: '⛏️', category: 'quest', duration: 60, price: 2900, hosts: 2, age: '6-12р', kids: '5-10', description: 'Minecraft-квест — не за екраном, а в реальному парку! Початок з міні майстеркласу: кожна дитина створює та забирає власний нікнейм для пригоди. Квест розгортається навколо загрози: Кріпер створив бомбу-статую, яка може знищити парк. На героїв чекають стратегічні задачі, конструкції, командна робота і атмосфера гри, де мета — врятувати парк і здолати Кріпера.' },
    { id: 'kv9', code: 'КВ9', label: 'КВ9(60)', name: 'Ліга Світла', icon: '🦇', category: 'quest', duration: 60, price: 2500, hosts: 2, age: '4-10р', kids: '3-10', description: 'Місто згасло — зникли «іскри» енергії. Команди проходять станції спритності, кмітливості та взаємодопомоги, щоб зібрати іскри й перезапустити Світловий Щит міста. Наприкінці діти формують власний Кодекс Героя і проходять урочисту посвяту.' },
    { id: 'kv10', code: 'КВ10', label: 'КВ10(60)', name: 'Бібліотека Чарів', icon: '📚', category: 'quest', duration: 60, price: 3000, hosts: 2, age: '5-16р', kids: '3-10', description: 'Діти отримують карту каталогу з порожніми осередками — у кожен треба повернути відповідну сторінку. Підказки знайдете в «нотатках автора», на форзацах і в схованках між полицями. Сторінки з\'єднуються в єдиний ланцюжок, що вказує на фінальний стенд. Завершіть збір — і том сам «розповість», що тримав у собі.' },
    { id: 'kv11', code: 'КВ11', label: 'КВ11(60)', name: 'Секретна скарбів', icon: '💎', category: 'quest', duration: 60, price: 2500, hosts: 2, age: '5-12р', kids: '4-10', description: 'Фінал — Джейн оголошує "Церемонію Посвяти": кожна дитина проходить крізь "арку мечів" (бутафорія) і отримує піратське ім\'я та медаль. Скриня з трофеями, загальне фото з піратським салютом.' },

    // Анімація
    { id: 'anim60', code: 'АН', label: 'АН(60)', name: 'Анімація 60хв', icon: '🎪', category: 'animation', duration: 60, price: 1500, hosts: 1, age: '3-9р', kids: '2-8', description: 'Рухливі ігри, танці та конкурси з яскравим реквізитом; ведучий у костюмі улюбленого героя; у фіналі — кульки-мечі або тваринки для кожного.' },
    { id: 'anim120', code: 'АН', label: 'АН(120)', name: 'Анімація 120хв', icon: '🎠', category: 'animation', duration: 120, price: 2500, hosts: 1, age: '3-9р', kids: '2-8', description: 'Входить аквагрим; ще більше розваг — дітям точно вистачить часу на улюблені ігри.' },
    // v5.18.1: "+Ведучий" прибрано з каталогу — є окремий toggle "Додати додаткового ведучого"

    // Шоу
    { id: 'bubble', code: 'Бульб', label: 'Бульб(30)', name: 'Бульбашкове шоу', icon: '🔵', category: 'show', duration: 30, price: 2400, hosts: 1, age: '2-6р', kids: '2-16', description: 'Ефектні трюки з мильними бульбашками — гігантські кулі, «бульбашка в бульбашці», інтерактивні ігри з дітьми.' },
    { id: 'neon_bubble', code: 'Неон', label: 'Неон(30)', name: 'Шоу неон-бульбашок', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1, age: '2-8р', kids: '2-16', description: 'УФ-світло і бульбашки, що світяться — трюки з димом, великі кулі та фінальний неоновий «дощ».' },
    { id: 'paper', code: 'Папір', label: 'Папір(30)', name: 'Паперове Неон-шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2, age: '4-12р', kids: '4-14', description: 'Танцювальна вечірка під УФ-лампами з паперовим вибухом, флешмобами та груповим фото в неон-стилі.' },
    { id: 'dry_ice', code: 'Лід', label: 'Лід(40)', name: 'Шоу з сухим льодом', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1, age: '4-10р', kids: '2-16', description: 'Інтерактивна наука — густий туман, заморожування предметів і безпечний «льодовий вулкан».' },
    { id: 'football', code: 'Футб', label: 'Футб(90)', name: 'Футбольне шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1, age: '5-12р', kids: '2-16', description: 'Два ведучі (тренер і персонаж), естафети й конкурси з м\'ячами, трюки і фінальний міні-матч.' },
    { id: 'mafia', code: 'Мафія', label: 'Мафія(90)', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1, age: '4-10р', kids: '2-16', description: 'Дитяча детективна гра з ведучим — пояснення правил, розподіл ролей, 6–10 інтригуючих раундів і фінальне визначення переможців.' },

    // Фото послуги
    { id: 'photo60', code: 'Фото', label: 'Фото(60)', name: 'Фотосесія 60хв', icon: '📸', category: 'photo', duration: 60, price: 1600, hosts: 1, description: 'Професійний фотограф зафіксує всі яскраві моменти свята; 50–80 оброблених фотографій. Чекати до тижня.' },
    { id: 'photo_magnets', code: 'Фото+', label: 'Фото+(60)', name: 'Фотосесія + магніти', icon: '📸🧲', category: 'photo', duration: 60, price: 2600, hosts: 1, description: 'Фотосесія 60 хв + магніти на 5 дітей. У цей же день друкуємо 5 фото-магнітів для всіх гостей.' },
    { id: 'photo_magnet_extra', code: 'Магн', label: 'Магн', name: 'Додатковий магніт', icon: '🧲', category: 'photo', duration: 0, price: 290, hosts: 0, perChild: true, description: 'Коли дітей більше п\'яти — замовляйте додаткові магніти (290 ₴/дитина), щоб кожен гість отримав свій сувенір.' },
    { id: 'video', code: 'Відео', label: 'Відео', name: 'Аніматорська відеозйомка', icon: '🎥', category: 'photo', duration: 0, price: 6000, hosts: 0, videoType: 'highlight', description: 'Аніматор зніме динамічне відео (≈90 сек) прямо під час програми; змонтований ролик — протягом тижня.' },

    // Майстер-класи
    { id: 'mk_candy', code: 'Цукерки', label: 'Цукерки(90)', name: 'МК Цукерки', icon: '🍬', category: 'masterclass', duration: 90, price: 370, hosts: 1, perChild: true, age: 'від 7р', kids: '5-25', description: 'Солодка подорож у світ шоколаду: діти дізнаються цікаві факти про історію какао і технологію виготовлення цукерок, власноруч формують свої ласощі. В кінці майстер-класу кожен маленький шоколатьє акуратно упакує створені цукерки в спеціальні подарункові коробочки, щоб потішити рідних і друзів.' },
    { id: 'mk_thermomosaic', code: 'Термо', label: 'Термо(45)', name: 'МК Термомозаїка', icon: '🔲', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true, age: 'від 5р', kids: '5-50', description: 'Діти розташовують кольорові пластикові намистини у заздалегідь підготовлені шаблони. Потім під пильним наглядом праскою вони фіксують композиції, завдяки чому намистинки зварюються в міцне кольорове панно. Кожен учасник забирає додому свій унікальний аксесуар — підставку, брелок або прикрасу.' },
    { id: 'mk_slime', code: 'Слайм', label: 'Слайм(45)', name: 'МК Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true, age: 'від 4р', kids: '5-50', description: 'Учасники власноруч виробляють слайм із бажаною консистенцією, кольором і ефектами, а також мають змогу оформити баночку з авторською етикеткою. Під час заняття діти вивчають базові принципи виготовлення слаймів, вчаться підбирати компоненти і зберігати готовий виріб.' },
    { id: 'mk_tshirt', code: 'Футб', label: 'Футб(90)', name: 'МК Розпис футболок', icon: '👕', category: 'masterclass', duration: 90, price: 450, hosts: 1, perChild: true, age: 'від 6р', kids: '5-25', description: 'Цей майстер-клас не вимагає навичок художника — діти працюють за готовими шаблонами або можуть обрати власну тему для розпису. Вони навчаються поєднувати кольори і стильні елементи, створюючи персональний дизайн, який витримує до 50 прань. В результаті кожен отримує унікальну річ, яку можна носити з гордістю.' },
    { id: 'mk_cookie', code: 'Прян', label: 'Прян(60)', name: 'МК Розпис пряників', icon: '🍪', category: 'masterclass', duration: 60, price: 300, hosts: 1, perChild: true, age: 'від 5р', kids: '5-50', description: 'Майстер-клас із розпису складається з творчої роботи над трьома ароматними пряниками, які заздалегідь випікають для кожного. Діти вчаться акуратно працювати з глазур\'ю, створюють красиві малюнки та отримують смачні сувеніри.' },
    { id: 'mk_ecobag', code: 'Сумки', label: 'Сумки(75)', name: 'МК Розпис еко-сумок', icon: '👜', category: 'masterclass', duration: 75, price: 390, hosts: 1, perChild: true, age: 'від 4р', kids: '5-50', description: 'За час заняття учасники прикрашають екологічні сумки стильними малюнками, вчаться гармонійно поєднувати кольори й форми. Кожен створює унікальний шопер, який стане і модним, і корисним подарунком.' },
    { id: 'mk_pizza_classic', code: 'Піца', label: 'Піца(45)', name: 'МК Класична піца', icon: '🍕', category: 'masterclass', duration: 45, price: 290, hosts: 1, perChild: true, age: 'від 4р', kids: '5-20', description: 'Діти готують справжню італійську піцу з нуля, використовуючи свіже тісто, томатний соус, моцарелу, ковбаски, свіжі помідори. За годину учасники вчаться розкочувати тісто, рівномірно розподіляти інгредієнти та контролювати процес випікання, отримуючи ароматну піцу власного приготування.' },
    { id: 'mk_pizza_custom', code: 'ПіцаК', label: 'ПіцаК(45)', name: 'МК Кастомна піца', icon: '🍕‍🔥', category: 'masterclass', duration: 45, price: 430, hosts: 1, perChild: true, age: 'від 4р', kids: '5-29', description: 'Персоналізована піца за власним рецептом: діти експериментують із смаками, додаючи кукурудзу, копчену курку, цибулю, перець чи зелень на свій розсуд. Гнучкий підхід дозволяє замінити будь-які інгредієнти на ті, що більше подобаються, створюючи справді авторський кулінарний витвір.' },
    { id: 'mk_cakepops', code: 'Кейки', label: 'Кейки(90)', name: 'МК Кейк-попси', icon: '🍡', category: 'masterclass', duration: 90, price: 330, hosts: 1, perChild: true, age: 'від 6р', kids: '5-50', description: 'Діти ліплять бісквітні кульки, занурюють їх у шоколадну глазур і прикрашають кольоровими посипками, а потім акуратно пакують по кілька штук у стильні коробочки. Кожен виготовляє 3 вироби, щоб вистачило і скуштувати, і поділитись.' },
    { id: 'mk_cupcake', code: 'Капк', label: 'Капк(120)', name: 'МК Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 450, hosts: 1, perChild: true, age: 'від 4р', kids: '5-20', description: 'На основі свіжовипічених капкейків, підготовлених майстром заздалегідь, діти створюють яскраві десерти з використанням різних видів крему, топерів і кондитерських прикрас. Кожен учасник декорує власні капкейки згідно з своєю фантазією.' },
    { id: 'mk_soap', code: 'Мило', label: 'Мило(90)', name: 'МК Миловаріння', icon: '🧼', category: 'masterclass', duration: 90, price: 450, hosts: 1, perChild: true, age: 'від 6р', kids: '5-20', description: 'Діти знайомляться з основами натурального миловаріння, обирають ароматні добавки, барвники та формочки для створення унікальних виробів. Учасники дізнаються секрети виготовлення мила своїми руками та красиво пакують готові шматочки, щоб подарувати друзям або залишити собі.' },

    // Піньяти
    { id: 'pinata', code: 'Пін', label: 'Пін(15)', name: 'Піньята', icon: '🪅', category: 'pinata', duration: 15, price: 700, hosts: 1, hasFiller: true, age: '2-99р', kids: 'до 15', description: 'Будь-яка кругла піньята з каталогу на ваш вибір; наповнена цукерками та сюрпризами; розрахована на компанію до 15 дітей.' },
    { id: 'pinata_custom', code: 'ПінН', label: 'ПінН(15)', name: 'Піньята PRO', icon: '🪅⭐', category: 'pinata', duration: 15, price: 1000, hosts: 1, hasFiller: true, age: '2-99р', kids: 'до 15', description: 'Унікальна форма з особливого розділу або піньята на індивідуальне замовлення; втілюємо вашу ідею у життя.' },
    { id: 'pinata_own', code: 'ПінВ', label: 'ПінВ(15)', name: 'Власна піньята', icon: '🪅🏠', category: 'pinata', duration: 15, price: 300, hosts: 1, hasFiller: false, age: '2-99р', kids: 'до 15', description: 'Клієнт приносить свою піньяту; ми тільки проводимо церемонію розбивання.' },

    // Кастомна позиція
    { id: 'custom', code: 'Інше', label: 'Інше', name: 'Інше (вкажіть)', icon: '✏️', category: 'custom', duration: 30, price: 0, hosts: 1, isCustom: true }
];

// ==========================================
// КОСТЮМИ
// ==========================================

const COSTUMES = [
    'Супер Кіт', 'Леді Баг', 'Тік-ток ведучий чорн', 'Тік-ток ведучий син',
    'Майнкрафт Кріпер', 'Піратка 2', 'Пірат 1', 'Ельза', 'Студент Ґоґвортса',
    'Ліло', 'Стіч', 'Єдиноріжка', 'Поняшка', 'Ютуб', 'Людина-павук',
    'Neon-party 1', 'Neon-party 2', 'Супермен', 'Бетмен', 'Мавка', 'Лукаш',
    'Чейз', 'Скай', 'Венсдей', 'Монстер Хай', 'Лялька рожева LOL', 'Барбі', 'Роблокс', 'Стів'
];

// ==========================================
// КОНФІГУРАЦІЯ
// ==========================================

const CONFIG = {
    STORAGE: {
        USERS: 'pzp_users',
        BOOKINGS: 'pzp_bookings',
        LINES: 'pzp_lines',
        LINES_BY_DATE: 'pzp_lines_by_date',
        CURRENT_USER: 'pzp_current_user',
        SESSION: 'pzp_session',
        HISTORY: 'pzp_history'
    },
    TIMELINE: {
        WEEKDAY_START: 12,
        WEEKDAY_END: 20,
        WEEKEND_START: 10,
        WEEKEND_END: 20,
        CELL_WIDTH: 50,
        CELL_MINUTES: 15
    },
    MIN_PAUSE: 15,
    GOOGLE_SHEETS_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRF9EgIT8-T_3vMO8L8dPRnXGZx3B-jrhsroSsEl0xYWlQgK1BFrcxi1awavvLSOxY9vPqcONRYpPk0/pub?gid=0&single=true&output=csv'
};

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

// Кольори категорій для canvas/minimap
const CATEGORY_COLORS = {
    quest: '#9C27B0', animation: '#039BE5', show: '#F4511E',
    photo: '#00ACC1', masterclass: '#7CB342', pinata: '#EC407A', custom: '#546E7A'
};

// Кольори для ліній аніматорів
const LINE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];

// Порядок і назви категорій (єдине джерело правди)
const CATEGORY_ORDER = ['quest', 'animation', 'show', 'photo', 'masterclass', 'pinata', 'custom'];
const CATEGORY_NAMES = {
    quest: 'Квести', animation: 'Анімація', show: 'Шоу',
    photo: 'Фото', masterclass: 'Майстер-класи', pinata: 'Піньяти', custom: 'Інше'
};

// Панель бронювання: інший порядок, деякі розширені назви
const CATEGORY_ORDER_BOOKING = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata', 'custom'];
const CATEGORY_NAMES_BOOKING = {
    animation: 'Анімація', show: 'Wow-Шоу', quest: 'Квести',
    photo: 'Фото послуги', masterclass: 'Майстер-класи', pinata: 'Піньяти', custom: 'Інше'
};

// Каталог програм: повні назви, без 'custom'
const CATEGORY_ORDER_CATALOG = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata'];
const CATEGORY_NAMES_CATALOG = {
    animation: 'Анімаційні розважальні програми', show: 'Wow-Шоу', quest: 'Квести',
    photo: 'Фото послуги', masterclass: 'Майстер-класи', pinata: 'Піньяти'
};
const CATEGORY_ICONS_CATALOG = {
    animation: '🎪', show: '✨', quest: '🗝️', photo: '📸', masterclass: '🎨', pinata: '🎊'
};

// Дашборд: скорочені назви
const CATEGORY_NAMES_SHORT = {
    quest: 'Квести', animation: 'Анімація', show: 'Шоу',
    photo: 'Фото', masterclass: 'МК', pinata: 'Піньяти', custom: 'Інше'
};

// ==========================================
// ФОРМАТУВАННЯ ЦІНИ
// ==========================================

function formatPrice(amount) {
    if (amount === null || amount === undefined) return '0 ₴';
    return Number(amount).toLocaleString('uk-UA') + ' ₴';
}

// ==========================================
// DARK MODE — автоматичний за часом доби
// ==========================================

/**
 * v12.1: Ініціалізація dark mode.
 * Пріоритет: localStorage > автоматично за часом (20:00–7:00 = темна).
 * Застосовує body.dark-mode + data-theme="dark" для повної сумісності.
 */
function initDarkMode() {
    const saved = localStorage.getItem('pzp_dark_mode');
    const autoEnabled = localStorage.getItem('pzp_autoNight') !== 'false';
    let isDark;
    if (saved === 'true') {
        isDark = true;
    } else if (saved === 'false') {
        isDark = false;
    } else if (autoEnabled) {
        // Авто: темна тема з configurable часу (default 19:00-07:00)
        const hour = new Date().getHours();
        const autoStart = parseInt(localStorage.getItem('pzp_night_start') || '19', 10);
        const autoEnd = parseInt(localStorage.getItem('pzp_night_end') || '7', 10);
        isDark = (autoStart > autoEnd) ? (hour >= autoStart || hour < autoEnd) : (hour >= autoStart && hour < autoEnd);
    } else {
        // v33.3: Fallback to system preference
        isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.body.classList.toggle('dark-mode', isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

    // v33.3: Listen for system theme changes (only if no manual override)
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            const manualSaved = localStorage.getItem('pzp_dark_mode');
            if (manualSaved !== null) return; // User set it manually, don't override
            const sysDark = e.matches;
            document.body.classList.toggle('dark-mode', sysDark);
            document.documentElement.setAttribute('data-theme', sysDark ? 'dark' : 'light');
            const icon = document.getElementById('darkModeIcon');
            if (icon) icon.textContent = sysDark ? '☀️' : '🌙';
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = sysDark;
        });
    }

    return isDark;
}

// ==========================================
// ГЛОБАЛЬНИЙ СТАН ДОДАТКУ
// ==========================================

// v5.2: Cache TTL зменшено з 60s до 10s щоб уникнути stale data
const CACHE_TTL = 10000;

const AppState = {
    _currentUser: null,
    selectedDate: new Date(),
    selectedCell: null,
    selectedLineId: null,
    animatorsFromSheet: [],
    cachedBookings: {},
    cachedLines: {},
    multiDayMode: false,
    daysToShow: 3,
    zoomLevel: 15,
    compactMode: false,
    darkMode: false,
    undoStack: [],
    redoStack: [],
    searchQuery: '',
    searchResults: [],
    searchIndex: -1,
    nowLineInterval: null,
    pendingPollInterval: null,  // v3.9: track polling for cleanup
    editingBookingId: null,     // v5.5: ID бронювання в режимі редагування
    statusFilter: 'all',        // v5.15: 'all' | 'confirmed' | 'preliminary'
    // v7.0: Products cache from API
    products: null,             // Array of products from API (or null = not loaded)
    productsLoadedAt: 0         // Timestamp when products were loaded
};

// Auto-update sidebar avatar when currentUser changes
Object.defineProperty(AppState, 'currentUser', {
    get() { return this._currentUser; },
    set(user) {
        this._currentUser = user;
        if (user && typeof Sidebar !== 'undefined' && Sidebar.initUserCard) {
            Sidebar.initUserCard();
        }
    },
    enumerable: true,
    configurable: true
});

// v7.0: Products cache TTL (5 minutes)
const PRODUCTS_CACHE_TTL = 5 * 60 * 1000;

/**
 * v7.0: Get products — from API cache, or fallback to hardcoded PROGRAMS.
 * Maps API response format (camelCase) to match PROGRAMS format for backward compat.
 */
async function getProducts() {
    const now = Date.now();
    // Return cached if still fresh
    if (AppState.products && (now - AppState.productsLoadedAt) < PRODUCTS_CACHE_TTL) {
        return AppState.products;
    }
    // Try to load from API
    if (typeof apiGetProducts === 'function') {
        const apiProducts = await apiGetProducts(true);
        if (apiProducts && apiProducts.length > 0) {
            // Map API camelCase to match existing PROGRAMS format
            AppState.products = apiProducts.map(p => ({
                id: p.id,
                code: p.code,
                label: p.label,
                name: p.name,
                icon: p.icon,
                category: p.category,
                duration: p.duration,
                price: p.price,
                hosts: p.hosts,
                age: p.ageRange,
                kids: p.kidsCapacity,
                description: p.description,
                perChild: p.isPerChild,
                hasFiller: p.hasFiller,
                isCustom: p.isCustom,
                isActive: p.isActive,
                sortOrder: p.sortOrder
            }));
            AppState.productsLoadedAt = now;
            return AppState.products;
        }
    }
    // Fallback to hardcoded PROGRAMS
    return PROGRAMS;
}

/**
 * v7.0: Sync helper — get products from cache or PROGRAMS (no await).
 * Use this when you need sync access and products were already loaded.
 */
function getProductsSync() {
    if (AppState.products && AppState.products.length > 0) {
        return AppState.products;
    }
    return PROGRAMS;
}

// v21.14.0: Auto-init dark mode on all pages that load config.js
initDarkMode();

// v21.15.0: Fallback showNotification for pages without ui.js
// Provides toast functionality for ws.js offline/reconnect indicators
if (typeof showNotification === 'undefined') {
    window.showNotification = function(message, type) {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            container.setAttribute('aria-live', 'polite');
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' ' + type : '');
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function() {
            toast.classList.add('toast-exit');
            setTimeout(function() { toast.remove(); }, 300);
        }, 3000);
    };
}

// v22.8.0: Fallback confirmModal for pages without ui.js
if (typeof confirmModal === 'undefined') {
    window.confirmModal = function(message, options) {
        options = options || {};
        var icons = { danger: '🗑️', success: '✅', warning: '⚠️' };
        return new Promise(function(resolve) {
            var okText = options.okText || 'Підтвердити';
            var cancelText = options.cancelText || 'Скасувати';
            var type = options.type || 'warning';
            var icon = icons[type] || '❓';
            var closed = false;

            var overlay = document.createElement('div');
            overlay.className = 'confirm-overlay';
            overlay.innerHTML =
                '<div class="confirm-dialog ' + type + '">' +
                    '<div class="confirm-icon">' + icon + '</div>' +
                    '<div class="confirm-message">' + message + '</div>' +
                    '<div class="confirm-actions">' +
                        '<button class="confirm-btn confirm-cancel">' + cancelText + '</button>' +
                        '<button class="confirm-btn confirm-ok ' + type + '">' + okText + '</button>' +
                    '</div>' +
                '</div>';

            function close(result) {
                if (closed) return;
                closed = true;
                overlay.classList.add('confirm-exit');
                document.removeEventListener('keydown', onKey);
                setTimeout(function() { overlay.remove(); }, 200);
                resolve(result);
            }

            overlay.querySelector('.confirm-cancel').addEventListener('click', function() { close(false); });
            overlay.querySelector('.confirm-ok').addEventListener('click', function() { close(true); });
            overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });

            function onKey(e) { if (e.key === 'Escape') close(false); }
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
            requestAnimationFrame(function() { overlay.querySelector('.confirm-ok').focus(); });
        });
    };
}
