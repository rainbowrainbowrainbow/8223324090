/**
 * Парк Закревського Періоду - Система бронювання
 * v3.6 - Settings page, TG notification improvements, notes fix
 */

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
    { id: 'anim120', code: 'АН', label: 'АН(120)', name: 'Анімація 120хв', icon: '🎪', category: 'animation', duration: 120, price: 2500, hosts: 1, age: '3-9р', kids: '2-8', description: 'Входить аквагрим; ще більше розваг — дітям точно вистачить часу на улюблені ігри.' },
    { id: 'anim_extra', code: '+Вед', label: '+Вед(60)', name: 'Додатковий ведучий', icon: '👯', category: 'animation', duration: 60, price: 700, hosts: 1, description: 'Рекомендуємо, коли дітей багато або вони різного віку.' },

    // Шоу
    { id: 'bubble', code: 'Бульб', label: 'Бульб(30)', name: 'Бульбашкове шоу', icon: '🔵', category: 'show', duration: 30, price: 2400, hosts: 1, age: '2-6р', kids: '2-16', description: 'Ефектні трюки з мильними бульбашками — гігантські кулі, «бульбашка в бульбашці», інтерактивні ігри з дітьми.' },
    { id: 'neon_bubble', code: 'Неон', label: 'Неон(30)', name: 'Шоу неон-бульбашок', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1, age: '2-8р', kids: '2-16', description: 'УФ-світло і бульбашки, що світяться — трюки з димом, великі кулі та фінальний неоновий «дощ».' },
    { id: 'paper', code: 'Папір', label: 'Папір(30)', name: 'Паперове Неон-шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2, age: '4-12р', kids: '4-14', description: 'Танцювальна вечірка під УФ-лампами з паперовим вибухом, флешмобами та груповим фото в неон-стилі.' },
    { id: 'dry_ice', code: 'Лід', label: 'Лід(40)', name: 'Шоу з сухим льодом', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1, age: '4-10р', kids: '2-16', description: 'Інтерактивна наука — густий туман, заморожування предметів і безпечний «льодовий вулкан».' },
    { id: 'football', code: 'Футб', label: 'Футб(90)', name: 'Футбольне шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1, age: '5-12р', kids: '2-16', description: 'Два ведучі (тренер і персонаж), естафети й конкурси з м\'ячами, трюки і фінальний міні-матч.' },
    { id: 'mafia', code: 'Мафія', label: 'Мафія(90)', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1, age: '4-10р', kids: '2-16', description: 'Дитяча детективна гра з ведучим — пояснення правил, розподіл ролей, 6–10 інтригуючих раундів і фінальне визначення переможців.' },

    // Фото послуги
    { id: 'photo60', code: 'Фото', label: 'Фото(60)', name: 'Фотосесія 60хв', icon: '📸', category: 'photo', duration: 60, price: 1600, hosts: 1, description: 'Професійний фотограф зафіксує всі яскраві моменти свята; 50–80 оброблених фотографій. Чекати до тижня.' },
    { id: 'photo_magnets', code: 'Фото+', label: 'Фото+(60)', name: 'Фотосесія + магніти', icon: '📸', category: 'photo', duration: 60, price: 2600, hosts: 1, description: 'Фотосесія 60 хв + у цей же день друкуємо 5 фото-магнітів для всіх гостей.' },
    { id: 'photo_magnet_extra', code: 'Магн', label: 'Магн', name: 'Додатковий магніт', icon: '🧲', category: 'photo', duration: 0, price: 2000, hosts: 0, description: 'Коли дітей більше п\'яти — замовляйте додаткові магніти, щоб кожен гість отримав свій сувенір.' },
    { id: 'video', code: 'Відео', label: 'Відео', name: 'Аніматорська відеозйомка', icon: '🎥', category: 'photo', duration: 0, price: 6000, hosts: 0, description: 'Аніматор зніме динамічне відео (≈90 сек) прямо під час програми; змонтований ролик — протягом тижня.' },

    // Майстер-класи
    { id: 'mk_candy', code: 'МК', label: 'Цукерки(90)', name: 'МК Цукерки', icon: '🍬', category: 'masterclass', duration: 90, price: 370, hosts: 1, perChild: true, age: 'від 7р', kids: '5-25', description: 'Солодка подорож у світ шоколаду: діти дізнаються цікаві факти про історію какао і технологію виготовлення цукерок, власноруч формують свої ласощі. В кінці майстер-класу кожен маленький шоколатьє акуратно упакує створені цукерки в спеціальні подарункові коробочки, щоб потішити рідних і друзів.' },
    { id: 'mk_thermomosaic', code: 'МК', label: 'Термо(45)', name: 'МК Термомозаїка', icon: '🔲', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true, age: 'від 5р', kids: '5-50', description: 'Діти розташовують кольорові пластикові намистини у заздалегідь підготовлені шаблони. Потім під пильним наглядом праскою вони фіксують композиції, завдяки чому намистинки зварюються в міцне кольорове панно. Кожен учасник забирає додому свій унікальний аксесуар — підставку, брелок або прикрасу.' },
    { id: 'mk_slime', code: 'МК', label: 'Слайм(45)', name: 'МК Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true, age: 'від 4р', kids: '5-50', description: 'Учасники власноруч виробляють слайм із бажаною консистенцією, кольором і ефектами, а також мають змогу оформити баночку з авторською етикеткою. Під час заняття діти вивчають базові принципи виготовлення слаймів, вчаться підбирати компоненти і зберігати готовий виріб.' },
    { id: 'mk_tshirt', code: 'МК', label: 'Футб(90)', name: 'МК Розпис футболок', icon: '👕', category: 'masterclass', duration: 90, price: 450, hosts: 1, perChild: true, age: 'від 6р', kids: '5-25', description: 'Цей майстер-клас не вимагає навичок художника — діти працюють за готовими шаблонами або можуть обрати власну тему для розпису. Вони навчаються поєднувати кольори і стильні елементи, створюючи персональний дизайн, який витримує до 50 прань. В результаті кожен отримує унікальну річ, яку можна носити з гордістю.' },
    { id: 'mk_cookie', code: 'МК', label: 'Прян(60)', name: 'МК Розпис пряників', icon: '🍪', category: 'masterclass', duration: 60, price: 300, hosts: 1, perChild: true, age: 'від 5р', kids: '5-50', description: 'Майстер-клас із розпису складається з творчої роботи над трьома ароматними пряниками, які заздалегідь випікають для кожного. Діти вчаться акуратно працювати з глазур\'ю, створюють красиві малюнки та отримують смачні сувеніри.' },
    { id: 'mk_ecobag', code: 'МК', label: 'Сумки(75)', name: 'МК Розпис еко-сумок', icon: '👜', category: 'masterclass', duration: 75, price: 390, hosts: 1, perChild: true, age: 'від 4р', kids: '5-50', description: 'За час заняття учасники прикрашають екологічні сумки стильними малюнками, вчаться гармонійно поєднувати кольори й форми. Кожен створює унікальний шопер, який стане і модним, і корисним подарунком.' },
    { id: 'mk_pizza_classic', code: 'МК', label: 'Піца(45)', name: 'МК Класична піца', icon: '🍕', category: 'masterclass', duration: 45, price: 290, hosts: 1, perChild: true, age: 'від 4р', kids: '5-20', description: 'Діти готують справжню італійську піцу з нуля, використовуючи свіже тісто, томатний соус, моцарелу, ковбаски, свіжі помідори. За годину учасники вчаться розкочувати тісто, рівномірно розподіляти інгредієнти та контролювати процес випікання, отримуючи ароматну піцу власного приготування.' },
    { id: 'mk_pizza_custom', code: 'МК', label: 'ПіцаК(45)', name: 'МК Кастомна піца', icon: '🍕', category: 'masterclass', duration: 45, price: 430, hosts: 1, perChild: true, age: 'від 4р', kids: '5-29', description: 'Персоналізована піца за власним рецептом: діти експериментують із смаками, додаючи кукурудзу, копчену курку, цибулю, перець чи зелень на свій розсуд. Гнучкий підхід дозволяє замінити будь-які інгредієнти на ті, що більше подобаються, створюючи справді авторський кулінарний витвір.' },
    { id: 'mk_cakepops', code: 'МК', label: 'Кейки(90)', name: 'МК Кейк-попси', icon: '🍡', category: 'masterclass', duration: 90, price: 330, hosts: 1, perChild: true, age: 'від 6р', kids: '5-50', description: 'Діти ліплять бісквітні кульки, занурюють їх у шоколадну глазур і прикрашають кольоровими посипками, а потім акуратно пакують по кілька штук у стильні коробочки. Кожен виготовляє 3 вироби, щоб вистачило і скуштувати, і поділитись.' },
    { id: 'mk_cupcake', code: 'МК', label: 'Капк(120)', name: 'МК Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 450, hosts: 1, perChild: true, age: 'від 4р', kids: '5-20', description: 'На основі свіжовипічених капкейків, підготовлених майстром заздалегідь, діти створюють яскраві десерти з використанням різних видів крему, топерів і кондитерських прикрас. Кожен учасник декорує власні капкейки згідно з своєю фантазією.' },
    { id: 'mk_soap', code: 'МК', label: 'Мило(90)', name: 'МК Миловаріння', icon: '🧼', category: 'masterclass', duration: 90, price: 450, hosts: 1, perChild: true, age: 'від 6р', kids: '5-20', description: 'Діти знайомляться з основами натурального миловаріння, обирають ароматні добавки, барвники та формочки для створення унікальних виробів. Учасники дізнаються секрети виготовлення мила своїми руками та красиво пакують готові шматочки, щоб подарувати друзям або залишити собі.' },

    // Піньяти
    { id: 'pinata', code: 'Пін', label: 'Пін(15)', name: 'Піньята', icon: '🎊', category: 'pinata', duration: 15, price: 700, hosts: 1, hasFiller: true, age: '2-99р', kids: 'до 15', description: 'Будь-яка кругла піньята з каталогу на ваш вибір; наповнена цукерками та сюрпризами; розрахована на компанію до 15 дітей.' },
    { id: 'pinata_custom', code: 'ПінН', label: 'ПінН(15)', name: 'Піньята Нестандартна', icon: '🎊', category: 'pinata', duration: 15, price: 1000, hosts: 1, hasFiller: true, age: '2-99р', kids: 'до 15', description: 'Унікальна форма з особливого розділу або піньята на індивідуальне замовлення; втілюємо вашу ідею у життя.' },
    { id: 'pinata_party', code: 'ПінП', label: 'ПінП(15)', name: 'Піньята Паті', icon: '🎉', category: 'pinata', duration: 15, price: 2000, hosts: 1, hasFiller: true, age: '2-99р', kids: 'до 30', description: 'Велика святкова піньята для великих компаній; вміщує більше цукерок та подарунків; ідеально для вечірки до 30 дітей.' },

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
    'Чейз', 'Скай', 'Венсдей', 'Монстер Хай', 'Лялька рожева LOL', 'Барбі', 'Роблокс'
];

// ==========================================
// КОНФІГУРАЦІЯ
// ==========================================

const CONFIG = {
    STORAGE: {
        USERS: 'pzp_users',
        BOOKINGS: 'pzp_bookings',
        LINES: 'pzp_lines',
        LINES_BY_DATE: 'pzp_lines_by_date', // Лінії окремо для кожного дня
        CURRENT_USER: 'pzp_current_user',
        SESSION: 'pzp_session',
        HISTORY: 'pzp_history' // Історія змін
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
    // Пряме посилання на CSV (без API ключа!)
    GOOGLE_SHEETS_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRF9EgIT8-T_3vMO8L8dPRnXGZx3B-jrhsroSsEl0xYWlQgK1BFrcxi1awavvLSOxY9vPqcONRYpPk0/pub?gid=0&single=true&output=csv'
};

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

// ==========================================
// ГЛОБАЛЬНІ ЗМІННІ
// ==========================================

let currentUser = null;
let selectedDate = new Date();
let selectedCell = null;
let selectedLineId = null;
let animatorsFromSheet = []; // Аніматори з Google Sheets
let cachedBookings = {}; // Кеш бронювань по датах
let cachedLines = {}; // Кеш ліній по датах
let multiDayMode = false; // Режим декількох днів
let daysToShow = 3; // Кількість днів для показу
let zoomLevel = 15; // 15, 30, 60 хв
let compactMode = false;
let darkMode = false;
let undoStack = [];
let roomsViewMode = false;
let nowLineInterval = null;

// ==========================================
// API ФУНКЦІЇ (PostgreSQL)
// ==========================================

const API_BASE = '/api';

async function apiGetBookings(date) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${date}`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBookings error:', err);
        // Fallback to localStorage
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        return bookings.filter(b => b.date === date);
    }
}

async function apiCreateBooking(booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(booking)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        // Fallback to localStorage
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings.push(booking);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true, id: booking.id };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        // Fallback to localStorage
        let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings = bookings.filter(b => b.id !== id && b.linkedTo !== id);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true };
    }
}

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getLines error:', err);
        // Fallback to localStorage
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        if (linesByDate[date]) return linesByDate[date];
        return [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
    }
}

async function apiSaveLines(date, lines) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lines)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API saveLines error:', err);
        // Fallback to localStorage
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        linesByDate[date] = lines;
        localStorage.setItem(CONFIG.STORAGE.LINES_BY_DATE, JSON.stringify(linesByDate));
        return { success: true };
    }
}

async function apiGetHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getHistory error:', err);
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
    }
}

async function apiAddHistory(action, user, data) {
    try {
        const response = await fetch(`${API_BASE}/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, user, data })
        });
        if (!response.ok) throw new Error('API error');
    } catch (err) {
        console.error('API addHistory error:', err);
        // Fallback to localStorage
        const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        history.unshift({ id: Date.now(), action, user, data, timestamp: new Date().toISOString() });
        if (history.length > 500) history.pop();
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
    }
}

// ==========================================
// ІНІЦІАЛІЗАЦІЯ
// ==========================================

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initializeDefaultData();
    initializeCostumes();
    loadPreferences();
    checkSession();
    initializeEventListeners();
    // Оновлювати now-лінію кожну хвилину
    nowLineInterval = setInterval(renderNowLine, 60000);
}

function loadPreferences() {
    darkMode = localStorage.getItem('pzp_dark_mode') === 'true';
    compactMode = localStorage.getItem('pzp_compact_mode') === 'true';
    zoomLevel = parseInt(localStorage.getItem('pzp_zoom_level')) || 15;
    if (darkMode) document.body.classList.add('dark-mode');
    if (compactMode) {
        CONFIG.TIMELINE.CELL_WIDTH = 35;
        document.querySelector('.timeline-container')?.classList.add('compact');
    }
    CONFIG.TIMELINE.CELL_MINUTES = zoomLevel;
}

function initializeCostumes() {
    const select = document.getElementById('costumeSelect');
    if (!select) return;

    COSTUMES.forEach(costume => {
        const option = document.createElement('option');
        option.value = costume;
        option.textContent = costume;
        select.appendChild(option);
    });
}

function initializeDefaultData() {
    // Оновлені користувачі
    localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify([
        { username: 'Vitalina', password: 'Vitalina109', role: 'user', name: 'Віталіна' },
        { username: 'Dasha', password: 'Dasha743', role: 'user', name: 'Даша' },
        { username: 'Natalia', password: 'Natalia875', role: 'admin', name: 'Наталія' },
        { username: 'Sergey', password: 'Sergey232', role: 'admin', name: 'Сергій' },
        { username: 'Animator', password: 'Animator612', role: 'viewer', name: 'Аніматор' }
    ]));

    if (!localStorage.getItem(CONFIG.STORAGE.HISTORY)) {
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify([]));
    }

    if (!localStorage.getItem(CONFIG.STORAGE.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
    }

    // 2 лінії за замовчуванням
    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2', name: 'Аніматор 2', color: '#2196F3' }
        ]));
    }
}

// ==========================================
// GOOGLE SHEETS ІНТЕГРАЦІЯ (через CSV)
// ==========================================

async function fetchAnimatorsFromSheet() {
    try {
        const response = await fetch(CONFIG.GOOGLE_SHEETS_CSV);
        if (!response.ok) {
            throw new Error('Помилка завантаження CSV');
        }

        const csvText = await response.text();
        parseAnimatorsCSV(csvText);

    } catch (error) {
        console.error('Помилка завантаження графіку:', error);
    }
}

function parseAnimatorsCSV(csvText) {
    // Парсимо CSV
    const rows = csvText.split('\n').map(row => {
        const cells = [];
        let cell = '';
        let inQuotes = false;
        for (const char of row) {
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) { cells.push(cell.trim()); cell = ''; }
            else cell += char;
        }
        cells.push(cell.trim());
        return cells;
    });

    // Формат дати: DD.MM.YYYY
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const year = selectedDate.getFullYear();
    const todayStr = `${day}.${month}.${year}`;

    console.log('Шукаю дату:', todayStr);

    // Шукаємо рядок заголовків з іменами (містить "Женя" або "Анлі")
    let headerRow = null;
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes('Женя') || rows[i].includes('Анлі')) {
            headerRow = rows[i];
            headerIdx = i;
            break;
        }
    }

    if (!headerRow) {
        console.log('Заголовок не знайдено');
        return;
    }

    // Збираємо аніматорів (колонки після "День", крім "Нікого")
    const animators = [];
    let startCol = headerRow.indexOf('День') + 1;
    if (startCol === 0) startCol = 5;

    for (let j = startCol; j < headerRow.length; j++) {
        const name = headerRow[j];
        if (name && name !== '' && !name.includes('Нікого')) {
            animators.push({ name, col: j });
        }
    }

    console.log('Аніматори:', animators.map(a => a.name));

    // Шукаємо рядок з сьогоднішньою датою
    animatorsFromSheet = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        if (rows[i].some(c => c && c.includes(todayStr))) {
            console.log('Дата знайдена, рядок:', rows[i]);
            for (const a of animators) {
                if (rows[i][a.col] === '1') {
                    animatorsFromSheet.push(a.name);
                }
            }
            break;
        }
    }

    console.log('На зміні:', animatorsFromSheet);
    if (animatorsFromSheet.length > 0) updateLinesFromSheet();
}

async function updateLinesFromSheet() {
    if (animatorsFromSheet.length === 0) return;

    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];

    // Оновити імена ліній відповідно до аніматорів на зміну
    const updatedLines = animatorsFromSheet.map((name, index) => ({
        id: 'line' + Date.now() + index + '_' + formatDate(selectedDate),
        name: name,
        color: colors[index % colors.length],
        fromSheet: true
    }));

    await saveLinesForDate(selectedDate, updatedLines);
    await renderTimeline();
}

// ==========================================
// ЛІНІЇ ПО ДАТАХ
// ==========================================

async function getLinesForDate(date) {
    const dateStr = formatDate(date);
    // Перевірити кеш
    if (cachedLines[dateStr]) {
        return cachedLines[dateStr];
    }
    const lines = await apiGetLines(dateStr);
    cachedLines[dateStr] = lines;
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = formatDate(date);
    cachedLines[dateStr] = lines;
    await apiSaveLines(dateStr, lines);
}

// ==========================================
// ІСТОРІЯ ЗМІН
// ==========================================

function logHistory(action, data) {
    const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
    history.unshift({
        id: Date.now(),
        action: action,
        user: currentUser ? currentUser.username : 'unknown',
        data: data,
        timestamp: new Date().toISOString()
    });
    // Зберігати тільки останні 500 записів
    if (history.length > 500) history.pop();
    localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
}

function getHistory() {
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
}

function canViewHistory() {
    return currentUser !== null;
}

// ==========================================
// АВТОРИЗАЦІЯ
// ==========================================

function checkSession() {
    const session = localStorage.getItem(CONFIG.STORAGE.SESSION);
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (session && savedUser) {
        const data = JSON.parse(session);
        if (Date.now() - data.timestamp < 8 * 60 * 60 * 1000) {
            currentUser = JSON.parse(savedUser);
            showMainApp();
            return;
        }
    }
    showLoginScreen();
}

function login(username, password) {
    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USERS) || '[]');
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        currentUser = user;
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
        localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify({ timestamp: Date.now() }));
        showMainApp();
        return true;
    }
    return false;
}

function logout() {
    currentUser = null;
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function isViewer() {
    return currentUser && currentUser.role === 'viewer';
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('currentUser').textContent = currentUser.name;

    // v3.6: Settings (gear) — тільки для Сергія
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.classList.toggle('hidden', currentUser.username !== 'Sergey');
    }

    // v3.6: Дашборд (icon) — не для Animator
    const dashboardBtn = document.getElementById('dashboardBtn');
    if (dashboardBtn) {
        dashboardBtn.classList.toggle('hidden', isViewer());
    }

    // Показати/сховати кнопку "Розважальні програми"
    const programsTabBtn = document.getElementById('programsTabBtn');
    if (programsTabBtn) {
        programsTabBtn.classList.remove('hidden');
    }

    // Viewer: сховати кнопки редагування
    if (isViewer()) {
        const addLineBtn = document.getElementById('addLineBtn');
        if (addLineBtn) addLineBtn.style.display = 'none';
        const exportBtn = document.getElementById('exportTimelineBtn');
        if (exportBtn) exportBtn.style.display = 'none';
    }

    // Dark mode toggle
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.checked = darkMode;
    const darkIcon = document.getElementById('darkModeIcon');
    if (darkIcon) darkIcon.textContent = darkMode ? '☀️' : '🌙';

    // Compact mode toggle
    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.checked = compactMode;

    // Zoom buttons
    updateZoomButtons();

    // Undo button
    updateUndoButton();

    initializeTimeline();
    renderProgramIcons();
    fetchAnimatorsFromSheet();
    setupSwipe();
}

// ==========================================
// ОБРОБНИКИ ПОДІЙ
// ==========================================

function initializeEventListeners() {
    // Логін
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!login(document.getElementById('username').value, document.getElementById('password').value)) {
            document.getElementById('loginError').textContent = 'Невірний логін або пароль';
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Changelog кнопка
    const changelogBtn = document.getElementById('changelogBtn');
    if (changelogBtn) {
        changelogBtn.addEventListener('click', () => {
            document.getElementById('changelogModal').classList.remove('hidden');
        });
    }

    // Таймлайн
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    document.getElementById('timelineDate').addEventListener('change', (e) => {
        selectedDate = new Date(e.target.value);
        renderTimeline();
        fetchAnimatorsFromSheet();
    });

    document.getElementById('addLineBtn').addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn').addEventListener('click', exportTimelineImage);

    // Режим декількох днів
    const multiDayModeCheckbox = document.getElementById('multiDayMode');
    const daysCountSelect = document.getElementById('daysCount');

    if (multiDayModeCheckbox) {
        multiDayModeCheckbox.addEventListener('change', (e) => {
            multiDayMode = e.target.checked;
            daysCountSelect.classList.toggle('hidden', !multiDayMode);
            renderTimeline();
        });
    }

    if (daysCountSelect) {
        daysCountSelect.addEventListener('change', (e) => {
            daysToShow = parseInt(e.target.value);
            renderTimeline();
        });
    }

    const historyBtnEl = document.getElementById('historyBtn');
    if (historyBtnEl) {
        historyBtnEl.addEventListener('click', showHistory);
    }

    // Панель бронювання
    document.getElementById('closePanel').addEventListener('click', closeBookingPanel);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Редагування лінії
    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn').addEventListener('click', deleteLine);

    // Вибір аніматора зі списку
    const editLineNameSelect = document.getElementById('editLineNameSelect');
    if (editLineNameSelect) {
        editLineNameSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                document.getElementById('editLineName').value = e.target.value;
            }
        });
    }

    // Кнопка управління аніматорами (тільки для Сергія) — legacy
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) {
        animatorsTabBtn.addEventListener('click', showAnimatorsModal);
    }

    // v3.6: Settings button
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettings);

    // Кнопка "Розважальні програми"
    const programsTabBtn = document.getElementById('programsTabBtn');
    if (programsTabBtn) {
        programsTabBtn.addEventListener('click', showProgramsCatalog);
    }

    // v3.2: Zoom
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => changeZoom(parseInt(btn.dataset.zoom)));
    });

    // v3.2: Dark mode
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.addEventListener('change', toggleDarkMode);

    // v3.2: Compact mode
    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.addEventListener('change', toggleCompactMode);

    // v3.2: Undo
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', handleUndo);

    // v3.3: Telegram setup (legacy modal)
    const telegramSetupBtn = document.getElementById('telegramSetupBtn');
    if (telegramSetupBtn) telegramSetupBtn.addEventListener('click', showTelegramSetup);

    // v3.4: Dashboard
    const dashboardBtn = document.getElementById('dashboardBtn');
    if (dashboardBtn) dashboardBtn.addEventListener('click', showDashboard);

    const saveTelegramBtn = document.getElementById('saveTelegramBtn');
    if (saveTelegramBtn) saveTelegramBtn.addEventListener('click', saveTelegramChatId);

    // v3.6: Settings modal buttons
    const settingsSaveAnimatorsBtn = document.getElementById('settingsSaveAnimatorsBtn');
    if (settingsSaveAnimatorsBtn) settingsSaveAnimatorsBtn.addEventListener('click', saveAnimatorsListFromSettings);
    const settingsSaveTelegramBtn = document.getElementById('settingsSaveTelegramBtn');
    if (settingsSaveTelegramBtn) settingsSaveTelegramBtn.addEventListener('click', saveTelegramChatIdFromSettings);

    // v3.3: Digest button
    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) digestBtn.addEventListener('click', sendDailyDigest);

    // Збереження списку аніматорів
    const saveAnimatorsBtn = document.getElementById('saveAnimatorsBtn');
    if (saveAnimatorsBtn) {
        saveAnimatorsBtn.addEventListener('click', saveAnimatorsList);
    }

    // Попередження
    document.getElementById('closeWarning').addEventListener('click', () => {
        document.getElementById('warningBanner').classList.add('hidden');
    });

    // Кастомна програма
    const customDuration = document.getElementById('customDuration');
    if (customDuration) {
        customDuration.addEventListener('change', updateCustomDuration);
    }

    // Toggle другий ведучий (+700 грн)
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.addEventListener('change', (e) => {
            const section = document.getElementById('extraHostAnimatorSection');
            if (e.target.checked) {
                section.classList.remove('hidden');
                populateExtraHostAnimatorSelect();
            } else {
                section.classList.add('hidden');
            }
        });
    }

    // Модалі
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });
}

// ==========================================
// ТАЙМЛАЙН
// ==========================================

function getTimeRange() {
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    return {
        start: isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START,
        end: isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END
    };
}

function initializeTimeline() {
    selectedDate = new Date();
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
}

function renderTimeScale() {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const mark = document.createElement('div');
            mark.className = 'time-mark' + (m === 0 ? ' hour' : ' half');
            mark.textContent = `${h}:${String(m).padStart(2, '0')}`;
            container.appendChild(mark);
        }
    }
    // Додати мітку кінця робочого дня
    const endMark = document.createElement('div');
    endMark.className = 'time-mark hour end-mark';
    endMark.textContent = `${end}:00`;
    container.appendChild(endMark);
}

async function renderTimeline() {
    // Показати кнопку додати аніматора (не для viewer)
    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = isViewer() ? 'none' : '';

    // Режим декількох днів
    if (multiDayMode) {
        await renderMultiDayTimeline();
        return;
    }

    renderTimeScale();

    const container = document.getElementById('timelineLines');
    const lines = await getLinesForDate(selectedDate);
    const bookings = await getBookingsForDate(selectedDate);
    const { start } = getTimeRange();

    // Показати/сховати кнопку історії та дайджесту
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) {
        digestBtn.classList.toggle('hidden', isViewer());
    }

    document.getElementById('dayOfWeekLabel').textContent = DAYS[selectedDate.getDay()];

    // Показати час роботи
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    document.getElementById('workingHours').textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

    container.innerHTML = '';

    lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';

        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${line.color}" data-line-id="${line.id}">
                <span class="line-name">${line.name}</span>
                <span class="line-sub">${line.fromSheet ? '📅 на зміні' : 'редагувати'}</span>
            </div>
            <div class="line-grid" data-line-id="${line.id}">
                ${renderGridCells(line.id)}
            </div>
        `;

        // Бронювання
        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b, start)));

        container.appendChild(lineEl);

        // Клік на хедер лінії
        lineEl.querySelector('.line-header').addEventListener('click', () => editLineModal(line.id));
    });

    // Клік на клітинки
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (e.target === cell) {
                selectCell(cell);
            }
        });
    });

    // v3.2: Now line + minimap
    renderNowLine();
    renderMinimap();
}

function renderGridCells(lineId) {
    let html = '';
    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            html += `<div class="grid-cell${m === 0 ? ' hour' : m === 30 ? ' half' : ''}" data-time="${time}" data-line="${lineId}"></div>`;
        }
    }
    return html;
}

function selectCell(cell) {
    if (isViewer()) return; // Viewer не може створювати бронювання
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    selectedCell = cell;
    selectedLineId = cell.dataset.line;
    openBookingPanel(cell.dataset.time, cell.dataset.line);
}

function createBookingBlock(booking, startHour) {
    const block = document.createElement('div');
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    const isPreliminary = booking.status === 'preliminary';
    block.className = `booking-block ${booking.category}${isPreliminary ? ' preliminary' : ''}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const userLetter = booking.createdBy ? booking.createdBy.charAt(0).toUpperCase() : '';
    const noteText = booking.notes ? `<div class="note-text">${booking.notes}</div>` : '';

    block.innerHTML = `
        <div class="user-letter">${userLetter}</div>
        <div class="title">${booking.label || booking.programCode}: ${booking.room}</div>
        <div class="subtitle">${booking.time}${booking.kidsCount ? ' (' + booking.kidsCount + ' діт)' : ''}</div>
        ${noteText}
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));
    // Tooltip
    block.addEventListener('mouseenter', (e) => showTooltip(e, booking));
    block.addEventListener('mousemove', (e) => moveTooltip(e));
    block.addEventListener('mouseleave', hideTooltip);
    return block;
}

// Режим декількох днів - з міні-таймлайнами
async function renderMultiDayTimeline() {
    const timeScaleEl = document.getElementById('timeScale');
    const linesContainer = document.getElementById('timelineLines');
    const addLineBtn = document.getElementById('addLineBtn');

    // Сховати елементи одноденного режиму
    if (timeScaleEl) timeScaleEl.innerHTML = '';
    if (linesContainer) linesContainer.innerHTML = '';
    if (addLineBtn) addLineBtn.style.display = 'none';

    // Показати/сховати кнопку історії
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }

    // Генерувати дати
    const dates = [];
    const startDate = new Date(selectedDate);
    for (let i = 0; i < daysToShow; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }

    // Оновити інформацію про період
    document.getElementById('dayOfWeekLabel').textContent = `${daysToShow} днів`;
    document.getElementById('workingHours').textContent = `${formatDate(dates[0])} - ${formatDate(dates[dates.length - 1])}`;

    // Створити контейнер для мультиденного відображення
    let multiDayHtml = '<div class="multi-day-container">';

    for (const date of dates) {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const start = isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
        const end = isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
        const cellWidth = 30; // Менші клітинки для компактності

        const lines = await getLinesForDate(date);
        const bookings = await getBookingsForDate(date);

        // Шкала часу для цього дня
        let timeScaleHtml = '<div class="mini-time-scale">';
        for (let h = start; h <= end; h++) {
            timeScaleHtml += `<div class="mini-time-mark${h === end ? ' end' : ''}">${h}:00</div>`;
        }
        timeScaleHtml += '</div>';

        multiDayHtml += `
            <div class="day-section" data-date="${formatDate(date)}">
                <div class="day-section-header">
                    <span>${DAYS[dayOfWeek]}</span>
                    <span class="date-label">${formatDate(date)} (${isWeekend ? '10:00-20:00' : '12:00-20:00'})</span>
                </div>
                <div class="day-section-content">
                    ${timeScaleHtml}
                    <div class="mini-timeline-lines">
        `;

        // Лінії аніматорів з міні-таймлайнами
        for (const line of lines) {
            const lineBookings = bookings.filter(b => b.lineId === line.id);

            multiDayHtml += `
                <div class="mini-timeline-line">
                    <div class="mini-line-header" style="border-left-color: ${line.color}">
                        ${line.name}
                    </div>
                    <div class="mini-line-grid" data-start="${start}" data-end="${end}">
            `;

            // Бронювання на цій лінії
            for (const b of lineBookings) {
                const startMin = timeToMinutes(b.time) - timeToMinutes(`${start}:00`);
                const left = (startMin / 60) * (cellWidth * 4); // 4 клітинки на годину
                const width = (b.duration / 60) * (cellWidth * 4) - 2;

                multiDayHtml += `
                    <div class="mini-booking-block ${b.category}"
                         style="left: ${left}px; width: ${width}px;"
                         data-booking-id="${b.id}"
                         title="${b.label || b.programCode}: ${b.room} (${b.time})">
                        <span class="mini-booking-text">${b.label || b.programCode}</span>
                    </div>
                `;
            }

            multiDayHtml += `
                    </div>
                </div>
            `;
        }

        if (lines.length === 0) {
            multiDayHtml += '<div class="no-bookings">Немає аніматорів</div>';
        }

        multiDayHtml += '</div></div></div>';
    }

    multiDayHtml += '</div>';

    // Вставити в контейнер
    linesContainer.innerHTML = multiDayHtml;

    // Додати обробники кліків на бронювання
    document.querySelectorAll('.mini-booking-block').forEach(item => {
        item.addEventListener('click', () => {
            const bookingId = item.dataset.bookingId;
            // Знайти дату для цього бронювання
            const daySection = item.closest('.day-section');
            if (daySection) {
                const dateStr = daySection.dataset.date;
                // Тимчасово змінити selectedDate для показу деталей
                const originalDate = new Date(selectedDate);
                selectedDate = new Date(dateStr);
                showBookingDetails(bookingId);
                selectedDate = originalDate;
            }
        });
    });
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
    fetchAnimatorsFromSheet();
}

async function getBookingsForDate(date) {
    const dateStr = formatDate(date);
    // Перевірити кеш
    if (cachedBookings[dateStr]) {
        return cachedBookings[dateStr];
    }
    const bookings = await apiGetBookings(dateStr);
    cachedBookings[dateStr] = bookings;
    return bookings;
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function openBookingPanel(time, lineId) {
    const lines = await getLinesForDate(selectedDate);
    const line = lines.find(l => l.id === lineId);

    document.getElementById('selectedTimeDisplay').textContent = time;
    document.getElementById('selectedLineDisplay').textContent = line ? line.name : '-';
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = lineId;

    // Скинути форму
    document.getElementById('roomSelect').value = '';
    document.getElementById('selectedProgram').value = '';
    document.getElementById('bookingNotes').value = '';
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    document.getElementById('programDetails').classList.add('hidden');
    document.getElementById('hostsWarning').classList.add('hidden');
    document.getElementById('customProgramSection').classList.add('hidden');
    document.getElementById('secondAnimatorSection').classList.add('hidden');
    document.getElementById('pinataFillerSection').classList.add('hidden');

    // Скинути toggle додаткового ведучого
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.checked = false;
        document.getElementById('extraHostAnimatorSection').classList.add('hidden');
    }

    // Скинути костюм
    const costumeSelect = document.getElementById('costumeSelect');
    if (costumeSelect) costumeSelect.value = '';

    // v3.2: Скинути статус та к-кість дітей
    const statusRadio = document.querySelector('input[name="bookingStatus"][value="confirmed"]');
    if (statusRadio) statusRadio.checked = true;
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) kidsCountSection.classList.add('hidden');
    const kidsCountInput = document.getElementById('kidsCountInput');
    if (kidsCountInput) kidsCountInput.value = '';

    document.getElementById('bookingPanel').classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
}

function closeBookingPanel() {
    document.getElementById('bookingPanel').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('panel-open');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
}

function renderProgramIcons() {
    const container = document.getElementById('programsIcons');
    container.innerHTML = '';

    const categoryOrder = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata', 'custom'];
    const categoryNames = {
        animation: 'Анімація',
        show: 'Wow-Шоу',
        quest: 'Квести',
        photo: 'Фото послуги',
        masterclass: 'Майстер-класи',
        pinata: 'Піньяти',
        custom: 'Інше'
    };

    categoryOrder.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        // Заголовок категорії
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = categoryNames[cat] || cat;
        container.appendChild(header);

        // Іконки програм
        const grid = document.createElement('div');
        grid.className = 'category-grid';
        programs.forEach(p => {
            const icon = document.createElement('div');
            icon.className = `program-icon ${p.category}`;
            icon.dataset.programId = p.id;
            icon.innerHTML = `
                <span class="icon">${p.icon}</span>
                <span class="name">${p.label}</span>
            `;
            icon.addEventListener('click', () => selectProgram(p.id));
            grid.appendChild(icon);
        });
        container.appendChild(grid);
    });
}

function selectProgram(programId) {
    const program = PROGRAMS.find(p => p.id === programId);
    if (!program) return;

    // Виділити обрану
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    document.querySelector(`[data-program-id="${programId}"]`).classList.add('selected');
    document.getElementById('selectedProgram').value = programId;

    // Показати деталі
    const priceText = program.perChild ? `${program.price} грн/дит` : `${program.price} грн`;
    document.getElementById('detailDuration').textContent = program.duration > 0 ? `${program.duration} хв` : '—';
    document.getElementById('detailHosts').textContent = program.hosts;
    document.getElementById('detailPrice').textContent = priceText;

    const ageEl = document.getElementById('detailAge');
    const kidsEl = document.getElementById('detailKids');
    if (ageEl) ageEl.textContent = program.age || '—';
    if (kidsEl) kidsEl.textContent = program.kids || '—';

    document.getElementById('programDetails').classList.remove('hidden');

    // Кастомна програма
    if (program.isCustom) {
        document.getElementById('customProgramSection').classList.remove('hidden');
    } else {
        document.getElementById('customProgramSection').classList.add('hidden');
    }

    // Вибір наповнювача піньяти
    if (program.hasFiller) {
        document.getElementById('pinataFillerSection').classList.remove('hidden');
        document.getElementById('pinataFillerSelect').value = '';
    } else {
        document.getElementById('pinataFillerSection').classList.add('hidden');
    }

    // Попередження про 2 ведучих та вибір другого аніматора
    if (program.hosts > 1) {
        document.getElementById('hostsWarning').classList.remove('hidden');
        document.getElementById('secondAnimatorSection').classList.remove('hidden');
        populateSecondAnimatorSelect();
    } else {
        document.getElementById('hostsWarning').classList.add('hidden');
        document.getElementById('secondAnimatorSection').classList.add('hidden');
    }

    // v3.2: К-кість дітей для МК (perChild)
    const kidsCountSection = document.getElementById('kidsCountSection');
    if (kidsCountSection) {
        if (program.perChild) {
            kidsCountSection.classList.remove('hidden');
            const kidsInput = document.getElementById('kidsCountInput');
            if (kidsInput) {
                kidsInput.value = '';
                kidsInput.oninput = () => {
                    const count = parseInt(kidsInput.value) || 0;
                    const total = count * program.price;
                    document.getElementById('detailPrice').textContent = count > 0
                        ? `${program.price} x ${count} = ${total} грн`
                        : `${program.price} грн/дит`;
                };
            }
        } else {
            kidsCountSection.classList.add('hidden');
        }
    }
}

async function populateSecondAnimatorSelect() {
    const select = document.getElementById('secondAnimatorSelect');
    const lines = await getLinesForDate(selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть другого аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

function updateCustomDuration() {
    const duration = parseInt(document.getElementById('customDuration').value) || 30;
    document.getElementById('detailDuration').textContent = `${duration} хв`;
}

async function populateExtraHostAnimatorSelect() {
    const select = document.getElementById('extraHostAnimatorSelect');
    const lines = await getLinesForDate(selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const programId = document.getElementById('selectedProgram').value;
    const room = document.getElementById('roomSelect').value;

    if (!programId) {
        showNotification('Оберіть програму', 'error');
        return;
    }

    if (!room) {
        showNotification('Оберіть кімнату', 'error');
        return;
    }

    const program = PROGRAMS.find(p => p.id === programId);
    const time = document.getElementById('bookingTime').value;
    const lineId = document.getElementById('bookingLine').value;

    // Визначити тривалість (для кастомної програми)
    let duration = program.duration;
    let label = program.label;

    if (program.isCustom) {
        duration = parseInt(document.getElementById('customDuration').value) || 30;
        const customName = document.getElementById('customName').value || 'Інше';
        label = `${customName}(${duration})`;
    }

    // Піньята з наповнювачем
    let pinataFiller = '';
    if (program.hasFiller) {
        pinataFiller = document.getElementById('pinataFillerSelect').value;
        if (!pinataFiller) {
            showNotification('Оберіть наповнювач для піньяти', 'error');
            return;
        }
        label = `Пін+${pinataFiller}`;
    }

    // Другий аніматор
    const secondAnimator = program.hosts > 1 ? document.getElementById('secondAnimatorSelect').value : null;

    // Перевірка на накладання та паузу (перечитуємо дані з сервера!)
    // Очистити кеш щоб отримати свіжі дані
    delete cachedBookings[formatDate(selectedDate)];
    const conflict = await checkConflicts(lineId, time, duration);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return;
    }

    // Якщо є другий аніматор - перевірити конфлікти і для нього
    if (secondAnimator) {
        const lines = await getLinesForDate(selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);
        if (secondLine) {
            const secondConflict = await checkConflicts(secondLine.id, time, duration);
            if (secondConflict.overlap) {
                showNotification(`❌ ПОМИЛКА: Час зайнятий у ${secondAnimator}!`, 'error');
                return;
            }
        }
    }

    // Показуємо warning про паузу, але не для піньят
    if (conflict.noPause && program.category !== 'pinata') {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    // Блокування дублікатів програм (виключення: анімація та другий ведучий)
    if (program.category !== 'animation' && programId !== 'anim_extra') {
        const allBookings = await getBookingsForDate(selectedDate);
        const newStart = timeToMinutes(time);
        const newEnd = newStart + duration;

        const duplicate = allBookings.find(b => {
            if (b.programId !== programId) return false;
            const start = timeToMinutes(b.time);
            const end = start + b.duration;
            // Перевіряємо накладання в часі
            return newStart < end && newEnd > start;
        });

        if (duplicate) {
            showNotification(`❌ ПОМИЛКА: ${program.name} вже є о ${duplicate.time}!`, 'error');
            return;
        }
    }

    // Створити бронювання
    const costume = document.getElementById('costumeSelect').value;

    // v3.2: Статус
    const statusEl = document.querySelector('input[name="bookingStatus"]:checked');
    const status = statusEl ? statusEl.value : 'confirmed';

    // v3.2: К-кість дітей (для МК)
    const kidsCountInput = document.getElementById('kidsCountInput');
    const kidsCount = (program.perChild && kidsCountInput) ? (parseInt(kidsCountInput.value) || 0) : 0;
    const finalPrice = program.perChild && kidsCount > 0 ? program.price * kidsCount : program.price;

    const booking = {
        id: 'BK' + Date.now().toString(36).toUpperCase(),
        date: formatDate(selectedDate),
        time: time,
        lineId: lineId,
        programId: programId,
        programCode: program.code,
        label: label,
        programName: program.isCustom ? (document.getElementById('customName').value || 'Інше') : program.name,
        category: program.category,
        duration: duration,
        price: finalPrice,
        hosts: program.hosts,
        secondAnimator: secondAnimator,
        pinataFiller: pinataFiller,
        costume: costume,
        room: room,
        notes: document.getElementById('bookingNotes').value,
        createdBy: currentUser ? currentUser.username : '',
        createdAt: new Date().toISOString(),
        status: status,
        kidsCount: kidsCount || null
    };

    await apiCreateBooking(booking);

    // Записати в історію
    await apiAddHistory('create', currentUser?.username, booking);

    // Якщо потрібно 2 ведучих - створити бронювання для другого аніматора
    if (program.hosts > 1 && secondAnimator) {
        const lines = await getLinesForDate(selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);

        if (secondLine) {
            const secondBooking = {
                ...booking,
                id: 'BK' + (Date.now() + 1).toString(36).toUpperCase(),
                lineId: secondLine.id,
                linkedTo: booking.id
            };
            await apiCreateBooking(secondBooking);
        }
    }

    // Додатковий ведучий (700 грн/год) - якщо toggle увімкнено
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle && extraHostToggle.checked) {
        const extraHostAnimator = document.getElementById('extraHostAnimatorSelect').value;
        if (extraHostAnimator) {
            const lines = await getLinesForDate(selectedDate);
            const extraLine = lines.find(l => l.name === extraHostAnimator);

            if (extraLine) {
                // Тривалість = тривалість основної програми, ціна = 700 грн/год
                const extraDuration = duration;
                const extraPrice = Math.round(700 * (extraDuration / 60));
                const extraBooking = {
                    id: 'BK' + (Date.now() + 2).toString(36).toUpperCase(),
                    date: formatDate(selectedDate),
                    time: time,
                    lineId: extraLine.id,
                    programId: 'anim_extra',
                    programCode: '+Вед',
                    label: `+Вед(${extraDuration})`,
                    programName: 'Додатковий ведучий',
                    category: 'animation',
                    duration: extraDuration,
                    price: extraPrice,
                    hosts: 1,
                    room: room,
                    linkedTo: booking.id,
                    createdBy: currentUser ? currentUser.username : '',
                    createdAt: new Date().toISOString()
                };
                await apiCreateBooking(extraBooking);
            }
        }
    }

    // v3.2: Undo - зберегти створені бронювання
    const createdIds = [booking];
    pushUndo('create', createdIds);

    // v3.3: Telegram сповіщення
    notifyBookingCreated(booking);

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeBookingPanel();
    await renderTimeline();
    showNotification('Бронювання створено!', 'success');
}

async function checkConflicts(lineId, time, duration) {
    const allBookings = await getBookingsForDate(selectedDate);
    const bookings = allBookings.filter(b => b.lineId === lineId);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    let overlap = false;
    let noPause = false;

    for (const b of bookings) {
        const start = timeToMinutes(b.time);
        const end = start + b.duration;

        if (newStart < end && newEnd > start) {
            overlap = true;
            break;
        }

        if (newStart === end || newEnd === start) {
            noPause = true;
        }
        if (newStart > end && newStart < end + CONFIG.MIN_PAUSE) {
            noPause = true;
        }
        if (newEnd > start - CONFIG.MIN_PAUSE && newEnd <= start) {
            noPause = true;
        }
    }

    return { overlap, noPause };
}

function showWarning(text) {
    const banner = document.getElementById('warningBanner');
    document.getElementById('warningText').textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('danger');
}

// ==========================================
// ДЕТАЛІ БРОНЮВАННЯ
// ==========================================

async function showBookingDetails(bookingId) {
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const bookingDate = new Date(booking.date);
    const lines = await getLinesForDate(bookingDate);
    const line = lines.find(l => l.id === booking.lineId);

    // Знайти програму для опису
    const program = PROGRAMS.find(p => p.id === booking.programId);
    const descriptionHtml = program && program.description
        ? `<div class="booking-detail-description"><span class="label">Опис:</span><p>${program.description}</p></div>`
        : '';

    const editControls = isViewer() ? '' : `
        <div class="booking-time-shift">
            <span class="label">Перенести час:</span>
            <div class="time-shift-buttons">
                <button onclick="shiftBookingTime('${booking.id}', -30)">-30</button>
                <button onclick="shiftBookingTime('${booking.id}', -15)">-15</button>
                <button onclick="shiftBookingTime('${booking.id}', 15)">+15</button>
                <button onclick="shiftBookingTime('${booking.id}', 30)">+30</button>
                <button onclick="shiftBookingTime('${booking.id}', 45)">+45</button>
                <button onclick="shiftBookingTime('${booking.id}', 60)">+60</button>
            </div>
        </div>
        <div class="booking-actions">
            <button onclick="deleteBooking('${booking.id}')">Видалити бронювання</button>
        </div>
    `;

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${booking.label || booking.programCode}: ${booking.programName}</h3>
            <p>${booking.room}</p>
        </div>
        <div class="booking-detail-row">
            <span class="label">Дата:</span>
            <span class="value">${booking.date}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Час:</span>
            <span class="value">${booking.time} - ${endTime}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Аніматор:</span>
            <span class="value">${line ? line.name : '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${booking.hosts}${booking.secondAnimator ? ` (+ ${booking.secondAnimator})` : ''}</span>
        </div>
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${booking.costume}</span></div>` : ''}
        ${booking.pinataFiller ? `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">${booking.pinataFiller}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Ціна:</span>
            <span class="value">${booking.price} грн</span>
        </div>
        ${booking.kidsCount ? `<div class="booking-detail-row"><span class="label">Дітей:</span><span class="value">${booking.kidsCount}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Статус:</span>
            <span class="value status-value ${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${booking.notes}</span></div>` : ''}
        ${descriptionHtml}
        ${!isViewer() ? `<div class="status-toggle-section">
            <button class="btn-status-toggle" onclick="changeBookingStatus('${booking.id}', '${booking.status === 'preliminary' ? 'confirmed' : 'preliminary'}')">
                ${booking.status === 'preliminary' ? '✅ Підтвердити' : '⏳ Зробити попереднім'}
            </button>
        </div>` : ''}
        ${editControls}
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

async function deleteBooking(bookingId) {
    // Отримати дані бронювання
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Глибокий пошук всіх пов'язаних бронювань
    // 1. Якщо видаляємо головне — знайти всі linkedTo === bookingId
    // 2. Якщо видаляємо linked — знайти головне (booking.linkedTo) і всі його linked
    let mainBookingId = bookingId;
    let allToDelete = [];

    if (booking.linkedTo) {
        // Ми видаляємо пов'язане — знайти головне і всі інші пов'язані
        mainBookingId = booking.linkedTo;
        const mainBooking = bookings.find(b => b.id === mainBookingId);
        if (mainBooking) {
            allToDelete = bookings.filter(b => b.linkedTo === mainBookingId);
            allToDelete.push(mainBooking);
        } else {
            allToDelete = [booking];
        }
    } else {
        // Ми видаляємо головне — знайти всі пов'язані
        allToDelete = bookings.filter(b => b.linkedTo === bookingId);
        allToDelete.push(booking);
    }

    const othersCount = allToDelete.length - 1;

    // Підтвердження видалення (кастомний confirm для iOS)
    const confirmMsg = othersCount > 0
        ? `Видалити це бронювання разом з ${othersCount} пов'язаним(и)?`
        : 'Видалити це бронювання?';

    const confirmed = await customConfirm(confirmMsg, 'Видалення бронювання');
    if (!confirmed) return;

    // v3.2: Undo - зберегти перед видаленням
    pushUndo('delete', [...allToDelete]);

    // v3.3: Telegram сповіщення
    notifyBookingDeleted(booking);

    // Видалити всі пов'язані бронювання
    for (const b of allToDelete) {
        await apiAddHistory('delete', currentUser?.username, b);
        await apiDeleteBooking(b.id);
    }

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeAllModals();
    await renderTimeline();
    showNotification(othersCount > 0 ? `Видалено ${allToDelete.length} бронювань` : 'Бронювання видалено', 'success');
}

async function shiftBookingTime(bookingId, minutes) {
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Розрахувати новий час
    const newTime = addMinutesToTime(booking.time, minutes);
    const newStart = timeToMinutes(newTime);
    const newEnd = newStart + booking.duration;

    // Перевірка на робочі години
    const bookingDate = new Date(booking.date);
    const isWeekend = bookingDate.getDay() === 0 || bookingDate.getDay() === 6;
    const dayStart = isWeekend ? CONFIG.TIMELINE.WEEKEND_START * 60 : CONFIG.TIMELINE.WEEKDAY_START * 60;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

    if (newStart < dayStart || newEnd > dayEnd) {
        showNotification('Час виходить за межі робочого дня!', 'error');
        return;
    }

    // Перевірка на накладки з іншими бронюваннями
    const otherBookings = bookings.filter(b => b.lineId === booking.lineId && b.id !== bookingId);
    for (const other of otherBookings) {
        const start = timeToMinutes(other.time);
        const end = start + other.duration;

        if (newStart < end && newEnd > start) {
            showNotification('Неможливо перенести - є накладка з іншим бронюванням!', 'error');
            return;
        }
    }

    // Знайти пов'язані бронювання (другий/додатковий ведучий)
    const linkedBookings = bookings.filter(b => b.linkedTo === bookingId);

    // Перевірити накладки для пов'язаних теж
    for (const linked of linkedBookings) {
        const linkedNewTime = addMinutesToTime(linked.time, minutes);
        const linkedNewStart = timeToMinutes(linkedNewTime);
        const linkedNewEnd = linkedNewStart + linked.duration;

        const linkedOthers = bookings.filter(b => b.lineId === linked.lineId && b.id !== linked.id);
        for (const other of linkedOthers) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;
            if (linkedNewStart < end && linkedNewEnd > start) {
                showNotification(`Неможливо перенести - накладка у пов'язаного аніматора!`, 'error');
                return;
            }
        }
    }

    // Оновити основне бронювання
    const newBooking = { ...booking, time: newTime };
    await apiDeleteBooking(bookingId);
    await apiCreateBooking(newBooking);

    // Оновити пов'язані бронювання разом
    for (const linked of linkedBookings) {
        const linkedNewTime = addMinutesToTime(linked.time, minutes);
        const updatedLinked = { ...linked, time: linkedNewTime, linkedTo: newBooking.id };
        await apiDeleteBooking(linked.id);
        await apiCreateBooking(updatedLinked);
    }

    // Записати в історію
    await apiAddHistory('shift', currentUser?.username, { ...newBooking, shiftMinutes: minutes });

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeAllModals();
    await renderTimeline();
    const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} пов'язаних)` : '';
    showNotification(`Час перенесено на ${minutes > 0 ? '+' : ''}${minutes} хв${linkedMsg}`, 'success');
}

// ==========================================
// ПОКАЗ ІСТОРІЇ
// ==========================================

async function showHistory() {
    if (!canViewHistory()) return;

    const history = await apiGetHistory();
    const modal = document.getElementById('historyModal');
    const container = document.getElementById('historyList');

    let html = '';
    if (history.length === 0) {
        html = '<p class="no-history">Історія порожня</p>';
    } else {
        history.slice(0, 100).forEach(item => {
            const date = new Date(item.timestamp).toLocaleString('uk-UA');
            const actionMap = { create: 'Створено', delete: 'Видалено', shift: 'Перенесено', undo_create: '↩ Скасовано створення', undo_delete: '↩ Скасовано видалення' };
            const actionText = actionMap[item.action] || item.action;
            const actionClass = item.action.includes('undo') ? 'action-undo' : (item.action === 'create' ? 'action-create' : 'action-delete');

            html += `
                <div class="history-item ${actionClass}">
                    <div class="history-header">
                        <span class="history-action">${actionText}</span>
                        <span class="history-user">${item.user}</span>
                        <span class="history-date">${date}</span>
                    </div>
                    <div class="history-details">
                        ${item.data?.label || item.data?.programCode || ''}: ${item.data?.room || ''} (${item.data?.date || ''} ${item.data?.time || ''})
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = html;
    modal.classList.remove('hidden');
}

// ==========================================
// РОЗВАЖАЛЬНІ ПРОГРАМИ (вкладка)
// ==========================================

function showProgramsCatalog() {
    const modal = document.getElementById('programsCatalogModal');
    const container = document.getElementById('programsCatalogList');

    const categoryOrder = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata'];
    const categoryNames = {
        animation: 'Анімаційні розважальні програми',
        show: 'Wow-Шоу',
        quest: 'Квести',
        photo: 'Фото послуги',
        masterclass: 'Майстер-класи',
        pinata: 'Піньяти'
    };
    const categoryIcons = {
        animation: '🎪', show: '✨', quest: '🗝️', photo: '📸', masterclass: '🎨', pinata: '🎊'
    };

    let html = '';

    categoryOrder.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        html += `<div class="catalog-category">
            <h4 class="catalog-category-title ${cat}">${categoryIcons[cat] || ''} ${categoryNames[cat]}</h4>
            <div class="catalog-programs">`;

        programs.forEach(p => {
            const priceText = p.perChild ? `${p.price} грн/дит` : `${p.price} грн`;
            const durationText = p.duration > 0 ? `${p.duration} хв` : '';
            const hostsText = p.hosts > 0 ? `${p.hosts} вед.` : '';
            const infoItems = [durationText, hostsText].filter(Boolean).join(', ');

            html += `
                <div class="catalog-program-card ${cat}">
                    <div class="catalog-program-header">
                        <span class="catalog-icon">${p.icon}</span>
                        <div class="catalog-program-info">
                            <span class="catalog-program-name">${p.name}</span>
                            <span class="catalog-program-meta">${priceText}${infoItems ? ' · ' + infoItems : ''}</span>
                        </div>
                    </div>
                    ${p.age || p.kids ? `<div class="catalog-program-tags">
                        ${p.age ? `<span class="catalog-tag age">${p.age}</span>` : ''}
                        ${p.kids ? `<span class="catalog-tag kids">${p.kids} діт</span>` : ''}
                    </div>` : ''}
                    ${p.description ? `<p class="catalog-program-desc">${p.description}</p>` : ''}
                </div>
            `;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
    modal.classList.remove('hidden');
}

// ==========================================
// ЛІНІЇ (АНІМАТОРИ) - окремо для кожного дня
// ==========================================

async function addNewLine() {
    const lines = await getLinesForDate(selectedDate);
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
    const dateStr = formatDate(selectedDate);

    lines.push({
        id: 'line' + Date.now() + '_' + dateStr,
        name: `Аніматор ${lines.length + 1}`,
        color: colors[lines.length % colors.length]
    });

    await saveLinesForDate(selectedDate, lines);
    await renderTimeline();
    showNotification('Аніматора додано', 'success');
}

async function editLineModal(lineId) {
    const lines = await getLinesForDate(selectedDate);
    const line = lines.find(l => l.id === lineId);
    if (!line) return;

    document.getElementById('editLineId').value = line.id;
    document.getElementById('editLineName').value = line.name;
    document.getElementById('editLineColor').value = line.color;

    // Заповнити випадаючий список аніматорів
    populateAnimatorsSelect();

    document.getElementById('editLineModal').classList.remove('hidden');
}

// Отримати збережений список аніматорів
function getSavedAnimators() {
    const saved = localStorage.getItem('pzp_animators_list');
    if (saved) {
        return JSON.parse(saved);
    }
    // Список за замовчуванням
    return ['Женя', 'Анлі', 'Маша', 'Діма', 'Оля', 'Катя', 'Настя', 'Саша'];
}

// Зберегти список аніматорів
function saveAnimatorsList() {
    const textarea = document.getElementById('animatorsList');
    const names = textarea.value.split('\n').map(n => n.trim()).filter(n => n.length > 0);

    if (names.length === 0) {
        showNotification('Введіть хоча б одного аніматора', 'error');
        return;
    }

    localStorage.setItem('pzp_animators_list', JSON.stringify(names));
    closeAllModals();
    showNotification('Список аніматорів збережено!', 'success');
}

// Показати модальне вікно управління аніматорами
function showAnimatorsModal() {
    const animators = getSavedAnimators();
    document.getElementById('animatorsList').value = animators.join('\n');
    document.getElementById('animatorsModal').classList.remove('hidden');
}

// Заповнити select з аніматорами
function populateAnimatorsSelect() {
    const select = document.getElementById('editLineNameSelect');
    if (!select) return;

    const animators = getSavedAnimators();

    select.innerHTML = '<option value="">Оберіть аніматора</option>';
    animators.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

async function handleEditLine(e) {
    e.preventDefault();

    const lineId = document.getElementById('editLineId').value;
    const lines = await getLinesForDate(selectedDate);
    const index = lines.findIndex(l => l.id === lineId);

    if (index !== -1) {
        lines[index].name = document.getElementById('editLineName').value;
        lines[index].color = document.getElementById('editLineColor').value;
        await saveLinesForDate(selectedDate, lines);

        closeAllModals();
        await renderTimeline();
        showNotification('Збережено', 'success');
    }
}

async function deleteLine() {
    const lineId = document.getElementById('editLineId').value;
    const lines = await getLinesForDate(selectedDate);

    if (lines.length <= 1) {
        showNotification('Має бути хоча б один аніматор', 'error');
        return;
    }

    if (!confirm('Видалити цього аніматора?')) return;

    const newLines = lines.filter(l => l.id !== lineId);
    await saveLinesForDate(selectedDate, newLines);

    closeAllModals();
    await renderTimeline();
    showNotification('Аніматора видалено', 'success');
}

// ==========================================
// ЕКСПОРТ У КАРТИНКУ
// ==========================================

async function exportTimelineImage() {
    const bookings = await getBookingsForDate(selectedDate);
    const lines = await getLinesForDate(selectedDate);
    const { start, end } = getTimeRange();

    // Створити canvas для A4
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // A4 розмір в пікселях (300dpi)
    const dpi = 150;
    canvas.width = 297 * dpi / 25.4; // ~1754px
    canvas.height = 210 * dpi / 25.4; // ~1240px (landscape)

    const padding = 40;
    const headerHeight = 80;
    const lineHeight = (canvas.height - headerHeight - padding * 2) / Math.max(lines.length, 1);
    const timeWidth = 120;
    const cellWidth = (canvas.width - padding * 2 - timeWidth) / ((end - start) * 4); // 4 слоти на годину

    // Фон
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Заголовок
    ctx.fillStyle = '#00A651';
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`Парк Закревського Періоду - Таймлайн`, padding, 35);

    ctx.font = '20px Arial';
    ctx.fillText(`${formatDate(selectedDate)} (${DAYS[selectedDate.getDay()]})`, padding, 60);

    // Шкала часу
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += 30) {
            const x = padding + timeWidth + ((h - start) * 4 + m / 15) * cellWidth;
            ctx.fillStyle = m === 0 ? '#333333' : '#888888';
            ctx.font = m === 0 ? 'bold 14px Arial' : '12px Arial';
            ctx.fillText(`${h}:${String(m).padStart(2, '0')}`, x, headerHeight + padding - 10);
        }
    }
    // Додати мітку 20:00
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';
    const endX = padding + timeWidth + ((end - start) * 4) * cellWidth;
    ctx.fillText(`${end}:00`, endX, headerHeight + padding - 10);

    // Лінії аніматорів
    lines.forEach((line, index) => {
        const y = headerHeight + padding + index * lineHeight;

        // Фон лінії
        ctx.fillStyle = index % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
        ctx.fillRect(padding, y, canvas.width - padding * 2, lineHeight);

        // Ім'я аніматора
        ctx.fillStyle = line.color;
        ctx.fillRect(padding, y, 4, lineHeight);

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(line.name, padding + 12, y + lineHeight / 2 + 5);

        // Бронювання
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(booking => {
            const startMin = timeToMinutes(booking.time) - timeToMinutes(`${start}:00`);
            const bx = padding + timeWidth + (startMin / 15) * cellWidth;
            const bw = (booking.duration / 15) * cellWidth - 4;
            const by = y + 8;
            const bh = lineHeight - 16;

            // Колір категорії
            const colors = {
                quest: '#9C27B0',
                animation: '#00BCD4',
                show: '#FF5722',
                photo: '#00ACC1',
                masterclass: '#8BC34A',
                pinata: '#E91E63',
                custom: '#607D8B'
            };

            ctx.fillStyle = colors[booking.category] || '#607D8B';
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 6);
            ctx.fill();

            // Текст
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Arial';
            const text = `${booking.label || booking.programCode}: ${booking.room}`;
            ctx.fillText(text, bx + 6, by + bh / 2 + 4, bw - 12);
        });
    });

    // Сітка
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;

    for (let h = start; h <= end; h++) {
        const x = padding + timeWidth + (h - start) * 4 * cellWidth;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight + padding);
        ctx.lineTo(x, canvas.height - padding);
        ctx.stroke();
    }

    // Завантажити
    const link = document.createElement('a');
    link.download = `timeline_${formatDate(selectedDate)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showNotification('Таймлайн експортовано як картинку!', 'success');
}

// ==========================================
// v3.4: ДАШБОРД (Фінанси + Статистика + Навантаження)
// ==========================================

async function apiGetStats(dateFrom, dateTo) {
    try {
        const response = await fetch(`${API_BASE}/stats/${dateFrom}/${dateTo}`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('apiGetStats error:', err);
        return [];
    }
}

async function showDashboard() {
    if (isViewer()) return;

    const modal = document.getElementById('dashboardModal');
    const container = document.getElementById('dashboardContent');
    container.innerHTML = '<p>Завантаження...</p>';
    modal.classList.remove('hidden');

    const today = new Date();
    const dayOfWeek = today.getDay() || 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [todayBookings, weekBookings, monthBookings] = await Promise.all([
        apiGetStats(formatDate(today), formatDate(today)),
        apiGetStats(formatDate(weekStart), formatDate(weekEnd)),
        apiGetStats(formatDate(monthStart), formatDate(monthEnd))
    ]);

    const todayRevenue = todayBookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
    const weekRevenue = weekBookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
    const monthRevenue = monthBookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);

    const todayCount = todayBookings.length;
    const weekCount = weekBookings.length;
    const monthCount = monthBookings.length;

    // Топ програм
    const programCounts = {};
    monthBookings.forEach(b => {
        const key = b.programName || b.label;
        if (!programCounts[key]) programCounts[key] = { count: 0, revenue: 0 };
        programCounts[key].count++;
        programCounts[key].revenue += b.price || 0;
    });
    const topPrograms = Object.entries(programCounts).sort((a, b) => b[1].count - a[1].count).slice(0, 8);

    // Категорії
    const catCounts = {};
    const catNames = { quest: 'Квести', animation: 'Анімація', show: 'Шоу', photo: 'Фото', masterclass: 'МК', pinata: 'Піньяти', custom: 'Інше' };
    monthBookings.forEach(b => {
        const cat = catNames[b.category] || b.category;
        if (!catCounts[cat]) catCounts[cat] = 0;
        catCounts[cat]++;
    });

    // Навантаження аніматорів
    const animatorHours = {};
    weekBookings.forEach(b => {
        const key = b.lineId;
        if (!animatorHours[key]) animatorHours[key] = { minutes: 0, count: 0 };
        animatorHours[key].minutes += b.duration || 0;
        animatorHours[key].count++;
    });

    const lines = await getLinesForDate(selectedDate);
    const animatorNames = {};
    lines.forEach(l => { animatorNames[l.id] = l.name; });

    let html = `
        <div class="dashboard-grid">
            <div class="dash-card revenue">
                <div class="dash-card-title">Сьогодні</div>
                <div class="dash-card-value">${todayRevenue.toLocaleString()} грн</div>
                <div class="dash-card-sub">${todayCount} бронювань</div>
            </div>
            <div class="dash-card revenue">
                <div class="dash-card-title">Тиждень</div>
                <div class="dash-card-value">${weekRevenue.toLocaleString()} грн</div>
                <div class="dash-card-sub">${weekCount} бронювань</div>
            </div>
            <div class="dash-card revenue">
                <div class="dash-card-title">Місяць</div>
                <div class="dash-card-value">${monthRevenue.toLocaleString()} грн</div>
                <div class="dash-card-sub">${monthCount} бронювань</div>
            </div>
        </div>
        <div class="dashboard-section">
            <h4>🏆 Топ програм (місяць)</h4>
            <div class="dash-list">
                ${topPrograms.map(([name, data], i) =>
                    `<div class="dash-list-item">
                        <span class="dash-rank">${i + 1}</span>
                        <span class="dash-name">${name}</span>
                        <span class="dash-count">${data.count}x</span>
                        <span class="dash-revenue">${data.revenue.toLocaleString()} грн</span>
                    </div>`
                ).join('') || '<p class="no-data">Немає даних</p>'}
            </div>
        </div>
        <div class="dashboard-section">
            <h4>📊 Категорії (місяць)</h4>
            <div class="dash-bars">
                ${Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                    const pct = monthCount > 0 ? Math.round((count / monthCount) * 100) : 0;
                    return `<div class="dash-bar-row">
                        <span class="dash-bar-label">${cat}</span>
                        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
                        <span class="dash-bar-value">${count} (${pct}%)</span>
                    </div>`;
                }).join('') || '<p class="no-data">Немає даних</p>'}
            </div>
        </div>
        <div class="dashboard-section">
            <h4>👤 Навантаження аніматорів (тиждень)</h4>
            <div class="dash-list">
                ${Object.entries(animatorHours).map(([lineId, data]) => {
                    const name = animatorNames[lineId] || lineId.split('_')[0];
                    const hours = (data.minutes / 60).toFixed(1);
                    return `<div class="dash-list-item">
                        <span class="dash-name">${name}</span>
                        <span class="dash-count">${data.count} програм</span>
                        <span class="dash-revenue">${hours} год</span>
                    </div>`;
                }).join('') || '<p class="no-data">Немає даних</p>'}
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// v3.3: TELEGRAM СПОВІЩЕННЯ
// ==========================================

async function apiTelegramNotify(text) {
    try {
        const response = await fetch(`${API_BASE}/telegram/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        return await response.json();
    } catch (err) {
        console.error('Telegram notify error:', err);
    }
}

async function apiGetSetting(key) {
    try {
        const response = await fetch(`${API_BASE}/settings/${key}`);
        const data = await response.json();
        return data.value;
    } catch (err) {
        console.error('getSetting error:', err);
        return null;
    }
}

async function apiSaveSetting(key, value) {
    try {
        await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
    } catch (err) {
        console.error('saveSetting error:', err);
    }
}

function notifyBookingCreated(booking) {
    // v3.6: Не відправляти сповіщення для попередніх бронювань
    if (booking.status === 'preliminary') return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    let text = `📌 <b>Нове бронювання</b>\n\n`;
    text += `✅ Підтверджене\n`;
    text += `🎭 ${booking.label}: ${booking.programName}\n`;
    text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
    text += `🏠 ${booking.room}\n`;
    if (booking.kidsCount) text += `👶 ${booking.kidsCount} дітей\n`;
    if (booking.notes) text += `📝 ${booking.notes}\n`;
    text += `\n👤 Створив: ${booking.createdBy}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

function notifyBookingDeleted(booking) {
    const text = `🗑 <b>Видалено бронювання</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Видалив: ${currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

function notifyStatusChanged(booking, newStatus) {
    const icon = newStatus === 'confirmed' ? '✅' : '⏳';
    const statusText = newStatus === 'confirmed' ? 'ПІДТВЕРДЖЕНО' : 'Попереднє';
    const text = `${icon} <b>Статус змінено: ${statusText}</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Змінив: ${currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

async function sendDailyDigest() {
    const dateStr = formatDate(selectedDate);
    try {
        const response = await fetch(`${API_BASE}/telegram/digest/${dateStr}`);
        const result = await response.json();
        if (result.success) {
            showNotification('Дайджест відправлено в Telegram!', 'success');
        } else {
            showNotification('Telegram не налаштовано', 'error');
        }
    } catch (err) {
        showNotification('Помилка відправки дайджесту', 'error');
    }
}

async function showTelegramSetup() {
    const chatId = await apiGetSetting('telegram_chat_id');
    let chatsHtml = '<p>Завантаження...</p>';

    const modal = document.getElementById('telegramModal');
    document.getElementById('telegramChatId').value = chatId || '';
    document.getElementById('telegramChats').innerHTML = chatsHtml;
    modal.classList.remove('hidden');

    // Load available chats
    try {
        const response = await fetch(`${API_BASE}/telegram/chats`);
        const data = await response.json();
        if (data.chats && data.chats.length > 0) {
            chatsHtml = data.chats.map(c =>
                `<div class="telegram-chat-item" onclick="document.getElementById('telegramChatId').value='${c.id}'">
                    <strong>${c.title || 'Чат'}</strong> <span class="chat-id">${c.id}</span> <span class="chat-type">${c.type}</span>
                </div>`
            ).join('');
        } else {
            chatsHtml = '<p class="no-chats">Бот ще не доданий до жодної групи або немає повідомлень. Додайте бота @MySuperReport_bot до групи і напишіть повідомлення.</p>';
        }
    } catch (err) {
        chatsHtml = '<p>Помилка завантаження</p>';
    }
    document.getElementById('telegramChats').innerHTML = chatsHtml;
}

async function saveTelegramChatId() {
    const chatId = document.getElementById('telegramChatId').value.trim();
    if (!chatId) {
        showNotification('Введіть Chat ID', 'error');
        return;
    }
    await apiSaveSetting('telegram_chat_id', chatId);

    // Test message
    const result = await apiTelegramNotify('🤖 Telegram підключено до системи бронювання Парку Закревського Періоду!');
    closeAllModals();
    showNotification('Telegram налаштовано!', 'success');
}

// ==========================================
// v3.6: НАЛАШТУВАННЯ (Settings)
// ==========================================

async function showSettings() {
    // Заповнити аніматорів
    const animators = getSavedAnimators();
    const animatorsTextarea = document.getElementById('settingsAnimatorsList');
    if (animatorsTextarea) animatorsTextarea.value = animators.join('\n');

    // Telegram — тільки для Сергія
    const tgSection = document.getElementById('settingsTelegramSection');
    if (tgSection) {
        tgSection.style.display = currentUser.username === 'Sergey' ? 'block' : 'none';
    }

    // Завантажити Chat ID
    const chatId = await apiGetSetting('telegram_chat_id');
    const chatIdInput = document.getElementById('settingsTelegramChatId');
    if (chatIdInput) chatIdInput.value = chatId || '';

    // Завантажити чати
    const chatsContainer = document.getElementById('settingsTelegramChats');
    if (chatsContainer) {
        chatsContainer.innerHTML = '<p>Завантаження...</p>';
        try {
            const response = await fetch(`${API_BASE}/telegram/chats`);
            const data = await response.json();
            if (data.chats && data.chats.length > 0) {
                chatsContainer.innerHTML = data.chats.map(c =>
                    `<div class="telegram-chat-item" onclick="document.getElementById('settingsTelegramChatId').value='${c.id}'">
                        <strong>${c.title || 'Чат'}</strong> <span class="chat-id">${c.id}</span> <span class="chat-type">${c.type}</span>
                    </div>`
                ).join('');
            } else {
                chatsContainer.innerHTML = '<p class="no-chats">Бот ще не доданий до жодної групи.</p>';
            }
        } catch (err) {
            chatsContainer.innerHTML = '<p>Помилка завантаження</p>';
        }
    }

    document.getElementById('settingsModal').classList.remove('hidden');
}

function saveAnimatorsListFromSettings() {
    const textarea = document.getElementById('settingsAnimatorsList');
    if (!textarea) return;
    const names = textarea.value.split('\n').map(n => n.trim()).filter(n => n);
    localStorage.setItem('pzp_animators', JSON.stringify(names));
    populateAnimatorsSelect();
    showNotification('Список аніматорів збережено!', 'success');
}

async function saveTelegramChatIdFromSettings() {
    const chatId = document.getElementById('settingsTelegramChatId').value.trim();
    if (!chatId) {
        showNotification('Введіть Chat ID', 'error');
        return;
    }
    await apiSaveSetting('telegram_chat_id', chatId);
    const result = await apiTelegramNotify('🤖 Telegram підключено до системи бронювання Парку Закревського Періоду!');
    showNotification('Telegram налаштовано!', 'success');
}

// ==========================================
// v3.2: ЧЕРВОНА ЛІНІЯ "ЗАРАЗ"
// ==========================================

function renderNowLine() {
    document.querySelectorAll('.now-line, .now-line-top').forEach(el => el.remove());
    const now = new Date();
    if (formatDate(selectedDate) !== formatDate(now)) return;
    if (multiDayMode) return;

    const { start, end } = getTimeRange();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = start * 60;
    if (nowMin < startMin || nowMin > end * 60) return;

    const left = ((nowMin - startMin) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;

    document.querySelectorAll('.line-grid').forEach(grid => {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.left = `${left}px`;
        grid.appendChild(line);
    });

    const timeScale = document.getElementById('timeScale');
    if (timeScale) {
        const marker = document.createElement('div');
        marker.className = 'now-line-top';
        marker.style.left = `${left}px`;
        timeScale.appendChild(marker);
    }
}

// ==========================================
// v3.2: TOOLTIP
// ==========================================

function showTooltip(e, booking) {
    let tooltip = document.getElementById('bookingTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'bookingTooltip';
        tooltip.className = 'booking-tooltip hidden';
        document.body.appendChild(tooltip);
    }
    const endTime = addMinutesToTime(booking.time, booking.duration);
    const statusText = booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене';
    tooltip.innerHTML = `
        <strong>${booking.label}: ${booking.programName}</strong><br>
        🕐 ${booking.time} - ${endTime}<br>
        🏠 ${booking.room} · ${statusText}
        ${booking.kidsCount ? '<br>👶 ' + booking.kidsCount + ' дітей' : ''}
        ${booking.notes ? '<br>📝 ' + booking.notes : ''}
    `;
    tooltip.style.left = `${e.pageX + 12}px`;
    tooltip.style.top = `${e.pageY - 10}px`;
    tooltip.classList.remove('hidden');
}

function moveTooltip(e) {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) {
        tooltip.style.left = `${e.pageX + 12}px`;
        tooltip.style.top = `${e.pageY - 10}px`;
    }
}

function hideTooltip() {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// ==========================================
// v3.2: DARK MODE
// ==========================================

function toggleDarkMode() {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('pzp_dark_mode', darkMode);
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = darkMode;
    const icon = document.getElementById('darkModeIcon');
    if (icon) icon.textContent = darkMode ? '☀️' : '🌙';
}

// ==========================================
// v3.2: COMPACT MODE
// ==========================================

function toggleCompactMode() {
    compactMode = !compactMode;
    CONFIG.TIMELINE.CELL_WIDTH = compactMode ? 35 : 50;
    localStorage.setItem('pzp_compact_mode', compactMode);
    const container = document.querySelector('.timeline-container');
    if (container) container.classList.toggle('compact', compactMode);
    const toggle = document.getElementById('compactModeToggle');
    if (toggle) toggle.checked = compactMode;
    renderTimeline();
}

// ==========================================
// v3.2: ZOOM (15/30/60 хв)
// ==========================================

function changeZoom(level) {
    zoomLevel = level;
    CONFIG.TIMELINE.CELL_MINUTES = level;
    localStorage.setItem('pzp_zoom_level', level);
    updateZoomButtons();
    renderTimeline();
}

function updateZoomButtons() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.zoom) === zoomLevel);
    });
}

// ==========================================
// v3.2: UNDO
// ==========================================

function pushUndo(action, data) {
    undoStack.push({ action, data, timestamp: Date.now() });
    if (undoStack.length > 10) undoStack.shift();
    updateUndoButton();
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (btn) btn.classList.toggle('hidden', undoStack.length === 0);
}

async function handleUndo() {
    if (undoStack.length === 0) return;
    const item = undoStack.pop();

    if (item.action === 'create') {
        for (const b of item.data) {
            await apiDeleteBooking(b.id);
        }
        await apiAddHistory('undo_create', currentUser?.username, item.data[0]);
        showNotification('Створення скасовано', 'warning');
    } else if (item.action === 'delete') {
        for (const b of item.data) {
            await apiCreateBooking(b);
        }
        await apiAddHistory('undo_delete', currentUser?.username, item.data[0]);
        showNotification('Видалення скасовано', 'warning');
    }

    cachedBookings = {};
    await renderTimeline();
    updateUndoButton();
}

// ==========================================
// v3.2: SWIPE (mobile)
// ==========================================

function setupSwipe() {
    const container = document.getElementById('timelineScroll');
    if (!container) return;
    let startX = 0, startY = 0;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
            changeDate(dx > 0 ? -1 : 1);
        }
    }, { passive: true });
}

// ==========================================
// v3.2: ROOMS VIEW
// ==========================================

function toggleRoomsView() {
    roomsViewMode = !roomsViewMode;
    const btn = document.getElementById('roomsViewBtn');
    if (btn) btn.classList.toggle('active', roomsViewMode);
    renderTimeline();
}

async function renderRoomsView() {
    renderTimeScale();
    const container = document.getElementById('timelineLines');
    const bookings = await getBookingsForDate(selectedDate);
    const { start } = getTimeRange();

    const rooms = [...new Set(bookings.map(b => b.room))].filter(Boolean).sort();
    if (rooms.length === 0) {
        container.innerHTML = '<div class="no-bookings">Немає бронювань на цей день</div>';
        return;
    }

    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4', '#795548', '#607D8B'];
    container.innerHTML = '';

    rooms.forEach((room, idx) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';
        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${colors[idx % colors.length]}">
                <span class="line-name">${room}</span>
                <span class="line-sub">кімната</span>
            </div>
            <div class="line-grid">${renderGridCells('room_' + room)}</div>
        `;
        const lineGrid = lineEl.querySelector('.line-grid');
        bookings.filter(b => b.room === room).forEach(b => lineGrid.appendChild(createBookingBlock(b, start)));
        container.appendChild(lineEl);
    });

    renderNowLine();
    renderMinimap();
}

// ==========================================
// v3.2: MINIMAP
// ==========================================

function renderMinimap() {
    const minimap = document.getElementById('minimapContainer');
    if (!minimap || multiDayMode) {
        if (minimap) minimap.classList.add('hidden');
        return;
    }
    minimap.classList.remove('hidden');
    renderMinimapAsync(minimap);
}

async function renderMinimapAsync(container) {
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    canvas.width = container.clientWidth || 300;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = darkMode ? '#2a2a3e' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bookings = await getBookingsForDate(selectedDate);
    const lines = await getLinesForDate(selectedDate);
    const { start, end } = getTimeRange();
    const totalMin = (end - start) * 60;
    const lh = Math.max(6, (canvas.height - 4) / Math.max(lines.length, 1));

    const catColors = { quest: '#9C27B0', animation: '#039BE5', show: '#F4511E', photo: '#00ACC1', masterclass: '#7CB342', pinata: '#EC407A', custom: '#546E7A' };

    lines.forEach((line, i) => {
        const y = 2 + i * lh;
        bookings.filter(b => b.lineId === line.id).forEach(b => {
            const bStart = timeToMinutes(b.time) - start * 60;
            const x = (bStart / totalMin) * canvas.width;
            const w = Math.max((b.duration / totalMin) * canvas.width, 2);
            ctx.fillStyle = catColors[b.category] || '#607D8B';
            if (b.status === 'preliminary') ctx.globalAlpha = 0.5;
            ctx.fillRect(x, y, w, lh - 1);
            ctx.globalAlpha = 1;
        });
    });

    // Now line
    const now = new Date();
    if (formatDate(selectedDate) === formatDate(now)) {
        const nowMin = now.getHours() * 60 + now.getMinutes() - start * 60;
        if (nowMin >= 0 && nowMin <= totalMin) {
            const x = (nowMin / totalMin) * canvas.width;
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }
}

// ==========================================
// v3.2: CHANGE BOOKING STATUS
// ==========================================

async function changeBookingStatus(bookingId, newStatus) {
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const updated = { ...booking, status: newStatus };
    await apiDeleteBooking(bookingId);
    await apiCreateBooking(updated);

    // Оновити linked
    const linked = bookings.filter(b => b.linkedTo === bookingId);
    for (const lb of linked) {
        await apiDeleteBooking(lb.id);
        await apiCreateBooking({ ...lb, status: newStatus });
    }

    // v3.3: Telegram сповіщення
    notifyStatusChanged(booking, newStatus);

    delete cachedBookings[formatDate(selectedDate)];
    closeAllModals();
    await renderTimeline();
    showNotification(`Статус: ${newStatus === 'preliminary' ? 'Попереднє' : 'Підтверджене'}`, 'success');
}

// ==========================================
// ДОПОМІЖНІ
// ==========================================

function formatDate(date) {
    // Використовуємо локальний час замість UTC для уникнення проблем з часовими поясами
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function addMinutesToTime(time, minutes) {
    const total = timeToMinutes(time) + minutes;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// Кастомний confirm для iOS (замість стандартного confirm())
function customConfirm(message, title = 'Підтвердження') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            yesBtn.removeEventListener('touchend', onYes);
            noBtn.removeEventListener('click', onNo);
            noBtn.removeEventListener('touchend', onNo);
        };

        const onYes = (e) => {
            e.preventDefault();
            cleanup();
            resolve(true);
        };

        const onNo = (e) => {
            e.preventDefault();
            cleanup();
            resolve(false);
        };

        // Підтримка і click і touch для iOS
        yesBtn.addEventListener('click', onYes);
        yesBtn.addEventListener('touchend', onYes);
        noBtn.addEventListener('click', onNo);
        noBtn.addEventListener('touchend', onNo);
    });
}

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}
