# Operational Runbooks

Operational procedures for critical actions (OPS-013, DOC-020). Each runbook is a
deliberate, audited step; none runs automatically.

---

## Bootstrap the first super administrator

**When:** once per environment, before release, to create the very first
super-administrator account. Every later super admin is granted from the admin
console by an existing super admin — this procedure is only for the first.

**Why a procedure and not a seed:** the system deliberately ships with **no**
super administrator. Auto-seeding one would put a known, unowned privileged
account into every deployment. Instead an operator binds the role to a real,
already-verified person, and the action is audited.

### Safety properties

- **No HTTP surface.** It is a CLI entry point (`bootstrap:superadmin`), like
  database migrations. Nothing exposes it over the network.
- **One-time, durably.** A friendly pre-check refuses when an active super
  administrator already exists. The real guarantee is a singleton guard document
  with a fixed `_id` inserted inside the write transaction: the automatic unique
  `_id` index means two concurrent runs cannot both claim it — exactly one commits
  and the other loses on a duplicate-key / write conflict. The guard persists, so
  the bootstrap runs at most once per environment for its entire lifetime.
- **No identity backdoor.** It grants the role to an account that **must already
  exist**. It never creates an account or bypasses mobile-OTP verification.
- **Audited.** The grant writes an emergency audit event
  (`superadmin.bootstrapped`) in the same transaction as the assignment
  (ADMIN-010), so it appears in the emergency oversight queue.

### Preconditions

1. The database is reachable and migrated (the command runs migrations and the
   role seed itself, so a fresh database is fine).
2. `MONGODB_URI` and `AUTH_SECRET` are set for the target environment (the same
   values the API uses; see `ENVIRONMENT_VARIABLES.md`). No extra secret is
   introduced by this procedure.
3. **The designated person has signed in at least once** via mobile OTP, which
   creates their account. Without an existing account the command refuses.

### Steps

1. Confirm the person has signed in once (so their account exists). Note their
   mobile number in any accepted form (e.g. `09123456789`).

2. From the deployment host, with the target environment's `MONGODB_URI` and
   `AUTH_SECRET` in the environment, run:

   ```bash
   npm run bootstrap:superadmin --workspace @dragon/api -- --mobile 09123456789
   ```

   In a built image the equivalent is `node apps/api/dist/bootstrap-superadmin.js --mobile 09123456789`.

3. Expected success output:

   ```
   Super administrator bootstrapped.
     account:    <account-id>
     assignment: <assignment-id>
     An emergency audit event (superadmin.bootstrapped) was recorded.
   ```

   Exit code `0`.

### Verification

1. The named person signs in and opens `/admin`; they see the super-administrator
   badge and all administration areas.
2. In the admin audit view, filter to **emergency actions only**; the
   `superadmin.bootstrapped` event is present with the correct account and reason.

### Refusals (all exit code `1`, no change made)

| Message | Meaning | Action |
|---|---|---|
| `no account exists for +98…` | The person has not signed in yet. | Have them sign in once via OTP, then re-run. |
| `a super administrator already exists` | The environment is already bootstrapped. | Use the admin console to grant further super admins. |
| `Provide the target mobile number` | The `--mobile` argument was missing. | Re-run with `-- --mobile <number>`. |

### Rollback

If the wrong account was bootstrapped: sign in as that (now super) admin, grant a
correct account the super-administrator role from the admin console, then revoke
the wrong assignment from **User → roles**. The revoke is audited. Do not delete
audit events. The bootstrap CLI does not re-enable after revocation — the
singleton guard persists — so recovery is always done through the console by an
existing super admin, never by re-running the CLI. Keep at least one active super
administrator at all times.

---

## Migration rollback and forward-fix

**When:** a migration fails, is recorded as stalled (`applying`), or shipped a
schema/index change that must be reversed.

**Why forward-fix, not backup/restore (DRAGON-14):** the migration runner is
**forward-only and idempotent** — each version is claimed by an insert into the
`schema_migrations` collection and applied at most once; there is no `down`
step, and the platform intentionally ships **no** backup/restore release
requirement. Reversal is done by shipping a *new* corrective migration, never by
restoring a snapshot. This keeps the applied-version history append-only and
auditable, and avoids a restore silently discarding committed business data
written after the bad migration.

### A stalled migration (`applying`)

If a process dies mid-migration, its version stays `applying` and the next run
**refuses** with `Migration <version> is recorded as "applying" since <time>`
rather than silently retrying (a half-applied change must be inspected, not
re-run blindly).

1. Inspect what the migration does and what it actually wrote (e.g. which
   indexes/collections exist) against the target database.
2. If the migration's writes are **not** present (it died before doing work),
   delete only that one stalled record so it can re-apply:

   ```
   db.schema_migrations.deleteOne({ _id: "<version>", state: "applying" })
   ```

   Then re-run `npm run migrate --workspace @dragon/api`.
3. If the writes **are** partially present, finish or undo them by hand to match
   the migration's intended end state, then set the record to `applied` (do not
   re-run a partially-completed migration):

   ```
   db.schema_migrations.updateOne({ _id: "<version>" }, { $set: { state: "applied" } })
   ```

### Reversing an applied migration (forward-fix)

Do **not** edit or delete the original migration or its applied record — history
stays append-only. Instead add a new, higher-numbered migration that reverses the
unwanted effect (drop the index it created, restore the previous shape, backfill
corrected values). Example: `021-revert-020-<reason>`. Ship it through the normal
`npm run migrate` path. It is audited by its own version record.

### Verification

- `npm run migrate --workspace @dragon/api` exits `0` and reports the expected
  versions applied.
- No `schema_migrations` record is left in state `applying`.
- The affected collections/indexes match the intended end state.

---

## Persistence incident (Mongo / ledger / bracket / queue / OTP-mock / payment-mock)

**When:** a health check or alert fires for a persistence-layer failure. The
operations module (`POST /admin/ops/health-check`, `GET /admin/ops/metrics`,
`GET /admin/ops/alerts`) surfaces these. Alert categories: `mongo`, `ledger`,
`bracket`, `queue`, `otp_mock`, `payment_mock`.

**Why no restore step:** as above, there is no backup/restore requirement.
Recovery is diagnosis + a bounded, idempotent re-run of the affected work, never
a snapshot restore.

### Triage

1. `GET /admin/ops/metrics` — read `pendingOutbox`, `deadLetterDeliveries`,
   `failedJobs`, `openAlerts`.
2. `GET /admin/ops/alerts?status=open` — read the category and detail of each open
   alert. Details are redacted (first line only, control chars stripped, no
   stacks or secrets).

### By category

- **`mongo` (persistence check failed):** confirm the replica set is reachable
  and primary is elected (transactions require it). Once healthy, re-run
  `POST /admin/ops/health-check`; the alert clears when the next check passes.
  Acknowledge the alert once resolved (`POST /admin/ops/alerts/:id/acknowledge`).
- **`queue` (outbox backlog / dead-letter / failed job):** the job runner
  (`POST /admin/ops/run-jobs`) drains the outbox → deliveries → hold/checkout
  expiries. It is **bounded and idempotent** — re-running it is always safe. For
  dead-lettered notification deliveries, inspect the delivery, fix the underlying
  channel/config, then re-run the jobs. A repeatedly-failing job records each
  failure in `job_executions` and raises a fresh `queue` alert.
- **`ledger` / `bracket`:** these are financial/competition invariants — do
  **not** hand-edit documents. Use the module's own reconciliation/regeneration
  path (holds reconciliation; bracket versioned regeneration/rollback) which
  detects drift and repairs it inside a transaction with an audit trail.
- **`otp_mock` / `payment_mock`:** mock-adapter failures. These never touch real
  providers; verify the mock is enabled for a non-production environment and that
  the caller used a supported deterministic input.

### Verification

- `GET /admin/ops/metrics` shows the relevant counter back at its expected level
  (e.g. `deadLetterDeliveries` = 0, `failedJobs` no longer increasing).
- Each resolved alert is acknowledged; no unexplained `open` alert remains.
- The action is audited (`ops.alert_raised` / `ops.alert_acknowledged`).
