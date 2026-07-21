# Environment Variables

Required by Requirements section 34.5 and DOC-004.

Claude Code never creates or reads a real `.env`. Copy `.env.example` manually, or run `06-CREATE-LOCAL-ENV.cmd`, when a local file is needed. Secrets are never committed (SEC-011).

## Runtime variables

| Name | Purpose | Required environments | Secret | Allowed format | Safe default | Rotation | Owning module |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Selects runtime behaviour and log verbosity. | all | No | `development` \| `test` \| `production` | `development` | Not applicable | api |
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

## Not yet introduced

Analytics and error-monitoring variables are intentionally absent while OD-026 is unresolved; no adapter and no credential exist (INT-007). Payment, SMS, and email adapter variables arrive with DRAGON-11 and DRAGON-13 and will be deterministic mocks requiring no live credential (DEC-040, DEC-041).
