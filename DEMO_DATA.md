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
  media, notifications, moderation, operations) — never by hand-editing rows, with three
  presentation-only exceptions that exist because no service write covers them:
  - **Tournament posters.** `updateDraft` is deliberately draft-only and the state machine
    has no route back to draft, so an empty `coverImageUrl` on a published tournament is
    filled directly. A poster already set is never overwritten.
  - **Delivery log shaping.** A slice of notification deliveries is held in the gated state
    so `suppressed` stays visible next to the delivered ones.
  - **Audit timeline.** `occurredAt` is restamped across the preceding weeks so day
    grouping, relative time, and date filtering have something to show. Only the timestamp
    changes, and the original ordering is preserved.
- Demo ownership is tracked in a separate development-only `demo_seed_registry`
  collection (unique on `demoSeedKey`), never as a marker field on a domain record.
  Immutable and append-only rows (ledger, purchases, holds, notifications,
  competition matches/standings/versions, registrations, analytics) are therefore
  never mutated or marked after creation. Audit rows keep their content; only the
  timeline step above touches their timestamp.
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
- Tournament detail, registration & waitlist — every registration state is represented
  (approved / pending / waitlisted / rejected / cancelled); `orbit-qualifier` is full and
  holds the waitlisted and rejected examples.
- Imagery: every game, tournament, article, team, and profile carries generated artwork with
  bilingual alt text, so heroes, cards, thumbnails, and avatars all render real images. The
  bytes are produced deterministically by the seeder — nothing is downloaded, and because
  media is content-addressed a rerun reuses the same assets.
- Participant lists: public on most tournaments (with clickable player/team links) and
  private on `astro-grand-prix` and `nova-draft-cup`, so both states are reviewable.
- Content taxonomy: categories per content type plus cross-cutting tags, with every article
  filed, so the taxonomy filters and the admin taxonomy screens have data.
- Notification deliveries: a mix of `sent` and gated `suppressed` rows, with approved SMS
  templates behind them. The mock channel is used unconditionally — no message is ever sent.
- Administration audit: events spread across the preceding weeks, so day grouping, relative
  time, and the date filter are all exercisable.
- Brackets & standings: dedicated competitions in every state — `comp-se-generated`
  (seeded bracket), `comp-se-partial` (partially played), `comp-se-complete` (finished, with
  a result correction / version history), `comp-de-complete` (double elimination played out
  over 8 entrants, so the winners, losers, and grand-final bands all render),
  `comp-round-robin` (final standings with rank/tiebreak columns), `comp-swiss` (a completed
  Swiss round with provisional standings).
- Paid entry, both currencies: `nova-premier-cup` charges Toman and has one entrant left
  mid-payment (`pending_payment` registration, `awaiting_payment` checkout — returning to
  the page resumes it); `dragon-coin-clash` charges Dragon Coin and has one entrant who
  confirmed from their own balance, capturing the hold and activating the registration.
  Requires `PAID_TOURNAMENTS_ENABLED` (on in the development override, off by default).
- Prizes: two allocations from final standings. `comp-se-complete` pays Toman for ranks
  1–3, giving one entitlement in each state a finance operator sees — **paid** (with
  settlement evidence), **approved**, and **pending** — and credits Dragon Coin to the
  winner's wallet; `comp-de-complete` allocates a Dragon Coin prize only. Entitlements
  appear under Account → Wallet → Prizes.
- Media library: staged vs published assets, decorative (empty-alt) media, localized fa/en
  alt text, and a referenced-and-therefore-undeletable cover on the `nova-strike` game.
- Teams directory & detail (public/private, members, pending invitations; `demo_player_ash`
  has several pending invites; `demo_empty` has no team).
- Player directory / profile (public & private, complete & incomplete, gaming identities).
- Account: profile / security / wallet / purchases / holds (varied balances incl. zero;
  `demo_empty` has an empty wallet), notifications (unread & read; `demo_empty` empty inbox).
- Administration: overview, users, content (incl. one draft game & draft article — visible
  to admins only, never in public lists), moderation queue, finance/operator & support views.
- Administration → Media library: every seeded asset with its alt text, one staged file
  awaiting publication, and delete refused while something still references an asset.
- Administration → Configuration: two low-risk keys active on proposal, and one high-risk
  key (`finance.` prefix) held awaiting approval — approving it requires a *different*
  operator, and the proposer trying to approve their own change is refused.
- Administration → Notifications: approved SMS templates and the delivery log with its
  mix of delivered and gated rows, plus a bounded "run a delivery pass" control.
- Administration → Finance: the Dragon Coin hold list and the cash-entitlement queue.
  Capture and approve need `finance.manage`; force-release and marking an entitlement
  **paid** need `finance.approve`, so `demo_finance` is offered the first pair and not the
  second, with a note saying why.
- Administration → Support: the support case queue and account-recovery triage. Recovery
  is triage-only by design — there is no approval path on the screen or on the server.
- Administration → Operations: the metrics snapshot, the alert list with acknowledgement,
  and recent background job runs, plus bounded "run jobs" and "health check" passes.
- Administration → Organizer workspace: each organizer's own events with seat usage, the
  number of entries awaiting review, and direct links into the registration queue and the
  competition controls. `demo_org_kai` has one entry pending; `demo_org_ava` owns ten
  events with none outstanding.

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
  dev override). No real gateway is called. Refunds, withdrawals, payouts, and
  user-to-user transfers are disabled.
- Paid tournaments are enabled **in the development override only**
  (`PAID_TOURNAMENTS_ENABLED=true`); `.env.example` ships it as `false`, so production stays
  gated unless it is turned on deliberately. With it off, the seeder still defines the two
  priced tournaments but skips their checkouts and says so in its summary.
- Toman prize entitlements are settled **off-platform**: marking one paid records
  settlement evidence and an operator, and moves no money through the platform. Dragon Coin
  prizes are credited on-platform through a balanced double-entry posting.
- SMS delivery uses the mock channel; the seeder settles most deliveries through it and
  leaves a slice gated so both states are visible. No message ever leaves the machine, and
  OTP SMS uses the dev inbox above.
- External analytics forwarding is off; analytics are recorded to the internal pseudonymous
  sink only (a non-consented nonessential event is correctly dropped).
- Recovery is triage-only; no approval/auth-bypass path exists.

## Not seeded (extension points)

- **Streams (DRAGON-18)**: the seeder creates no streams, so `/streams` is empty on a fresh
  demo database. Create one from the operations console at `/admin/streams` as a
  `streaming_operator`: confirm rights, provision the provider resource, then move it to
  scheduled and live. Archiving and takedown stay refused while
  `STREAM_RIGHTS_POLICY_APPROVED` is off (OD-014), and the provider is always the
  deterministic local stub (OD-013) — no video ever leaves the machine.
- **Courses (DRAGON-20)**: the seeder creates no courses, so `/academy` is empty on a fresh
  demo database. As an `education_manager`, create a coach profile and approve it, then
  create a course and its lessons from `/admin/courses` and move it review → published.
  Paid courses stay refused while `PAID_COURSES_ENABLED` is off (OD-015), and quiz or
  exercise lessons are refused outright (OD-016).
- **Live chat (DRAGON-19)**: a stream has no chat room until one is opened. As a
  `live_chat_moderator`, open it from `/admin/chat` (or `POST /api/v1/admin/chat/rooms`
  with the stream id); the watch page then shows the chat panel. The same console applies
  timeouts, bans, and message removals, all scoped to the room and audited. There is no
  direct-messaging surface anywhere — CHAT-008 prohibits it.
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
