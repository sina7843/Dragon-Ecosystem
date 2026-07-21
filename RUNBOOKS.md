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
