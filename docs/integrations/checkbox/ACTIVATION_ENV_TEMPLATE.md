# Checkbox Activation Environment Template

This is a value-free manifest for a future explicit production activation task.

Do not commit real values, passwords, license keys, access keys, PINs, tokens, provider IDs, or webhook secrets.

## Production gates

```dotenv
CHECKBOX_INTEGRATION_ENABLED=false
EVENTGENIX_CASHIER_PRO_ENABLED=false
CHECKBOX_WEBHOOK_ENABLED=false
```

## Runtime credential refs

Use the exact logical refs stored by the operator configuration tool. For example, if the register/cashier credential ref is `park-middle-prod`, the environment prefix is `CHECKBOX_PARK_MIDDLE_PROD`.

```dotenv
CHECKBOX_<REGISTER_REF>_BASE_URL=
CHECKBOX_<REGISTER_REF>_LICENSE_KEY=
CHECKBOX_<REGISTER_REF>_ACCESS_KEY=
CHECKBOX_<CASHIER_REF>_LOGIN=
CHECKBOX_<CASHIER_REF>_PASSWORD=
CHECKBOX_<CASHIER_REF>_DEVICE_ID=
```

Rules:

- `BASE_URL` must be an official HTTPS Checkbox host.
- Local HTTP mock hosts require explicit test-only injection and must not be used for production activation.
- Global fallback variables such as `CHECKBOX_LOGIN`, `CHECKBOX_PASSWORD`, or `CHECKBOX_LICENSE_KEY` are intentionally unsupported.
- The database stores only logical refs, never raw credentials.
- Production register enablement requires a successful operator preflight and a separate activation task.

