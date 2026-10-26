// API smoke test — exercises critical paths against a running API.
// Usage: node smoke.mjs  (API at http://localhost:4000)
const BASE = "http://localhost:4000/api/v1";
let failures = 0;

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { payload = form; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${extra}`); failures++; }
}

async function login(email, password) {
  const r = await req("POST", "/auth/login", { body: { email, password } });
  check(`login ${email}`, r.status === 200 && r.json.accessToken, `status=${r.status}`);
  return r.json?.accessToken;
}

async function main() {
  console.log("== auth ==");
  const ownerTok = await login("admin@atriowings.in", "Atriowings@123");
  const hrTok = await login("hr@atriowings.in", "Atriowings@123");
  const empTok = await login("karthik.n@atriowings.in", "Atriowings@123");
  if (!ownerTok || !hrTok || !empTok) { console.log("FATAL: logins failed"); process.exit(1); }

  const bad = await req("POST", "/auth/login", { body: { email: "admin@atriowings.in", password: "wrong" } });
  check("bad password -> 401", bad.status === 401, `status=${bad.status}`);

  const noAuth = await req("GET", "/employees");
  check("no token -> 401", noAuth.status === 401, `status=${noAuth.status}`);

  console.log("== RBAC ==");
  const empAdmin = await req("GET", "/users", { token: empTok });
  check("employee cannot list users -> 403", empAdmin.status === 403, `status=${empAdmin.status}`);
  const empPayroll = await req("GET", "/payroll/periods", { token: empTok });
  check("employee cannot list payroll -> 403", empPayroll.status === 403, `status=${empPayroll.status}`);

  console.log("== employees ==");
  const list = await req("GET", "/employees?pageSize=5", { token: hrTok });
  check("list employees", list.status === 200 && list.json.total >= 12, `status=${list.status} total=${list.json?.total}`);
  const me = await req("GET", "/auth/me", { token: empTok });
  check("me", me.status === 200 && me.json.email === "karthik.n@atriowings.in");
  const empId = me.json.employeeId;
  const profile = await req("GET", `/employees/${empId}`, { token: empTok });
  check("employee sees own profile", profile.status === 200, `status=${profile.status}`);
  const otherId = list.json.data.find((e) => e.id !== empId)?.id;
  const forbidden = await req("GET", `/employees/${otherId}`, { token: empTok });
  check("employee cannot see other profile -> 404", forbidden.status === 404, `status=${forbidden.status}`);

  console.log("== attendance ==");
  const today1 = await req("GET", "/attendance/me/today", { token: empTok });
  check("today status", today1.status === 200 && today1.json.serverTime, `status=${today1.status}`);
  const in1 = await req("POST", "/attendance/check-in", { token: empTok });
  const alreadyDone = today1.json.record && today1.json.record.checkOutAt;
  check("check-in (or already done today)", in1.status === 201 || in1.status === 409, `status=${in1.status}`);
  const in2 = await req("POST", "/attendance/check-in", { token: empTok });
  check("duplicate check-in -> 409", in2.status === 409, `status=${in2.status}`);
  const out1 = await req("POST", "/attendance/check-out", { token: empTok });
  check("check-out (or already done)", out1.status === 200 || (alreadyDone && out1.status === 409), `status=${out1.status}`);
  const hrDaily = await req("GET", `/attendance/daily?date=${new Date().toISOString().slice(0, 10)}`, { token: hrTok });
  check("HR daily dashboard", hrDaily.status === 200 && hrDaily.json.totals, `status=${hrDaily.status}`);
  const empDaily = await req("GET", `/attendance/daily?date=${new Date().toISOString().slice(0, 10)}`, { token: empTok });
  check("employee cannot see daily -> 403", empDaily.status === 403, `status=${empDaily.status}`);

  console.log("== leave ==");
  const bal = await req("GET", "/leave/balances/me?year=2026", { token: empTok });
  check("my balances", bal.status === 200 && bal.json.length >= 3, `status=${bal.status}`);
  const types = await req("GET", "/leave/types", { token: empTok });
  const clId = types.json.find((t) => t.code === "CL")?.id;
  // Pick a weekday inside the CURRENT year: leave allocations only exist
  // for the current year (next year's are created by the Jan 1 rollover job),
  // so a date landing in January would fail with insufficient_balance even
  // on a pristine seed. Two weeks out, clamped to Dec 28 of this year.
  const thisYear = new Date().getUTCFullYear();
  let leaveDate = new Date(Date.now() + 14 * 864e5);
  if (leaveDate.getUTCFullYear() !== thisYear) leaveDate = new Date(Date.UTC(thisYear, 11, 28));
  while (leaveDate.getUTCDay() === 0) leaveDate.setUTCDate(leaveDate.getUTCDate() + 1);
  const nextWeek = leaveDate.toISOString().slice(0, 10);
  const apply = await req("POST", "/leave/requests", { token: empTok, body: { leaveTypeId: clId, fromDate: nextWeek, toDate: nextWeek, reason: "Smoke test leave" } });
  check("apply leave", apply.status === 201, `status=${apply.status} ${apply.text.slice(0, 120)}`);
  const reqId = apply.json?.request?.id;
  if (reqId) {
    const inbox = await req("GET", "/leave/requests/pending", { token: hrTok });
    check("HR sees pending", inbox.status === 200 && inbox.json.data.some((r) => r.id === reqId));
    const decide = await req("POST", `/leave/requests/${reqId}/decide`, { token: hrTok, body: { decision: "approved", comment: "Smoke approved" } });
    check("approve leave", decide.status === 200 || decide.status === 201, `status=${decide.status}`);
    const bal2 = await req("GET", `/leave/balances/me?year=${thisYear}`, { token: empTok });
    const cl2 = bal2.json.find((b) => b.leaveType.code === "CL");
    check("balance deducted after approval", cl2 && cl2.balance < 12, `balance=${cl2?.balance}`);
  }

  console.log("== payroll ==");
  const periods = await req("GET", "/payroll/periods", { token: hrTok });
  check("list periods", periods.status === 200, `status=${periods.status}`);
  // Use the first free period slot (idempotent across runs)
  let pid = null;
  for (let m = 1; m <= 12 && !pid; m++) {
    const r = await req("POST", "/payroll/periods", { token: hrTok, body: { year: 2027, month: m } });
    if (r.status === 201) { pid = r.json.id; check(`create period 2027-${String(m).padStart(2, "0")}`, true); }
  }
  if (!pid) { check("create period (all 2027 slots taken)", false); }
  if (pid) {
    const comp = await req("POST", `/payroll/periods/${pid}/compute`, { token: hrTok });
    check("compute payroll", comp.status === 200 || comp.status === 201, `status=${comp.status} ${comp.text.slice(0, 150)}`);
    const detail = await req("GET", `/payroll/periods/${pid}`, { token: hrTok });
    check("period detail", detail.status === 200 && detail.json.records.length > 0, `records=${detail.json?.records?.length}`);
    const rec = detail.json.records[0];
    check("record has components + PF", rec.components?.some((c) => c.componentKey === "pf_employee"), `components=${rec.components?.length}`);
    const sub = await req("POST", `/payroll/periods/${pid}/submit`, { token: hrTok });
    check("submit -> in_review", sub.status === 200 || sub.status === 201, `status=${sub.status}`);
    const appr = await req("POST", `/payroll/periods/${pid}/approve`, { token: ownerTok });
    check("owner approve", appr.status === 200 || appr.status === 201, `status=${appr.status}`);
    const fin = await req("POST", `/payroll/periods/${pid}/finalize`, { token: ownerTok });
    check("owner finalize", fin.status === 200 || fin.status === 201, `status=${fin.status}`);
    const recompute = await req("POST", `/payroll/periods/${pid}/compute`, { token: hrTok });
    check("recompute after finalize -> 409", recompute.status === 409, `status=${recompute.status}`);
    const payslip = await req("GET", `/payroll/payslips/me?year=${detail.json.period.year}&month=${detail.json.period.month}`, { token: empTok });
    check("employee payslip", payslip.status === 200 && payslip.json.record.netPay > 0, `status=${payslip.status}`);
  }

  console.log("== billing ==");
  const cust = await req("POST", "/customers", { token: hrTok, body: { name: "Smoke Test Traders", gstin: "33ABCDE9999F1Z5" } });
  check("create customer", cust.status === 201, `status=${cust.status}`);
  const custId = cust.json?.id;
  if (custId) {
    const inv = await req("POST", "/invoices", { token: hrTok, body: {
      customerId: custId, invoiceNo: `SMOKE/${Date.now()}`, issueDate: "2026-10-01", dueDate: "2026-10-31",
      items: [{ description: "Test item", quantity: 10, rate: 1000, taxRate: 18 }],
    }});
    check("create invoice (totals server-computed)", inv.status === 201 && inv.json.total === 11800, `status=${inv.status} total=${inv.json?.total}`);
    const invId = inv.json?.id;
    if (invId) {
      const issue = await req("POST", `/invoices/${invId}/issue`, { token: hrTok });
      check("issue invoice", issue.status === 200 || issue.status === 201, `status=${issue.status}`);
      const pay = await req("POST", `/invoices/${invId}/payments`, { token: hrTok, body: { amount: 11800, paidOn: "2026-10-14", method: "bank_transfer" } });
      check("record payment -> paid", pay.status === 200 || pay.status === 201, `status=${pay.status}`);
      const got = await req("GET", `/invoices/${invId}`, { token: hrTok });
      check("invoice paid + balance 0", got.json?.displayStatus === "paid" && got.json?.balance === 0, `status=${got.json?.displayStatus}`);
    }
  }

  console.log("== dashboard ==");
  const dash = await req("GET", "/dashboard", { token: hrTok });
  check("dashboard", dash.status === 200 && dash.json.headcount.active >= 12, `status=${dash.status}`);
  const dashEmp = await req("GET", "/dashboard", { token: empTok });
  check("employee dashboard (scoped)", dashEmp.status === 200 && dashEmp.json.outstandingInvoices === null);

  console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
