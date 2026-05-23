# Page: Chat Settings

## Route / Location

- Route: `/chat-settings`
- Static file: `chat-settings.html`
- Page controller: `js/chat-settings-page.js`
- Related backend routes: `routes/chat.js`, `routes/guardian.js`, `routes/crm-assistant.js`
- Access: creator/director/admin in `middleware/auth.js` and `js/auth.js`.

## Purpose

Chat Settings is the configuration page for Chat AI, Guardian, and chat-related integrations/settings.

## Primary Entities

- Chat AI provider/config
- Guardian setting/rule
- Integration/provider setting
- Assistant key/source state

## Visible UI

- Chat AI settings panels.
- Provider/source selectors.
- Guardian/integration configuration panels.
- Save/test controls where exposed.

## Available User Actions

- Configure chat assistant/AI settings.
- Configure Guardian-related chat settings.
- Review provider/source status.

## Data Sources

- `routes/chat.js`
- `routes/guardian.js`
- `routes/crm-assistant.js`
- related settings APIs under `routes/settings.js`.

## Related Files

- `chat-settings.html`
- `js/chat-settings-page.js`
- `routes/chat.js`
- `routes/guardian.js`

## Assistant Context

On Chat Settings, answer as configuration support. If the user asks about actual messages or channels, route them to `/chat` or `/omni` depending on whether it is team chat or customer channel.
