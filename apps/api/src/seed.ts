// Seed: fictional demo data for Atriowings Technologies.
// Run: pnpm --filter @hrms/api seed   (requires DATABASE_URL + migrated DB)
// Demo logins (change passwords immediately in real use):
//   Every employee has a login with the seed password Atriowings@123 —
//   employees sign in with their work email (role: employee), except:
//   admin@atriowings.in / Atriowings@123  (md — Vikram Aditya, EMP001)
//   hr@atriowings.in    / Atriowings@123  (hr — Divya Raghavan, EMP012)
//
// NOTE: the @atriowings.in email domain is a placeholder. Replace with the
// company's real domain before inviting actual staff.

import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { LEGAL_DEFAULTS } from "./billing/letterhead";

// Minimal .env loader (no extra dependency) — seed runs from apps/api/
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const SEED_PASSWORD = "Atriowings@123";

async function main() {
  // ── Company ──
  const company = await prisma.company.upsert({
    where: { slug: "atriowings" },
    update: {},
    create: {
      name: "Atriowings Technologies",
      slug: "atriowings",
      timezone: "Asia/Kolkata",
      settings: { currency: "INR", invoicePrefix: "ATL", legal: { ...LEGAL_DEFAULTS } },
    },
  });

  // ── Departments & designations ──
  const deptNames = ["Engineering", "Design", "Digital Marketing", "Sales", "Accounts", "HR & Admin"];
  const depts: Record<string, string> = {};
  for (const name of deptNames) {
    const d = await prisma.department.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {}, create: { companyId: company.id, name },
    });
    depts[name] = d.id;
  }
  const desigDefs: [string, number][] = [
    ["CTO", 5], ["Engineering Manager", 4], ["Marketing Manager", 4],
    ["Senior Software Developer", 3], ["SEO Lead", 3], ["Accountant", 3],
    ["Software Developer", 2], ["UI Designer", 2], ["HR Executive", 2],
    ["SEO Executive", 1], ["Social Media Executive", 1], ["Sales Executive", 1],
  ];
  const desigs: Record<string, string> = {};
  for (const [title, level] of desigDefs) {
    const d = await prisma.designation.upsert({
      where: { companyId_title: { companyId: company.id, title } },
      update: {}, create: { companyId: company.id, title, level },
    });
    desigs[title] = d.id;
  }

  // ── Attendance policy ──
  await prisma.attendancePolicy.upsert({
    where: { companyId_name: { companyId: company.id, name: "Default" } },
    update: {},
    create: {
      companyId: company.id, name: "Default", workStart: "09:30", workEnd: "18:00",
      graceMinutes: 10, weeklyOffs: [0], fullDayMinutes: 480, halfDayMinutes: 240, isDefault: true,
    },
  });

  // ── Leave types ──
  const leaveDefs = [
    { code: "CL", name: "Casual Leave", defaultDays: 12, carryForward: false },
    { code: "SL", name: "Sick Leave", defaultDays: 12, carryForward: false },
    { code: "EL", name: "Earned Leave", defaultDays: 15, carryForward: true, maxCarryDays: 30 },
    { code: "UNPAID", name: "Unpaid Leave", defaultDays: 0, carryForward: false },
  ];
  const leaveTypes: Record<string, { id: string }> = {};
  for (const def of leaveDefs) {
    const t = await prisma.leaveType.upsert({
      where: { companyId_code: { companyId: company.id, code: def.code } },
      update: {}, create: { companyId: company.id, ...def },
    });
    leaveTypes[def.code] = t;
  }

  // ── Holidays ──
  for (const [date, name] of [["2026-01-14", "Pongal"], ["2026-01-26", "Republic Day"], ["2026-10-19", "Diwali"], ["2026-12-25", "Christmas"]] as [string, string][]) {
    await prisma.holiday.upsert({
      where: { companyId_date: { companyId: company.id, date: D(date) } },
      update: {}, create: { companyId: company.id, date: D(date), name },
    });
  }

  // ── Employees (fictional) ──
  const empDefs: [string, string, string, string, string, string, string, number][] = [
    // code, name, email, dept, designation, managerCode, joiningDate, basic
    ["EMP001", "Vikram Aditya", "vikram.a@atriowings.in", "Engineering", "CTO", "", "2019-10-01", 120000],
    ["EMP002", "Sara Thomas", "sara.t@atriowings.in", "Engineering", "Engineering Manager", "EMP001", "2020-06-15", 90000],
    ["EMP003", "Rahul Verma", "rahul.v@atriowings.in", "Engineering", "Senior Software Developer", "EMP002", "2021-03-01", 75000],
    ["EMP004", "Karthik Narayanan", "karthik.n@atriowings.in", "Engineering", "Software Developer", "EMP002", "2022-05-10", 55000],
    ["EMP005", "Priya Nair", "priya.n@atriowings.in", "Digital Marketing", "Marketing Manager", "EMP001", "2020-09-01", 80000],
    ["EMP006", "Deepa Suresh", "deepa.s@atriowings.in", "Digital Marketing", "SEO Lead", "EMP005", "2021-04-01", 55000],
    ["EMP007", "Manoj Kumar", "manoj.k@atriowings.in", "Digital Marketing", "SEO Executive", "EMP006", "2022-11-01", 35000],
    ["EMP008", "Lakshmi Venkat", "lakshmi.v@atriowings.in", "Digital Marketing", "Social Media Executive", "EMP005", "2023-01-16", 32000],
    ["EMP009", "Anitha Devi", "anitha.d@atriowings.in", "Design", "UI Designer", "EMP001", "2022-03-01", 50000],
    ["EMP010", "Ravi Shankar", "ravi.s@atriowings.in", "Sales", "Sales Executive", "EMP001", "2022-11-01", 40000],
    ["EMP011", "Suresh Pillai", "suresh.p@atriowings.in", "Accounts", "Accountant", "EMP001", "2021-06-01", 45000],
    ["EMP012", "Divya Raghavan", "divya.r@atriowings.in", "HR & Admin", "HR Executive", "EMP001", "2022-02-01", 38000],
  ];
  const empIds: Record<string, string> = {};
  let phoneSeq = 9840012400;
  for (const [code, name, email, dept, desig, _mgr, doj, basic] of empDefs) {
    phoneSeq += 137;
    const emp = await prisma.employee.upsert({
      where: { companyId_employeeCode: { companyId: company.id, employeeCode: code } },
      update: {},
      create: {
        companyId: company.id, employeeCode: code, fullName: name, workEmail: email,
        phone: String(phoneSeq),
        joiningDate: D(doj), departmentId: depts[dept], designationId: desigs[desig],
        employmentStatus: "active", employmentType: "full_time",
      },
    });
    empIds[code] = emp.id;
    // Salary structure
    const hra = Math.round(basic * 0.4);
    await prisma.salaryStructure.create({
      data: {
        employeeId: emp.id, effectiveFrom: D("2026-04-01"), status: "active",
        components: { basic, hra, allowances: [{ label: "Conveyance", amount: 1600 }, { label: "Medical", amount: 1250 }], deductions: [] },
      },
    });
    // Leave allocation 2026
    for (const [ltCode, days] of [["CL", 12], ["SL", 12], ["EL", 15]] as [string, number][]) {
      await prisma.leaveLedger.create({
        data: {
          companyId: company.id, employeeId: emp.id, leaveTypeId: leaveTypes[ltCode].id,
          year: 2026, deltaDays: days, entryType: "allocation", note: "Annual allocation 2026",
        },
      });
    }
  }
  // Managers (second pass, codes now exist)
  for (const [code, , , , , mgr] of empDefs) {
    if (mgr) await prisma.employee.update({ where: { id: empIds[code] }, data: { managerId: empIds[mgr] } });
  }

  // ── Demo profile extras for EMP004 Karthik Narayanan (FICTIONAL demo data) ──
  await prisma.employee.update({
    where: { id: empIds["EMP004"] },
    data: {
      address: {
        current: { line: "12, 4th Cross Street, Anna Nagar", city: "Chennai", state: "Tamil Nadu", pin: "600040" },
        permanent: { line: "12, 4th Cross Street, Anna Nagar", city: "Chennai", state: "Tamil Nadu", pin: "600040" },
      },
      bankDetails: {
        accountHolder: "Karthik Narayanan", bankName: "HDFC Bank",
        accountNumber: "50100234567890", ifsc: "HDFC0001234", branch: "Anna Nagar",
      },
    },
  });

  // ── Users: one login per employee (User.employeeId is unique) ──
  // Most employees sign in with their work email (role: employee). Two
  // exceptions keep their long-standing logins instead: Vikram (EMP001)
  // signs in as admin@ with role md, and Divya (EMP012) signs in as hr@
  // with role hr — so Divya ends up with a single user whose role is hr.
  const specialLogins: Record<string, { email: string; role: "md" | "hr" }> = {
    EMP001: { email: "admin@atriowings.in", role: "md" },
    EMP012: { email: "hr@atriowings.in", role: "hr" },
  };
  const seedHash = await argon2.hash(SEED_PASSWORD);
  for (const [code, , workEmail] of empDefs) {
    const special = specialLogins[code];
    const email = special?.email ?? workEmail;
    const role = special?.role ?? "employee";
    await prisma.user.upsert({
      where: { email },
      update: { role },
      create: {
        companyId: company.id, email, passwordHash: seedHash, role,
        employeeId: empIds[code], status: "active",
      },
    });
  }

  // ── Sample attendance (yesterday: full day punches for a few staff) ──
  const yesterday = "2026-10-13";
  const punches: [string, string, string][] = [
    ["EMP004", "09:24", "18:05"], ["EMP010", "09:41", "18:02"], ["EMP009", "09:28", "17:55"], ["EMP012", "09:35", "18:10"],
  ];
  for (const [code, cin, cout] of punches) {
    const [ch, cm] = cin.split(":").map(Number);
    const [oh, om] = cout.split(":").map(Number);
    // 09:30 IST = 04:00 UTC
    const checkInAt = new Date(Date.UTC(2026, 9, 13, ch - 5, cm - 30));
    const checkOutAt = new Date(Date.UTC(2026, 9, 13, oh - 5, om - 30));
    const workingMinutes = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
    const lateMinutes = Math.max(0, Math.round((checkInAt.getTime() - Date.UTC(2026, 9, 13, 4, 10)) / 60000));
    await prisma.attendanceRecord.upsert({
      where: { employeeId_workDate: { employeeId: empIds[code], workDate: D(yesterday) } },
      update: {},
      create: {
        companyId: company.id, employeeId: empIds[code], workDate: D(yesterday),
        checkInAt, checkOutAt, status: "present", lateMinutes, workingMinutes, source: "self",
      },
    });
  }

  // ── Sample leave: one pending, one approved ──
  await prisma.leaveRequest.create({
    data: {
      companyId: company.id, employeeId: empIds["EMP004"], leaveTypeId: leaveTypes["CL"].id,
      fromDate: D("2026-10-20"), toDate: D("2026-10-21"), days: 2,
      reason: "Family function", status: "pending",
    },
  });
  const approved = await prisma.leaveRequest.create({
    data: {
      companyId: company.id, employeeId: empIds["EMP010"], leaveTypeId: leaveTypes["SL"].id,
      fromDate: D("2026-10-12"), toDate: D("2026-10-12"), days: 1,
      reason: "Fever", status: "approved", reviewerId: (await prisma.user.findFirst({ where: { email: "hr@atriowings.in" } }))!.id,
      decidedAt: new Date(),
    },
  });
  await prisma.leaveLedger.create({
    data: {
      companyId: company.id, employeeId: empIds["EMP010"], leaveTypeId: leaveTypes["SL"].id,
      year: 2026, deltaDays: -1, entryType: "usage", refRequestId: approved.id, note: "Approved sick leave 2026-10-12",
    },
  });
  await prisma.attendanceRecord.upsert({
    where: { employeeId_workDate: { employeeId: empIds["EMP010"], workDate: D("2026-10-12") } },
    update: { status: "on_leave" },
    create: {
      companyId: company.id, employeeId: empIds["EMP010"], workDate: D("2026-10-12"),
      status: "on_leave", source: "correction", note: "Approved leave",
    },
  });

  // ── Sample billing (guarded so re-seeds stay idempotent) ──
  const existingCustomer = await prisma.customer.findFirst({ where: { companyId: company.id, name: "Kovai Textiles Pvt Ltd" } });
  const customer = existingCustomer ?? (await prisma.customer.create({
    data: { companyId: company.id, name: "Kovai Textiles Pvt Ltd", gstin: "33ABCDE1234F1Z5", email: "accounts@kovaitextiles.in", phone: "9841098765" },
  }));
  if (!existingCustomer) await prisma.invoice.create({
    data: {
      companyId: company.id, customerId: customer.id, invoiceNo: "ATL/2026-27/001",
      issueDate: D("2026-10-01"), dueDate: D("2026-10-31"),
      subtotal: 50000, taxTotal: 9000, total: 59000, amountPaid: 0, status: "issued",
      notes: "Digital marketing retainer - October 2026",
      items: {
        create: [
          { description: "SEO retainer - October 2026", quantity: 1, rate: 40000, taxRate: 18, amount: 47200 },
          { description: "Google Ads management fee", quantity: 1, rate: 10000, taxRate: 18, amount: 11800 },
        ],
      },
    },
  });

  console.log("Seed complete: Atriowings Technologies");
  console.log(`  MD login: admin@atriowings.in / ${SEED_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
