import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ReportsService } from "./reports.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodQuery } from "../common/zod.pipe";
import { z } from "@hrms/shared";

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), departmentId: z.string().optional() });
const monthQuery = z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12), departmentId: z.string().optional() });
const yearQuery = z.object({ year: z.coerce.number().int() });

@Controller("reports")
@Roles("hr", "md")
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get("attendance-daily")
  attendanceDaily(@CurrentUser() user: RequestUser, @Query(ZodQuery(dateQuery)) q: z.infer<typeof dateQuery>) {
    return this.reports.attendanceDaily(user, q.date, q.departmentId);
  }

  @Get("attendance-monthly")
  attendanceMonthly(@CurrentUser() user: RequestUser, @Query(ZodQuery(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.reports.attendanceMonthly(user, q.year, q.month, q.departmentId);
  }

  @Get("leave-balances")
  @Roles("hr", "md")
  leaveBalances(@CurrentUser() user: RequestUser, @Query(ZodQuery(yearQuery)) q: { year: number }) {
    return this.reports.leaveBalances(user, q.year);
  }

  @Get("leave-balances/export")
  @Roles("hr", "md")
  async leaveBalancesCsv(@CurrentUser() user: RequestUser, @Query(ZodQuery(yearQuery)) q: { year: number }, @Res() res: Response) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=leave-balances-${q.year}.csv`);
    res.send(await this.reports.leaveBalancesCsv(user, q.year));
  }

  @Get("payroll-register")
  @Roles("hr", "md")
  payrollRegisterJson(@CurrentUser() user: RequestUser, @Query(ZodQuery(monthQuery)) q: { year: number; month: number }) {
    return this.reports.payrollRegisterJson(user, q.year, q.month);
  }

  @Get("payroll-register/export")
  @Roles("hr", "md")
  async payrollRegister(@CurrentUser() user: RequestUser, @Query(ZodQuery(monthQuery)) q: { year: number; month: number }, @Res() res: Response) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=payroll-register-${q.year}-${q.month}.csv`);
    res.send(await this.reports.payrollRegister(user, q.year, q.month));
  }
}
