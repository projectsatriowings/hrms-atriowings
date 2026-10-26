# API Contract — Attenza (v1)

Base URL: `http://localhost:4000/api/v1` (dev). All JSON. Times in ISO-8601 UTC;
dates as `YYYY-MM-DD` (company timezone Asia/Kolkata).

## Auth

- `POST /auth/login` `{email, password}` → `200 {accessToken, user: AuthUser}`.
  Sets `refresh_token` httpOnly cookie. `AuthUser` = `{id, email, role,
  companyId, companyName, companyTimezone, employeeId, employeeName}`.
- `POST /auth/refresh` (cookie) → `200 {accessToken}`. `401` when expired.
- `POST /auth/logout` → clears cookie, revokes session.
- `GET /auth/me` (Bearer) → `200 AuthUser`.
- Errors: `4xx/5xx {error: {code, message, details?}}`. `401` = unauthenticated,
  `403` = authenticated but not permitted (including cross-company).

All `/api/v1/*` except `/auth/login` and `/auth/refresh` require
`Authorization: Bearer <accessToken>`. Company scoping is automatic from the
token — the client never sends `companyId`.

## Conventions

- Lists: `GET /x?page=1&pageSize=20&search=` →
  `{data: [...], total, page, pageSize}`.
- CSV export: `GET /x/export?...` → `text/csv` download.
- Validation failures: `422 {error: {code: "validation_error", details}}`.

## Endpoints

### Users & admin
- `GET /users` (hr, md) — list users w/ role, status, employee link
- `POST /users` (md) — CreateUserInput
- `PATCH /users/:id/role` (md) `{role}` · `PATCH /users/:id/status` (md) `{status}`
- `GET /admin/departments` · `POST /admin/departments` (hr+) · `PATCH /admin/departments/:id` · `DELETE /admin/departments/:id`
- Same CRUD shape for `/admin/designations`
- `GET /admin/holidays?year=` · `POST /admin/holidays` · `DELETE /admin/holidays/:id`
- `GET /leave/types` · `POST /leave/types` (hr+) · `PATCH /leave/types/:id`
- `GET /attendance/policies` · `POST /attendance/policies` (hr+) — pass `isDefault: true` to switch the default
- `PATCH /attendance/policies/:id` (hr+) — partial update. Geofence fields:
  `{officeLatitude?, officeLongitude?, geofenceRadiusMeters? (50–5000), requireLocation?}`
- `GET /admin/company/settings` · `PATCH /admin/company/settings` (md) `{name?, timezone?, logoUrl?, settings?, legal?}` — GET also returns `legal`: the letterhead identity `{legalName, pan, gstin, cin, registeredOffice, headOffice}` (stored in `settings.legal`, merged over built-in Atriowings defaults). PATCH `{legal: {...partial}}` merges into `settings.legal`. Printed on quotation + invoice PDFs.
- `GET /admin/audit-logs?page=&pageSize=&entityType=&action=` (hr, md)

### Employees (hr/md write; employee read self)
- `GET /employees?search=&departmentId=&status=&page=&pageSize=` → Paginated<Employee>
  `Employee` = `{id, employeeCode, fullName, workEmail, phone, joiningDate,
  department, designation, manager: {id, fullName} | null, employmentStatus,
  employmentType, dateOfExit, address}`
  `address` (always present, `null` when not recorded) = `{current?, permanent?}`,
  each a postal address `{line?, city?, state?, pin?}`. List responses never
  contain `bankDetails` (see the detail endpoint rule below).
- `POST /employees` (hr) — CreateEmployeeInput → `201 Employee & {login}`
  `409` on duplicate code/email. CreateEmployeeInput also accepts optional
  `address` and `bankDetails` (`{accountHolder?, bankName?, accountNumber?,
  ifsc?, branch?}`); both are stored on the employee. A login is auto-created when the employee has
  an email and no user with that email exists in the company: the response
  includes `login: {email, temporaryPassword}` (temporary password shown ONCE —
  only its hash is stored). Otherwise `login: null`. (Bulk import does not
  auto-create logins.)
- `GET /employees/:id` → full profile `{employee, user, salaryStructures,
  recentAttendance, leaveBalances}`. `employee` additionally carries
  `emergencyContact`, `createdAt` and `bankDetails`.
  **Bank-details visibility rule:** `bankDetails` is sensitive (salary account)
  and is returned only when the requester is `hr`/`md` or the employee
  themself; for any other requester it is `null`. It never appears in list,
  create, update, deactivate or reactivate responses.
- `PATCH /employees/:id` (hr) — UpdateEmployeeInput (accepts `address` and
  `bankDetails` like create; omitted fields are left unchanged)
- `POST /employees/:id/deactivate` (hr) `{dateOfExit?, reason}` →
  status `exited`, audit-logged. `POST /employees/:id/reactivate`.
- `POST /employees/:id/create-login` (hr) `{role}` → creates a login for an employee that doesn't have one.
- `GET /employees/import/template` → CSV template download
- `POST /employees/import/preview` (multipart `file`) → `{rows: ImportPreviewRow[], validCount, errorCount}`
- `POST /employees/import/commit` (hr) `{rows: Record<string,string>[]}` →
  `{imported, failed: [{rowNumber, errors}]}` (transactional per-row, never silent)
- `GET /employees/:id/salary-structures` · `POST /employees/:id/salary-structures` (hr) — SalaryStructureInput (creates new effective-dated revision)

### Attendance
- `GET /attendance/me/today` → `{record | null, policy, serverTime, isWfhToday}` — employee home
- `POST /attendance/check-in` → `201 AttendanceRecord` (`409` if already punched in).
  Optional JSON body `{latitude?, longitude?}`. If the default policy has
  `requireLocation: true` and office coordinates set: missing coords → `400`
  `{code: "location_required"}`; outside the geofence → `403`
  `{code: "outside_geofence", message: "You are X m away from the office",
  details: {distanceMeters}}`; inside → record stores `checkInLat/checkInLng`
  with `locationVerified: true`. Coords sent when not required are stored and
  verified against the office geofence when one is configured.
  **WFH days skip the entire geofence block**: if an approved WFH request or a
  company WFH day covers today, the record is created with `wfh: true`
  (coords still stored when provided, `locationVerified: false`).
- `POST /attendance/check-out` → `200 AttendanceRecord` (`409` if no open check-in)
- `POST /attendance/biometric-punch` — **no JWT**; device-authenticated via
  `x-device-key` header. Rate-limited to 60 req/min. Body `BiometricPunchInput`
  = `{deviceUserId, timestamp (ISO), type: "in" | "out"}`. Errors:
  `401 {code: "invalid_device_key"}`, `400 {code: "bad_timestamp"}` (timestamp
  older than 24h or more than 10 min in the future), `404 {code: "unmapped_user"}`,
  `409` on duplicate/missing punches (same codes as self check-in/out).
  Type `"in"` uses the device timestamp (skew-validated) as `checkInAt` and sets
  `source: "biometric"`, `locationVerified: true`.
- `GET /attendance/me?from=&to=` → own history
- `GET /attendance/daily?date=&departmentId=` (hr, md) →
  `{date, totals: {present, absent, onLeave, late, missingCheckout, weeklyOff, holiday},
   records: [{employee, record}]}` — filter pills slice client-side
- `GET /attendance/monthly?year=&month=&departmentId=` → `{weeks/days grid, employees[]}`
- `GET /attendance/export?from=&to=&departmentId=` → CSV
- `POST /attendance/records/:id/correct` (hr) — CorrectAttendanceInput
- `GET /attendance/records/:id/corrections` → history
- AttendanceRecord JSON now includes `wfh: boolean` (true when punched on a WFH day)

### Work from home
On WFH days the geofence is skipped entirely (see check-in above); biometric
punches are unaffected (the employee is not at the device, so they simply
self check in from home).
- `POST /attendance/wfh-requests` — WfhRequestInput `{date (YYYY-MM-DD, today or
  future), reason?}` → `201 WfhRequest`. Errors: `400 {code: "past_date"}`,
  `409 {code: "duplicate_wfh"}`, `409 {code: "company_wfh_day"}`
- `GET /attendance/wfh-requests/me` → own requests, newest first
- `GET /attendance/wfh-requests/team?status=` (hr, md) →
  requests with employee info; hr/md see all company requests
- `POST /attendance/wfh-requests/:id/approve` and `/:id/reject`
  (hr, md) — optional body WfhDecideInput `{note?}` →
  `200 WfhRequest`. Errors: `404 {code: "not_found"}`,
  `409 {code: "already_decided"}`, `403 {code: "forbidden"}` (not the approver)
- `GET /attendance/wfh-days` (hr, md) → company-wide WFH days
- `POST /attendance/wfh-days` (hr, md) — WfhDayInput
  `{date (YYYY-MM-DD), note?}` → `201 WfhDay`;
  `409 {code: "duplicate_wfh_day"}`
- `DELETE /attendance/wfh-days/:id` (hr, md) → `{deleted: true}`
- WFH decisions and WFH-day changes are audit-logged
  (`wfh.approved`, `wfh.rejected`, `wfh.day_added`, `wfh.day_removed`)

### Biometric devices (hr, md)
- `GET /admin/biometric/devices?page=&pageSize=` → paginated `{id, name, status,
  lastSeenAt, createdAt, updatedAt, _count: {mappings}}` — the API key hash is
  never returned
- `POST /admin/biometric/devices` — BiometricDeviceInput `{name, status?}` →
  `201 {id, name, status, …, apiKey}`. The plaintext key (`hrms_bm_` + 64 hex
  chars) is returned **once**; only its SHA-256 hex digest is stored.
  `409 {code: "duplicate_device_name"}` on name clash
- `PATCH /admin/biometric/devices/:id` — `{name?, status?}` (`status`:
  `"active" | "disabled"`); disabled devices are rejected at punch time
- `DELETE /admin/biometric/devices/:id` → `{deleted: true}` (mappings cascade)
- `GET /admin/biometric/devices/:id/mappings` → `[{id, deviceUserId, createdAt,
  employee: {id, fullName, employeeCode, employmentStatus}}]`
- `POST /admin/biometric/devices/:id/mappings` — BiometricMappingInput
  `{deviceUserId, employeeId}` (employee must belong to the company) →
  `201 {id, deviceUserId, createdAt}`; `409 {code: "mapping_conflict"}` if the
  device user or employee is already mapped on that device
- `DELETE /admin/biometric/devices/:id/mappings/:mappingId` → `{deleted: true}`
- All create/update/delete actions are audit-logged
  (`biometric.device_created/updated/deleted`, `biometric.mapping_created/deleted`)

### Leave
- `GET /leave/types` (all authenticated)
- `GET /leave/balances/me?year=` → `[{leaveType, allocated, used, adjustments, carryForward, balance, ledger: [...]}]`
- `GET /leave/balances/:employeeId?year=` (hr, md)
- `POST /leave/requests` — ApplyLeaveInput → `201 {request, workingDates, overlappingLeaves}` (`request.days` = working-day count; `overlappingLeaves` = colleagues on approved leave in range: "who else is off" warning)
- `GET /leave/requests/me?status=` · `GET /leave/requests/pending` (hr, md) → inbox
- `POST /leave/requests/:id/decide` (hr, md) — DecideLeaveInput
- `POST /leave/requests/:id/cancel` (owner of request, if pending)
- `GET /leave/calendar?year=&month=&departmentId=` → array of `{id, status, employeeName, leaveType, fromDate, toDate}` (respects visibility; expand ranges client-side)
- `POST /leave/balances/:employeeId/adjust` (hr) — LeaveAdjustmentInput (audited)

### Payroll (hr prepares; md approves; employee sees own payslips)
- `GET /payroll/periods` · `POST /payroll/periods` (hr) — PayrollPeriodInput
- `GET /payroll/periods/:id` → `{period, records: [{employee, gross, totalDeductions, netPay, lopDays, paidDays, status, components[]}], totals, prevTotals}` (month-on-month compare)
- `POST /payroll/periods/:id/compute` (hr) → runs draft calc (idempotent until finalized). Response (and `GET /payroll/periods/:id`) includes `attendanceCoverage` `{expectedDays, daysWithoutRecord, coveragePercent}` and `warnings[]`: days with no attendance record are treated as LOP, and a coverage warning is returned whenever any working day lacks a record — verify attendance before finalising.
- `POST /payroll/periods/:id/adjust` (hr) — PayrollAdjustmentInput (reason required, audited)
- `POST /payroll/periods/:id/submit` (hr) → draft → in_review
- `POST /payroll/periods/:id/approve` (md) → approved; `POST /payroll/periods/:id/finalize` (md) → finalized + locked
- `GET /payroll/periods/:id/export` → CSV download (payroll register)
- `GET /payroll/payslips/me?year=&month=` → own payslip `{period, record: {employee, period, components[], gross, totalDeductions, netPay}}`
- `GET /payroll/periods/:id/cost-by-department` → `[{department, headcount, gross, netPay}]`

### Billing (hr, md)
- `GET /customers` · `POST /customers` · `PATCH /customers/:id`
- `GET /invoices?status=&customerId=&from=&to=` → Paginated<InvoiceSummary> `{..., balance}`
- `POST /invoices` — CreateInvoiceInput → totals computed server-side
- `GET /invoices/:id` → `{invoice, items, payments, balance}`
- `POST /invoices/:id/issue` (draft → issued) · `POST /invoices/:id/payments` — InvoicePaymentInput (auto-updates status/amountPaid)
- `GET /invoices/:id/pdf` → PDF download (on company letterhead — logo, legal name, GSTIN, reg/head office footer)
- `GET /billing/outstanding` → `{invoices past due / unpaid, totalOutstanding}`

#### Quotations (hr, md) — printed on the company letterhead
- `GET /billing/quotations?status=&customerId=&search=&page=&pageSize=` → Paginated<Quotation> `{..., customer {id, name}, itemsCount}` (search matches quotation no / customer name)
- `POST /billing/quotations` — CreateQuotationInput `{customerId, issueDate, validUntil, items[], terms?, notes?}` → 201. `quotationNo` auto-generated `ATQ/{FY}/{seq}` (Indian FY of issueDate, seq per company+FY, zero-padded 3); totals computed server-side like invoices; starts `draft`; `validUntil < issueDate` → 400 `invalid_dates`
- `GET /billing/quotations/:id` → quotation `{..., items[], customer}`
- `PATCH /billing/quotations/:id` — partial CreateQuotationInput; **draft only** (else 409 `not_editable`); totals recomputed
- `DELETE /billing/quotations/:id` — draft only (else 409 `not_editable`)
- `POST /billing/quotations/:id/status` — `{status: sent|accepted|rejected|expired}`; transitions: draft→sent, draft→expired, sent→accepted/rejected/expired; else 409 `invalid_transition` (audited `billing.quotation_status`)
- `POST /billing/quotations/:id/convert` — **accepted only** (else 409 `not_accepted`) → 201 Invoice (draft): copies customer/items/totals, `invoiceNo` auto `ATL/{FY}/{seq}`, `issueDate` = quotation issue date, `dueDate` = quotation `validUntil`, notes reference the quotation no; quotation → `converted` + `convertedInvoiceId` (audited `billing.quotation_converted` + `billing.invoice_created`)
- `GET /billing/quotations/:id/pdf` → quotation PDF download on letterhead (items, totals, amount in words, terms, authorised-signatory block)

### Dashboard (all authenticated; data scoped by role)
- `GET /dashboard` → `{headcount: {active, onNotice}, today: {present, absent, onLeave, late, missingCheckout}, pendingLeaves, exceptions: [...], payroll: {period, status, total?}, outstandingInvoices: {count, total} | null, recentActivity: [...]}`
  Every card deep-links to its filtered view. `exceptions[]` items carry `{kind, label, link}`.

### Reports (permission-checked)
- `GET /reports/attendance-daily?date=` · `/reports/attendance-monthly?year=&month=` → JSON tables (CSV via `GET /attendance/export?...`)
- `GET /reports/leave-balances?year=` · `GET /reports/payroll-register?year=&month=` → JSON (payroll CSV via `GET /payroll/periods/:id/export`)
