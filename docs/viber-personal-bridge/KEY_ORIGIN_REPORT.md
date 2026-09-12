# Windows Viber: походження ключа й recovery без restart

Дата: **2026-09-11**. Production impact: no.

**GO для відновлення read-only доступу до схеми цієї локальної бази й встановленої збірки. LIMITED для всього Personal Bridge.** Власний helper успішно відкрив схему єдиної знайденої зашифрованої бази поточного Windows profile через незалежно відтворений ключ. Windows і Viber не перезапускали; пам'ять Viber не сканували. Це закриває конкретну перешкоду повторного bootstrap, яка блокувала G3. Автентичність Viber account identity, приймання контрольних повідомлень, правильного адресата й Send цей результат сам по собі не доводить.

Фактичний результат: [SID_RECOVERY_RESULT.json](observer/SID_RECOVERY_RESULT.json). Реалізація: [recover_sid_key.py](observer/recover_sid_key.py). Попередня невдача пошуку повного тексту PRAGMA не означала, що доступ неможливо відновити іншим способом.

## 1. Що перевірено запуском

Один fresh Python child, зовнішній timeout 40 секунд; завершився приблизно за 3,7 секунди. Власник раніше дозволив свій акаунт для цього read-only досліду.

| Перевірка | Фактичний результат |
|---|---|
| Exact Viber build/hash | Збіг SHA256; підписаний Viber Media процес, той самий Windows owner |
| Джерело SID | GetUserNameW → LookupAccountNameW; результат збігається з TokenUser helper-процесу |
| Власний тест встановленого SQL driver | READONLY fixture PASS; SEE підтверджений |
| Наявна DB без поданого ключа | Схема не читається; SQLite base error `26` |
| Та сама DB з одним відтвореним кандидатом | Схема читається; error `0`; очікувані поля чотирьох таблиць наявні |
| File/process continuity | File ID не змінився; утриманий початковий Viber process залишився живим |
| RAM scan / CNG export / Send | `false` / `false` / `0` |
| Приватні повідомлення/контакти в цьому досліді | Рядки даних не запитувалися; лише allowlisted schema metadata |
| SID/ключ у файлах, argv чи звіті | Не передавалися й не зберігалися |

Метод перевірено тільки на наявній локальній базі цієї збірки. Доказ нового bootstrap не є тестом фактичного перезапуску Viber, relink, іншого Windows-користувача чи оновлення програми.

## 2. Точна статична прив'язка

Viber **26.3.2-0-g1354dae28ea**, `Viber.exe` SHA256:

`7c6f4f7c463e631f43590a189ee40e3cad733759afd04d89fc80e25ae610f99b`

Початковий [xref reader](observer/trace_key_origin.py) знаходив лише byte-pattern candidates. Після окремого синтетичного gate [offline decoder](observer/decode_key_origin.py) перевірив instruction boundaries дев'яти `.pdata` функцій. Два додаткові leaf windows позначені окремо: це обмежені ділянки без `.pdata`, не автоматично визначені повні функції. [Повний статичний результат](observer/KEY_ORIGIN_DECODE_RESULT.json) містить тільки код distribution-файлу, без live addresses, ключів чи листування.

| RVA | Підтверджений потік |
|---|---|
| `0x32d550` | Перевіряє `QSqlDatabase::isOpen`. Перший ключ отримує з `0x340fd0`; при невдачі пробує іншу реалізацію `0x341420` |
| `0x340290` | Аргумент `RDX` зберігає у `R14`; подає його як QString argument до шаблону PRAGMA. `R8b=0` обирає `hexkey`, `R8b!=0` — `hexrekey` |
| `0x3403d6` → `0x3403e1` → `0x3403f0` | `R8=R14` → `QString::arg` → `QSqlQuery::exec`. Результат не виводився |
| `0x340fd0` / `0x341069` | Копіює global QString за RVA `0x6505fb0`; повертає newly formatted QString |
| `0x519a20` | Ініціалізує цей global: `GetUserNameW` (`0x519ad0`) → helper `0x519390` → `ConvertSidToStringSidW` (`0x519c18`) → QString |
| `0x519390` / `0x519507` | `LookupAccountNameW` для отриманого username; використовує SID, а не телефон Viber або контакт |
| `0x341085` → `0x3410ba` | SID QString → `std::string` → reverse його bytes між begin/end, без NUL |
| `0x341260`, `0x3412d4` | Спочатку fixed printable ASCII prefix, потім reversed ASCII SID; кожен byte виводиться як hex із шириною 2 й заповненням `0` |

Отже, для підтвердженої ASCII-гілки незалежно відтворено:

```text
candidate = uppercase_hex(fixed_prefix_from_pinned_PE + reverse(SID_string_ASCII))
```

Префікс читається з одного fixed RVA `0x5f57e98` лише в RAM; значення не копіюється у helper або звіт. Перевірено довжину 7 і printable ASCII. SID теж не записується. Це не hardcoded готовий account key.

Scalar byte-swap loop і SSE/AVX masks підтверджують reverse; обидві маски з pinned PE збіглися з очікуваними. Microsoft STL [format flags](https://github.com/microsoft/STL/blob/main/stl/inc/xiosbase) відповідають `uppercase=4`, `hex=0x800`. Цей source link рухомий; вирішальні байти встановленого файлу зафіксовані SHA та RVA. Для ASCII немає невизначеності через signed-char/Latin-1 conversion.

Викликати внутрішню функцію Viber для recovery не потрібно. Вона має також `hexrekey` гілку; caller `0x3409e0` містить зміну імені бази, remove/rename. Жодна з цих функцій не виконувалася нашим кодом.

## 3. Що сталося з DPAPI і CNG гіпотезами

Два знайдені виклики `CryptUnprotectData` **не стали основою recovery**. У `0x82ee00` видно файл → `os_crypt` → `encrypted_key` → Base64 → відсікання 5 bytes → DPAPI → QByteArray. У `0x82f580` є prefix branch, 12-byte nonce, crypto helper і legacy DPAPI fallback. Це сильний збіг із [Chromium OSCrypt](https://chromium.googlesource.com/chromium/src/+/63f931c05a5566f6f072c78d95e097998d884376/components/os_crypt/os_crypt_win.cc), але не доведений шлях до Viber DB key. Конкретний browser profile/file не визначали й не відкривали.

Натомість другий **реальний hexkey caller** `0x341420` має CNG fallback: Microsoft Software KSP → наявний named key → `RSAPUBLICBLOB` → modulus bytes. Prefix і modulus форматуються в hex; результат кешується в QString `this+8`. Типи provider/blob підтверджені fixed literal whitelist. Розміщення modulus відповідає [BCRYPT_RSAKEY_BLOB](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/ns-bcrypt-bcrypt_rsakey_blob): offset `24 + cbPublicExp`, довжина `cbModulus`.

У переглянутому тілі видно [NCryptOpenKey](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptopenkey), [NCryptExportKey](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptexportkey) і free; прямих create/import/delete calls немає. Це не повний audit side effects недекодованих internal callees або KSP. У власному helper **CNG не використано**. Немає потреби відкривати Windows key store після успіху первинного SID-шляху. Native Viber flags `0` не гарантують відсутності KSP UI; можливий майбутній окремий fallback потребував би `NCRYPT_SILENT_FLAG` і незалежної перевірки.

## 4. Докази, інструменти й межі

| Рівень | Що встановлено |
|---|---|
| Заявлено авторами GitHub | Startup hooks/експорт на інших ОС; вони не є доказом Windows recovery |
| Підтверджено кодом | Точний SID → hexkey потік у hash-pinned Windows PE; окремі rekey/CNG/browser-crypto гілки |
| Перевірено запуском | Qt QString/QByteArray ABI на власних буферах; 6 decoder instructions; 5 synthetic derivation checks; фактичний read-only schema recovery без restart |
| Не перевірено цим звітом | DUP/NEW/PHONE/DESKTOP marker observations, повний inbox, вкладення, адресат, Send, доставка, зміна Viber version, reboot/lock/RDP/offline |

Вісім synthetic xref tests пройшли окремо. Capstone — [тимчасовий перевірений SDK](CAPSTONE_REVIEW.md), без installer/pip/package hooks і без змін CRM dependencies. Власний direct ctypes wrapper завантажував тільки pinned decoder DLL; Viber executable залишався даними. DbgEng не зміг розібрати власну synthetic fixture, тому його target mode вимкнено. Деталі незалежного review й усунених дефектів: [NATIVE_STATIC_REVIEW.md](NATIVE_STATIC_REVIEW.md).

Windows [GetUserNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getusernamew), [LookupAccountNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-lookupaccountnamew) і [SID conversion](https://learn.microsoft.com/en-us/windows/win32/api/sddl/nf-sddl-convertsidtostringsidw) викликаються лише для поточного користувача. Account lookup може звернутися до trusted domain controllers за штатною семантикою Windows; жоден SID або ключ не передається CRM/сторонньому сервісу.

Зміна binary hash означає відмову, а не припущення про сумісність. Windows SID — ідентифікатор, а не секрет. **Наслідок підтвердженої формули:** у цьому primary DB-key шляху немає секретної складової від Windows password/DPAPI; SID і відповідного public binary достатньо для відтворення кандидата. Це висновок про локальну DB цієї збірки, не про шифрування повідомлень у мережі. Захист тут спирається на права доступу до DB/процесу й захист носія, а не на криптографічну прив'язку ключа до машини. Наш same-owner guard обмежує інструмент, але не змінює цієї властивості формули.

Helper отримує можливість розшифрувати локальну DB у своєму процесі. Release references не гарантує стирання копій із RAM/pagefile. SID/owner не дорівнює номеру Viber або production account ID і недостатній для ізоляції bridge/account/business. Enrollment й перевірка зв'язку активної сесії з обраною DB залишаються окремими gates. Немає підстав переносити Viber session чи key material до Railway.

## 5. Наступна перевірка

**Виконано після schema proof:** [G3 звіт](G3_REPORT.md) містить чотири fresh SID reader processes з **наявною session `0B038E78` і початковою baseline**. Два DUP спостережені; restart не додав записів; local ACK/retry і наступний restart зберегли total=2/pending=0/acked=2. Це окремий live marker proof, не результат schema-only запиту з розділу 1.

Local ACK стосується тільки власного тестового журналу; це не CRM acknowledgement або Viber delivery receipt. Нові контакти, Viber account binding і active recipient залишаються окремими обов'язковими gates перед двостороннім Omni. Наявність ChatInfo.Token у контрольному чаті не підтвердилася; не використовувати це поле як гарантований ID.
