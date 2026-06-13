# AI Provider Contract

Цей документ фіксує, де Event Genix CRM бере AI-ключі і який provider за що відповідає. Секрети існують тільки на сервері: не класти API keys у HTML, browser JS, localStorage, changelog, screenshots, seed data або тестові fixtures.

## Provider Ownership

| Surface | Primary provider | Env | Notes |
| --- | --- | --- | --- |
| Chat / Guardian / summary / Copilot / translate / Kleshnya / agent summary / catalog trends / Omni lead assistant text rails | OpenRouter | `OPENROUTER_API_KEY` або legacy `OPENROUTER_KEY` | Shared text/token rail через `services/ai-config.js` і OpenRouter chat completions. Direct OpenAI/Anthropic provider-и тут не selectable: старі значення нормалізуються в `openrouter`. |
| Program/product icon prompt refinement | OpenRouter | `OPENROUTER_API_KEY`, `PROGRAM_ICON_PROMPT_MODEL` | Текстові токени/prompt refinement ідуть через OpenRouter. |
| Program/product icon image generation | Kie.ai primary, OpenRouter explicit fallback | `KIE_API_KEY`, `PROGRAM_ICON_IMAGE_PROVIDER`, `PROGRAM_ICON_IMAGE_MODEL`, `OPENROUTER_API_KEY` | `auto` бере Kie.ai media job, коли `KIE_API_KEY` є; OpenRouter image provider лишається ручним fallback. |
| Sound TTS | Kie.ai ElevenLabs job | `KIE_API_KEY` | `routes/music.js` створює TTS job і зберігає готовий audio у CRM uploads. |
| Sound music | Kie.ai Suno API | `KIE_API_KEY`, `KIE_CALLBACK_SECRET`, `PUBLIC_BASE_URL` або `KIE_SUNO_CALLBACK_URL`, optional `KIE_SUNO_MODEL` | Створення йде через Kie Suno task, polling через Suno record-info, готовий файл обов'язково копіюється в CRM uploads. |
| CRM assistant rail text replies | OpenAI direct | `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_ASSISTANT_MODEL` | Поки лишається окремий rail provider boundary у `services/dashboardAssistant.js`. |
| CRM assistant audio/transcription | OpenAI direct | `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | Voice input/output для assistant rail. |
| Kitchen menu AI review drafts | OpenAI direct | `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_MENU_AI_MODEL` | `/api/products/menu-ai-draft` викликає OpenAI Responses API для review-only чернеток меню. Default model: `gpt-5.4-mini`. За відсутності ключа API повертає fallback-чернетку без зміни booking source of truth. |

## Provider Diagnostics

- `/api/settings/ai/providers` повертає server-side карту provider-ів без секретів: OpenRouter shared text rail, Kie media rail, direct OpenAI assistant/menu rail і legacy direct exceptions.
- `/chat-settings` показує цю карту для creator/director/admin, щоб було видно, де бракує `OPENROUTER_API_KEY`, `KIE_API_KEY`, `KIE_CALLBACK_SECRET` або `OPENAI_API_KEY`.
- CRM assistant rail і kitchen menu AI review за рішенням продукту лишаються на direct OpenAI. Інші нові text/token rails мають іти через OpenRouter, якщо немає окремого product decision.

## Legacy Direct Exceptions

- `services/warehousePhotoIntake.js` ще використовує direct OpenAI vision для warehouse photo intake. Планова міграція: OpenRouter vision-capable model або окремий provider contract для vision.
- `services/dashboardAssistant.js` і `services/dashboardAssistantAudio.js` не є legacy cleanup debt у цьому пакеті: CRM assistant rail навмисно лишається direct OpenAI.
- `routes/products.js` для kitchen menu AI review не є legacy cleanup debt: це окремий review-only flow під direct OpenAI.

## Required Media Rules

- Provider URLs для generated audio/image вважаються тимчасовими.
- Backend має одразу завантажити результат у CRM upload storage і записати `storage_provider`, `storage_key`, `storage_url`.
- Якщо CRM не змогла зберегти generated audio, API має повернути controlled error замість запису тимчасового external URL як фінального asset.
- Kie callback endpoints мають бути публічними тільки через `config/authBoundary.js` і guard-итись секретом provider-level (`KIE_CALLBACK_SECRET`).

## OpenRouter Defaults

- Main server env: `OPENROUTER_API_KEY`.
- Legacy alias: `OPENROUTER_KEY`.
- Text models are resolved by `services/ai-config.js`.
- Program icon prompt refinement uses `PROGRAM_ICON_PROMPT_MODEL`.
- OpenRouter image models remain available only when `PROGRAM_ICON_IMAGE_PROVIDER=openrouter` or when Kie is not configured and auto falls back.

## Kie Image Setup

Program/product icon image jobs default to Kie media generation:

```bash
KIE_API_KEY=<server-side-secret>
PROGRAM_ICON_IMAGE_PROVIDER=auto
PROGRAM_ICON_IMAGE_MODEL=nano-banana-2
PROGRAM_ICON_PROMPT_MODEL=openai/gpt-5.4-nano
```

`PROGRAM_ICON_PROMPT_MODEL` is still an OpenRouter text-token model. `PROGRAM_ICON_IMAGE_MODEL` is the Kie image job model unless `PROGRAM_ICON_IMAGE_PROVIDER=openrouter` is explicitly selected.

## Kie Sound Setup

Minimum server env for Sound music:

```bash
KIE_API_KEY=<server-side-secret>
KIE_CALLBACK_SECRET=<random-long-secret>
PUBLIC_BASE_URL=https://<crm-host>
# optional if PUBLIC_BASE_URL cannot be used:
KIE_SUNO_CALLBACK_URL=https://<crm-host>/api/music/library/generate-music/callback?secret=<same-secret>
KIE_SUNO_MODEL=V4_5
```

`KIE_SUNO_CALLBACK_URL` wins over `PUBLIC_BASE_URL`. Local/dev host-derived callback is disabled by default; set `KIE_ALLOW_REQUEST_HOST_CALLBACK=true` only for controlled local tunnel testing.

## Current Cleanup Boundary

- `/api/music` (`routes/music.js`) is the primary Sound API.
- `/api/sound-library` (`routes/sound-library.js`) remains mounted as legacy compatibility CRUD and should not be used by new assistant context as the primary Sound route.
- Gamification AI/provider work is intentionally out of this provider cleanup pack.
