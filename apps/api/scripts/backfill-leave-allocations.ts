// Backfill leave allocations for employees who have none.
//
// BACKGROUND: allocations used to exist only via seed, so employees added
// before the joining-year allocation hook (or imported before the import
// hook) have zero leave balance. This one-time script creates the missing
// entries. It is IDEMPOTENT: it never creates an allocation entry where
// one already exists for (employee, leave type, year), and it never
// updates or deletes anything — so re-running it is safe.
//
// WHAT IT CREATES, per ACTIVE employee and per ACTIVE leave type with
// defaultDays > 0:
//   1. Joining-year allocation, pro-rated by remaining months of the
//      joining year (joining month included), rounded to 2 decimals —
//      the same rule as employee creation (see proratedLeaveAllocation
//      in @hrms/shared).
//   2. If the joining year is before the current year, a FULL-year
//      allocation for the current year (the employee has been employed
//      for the whole of the current year, so no pro-rating applies).
//      This is the entry today's balance queries actually read.
// Skip rule: any (employee, type, year) that already has an `allocation`
// ledger entry is left untouched, whatever its value.
//
// HOW TO RUN (from apps/api/, against the migrated database):
//   DRY RUN (reports what would be created, writes nothing):
//     pnpm exec tsx scripts/backfill-leave-allocations.ts --dry-run
//   APPLY:
//     pnpm exec tsx scripts/backfill-leave-allocations.ts
//   Limit to one company:
//     pnpm exec tsx scripts/backfill-leave-allocations.ts --company-id=<id>
// DO NOT run this against a database you have not backed up first, and do
// not run it twice expecting different results — the second run is a no-op
// by design (see "already present" counts in the output).
//
// NOTE: this script is deliberately NOT run as part of any build, seed, or
// migration. An operator runs it once, reviews the dry-run output, then
// applies it.

import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { proratedLeaveAllocation } from "@hrms/shared";

// Minimal .env loader (no extra dependency) — mirrors src/seed.ts.
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const companyArg = args.find((a) => a.startsWith("--company-id="))?.split("=")[1];
  const currentYear = new Date().getFullYear();

  const companies = await prisma.company.findMany({
    where: companyArg ? { id: companyArg } : {},
    select: { id: true, name: true },
  });
  if (companies.length === 0) {
    console.log("No companies found — nothing to do.");
    return;
  }

  let wouldCreate = 0;
  let created = 0;
  let skipped = 0;
  for (const company of companies) {
    const [employees, types] = await Promise.all([
      prisma.employee.findMany({
        where: { companyId: company.id, employmentStatus: "active" },
        select: { id: true, fullName: true, joiningDate: true },
      }),
      prisma.leaveType.findMany({ where: { companyId: company.id, isActive: true } }),
    ]);
    for (const emp of employees) {
      const joiningYmd = ymdOf(emp.joiningDate);
      const joiningYear = Number(joiningYmd.slice(0, 4));
      // [year, deltaDays] pairs to ensure for this employee + type.
      for (const t of types) {
        const defaultDays = Number(t.defaultDays);
        if (!(defaultDays > 0)) continue;
        const targets: Array<{ year: number; deltaDays: number; note: string }> = [
          {
            year: joiningYear,
            deltaDays: proratedLeaveAllocation(defaultDays, joiningYmd),
            note: `Joining-year allocation (pro-rated, joined ${joiningYmd}) [backfill]`,
          },
        ];
        if (joiningYear < currentYear) {
          targets.push({
            year: currentYear,
            deltaDays: Math.round(defaultDays * 100) / 100,
            note: `Current-year allocation [backfill]`,
          });
        }
        for (const target of targets) {
          if (!(target.deltaDays > 0)) continue;
          const existing = await prisma.leaveLedger.findFirst({
            where: { companyId: company.id, employeeId: emp.id, leaveTypeId: t.id, year: target.year, entryType: "allocation" },
          });
          if (existing) {
            skipped++;
            continue;
          }
          if (dryRun) {
            console.log(`[dry-run] ${company.name} / ${emp.fullName} / ${t.code} / ${target.year}: +${target.deltaDays}`);
            wouldCreate++;
          } else {
            await prisma.leaveLedger.create({
              data: {
                companyId: company.id, employeeId: emp.id, leaveTypeId: t.id, year: target.year,
                deltaDays: target.deltaDays, entryType: "allocation", note: target.note, createdById: null,
              },
            });
            created++;
          }
        }
      }
    }
  }
  console.log(dryRun
    ? `Dry run complete: ${wouldCreate} allocation(s) would be created, ${skipped} already present (skipped). Nothing was written.`
    : `Backfill complete: ${created} allocation(s) created, ${skipped} already present (skipped).`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
