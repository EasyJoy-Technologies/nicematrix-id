# NiceMatrix Carrier Connector（本机号码一键登录）

**Not a Logto built-in.** A NiceMatrix social connector (`target: carrier`, factory id `nicematrix-carrier`)
that brings a phone number the **cn Backend already verified with the carrier** (Aliyun Dypnsapi / China Mobile)
into the standard Logto Experience — identify by phone, auto-register, MFA, PostSignIn.

- Authorization: redirects to the cn Browser Broker (`/v1/carrier/broker/start?lc=<launch context>`).
  The launch context is signed by the Logto Core override from the server-side interaction.
- User info: redeems the Broker's one-time result code at `/v1/internal/carrier/consume`
  (service-auth HMAC, purpose `carrier_consume`). Returns a per-sign-in id (`att_<attempt>`) and the
  phone in Logto storage format (`86…`), so users are always resolved by their **current** phone.
- No configuration fields. Secrets are container env only:
  `INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH`, `INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME`;
  optional `NICEMATRIX_CARRIER_BROKER_URLS` (JSON region → https origin, staging) and `NICEMATRIX_CARRIER_SERVICE_ID`.
- Hidden on the sign-in page unless the calling App declared carrier login (`carrier_mode` + `carrier_challenge`).

Design: nicematrix-backend `docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md`;
architecture: backend `docs/architecture/carrier-one-tap.md`.
