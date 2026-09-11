# Демосценарій для локального рев’ю

Дані — виключно синтетичні. Не запускати server.js/npm start з production env. Немає save/quote/booking/print/generation/publish/Telegram дій.

## Повтор автоматичного демо

Працювати з `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/products-demo-plan-20260911`, base `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`.

```powershell
npm run check:runtime
node --test tests/products-demo-flow.test.js tests/products-demo-catalog.test.js tests/products-demo-graduation.test.js
$env:NODE_PATH='C:\Users\Plotva\AppData\Local\npm-cache\_npx\420ff84f11983ee5\node_modules'
node 'C:\Users\Plotva\AppData\Local\npm-cache\_npx\420ff84f11983ee5\node_modules\@playwright\test\cli.js' test tests/browser/products-demo.spec.js --workers=1 --reporter=line --output=docs/workstreams/products-demo/evidence/browser-run
```

Playwright і Chromium уже були в локальному кеші; команда нічого не встановлює. На іншій машині використати вже встановлений той самий runner; за його відсутності browser demo BLOCKED_ENVIRONMENT. Тест сам відкриває loopback server на вільному порту, закриває його і браузер після завершення. Можна додати `--headed` для видимого повтору. URLs нижче мають origin цього ephemeral fixture server.

## Маршрут демонстрації

1. `/programs?theme=light`: localStorage навмисно містить saved kitchen, але відкривається «Продукти Парку» із fixture-animation. Показати локальні «Анімації», «Торти», «Меню», «Каталоги».
2. «Торти» → «Детальніше»: ціна **0 ₴/100 г**, увесь довгий опис і наявне локальне fixture-зображення. Enter закриває/відкриває disclosure, focus лишається на summary.
3. «Меню» → «Детальніше»: null показується як «Ціну не вказано»; для 404 image — «Зображення недоступне». Немає запису/редагування даних.
4. `/designs?theme=light#catalog-graduation`: три synthetic packages; next → 2/3, ArrowRight → 3/3 без banner image, reload → 1/3, close → список із «Пакетів: 3». Каталог скролиться, повні послуги читаються. Synthetic count 3 не є числом live пакетів.
5. `/programs#catalogs` → «Конструктор випускного» → `/graduation`. У unit fixtures pending/denied/aggregate не показують цей link.
6. Конструктор: controls, довга назва послуги, summary, packages. Auto-entry дає 750 ₴ за 15 дітей; попередження minimum 599/дитина — існуюча логіка на synthetic даних, не дефект цієї косметики. Не натискати save/КП/print/share.
7. Штатний sidebar → /programs, назад, refresh; info modal відкрити/закрити, sidebar → /designs і /center, назад. У harness /center лише destination stub.
8. `/fixture-parent`: graduation iframe без child sidebar, native link батьківської fixture-сторінки → /programs. Це не повний Art smoke.
9. Повтор пунктів у dark theme та ширинах 390/768/1440. Автотест робить screenshots.

## Артефакти

- [Products light 390](evidence/products-light-390.png), [Products dark 1440](evidence/products-dark-1440.png).
- [Catalog light 1440](evidence/catalog-light-1440.png), [Catalog dark 390](evidence/catalog-dark-390.png).
- [Constructor before 390](evidence/graduation-before-dark-390.png), [after 390](evidence/graduation-dark-390.png), [packages 1440](evidence/graduation-packages-light-1440.png).

`graduation-before-*` зроблено до CSS патча. Решта — після. Before/after constructor використовують той самий services fixture; під час доведення harness кількість package fixtures розширена з 2 до 3, constructor input не змінився. Для Products/catalog before-снимків немає. PNG показують реальну fixture сторінку, не макет і не production.

Безпечне окреме integration QA потребує підтвердженого disposable Express/PostgreSQL середовища. Поточний сценарій не підтверджує збереження package/quote, створення booking, фінансові права, реальні дані, PDF або зовнішні сервіси.


Follow-up harness uses full designs-page.js init/hash; API/auth remain fixtures. Node print tests use spies only; this demo does not create a print document or invoke external export.
