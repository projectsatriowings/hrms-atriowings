import { Body, Controller, Delete, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { PayrollService } from "./payroll.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import {
  payrollAdjustmentCreateSchema, payrollAdjustmentSchema, payrollPeriodSchema, z,
  type PayrollAdjustmentCreateInput, type PayrollAdjustmentInput, type PayrollPeriodInput,
} from "@hrms/shared";

const periodQuery = z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12) });

@Controller("payroll")
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get("periods")
  @Roles("hr", "md")
  periods(@CurrentUser() user: RequestUser) {
    return this.payroll.listPeriods(user);
  }

  @Post("periods")
  @Roles("hr", "md")
  createPeriod(@CurrentUser() user: RequestUser, @Body(ZodBody(payrollPeriodSchema)) body: PayrollPeriodInput) {
    return this.payroll.createPeriod(user, body);
  }

  @Get("periods/:id")
  @Roles("hr", "md")
  getPeriod(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.getPeriod(user, id);
  }

  @Post("periods/:id/compute")
  @Roles("hr", "md")
  compute(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.compute(user, id);
  }

  @Post("periods/:id/adjust")
  @Roles("hr", "md")
  adjust(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(payrollAdjustmentSchema)) body: PayrollAdjustmentInput) {
    return this.payroll.adjust(user, id, body);
  }

  // Adjustments stored in PayrollAdjustment — they survive recompute.
  // Draft / in_review only; finalized (or approved) periods return 409.
  @Get("periods/:id/adjustments")
  @Roles("hr", "md")
  listAdjustments(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.listAdjustments(user, id);
  }

  @Post("periods/:id/adjustments")
  @Roles("hr", "md")
  addAdjustment(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(payrollAdjustmentCreateSchema)) body: PayrollAdjustmentCreateInput) {
    return this.payroll.addAdjustment(user, id, body);
  }

  @Delete("periods/:id/adjustments/:adjustmentId")
  @Roles("hr", "md")
  removeAdjustment(@CurrentUser() user: RequestUser, @Param("id") id: string, @Param("adjustmentId") adjustmentId: string) {
    return this.payroll.removeAdjustment(user, id, adjustmentId);
  }

  @Post("periods/:id/submit")
  @Roles("hr", "md")
  submit(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.submit(user, id);
  }

  @Post("periods/:id/approve")
  @Roles("md")
  approve(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.approve(user, id);
  }

  @Post("periods/:id/finalize")
  @Roles("md")
  finalize(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.finalize(user, id);
  }

  @Get("periods/:id/export")
  @Roles("hr", "md")
  async export(@CurrentUser() user: RequestUser, @Param("id") id: string, @Res() res: Response) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=payroll-register.csv`);
    res.send(await this.payroll.registerCsv(user, id));
  }

  @Get("periods/:id/cost-by-department")
  @Roles("hr", "md")
  costByDepartment(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.payroll.costByDepartment(user, id);
  }

  @Get("payslips/me")
  payslip(@CurrentUser() user: RequestUser, @Query(ZodQuery(periodQuery)) q: z.infer<typeof periodQuery>) {
    return this.payroll.myPayslip(user, q.year, q.month);
  }

  @Get("payslips/:id/pdf")
  @Roles("hr", "md", "employee")
  async payslipPdf(@CurrentUser() user: RequestUser, @Param("id") id: string, @Res() res: Response) {
    const pdf = await this.payroll.payslipPdf(user, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=payslip-${id}.pdf`);
    res.send(pdf);
  }

  @Get("periods/:id/bank-transfer")
  @Roles("hr", "md")
  async bankTransfer(@CurrentUser() user: RequestUser, @Param("id") id: string, @Res() res: Response) {
    const out = await this.payroll.bankTransferCsv(user, id);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=neft-${out.period}.csv`);
    res.send(out.csv);
  }
}
