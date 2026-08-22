# Checkbox Activation Environment Template

This is a value-free manifest for a future explicit production activation task.

Do not commit real values, passwords, license keys, access keys, PINs, tokens, provider IDs, or webhook secrets.

## Production gates

```dotenv
CHECKBOX_INTEGRATION_ENABLED=false
CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false
CHECKBOX_WEBHOOK_ENABLED=false
EVENTGENIX_CASHIER_PRO_ENABLED=false
CHECKBOX_WEBHOOK_SIGNING_SECRET=
CHECKBOX_EXPECT_IS_TEST=
```

## Runtime credential refs

Use the exact logical refs stored by the operator configuration tool. For example, if the register/cashier credential ref is `park-middle-prod`, the environment prefix is `CHECKBOX_PARK_MIDDLE_PROD`.

```dotenv
CHECKBOX_<REGISTER_REF>_BASE_URL=
CHECKBOX_<REGISTER_REF>_LICENSE_KEY=
CHECKBOX_<REGISTER_REF>_ACCESS_KEY=
CHECKBOX_<CASHIER_REF>_AUTH_MODE=
CHECKBOX_<CASHIER_REF>_LOGIN=
CHECKBOX_<CASHIER_REF>_PASSWORD=
CHECKBOX_<CASHIER_REF>_PIN_CODE=
CHECKBOX_<CASHIER_REF>_DEVICE_ID=
CHECKBOX_SANDBOX_READINESS_ONLY=
CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS=false
```

Rules:

- `BASE_URL` must be an exact official HTTPS Checkbox API origin with the default HTTPS port: `https://api.checkbox.in.ua` or `https://api.checkbox.ua`.
- `AUTH_MODE` is `password` or `pin`. Password mode uses `LOGIN` + `PASSWORD`; PIN mode uses `PIN_CODE` + the register `LICENSE_KEY`. If both credential sets exist, `AUTH_MODE` is mandatory so runtime never guesses.
- Checkbox cashier sign-in PIN is a provider credential. It is separate from the per-user Cashier PRO approval PIN and must never be stored in the database.
- `CHECKBOX_SANDBOX_READINESS_ONLY=true` runs only auth/identity/register/signature/tax checks and exits before shift, receipt, or close mutations. It still requires exact expected test organization/register/cashier IDs.
- `CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS` is a sandbox proof flag, not a production readiness override. Its default is `false`. Setting it to `true` can tolerate only absent/`null` `cash_payment` or `card_payment` observations, and only when `CHECKBOX_SANDBOX_EXPECT_IS_TEST=true` is explicit, organization/register/cashier IDs match exactly, and `CHECKBOX_SANDBOX_CONFIRM_MUTATIONS=sandbox` is also explicit. A provider value of `false` always blocks the proof.
- Runtime test-mode readiness may use the same flag only with `CHECKBOX_EXPECT_IS_TEST=true` and an exact test cashier/register/organization mapping. With `CHECKBOX_EXPECT_IS_TEST=false`, unreported permissions remain blocked.
- Mutation proof requires `CHECKBOX_SANDBOX_CLOSE_SHIFT=true`, creates exactly one CASH and one CASHLESS test receipt in its own verified test shift, looks up both durable UUIDs until `DONE`, and polls cleanup until that exact shift reaches `CLOSED`.
- Keep `CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS=false` in production and in ordinary readiness checks.
- Local HTTP mock hosts require explicit test-only provider injection and must not be configurable through production environment variables.
- `CHECKBOX_ACCEPT_PAYMENTS_ENABLED` stays `false` until a separate controlled first-receipt activation task.
- Global fallback variables such as `CHECKBOX_LOGIN`, `CHECKBOX_PASSWORD`, or `CHECKBOX_LICENSE_KEY` are intentionally unsupported.
- The database stores only logical refs, never raw credentials.
- `CHECKBOX_WEBHOOK_SIGNING_SECRET` stays empty until a separate webhook activation task configures the official Checkbox callback. Do not commit or paste the real value into docs, CLI args, tests, logs, or chat.
- Production register enablement requires a successful operator preflight and a separate activation task.

## Local non-secret test mapping

The local test-mode mapping source is outside the repository:

```dotenv
CHECKBOX_PILOT_CONFIG_FILE=
```

Rules:

- The JSON file may contain only non-secret mapping data: CRM profile, park/middle aliases, FOP labels, provider organization/register/cashier IDs, credential refs, EventGenix user IDs, item/tax mappings, and `expectedIsTest`.
- The JSON file must not contain passwords, Checkbox cashier PINs, license keys, access keys, tokens, webhook secrets, or price overrides.
- Admission prices always come from the EventGenix CRM tariff snapshot. Fiscal config maps item names and tax mode only.
- `npm run configure:checkbox:park -- --config-file C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json` is dry-run by default and prints sanitized provider identity flags instead of provider IDs.

