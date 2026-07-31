# Environment Variables

Required by Requirements section 34.5 and DOC-004.

Claude Code never creates or reads a real `.env`. Copy `.env.example` manually, or run `06-CREATE-LOCAL-ENV.cmd`, when a local file is needed. Secrets are never committed (SEC-011).

## Runtime variables

| Name | Purpose | Required environments | Secret | Allowed format | Safe default | Rotation | Owning module |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Selects runtime behaviour and log verbosity. **Must be `production` for any real deployment**: a non-production value enables development-only routes, including the unauthenticated `/api/v1/dev/grant-role`, and permits placeholder secrets. Unset defaults to `development`, so set it explicitly. The server logs a security warning at startup when it is not `production`. | all | No | `development` \| `test` \| `production` | `development` | Not applicable | api |
| `HOST` | Interface the API binds to. | all | No | IPv4 address or hostname | `0.0.0.0` (containers must bind all interfaces) | Not applicable | api |
| `PORT` | API listen port inside the container. | all | No | integer 1–65535 | `3000` | Not applicable | api |
| `MONGODB_URI` | MongoDB connection string. Must reach a replica set, because transactions require one. | all; **mandatory** in production | No today; becomes secret once credentials are added | `mongodb://…` or `mongodb+srv://…` | `mongodb://mongo:27017/dragon` outside production only; Compose passes `?replicaSet=rs0` | Rotate with the database credential when authentication is enabled | api |
| `TRUSTED_PROXIES` | Reverse-proxy addresses whose `X-Forwarded-For` may be trusted, so per-IP rate limits key on the real client. | production behind a proxy | No | comma-separated IPv4 addresses, IPv4 CIDR blocks, or the presets `loopback`/`linklocal`/`uniquelocal` | empty (trust nothing; `request.ip` is the socket peer) — correct for local dev and tests. Compose sets it to nginx's fixed address `172.28.0.10` | Update if the proxy address changes | api |
| `AUTH_SECRET` | Keys OTP-code and session-token hashes. | all; **mandatory** in production | **Yes** | string, at least 32 characters | insecure placeholder outside production only; production startup fails without it | Rotate on suspected compromise; rotating invalidates existing sessions and pending codes | identity |
| `OTP_TTL_SECONDS` | Lifetime of a one-time code. | all | No | positive integer | `120` | Not applicable | identity |
| `OTP_RESEND_SECONDS` | Minimum interval between code requests for one number. | all | No | positive integer | `60` | Not applicable | identity |
| `OTP_MAX_ATTEMPTS` | Verification attempts allowed per challenge before it locks. | all | No | positive integer | `5` | Not applicable | identity |
| `OTP_REQUESTS_PER_MOBILE` | OTP requests allowed per number per window. | all | No | positive integer | `5` | Not applicable | identity |
| `OTP_REQUESTS_PER_IP` | OTP requests allowed per IP per window. | all | No | positive integer | `20` | Not applicable | identity |
| `OTP_WINDOW_SECONDS` | Length of the OTP rate-limit window. | all | No | positive integer | `900` | Not applicable | identity |
| `SESSION_TTL_HOURS` | Session lifetime. | all | No | positive integer | `336` (14 days) | Not applicable | identity |
| `RECENT_AUTH_MINUTES` | Window in which a session counts as recently authenticated for sensitive actions. | all | No | positive integer | `15` | Not applicable | identity |

Startup fails with a combined error listing every invalid or missing value; production never falls back to a guessed connection string.

## Tooling variables

| Name | Purpose | Required environments | Secret | Allowed format | Safe default | Rotation | Owning module |
|---|---|---|---|---|---|---|---|
| `API_PROXY_TARGET` | Origin the Vite dev/preview proxy forwards `/api` to. | development, automated test | No | absolute http(s) URL | `http://127.0.0.1:3000` | Not applicable | web |
| `MONGODB_TEST_URI` | Disposable database used by the integration suite. Each run creates and drops its own database. | automated test | No | `mongodb://…` | `mongodb://127.0.0.1:27018/?directConnection=true` | Not applicable | api |
| `CI` | Enables CI-strict test behaviour (no server reuse, no `test.only`). | automated test | No | any non-empty value | unset | Not applicable | tooling |
| `PAYMENTS_MOCK_ENABLED` | Activates the deterministic mock Toman payment provider (the approved adapter until a real provider is approved, PAY-012). Outside production it defaults on (set `false` to disable); in production it is off unless explicitly set to `true`. **The self-serve `/payments/mock/pay` test control is separately fail-closed and is never registered in production, regardless of this flag** — so even an opted-in production mock provider cannot let a caller self-credit. Do not set this in real production unless a mock adapter is intentionally required. | all | No | `true`/`false` | `true` outside production, `false` in production | Not applicable | payments |
| `PAYMENTS_CALLBACK_SECRET` | HMAC key authenticating provider payment callbacks. Never logged, never returned to a client. | all; **mandatory** in production | **Yes** | string, at least 32 characters | insecure placeholder outside production only; production startup fails without it (or if shorter than 32 chars) | Rotate on suspected compromise; queued/unverified callbacks signed with the old key stop verifying | payments |
| `PAYMENTS_PURCHASE_TTL_SECONDS` | How long a created Dragon Coin purchase stays payable before it expires. | all | No | positive integer (seconds) | `900` | Not applicable | payments |
| `PAID_TOURNAMENTS_ENABLED` | OD-007 feature gate for paid tournament registration checkout (Toman/Dragon Coin fees). **Fail-closed**: off everywhere unless set to exactly `true`. Free tournaments are unaffected. Keep off in production until fee/payout templates are approved. | all | No | `true` to enable; anything else disables | `false` | Not applicable | checkout |
| `NOTIFICATIONS_SMS_ENABLED` | OD-008 gate for the notifications **SMS** channel (tournament messages). **Fail-closed**: off unless exactly `true`. Does not affect OTP SMS (the identity module's own security-essential path). In-app notifications are always active. | all | No | `true` to enable; anything else disables | `false` | Not applicable | notifications |
| `NOTIFICATIONS_EMAIL_ENABLED` | OD-003 gate for the notifications **email** channel. **Fail-closed**: off unless exactly `true`; transactional email stays disabled with a local test sink only. No live provider. | all | No | `true` to enable; anything else disables | `false` | Not applicable | notifications |
| `ANALYTICS_EXTERNAL_ENABLED` | OD-026 gate for forwarding analytics events to an **external** tracker. **Fail-closed**: off unless exactly `true`. Internal, pseudonymous analytics are always recorded and nonessential events still require caller consent regardless of this flag; no external tracker is integrated, so this stays off (there is no external forward path even when `true`). | all | No | `true` to enable; anything else disables | `false` | Not applicable | operations |
| `MEDIA_MAX_BYTES` | Maximum accepted media upload size in bytes (MEDIA-001), enforced on the decoded bytes before validation. Uploads are validated by content signature (magic bytes), never by filename or client MIME. | all | No | positive integer | `5000000` (5 MB) | Not applicable | media |
| `PUBLIC_ORIGIN` | Absolute public origin the API uses to build `sitemap.xml`, `robots.txt`, and canonical URLs (SEO-005/006) **and** as the allowlist for the cross-origin (CSRF) request guard on state-changing requests. **Required in production** — startup fails if missing or not an absolute `http(s)://host` origin, so the CSRF guard is always active in a real deployment. Empty is allowed only outside production (site-relative SEO URLs; the guard is inert where the browser origin and proxied API host legitimately differ). Trailing slashes trimmed. | all | Yes in production | absolute origin, e.g. `https://dragon.example` | empty (dev/test) | Not applicable | seo, security |
| `ANALYTICS_PSEUDONYM_SALT` | Secret salt for analytics pseudonymization (OD-026). Separate from `AUTH_SECRET` and `PAYMENTS_CALLBACK_SECRET` (secrets are never reused across security functions). **Required in production** — startup fails if missing or shorter than the minimum length; a development placeholder is used otherwise. Never committed, logged, returned, or placed in audit/analytics output. | all | Yes in production | secret string, ≥ minimum length | development placeholder | Not applicable | operations, security |
| `ENABLE_DEV_ROUTES` | Registers the unauthenticated `/api/v1/dev/grant-role` helper (grants a role to an account by mobile). **Fail-closed**: the route is registered only when this is exactly `true` **and** `NODE_ENV` is not `production`. Production never registers it regardless. A startup security warning is logged whenever it is enabled. | local development, automated test | No | `true` to enable; anything else disables | `false` | Not applicable | api |

## Not yet introduced

Analytics and error-monitoring variables are intentionally absent while OD-026 is unresolved; no adapter and no credential exist (INT-007). Payment, SMS, and email adapter variables arrive with DRAGON-11 and DRAGON-13 and will be deterministic mocks requiring no live credential (DEC-040, DEC-041).
