# EDU-READY-08C — короткий checklist оператора

Це перевірка **справжнього пристрою**. Desktop DevTools, Playwright, UA й WebKit emulation не зараховуються. Потрібні iPhone/Safari/VoiceOver, iPad/Safari/VoiceOver та Android/Chrome/TalkBack. Працюємо лише з вигаданими даними окремої device-БД; не відкривайте production для записів.

## Запуск на комп’ютері

Тимчасовий доступ наразі **закритий**. Комп’ютер і пристрій мають бути в довіреній Wi-Fi мережі192.168.1.0/24; VPN і guest Wi-Fi не використовувати. Поточна адреса ПК192.168.1.106 може змінитися. Не відкривайте0.0.0.0, tunnel, port forwarding або PostgreSQL у мережі. Локальний HTTP не є перевіркою HTTPS/secure-context features.

PowerShell у цьому worktree, Node22/npm10:

```powershell
Set-Location 'C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix'
. 'C:/Users/Plotva/.eventgenix/codex-crm-secrets.ps1'
$deviceStart = (Resolve-Path 'scripts/start-education-device-preview.js').Path
node $deviceStart start --lan-host 192.168.1.106 --lease-minutes 30
```

Команда тримає preview відкритим максимум30 хвилин. На пристрої відкрийте:
`http://192.168.1.106:3014/?businessContext=dar&educationSchedule=today&date=2026-10-04`.
Login — існуючий приватний test login, підхоплений локально; пароль не надсилати в чат і не знімати на відео. Він використовує чинний CRM login, без обходу прав. Якщо адреса не відкривається, зафіксуйте пристрій/мережу/помилку як BLOCKED_DEVICE: PC preflight не доводить доступність із телефону. Не вимикайте firewall; конфігурацію мережі треба діагностувати окремо.

Другий PowerShell після роботи:

```powershell
Set-Location 'C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix'
& ./scripts/stop-education-device-preview.ps1
```

Або Ctrl+C у вікні запуску. Device-БД зберігається; manual preview3012 і PostgreSQL55469 не зупиняються. Наступний запуск не стирає внесені оператором записи. Не запускати старий02 stop із неперевіреним PID.

## Дані та докази

Перед початком для **кожного** пристрою запишіть точну модель, назву/версію OS, назву/версію browser, оператора та ISO дату/час. `physicalConfirmed=true` лише після фактичної роботи на hardware. Для Safari версію звіряйте з OS/browser About, не вгадуйте з UA. Не записуйте IMEI, serial, Apple/Google account чи реальні контакти.

Результати: `output/education-ready/08C/operator-results.json`. Файли screenshot/video/audio/детальні операторські нотатки: `output/education-ready/08C/evidence/`. У template вже є14 кейсів ×3 пристрої; всі спочатку BLOCKED_DEVICE. Заповнюйте `actual`, `steps`, `orientation`, `theme`, `status`, `evidence`; для D13 також `spokenOutput` — фактично озвучений текст. Для FAIL додайте точні дії, очікуване/фактичне, ID synthetic запису та файл. Пропуск не є PASS.

Кожен evidence reference містить відносний `path` усередині evidence, `device` (`iphone`/`ipad`/`android`), `kind` (`physical-device-screenshot`, `physical-device-video`, `physical-device-audio` або `operator-observation`), ISO `capturedAt`, SHA256. Хеш можна отримати локально:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'output/education-ready/08C/evidence/<ваш-файл>'
node tests/tools/verify-education-device-evidence.js
```

Хеш у JSON — lowercase. `operator-observation` може бути `.txt` з фактичними кроками/спостереженнями; для screen reader бажаний короткий запис екрану зі звуком. Не додавайте паролі, токени або реальні PII. Verifier перевіряє повноту/хеші, а людський review перевіряє самі фізичні докази. Exit0 означає повні PASS усіх42 кейсів; exit1 — FAIL; exit2 — непроведені/неповні перевірки. Desktop technical screenshots не підставляти в physical template.

## Маршрут перевірки — приблизно25–30 хв на пристрій

Вибраний день/anchor:2026-10-04. Сьогодні є «Датчик світла»:11:30,45 хв, Максим Левченко, «Юні винахідники», Кабінет2. Початковий набір:4 викладачі,6 груп/24 дитини в основному synthetic центрі,3 кабінети,36 занять; другий центр/контроль Park окремо. Технічна група «Дослідники звуків — локальна перевірка…» архівна, не використовуйте її як основний сценарій.

Для своїх нових записів додайте назву пристрою до природної назви: «Юні дослідники — iPhone», «Майстерня звуків — iPad», «Світ роботів — Android». Створюйте майбутні заняття на2026-10-05/06/07 відповідно, щоб пристрої не редагували один запис одночасно. Дані лише вигадані, не надсилайте повідомлення.

| ID | Дії та очікування |
| --- | --- |
| D01 | Пройти5 вкладок у portrait/landscape і light/dark. Зафіксувати4 комбінації короткими відео або screenshot-набором. Довгі українські назви переносяться; кнопки доступні. |
| D02 | Створити свою групу, обрати викладача зі списку, місткість6; знайти seeded дитину, зарахувати, reload. Склад/призначення збережені. |
| D03 | Створити заняття через UI: тема, група, кабінет, викладач,45 хв. Reload→картка→Edit лише теми;45 хв і решта полів незмінні. Записати ID. |
| D04 | Native date picker перенести своє заняття на наступний день. Save→reload→картка; та сама тема/45 хв/час/викладач/група/кабінет. Today/day/week: на старій даті відсутнє, на новій є. ID/до/після дадуть незалежно звірити SQL. |
| D05 | Через UI створити серію з2 занять. Перенести один елемент; текст scope зрозумілий, інший незмінний. Скасувати лише обраний, перевірити confirm/cancel. |
| D06 | Відкрити журнал свого заняття; present/absent/excused/очищення. Save→reload→Оновити; статуси/невідмічені та історія автора/часу відповідають діям. Не міняти historical fixture. |
| D07 | Звіт2026-08-05…2026-10-03, усі групи Dar: проведено18, скасовано2, майбутніх0, без журналу5; present38/absent13/excused9/unmarked18. Фільтр групи/reset/reload/native dates. Це незалежні manifest очікування. |
| D08 | Відкрити налаштування education. Прочитати підписи/кабінети; зробити одну тимчасову scoped display-зміну, Save/reload, відновити через UI. Не торкатися auth/integrations. |
| D09 | Відкрити екранну клавіатуру в темі, назві групи й search. Поле/курсор/sticky Save видимі; клавіатура закривається; draft лишається. |
| D10 | Native date/select pickers у формі та report: відкрити, вибрати, cancel, повторно confirm. Записати OS UI, кінцеву дату й відсутність втрати draft. |
| D11 | Scroll довгої форми/журналу/report, rotation із клавіатурою й без. Safe area/notch/home indicator/browser chrome не перекривають critical controls. |
| D12 | Реальний browser/pinch zoom200%, потім повернути100%. Поля/дії доступні; intentional таблиці мають власний scroll. Не підмінювати viewport emulation. |
| D13 | Увімкнути VoiceOver/TalkBack у системі. Gesture navigation: labels/values/action names/порядок. Ввести invalid duration0 чи очистити date; почути помилку й перевірити focus. Записати фактичну вимову, виправити й зберегти. |
| D14 | З screen reader відкрити/закрити картку, Edit, series і confirmation. Назва діалогу озвучується; focus усередині; close доступний; після закриття focus повертається до trigger. |

Після перевірки зупиніть preview, збережіть докази й передайте фактичні результати. Відтворені дефекти ремонтуються окремо вузько в education; source changes потребують нового device run та потрібних browser regressions. Неперевірені пристрої лишаються BLOCKED_DEVICE.
