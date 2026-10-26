import { Injectable } from "@nestjs/common";
import { AttendanceService } from "../attendance/attendance.service";
import { LeaveService } from "../leave/leave.service";
import { PayrollService } from "../payroll/payroll.service";
import { PrismaService } from "../prisma/prisma.service";
import { toCsv } from "../common/utils";
import { RequestUser } from "../common/decorators";

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private attendance: AttendanceService,
    private leave: LeaveService,
    private payroll: PayrollService,
  ) {}

  attendanceDaily(user: RequestUser, date: string, departmentId?: string) {
    return this.attendance.daily(user, date, departmentId);
  }

  attendanceMonthly(user: RequestUser, year: number, month: number, departmentId?: string) {
    return this.attendance.monthly(user, year, month, departmentId);
  }

  async leaveBalances(user: RequestUser, year: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId: user.companyId, employmentStatus: "active" },
      select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } },
      orderBy: { fullName: "asc" },
    });
    const rows: Record<string, unknown>[] = [];
    for (const e of employees) {
      const balances = await this.leave.balancesFor(user, e.id, year);
      for (const b of balances) {
        rows.push({
          employeeCode: e.employeeCode, fullName: e.fullName, department: e.department?.name ?? "",
          leaveType: b.leaveType.name, allocated: b.allocated, used: b.used,
          adjustments: b.adjustments, carryForward: b.carryForward, balance: b.balance,
        });
      }
    }
    return rows;
  }

  async leaveBalancesCsv(user: RequestUser, year: number): Promise<string> {
    return toCsv(await this.leaveBalances(user, year));
  }

  async payrollRegister(user: RequestUser, year: number, month: number): Promise<string> {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { companyId: user.companyId, year, month } });
    if (!period) return toCsv([]);
    return this.payroll.registerCsv(user, period.id);
  }

  async payrollRegisterJson(user: RequestUser, year: number, month: number) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { companyId: user.companyId, year, month } });
    if (!period) return { period: null, rows: [] };
    const rows = await this.payroll.registerRows(user, period.id);
    return { period: { id: period.id, year: period.year, month: period.month, status: period.status }, rows };
  }
}
