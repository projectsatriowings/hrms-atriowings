# Attenza — HRMS for Atriowings Technologies

Premium, user-friendly HRMS web app — **Next.js 14 + NestJS 11 + PostgreSQL 18 + Prisma 6**, in a pnpm monorepo.

**Modules:** employees (directory, profiles, 6-step Excel/CSV import wizard), attendance (employee check-in/out, HR daily/monthly views, corrections), leave (apply, balances ledger, approvals inbox, team calendar), India payroll (PF/ESI/PT/TDS engine, guided compute → review → approve → finalize), customer GST billing (invoices, payments, PDFs), reports, dashboard, and administration (departments, holidays, leave types, users, audit log).

> **Product principle:** HR without the daily follow-up. Action-first dashboard, inline approvals, live clock-in widget, guided payroll.

## Quick start (local)

Prerequisites: Node ≥ 20, pnpm, and a PostgreSQL server. The `recover-local.sh` script below assumes the
sandbox layout (PostgreSQL binaries at `~/pgbin`, port `5433`); adapt paths for your machine.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure the API
cp apps/api/.env.example apps/api/.env
# edit DATABASE_URL to point at your PostgreSQL, plus JWT secrets

# 3. Migrate + seed demo data
pnpm --filter @hrms/api exec prisma migrate deploy
pnpm --filter @hrms/api seed

# 4. Build everything
pnpm build

# 5. Run (two terminals)
pnpm --filter @hrms/api start     # API on http://localhost:4000
pnpm --filter @hrms/web start     # Web on http://localhost:3000
```

**One-command recovery** (rebuilds the local DB from scratch and boots both servers):
```bash
./scripts/recover-local.sh
```

### Demo logins (seeded)

| Email | Password | Role |
|---|---|---|
| admin@atriowings.in | Atriowings@123 | MD |
| hr@atriowings.in | Atriowings@123 | HR |
| karthik.n@atriowings.in | Atriowings@123 | Employee |

The seed company is **Atriowings Technologies** (fictional demo data, 12 employees — every employee has a login with the same password, e.g. `karthik.n@atriowings.in`). Replace with real data via the employee import wizard. The `@atriowings.in` email domain in the seed is a placeholder — swap in the real domain before inviting staff.

**New employees:** adding an employee in the app automatically creates their login and shows HR a one-time temporary password to share with them. (Bulk import does not auto-create logins.)

**Mobile app:** Attenza is an installable PWA — open it on a phone browser, choose "Install app" / "Add to Home Screen", and it runs full-screen from a home-screen icon (Android + iOS, no app store needed).

## Repo layout

```
apps/web          Next.js 14 frontend (App Router, Tailwind, 30 routes)
apps/api          NestJS backend (REST /api/v1, Prisma, Argon2 auth, RBAC)
packages/shared   Shared TypeScript + Zod schemas (forms ↔ API contract)
CONTRACT.md       API contract — endpoints, shapes, auth, status codes
DESIGN.md         Design system — tokens, components, all 21 screens
scripts/          recover-local.sh, db-local.sh, qa-screens.cjs
```

## Attendance controls — what GPS check-in can and cannot prove

- **GPS check-in (a deterrent, not proof of presence):** set the office coordinates + geofence radius on
  the attendance policy (Holidays & Policies → attendance policy). Flip on "Require location for check-in"
  to block check-ins outside the fence; the app requests the employee's GPS at check-in time. HR sees a
  Location / Unverified badge on each record, which records only that the reported coordinates fell inside
  the fence. It does **not** prove the employee was there: GPS check-in is a deterrent, and mock-location
  apps can defeat it. **Biometric devices are the real control** — a fingerprint/face punch cannot be
  faked by spoofing a phone's GPS. When location is off, coordinates are still recorded opportunistically.
- **Biometric devices:** Administration → Biometric Devices. Register each fingerprint/face device to get
  a secure API key, map the device's user IDs to employees, then configure the device to POST punches to
  `POST /api/v1/attendance/biometric-punch` with header `x-device-key` and body
  `{ deviceUserId, timestamp (ISO), type: "in" | "out" }`. Punches are recorded with source `biometric`.
  (Works with devices that support HTTP/webhook push, e.g. eSSL/ZKTeco models with ADMS/push firmware.)
- **Work from home:** employees apply for WFH (Attendance → Work from home) and managers approve it
  (Leave → Approvals); admins can also mark company-wide WFH days (Holidays & Policies → Work-from-home
  days). On WFH days check-in/out is still required from anywhere, but location and biometric checks are
  automatically skipped and the record is tagged WFH.

## Verification status

- Backend: `tsc` clean · 6/6 payroll-math unit tests pass · full API smoke suite passes
  (`apps/api/smoke.mjs` — auth, RBAC, employees, attendance, leave, payroll lifecycle, billing, dashboard)
- Frontend: `tsc` clean · `next build` clean (31 pages) · Playwright screenshot QA of 12 key screens
  (login → dashboard → employees → attendance → leave approvals → payroll → invoices → reports, + mobile 390px)

## Key engineering decisions

- **Tenant isolation:** every company-owned record carries `companyId`; service-layer checks enforce it (never UI-only).
- **Auth:** Argon2 passwords, short-lived JWT access token, rotating refresh token in an httpOnly cookie.
- **Payroll:** pure, unit-tested calculation engine (`payroll.calc.ts`); finalized periods are immutable — corrections go through controlled adjustments.
- **Attendance:** server-generated UTC timestamps; corrections are append-only with reason + history.
- **Money:** Prisma Decimals are normalized to JSON numbers by a global interceptor.
- **CSV exports:** formula-injection protection on all exports.
- **Audit:** append-only audit log for sensitive actions (role changes, payroll transitions, corrections, payments).

## Before production use

1. **Verify statutory defaults** (PF/ESI/PT/TDS slabs in `payroll.calc.ts`) with a qualified Indian payroll professional. PF now uses the Code on Wages, 2019 s.2(y) "wages" definition with the 50% deeming rule (₹15,000 ceiling kept); TDS supports both new and old regimes (FY 2025-26, old-regime 80C capped at ₹1,50,000 plus declared 80D/HRA) and is always labelled an estimate. Professional Tax is implemented per state for TN, MH, KA, GJ, AP, TG, WB (1 Oct 2026 slabs), OD, AS, MP, CG, JH, BR, ML, SK, TR, MZ and KL (annual/half-yearly schedules spread monthly); states with no PT on salary return 0, and any other `ptState` value fails loudly instead of falling back to another state's slabs. Known limitations: February/last-month PT top-ups (MH/KA ₹300, MP/OD ₹212) are not modelled — post them as adjustments; several PT tables rest on secondary summaries that disagree (notably OD, ML, TR, MZ, CG) and must be re-checked against the current state notification before a real run. Payslips download as real PDFs (`GET /payroll/payslips/:id/pdf`); NEFT bank files (`GET /payroll/periods/:id/bank-transfer`) are only available for finalized periods.
2. Use **managed PostgreSQL** with automated backups; test a restore.
3. Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` and a real `DATABASE_URL` (the committed `.env.example` values are dev-only).
4. Confirm the company name, attendance policy, leave rules, and salary components with the business — current values are configurable defaults.
5. Put the API behind HTTPS; set `COOKIE_SECURE=true` in production.

## Security: passwords, MFA, sessions, audit (2026-10-21 review fixes)

- **Access token storage:** the web app keeps the access token in memory only
  (never localStorage). After a page reload it restores the session via the
  httpOnly refresh cookie (`POST /auth/refresh`), then `GET /auth/me`; a
  failed refresh is just the logged-out state.
- **Change password:** `POST /auth/change-password` (current + new, min 8
  chars) revokes all *other* sessions. Auto-created logins (new employee,
  `create-login`) get a temporary password flagged `mustChangePassword` with
  a 7-day expiry: the login response carries `mustChangePassword`, the web
  app routes to `/change-password`, and until the change succeeds the API
  answers 403 `password_change_required` on every non-auth route. An expired
  temporary password is rejected at login with `temp_password_expired`.
- **Forgot/reset password:** `POST /auth/forgot-password` always returns 200
  for unknown emails (no user enumeration); for a real account it creates a
  SHA-256-hashed token valid 1h. **No mailer transport is wired yet**, so
  with no SMTP configured it returns 503 "password reset email is not
  configured — ask HR to reset your password". `POST /auth/reset-password`
  (token + new password) revokes all sessions. Do NOT set `SMTP_HOST` in
  production expecting delivery until a mailer is integrated.
- **Admin reset:** MD/HR can `POST /users/:id/reset-password` to issue a new
  temporary password (mustChangePassword + 7-day expiry, all sessions
  revoked); the password is returned once in the response.
- **Lockout + rate limits:** 5 consecutive failed logins lock the account
  for 15 minutes (`account_locked`, HTTP 429). Login is rate-limited
  (20/min), refresh (30/min), biometric punch (60/min); the API trusts one
  reverse proxy (`trust proxy: 1`) so proxied users don't share one bucket.
- **Refresh reuse detection:** re-presenting a rotated-out or logged-out
  refresh token revokes ALL sessions for that user and returns 401
  `refresh_token_reused`.
- **MFA (TOTP, any role; challenge applies to whoever enabled it):**
  `POST /auth/mfa/setup` returns a secret + otpauth URL (not stored);
  `POST /auth/mfa/verify-setup` with a valid code stores the secret, enables
  MFA, and returns 10 one-time recovery codes (SHA-256 hashed at rest,
  shown once). `POST /auth/mfa/disable` needs password + valid code. At
  login, an MFA user with a correct password gets `mfa_required` +
  5-minute `mfaToken` (no tokens yet); `POST /auth/mfa/verify` (code or
  recovery code) completes login. Recovery codes are single-use.
- **Optional companyCode on login:** `POST /auth/login` accepts
  `companyCode` (the company's slug); a mismatch returns 401. Absent, the
  old behaviour is unchanged.
- **Secrets fail-closed:** the API refuses to start without
  `JWT_ACCESS_SECRET` (or with a known default), and in production without a
  valid `BANK_ENCRYPTION_KEY`. `JWT_REFRESH_SECRET` was verified dead
  (opaque refresh tokens) and removed from `.env.example`. Never ship a zip
  containing `.env` or `.env.local` (see `.gitignore`) — the previously
  delivered zip did, and its secrets were rotated on 2026-10-21.
- **Audit hardening:** the audit log is append-only at the DB level
  (migration `20261021130000_audit_append_only`: UPDATE/DELETE raise).
  Employee updates log a real before/after field diff (bank values never
  logged, only a "changed" marker); salary revisions log component keys +
  effectiveFrom, never amounts; hr/md opening an employee detail writes
  `employee.bank_viewed` / `employee.salary_viewed` entries.
- **Bank details encryption:** `Employee.bankDetails` is AES-256-GCM
  encrypted at rest (`enc:v1:<iv>:<tag>:<ciphertext>`, base64 parts), keyed
  by `BANK_ENCRYPTION_KEY` (32 bytes hex). Decryption happens only for
  authorised readers (hr/md/self) at the detail endpoint; legacy plaintext
  rows are encrypted on read-back. Losing the key makes stored bank details
  unrecoverable — keep it in the deployment secret store.
- **Session purge:** a nightly cron (03:00) deletes auth sessions that are
  expired or revoked and older than 30 days.

## Data retention & anonymization policy (DPDP)

This is the product's policy for handling personal data when someone leaves or asks for their data to be
removed. It is not legal advice and should be reviewed by counsel before production use, including against
India's Digital Personal Data Protection Act (DPDP Act, 2023) and its rules as notified.

- **The audit log is append-only by database trigger BY DESIGN, so company DELETE stays blocked.**
  Migration `20261021130000_audit_append_only` makes UPDATE/DELETE on audit rows raise at the database
  level. There is deliberately no "delete audit history" endpoint or admin action, and no support request
  should be answered by deleting audit rows: doing so would destroy the tamper-evident record the audit
  log exists to provide.
- **The supported procedure for person-level erasure is anonymization, not deletion of audit rows.**
  When an employee/user leaves or a valid erasure request is approved, HR/MD anonymize the
  user/employee record instead of deleting it: the record itself (and its attendance, leave, payroll and
  audit rows) stays, but the personal data in it is replaced with non-identifying values.
- **Fields anonymized on the user/employee record:** full name, work and personal email addresses, phone
  number, home address, bank details (account number, IFSC and any stored banking fields — these are
  encrypted at rest and are overwritten, not merely hidden), and any other directly identifying contact
  or personal fields on the record. The employee code is replaced with an anonymized placeholder so the
  row can no longer be tied back to the person. Login credentials for that user are revoked at the same
  time (all sessions revoked, password invalidated).
- **What is retained, and for how long:** anonymized attendance, leave and payroll records, and the audit
  rows that reference them, are retained for legal and payroll record-keeping — i.e. so past pay, statutory
  deductions (PF/ESI/PT/TDS) and attendance history remain auditable after the person has left. Retention
  follows the company's statutory record-keeping obligations (as advised by counsel/CA); as a product
  default, anonymized payroll and audit records are kept for at least 8 years from the end of the relevant
  financial year, and anonymized attendance/leave records for at least 3 years, unless counsel advises a
  longer period for a specific record type. After the retention period, anonymized rows may be purged in
  bulk by an MD-approved, logged maintenance operation.
- **What is NOT retained:** the original identifying values listed above are not kept in a shadow copy,
  backup-exempt side table, or export once anonymization is done (note: backups taken before
  anonymization will still contain the old values until they age out under the backup retention policy —
  restores must re-run anonymization for any record anonymized after the backup was taken).

## Deployment (docker compose)

The deployment story is `docker-compose.yml` (review fix B1): Postgres +
API + web from a single multi-stage `Dockerfile` at the repo root, behind
a Caddy reverse proxy (`Caddyfile`) that serves web and API under ONE
origin so the SameSite=Lax refresh cookie works. Only the proxy is
published on the host; the API and web services are internal-only. The
runtime image runs as the non-root `node` user. The web bundle's API base
is a build arg, not a baked-in localhost address: compose passes
`NEXT_PUBLIC_API_URL` (default `/api/v1`, i.e. the same-origin proxy path)
into the web build; override it only if the API lives on a different
public origin than the web app.

```bash
# .env next to docker-compose.yml (never commit it):
#   POSTGRES_PASSWORD=<strong password>
#   JWT_ACCESS_SECRET=<random hex — see apps/api/.env.example>
#   BANK_ENCRYPTION_KEY=<64 hex chars, required in production>
docker compose up --build
# Public entry point: http://localhost:8080
#   Web: http://localhost:8080 — API: http://localhost:8080/api/v1
#   Health: GET http://localhost:8080/api/v1/health → { status: "ok", db: "up" | "down" }
```

Postgres in compose is `postgres:18-alpine` (matching the stack line above).
A `pgdata` volume created by an older major version will not auto-upgrade:
dump from the old version and restore into a fresh 18 volume instead of
reusing it. Docker image build / compose-up are verified on a machine with
a Docker daemon; they cannot be verified in a sandbox without one.

The API container runs `prisma migrate deploy` before starting, so a fresh
database is migrated automatically. For production, put the API behind HTTPS,
set `COOKIE_SECURE=true`, and use managed Postgres (below) instead of the
compose Postgres service.

## Backups & restore

**Recommended: managed Postgres** (RDS, Cloud SQL, Neon, Supabase, …) with
its automated backups + point-in-time recovery enabled. That is the whole
backup story for most deployments — the script below is only for
self-hosted Postgres.

**Self-hosted example — `scripts/backup.sh`:**

```bash
DATABASE_URL=postgres://attenza:<password>@<host>:5432/attenza \
  BACKUP_DIR=/var/backups/attenza BACKUP_KEEP_DAYS=30 \
  ./scripts/backup.sh
# → /var/backups/attenza/attenza-YYYYMMDD-HHMMSS.dump (pg_dump custom format)
#   and backups older than BACKUP_KEEP_DAYS (default 30) are pruned.
```

Run it on a schedule (cron / systemd timer), e.g. nightly at 03:00, and
**test the restore** — an untested backup is not a backup:

```bash
# 1. Create a scratch database and restore into it (never over production
#    to "test" — restore to a scratch DB, then point a throwaway API at it).
createdb attenza_restore_test
pg_restore -d attenza_restore_test /var/backups/attenza/attenza-<stamp>.dump
# 2. Verify: row counts, then boot the API against the restored DB and
#    check GET /api/v1/health returns { status: "ok", db: "up" }.
# 3. Real restore (only after a verified scratch restore): stop the API,
#    drop + recreate the production database, pg_restore into it, restart.
```

Also back up the deployment's secret store contents separately — in
particular `BANK_ENCRYPTION_KEY`: losing it makes stored bank details
unrecoverable, and it is not (and must never be) inside a database dump.

## Billing number prefixes (2026-10-21 review fix B8)

Invoice and quotation numbers auto-generate as `<prefix>/<FY>/<seq>`
(e.g. `ATL/2026-27/003`), exactly like quotations always did. The prefixes
live in `Company.settings.billing` — `{ "billing": { "quotationPrefix":
"ATQ", "invoicePrefix": "ATL" } }` — and default to `ATQ` / `ATL` when
unset. An explicitly supplied invoice number is still accepted verbatim
(seed/manual numbers keep working); auto-generation only kicks in when no
number is provided.
