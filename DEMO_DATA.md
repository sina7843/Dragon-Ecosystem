# Development Demo Data

Fictional demo data for browsing and visually inspecting the Dragon Ecosystem locally.
Everything here is **development-only** and **fictional** — no real people, numbers, emails,
or payment data, and no live provider is ever contacted.

## Prerequisites

- Docker Desktop running.
- The stack started once with `Dragon.bat` (brings up `mongo`, `api`, `web`).
- The dev stack uses the database **`dragon_dev`** (set in `docker-compose.override.yml`),
  so the production `dragon` database can never be seeded.

## Run it (Windows)

```
Dragon.bat
SEED-DEMO.bat
```

Then open: **http://localhost:8080**

To wipe and rebuild only the recreatable demo content (keeps accounts and financial history):

```
SEED-DEMO.bat --reset --confirm
```

## What runs internally

`SEED-DEMO.bat` builds the images (so the compiled seeder is present), starts the stack,
then runs, inside the `api` container:

```
docker compose exec -T api node apps/api/dist/migrate.js
docker compose exec -T api node apps/api/dist/seed-demo.js
```

The seeder is a compiled entry point in the API image (like `migrate.js`) — the production
image carries no TypeScript toolchain, so it runs compiled JavaScript. Equivalent package
scripts (host, against a host-reachable dev database): `npm run seed:demo` /
`npm run seed:demo:reset`.

## Safety guarantees

- Runs **only** when `NODE_ENV=development`; production and test fail closed.
- Refuses any database whose name is not clearly local: the name must contain `dragon`
  **and** one of `dev` / `demo` / `local`. The production `dragon` database is refused.
- Never creates an HTTP seed route; never runs on application startup.
- Never prints OTP codes, secrets, session tokens, or callback signatures.
- Writes domain state only through the real application services (identity, teams,
  games, content, tournaments, registrations, competitions, ledger, payments, holds,
  media, notifications, moderation, operations) — never by hand-editing rows.
- Demo ownership is tracked in a separate development-only `demo_seed_registry`
  collection (unique on `demoSeedKey`), never as a marker field on a domain record.
  Immutable and append-only rows (ledger, purchases, holds, audit, notifications,
  competition matches/standings/versions, registrations, analytics) are therefore
  never mutated or marked after creation.
- Idempotent: a rerun creates no duplicates, no duplicate financial effect, and does
  not mutate any immutable record (verified by an integration test).
- No live SMS/email/payment/analytics; refunds, withdrawals, payouts, and transfers stay
  fail-closed; recovery approval stays disabled.

## Generated users

All mobiles are in the fixed demo band `0912900XXXX`. Sign in with any of them (see below).

| Role / kind | Username | Mobile |
|---|---|---|
| Super administrator | `demo_superadmin` | `09129001000` |
| Content administrator (publisher) | `demo_editor` | `09129001001` |
| Finance operator | `demo_finance` | `09129001002` |
| Support operator | `demo_support` | `09129001003` |
| Community moderator | `demo_mod` | `09129001004` |
| Tournament organizers ×3 | `demo_org_*` | `09129001010`–`09129001012` |
| Regular players ×20 | `demo_player_*` | `09129002000`–`09129002019` |
| Incomplete profiles ×2 (account only) | — | `09129003000`, `09129003001` |
| Suspended user | `demo_suspended` | `09129003100` |
| Empty-state user (no team/wallet/notifications) | `demo_empty` | `09129003200` |

## Signing in (mock OTP — no real SMS)

1. Open http://localhost:8080 and start sign-in with a demo mobile, e.g. `09129001000`.
2. Read the one-time code from the **dev SMS inbox** (development-only, no real SMS):

   ```
   http://localhost:8080/api/v1/dev/sms-inbox?mobile=09129001000
   ```

   It returns the most recent codes for that number. Enter the code to finish sign-in.

The seeder itself already created every account through this same OTP flow; it never
mints a session or bypasses authentication, and it never prints a code.

## Pages worth inspecting

- Public home / content / games directory / tournament directory (search, filters, pagination).
- Tournament detail, registration & waitlist (approved / pending / waitlisted / cancelled;
  one full tournament — `orbit-qualifier`).
- Brackets & standings: dedicated competitions in every state — `comp-se-generated`
  (seeded bracket), `comp-se-partial` (partially played), `comp-se-complete` (finished, with
  a result correction / version history), `comp-round-robin` (final standings with rank/tiebreak
  columns), `comp-swiss` (a completed Swiss round with provisional standings).
- Media: published cover on the `nova-strike` game, staged vs published assets, decorative
  (empty-alt) media, and localized fa/en alt text.
- Teams directory & detail (public/private, members, pending invitations; `demo_player_ash`
  has several pending invites; `demo_empty` has no team).
- Player directory / profile (public & private, complete & incomplete, gaming identities).
- Account: profile / security / wallet / purchases / holds (varied balances incl. zero;
  `demo_empty` has an empty wallet), notifications (unread & read; `demo_empty` empty inbox).
- Administration: overview, users, content (incl. one draft game & draft article — visible
  to admins only, never in public lists), moderation queue, finance/operator & support views.

Empty states: `demo_empty` (no team/wallet/notifications/registrations) and the two
incomplete-profile accounts.

## Idempotent rerun

Running `SEED-DEMO.bat` again without `--reset` reuses demo-owned records (looked up via
the `demo_seed_registry` and stable business references such as `demo:user:player-01`,
`dragon_coin_issue:demo:coin:player-01`) and never duplicates records, duplicates a
financial effect, or mutates an immutable record.

## Reset

`SEED-DEMO.bat --reset --confirm` deletes **only** the mutable, recreatable demo records
(profiles, gaming identities, role grants, content, moderation/support/recovery cases) and
then repopulates them. It:

- requires `--confirm`; refuses otherwise;
- stays development-only and re-checks the database-name rule;
- never drops the database and never uses a destructive bypass;
- never deletes immutable, financial, audit, or historical records.

The reset summary distinguishes four categories:

- **mutable demo records reset** — deleted and recreated;
- **dependent editorial rows reset** — content revisions / linked reports cascaded;
- **immutable / append-only demo records preserved and reused** — accounts, games, teams,
  tournaments, registrations, notifications, and all ledger/hold/purchase/audit/competition
  history stay in place and are reused via their registry entries and business references.

Because accounts and financial history are preserved and reused, referential integrity and
financial invariants survive a reset.

## Disabled / live-provider limitations

The demo reflects Phase-1 fail-closed behavior:

- Payments use the **deterministic mock provider** only (`PAYMENTS_MOCK_ENABLED=true` in the
  dev override). No real gateway is called. Toman prize entitlements, refunds, withdrawals,
  payouts, and user-to-user transfers are disabled.
- Paid tournaments stay gated off (`PAID_TOURNAMENTS_ENABLED` unset) — demo tournaments are
  free; the paid checkout path is not exercised.
- SMS/email delivery is gated off; only the in-app inbox is populated. OTP SMS uses the
  dev inbox above.
- External analytics forwarding is off; analytics are recorded to the internal pseudonymous
  sink only (a non-consented nonessential event is correctly dropped).
- Recovery is triage-only; no approval/auth-bypass path exists.

## Not seeded (extension points)

- **Paid checkout / prize settlement**: exercised only when `PAID_TOURNAMENTS_ENABLED=true`
  (left off by default, so demo tournaments are free). With the gate on, the checkout and
  prize services would seed payable/completed/failed/expired checkouts and entitlements.

## Troubleshooting

- **"refused: … NODE_ENV" / "database … does not contain a dev marker"**: the stack is not in
  development mode or is pointed at a non-dev database. Confirm `docker-compose.override.yml`
  is present and re-run `Dragon.bat`.
- **Seeder can't read a dev OTP**: the API must be in development mode (mock SMS stores codes
  only outside production). Re-run `Dragon.bat`.
- **`docker compose exec` fails**: the services may still be starting — wait a few seconds and
  re-run `SEED-DEMO.bat`.
- **Nothing shows in the app**: confirm the API is healthy (`docker compose ps`) and that you
  signed in with a demo mobile after seeding.
