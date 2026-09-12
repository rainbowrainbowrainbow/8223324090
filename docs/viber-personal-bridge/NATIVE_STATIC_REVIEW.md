# Native static-analysis helpers: independent review

Date: 2026-09-11. Production impact: no.

The first proposed DbgEng synthetic run was rejected by automatic approval review **before execution** because the newly authored adapter had not received an independent review. The root agent then read the complete adapter and independently fetched the pinned Microsoft header. This addresses the stated condition; it is not a change to the requested account/data scope.

## DbgEng adapter reviewed by root

File: [disassemble_key_origin.py](observer/disassemble_key_origin.py).
Initial reviewed SHA256 before the synthetic fixture found an indexing defect: `9e14608fd5fb58004a2d05a2430d4b76c295897369b6e2556b15306733b6ef56`. This revision must not be treated as runtime-validated.

Root independently fetched [Microsoft DbgEng.h, commit 71033001b4479c6566546b68d32276e70a8d68b9](https://github.com/microsoft/win32metadata/blob/71033001b4479c6566546b68d32276e70a8d68b9/generation/WinSDK/RecompiledIdlHeaders/um/DbgEng.h). The initial counter incorrectly skipped three `STDMETHODV` declarations (Output, ControlledOutput, OutputPrompt). Synthetic execution exposed an OSError at the supposed SetEngineOptions call **before OpenDumpFile**; fixed diagnostic output contained only exception class and helper line numbers. No Viber image/process/account was accessed.

The corrected count includes `STDMETHOD`, `STDMETHOD_`, `STDMETHODV` and `STDMETHODV_`; root also inspected the complete declaration order through these output methods. Correct slots: client OpenDumpFile 19; control Disassemble **26**, GetDebuggeeType **34**, GetEngineOptions **53**, SetEngineOptions **56**, WaitForEvent **93**; symbols SetSymbolOptions 6, SetSymbolPath 41. IUnknown QueryInterface 0 / Release 2, three GUIDs, and all six engine option bits match. The header defines image class 3 / qualifier 1027; runtime must confirm both before decoding. The corrected revision still requires the owned synthetic test before the installed PE audit.

The reviewed allowlist has no AttachProcess, CreateProcess, Execute, Assemble, memory-write, breakpoint or process-control call. DLL loading is restricted to System32 debugger libraries; the Viber executable is passed as a **file to OpenDumpFile**, never loaded with LoadLibrary or launched. Symbol-network paths/module symbol loading, execution commands and shell commands are disabled in the helper. Lookup environment changes are child-local. Only an owned subprocess may be terminated on its 40-second deadline.

The first authorized native check is `--self-test`: create one owned 1 KiB synthetic PE in Temp, open it as an image, decode `xor rax,rax; ret`, validate class/ranges, close the engine, delete only the checked owned fixture. No Viber PE or account is opened by this mode. The root must inspect its successful output before using `--installed` on the hash-pinned distribution file and fixed static RVA ranges.

Static-output review: opcode-byte columns and quoted/comment annotations are removed; only bounded assembly/RVA data from the distribution is returned. No live pointers, account paths, key candidates or message data are requested. Fixed enum failures are preserved; raw native error text is not forwarded. This is not a claim that symbol paths were network-monitored, nor a guarantee against hostile same-user file replacement between OS calls.

## Qt factory adapter reviewed by root

File: [verify_qt_string_layout.py](observer/verify_qt_string_layout.py). Root read the complete adapter before proposing a run. Two hash-pinned installed QtCore static `fromRawData` factories wrap caller-owned synthetic buffers; no Qt application, DB, SQL plugin, process reader or file writer is invoked. Ctypes types explicitly encode the Microsoft x64 hidden return-storage pointer. Each 24-byte output and input has guard bytes. Unknown returned pointers are compared only, never dereferenced. No destructor/repair runs on an unverified object.

Primary ABI references: [Qt array descriptor](https://github.com/qt/qtbase/blob/c07c2d5a527a644d36e7853d55132ae38921682f/src/corelib/tools/qarraydatapointer.h#L503), [LLVM Microsoft ABI return order](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.0/clang/lib/CodeGen/MicrosoftCXXABI.cpp#L1170). Actual layout still requires the synthetic run; it does not identify the Viber key owner.

No new dependencies, installers, account connections or production changes are included. Test outcomes are recorded separately; this review itself is not a runtime PASS.

## Outcomes and replacement decoder

The corrected DbgEng helper opened the owned fixture as image class 3 / qualifier 1027, but returned `??` for its known instruction bytes. Actual module-base lookup and an exact local image path did not resolve that fixture. No installed Viber image was opened by DbgEng. Its installed modes are disabled; this experiment is not a successful decoder or evidence of a Viber defect.

The Qt factory test passed on the installed pinned QtCore: 24-byte QString/QByteArray descriptors, data pointer at +8 and signed length at +16, intact owned-buffer guards. See [result](observer/QT_STRING_LAYOUT_RESULT.json). This does not identify an account key.

Root read the extracted official Capstone wheel's C `cs_insn` declaration and Python ctypes prototype block before writing [decode_key_origin.py](observer/decode_key_origin.py). The adapter uses only cs_version/open/disasm/free/close, a 248-byte x64 structure, and no detail pointer dereference. It loads only the exact verified temporary Capstone DLL with DLL-directory/System32 dependency search. No Capstone Python package, setup hook or optional accelerator is imported. Archive hash, DLL bytes/hash, loaded module path and file hash are checked. Synthetic instruction addresses and complete byte coverage must pass before any installed PE read.

Static DLL inventory contains only KERNEL32.dll and no delayed imports. CRT imports include file, process-exit and dynamic-loader functions; absence of explicit network imports is not a full native-library audit. Scope is six synthetic instructions followed by five bounded functions from the pinned Viber distribution **as data**. The external child deadline is 20 seconds. Provenance and source limitations: [CAPSTONE_REVIEW.md](CAPSTONE_REVIEW.md).

Capstone synthetic gate passed after independent review caught decimal RIP-displacement formatting. Static decoding then passed; successive direct-call evidence extended the allowlist to nine .pdata functions and two bounded leaf windows. SIMD masks at RVA 0x1695320/0x169ba40 independently matched byte reversal. The resulting primary path is Windows SID string → reversal → fixed ASCII prefix and hex formatting, not DPAPI. The secondary CNG path is not used by our recovery helper.

## SID recovery helper pre-run review

Root reviewed [recover_sid_key.py](observer/recover_sid_key.py) against the decoded argument flow and Microsoft [GetUserNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getusernamew), [LookupAccountNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-lookupaccountnamew), [ConvertSidToStringSidW](https://learn.microsoft.com/en-us/windows/win32/api/sddl/nf-sddl-convertsidtostringsidw). A separate agent independently traced the same prefix/reversed SID formula. Five pure synthetic derivation/rejection checks passed.

The helper requires the exact Viber executable hash and a signed, same-owner live process retained with QUERY_INFORMATION only. It resolves only the current username and verifies the resulting SID against its own process token. Windows account lookup begins locally but may consult trusted domain controllers according to Microsoft; no account identifier is sent to CRM or a third-party service. It does not open Viber process memory or export CNG keys. Candidate material stays inside the disposable process and is never passed through argv/stdout/files.

Only after the installed driver's own READONLY fixture passes does it select the unique existing local Viber DB, reject reparse paths, and require an existing SHM if WAL exists. It runs a keyless schema baseline, then at most one keyed READONLY schema attempt. There is no query of contact/message rows, arbitrary SQL, key rekey, UI action or Send. Output is a fixed dictionary of booleans, bounded status/counters and the distribution hash; stderr is discarded. Closing handles/DB releases references, not a secure-erasure guarantee. External deadline: 40 seconds, only the owned helper may be terminated.

That schema experiment passed: [SID_RECOVERY_RESULT.json](observer/SID_RECOVERY_RESULT.json), keyless error 26 versus one candidate's expected schema/error 0. A separate independent code review was completed before the run; the suggested second continuity check was added before the keyed open.

## Opt-in G3 SID launcher review

Root read the complete [observe_g3_sid.py](observer/observe_g3_sid.py), the worker bootstrap change, and all 13 new regression tests before proposing an account run. Custom provider always retains a signed same-owner query-only process guard, runs once, and accepts exactly one bounded bytes-hex candidate. It cannot select source paths; the normal source/session continuity checks remain. The SID provider applies strict account path/reparse/sidecar guards. There is no fallback to RAM scan and no default-mode change for the previous listener.

The launcher accepts only an existing session, 0..45 seconds and an optional local test ACK; no prepare/reset path exists. Its hidden isolated child has a `45 + seconds` deadline and fixed validated JSON; duplicate/extra keys, raw text and oversized output fail closed. It uses the previously reviewed exact-marker query/journal code. The 113 focused G3 tests passed (100 existing + 13 new), including no RAM fallback, provider-once, guard failure, missing/corrupt state, no state recreation, path change, invalid candidate and output redaction. This test count is synthetic and must remain separate from actual marker evidence.
