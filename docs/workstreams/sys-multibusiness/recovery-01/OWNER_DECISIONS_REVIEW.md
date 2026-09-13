# Бізнес-рішення — заповнений приватний draft

Статус: **DRAFT_REVIEW_READY / BUSINESS_DECISIONS_PENDING**. Реальний registry snapshot 2026-09-13T13:03:33.664Z, live SHA `4214598e263057b1cb1524d7fb84f328031d288d`. Погоджені тимчасові SELECT grants уже відкликані, ACL відновлено точно.

Повна оновлена таблиця з назвами: `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913/OWNER_DECISIONS_REVIEW_PRIVATE.md`. Точні ID, before→after proposals і capability diffs у сусідньому `reviewed-draft-mapping.json`; користувачу не потрібно їх шукати. У Git лише агрегати й рекомендації. MD/CRM використовують logical reserved-context refs, business IDs не вигадані.

| Рішення | Факт | Рекомендація та наслідок |
|---|---|---|
| Організація MD/CRM | Одна чинна організація Event Genix Group; Парк/Дар active membership-mode; MD/CRM records відсутні | Додати MD/CRM до цієї організації; не створювати дубль. Окрема організація лише за іншої реальної межі власності |
| Реальний owner | Один активний owner підтверджений organization membership | Зберегти чинного owner; його ім'я і ID вже у приватному пакеті. Не призначати другого owner за creator |
| Працівники MD/CRM | 4 assigned, 3 context-admitted, 1 denied; 104 access rows за exact live policy + DB snapshot | Зберегти права директорки та default Парк. Четвертому не додавати доступ. Domain/JWT QA ще не виконувався |
| Operational роль двох creator | Чинний owner і ще один акаунт; призначення другого невідоме | Для owner запропоновано director + окреме MD delegation; для іншого потрібне уточнення людина/технічний акаунт. Не копіювати creator і не відкривати payroll |
| MD delegation | Є реальні bookings/leads/tasks; product references частково external-compatible | Делегувати необхідні timeline/programs дії без platform creator, після перевірки точних capability boundaries. Не вигадувати products IDs |
| Required modules | MD/CRM мають lists у live policy, але ще не мають registry rows. Повні Park/Dar modules прочитані | Зберегти списки як required baseline. HR/payment/Art blockers не приховувати вимкненням модулів |
| 9 конкретних каталогів | У приватній таблиці є назви, status, page counts; durable owner відсутній | Погодити бізнес кожного root; перевірені children успадковують root. Не використовувати назву/creator як автоматичний доказ |
| 3 чинні public tokens | Значення не читалися | Не перевидавати/не закривати до рішення. Після погодження зв'язати owner, publication state й assets; private за замовчуванням для нових публікацій |
| 72 assets / 17 pages | Глобальні ownerless матеріали | Перевірити всі consumers і mixed ownership перед asset mapping; URL/filename не доказ власності |
| 2 auto_enabled settings | Catalog automation rows=0 | Перевірити фактичний scheduler/consumer, scope й погоджених recipients. Нічого не запускати для перевірки |
| Templates / recurring | 0/0 у snapshot | Empty mapping цього snapshot; підтримку future business-owned creation/retries все одно реалізувати |
| 5 Hermes jobs | Уже event_genix, статуси ready_for_review/revision_requested | Залишити там; не переспрямовувати в MD/CRM; не повторювати jobs/provider calls |

Отримано owners/admins, усі 30 Park/Dar memberships, module lists, before/defaults і 104 pure-policy access rows. Залишаються бізнес-рішення щодо 9 roots, публічності, другого creator-акаунта та MD delegation; технічна RECOVER-02 робота — повний assets consumer graph, provider/job bindings, domain/JWT acceptance. Жоден missing owner не призначений автоматично.

Пакет доповнено після завершеного grant block. Власник відповідає назвами й бажаними ролями; агент сам зіставляє їх із перевіреними IDs. Один запит бізнес-рішень надіслано в цьому продовженні. Жодне mapping-рішення ще не APPROVED, production mappings не застосовано. Технічне налаштування доступу закрито.
