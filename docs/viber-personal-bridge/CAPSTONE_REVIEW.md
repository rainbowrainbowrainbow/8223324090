# Capstone 5.0.9: bounded offline decoder review

Дата: 2026-09-11. Початковий аудит охоплював лише публічні metadata й source. Після нього root перевірив і розпакував exact wheel, виконав синтетичну перевірку DLL та обмежене офлайн-декодування встановленого Viber PE як даних. Python package не імпортували; Viber process/account не відкривали, код Viber не виконували. Результати цих етапів розділені нижче.

**Рішення: обмежений offline x86-64 decoder перевірено запуском на конкретному wheel/DLL.** Шість синтетичних інструкцій та зафіксовані діапазони PE декодовані успішно. Це допоміжний інструмент аналізу bytes PE, не основа Viber bridge і не доказ доступу до ключа.

## Точний артефакт

За [PyPI JSON для 5.0.9](https://pypi.org/pypi/capstone/5.0.9/json) і [сторінкою Windows wheel](https://pypi.org/project/capstone/5.0.9/#capstone-5.0.9-py3-none-win_amd64.whl):

| Поле | Значення |
| --- | --- |
| Filename | `capstone-5.0.9-py3-none-win_amd64.whl` |
| Bytes | `1273459` |
| SHA256 | `732cedbbb56d42e723f14d7af6387f1454194a820b4b96b56d1e53f865ef85d0` |
| Upload | `2026-05-28T16:05:56.730987Z` |
| Yanked | `false` |
| Python | `>=3.8`; `importlib-resources` потрібний лише для Python `<3.9` |
| Trusted Publishing | `No`; upload через `twine/6.1.0 CPython/3.13.12` |

[Exact wheel download](https://files.pythonhosted.org/packages/50/e6/6f06fdb6a9ed32b2f7cd9c036b92d5324112c3ef7080f2c71efc367d40dd/capstone-5.0.9-py3-none-win_amd64.whl).

GitHub [release 5.0.9](https://github.com/capstone-engine/capstone/releases/tag/5.0.9) — non-prerelease. [Annotated tag object](https://api.github.com/repos/capstone-engine/capstone/git/tags/841cee33c3c630cf7d321a64f47aefe7b0b8da99) веде на commit `022575848782a4801fd150fdbc927effcbca0864`; GitHub повернув `verification.verified=true`. Це не reproducible-build доказ відповідності wheel цьому source commit. SHA PyPI фіксує отриманий артефакт, а не відсутність дефектів у ньому.

## Що підтверджено source

- [Python loader L349–426](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/capstone/__init__.py#L349): import одразу завантажує `capstone.dll` через `ctypes.CDLL`. Перший каталог — `LIBCAPSTONE_PATH`, потім package `lib`, далі fallback paths. У цьому loader немає завантаження з мережі або build. Якщо DLL існує, помилка `CDLL` не перехоплюється для мовчазного fallback.
- [Cs constructor L913](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/capstone/__init__.py#L913): перевіряє core API major/minor, відкриває decoder і пробує optional relative `ccapstone` import. У temp package не повинно бути неперевірених `.pyd` або іншого optional accelerator.
- [x86.py](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/capstone/x86.py): ctypes structures, operand fields та копіювання details. Цей файл не запускає сторонніх процесів і не читає акаунти.
- [setup.py L111](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/setup.py#L111) містить CMake/build shell commands; [pyproject.toml](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/pyproject.toml) використовує setuptools backend. Ручне читання wheel як ZIP не виконує ці hooks. `pip`, setup і build для цього експерименту не потрібні.

**Version mismatch:** у pinned Python [L180–185](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/bindings/python/capstone/__init__.py#L180) досі `CS_VERSION_EXTRA = 7`, отже source `__version__` дорівнює `5.0.7`. Натомість [pkgconfig.mk](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/pkgconfig.mk) задає package version `5.0.9`. Root підтвердив цей самий stale `5.0.7` marker статичним читанням wrapper у фактичному wheel; wrapper не імпортувався й marker не використовувався для ідентифікації DLL. Runtime `cs_version()` звіряє API `5.0`, а не patch provenance; основні докази артефакту — exact wheel hash та hash/path завантаженої DLL.

## Ліцензія та залишкові ризики

[LICENSE.TXT](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/LICENSE.TXT) — BSD 3-clause; додатково є [LICENSE_LLVM.TXT](https://github.com/capstone-engine/capstone/blob/022575848782a4801fd150fdbc927effcbca0864/LICENSE_LLVM.TXT), University of Illinois/NCSA. Зберігати license notices при поширенні extracted binary/source. Це не зміна залежностей CRM.

Release містить [security backports PR2937](https://github.com/capstone-engine/capstone/pull/2937): зміни для M68K, WASM та version metadata. Публічні release notes називають їх CVE fixes; повного незалежного vulnerability audit не виконано. PyPI `vulnerabilities: []` не доводить безпечність native parser. Подальші DLL inventory і bounded runtime PASS не є повним аудитом native code чи reproducible-build перевіркою.

## Початковий план перевірки

Це checklist, сформований до запуску. Фактично root обрав власний ctypes adapter з пункту 3; стан виконання наведено в наступному розділі.

1. Отримати тільки exact wheel; до розпакування звірити bytes/SHA. Перевірити ZIP member paths, symlink/traversal, кількість і сумарний uncompressed size; не виконувати package hooks. Розпаковувати в власний guarded temp directory.
2. Прочитати METADATA/RECORD, wrapper version/loader та inventory `capstone/lib/capstone.dll`. Статично перевірити PE x64 і залежності DLL. Якщо optional executable modules відрізняються від перевіреного scope — не імпортувати їх.
3. У fresh Python child встановити process-local `LIBCAPSTONE_PATH` на перевірений абсолютний каталог DLL, до import перевірити наявність і hash файлу, явно додати тільки temp package root. Після import перевірити `capstone.__file__`, фактичний module path DLL та hash; не покладатися на loader fallback. Альтернатива — власний маленький ctypes wrapper до verified absolute DLL, якщо потрібні лише базові `cs_disasm` результати.
4. Спочатку кілька фіксованих відомих x86-64 instructions; перевірити mnemonic, operand та instruction size. Лише після PASS — обмежений byte range публічного встановленого PE як даних. Жодного `LoadLibrary(Viber.exe)`, account/RAM читання, network чи довільного target execution. Timeout та reap належать зовнішньому supervisor.

## Подальший результат root: verified artifact і runtime

Попередній DbgEng helper не зміг декодувати відомі bytes власного синтетичного PE; встановлений Viber PE ним не відкривався. Capstone став альтернативою після цієї невдалої fixture-перевірки. Деталі та межі обох adapters: [NATIVE_STATIC_REVIEW.md](NATIVE_STATIC_REVIEW.md).

- Root отримав і розпакував наведений exact wheel після перевірки розміру/SHA256. Setup/build hooks не виконувалися.
- Статичний PE import inventory DLL містить лише `KERNEL32.dll`, delayed imports відсутні. Серед CRT imports є файлові функції, завершення процесу та dynamic loader. Відсутність явних network imports не доводить відсутності будь-якої мережевої поведінки й не є повним аудитом DLL.
- Власний [decode_key_origin.py](observer/decode_key_origin.py) використовує direct ctypes C API `cs_version/open/disasm/free/close`; Capstone Python package і optional accelerators не імпортуються. Перед завантаженням перевірені DLL bytes/hash, після нього — фактичний module path/hash; dependency search обмежений DLL directory/System32. Виконання має зовнішній child timeout.
- SHA256 завантаженої DLL: `76958e18380023a68fd1714fa2e01c594cc6db1955a07ad6937b66e66dc5d6c3`.
- [KEY_ORIGIN_DECODE_RESULT.json](observer/KEY_ORIGIN_DECODE_RESULT.json) повернув `STATIC_DECODE_PASS`, `synthetic_instructions: 6`, `loaded_dll_path_verified: true` та exact wheel/DLL hashes. На момент цього оновлення у `functions` є **11 діапазонів: 9 повних функцій за `.pdata` і 2 обмежені leaf windows**. Leaf windows не позначені повними `.pdata` функціями.
- У тому самому результаті `account_accessed`, `process_accessed`, `viber_code_executed` дорівнюють `false`. Decoder читав лише зафіксовані діапазони hash-pinned дистрибутивного PE як дані; не викликав функції Viber та не перевіряв ключ або доступність DB.

**Evidence levels:** публічні metadata/source — прочитані; exact wheel і DLL imports/hash/path — перевірені root; синтетичне й обмежене офлайн-декодування — PASS запуском root. Повний аудит DLL, відповідність wheel source через reproducible build, робота bridge та доступ до account DB цим експериментом не перевірені.
